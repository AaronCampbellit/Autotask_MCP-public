import {withReconciliation} from '../../execution/src/index.js';
import {verificationEvidence} from '../../diagnostics/src/evidence.js';
import { assertArea } from '../../policy/src/areas.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, positiveId, type JournalRecord, type OperationState, type Principal, type TicketWorkMetadata } from '../../contracts/src/index.js';
import { assertCapability, reauthorize } from '../../policy/src/index.js';
import { IntentCipher } from '../../storage/src/intent-cipher.js';
import { redactJournalResult } from '../../storage/src/index.js';
import { assertWorkMetadata, noteInputSchema, resolveNote, resolveTime, timeInputSchema, type ResolvedNote, type ResolvedTime } from '../../resolution/src/index.js';
import { ticketReferenceSchema, TicketWorkflows } from './index.js';

const requestKey = z.string().min(8).max(128).refine(value => !/^(wf:|sch:)/.test(value), 'This request-key prefix is reserved for workflow steps.');
export const noteAddSchema = z.object({ ticket: ticketReferenceSchema, note: noteInputSchema, request_key: requestKey }).strict();
export const timeLogSchema = z.object({ ticket: ticketReferenceSchema, time: timeInputSchema, request_key: requestKey }).strict();
export const documentWorkSchema = z.object({ ticket: ticketReferenceSchema, note: noteInputSchema, time: timeInputSchema, request_key: requestKey }).strict();
export const resumeSchema = z.object({ operation_id: z.string().uuid() }).strict();
type Kind = 'note' | 'time' | 'document';
type Inputs = { note?: z.infer<typeof noteInputSchema>; time?: z.infer<typeof timeInputSchema> };
interface Intent {
  schemaVersion: 1;
  kind: Kind;
  ticketId: number;
  input: Inputs;
  metadataVersion: string;
  defaultRuleVersion: string;
  attributionField: TicketWorkMetadata['note']['attributionField'];
  note?: ResolvedNote;
  time?: ResolvedTime;
}
interface Step { operation_id: string; state: OperationState; attempt: number; native_id?: number }
interface Steps { note?: Step; time?: Step }
const names = { note: 'ticket_note_add', time: 'time_log_ticket', document: 'ticket_document_work' } as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter(k => (value as any)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const rejectedCodes = new Set(['invalid_input','forbidden','not_found_or_inaccessible','unsupported_operation','missing_metadata','precondition_failed','conflict','throttled','identity_mapping_invalid','identity_validation_unavailable','impersonation_not_qualified']);
const notFound = () => new AppError('not_found_or_inaccessible', 'Operation not found or inaccessible.');

/** Fixed note/time workflow; callers cannot supply steps, routes, identities or execution graphs. */
export class TicketWriteWorkflows {
  constructor(private readonly core: TicketWorkflows, private readonly cipher: IntentCipher, private readonly now: () => number = Date.now, private readonly identityMaxAgeMs = 300_000) {}
  private get journal() { return this.core.journal; }
  private async current(p: Principal) { return reauthorize(p, this.core.principals, { resourceMaxAgeMs: this.identityMaxAgeMs }); }
  private authorize(p: Principal, kind: Kind) {
    assertArea(p,'tickets',kind!=='time');
    if(kind!=='note')assertArea(p,'time',true);
    assertCapability(p, 'operational.read');
    if (kind !== 'time') assertCapability(p, 'tickets.write');
    if (kind !== 'note') assertCapability(p, 'time.self');
  }
  private keyHash(p: Principal, kind: Kind, ticketId: number, input: Inputs) {
    return hash({ definition: `${names[kind]}:1`, actor: actorKey(p), resource: p.resourceId, mapping: p.mappingVersion, policy: p.policyVersion, ticketId, input });
  }
  private binding(p: Principal, key: string, payloadHash: string) { return `${actorKey(p)}|${key}|${payloadHash}`; }
  private async prior(p: Principal, kind: Kind, key: string, payloadHash: string) {
    const existing = await this.journal.find(actorKey(p), key);
    if (existing && (existing.payloadHash !== payloadHash || existing.operation !== names[kind] || existing.mappingVersion !== p.mappingVersion || existing.resourceId !== p.resourceId || existing.policyVersion !== p.policyVersion)) throw new AppError('conflict', 'The request key belongs to different work or an earlier identity/policy.');
    return existing;
  }
  private async prepare(p: Principal, kind: Kind, ticketId: number, input: Inputs): Promise<Intent> {
    const fresh = await this.current(p); this.authorize(fresh, kind);
    // ticketWorkMetadata performs the scoped parent read.
    const metadata = await this.core.adapter.ticketWorkMetadata(fresh, ticketId);
    assertWorkMetadata(metadata, fresh, ticketId, this.core.adapter.source, this.now());
    const intent: Intent = { schemaVersion: 1, kind, ticketId, input, metadataVersion: metadata.version, defaultRuleVersion: metadata.defaultRuleVersion, attributionField: metadata.note.attributionField,
      ...(kind !== 'time' ? { note: resolveNote(input.note, metadata) } : {}),
      ...(kind !== 'note' ? { time: resolveTime(input.time, metadata) } : {}) };
    if (intent.time) await this.core.adapter.validateTicketTime(fresh, ticketId, intent.time.payload, metadata);
    return intent;
  }
  private async validateFrozen(p: Principal, intent: Intent, kind = intent.kind) {
    const current = await this.prepare(p, kind, intent.ticketId, intent.input);
    if (current.metadataVersion !== intent.metadataVersion || current.defaultRuleVersion !== intent.defaultRuleVersion || current.attributionField !== intent.attributionField || (kind !== 'time' && canonical(current.note) !== canonical(intent.note)) || (kind !== 'note' && canonical(current.time) !== canonical(intent.time))) throw new AppError('precondition_failed', 'The original metadata, eligibility or selected defaults changed. The saved work will not be substituted or repeated.');
  }
  async validate(principal: Principal, kind: 'note'|'time'|'document', input: unknown) {
    const args = kind === 'note' ? noteAddSchema.parse(input) : kind === 'time' ? timeLogSchema.parse(input) : documentWorkSchema.parse(input);
    const p = await this.current(principal); this.authorize(p,kind);
    const ticket = await this.core.resolveTicket(p,args.ticket);
    const prepared = await this.prepare(p,kind,ticket.id,{...('note'in args?{note:args.note}:{}),...('time'in args?{time:args.time}:{})});
    return {valid:true,validation:'current_preflight',ticket_id:ticket.id,metadata_version:prepared.metadataVersion,effects:'none',execution_authorized:false,recheck_required:true};
  }
  private async reserve(p: Principal, kind: Kind, key: string, payloadHash: string, intent: Intent) {
    // Store user text once. Resolved identifiers/defaults stay frozen; payload text
    // is restored from the hash-bound, schema-validated input on resume.
    const compact = { ...intent,
      ...(intent.note ? { note: { ...intent.note, payload: { ...intent.note.payload, title: undefined, description: undefined } } } : {}),
      ...(intent.time ? { time: { ...intent.time, payload: { ...intent.time.payload, summaryNotes: undefined, internalNotes: undefined } } } : {}) };
    return this.journal.reserve({ actorKey: actorKey(p), requestKey: key, payloadHash, operation: names[kind], mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion,
      ...(kind === 'document' ? { encryptedIntent: this.cipher.seal(compact, this.binding(p, key, payloadHash)), intentExpiresAt: new Date(this.now() + 7 * 86_400_000).toISOString() } : {}),
      result: { ticket_id: intent.ticketId, recorded_resource_id: p.resourceId, metadata_version: intent.metadataVersion } });
  }
  private readIntent(p: Principal, record: JournalRecord): Intent {
    if (!record.encryptedIntent || !record.intentExpiresAt || !Number.isFinite(Date.parse(record.intentExpiresAt)) || Date.parse(record.intentExpiresAt) <= this.now()) throw new AppError('conflict', 'The saved operation inputs expired or are unavailable. Inspect the recorded effects; do not repeat them.');
    const value = this.cipher.open(record.encryptedIntent, this.binding(p, record.requestKey, record.payloadHash)) as Intent;
    if (!value || value.schemaVersion !== 1 || !['note','time','document'].includes(value.kind) || names[value.kind] !== record.operation || !Number.isSafeInteger(value.ticketId) || value.ticketId < 1) throw new AppError('conflict', 'Saved operation inputs are invalid.');
    if (value.kind !== 'time') {
      const note = noteInputSchema.parse(value.input?.note);
      if (!value.note?.payload) throw new AppError('conflict', 'Saved note resolution is unavailable.');
      value.note.payload = { ...value.note.payload, title: note.title, description: note.text };
    }
    if (value.kind !== 'note') {
      const time = timeInputSchema.parse(value.input?.time);
      if (!value.time?.payload) throw new AppError('conflict', 'Saved time resolution is unavailable.');
      value.time.payload = { ...value.time.payload, summaryNotes: time.summary, internalNotes: time.internal_notes };
    }
    if (this.keyHash(p, value.kind, value.ticketId, value.input) !== record.payloadHash) throw new AppError('conflict', 'Saved operation inputs do not match the immutable request.');
    return value;
  }
  async noteAdd(p: Principal, input: unknown) {
    const args = noteAddSchema.parse(input);
    return this.startSingle(p, 'note', args.ticket, { note: args.note }, args.request_key);
  }
  async timeLog(p: Principal, input: unknown) {
    const args = timeLogSchema.parse(input);
    return this.startSingle(p, 'time', args.ticket, { time: args.time }, args.request_key);
  }
  private async startSingle(principal: Principal, kind: 'note' | 'time', ticketRef: z.infer<typeof ticketReferenceSchema>, input: Inputs, key: string) {
    const p = await this.current(principal); this.authorize(p, kind);
    const ticket = await this.core.resolveTicket(p, ticketRef), payloadHash = this.keyHash(p, kind, ticket.id, input);
    const existing = await this.prior(p, kind, key, payloadHash);
    if (existing) return this.status(p, { operation_id: existing.id });
    const intent = await this.prepare(p, kind, ticket.id, input);
    const operation = await this.atomic(p, kind, key, intent);
    return withReconciliation(()=>this.result(p, operation));
  }
  private baseReceipt(p: Principal, kind: 'note' | 'time', intent: Intent) {
    return { ticket_id: intent.ticketId, recorded_resource_id: p.resourceId, metadata_version: intent.metadataVersion,
      ...(kind === 'note' ? { audience: intent.note!.audience, defaults: intent.note!.defaults } : { hours_worked: intent.time!.payload.hoursWorked, ...(intent.time!.payload.startDateTime ? {start_datetime:intent.time!.payload.startDateTime,end_datetime:intent.time!.payload.endDateTime,timing_basis:intent.time!.timingBasis,timing_source:intent.time!.timingSource} : {}), work_date: intent.time!.workDate, timezone: intent.time!.timezone, defaults: intent.time!.defaults }) };
  }
  private async readback(p: Principal, kind: 'note' | 'time', intent: Intent, nativeId: number, operationId?:string) {
    const started=performance.now();
    try {
      await this.current(p); await this.core.resolveTicket(p, { kind: 'id', id: intent.ticketId });
      const row = kind === 'note' ? await this.core.adapter.getTicketNote(p, intent.ticketId, nativeId) : await this.core.adapter.getTicketTime(p, intent.ticketId, nativeId);
      const expected = kind === 'note' ? intent.note!.payload : intent.time!.payload;
      const matched: string[] = [], mismatched:string[]=[], missing:string[]=[];
      for (const [field, value] of Object.entries(expected)) {
        if (value === undefined) continue;
        let equal = row[field] === value;
        if (field === 'hoursWorked') equal = typeof row[field] === 'number' && Math.abs((row[field] as number) - (value as number)) < 1e-9;
        if (['dateWorked','startDateTime','endDateTime'].includes(field)) equal = typeof row[field] === 'string' && Number.isFinite(Date.parse(row[field])) && Date.parse(row[field]) === Date.parse(value as string);
        if (equal) matched.push(field); else if(!Object.hasOwn(row,field)||row[field]===undefined)missing.push(field);else mismatched.push(field);
      }
      const fieldCount = Object.values(expected).filter(v => v !== undefined).length;
      const attributed = kind === 'note' ? row[intent.attributionField] === p.resourceId : row.resourceID === p.resourceId;
      const complete=row.id === nativeId && row.ticketID === intent.ticketId && matched.length === fieldCount && attributed;
      await verificationEvidence({operation_id:operationId,kind,native_id:nativeId,ticket_id:intent.ticketId,outcome:complete?'verified':'mismatched',expected_fields:Object.keys(expected).filter(k=>expected[k as keyof typeof expected]!==undefined),matched_fields:matched,mismatched_fields:mismatched,missing_fields:missing,record_id_check:row.id===nativeId,parent_ticket_check:row.ticketID===intent.ticketId,author_check:attributed,duration_ms:performance.now()-started});
      return { performed: true, matched_fields: matched, complete };
    } catch(error) {
      await verificationEvidence({operation_id:operationId,kind,native_id:nativeId,ticket_id:intent.ticketId,outcome:'readback_failed',duration_ms:performance.now()-started},error);
      throw error;
    }
  }
  private async plannedStep(p: Principal, kind: 'note' | 'time', root: JournalRecord, attempt: number, intent: Intent): Promise<Step> {
    const input = kind === 'note' ? { note: intent.input.note } : { time: intent.input.time };
    const key = `wf:${root.id}:${kind}:${attempt}`, payloadHash = this.keyHash(p, kind, intent.ticketId, input);
    const reservation = await this.reserve(p, kind, key, payloadHash, { ...intent, kind, input });
    const record = reservation.record, id = record.result?.[kind === 'note' ? 'note_id' : 'time_entry_id'];
    return { operation_id: record.id, state: record.state, attempt, ...(positiveId(id) ? { native_id: id } : {}) };
  }
  private async atomic(p: Principal, kind: 'note' | 'time', key: string, intent: Intent, planned?: Step): Promise<JournalRecord> {
    const input = kind === 'note' ? { note: intent.input.note } : { time: intent.input.time };
    const stepIntent: Intent = { ...intent, kind, input, ...(kind === 'note' ? { time: undefined } : { note: undefined }) };
    const payloadHash = this.keyHash(p, kind, intent.ticketId, input);
    const existing = await this.prior(p, kind, key, payloadHash);
    if (planned && (!existing || existing.id !== planned.operation_id)) throw new AppError('conflict', 'The recorded workflow step no longer matches its immutable request.');
    if (existing && (!planned || existing.state !== 'ready')) return existing;
    const reservation = existing ? { record: existing, created: true } : await this.reserve(p, kind, key, payloadHash, stepIntent); if (!reservation.created) return reservation.record;
    let record = reservation.record, state: OperationState = 'ready', accepted = false;
    let result: Record<string, unknown> = this.baseReceipt(p, kind, stepIntent);
    try {
      await this.validateFrozen(p, stepIntent);
      record = await this.journal.transition(record.id, 'ready', 'dispatching', result); state = 'dispatching';
      const saved = kind === 'note' ? await this.core.adapter.createTicketNote(p, intent.ticketId, intent.note!.payload) : await this.core.adapter.createTicketTime(p, intent.ticketId, intent.time!.payload);
      accepted = true;
      await verificationEvidence({operation_id:record.id,kind,native_id:saved.id,ticket_id:intent.ticketId,outcome:'not_attempted'});
      result = { ...result, [kind === 'note' ? 'note_id' : 'time_entry_id']: saved.id };
      record = await this.journal.transition(record.id, state, 'accepted_unverified', result); state = 'accepted_unverified';
      const verification = await withReconciliation(()=>this.readback(p, kind, stepIntent, saved.id, record.id));
      if (verification.complete) record = await this.journal.transition(record.id, state, 'succeeded_verified', { ...result, verification: { performed: true, matched_fields: verification.matched_fields } });
      return record;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'dependency_unavailable';
      const definitive = !accepted && (state === 'ready' || (error instanceof AppError && rejectedCodes.has(code)));
      const outcome: OperationState = definitive ? 'failed' : state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome';
      result = { ...result, error_code: code, ...(error instanceof AppError && error.upstreamFailure ? { upstream_failure: error.upstreamFailure } : {}) };
      try {
        if (state !== outcome) record = await this.journal.transition(record.id, state, outcome, result);
        else record = (await this.journal.get(record.id, actorKey(p))) ?? record;
      } catch {
        // A lost journal acknowledgement cannot authorize a second creation.
        try { record = (await this.journal.get(record.id, actorKey(p))) ?? { ...record, state: outcome, result }; }
        catch { record = { ...record, state: 'unknown_outcome', result }; }
      }
      return record;
    }
  }
  async documentWork(principal: Principal, input: unknown) {
    const args = documentWorkSchema.parse(input), p = await this.current(principal); this.authorize(p, 'document');
    const ticket = await this.core.resolveTicket(p, args.ticket), inputs = { note: args.note, time: args.time };
    const payloadHash = this.keyHash(p, 'document', ticket.id, inputs), existing = await this.prior(p, 'document', args.request_key, payloadHash);
    if (existing) return this.status(p, { operation_id: existing.id });
    const intent = await this.prepare(p, 'document', ticket.id, inputs); // Both actions preflight before the first effect.
    const reservation = await this.reserve(p, 'document', args.request_key, payloadHash, intent);
    if (!reservation.created) return this.status(p, { operation_id: reservation.record.id });
    let root = reservation.record;
    const steps: Steps = {};
    try {
      steps.note = await this.plannedStep(p, 'note', root, 1, intent);
      steps.time = await this.plannedStep(p, 'time', root, 1, intent);
      await this.validateFrozen(p, intent);
      root = await this.journal.transition(root.id, 'ready', 'dispatching', { ...this.documentReceipt(p, intent), steps });
    } catch (error) {
      const result = { ...this.documentReceipt(p, intent), steps, error_code: error instanceof AppError ? error.code : 'dependency_unavailable' };
      try { root = await this.journal.transition(root.id, 'ready', 'failed', result); }
      catch {
        try {
          root = (await this.journal.get(root.id, actorKey(p))) ?? root;
          if (root.state === 'dispatching') root = await this.journal.transition(root.id, 'dispatching', 'unknown_outcome', result);
        } catch {
          try { root = (await this.journal.get(root.id, actorKey(p))) ?? { ...root, state: 'unknown_outcome', result }; }
          catch { root = { ...root, state: 'unknown_outcome', result }; }
        }
      }
      return withReconciliation(()=>this.result(p, root));
    }
    return this.runDocument(p, root, intent, steps);
  }
  private documentReceipt(p: Principal, intent: Intent) {
    return { ticket_id: intent.ticketId, recorded_resource_id: p.resourceId, metadata_version: intent.metadataVersion, audience: intent.note!.audience, hours_worked: intent.time!.payload.hoursWorked, ...(intent.time!.payload.startDateTime ? {start_datetime:intent.time!.payload.startDateTime,end_datetime:intent.time!.payload.endDateTime,timing_basis:intent.time!.timingBasis,timing_source:intent.time!.timingSource} : {}), work_date: intent.time!.workDate, timezone: intent.time!.timezone, defaults: [...intent.note!.defaults, ...intent.time!.defaults] };
  }
  private async runDocument(p: Principal, root: JournalRecord, intent: Intent, steps: Steps) {
    const base = this.documentReceipt(p, intent);
    try {
      // Older partial roots may predate complete step reservation. Link every
      // missing child before allowing the next effect on either format.
      for (const kind of ['note', 'time'] as const) if (!steps[kind]) steps[kind] = await this.plannedStep(p, kind, root, 1, intent);
      root = await this.journal.transition(root.id, 'dispatching', 'dispatching', { ...base, steps });
      for (const kind of ['note','time'] as const) {
        let previous = steps[kind]!;
        if (previous?.state === 'succeeded_verified') {
          if (!previous.native_id || !(await this.readback(p, kind, intent, previous.native_id,previous.operation_id)).complete) {
            root = await this.journal.transition(root.id, 'dispatching', 'accepted_unverified', { ...base, steps, error_code: 'precondition_failed' });
            return withReconciliation(()=>this.result(p, root));
          }
          continue;
        }
        if (!['failed', 'ready'].includes(previous.state)) throw new AppError('unknown_outcome', 'A previous step needs reconciliation.');
        if (previous.state === 'failed') {
          if (previous.attempt >= 10) throw new AppError('conflict', 'The workflow reached its bounded retry limit.');
          previous = await this.plannedStep(p, kind, root, previous.attempt + 1, intent);
          steps[kind] = previous;
          root = await this.journal.transition(root.id, 'dispatching', 'dispatching', { ...base, steps });
        }
        const attempt = previous.attempt;
        // The note is verified before the time step; each step refreshes its own eligibility.
        const step = await this.atomic(p, kind, `wf:${root.id}:${kind}:${attempt}`, intent, previous);
        const nativeId = step.result?.[kind === 'note' ? 'note_id' : 'time_entry_id'];
        steps[kind] = { operation_id: step.id, state: step.state, attempt, ...(positiveId(nativeId) ? { native_id: nativeId } : {}) };
        root = await this.journal.transition(root.id, 'dispatching', 'dispatching', { ...base, steps });
        if (step.state !== 'succeeded_verified') {
          const outcome = step.state === 'failed' ? 'partial' : step.state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome';
          root = await this.journal.transition(root.id, 'dispatching', outcome, { ...base, steps, error_code: step.result?.error_code });
          return withReconciliation(()=>this.result(p, root));
        }
      }
      root = await this.journal.transition(root.id, 'dispatching', 'succeeded_verified', { ...base, steps });
      return withReconciliation(()=>this.result(p, root));
    } catch (error) {
      // Never infer that a root dispatch interrupted outside a recorded child is safe to resume.
      try { root = await this.journal.transition(root.id, 'dispatching', 'unknown_outcome', { ...base, steps, error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); }
      catch {
        try { root = (await this.journal.get(root.id, actorKey(p))) ?? { ...root, state: 'unknown_outcome', result: { ...base, steps } }; }
        catch { root = { ...root, state: 'unknown_outcome', result: { ...base, steps } }; }
      }
      return withReconciliation(()=>this.result(p, root));
    }
  }
  async resume(principal: Principal, input: unknown) {
    const args = resumeSchema.parse(input), p = await this.current(principal); this.authorize(p, 'document');
    let root = await this.getScoped(p, args.operation_id);
    if (root.operation !== names.document || root.state !== 'partial') throw new AppError('conflict', 'Only a document-work operation with a recorded, definitively failed step can resume. Unknown or unverified effects require reconciliation.');
    if (root.policyVersion !== p.policyVersion) throw new AppError('conflict', 'The policy changed since this workflow was recorded.');
    const intent = this.readIntent(p, root);
    await this.validateFrozen(p, intent);
    const steps = await this.readSteps(p, root);
    if (Object.values(steps).some(step => !['ready','failed','succeeded_verified'].includes(step.state))) throw new AppError('conflict', 'The workflow contains an unverified effect and cannot resume.');
    if (Object.values(steps).some(step => step.state === 'failed' && step.attempt >= 10)) throw new AppError('conflict', 'The workflow reached its bounded retry limit.');
    root = await this.journal.transition(root.id, 'partial', 'dispatching', root.result);
    return this.runDocument(p, root, intent, steps);
  }
  private async readSteps(p: Principal, root: JournalRecord): Promise<Steps> {
    const stored = root.result?.steps as Steps | undefined, steps: Steps = {};
    for (const kind of ['note', 'time'] as const) {
      const step = stored?.[kind]; if (!step) continue;
      const child = await this.journal.get(step.operation_id, actorKey(p));
      if (!child || child.operation !== names[kind] || child.requestKey !== `wf:${root.id}:${kind}:${step.attempt}` || child.mappingVersion !== root.mappingVersion || child.resourceId !== root.resourceId || child.policyVersion !== root.policyVersion || child.result?.ticket_id !== root.result?.ticket_id) throw notFound();
      const nativeId = child.result?.[kind === 'note' ? 'note_id' : 'time_entry_id'];
      steps[kind] = { ...step, state: child.state, ...(positiveId(nativeId) ? { native_id: nativeId } : {}) };
    }
    return steps;
  }
  /** Read-only upstream reconciliation. No submitted record IDs or caller claims
   * can substitute for the recorded IDs and encrypted original intent. */
  async reconcile(principal: Principal, input: unknown) {
    const args = resumeSchema.parse(input), p = await this.current(principal);
    assertCapability(p, 'operational.read');
    let root = await this.getScoped(p, args.operation_id);
    if (root.operation !== names.document || !['accepted_unverified', 'unknown_outcome'].includes(root.state)) return this.result(p, root);
    const intent = this.readIntent(p, root), steps = await this.readSteps(p, root);
    if (!steps.note || !steps.time) return this.result(p, root);
    for (const kind of ['note', 'time'] as const) {
      const step = steps[kind]!;
      if (step.state === 'ready' || step.state === 'failed') break;
      if (!step.native_id) return this.result(p, root);
      const verification = await this.readback(p, kind, intent, step.native_id,step.operation_id);
      if (!verification.complete) return this.result(p, root);
      if (step.state !== 'succeeded_verified') {
        const child = await this.journal.get(step.operation_id, actorKey(p)); if (!child) throw notFound();
        await this.journal.transition(child.id, child.state, 'succeeded_verified', { ...child.result, verification: { performed: true, matched_fields: verification.matched_fields } });
        step.state = 'succeeded_verified';
      }
    }
    const allSaved = Object.values(steps).every(step => step.state === 'succeeded_verified');
    if (allSaved || Object.values(steps).every(step => ['ready', 'failed', 'succeeded_verified'].includes(step.state))) root = await this.journal.transition(root.id, root.state, allSaved ? 'succeeded_verified' : 'partial', { ...this.documentReceipt(p, intent), steps });
    return this.result(p, root);
  }
  private async getScoped(p: Principal, id: string) {
    const record = await this.journal.get(id, actorKey(p)); if (!record) throw notFound();
    if (record.resourceId !== p.resourceId || record.mappingVersion !== p.mappingVersion) throw new AppError('conflict', 'Employee mapping changed since this operation.');
    if (record.operation === names.time || record.operation === names.document) {assertArea(p,'time');assertCapability(p, 'time.self');}
    if (typeof record.result?.ticket_id === 'number') await this.core.resolveTicket(p, { kind: 'id', id: record.result.ticket_id });
    else throw notFound();
    return record;
  }
  async status(principal: Principal, input: unknown) {
    const args = resumeSchema.parse(input), p = await this.current(principal);
    const record = await this.journal.get(args.operation_id, actorKey(p)); if (!record) throw notFound();
    if (!Object.values(names).includes(record.operation as any)) return { ...await this.core.operationStatus(p, input), can_resume: false, safe_to_redispatch: false };
    return this.result(p, await this.getScoped(p, record.id));
  }
  private async result(p: Principal, record: JournalRecord) {
    const fresh = await this.current(p);
    if (record.operation === names.time || record.operation === names.document) {assertArea(fresh,'time');assertCapability(fresh, 'time.self');}
    const result = redactJournalResult(record.result) ?? {};
    if (record.operation === names.document && result.steps) result.steps = await this.readSteps(fresh, record);
    const steps = result.steps as Steps | undefined;
    if (typeof result.ticket_id === 'number') await this.core.resolveTicket(fresh, { kind: 'id', id: result.ticket_id });
    else throw notFound();
    const uncertain = ['dispatching','unknown_outcome'].includes(record.state), saved = record.state === 'succeeded_verified';
    let receipt: string;
    if (record.operation === names.document) {
      const note = steps?.note?.state === 'succeeded_verified', time = steps?.time?.state === 'succeeded_verified';
      receipt = saved ? `The ${result.audience} note and requested time were saved and verified.` : note && time ? 'The note and time entry were saved and verified. The workflow journal outcome needs reconciliation; do not recreate either record.' : note ? 'The note was saved. The time step is incomplete; inspect its recorded outcome before continuing.' : uncertain ? 'The recorded workflow outcome is incomplete. An action may have reached Autotask; reconcile it before another write.' : 'The note step did not complete with verification. Time was not attempted.';
    } else receipt = saved ? record.operation === names.note ? `The ${result.audience} note was saved and verified.` : 'The requested time entry was saved and verified.' : uncertain ? 'The write may have reached Autotask. Reconciliation is required; do not repeat it with a new request key.' : record.state === 'accepted_unverified' ? 'The saved record could not be fully verified. Do not create it again.' : 'The requested write was rejected and was not recorded as successful.';
    if (record.state === 'failed' && (result.upstream_failure as {reason?:string} | undefined)?.reason === 'start_stop_required') receipt = 'Autotask rejected the entry because this service ticket requires actual start and stop times. Supply start_datetime and end_datetime; do not invent meeting times.';
    if (saved && typeof result.start_datetime === 'string' && typeof result.end_datetime === 'string' && typeof result.timezone === 'string') {
      const format = new Intl.DateTimeFormat('en-US',{timeZone:result.timezone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
      receipt += ` Recorded ${Number(result.hours_worked) * 60} minutes: ${format.format(new Date(result.start_datetime))} – ${format.format(new Date(result.end_datetime))}. Timing source: ${result.timing_source ?? 'stored interval'}; calculation: ${result.timing_basis ?? 'stored interval'}. Please correct the interval if it is wrong.`;
    }
    const canResume = record.operation === names.document && record.state === 'partial'
      && Boolean(record.encryptedIntent && record.intentExpiresAt && Date.parse(record.intentExpiresAt) > this.now())
      && record.policyVersion === fresh.policyVersion && fresh.capabilities.includes('tickets.write')
      && Boolean(steps && Object.values(steps).some(step => step.state === 'failed' || step.state === 'ready'))
      && Object.values(steps ?? {}).every(step => step.state === 'succeeded_verified' || step.state === 'ready' || (step.state === 'failed' && step.attempt < 10));
    return { status: record.state, operation_id: record.id, correlation_id: randomUUID(), data: result, receipt, can_resume: canResume, safe_to_redispatch: false,
      provenance: { source: this.core.adapter.source, schema_version: 'ticket-work-v1' }, warnings: this.core.adapter.source === 'fixture' ? ['Fictitious development data. No Autotask connection.'] : [] };
  }
}
