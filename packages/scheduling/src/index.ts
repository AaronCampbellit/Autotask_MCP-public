import {withReconciliation} from '../../execution/src/index.js';
import {assertPersonIdentity} from '../../contracts/src/person-identity.js';
import { assertArea } from '../../policy/src/areas.js';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, type JournalRecord, type OperationState, type Principal } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, reauthorize } from '../../policy/src/index.js';
import { IntentCipher } from '../../storage/src/intent-cipher.js';
import { TicketWorkflows } from '../../workflows/src/index.js';
import { interval, resolveResources, reviewedMetadata, reviewedResources, sameInstant, scheduleSearchSchema, schedulingResumeSchema, schedulingWarning, serviceCallCancelSchema, serviceCallCreateSchema, serviceCallUpdateSchema, type SchedulingPort, type ServiceCallCreatePayload, type ServiceCallRecord, type ServiceCallUpdatePayload } from './contracts.js';
export { scheduleSearchSchema, serviceCallCancelSchema, serviceCallCreateSchema, serviceCallUpdateSchema, schedulingResumeSchema } from './contracts.js';

interface Intent { version: 1; input: z.infer<typeof serviceCallCreateSchema>; ticketId: number; companyId: number; resourceIds: number[]; payload: ServiceCallCreatePayload; metadataVersion: string; attributionField: 'creatorResourceID' | 'impersonatorCreatorResourceID' }
interface Step { key: string; operation_id: string; state: OperationState; attempt: number; native_id?: number; resource_id?: number }
const rootName = 'service_call_create';
const childName = (key: string) => key === 'call' ? 'service_call_create_call' : key === 'ticket' ? 'service_call_create_ticket' : 'service_call_create_resource';
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const definitive = new Set(['invalid_input', 'forbidden', 'not_found_or_inaccessible', 'unsupported_operation', 'missing_metadata', 'precondition_failed', 'conflict', 'throttled', 'identity_mapping_invalid', 'identity_validation_unavailable', 'impersonation_not_qualified']);
const notFound = () => new AppError('not_found_or_inaccessible', 'Scheduling operation not found or inaccessible.');

/** A fixed parent -> ticket -> resources workflow; no caller-provided executable graph. */
export class SchedulingWorkflows {
  private readonly cursorKey = randomBytes(32);
  constructor(private readonly core: TicketWorkflows, readonly port: SchedulingPort, private readonly cipher: IntentCipher, private readonly now: () => number = Date.now, private readonly identityMaxAgeMs = 300_000) {}
  private get journal() { return this.core.journal; }
  private async current(p: Principal, write = false) {
    const fresh = await reauthorize(p, this.core.principals, { resourceMaxAgeMs: this.identityMaxAgeMs });
    assertCapability(fresh, 'operational.read'); assertArea(fresh, 'scheduling', write);
    if (write && !(fresh.capabilities as string[]).includes('scheduling.write')) throw new AppError('forbidden', 'Scheduling write permission is required.');
    return fresh;
  }
  private binding(p: Principal, key: string, payloadHash: string) { return `${actorKey(p)}|scheduling|${key}|${payloadHash}`; }
  private scope(p: Principal) { return hash([actorKey(p), p.resourceId, p.mappingVersion, p.policyVersion, [...p.companyIds].sort(), [...p.capabilities].sort()]); }
  private sealCursor(value: object) { const body = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${body}.${createHmac('sha256', this.cursorKey).update(body).digest('base64url')}`; }
  private cursor(value: string, binding: string): number {
    try {
      const [body, signature] = value.split('.');
      const actual = Buffer.from(signature!, 'base64url'), expected = createHmac('sha256', this.cursorKey).update(body!).digest();
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
      const parsed = JSON.parse(Buffer.from(body!, 'base64url').toString());
      if (parsed.binding !== binding || parsed.expires <= this.now() || !Number.isSafeInteger(parsed.after) || parsed.after <= 0) throw new Error();
      return parsed.after;
    } catch { throw new AppError('invalid_input', 'The schedule cursor is invalid, expired, or belongs to another scope.'); }
  }
  async search(principal: Principal, input: unknown) {
    const args = scheduleSearchSchema.parse(input), p = await this.current(principal);
    const window = interval({ start: args.start, end: args.end, timezone: args.timezone });
    const ticket = args.ticket ? await this.core.resolveTicket(p, args.ticket) : undefined;
    const directory = reviewedResources(await this.port.resources(p), p);
    const resources = resolveResources(args.resources, directory, p);
    const query = { start: window.start, end: window.end, resourceIds: resources.map((row) => row.id), ...(ticket ? { ticketId: ticket.id } : {}) };
    const binding = hash([this.scope(p), query, args.page_size]), after = args.cursor ? this.cursor(args.cursor, binding) : 0;
    const page = await this.port.search(p, query);
    await this.current(p);
    const all = page.items.filter((row) => row.id > after).sort((a, b) => a.id - b.id), rows = all.slice(0, args.page_size);
    for (const row of rows) assertCompanyScope(p, row.company_id);
    const cursor = all.length > rows.length ? this.sealCursor({ binding, after: rows.at(-1)!.id, expires: this.now() + 300_000 }) : null;
    return { status: page.complete && !cursor ? 'succeeded' : 'partial', correlation_id: randomUUID(), data: { entries: rows, window, resources: resources.map(({ id, label }) => ({ id, label })), scope: 'Authorized schedule records for the requested resources and interval.' },
      completeness: { complete: page.complete && !cursor, returned: rows.length, next_cursor: cursor }, provenance: { source: this.port.source, fetched_at: page.fetchedAt, atomic_snapshot: false },
      warnings: [...page.warnings, schedulingWarning, ...(this.port.source === 'fixture' ? ['Fictitious development data. No Autotask connection.'] : [])] };
  }
  private async prepare(p: Principal, input: z.infer<typeof serviceCallCreateSchema>, excludeCallId?: number): Promise<Intent> {
    p = await this.current(p, true);
    const ticket = await this.core.resolveTicket(p, input.ticket), companyId = ticket.companyID as number;
    const metadata = reviewedMetadata(await this.port.metadata(p, ticket.id), p, ticket.id, companyId, this.port.source, this.now());
    const directory = reviewedResources(await this.port.resources(p), p);
    const resources = resolveResources(input.resources, directory, p, metadata.ticketResourceIds);
    input.resources.forEach((ref,index)=>{if(ref.kind==='id')assertPersonIdentity(ref.name?{name:ref.name}:undefined,{name:resources[index]?.label},'scheduled resource');});
    if (resources.some((row) => !row.companyIds.includes(companyId))) throw new AppError('precondition_failed', 'Every requested resource must be eligible for the ticket company.');
    const statusLabel = typeof input.status === 'string' ? input.status : undefined;
    const choices = statusLabel ? metadata.statuses.filter((row) => row.label.toLocaleLowerCase('en-US') === statusLabel.toLocaleLowerCase('en-US')) : metadata.statuses.filter((row) => row.id === metadata.defaultStatusId);
    if (choices.length !== 1 || !choices[0]!.active || !choices[0]!.bookable) throw new AppError('missing_metadata', 'Supply one unambiguous active service-call status or configure a reviewed scheduling default.');
    const window = interval({ start: input.start, end: input.end, timezone: input.timezone }, 1), resourceIds = resources.map((row) => row.id);
    if (input.overlap === 'allow' && !metadata.allowOverlap) throw new AppError('precondition_failed', 'The reviewed scheduling policy does not permit overlapping appointments.');
    const schedule = await this.port.search(p, { start: window.start, end: window.end, resourceIds });
    if (!schedule.complete) throw new AppError('dependency_unavailable', 'The authorized schedule window is incomplete. Complete the overlap check before creating an appointment.');
    const overlaps = schedule.items.filter((row) => row.id !== excludeCallId && !row.complete && row.resource_ids.some((id) => resourceIds.includes(id)) && Date.parse(row.start) < Date.parse(window.end) && Date.parse(row.end) > Date.parse(window.start));
    if (overlaps.length && input.overlap !== 'allow') throw new AppError('precondition_failed', 'An authorized existing appointment overlaps a requested resource. Use schedule_search to review the interval.');
    return { version: 1, input, ticketId: ticket.id, companyId, resourceIds, metadataVersion: metadata.version, attributionField: metadata.attributionField,
      payload: { companyID: companyId, startDateTime: window.start, endDateTime: window.end, status: choices[0]!.id, ...(input.description === undefined ? {} : { description: input.description }) } };
  }
  async validate(principal:Principal,input:unknown){const args=serviceCallCreateSchema.parse(input),p=await this.current(principal,true),prepared=await this.prepare(p,args);return{valid:true,validation:'current_preflight',ticket_id:prepared.ticketId,metadata_version:prepared.metadataVersion,effects:'none',execution_authorized:false,recheck_required:true};}
  private async simpleMutation(p: Principal, operation: 'service_call_update'|'service_call_cancel', key: string, input: Record<string, unknown>, dispatch: () => Promise<{ id: number }>, verify: (row: ServiceCallRecord) => boolean) {
    p = await this.current(p, true);
    const digest = hash({ operation, input, actor: actorKey(p), mapping: p.mappingVersion, policy: p.policyVersion });
    const prior = await this.journal.find(actorKey(p), key);
    if (prior) { if (prior.payloadHash !== digest || prior.operation !== operation) throw new AppError('conflict', 'The request key belongs to different scheduling work.'); return this.receipt(p, prior); }
    const id = Number(input.id); if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('invalid_input', 'A positive service-call ID is required.');
    const before = await this.port.getCall(p, id); assertCompanyScope(p, before.companyID);
    const reservation = await this.journal.reserve({ actorKey: actorKey(p), requestKey: key, payloadHash: digest, operation, mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion, encryptedIntent: this.cipher.seal({ version: 1, operation, id, input }, this.binding(p, key, digest)), intentExpiresAt: new Date(this.now() + 7 * 86_400_000).toISOString(), result: { service_call_id: id, company_id: before.companyID } });
    if (!reservation.created) return this.receipt(p, reservation.record);
    let record = reservation.record;
    try {
      const fresh = await this.port.getCall(p, id); if (fresh.companyID !== before.companyID || !this.expectedCall(fresh, input)) throw new AppError('conflict', 'The service call changed before dispatch.');
      record = await this.journal.transition(record.id, 'ready', 'dispatching');
      const saved = await dispatch();
      if (saved.id !== id) throw new AppError('unknown_outcome', 'The service-call mutation returned a mismatched ID.');
      record = await this.journal.transition(record.id, 'dispatching', 'accepted_unverified', { ...record.result, service_call_id: id });
      const row = await withReconciliation(()=>this.port.getCall(p, id));
      if (!verify(row)) return withReconciliation(()=>this.receipt(p, record));
      record = await this.journal.transition(record.id, 'accepted_unverified', 'succeeded_verified', { ...record.result, service_call_id: id, verification: { performed: true } });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'dependency_unavailable'; const definitive = error instanceof AppError && ['invalid_input','forbidden','not_found_or_inaccessible','conflict','precondition_failed','throttled','missing_metadata'].includes(code);
      try { record = await this.journal.transition(record.id, record.state, definitive ? 'failed' : record.state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome', { ...record.result, error_code: code }); } catch { /* retain durable state */ }
    }
    return withReconciliation(()=>this.receipt(p, record));
  }
  private expectedCall(row: ServiceCallRecord, input: Record<string, unknown>) {
    const expected = input.expected as Record<string, unknown> | undefined; if (!expected) return true;
    return Object.entries(expected).every(([key, value]) => key === 'startDateTime' ? sameInstant(row.startDateTime, String(value)) : key === 'endDateTime' ? sameInstant(row.endDateTime, String(value)) : key === 'expected_status' ? row.status === value : row[key] === value);
  }
  private updatedCall(row: ServiceCallRecord, input: Record<string, unknown>) {
    if (input.startDateTime !== undefined && !sameInstant(row.startDateTime, String(input.startDateTime))) return false;
    if (input.endDateTime !== undefined && !sameInstant(row.endDateTime, String(input.endDateTime))) return false;
    if (input.status !== undefined && row.status !== input.status) return false;
    if (input.description !== undefined && row.description !== input.description) return false;
    return true;
  }
  async update(principal: Principal, input: unknown) {
    const args = serviceCallUpdateSchema.parse(input), p = await this.current(principal, true), port = this.port.updateCall;
    if (!port) throw new AppError('unsupported_operation', 'Service-call update is unavailable for this connection.');
    const window = args.start === undefined ? undefined : interval({ start: args.start, end: args.end!, timezone: args.timezone! }, 1);
    if (typeof args.status === 'string') throw new AppError('missing_metadata', 'Service-call status labels require a reviewed status ID; supply the current numeric status ID.');
    const inputRecord: Record<string, unknown> = { ...args, id: args.id, ...(window ? { startDateTime: window.start, endDateTime: window.end } : {}), ...(args.status === undefined ? {} : { status: args.status }) };
    const payload: ServiceCallUpdatePayload = { id: args.id, ...(window ? { startDateTime: window.start, endDateTime: window.end } : {}), ...(args.status === undefined ? {} : { status: args.status }), ...(args.description === undefined ? {} : { description: args.description }), expected: { ...(args.expected.start ? { startDateTime: new Date(args.expected.start).toISOString() } : {}), ...(args.expected.end ? { endDateTime: new Date(args.expected.end).toISOString() } : {}), ...(args.expected.status === undefined ? {} : { status: args.expected.status }), ...(args.expected.description === undefined ? {} : { description: args.expected.description }) } };
    return this.simpleMutation(p, 'service_call_update', args.request_key, inputRecord, () => port.call(this.port, p, args.id, payload), row => this.updatedCall(row, inputRecord));
  }
  async cancel(principal: Principal, input: unknown) {
    const args = serviceCallCancelSchema.parse(input), p = await this.current(principal, true), port = this.port.cancelCall;
    if (!port) throw new AppError('unsupported_operation', 'Service-call cancellation is unavailable for this connection.');
    return this.simpleMutation(p, 'service_call_cancel', args.request_key, { id: args.id, expected_status: args.expected_status, cancel_status: args.cancel_status }, () => port.call(this.port, p, args.id, args.expected_status, args.cancel_status), row => row.status === args.cancel_status && (row.isComplete === 1 || row.isComplete === true));
  }
  private async frozen(p: Principal, intent: Intent, callId?: number) {
    const current = await this.prepare(p, intent.input, callId);
    if (canonical(current) !== canonical(intent)) throw new AppError('precondition_failed', 'The original scheduling eligibility or resolved inputs changed. Remaining records will not be substituted.');
  }
  private rootData(intent: Intent, steps: Step[] = []) {
    return { ticket_id: intent.ticketId, status_id: intent.payload.status, metadata_version: intent.metadataVersion, resource_ids: intent.resourceIds, start: intent.payload.startDateTime, end: intent.payload.endDateTime, timezone: intent.input.timezone, scheduling_steps: steps,
      ...(steps.find((step) => step.key === 'call')?.native_id ? { service_call_id: steps.find((step) => step.key === 'call')!.native_id } : {}),
      ...(steps.find((step) => step.key === 'ticket')?.native_id ? { service_call_ticket_id: steps.find((step) => step.key === 'ticket')!.native_id } : {}) };
  }
  private async reserveStep(p: Principal, root: JournalRecord, key: string, attempt: number, intent: Intent, resourceId?: number): Promise<Step> {
    const reserved = await this.journal.reserve({ actorKey: actorKey(p), requestKey: `sch:${root.id}:${key}:${attempt}`, payloadHash: hash([root.payloadHash, key, attempt]), operation: childName(key), mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion, result: { ticket_id: intent.ticketId } });
    return { key, operation_id: reserved.record.id, state: reserved.record.state, attempt, ...(resourceId ? { resource_id: resourceId } : {}) };
  }
  async create(principal: Principal, input: unknown) {
    const args = serviceCallCreateSchema.parse(input), p = await this.current(principal, true);
    const { request_key, ...businessInput } = args, payloadHash = hash([this.scope(p), businessInput]);
    const prior = await this.journal.find(actorKey(p), request_key);
    if (prior) {
      if (prior.operation !== rootName || prior.payloadHash !== payloadHash || prior.mappingVersion !== p.mappingVersion || prior.resourceId !== p.resourceId || prior.policyVersion !== p.policyVersion) throw new AppError('conflict', 'This request key belongs to different work or an earlier identity/policy.');
      return this.status(p, { operation_id: prior.id });
    }
    const intent = await this.prepare(p, args);
    const reservation = await this.journal.reserve({ actorKey: actorKey(p), requestKey: request_key, payloadHash, operation: rootName, mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion, encryptedIntent: this.cipher.seal(intent, this.binding(p, request_key, payloadHash)), intentExpiresAt: new Date(this.now() + 7 * 86_400_000).toISOString(), result: this.rootData(intent) });
    if (!reservation.created) return this.status(p, { operation_id: reservation.record.id });
    let root = reservation.record;
    try {
      const steps = [await this.reserveStep(p, root, 'call', 1, intent), await this.reserveStep(p, root, 'ticket', 1, intent)];
      for (const resourceId of intent.resourceIds) steps.push(await this.reserveStep(p, root, `resource_${resourceId}`, 1, intent, resourceId));
      await this.frozen(p, intent);
      root = await this.journal.transition(root.id, 'ready', 'dispatching', this.rootData(intent, steps));
      return this.run(p, root, intent, steps);
    } catch (error) {
      try { root = await this.journal.transition(root.id, 'ready', 'failed', { ...root.result, error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); }
      catch { root = (await this.journal.get(root.id, actorKey(p))) ?? root; }
      return this.receipt(p, root);
    }
  }
  private async proof(p: Principal, intent: Intent, step: Step, steps: Step[]): Promise<boolean> {
    if (!step.native_id) return false;
    await this.current(p); await this.core.resolveTicket(p, { kind: 'id', id: intent.ticketId });
    if (step.key === 'call') {
      const record = await this.port.getCall(p, step.native_id);
      return record.id === step.native_id && record.companyID === intent.companyId && sameInstant(record.startDateTime, intent.payload.startDateTime) && sameInstant(record.endDateTime, intent.payload.endDateTime) && record.status === intent.payload.status && (intent.payload.description === undefined || record.description === intent.payload.description) && record[intent.attributionField] === p.resourceId;
    }
    const callId = steps.find((item) => item.key === 'call')?.native_id;
    if (!callId) return false;
    if (step.key === 'ticket') { const row = await this.port.getTicket(p, callId, step.native_id); return row.id === step.native_id && row.serviceCallID === callId && row.ticketID === intent.ticketId; }
    const ticketId = steps.find((item) => item.key === 'ticket')?.native_id;
    if (!ticketId) return false;
    const row = await this.port.getResource(p, ticketId, step.native_id);
    return row.id === step.native_id && row.serviceCallTicketID === ticketId && row.resourceID === step.resource_id;
  }
  private async executeStep(p: Principal, root: JournalRecord, intent: Intent, step: Step, steps: Step[]): Promise<Step> {
    let record = await this.journal.get(step.operation_id, actorKey(p)); if (!record) throw notFound();
    if (record.state !== 'ready') return { ...step, state: record.state };
    let accepted = false;
    try {
      await this.frozen(p, intent, steps.find((item) => item.key === 'call')?.native_id);
      record = await this.journal.transition(record.id, 'ready', 'dispatching', this.rootData(intent, [step]));
      const callId = steps.find((item) => item.key === 'call')?.native_id, ticketId = steps.find((item) => item.key === 'ticket')?.native_id;
      const saved = step.key === 'call' ? await this.port.createCall(p, intent.ticketId, intent.payload) : step.key === 'ticket' ? await this.port.createTicket(p, callId!, intent.ticketId) : await this.port.createResource(p, ticketId!, step.resource_id!);
      accepted = true; step = { ...step, native_id: saved.id, state: 'accepted_unverified' };
      record = await this.journal.transition(record.id, 'dispatching', 'accepted_unverified', this.rootData(intent, [step]));
      if (await withReconciliation(()=>this.proof(p, intent, step, steps))) { step.state = 'succeeded_verified'; record = await this.journal.transition(record.id, 'accepted_unverified', 'succeeded_verified', this.rootData(intent, [step])); }
      return { ...step, state: record.state };
    } catch (error) {
      const state: OperationState = !accepted && (record.state === 'ready' || (error instanceof AppError && definitive.has(error.code))) ? 'failed' : accepted && record.state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome';
      step = { ...step, state };
      try { if (record.state !== state) record = await this.journal.transition(record.id, record.state, state, { ...this.rootData(intent, [step]), error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); }
      catch { record = (await this.journal.get(record.id, actorKey(p))) ?? { ...record, state: 'unknown_outcome' }; }
      return { ...step, state: record.state };
    }
  }
  private async run(p: Principal, root: JournalRecord, intent: Intent, steps: Step[]) {
    try {
      for (let index = 0; index < steps.length; index++) {
        let step = steps[index]!;
        if (step.state === 'succeeded_verified') {
          if (!(await this.proof(p, intent, step, steps))) throw new AppError('precondition_failed', 'A previously saved scheduling record no longer matches the original intent.');
          continue;
        }
        if (step.state === 'failed') { step = await this.reserveStep(p, root, step.key, step.attempt + 1, intent, step.resource_id); steps[index] = step; root = await this.journal.transition(root.id, 'dispatching', 'dispatching', this.rootData(intent, steps)); }
        if (step.state !== 'ready') throw new AppError('unknown_outcome', 'A scheduling step needs reconciliation before another create.');
        steps[index] = await this.executeStep(p, root, intent, step, steps);
        root = await this.journal.transition(root.id, 'dispatching', 'dispatching', this.rootData(intent, steps));
        if (steps[index]!.state !== 'succeeded_verified') {
          const state = steps[index]!.state === 'failed' ? 'partial' : steps[index]!.state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome';
          root = await this.journal.transition(root.id, 'dispatching', state, this.rootData(intent, steps));
          return withReconciliation(()=>this.receipt(p, root));
        }
      }
      root = await this.journal.transition(root.id, 'dispatching', 'succeeded_verified', this.rootData(intent, steps));
    } catch (error) {
      try { root = await this.journal.transition(root.id, 'dispatching', 'unknown_outcome', { ...this.rootData(intent, steps), error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); }
      catch { root = (await this.journal.get(root.id, actorKey(p))) ?? { ...root, state: 'unknown_outcome' }; }
    }
    return withReconciliation(()=>this.receipt(p, root));
  }
  private async scoped(p: Principal, id: string) {
    const root = await this.journal.get(id, actorKey(p)); if (!root || ![rootName, 'service_call_update', 'service_call_cancel'].includes(root.operation)) throw notFound();
    if (root.mappingVersion !== p.mappingVersion || root.resourceId !== p.resourceId) throw new AppError('conflict', 'The employee mapping changed since this appointment request.');
    if (root.operation === rootName) { if (typeof root.result?.ticket_id !== 'number') throw notFound(); await this.core.resolveTicket(p, { kind: 'id', id: root.result.ticket_id }); }
    else if (typeof root.result?.company_id === 'number') assertCompanyScope(p, root.result.company_id);
    return root;
  }
  private intent(p: Principal, root: JournalRecord): Intent {
    if (!root.encryptedIntent || !root.intentExpiresAt || Date.parse(root.intentExpiresAt) <= this.now()) throw new AppError('conflict', 'Saved scheduling inputs expired or are unavailable. Do not recreate recorded effects.');
    const value = this.cipher.open(root.encryptedIntent, this.binding(p, root.requestKey, root.payloadHash)) as Intent;
    const parsed = serviceCallCreateSchema.safeParse(value?.input);
    if (!parsed.success || value.version !== 1 || value.ticketId !== root.result?.ticket_id) throw new AppError('conflict', 'Saved scheduling inputs are invalid.');
    const { request_key: _key, ...businessInput } = parsed.data;
    if (hash([this.scope(p), businessInput]) !== root.payloadHash) throw new AppError('conflict', 'The original scheduling inputs or policy no longer match.');
    return value;
  }
  private async steps(p: Principal, root: JournalRecord): Promise<Step[]> {
    const stored = root.result?.scheduling_steps;
    if (!Array.isArray(stored)) return [];
    const output: Step[] = [];
    for (const step of stored as Step[]) {
      const child = await this.journal.get(step.operation_id, actorKey(p));
      if (!child || child.operation !== childName(step.key) || child.mappingVersion !== root.mappingVersion || child.resourceId !== root.resourceId || child.policyVersion !== root.policyVersion) throw notFound();
      const saved = (child.result?.scheduling_steps as Step[] | undefined)?.find((row) => row.key === step.key);
      output.push({ ...step, state: child.state, ...(saved?.native_id ? { native_id: saved.native_id } : {}) });
    }
    return output;
  }
  async status(principal: Principal, input: unknown) { const args = schedulingResumeSchema.parse(input), p = await this.current(principal); return this.receipt(p, await this.scoped(p, args.operation_id)); }
  async resume(principal: Principal, input: unknown) {
    const args = schedulingResumeSchema.parse(input), p = await this.current(principal, true); let root = await this.scoped(p, args.operation_id);
    if (root.state !== 'partial' || root.policyVersion !== p.policyVersion) throw new AppError('conflict', 'Only the original policy and a definitively incomplete scheduling operation can resume.');
    const intent = this.intent(p, root), steps = await this.steps(p, root);
    if (!steps.length || steps.some((step) => !['ready', 'failed', 'succeeded_verified'].includes(step.state) || (step.state === 'failed' && step.attempt >= 10))) throw new AppError('conflict', 'The scheduling operation is uncertain or reached its retry limit.');
    await this.frozen(p, intent, steps.find((step) => step.key === 'call')?.native_id);
    root = await this.journal.transition(root.id, 'partial', 'dispatching', this.rootData(intent, steps));
    return this.run(p, root, intent, steps);
  }
  async reconcile(principal: Principal, input: unknown) {
    const args = schedulingResumeSchema.parse(input), p = await this.current(principal); let root = await this.scoped(p, args.operation_id);
    if (root.operation !== rootName) return this.receipt(p, root);
    if (!['unknown_outcome', 'accepted_unverified'].includes(root.state)) return this.receipt(p, root);
    const intent = this.intent(p, root), steps = await this.steps(p, root);
    if (!steps.length) return this.receipt(p, root);
    for (const step of steps) {
      if (step.state === 'ready' || step.state === 'failed') break;
      if (step.state === 'dispatching' || !step.native_id || !(await this.proof(p, intent, step, steps))) return this.receipt(p, root);
      if (step.state !== 'succeeded_verified') {
        await this.journal.transition(step.operation_id, step.state, 'succeeded_verified', this.rootData(intent, [{ ...step, state: 'succeeded_verified' }]));
        step.state = 'succeeded_verified';
      }
    }
    const allSaved = steps.every((step) => step.state === 'succeeded_verified'), safeRemainder = steps.every((step) => ['succeeded_verified', 'ready', 'failed'].includes(step.state));
    if (allSaved || safeRemainder) root = await this.journal.transition(root.id, root.state, allSaved ? 'succeeded_verified' : 'partial', this.rootData(intent, steps));
    return this.receipt(p, root);
  }
  private async receipt(p: Principal, root: JournalRecord) {
    p = await this.current(p); await this.scoped(p, root.id);
    const steps = await this.steps(p, root), allSaved = steps.length > 0 && steps.every((step) => step.state === 'succeeded_verified');
    const pending = steps.filter((step) => step.state !== 'succeeded_verified');
    const canResume = root.state === 'partial' && root.policyVersion === p.policyVersion && (p.capabilities as string[]).includes('scheduling.write') && Boolean(root.encryptedIntent && root.intentExpiresAt && Date.parse(root.intentExpiresAt) > this.now()) && steps.length > 0 && pending.every((step) => step.state === 'ready' || (step.state === 'failed' && step.attempt < 10));
    const receipt = allSaved ? root.state === 'succeeded_verified' ? 'The service call, ticket association and requested resources were saved and verified.' : 'All scheduling records were saved and verified. The workflow journal still needs reconciliation; do not recreate the appointment.' : steps.some((step) => step.state === 'succeeded_verified') ? 'Some scheduling records were saved and verified. Review the per-step outcomes before completing the remaining associations; do not recreate saved records.' : steps.some((step) => step.native_id) ? 'Autotask returned scheduling record IDs, but the requested records could not be verified. Reconcile those IDs before any further create.' : ['unknown_outcome', 'dispatching', 'accepted_unverified'].includes(root.state) ? 'A scheduling action may have reached Autotask. Reconcile recorded IDs before any further create.' : 'No scheduling records are verified. Review the failed or undispatched steps.';
    const data: Record<string, unknown> & { scheduling_steps: Step[] } = { ...root.result, scheduling_steps: steps };
    return { status: root.state, operation_id: root.id, correlation_id: randomUUID(), data, receipt, can_resume: canResume, safe_to_redispatch: false,
      needs_manual_review: !canResume && pending.some((step) => ['unknown_outcome', 'dispatching', 'accepted_unverified'].includes(step.state)), provenance: { source: this.port.source, schema_version: 'scheduling-v1' }, warnings: [schedulingWarning, ...(this.port.source === 'fixture' ? ['Fictitious development data. No Autotask connection.'] : [])] };
  }
}
