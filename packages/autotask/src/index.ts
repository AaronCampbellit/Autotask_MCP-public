import {providerFetch} from '../../execution/src/index.js';
import { assertEntityArea } from '../../policy/src/areas.js';
import { validTimeInterval } from '../../resolution/src/time-interval.js';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError, actorKey, positiveId, validCompanyId, type AutotaskPort, type DataRecord, type Entity, type Filter, type Page, type Principal, type QueryRequest, type TicketNoteCreate, type TicketTimeCreate, type TicketWorkMetadata } from '../../contracts/src/index.js';
import type { RequestBudgetPort } from './budget.js';
import { impersonationHeader } from './impersonation.js';

export type AutotaskOperation = 'Tickets.create' | 'Tickets.query' | 'Tickets.get' | 'TicketNotes.query' | 'TicketNotes.create' | 'TicketNotes.get' | 'TimeEntries.query' | 'TimeEntries.create' | 'TimeEntries.get' | 'Companies.query' | 'Companies.get' | 'Tickets.patch' | 'TicketSecondaryResources.create' | 'TicketSecondaryResources.get' | 'TicketSecondaryResources.delete' | 'TicketTagAssociations.create' | 'TicketTagAssociations.delete' | 'TicketChecklistLibraries.create';
export const APPLICATION_READ_OPERATIONS = ['Tickets.query','Tickets.get','Companies.query','Companies.get','TicketNotes.query','TicketNotes.get','TimeEntries.query'] as const;
const isMutation = (operation: AutotaskOperation): boolean => operation === 'Tickets.patch' || operation.endsWith('.create') || operation.endsWith('.delete');

/** Reviewed server configuration. Fixture evidence never qualifies a live operation. */
export interface OperationQualification {
  operation: AutotaskOperation;
  evidenceSource: 'live' | 'fixture';
  headerAccepted: boolean;
  permissionEnforced: boolean;
  nativeAttribution?: boolean;
  testIds: readonly string[];
  resourceIds: readonly number[];
  tenantId: string;
  policyVersion: string;
  qualifiedAt: string;
  expiresAt: string;
  evidenceReference: string;
}

export interface HttpAutotaskAdapterOptions {
  baseUrl: string;
  username: string;
  secret: string;
  integrationCode: string;
  cursorSecret: string;
  qualifications?: readonly OperationQualification[];
  /** Explicit API-account read mode. Native employee permissions are not claimed. */
  applicationReads?: {tenantId:string;operations:readonly string[]};
  applicationWrites?: {tenantId:string;operations:readonly string[]};
  /** Required for live execution. Rechecks the authoritative mapping; a change requires a new request. */
  revalidatePrincipal?: (principal: Principal) => Promise<Principal>;
  /** Reviewed runtime provider, never tool input. It resolves category, audience,
   * resource/role, work-type, contract and time-entry eligibility restrictions.
   * Called again immediately before a create; must not recursively call this adapter.
   */
  resolveTicketWorkMetadata?: (principal: Principal, ticketId: number, ticket?: Readonly<DataRecord>) => Promise<TicketWorkMetadata>;
  /** Required for live time creates. Reviews this exact proposed date and payload
   * against timesheet state, completion restrictions and effective resource/role,
   * work-type and contract rules. dateWorked is a local-date container; the
   * provider must qualify its tenant/timezone semantics without inventing a start.
   * Called for read-only full-payload preflight and again before a create after
   * capacity is acquired; must not recursively call this adapter.
   */
  validateTicketTimeEligibility?: (principal: Principal, ticketId: number, payload: Readonly<TicketTimeCreate>, metadata?: Readonly<TicketWorkMetadata>) => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxReadRetries?: number;
  identityFreshnessMs?: number;
  cursorTtlMs?: number;
  queueTimeoutMs?: number;
  /** The production factory supplies one shared budget across every adapter and retry/readback path. */
  requestBudget?: RequestBudgetPort;
}

type FieldType = 'companyId' | 'id' | 'picklist' | 'number' | 'string' | 'date' | 'boolean';
const fields: Record<Entity, Record<string, FieldType>> = {
  Tickets: { id: 'id', companyID: 'companyId', status: 'id', queueID: 'id', priority: 'id', ticketType: 'id', assignedResourceID: 'id', ticketNumber: 'string', title: 'string', description: 'string', dueDateTime: 'date', createDate: 'date', lastActivityDate: 'date', lastTrackedModificationDateTime: 'date', completedDate: 'date', completedByResourceID: 'id' },
  Companies: { id: 'companyId', companyName: 'string', isActive: 'boolean' },
  TicketNotes: { id: 'id', ticketID: 'id', noteType: 'id', publish: 'picklist', createDateTime: 'date', title: 'string', description: 'string', creatorResourceID: 'id' },
  TimeEntries: { id: 'id', ticketID: 'id', resourceID: 'id', dateWorked: 'date', startDateTime: 'date', endDateTime: 'date', hoursWorked: 'number' },
};
// Only title updates are enabled in the first vertical slice. Further writable
// fields require tenant metadata and their conditional rules before expansion.
const patchFields: Record<string, FieldType> = { title: 'string' };
const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const failInput = (): never => { throw new AppError('invalid_input', 'The Autotask request is not supported by the reviewed contract.'); };
const failDependency = (): never => { throw new AppError('dependency_unavailable', 'Autotask returned an invalid or unsupported response.'); };
const failMetadata = (): never => { throw new AppError('missing_metadata', 'Reviewed ticket-work metadata is missing, invalid, expired, or belongs to another employee or ticket.'); };
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const keysWithin = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const validPublish = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function validOptions(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 500 && value.every((option: unknown) => object(option)
    && keysWithin(option, ['id', 'label', 'active']) && positiveId(option.id)
    && boundedText(option.label, 200) && typeof option.active === 'boolean')
    && new Set(value.map((option) => option.id)).size === value.length;
}

function validateNotePayload(value: TicketNoteCreate): void {
  if (!object(value) || !keysWithin(value, ['title', 'description', 'noteType', 'publish'])
    || !boundedText(value.description, 32_000) || !positiveId(value.noteType) || !validPublish(value.publish)
    || (value.title !== undefined && !boundedText(value.title, 250))) return failInput();
}

function validateTimePayload(value: TicketTimeCreate, principal: Principal): void {
  if (!object(value) || !keysWithin(value, ['resourceID', 'roleID', 'billingCodeID', 'hoursWorked', 'dateWorked', 'summaryNotes', 'internalNotes', 'startDateTime', 'endDateTime'])
    || !positiveId(value.resourceID) || !positiveId(value.roleID) || !positiveId(value.billingCodeID)
    || typeof value.hoursWorked !== 'number' || !Number.isFinite(value.hoursWorked) || value.hoursWorked <= 0 || value.hoursWorked > 24
    || !boundedText(value.summaryNotes, 32_000)
    || (value.internalNotes !== undefined && (typeof value.internalNotes !== 'string' || value.internalNotes.length > 32_000))
    || typeof value.dateWorked !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(value.dateWorked)
    || !Number.isFinite(Date.parse(value.dateWorked)) || new Date(value.dateWorked).toISOString() !== value.dateWorked.replace('Z', '.000Z')) return failInput();
  if (!validTimeInterval(value.startDateTime, value.endDateTime, value.hoursWorked)) return failInput();
  if (value.resourceID !== principal.resourceId) throw new AppError('forbidden', 'This time-entry operation records time only for the signed-in employee.');
}

const metadataMeaning = (metadata: TicketWorkMetadata): string => digest({ ...metadata, validUntil: undefined });

function validValue(value: unknown, kind: FieldType): boolean {
  if (kind === 'companyId') return validCompanyId(value);
  if (kind === 'id') return positiveId(value);
  if (kind === 'picklist') return validPublish(value);
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (kind === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'string' || value.length > 20_000) return false;
  return kind !== 'date' || (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
}

function reviewedFilters(entity: Entity, input: Filter[]): Filter[] {
  if (!Array.isArray(input) || input.length > 20) return failInput();
  return input.map((filter) => {
    if (!object(filter) || Object.keys(filter).some((key) => !['field', 'op', 'value'].includes(key)) || typeof filter.field !== 'string' || !own(fields[entity], filter.field)) return failInput();
    const kind = fields[entity][filter.field]!;
    if (!['eq', 'in', 'contains', 'gte', 'lte', 'lt'].includes(filter.op)) return failInput();
    if (filter.op === 'contains' && kind !== 'string') return failInput();
    if (['gte', 'lte', 'lt'].includes(filter.op) && !['id', 'number', 'date'].includes(kind)) return failInput();
    if (filter.op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length < 1 || filter.value.length > 100 || !filter.value.every((item) => validValue(item, kind))) return failInput();
    } else if (!validValue(filter.value, kind)) return failInput();
    return { field: filter.field, op: filter.op, value: structuredClone(filter.value) };
  });
}

/** Stable canonical encoding for query, scope and mapping bindings. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const identityBinding = (p: Principal): string => digest({ tenantId: p.tenantId, objectId: p.objectId, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, companies: [...p.companyIds].sort((a, b) => a - b), areaPermissions: p.areaPermissions, capabilities: [...p.capabilities].sort() });
interface CursorPayload { version: 1; binding: string; query: string; expires: number; nextUrl?: string; afterId?: number }

type WaitingRequest = { actor: string; resolve: (release: () => void) => void; reject: (error: AppError) => void; timer: ReturnType<typeof setTimeout> };
type RequestLease = { actor: string; active: boolean; borrowed: boolean; release: () => void };
/** Process-shared limits apply across adapter instances and employee identities.
 * These concurrency limits do not substitute for tenant rate/threshold budgets.
 */
class RequestScheduler {
  private active = 0;
  private readonly activeByActor = new Map<string, number>();
  private readonly pending: WaitingRequest[] = [];
  private lastActor = '';
  private readonly lease = new AsyncLocalStorage<RequestLease>();

  /** A guarded outer request can reuse its capacity for one sequential preflight
   * read. The outer HTTP dispatch must wait until that read has finished. Parallel
   * or recursive borrows fail explicitly instead of oversubscribing or deadlocking.
   */
  async runWithLease<T>(actor: string, timeoutMs: number, callback: () => Promise<T>, nestedRead = false): Promise<T> {
    if (this.lease.getStore()?.active && !nestedRead) throw new AppError('throttled', 'Nested guarded request leases are not supported.');
    const release = await this.acquire(actor, timeoutMs);
    const lease: RequestLease = { actor, active: true, borrowed: false, release };
    try { return await this.lease.run(lease, callback); }
    finally {
      // An abandoned asynchronous guard cannot borrow a released permit. If its
      // already-running nested read remains active, retain capacity until it exits.
      lease.active = false;
      if (!lease.borrowed) release();
    }
  }

  assertLeaseIdle(actor: string): void {
    const lease = this.lease.getStore();
    if (!lease || !lease.active || lease.actor !== actor || lease.borrowed) throw new AppError('throttled', 'A guarded request cannot dispatch while a nested read is still active.');
  }

  acquire(actor: string, timeoutMs: number): Promise<() => void> {
    const lease = this.lease.getStore();
    if (lease?.active) {
      if (lease.actor !== actor) return Promise.reject(new AppError('forbidden', 'A nested preflight must use the same mapped employee.'));
      if (lease.borrowed) return Promise.reject(new AppError('throttled', 'Parallel or recursive nested preflight requests are not supported.'));
      lease.borrowed = true; let returned = false;
      return Promise.resolve(() => { if (returned) return; returned = true; lease.borrowed = false; if (!lease.active) lease.release(); });
    }
    if (this.pending.length >= 100) return Promise.reject(new AppError('throttled', 'The Autotask request queue is full.', true));
    return new Promise((resolve, reject) => {
      const request: WaitingRequest = { actor, resolve, reject, timer: setTimeout(() => {
        const index = this.pending.indexOf(request);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new AppError('throttled', 'The Autotask request queue deadline was reached.', true));
      }, timeoutMs) };
      this.pending.push(request);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < 4) {
      const eligible = [...new Set(this.pending.filter((request) => (this.activeByActor.get(request.actor) ?? 0) < 2).map((request) => request.actor))];
      if (eligible.length === 0) return;
      const actor = eligible[(eligible.indexOf(this.lastActor) + 1) % eligible.length]!;
      const request = this.pending.splice(this.pending.findIndex((item) => item.actor === actor), 1)[0]!;
      clearTimeout(request.timer);
      this.lastActor = actor;
      this.active++;
      this.activeByActor.set(actor, (this.activeByActor.get(actor) ?? 0) + 1);
      let released = false;
      request.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        const count = this.activeByActor.get(actor)! - 1;
        if (count === 0) this.activeByActor.delete(actor);
        else this.activeByActor.set(actor, count);
        this.drain();
      });
    }
  }
}
export const requestScheduler = new RequestScheduler();

/** Small reviewed HTTP surface. Credentials and routes are never supplied by a tool caller. */
export class HttpAutotaskAdapter implements AutotaskPort {
  readonly source = 'Autotask' as const;
  private readonly base: URL;
  private readonly headers: Record<string, string>;
  private readonly key: Buffer;
  private readonly signingKey: Buffer;
  private readonly applicationReads?: HttpAutotaskAdapterOptions['applicationReads'];
  private readonly applicationWrites?: HttpAutotaskAdapterOptions['applicationWrites'];
  private readonly qualifications: readonly OperationQualification[];
  private readonly fetcher: typeof globalThis.fetch;
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly freshness: number;
  private readonly cursorTtl: number;
  private readonly queueTimeoutMs: number;
  private readonly revalidate?: HttpAutotaskAdapterOptions['revalidatePrincipal'];
  private readonly resolveWorkMetadata?: HttpAutotaskAdapterOptions['resolveTicketWorkMetadata'];
  private readonly validateTimeEligibility?: HttpAutotaskAdapterOptions['validateTicketTimeEligibility'];
  private readonly requestBudget?: RequestBudgetPort;

  constructor(options: HttpAutotaskAdapterOptions) {
    try { this.base = new URL(options.baseUrl); } catch { throw new AppError('invalid_input', 'Invalid Autotask base URL.'); }
    if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl) || this.base.username || this.base.password || this.base.search || this.base.hash) throw new AppError('invalid_input', 'Invalid Autotask base URL.');
    for (const credential of [options.username, options.secret, options.integrationCode]) {
      if (typeof credential !== 'string' || !credential.trim() || /[\r\n\0]/.test(credential)) throw new AppError('invalid_input', 'Autotask server credentials are missing or invalid.');
    }
    if (typeof options.cursorSecret !== 'string' || Buffer.byteLength(options.cursorSecret) < 32) throw new AppError('invalid_input', 'A cursor signing secret of at least 32 bytes is required.');
    this.headers = { UserName: options.username, Secret: options.secret, ApiIntegrationCode: options.integrationCode, Accept: 'application/json', 'Content-Type': 'application/json' };
    this.key = createHash('sha256').update(`autotask-cursor-encryption:${options.cursorSecret}`).digest();
    this.signingKey = createHash('sha256').update(`autotask-cursor-signing:${options.cursorSecret}`).digest();
    if(options.applicationReads){const r=options.applicationReads;if(!r.tenantId||!r.operations.length||new Set(r.operations).size!==r.operations.length||r.operations.some(op=>!APPLICATION_READ_OPERATIONS.includes(op as never))||!options.requestBudget||!options.revalidatePrincipal)throw new AppError('invalid_input','Application reads require an explicit read allowlist, budget and authoritative mapping store.');this.applicationReads=structuredClone(r);}
    if(options.applicationWrites){const w=options.applicationWrites;if(!w.tenantId||!w.operations.length||new Set(w.operations).size!==w.operations.length||w.operations.some(op=>!['Tickets.create','Tickets.patch','TicketNotes.create','TimeEntries.create','TimeEntries.get','TicketSecondaryResources.create','TicketSecondaryResources.get','TicketSecondaryResources.delete','TicketTagAssociations.create','TicketTagAssociations.delete','TicketChecklistLibraries.create'].includes(op))||!options.requestBudget||!options.revalidatePrincipal)throw new AppError('invalid_input','Application writes require an explicit allowlist, budget and mapping store.');this.applicationWrites=structuredClone(w);}
    this.qualifications = structuredClone(options.qualifications ?? []);
    this.fetcher = providerFetch('Autotask',options.fetch ?? globalThis.fetch);
    this.clock = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.maxReadRetries ?? 2;
    this.freshness = options.identityFreshnessMs ?? 60_000;
    this.cursorTtl = options.cursorTtlMs ?? 300_000;
    this.queueTimeoutMs = options.queueTimeoutMs ?? this.timeoutMs;
    this.revalidate = options.revalidatePrincipal;
    this.resolveWorkMetadata = options.resolveTicketWorkMetadata;
    this.validateTimeEligibility = options.validateTicketTimeEligibility;
    this.requestBudget = options.requestBudget;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000 || !Number.isInteger(this.retries) || this.retries < 0 || this.retries > 3 || !Number.isInteger(this.freshness) || this.freshness < 1 || this.freshness > 300_000 || !Number.isInteger(this.cursorTtl) || this.cursorTtl < 1 || this.cursorTtl > 900_000 || !Number.isInteger(this.queueTimeoutMs) || this.queueTimeoutMs < 1 || this.queueTimeoutMs > 60_000) return failInput();
  }

  private assertIdentity(principal: Principal): void {
    if (!principal || principal.active !== true || typeof principal.tenantId !== 'string' || !principal.tenantId || typeof principal.objectId !== 'string' || !principal.objectId || !positiveId(principal.resourceId) || !positiveId(principal.mappingVersion) || typeof principal.policyVersion !== 'string' || !principal.policyVersion || !Array.isArray(principal.companyIds) || !principal.companyIds.every(validCompanyId) || !Array.isArray(principal.capabilities)) throw new AppError('identity_mapping_invalid', 'An active employee mapping is required.');
    const verifiedAt = Date.parse(principal.resourceVerifiedAt);
    if (!Number.isFinite(verifiedAt) || verifiedAt > this.clock() || this.clock() - verifiedAt > this.freshness) throw new AppError('identity_validation_unavailable', 'The employee mapping requires fresh validation.');
  }

  private async guard(principal: Principal, operation: AutotaskOperation): Promise<void> {
    assertEntityArea(principal, operation.split('.')[0]!, /\.(create|patch|delete)$/.test(operation));
    this.assertIdentity(principal);
    if (this.revalidate) {
      let fresh: Principal;
      try { fresh = await this.revalidate(structuredClone(principal)); }
      catch (error) {
        if (error instanceof AppError && ['identity_mapping_invalid', 'identity_validation_unavailable'].includes(error.code)) throw error;
        throw new AppError('identity_validation_unavailable', 'The employee mapping could not be revalidated.');
      }
      this.assertIdentity(fresh);
      if (identityBinding(principal) !== identityBinding(fresh)) throw new AppError('identity_mapping_invalid', 'The employee mapping or policy changed; start a new request.');
    }
    this.assertIdentity(principal);
    if (!principal.capabilities.includes('operational.read') || (['Tickets.create', 'Tickets.patch', 'TicketNotes.create','TicketSecondaryResources.create','TicketSecondaryResources.delete','TicketTagAssociations.create','TicketTagAssociations.delete','TicketChecklistLibraries.create'].includes(operation) && !principal.capabilities.includes('tickets.write'))) throw new AppError('forbidden', 'This operation is outside the employee capability policy.');
    if (operation === 'TimeEntries.query' && !principal.capabilities.some((c) => c === 'time.self' || c === 'time.team')) throw new AppError('forbidden', 'Time entry access is not enabled.');
    if ((operation === 'TimeEntries.create' || operation === 'TimeEntries.get') && !principal.capabilities.includes('time.self')) throw new AppError('forbidden', 'Own time-entry access is not enabled.');
    const now = this.clock();
    const qualified = this.qualifications.some((q) => q.operation === operation && q.evidenceSource === 'live' && q.headerAccepted === true && q.permissionEnforced === true && (!isMutation(operation) || q.nativeAttribution === true) && q.tenantId === principal.tenantId && q.policyVersion === principal.policyVersion && Array.isArray(q.resourceIds) && q.resourceIds.includes(principal.resourceId) && Array.isArray(q.testIds) && q.testIds.length > 0 && q.testIds.every((id) => typeof id === 'string' && id.trim().length > 0) && typeof q.evidenceReference === 'string' && q.evidenceReference.trim().length > 0 && Number.isFinite(Date.parse(q.qualifiedAt)) && Date.parse(q.qualifiedAt) <= now && Date.parse(q.expiresAt) > now);
    const applicationRead=this.applicationReads?.tenantId===principal.tenantId&&this.applicationReads.operations.includes(operation);
    const applicationWrite=this.applicationWrites?.tenantId===principal.tenantId&&this.applicationWrites.operations.includes(operation);
    if (!qualified && !applicationRead && !applicationWrite) throw new AppError('impersonation_not_qualified', 'Live execution is disabled until this operation has reviewed employee permission evidence.');
    if (!this.revalidate) throw new AppError('identity_validation_unavailable', 'Live execution requires authoritative mapping revalidation before dispatch.');
  }

  private seal(payload: CursorPayload): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const encoded = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    const signature = createHmac('sha256', this.signingKey).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private unseal(cursor: string, principal: Principal, queryHash: string): CursorPayload {
    try {
      if (typeof cursor !== 'string' || cursor.length > 32_768 || !/^[\w-]+\.[\w-]+$/.test(cursor)) return failInput();
      const [encoded, signature] = cursor.split('.') as [string, string];
      const expected = createHmac('sha256', this.signingKey).update(encoded).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return failInput();
      const data = Buffer.from(encoded, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      const payload: CursorPayload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
      if (payload.version !== 1 || payload.binding !== identityBinding(principal) || payload.query !== queryHash || !Number.isFinite(payload.expires) || payload.expires <= this.clock()) return failInput();
      return payload;
    } catch { throw new AppError('invalid_input', 'The continuation cursor is invalid, expired, or belongs to a different request.'); }
  }

  private continuation(raw: string, initial: URL): URL {
    try {
      if (typeof raw !== 'string' || raw.length > 16_384 || /[\\\s]/.test(raw)) return failDependency();
      const next = new URL(raw);
      if (next.protocol !== 'https:' || next.origin !== this.base.origin || next.username || next.password || next.hash || next.pathname !== `${initial.pathname}/next` || !raw.startsWith(`${this.base.origin}${next.pathname}?`)) return failDependency();
      const keys = [...next.searchParams.keys()];
      if (keys.length !== 1 || keys[0] !== 'paging' || !next.searchParams.get('paging')) return failDependency();
      return next;
    } catch { return failDependency(); }
  }

  private async execute(principal: Principal, operation: AutotaskOperation, url: URL, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: string, beforeDispatch?: () => Promise<() => void>, leased=false): Promise<unknown> {
    if(beforeDispatch&&!leased)return requestScheduler.runWithLease(actorKey(principal),this.queueTimeoutMs,()=>this.execute(principal,operation,url,method,body,beforeDispatch,true));
    // POST /query is a read; POST creates must never inherit its retry behavior.
    const mutation = isMutation(operation);
    for (let attempt = 0; ; attempt++) {
      const release = leased ? () => {} : await requestScheduler.acquire(actorKey(principal), this.queueTimeoutMs);
      try {
      // A queue wait is not an authorization grant. Recheck the authoritative
      // mapping only after acquiring capacity, immediately before dispatch.
      await this.guard(principal, operation);
      await this.requestBudget?.take({ tenantId: principal.tenantId, actorKey: actorKey(principal) });
      const validateImmediately = beforeDispatch ? await beforeDispatch() : undefined;
      if (beforeDispatch || this.requestBudget) await this.guard(principal, operation);
      validateImmediately?.();
      if(leased)requestScheduler.assertLeaseIdle(actorKey(principal));
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let responseStatus: number | undefined;
      try {
        const applicationRead=this.applicationReads?.tenantId===principal.tenantId&&this.applicationReads.operations.includes(operation);
        const requestHeaders = { ...this.headers, ...(!applicationRead ? impersonationHeader(operation.split('.')[0]!,principal.resourceId) : {}) };
        // No caller headers, redirect following, or fallback identity exist on this path.
        const response = await Promise.race([
          this.fetcher(url, { method, headers: requestHeaders, body, redirect: 'manual', signal: controller.signal }).then(async (response) => {
            responseStatus = response.status;
            if (response.redirected || (response.url && response.url !== url.href)) return failDependency();
            if (response.status >= 300 && response.status < 400) return failDependency();
            if (!response.ok) {
              // One exact native rejection is known to be returned as HTTP 500.
              // Bound the read and never retain arbitrary native error text.
              if (operation === 'TimeEntries.create' && response.status === 500) {
                const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
                if (reader) { try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16000) break; chunks.push(part.value); } } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } } }
                if (size <= 16000) {
                  let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
                  if (object(body) && Array.isArray(body.errors) && body.errors.length === 1 && body.errors[0] === 'TimeEntries for Service tickets require a start and stop time.')
                    throw new AppError('invalid_input', 'Autotask requires actual start and stop times for this service ticket. Supply start_datetime and end_datetime.', false, {reason:'start_stop_required',http_status:500});
                }
              }
              return { response, data: undefined };
            }
            if (response.status === 204) return { response, data: null };
            const reader = response.body?.getReader();
            if (!reader) return failDependency();
            const chunks: Uint8Array[] = [];
            let length = 0;
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                length += chunk.value.byteLength;
                if (length > 2_000_000) { await reader.cancel(); return failDependency(); }
                chunks.push(chunk.value);
              }
            } finally { reader.releaseLock(); }
            let data: unknown;
            try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return failDependency(); }
            return { response, data };
          }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', mutation ? 'The write outcome is unknown; reconcile before any retry.' : 'Autotask request timed out.', !mutation, { reason: 'timeout', ...(responseStatus === undefined ? {} : { http_status: responseStatus }) })); }, this.timeoutMs); }),
        ]);
        if (timeout) clearTimeout(timeout);
        if (response.response.ok) return response.data;
        const status = response.response.status;
        await response.response.body?.cancel();
        const retryable = status === 429 || status === 502 || status === 503 || status === 504;
        if (!mutation && retryable && attempt < this.retries) {
          const retryAfter = response.response.headers.get('retry-after');
          const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
          const delay = seconds === undefined ? Math.min(250 * 2 ** attempt + Math.floor(Math.random() * 100), 2_000) : seconds * 1_000;
          if (delay <= 2_000) { release(); await this.sleep(delay); continue; }
        }
        if (status === 401 || status === 403) throw new AppError('forbidden', 'Autotask denied this operation.', false, { reason: 'http_error', http_status: status });
        if (status === 404) throw new AppError('not_found_or_inaccessible', 'The record was not found or is inaccessible.', false, { reason: 'http_error', http_status: status });
        if (status === 409) throw new AppError('conflict', 'Autotask reported a conflicting change.', false, { reason: 'http_error', http_status: status });
        if (status === 400 || status === 422) throw new AppError('invalid_input', 'Autotask rejected the supplied fields.', false, { reason: 'http_error', http_status: status });
        if (status === 429) throw new AppError('throttled', 'Autotask is throttling this operation.', !mutation, { reason: 'http_error', http_status: status });
        throw new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', mutation ? 'The write outcome is unknown; reconcile before any retry.' : 'Autotask is unavailable.', !mutation, { reason: 'http_error', http_status: status });
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        controller.abort();
        if (error instanceof AppError) {
          if (mutation && error.code === 'dependency_unavailable') throw new AppError('unknown_outcome', 'The write outcome is unknown; reconcile before any retry.', false, error.upstreamFailure ?? { reason: 'invalid_response', ...(responseStatus === undefined ? {} : { http_status: responseStatus }) });
          throw error;
        }
        // Fetch can reject after dispatch. Never replay a mutation on transport failure.
        if (!mutation && attempt < this.retries) { release(); await this.sleep(Math.min(250 * 2 ** attempt, 2_000)); continue; }
        throw new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', mutation ? 'The write outcome is unknown; reconcile before any retry.' : 'Autotask could not be reached.', !mutation, { reason: responseStatus === undefined ? 'transport_failure' : 'invalid_response', ...(responseStatus === undefined ? {} : { http_status: responseStatus }) });
      }
      } finally { release(); }
    }
  }

  private statusDefinitionCache?:{at:number;raw:unknown};
  get supportsTicketStatusLookup(){return this.applicationReads?.operations.includes('Tickets.query')===true;}
  async resolveOpenTicketStatuses(principal:Principal):Promise<number[]>{
    const excluded:number[]=[];for(const name of ['Complete','Complete (With CSAT)','Canceled','Duplicate'])excluded.push(await this.resolveTicketStatus(principal,{kind:'name',name}));
    const raw=this.statusDefinitionCache!.raw as {fields:Array<{name:string;picklistValues:Array<{value:unknown;isActive:boolean}>}>};
    const ids=raw.fields.find(f=>f.name==='status')!.picklistValues.filter(v=>v.isActive).map(v=>Number(v.value));
    if(ids.some(id=>!positiveId(id))||new Set(ids).size!==ids.length)throw new AppError('missing_metadata','Invalid status definitions.');
    return ids.filter(id=>!excluded.includes(id));
  }
  async resolveTicketStatus(principal: Principal, reference: {kind:'id';id:number}|{kind:'name';name:string}):Promise<number> {
    if(!this.applicationReads?.operations.includes('Tickets.query'))throw new AppError('impersonation_not_qualified','Status lookup requires application-scoped ticket reads.');
    await this.guard(principal,'Tickets.query');
    if(!this.statusDefinitionCache||this.clock()-this.statusDefinitionCache.at>=60000){const raw=await this.execute(principal,'Tickets.query',new URL('Tickets/entityInformation/fields',this.base),'GET');this.statusDefinitionCache={at:this.clock(),raw};}
    const raw=this.statusDefinitionCache.raw as {fields?:Array<{name?:string;picklistValues?:Array<{value?:unknown;label?:unknown;isActive?:unknown}>}>};
    const fields=raw?.fields?.filter(f=>f.name==='status');
    if(fields?.length!==1||!Array.isArray(fields[0]?.picklistValues))throw new AppError('missing_metadata','Ticket status definitions are unavailable; preserve the requested filter.');
    const matches=fields[0].picklistValues.filter(v=>v.isActive===true&&(reference.kind==='id'?String(v.value)===String(reference.id):typeof v.label==='string'&&v.label.trim().toLowerCase()===reference.name.trim().toLowerCase()));
    if(matches.length!==1||!positiveId(Number(matches[0]?.value)))throw new AppError('missing_metadata','Choose an exact, unique active ticket status; do not drop the status filter.');
    await this.guard(principal,'Tickets.query');return Number(matches[0]!.value);
  }

  async get(inputPrincipal: Principal, entity: Entity, id: number): Promise<DataRecord> {
    if ((entity !== 'Tickets' && entity !== 'Companies') || !(entity === 'Companies' ? validCompanyId(id) : positiveId(id))) return failInput();
    const principal = structuredClone(inputPrincipal);
    if(entity==='Companies'&&!principal.companyIds.includes(id))throw new AppError('not_found_or_inaccessible','The record was not found or is inaccessible.');
    const data = await this.execute(principal, `${entity}.get`, new URL(`${entity}/${id}`, this.base), 'GET');
    if (!object(data) || !object(data.item) || data.item.id !== id) return failDependency();
    const companyId = entity === 'Companies' ? id : data.item.companyID;
    if (!validCompanyId(companyId) || !principal.companyIds.includes(companyId)) throw new AppError('not_found_or_inaccessible', 'The record was not found or is inaccessible.');
    return data.item as DataRecord;
  }

  async countTickets(inputPrincipal: Principal, inputFilters: Filter[]): Promise<number> {
    const principal = structuredClone(inputPrincipal);
    this.assertIdentity(principal);
    const filters = reviewedFilters('Tickets', inputFilters);
    await this.guard(principal, 'Tickets.query');
    if (principal.companyIds.length === 0) return 0;
    filters.push({ field: 'companyID', op: 'in', value: principal.companyIds });
    const data = await this.execute(principal, 'Tickets.query', new URL('Tickets/query/count', this.base), 'POST', canonical({ filter: filters }));
    if (!object(data) || !Number.isSafeInteger(data.queryCount) || (data.queryCount as number) < 0) return failDependency();
    return data.queryCount as number;
  }

  async query(inputPrincipal: Principal, inputRequest: QueryRequest): Promise<Page> {
    const request = structuredClone(inputRequest);
    if (!request || !own(fields, request.entity) || !Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > (request.entity === 'Tickets' ? 500 : 100) || Object.keys(request).some((key) => !['entity', 'filters', 'pageSize', 'cursor', 'parentId'].includes(key))) return failInput();
    if (request.cursor !== undefined && (typeof request.cursor !== 'string' || request.cursor.length === 0)) return failInput();
    const principal = structuredClone(inputPrincipal);
    this.assertIdentity(principal);
    const filters = reviewedFilters(request.entity, request.filters);
    if (request.parentId !== undefined && !positiveId(request.parentId)) return failInput();
    if ((request.entity === 'Tickets' || request.entity === 'Companies') && request.parentId !== undefined) return failInput();
    const queryHash = digest({ entity: request.entity, filters, pageSize: request.pageSize, parentId: request.parentId ?? null, base: this.base.href });
    const cursor = request.cursor ? this.unseal(request.cursor, principal, queryHash) : undefined;
    const operation = `${request.entity}.query` as AutotaskOperation;
    await this.guard(principal, operation);

    if (request.entity === 'TicketNotes') {
      if (!positiveId(request.parentId) || (cursor && !positiveId(cursor.afterId))) return failInput();
      await this.get(principal, 'Tickets', request.parentId);
      // The official child GET has no query or next endpoint. Re-read the bounded
      // collection under current identity, then page by stable IDs locally.
      const data = await this.execute(principal, operation, new URL(`Tickets/${request.parentId}/Notes`, this.base), 'GET');
      const items = this.readItems(data);
      if (items.length >= 500 || (object(data) && object(data.pageDetails) && data.pageDetails.nextPageUrl)) throw new AppError('unsupported_operation', 'This notes collection requires separately qualified root-query pagination.');
      if (items.some((item) => item.ticketID !== request.parentId)) return failDependency();
      const matching = items.filter((item) => this.matches(item, filters) && (!cursor || item.id > cursor.afterId!)).sort((a, b) => a.id - b.id);
      const page = matching.slice(0, request.pageSize);
      return { items: page, fetchedAt: new Date(this.clock()).toISOString(), nextCursor: matching.length > page.length ? this.seal({ version: 1, binding: identityBinding(principal), query: queryHash, expires: this.clock() + this.cursorTtl, afterId: page.at(-1)!.id }) : null };
    }

    if (request.entity === 'TimeEntries') {
      const ticketId = request.parentId ?? filters.find((filter) => filter.field === 'ticketID' && filter.op === 'eq')?.value;
      if (!positiveId(ticketId)) return failInput();
      await this.get(principal, 'Tickets', ticketId);
      filters.push({ field: 'ticketID', op: 'eq', value: ticketId });
      if (!principal.capabilities.includes('time.team')) filters.push({ field: 'resourceID', op: 'eq', value: principal.resourceId });
    } else {
      if (principal.companyIds.length === 0) return { items: [], nextCursor: null, fetchedAt: new Date(this.clock()).toISOString() };
      filters.push({ field: request.entity === 'Companies' ? 'id' : 'companyID', op: 'in', value: principal.companyIds });
    }
    const initial = new URL(`${request.entity}/query`, this.base);
    const url = cursor ? this.continuation(cursor.nextUrl!, initial) : initial;
    const body = canonical({ MaxRecords: request.pageSize, filter: filters });
    const data = await this.execute(principal, operation, url, 'POST', body);
    const items = this.readItems(data, request.entity);
    if (items.length > request.pageSize || items.some((item) => !this.matches(item, filters))) return failDependency();
    if (!object(data) || !object(data.pageDetails) || !own(data.pageDetails, 'nextPageUrl')) return failDependency();
    const rawNext = data.pageDetails.nextPageUrl;
    if (rawNext !== undefined && rawNext !== null && typeof rawNext !== 'string') return failDependency();
    const next = typeof rawNext === 'string' ? this.continuation(rawNext, initial) : undefined;
    if (next && items.length === 0) return failDependency();
    return { items, nextCursor: next ? this.seal({ version: 1, binding: identityBinding(principal), query: queryHash, expires: this.clock() + this.cursorTtl, nextUrl: next.href }) : null, fetchedAt: new Date(this.clock()).toISOString() };
  }

  private readItems(data: unknown, entity?: Entity): DataRecord[] {
    if (!object(data) || !Array.isArray(data.items) || data.items.some((item: unknown) => !object(item) || !(entity === 'Companies' ? validCompanyId(item.id) : positiveId(item.id)))) return failDependency();
    const items = data.items as DataRecord[];
    if (new Set(items.map((item) => item.id)).size !== items.length) return failDependency();
    return items;
  }

  private matches(item: DataRecord, filters: Filter[]): boolean {
    return filters.every((filter) => {
      const actual = item[filter.field];
      if (filter.op === 'eq') return actual === filter.value;
      if (filter.op === 'in') return (filter.value as unknown[]).includes(actual);
      if (filter.op === 'contains') return typeof actual === 'string' && actual.toLowerCase().includes((filter.value as string).toLowerCase());
      if (typeof actual !== 'number' && typeof actual !== 'string') return false;
      const left = typeof actual === 'string' ? Date.parse(actual) : actual;
      const right = typeof filter.value === 'string' ? Date.parse(filter.value) : filter.value as number;
      return filter.op === 'gte' ? left >= right : filter.op === 'lt' ? left < right : left <= right;
    });
  }

  private async workMetadata(principal: Principal, ticketId: number): Promise<TicketWorkMetadata> {
    if (!this.resolveWorkMetadata) return failMetadata();
    // One fresh, scoped parent read per metadata boundary, shared with the provider.
    const ticket = await this.get(principal, 'Tickets', ticketId);
    let value: unknown;
    try { value = await this.resolveWorkMetadata(structuredClone(principal), ticketId, Object.freeze(structuredClone(ticket))); }
    catch (error) { if (error instanceof AppError) throw error; return failMetadata(); }
    if (!object(value) || !keysWithin(value, ['version', 'source', 'ticketId', 'resourceId', 'mappingVersion', 'policyVersion', 'validUntil', 'note', 'time', 'defaultRuleVersion'])
      || value.source !== 'Autotask' || !boundedText(value.version, 256) || !boundedText(value.defaultRuleVersion, 256)
      || value.ticketId !== ticketId || value.resourceId !== principal.resourceId || value.mappingVersion !== principal.mappingVersion
      || value.policyVersion !== principal.policyVersion || typeof value.validUntil !== 'string'
      || !Number.isFinite(Date.parse(value.validUntil)) || Date.parse(value.validUntil) <= this.clock()
      || !object(value.note) || !keysWithin(value.note, ['titleRequired', 'attributionField', 'types', 'audiences', 'defaultTypeId'])
      || typeof value.note.titleRequired !== 'boolean' || !['creatorResourceID', 'impersonatorCreatorResourceID'].includes(String(value.note.attributionField)) || !validOptions(value.note.types)
      || !Array.isArray(value.note.audiences) || value.note.audiences.length > 2
      || !value.note.audiences.every((audience: unknown) => object(audience)
        && keysWithin(audience, ['audience', 'publish', 'label', 'active'])
        && ['internal', 'customer'].includes(String(audience.audience)) && validPublish(audience.publish)
        && boundedText(audience.label, 200) && typeof audience.active === 'boolean')
      || new Set(value.note.audiences.map((audience) => audience.audience)).size !== value.note.audiences.length
      || new Set(value.note.audiences.map((audience) => audience.publish)).size !== value.note.audiences.length
      || !object(value.time) || !keysWithin(value.time, ['eligible', 'roles', 'workTypes', 'defaultRoleId', 'defaultWorkTypeId', 'classification'])
      || typeof value.time.eligible !== 'boolean' || !validOptions(value.time.roles) || !validOptions(value.time.workTypes)) return failMetadata();
    const metadata = value as unknown as TicketWorkMetadata;
    if(metadata.time.classification!==undefined&&(!object(metadata.time.classification)||!keysWithin(metadata.time.classification,['category','queue'])||Object.values(metadata.time.classification).some(v=>v!==undefined&&!boundedText(v,250))))return failMetadata();
    for (const [defaultId, options] of [[metadata.note.defaultTypeId, metadata.note.types], [metadata.time.defaultRoleId, metadata.time.roles], [metadata.time.defaultWorkTypeId, metadata.time.workTypes]] as const) {
      if (defaultId !== undefined && (!positiveId(defaultId) || !options.some((option) => option.id === defaultId && option.active))) return failMetadata();
    }
    return structuredClone(metadata);
  }

  async ticketWorkMetadata(inputPrincipal: Principal, ticketId: number): Promise<TicketWorkMetadata> {
    if (!positiveId(ticketId)) return failInput();
    const principal = structuredClone(inputPrincipal);
    await this.guard(principal, 'Tickets.get');
    if (!this.resolveWorkMetadata) return failMetadata();
    return this.workMetadata(principal, ticketId);
  }

  private eligibleNote(metadata: TicketWorkMetadata, payload: TicketNoteCreate): void {
    if ((metadata.note.titleRequired && !payload.title)
      || !metadata.note.types.some((option) => option.id === payload.noteType && option.active)
      || !metadata.note.audiences.some((option) => option.publish === payload.publish && option.active)) {
      throw new AppError('precondition_failed', 'The note title, type, or audience does not satisfy the current ticket requirements.');
    }
  }

  private eligibleTime(metadata: TicketWorkMetadata, payload: TicketTimeCreate): void {
    if (!metadata.time.eligible || !metadata.time.roles.some((option) => option.id === payload.roleID && option.active)
      || !metadata.time.workTypes.some((option) => option.id === payload.billingCodeID && option.active)) {
      throw new AppError('precondition_failed', 'Time entry, role, or work type is not eligible for this employee and ticket.');
    }
  }

  private async recheckWorkMetadata(principal: Principal, ticketId: number, prior: TicketWorkMetadata, check?: (current: TicketWorkMetadata) => Promise<void>): Promise<() => void> {
    const current = await this.workMetadata(principal, ticketId);
    if (metadataMeaning(current) !== metadataMeaning(prior)) throw new AppError('conflict', 'Ticket-work metadata changed before dispatch. Resolve the current requirements before creating records.');
    if (check) await check(current);
    return () => {
      // The final authoritative identity check may itself wait. Do not dispatch
      // with metadata that expired during that check.
      if (Date.parse(prior.validUntil) <= this.clock() || Date.parse(current.validUntil) <= this.clock()) throw new AppError('conflict', 'Ticket-work metadata expired before dispatch. Resolve the current requirements before creating records.');
    };
  }

  private createdId(data: unknown): { id: number } {
    // A success response without a usable ID can already have created the record.
    if (!object(data) || !positiveId(data.itemId)) throw new AppError('unknown_outcome', 'Autotask accepted a create without a usable record ID. Reconciliation is required before another write.', false, { reason: 'missing_record_id' });
    return { id: data.itemId };
  }

  private async recheckTimeEligibility(principal: Principal, ticketId: number, payload: TicketTimeCreate, metadata: TicketWorkMetadata): Promise<() => void> {
    if (!this.validateTimeEligibility) throw new AppError('missing_metadata', 'A reviewed validator for the proposed work date and time-entry eligibility is required.');
    return this.recheckWorkMetadata(principal, ticketId, metadata, async current => {
      this.eligibleTime(current, payload);
      let eligible: unknown;
      try { eligible = await this.validateTimeEligibility!(structuredClone(principal), ticketId, Object.freeze(structuredClone(payload)), Object.freeze(structuredClone(current))); }
      catch { throw new AppError('dependency_unavailable', 'The proposed time-entry eligibility could not be verified. The create was not dispatched.'); }
      if (eligible !== true) throw new AppError('precondition_failed', 'The proposed work date or time-entry fields are not currently eligible. The create was not dispatched.');
    });
  }

  async createTicket(principal:Principal,payload:Record<string,unknown>,beforeDispatch:()=>Promise<void>):Promise<{id:number}>{
    const allowed=['companyID','title','description','priority','status','queueID','ticketCategory','ticketType','dueDateTime','assignedResourceID','assignedResourceRoleID','billingCodeID','opportunityID','contactID','issueType','subIssueType'];
    if(!payload||Object.keys(payload).some(k=>!allowed.includes(k))||!validCompanyId(payload.companyID)||!principal.companyIds.includes(payload.companyID as number)||typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>255)throw new AppError('invalid_input','Invalid ticket create payload.');
    const data=await this.execute(principal,'Tickets.create',new URL('Tickets',this.base),'POST',canonical(payload),async()=>{await beforeDispatch();return()=>{};});return this.createdId(data);
  }

  async createTicketNote(inputPrincipal: Principal, ticketId: number, inputPayload: TicketNoteCreate): Promise<{ id: number }> {
    if (!positiveId(ticketId)) return failInput();
    validateNotePayload(inputPayload);
    const principal = structuredClone(inputPrincipal), payload = structuredClone(inputPayload);
    await this.guard(principal, 'TicketNotes.create');
    const metadata = await this.ticketWorkMetadata(principal, ticketId);
    this.eligibleNote(metadata, payload);
    const body = canonical({ ticketID: ticketId, description: payload.description, noteType: payload.noteType, publish: payload.publish, ...(payload.title === undefined ? {} : { title: payload.title }) });
    // Primary reference, reviewed 2026-09-10:
    // https://webservices3.autotask.net/ATServicesRest/swagger/docs/v1
    const data = await this.execute(principal, 'TicketNotes.create', new URL(`Tickets/${ticketId}/Notes`, this.base), 'POST', body,
      () => this.recheckWorkMetadata(principal, ticketId, metadata));
    return this.createdId(data);
  }

  async createTicketSecondaryResource(inputPrincipal:Principal,ticketId:number,resourceId:number,roleId:number,beforeDispatch:()=>Promise<void>):Promise<{id:number}>{
    if(!positiveId(ticketId)||!positiveId(resourceId)||!positiveId(roleId))return failInput();
    const principal=structuredClone(inputPrincipal);await this.guard(principal,'TicketSecondaryResources.create');
    const body=canonical({ticketID:ticketId,resourceID:resourceId,roleID:roleId});
    const data=await this.execute(principal,'TicketSecondaryResources.create',new URL(`Tickets/${ticketId}/SecondaryResources`,this.base),'POST',body,async()=>{await beforeDispatch();return()=>{};});
    return this.createdId(data);
  }

  async getTicketSecondaryResource(inputPrincipal:Principal,ticketId:number,id:number):Promise<DataRecord>{
    if(!positiveId(ticketId)||!positiveId(id))return failInput();const principal=structuredClone(inputPrincipal);await this.guard(principal,'TicketSecondaryResources.get');
    const data=await this.execute(principal,'TicketSecondaryResources.get',new URL(`Tickets/${ticketId}/SecondaryResources/${id}`,this.base),'GET');
    if(!object(data)||!object(data.item)||data.item.id!==id||data.item.ticketID!==ticketId)return failDependency();return data.item as DataRecord;
  }

  async deleteTicketSecondaryResource(inputPrincipal:Principal,ticketId:number,id:number,beforeDispatch:()=>Promise<void>):Promise<void>{
    if(!positiveId(ticketId)||!positiveId(id))return failInput();
    const principal=structuredClone(inputPrincipal);await this.guard(principal,'TicketSecondaryResources.delete');
    await this.execute(principal,'TicketSecondaryResources.delete',new URL(`Tickets/${ticketId}/SecondaryResources/${id}`,this.base),'DELETE',undefined,async()=>{await beforeDispatch();return()=>{};});
  }

  async createTicketTagAssociation(inputPrincipal:Principal,ticketId:number,tagId:number,beforeDispatch:()=>Promise<void>):Promise<{id:number}>{
    if(!positiveId(ticketId)||!positiveId(tagId))return failInput();
    const principal=structuredClone(inputPrincipal);await this.guard(principal,'TicketTagAssociations.create');
    const data=await this.execute(principal,'TicketTagAssociations.create',new URL(`Tickets/${ticketId}/TagAssociations`,this.base),'POST',canonical({tagID:tagId,ticketID:ticketId}),async()=>{await beforeDispatch();return()=>{};});
    return this.createdId(data);
  }

  async deleteTicketTagAssociation(inputPrincipal:Principal,ticketId:number,associationId:number,beforeDispatch:()=>Promise<void>):Promise<void>{
    if(!positiveId(ticketId)||!positiveId(associationId))return failInput();
    const principal=structuredClone(inputPrincipal);await this.guard(principal,'TicketTagAssociations.delete');
    await this.execute(principal,'TicketTagAssociations.delete',new URL(`Tickets/${ticketId}/TagAssociations/${associationId}`,this.base),'DELETE',undefined,async()=>{await beforeDispatch();return()=>{};});
  }

  async applyTicketChecklistLibrary(inputPrincipal:Principal,ticketId:number,libraryId:number,beforeDispatch:()=>Promise<void>):Promise<{id:number}>{
    if(!positiveId(ticketId)||!positiveId(libraryId))return failInput();
    const principal=structuredClone(inputPrincipal);await this.guard(principal,'TicketChecklistLibraries.create');
    const data=await this.execute(principal,'TicketChecklistLibraries.create',new URL(`Tickets/${ticketId}/ChecklistLibraries`,this.base),'POST',canonical({checklistLibraryID:libraryId,ticketID:ticketId}),async()=>{await beforeDispatch();return()=>{};});
    return this.createdId(data);
  }

  async getTicketNote(inputPrincipal: Principal, ticketId: number, id: number): Promise<DataRecord> {
    if (!positiveId(ticketId) || !positiveId(id)) return failInput();
    const principal = structuredClone(inputPrincipal);
    await this.guard(principal, 'TicketNotes.get');
    await this.get(principal, 'Tickets', ticketId);
    const data = await this.execute(principal, 'TicketNotes.get', new URL(`Tickets/${ticketId}/Notes/${id}`, this.base), 'GET');
    if (!object(data) || !object(data.item) || data.item.id !== id) return failDependency();
    if (data.item.ticketID !== ticketId) throw new AppError('not_found_or_inaccessible', 'The note was not found or is inaccessible.');
    return data.item as DataRecord;
  }

  private async prepareTicketTime(inputPrincipal: Principal, ticketId: number, inputPayload: TicketTimeCreate, prepared?: TicketWorkMetadata) {
    if (!positiveId(ticketId)) return failInput();
    const principal = structuredClone(inputPrincipal);
    validateTimePayload(inputPayload, principal);
    const payload = structuredClone(inputPayload);
    await this.guard(principal, 'TimeEntries.create');
    if (!this.validateTimeEligibility) throw new AppError('missing_metadata', 'A reviewed validator for the proposed work date and time-entry eligibility is required.');
    const metadata = prepared ? structuredClone(prepared) : await this.ticketWorkMetadata(principal, ticketId);
    this.eligibleTime(metadata, payload);
    return { principal, payload, metadata };
  }

  /** Read-only preflight of this exact date/payload before any related workflow effect. */
  async validateTicketTime(inputPrincipal: Principal, ticketId: number, inputPayload: TicketTimeCreate, prepared?: TicketWorkMetadata): Promise<void> {
    // Reuse resolution metadata only as the comparison baseline. A fresh scoped
    // snapshot and exact-payload validator still run after queue admission.
    const { principal, payload, metadata } = await this.prepareTicketTime(inputPrincipal, ticketId, inputPayload, prepared);
    await requestScheduler.runWithLease(actorKey(principal),this.queueTimeoutMs,async()=>{
      await this.guard(principal, 'TimeEntries.create');
      const validateImmediately = await this.recheckTimeEligibility(principal, ticketId, payload, metadata);
      await this.guard(principal, 'TimeEntries.create');
      validateImmediately();
    });
  }

  async createTicketTime(inputPrincipal: Principal, ticketId: number, inputPayload: TicketTimeCreate): Promise<{ id: number }> {
    const { principal, payload, metadata } = await this.prepareTicketTime(inputPrincipal, ticketId, inputPayload);
    // dateWorked is Autotask's local-date container, not an invented start time.
    const body = canonical({ ticketID: ticketId, resourceID: payload.resourceID, roleID: payload.roleID, billingCodeID: payload.billingCodeID, hoursWorked: payload.hoursWorked, dateWorked: payload.dateWorked, summaryNotes: payload.summaryNotes, ...(payload.startDateTime === undefined ? {} : { startDateTime: payload.startDateTime, endDateTime: payload.endDateTime }), ...(payload.internalNotes === undefined ? {} : { internalNotes: payload.internalNotes }) });
    const data = await this.execute(principal, 'TimeEntries.create', new URL('TimeEntries', this.base), 'POST', body,
      () => this.recheckTimeEligibility(principal, ticketId, payload, metadata));
    return this.createdId(data);
  }

  async getTicketTime(inputPrincipal: Principal, ticketId: number, id: number): Promise<DataRecord> {
    if (!positiveId(ticketId) || !positiveId(id)) return failInput();
    const principal = structuredClone(inputPrincipal);
    await this.guard(principal, 'TimeEntries.get');
    await this.get(principal, 'Tickets', ticketId);
    const data = await this.execute(principal, 'TimeEntries.get', new URL(`TimeEntries/${id}`, this.base), 'GET');
    if (!object(data) || !object(data.item) || data.item.id !== id) return failDependency();
    if (data.item.ticketID !== ticketId || data.item.resourceID !== principal.resourceId) throw new AppError('not_found_or_inaccessible', 'The time entry was not found or is inaccessible.');
    return data.item as DataRecord;
  }

  async patchTicket(inputPrincipal: Principal, id: number, changes: Record<string, unknown>): Promise<void> {
    if (!positiveId(id) || !object(changes) || Object.keys(changes).length === 0) return failInput();
    for (const [field, value] of Object.entries(changes)) {
      if (!own(patchFields, field) || !validValue(value, patchFields[field]!) || (field === 'title' && (typeof value !== 'string' || !value.trim() || value.length > 255))) return failInput();
    }
    const principal = structuredClone(inputPrincipal);
    const body = canonical({ ...structuredClone(changes), id });
    await this.guard(principal, 'Tickets.patch');
    await this.get(principal, 'Tickets', id);
    await this.execute(principal, 'Tickets.patch', new URL('Tickets', this.base), 'PATCH', body);
  }
}
