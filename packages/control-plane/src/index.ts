import { assertOperationArea, validAreaPermissions, compatibilityCapabilities, legacyAreaPermissions } from '../../policy/src/areas.js';
import {historyFilterSchema,type HistoryFilter} from './history.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, type AreaPermission, type Capability, type Principal } from '../../contracts/src/index.js';
import { IntentCipher, redactJournalResult } from '../../storage/src/index.js';
import { loadVerifiedPrincipal } from '../../identity/src/index.js';
import { reauthorize } from '../../policy/src/index.js';
import type { AuditEvent, ControlActor, ControlPlaneStore, DispatchControls, JobLease, JobRecord, JobView, LeaseIdentity, MemberInput, Page, PageCursor, PermissionTemplate } from './contracts.js';
export type * from './contracts.js';

export const CONTROL_CAPABILITIES = ['operational.read', 'tickets.write', 'time.self', 'time.team', 'time.approve', 'scheduling.write', 'finance.read', 'sales.write', 'finance.write', 'projects.write', 'procurement.write', 'configuration.write', 'expenses.write', 'documentation.read', 'documentation.write', 'rmm.read', 'rmm.execute', 'rmm.write', 'platform.manage', 'audit.read'] as const;
const identity = z.string().regex(/^[^:\s]{1,256}$/);
const actorSchema = z.object({ tenantId: identity, objectId: identity }).strict();
const identifier = z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const policy = { areaPermissions: z.custom<AreaPermission[]>(validAreaPermissions).optional(), capabilities: z.array(z.enum(CONTROL_CAPABILITIES)).max(20), companyIds: z.array(z.number().int().nonnegative().safe()).max(1000) };
const memberSchema = z.object({ objectId: identity, resourceId: id, active: z.boolean(), allCompanies:z.boolean().optional(), ...policy }).strict();
const version = z.number().int().min(0).max(2_147_483_646);
const cursorSchema = z.object({ at: z.iso.datetime(), id: z.string().uuid() }).strict();
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired', 'uncertain']);
export const controlConflict = () => new AppError('conflict', 'The saved version or job lease changed. Reload its current state before continuing.');
export const controlUnavailable = () => new AppError('dependency_unavailable', 'The control-plane store is unavailable. No dispatch is authorized.');
export const controlNotFound = () => new AppError('not_found_or_inaccessible', 'The requested record is unavailable.');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); if (!parsed.success) throw new AppError('invalid_input', 'The control-plane request is invalid.'); return parsed.data;
}
function key(actor: ControlActor): string { parse(actorSchema, { tenantId: actor?.tenantId, objectId: actor?.objectId }); return `${actor.tenantId}:${actor.objectId}`; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter(k => (value as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  const result = JSON.stringify(value); if (result === undefined) throw new AppError('invalid_input', 'Job input must be JSON data.'); return result;
}
export function jobView(job: JobRecord): JobView {
  const { encryptedPayload: _payload, leaseToken: _token, leaseOwner: _owner, payloadHash: _hash, requestKey: _request, ...view } = job;
  return structuredClone(view);
}
export function controlPage<T extends { id: string }>(rows: T[], limit: number, date: (row: T) => string): Page<T> {
  const items = rows.slice(0, limit), last = items.at(-1);
  return { items, ...(rows.length > limit && last ? { nextCursor: { at: date(last), id: last.id } } : {}) };
}
export function auditEvent(actor: ControlActor, action: AuditEvent['action'], targetType: AuditEvent['targetType'], targetId: string, at: string, details: AuditEvent['details'] = {}): AuditEvent {
  return { id: randomUUID(), tenantId: actor.tenantId, actorKey: key(actor), action, targetType, targetId, at,
    details: { ...(Number.isSafeInteger(details.version) ? { version: details.version } : {}),
      ...(Number.isSafeInteger(details.fence) ? { fence: details.fence } : {}),
      ...(details.state && ['queued', 'running', ...terminal].includes(details.state) ? { state: details.state } : {}) } };
}
export function jobActor(job: JobRecord): ControlActor {
  return { tenantId: job.tenantId, objectId: job.actorKey.slice(job.tenantId.length + 1) };
}
export function sameJob(job: JobRecord, candidate: Pick<JobRecord, 'payloadHash' | 'operation' | 'resourceId' | 'mappingVersion' | 'policyVersion' | 'runAfter' | 'expiresAt'>): void {
  if (job.payloadHash !== candidate.payloadHash || job.operation !== candidate.operation || job.resourceId !== candidate.resourceId
      || job.mappingVersion !== candidate.mappingVersion || job.policyVersion !== candidate.policyVersion) throw controlConflict();
}
export function validLease(job: JobRecord | undefined, lease: LeaseIdentity, at: string): asserts job is JobRecord {
  if (!job || job.state !== 'running' || job.leaseToken !== lease.token || job.fence !== lease.fence
      || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.parse(at)) throw controlConflict();
}

export interface ControlPlaneOptions {
  bootstrapIdentityKeys: readonly string[];
  cipher: IntentCipher;
  clock?: () => number;
  verifyResource?: (tenantId: string, resourceId: number) => Promise<boolean | { verifiedAt: string }>;
  operations?: Readonly<Record<string, { write: boolean; capabilities: readonly Capability[] }>>;
  safeConfig?: { applicationReadOperations?: readonly string[]; mode: 'fixture' | 'live'; liveQualified: boolean; databaseConfigured: boolean; intentKeyConfigured: boolean; secretReferences?: Record<string, string> };
  actorJobLimit?: number; tenantJobLimit?: number;
}
/** API-facing methods enforce tenant ownership. Worker lease methods are internal, never administrator force-completion APIs. */
export class ControlPlaneService {
  private readonly now: () => number;
  private readonly bootstrap: Set<string>;
  private readonly operations: NonNullable<ControlPlaneOptions['operations']>;
  constructor(readonly store: ControlPlaneStore, private readonly options: ControlPlaneOptions) {
    this.now = options.clock ?? Date.now;
    this.bootstrap = new Set(options.bootstrapIdentityKeys);
    for (const actor of this.bootstrap) if (!/^[^:\s]{1,256}:[^:\s]{1,256}$/.test(actor)) throw new AppError('invalid_input', 'A bootstrap identity is invalid.');
    this.operations = options.operations ?? {
      ticket_update: { write: true, capabilities: ['operational.read', 'tickets.write'] },
      ticket_note_add: { write: true, capabilities: ['operational.read', 'tickets.write'] },
      time_log_ticket: { write: true, capabilities: ['operational.read', 'time.self'] },
      ticket_document_work: { write: true, capabilities: ['operational.read', 'tickets.write', 'time.self'] },
    };
    for (const [name, operation] of Object.entries(this.operations)) {
      parse(identifier, name);
      if (typeof operation.write !== 'boolean' || !operation.capabilities.every(cap => CONTROL_CAPABILITIES.includes(cap))) throw new AppError('invalid_input', 'Configured operation controls are invalid.');
    }
    for (const [name, reference] of Object.entries(options.safeConfig?.secretReferences ?? {})) {
      if (!/^[a-z][a-z0-9_]{0,49}$/.test(name) || !/^(?:env:[A-Z][A-Z0-9_]{0,99}|vault:[A-Za-z0-9][A-Za-z0-9/_-]{0,199})$/.test(reference)) throw new AppError('invalid_input', 'Configuration accepts secret references only.');
    }
    for (const limit of [options.actorJobLimit ?? 32, options.tenantJobLimit ?? 256]) parse(z.number().int().min(1).max(10_000), limit);
  }
  private at(): string { return new Date(this.now()).toISOString(); }
  private async principal(actor: ControlActor): Promise<Principal> {
    key(actor);
    return loadVerifiedPrincipal(actor.tenantId, actor.objectId, { get: (tenantId, objectId) => this.store.getMember({ tenantId, objectId }) });
  }
  private async recheck(principal: Principal): Promise<void> {
    await reauthorize(principal, { get: (tenantId, objectId) => this.store.getMember({ tenantId, objectId }) });
  }
  private async admin(actor: ControlActor): Promise<void> {
    if (this.bootstrap.has(key(actor))) return;
    const principal = await this.principal(actor);
    if (!principal.capabilities.includes('platform.manage')) throw new AppError('forbidden', 'Platform administration is not assigned.');
  }
  private async auditAccess(actor: ControlActor): Promise<void> {
    if (this.bootstrap.has(key(actor))) return;
    const principal = await this.principal(actor);
    if (!principal.capabilities.includes('platform.manage') && !principal.capabilities.includes('audit.read')) throw new AppError('forbidden', 'Audit access is not assigned.');
  }
  private page(limit = 50, cursor?: PageCursor) { parse(z.number().int().min(1).max(100), limit); if (cursor) parse(cursorSchema, cursor); return limit; }
  async diagnosticAccess(actor:ControlActor,id:string,action:'detail'|'export'){parse(z.string().uuid(),id);parse(z.enum(['detail','export']),action);const p=await this.principal(actor);if(!p.capabilities.includes('platform.manage'))throw new AppError('forbidden','Platform administration is required for diagnostic details.');await this.store.diagnosticAccess(actor,id,action,this.at());await this.recheck(p);}
  async snapshot(actor: ControlActor) {
    await this.admin(actor);
    const [healthy, controls, members, templates] = await Promise.all([this.store.health(), this.store.getControls(actor.tenantId), this.store.listMembers(actor.tenantId), this.store.listTemplates(actor.tenantId)]);
    const source = this.options.safeConfig;
    const config = source ? { ...(source.applicationReadOperations?{applicationReadOperations:[...source.applicationReadOperations]}:{}), mode: source.mode, liveQualified: source.liveQualified, databaseConfigured: source.databaseConfigured, intentKeyConfigured: source.intentKeyConfigured, secretReferences: { ...source.secretReferences } } : undefined;
    await this.admin(actor);
    return { healthy, backend: this.store.backend, controls, members: members.map(m=>({...m,areaPermissions:m.areaPermissions??legacyAreaPermissions(m.capabilities)})), templates: templates.map(t=>({...t,areaPermissions:t.areaPermissions??legacyAreaPermissions(t.capabilities)})), ...(config ? { config } : {}) };
  }
  async saveMember(actor: ControlActor, input: MemberInput, expectedVersion: number): Promise<Principal> {
    await this.admin(actor); const data = parse(memberSchema, input); parse(version, expectedVersion);
    if (data.areaPermissions !== undefined) data.capabilities = compatibilityCapabilities(data.areaPermissions, data.capabilities);
    const existing = await this.store.getMember({ tenantId: actor.tenantId, objectId: data.objectId });
    if (existing?.areaPermissions !== undefined && data.areaPermissions === undefined) throw new AppError('invalid_input', 'Explicit area permissions are required when updating this user.');
    if ((existing?.mappingVersion ?? 0) !== expectedVersion) throw controlConflict();
    let verifiedAt = existing?.resourceId === data.resourceId ? existing.resourceVerifiedAt : '1970-01-01T00:00:00.000Z';
    if (data.active) {
      if (this.options.verifyResource) {
        const evidence = await this.options.verifyResource(actor.tenantId, data.resourceId);
        if (!evidence) throw new AppError('identity_mapping_invalid', 'The Autotask employee could not be verified.');
        verifiedAt = evidence === true ? this.at() : evidence.verifiedAt;
        if (!Number.isFinite(Date.parse(verifiedAt)) || Date.parse(verifiedAt) > this.now() || this.now() - Date.parse(verifiedAt) >= 300_000) throw new AppError('identity_validation_unavailable', 'The employee resource verification is expired or invalid.');
      } else if (!Number.isFinite(Date.parse(verifiedAt)) || this.now() - Date.parse(verifiedAt) > 300_000 || Date.parse(verifiedAt) > this.now()) {
        throw new AppError('identity_validation_unavailable', 'Verify the employee resource before activating this mapping.');
      }
    }
    await this.admin(actor);
    return this.store.saveMember(actor, { tenantId: actor.tenantId, ...data, capabilities: [...new Set(data.capabilities)], companyIds: [...new Set(data.companyIds)],
      mappingVersion: expectedVersion + 1, policyVersion: `control-${expectedVersion + 1}`, resourceVerifiedAt: verifiedAt }, expectedVersion, this.at());
  }
  async saveTemplate(actor: ControlActor, input: { areaPermissions?: AreaPermission[]; allCompanies?: boolean; key: string; capabilities: Capability[]; companyIds: number[] }, expectedVersion: number) {
    await this.admin(actor); const data = parse(z.object({ key: identifier, allCompanies:z.boolean().optional(), ...policy }).strict(), input); parse(version, expectedVersion);
    if (data.areaPermissions !== undefined) data.capabilities = compatibilityCapabilities(data.areaPermissions, data.capabilities);
    const existing = (await this.store.listTemplates(actor.tenantId)).find(t=>t.key===data.key);
    if (existing?.areaPermissions !== undefined && data.areaPermissions === undefined) throw new AppError('invalid_input', 'Explicit area permissions are required when updating this template.');
    return this.store.saveTemplate(actor, { tenantId: actor.tenantId, ...data, version: expectedVersion + 1 }, expectedVersion, this.at());
  }
  async setControls(actor: ControlActor, input: { writePaused: boolean; tools: Record<string, boolean> }, expectedVersion: number): Promise<DispatchControls> {
    await this.admin(actor); const data = parse(z.object({ writePaused: z.boolean(), tools: z.record(identifier, z.boolean()) }).strict(), input); parse(version, expectedVersion);
    if (Object.keys(data.tools).some(name => !Object.hasOwn(this.operations, name))) throw new AppError('invalid_input', 'A tool switch names an unconfigured operation.');
    return this.store.saveControls(actor, { tenantId: actor.tenantId, ...data, version: expectedVersion + 1 }, expectedVersion, this.at());
  }
  async assertDispatchAllowed(actor: ControlActor, operation: string, isWrite?: boolean): Promise<void> {
    const principal = await this.principal(actor), definition = this.operations[operation];
    if (!definition || (isWrite !== undefined && isWrite !== definition.write)) throw new AppError('unsupported_operation', 'The operation is not configured for dispatch.');
    assertOperationArea(principal, operation, definition.write);
    if (!definition.capabilities.every(cap => principal.capabilities.includes(cap))) throw new AppError('forbidden', 'The operation capability is not assigned.');
    const controls = await this.store.getControls(actor.tenantId);
    if (controls.tools[operation] === false || (definition.write && controls.writePaused)) throw new AppError('forbidden', 'The operation is paused by platform controls.');
  }
  async consoleAccess(actor:ControlActor){
    if(this.bootstrap.has(key(actor)))return{admin:true,audit:true};
    const principal=await this.principal(actor);return{admin:principal.capabilities.includes('platform.manage'),audit:principal.capabilities.some(c=>c==='platform.manage'||c==='audit.read')};
  }
  async history(actor:ControlActor,input:HistoryFilter){
    const filter=parse(historyFilterSchema,input),access=await this.consoleAccess(actor);
    const principal=this.bootstrap.has(key(actor))?undefined:await this.principal(actor);
    if(filter.kind==='audit')await this.auditAccess(actor);
    else if(!access.admin){if(filter.user&&filter.user!==actor.objectId)throw new AppError('forbidden','You can view only your own activity.');filter.user=actor.objectId;}
    const result=await this.store.listHistory(actor.tenantId,filter);
    if(principal)await this.recheck(principal);
    if(filter.kind==='audit')await this.auditAccess(actor);else if(access.admin)await this.admin(actor);
    return{...result,scope:filter.kind==='audit'||access.admin?'all':'own'};
  }
  async activity(actor: ControlActor, limit = 50, cursor?: PageCursor) {
    const principal = await this.principal(actor), result = await this.store.listOperations(key(actor), this.page(limit, cursor), cursor);
    await this.recheck(principal);
    // Actor-owned activity is historical metadata, not an authorization to read
    // the old ticket/child receipt after mapping or company scope changes.
    return { ...result, items: result.items.map(({ id, operation, state, createdAt, updatedAt }) => ({ id, operation, state, createdAt, updatedAt })) };
  }
  async audit(actor: ControlActor, limit = 50, cursor?: PageCursor) {
    await this.auditAccess(actor);
    const result = await this.store.listAudit(actor.tenantId, this.page(limit, cursor), cursor);
    await this.auditAccess(actor); return result;
  }
  async enqueue(actor: ControlActor, input: { operation: string; requestKey: string; payload: unknown; runAfter?: string; expiresAt?: string }): Promise<JobView> {
    const data = parse(z.object({ operation: identifier, requestKey: z.string().trim().min(8).max(128).refine(v => !v.includes('\0')), payload: z.record(z.string(), z.unknown()), runAfter: z.iso.datetime().optional(), expiresAt: z.iso.datetime().optional() }).strict(), input);
    await this.assertDispatchAllowed(actor, data.operation); const p = await this.principal(actor);
    if (!this.operations[data.operation]?.write) throw new AppError('unsupported_operation', 'Durable jobs currently support configured write workflows only.');
    const serialized = canonical(data.payload);
    if (Buffer.byteLength(serialized) > 64 * 1024) throw new AppError('invalid_input', 'Job input exceeds its encrypted payload limit.');
    const payloadHash = createHash('sha256').update(canonical({ operation: data.operation, payload: data.payload, runAfter: data.runAfter, expiresAt: data.expiresAt })).digest('hex');
    const previous = await this.store.findJob(key(actor), data.requestKey);
    if (previous) { sameJob(previous, { ...previous, payloadHash, operation: data.operation, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion }); return jobView(previous); }
    const now = this.at(), runAfter = data.runAfter ?? now, expiresAt = data.expiresAt ?? new Date(this.now() + 86_400_000).toISOString();
    if (Date.parse(runAfter) < this.now() - 1000 || Date.parse(expiresAt) <= Math.max(this.now(), Date.parse(runAfter)) || Date.parse(expiresAt) > this.now() + 7 * 86_400_000) throw new AppError('invalid_input', 'Job timing must fit within the next seven days.');
    const binding = `job|${key(actor)}|${data.requestKey}|${payloadHash}|${p.mappingVersion}|${p.policyVersion}`;
    const job = await this.store.enqueue({ id: randomUUID(), tenantId: actor.tenantId, actorKey: key(actor), requestKey: data.requestKey, payloadHash, operation: data.operation,
      resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, encryptedPayload: this.options.cipher.seal(data.payload, binding),
      createdAt: now, runAfter, expiresAt }, { actor: this.options.actorJobLimit ?? 32, tenant: this.options.tenantJobLimit ?? 256 });
    return jobView(job);
  }
  async jobs(actor: ControlActor, limit = 50, cursor?: PageCursor): Promise<Page<JobView>> {
    const principal = await this.principal(actor), result = await this.store.listJobs(key(actor), this.page(limit, cursor), cursor);
    await this.recheck(principal); return { ...result, items: result.items.map(jobView) };
  }
  async job(actor: ControlActor, id: string): Promise<JobView> {
    const principal = await this.principal(actor); parse(z.string().uuid(), id); const job = await this.store.getJob(id, key(actor));
    await this.recheck(principal); if (!job) throw controlNotFound(); return jobView(job);
  }
  async cancel(actor: ControlActor, id: string): Promise<JobView> {
    await this.principal(actor); parse(z.string().uuid(), id); return jobView(await this.store.cancel(id, key(actor), this.at()));
  }
  async claim(workerId: string, leaseMs = 30_000): Promise<JobLease | undefined> {
    parse(identifier, workerId); parse(z.number().int().min(1000).max(300_000), leaseMs);
    return this.store.claim(workerId, this.at(), new Date(this.now() + leaseMs).toISOString());
  }
  async beginDispatch(lease: JobLease): Promise<{ job: JobRecord; payload: unknown }> {
    const stored = await this.store.getJob(lease.job.id, lease.job.actorKey);
    validLease(stored, { id: lease.job.id, token: lease.token, fence: lease.fence }, this.at());
    const actor = jobActor(stored), current = await this.principal(actor);
    if (current.resourceId !== stored.resourceId || current.mappingVersion !== stored.mappingVersion || current.policyVersion !== stored.policyVersion) throw new AppError('conflict', 'The job employee mapping or policy changed.');
    await this.assertDispatchAllowed(actor, stored.operation);
    if (!stored.encryptedPayload || Date.parse(stored.expiresAt) <= this.now() || stored.cancelRequested) throw controlConflict();
    const payload = this.options.cipher.open(stored.encryptedPayload, `job|${stored.actorKey}|${stored.requestKey}|${stored.payloadHash}|${stored.mappingVersion}|${stored.policyVersion}`);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('conflict', 'The saved job input is invalid.');
    return { job: await this.store.markDispatch({ id: stored.id, token: lease.token, fence: lease.fence }, this.at()), payload: { ...payload, request_key: `job:${stored.id}` } };
  }
  async finish(lease: JobLease, state: 'succeeded' | 'failed' | 'uncertain', operationId?: string): Promise<JobView> {
    parse(z.enum(['succeeded', 'failed', 'uncertain']), state);
    const stored = await this.store.getJob(lease.job.id, lease.job.actorKey);
    validLease(stored, { id: lease.job.id, token: lease.token, fence: lease.fence }, this.at());
    if (state === 'succeeded' && !stored.dispatched) throw new AppError('precondition_failed', 'A job cannot succeed before its dispatch checkpoint.');
    if (state === 'succeeded' || (state === 'failed' && stored.dispatched)) {
      if (!operationId) throw new AppError('precondition_failed', 'A persisted operation outcome is required.');
      parse(z.string().uuid(), operationId);
      const receipt = await this.store.getOperation(operationId, stored.actorKey);
      if (!receipt || receipt.requestKey !== `job:${stored.id}` || receipt.operation !== stored.operation || receipt.mappingVersion !== stored.mappingVersion || receipt.resourceId !== stored.resourceId
          || receipt.policyVersion !== stored.policyVersion || receipt.state !== (state === 'succeeded' ? 'succeeded_verified' : 'failed')) throw new AppError('precondition_failed', 'The journal does not verify the requested job outcome.');
    }
    return jobView(await this.store.finish({ id: stored.id, token: lease.token, fence: lease.fence }, state, this.at(), operationId));
  }
  async purgeExpiredPayloads(actor: ControlActor, retentionDays = 30): Promise<number> {
    await this.admin(actor); parse(z.number().int().min(1).max(3650), retentionDays);
    return this.store.purgeJobPayloads(actor, new Date(this.now() - retentionDays * 86_400_000).toISOString(), this.at());
  }
}

export { MemoryControlPlaneStore } from './memory.js';
export { PostgresControlPlaneStore } from './postgres.js';
