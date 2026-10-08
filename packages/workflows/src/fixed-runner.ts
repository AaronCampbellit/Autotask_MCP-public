import {withReconciliation} from '../../execution/src/index.js';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, actorKey, type Journal, type JournalRecord, type OperationState, type Principal } from '../../contracts/src/index.js';
import { IntentCipher, redactJournalResult } from '../../storage/src/index.js';

export type FixedKind = 'ticket_handoff' | 'ticket_resolve';
export type FixedStepKey = 'note' | 'time' | 'update';
export interface FixedStep {
  key: FixedStepKey;
  operation: string;
  preflight(): Promise<void>;
  create(): Promise<{ id: number }>;
  verify(id: number): Promise<boolean>;
  knownId?: number;
}
export interface FixedDefinition {
  ticketId: number;
  receipt: Record<string, unknown>;
  steps: FixedStep[];
}
interface StepRecord { operation_id: string; state: OperationState; attempt: number; native_id?: number }
type Steps = Partial<Record<FixedStepKey, StepRecord>>;
interface Saved { version: 1; kind: FixedKind; ticketId: number; inputHash: string; prepared: unknown }
export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => (value as any)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as any)[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const intentHash = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');
const rejects = new Set(['invalid_input','forbidden','not_found_or_inaccessible','unsupported_operation','missing_metadata','precondition_failed','conflict','throttled','identity_mapping_invalid','identity_validation_unavailable','impersonation_not_qualified']);

/** Private fixed-step runner. Public tools never accept definitions or executable graphs. */
export class FixedTicketRunner {
  constructor(readonly journal: Journal, private readonly cipher: IntentCipher,
    private readonly authorize: (p: Principal, kind: FixedKind, ticketId?: number) => Promise<Principal>,
    private readonly define: (p: Principal, kind: FixedKind, prepared: unknown) => Promise<FixedDefinition>,
    private readonly source: 'fixture' | 'Autotask', private readonly now = Date.now) {}
  private hash(p: Principal, kind: FixedKind, input: unknown) {
    return intentHash({ definition: `${kind}:1`, actor: actorKey(p), mapping: p.mappingVersion, resource: p.resourceId, policy: p.policyVersion, input });
  }
  private binding(record: Pick<JournalRecord, 'actorKey' | 'requestKey' | 'payloadHash'>) {
    return `fixed:${record.actorKey}:${record.requestKey}:${record.payloadHash}`;
  }
  private async scoped(p: Principal, id: string): Promise<JournalRecord> {
    const r = await this.journal.get(id, actorKey(p));
    if (!r || !['ticket_handoff','ticket_resolve'].includes(r.operation)) throw new AppError('not_found_or_inaccessible', 'Operation not found or inaccessible.');
    if (r.mappingVersion !== p.mappingVersion || r.resourceId !== p.resourceId || r.policyVersion !== p.policyVersion) throw new AppError('conflict', 'The employee mapping or policy changed.');
    await this.authorize(p, r.operation as FixedKind, r.result?.ticket_id as number);
    return r;
  }
  async start(p: Principal, kind: FixedKind, key: string, input: unknown, prepare: () => Promise<{ ticketId: number; prepared: unknown }>) {
    p = await this.authorize(p, kind);
    const payloadHash = this.hash(p, kind, input), prior = await this.journal.find(actorKey(p), key);
    if (prior) {
      if (prior.operation !== kind || prior.payloadHash !== payloadHash) throw new AppError('conflict', 'Request key already belongs to different work.');
      return this.status(p, prior.id);
    }
    const plan = await prepare(), saved: Saved = { version: 1, kind, ticketId: plan.ticketId, inputHash: payloadHash, prepared: plan.prepared };
    const definition = await this.define(p, kind, saved.prepared);
    for (const step of definition.steps) await step.preflight();
    const identity = { actorKey: actorKey(p), requestKey: key, payloadHash };
    const reserved = await this.journal.reserve({ ...identity, operation: kind, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion,
      encryptedIntent: this.cipher.seal(saved, this.binding(identity)), intentExpiresAt: new Date(this.now() + 7 * 86_400_000).toISOString(), result: { ...definition.receipt, ticket_id: plan.ticketId, requires_time: definition.steps.some(step => step.key === 'time') } });
    if (!reserved.created) return this.status(p, reserved.record.id);
    let root = reserved.record, steps: Steps = {};
    try {
      await this.authorize(p, kind, plan.ticketId);
      for (const step of definition.steps) await step.preflight();
      steps = await this.reserveSteps(p, root, definition);
      root = await this.journal.transition(root.id, 'ready', 'dispatching', { ...root.result, steps });
    } catch (error) {
      root = await this.recordFailure(p, root, 'ready', 'failed', { ...root.result, error_code: this.errorCode(error) });
      return this.receipt(p, root);
    }
    return this.run(p, root, definition, steps);
  }
  private errorCode(error: unknown) { return error instanceof AppError ? error.code : 'dependency_unavailable'; }
  private async recordFailure(p: Principal, record: JournalRecord, from: OperationState, to: OperationState, result: Record<string, unknown>): Promise<JournalRecord> {
    try { return await this.journal.transition(record.id, from, to, result); }
    catch {
      try { return (await this.journal.get(record.id, actorKey(p))) ?? { ...record, state: 'unknown_outcome', result }; }
      catch { return { ...record, state: 'unknown_outcome', result }; }
    }
  }
  private async atomic(p: Principal, root: JournalRecord, step: FixedStep, attempt: number): Promise<JournalRecord> {
    const requestKey = `wf:${root.id}:${step.key}:${attempt}`;
    const prior = await this.journal.find(actorKey(p), requestKey); if (prior && prior.state !== 'ready') return prior;
    const reserved = prior ? { record: prior, created: false } : await this.journal.reserve({ actorKey: actorKey(p), requestKey, payloadHash: intentHash({ root: root.payloadHash, key: step.key }),
      operation: step.operation, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, resourceId: p.resourceId,
      result: { ticket_id: root.result?.ticket_id, recorded_resource_id: p.resourceId } });
    if (reserved.record.state !== 'ready') return reserved.record;
    let record = reserved.record, state: OperationState = 'ready', accepted = false;
    let data: Record<string, unknown> = { ...record.result };
    try {
      await this.authorize(p, root.operation as FixedKind, root.result?.ticket_id as number);
      await step.preflight();
      record = await this.journal.transition(record.id, 'ready', 'dispatching', data); state = 'dispatching';
      const saved = await step.create(); accepted = true;
      data = { ...data, [step.key === 'note' ? 'note_id' : step.key === 'time' ? 'time_entry_id' : 'ticket_id']: saved.id };
      record = await this.journal.transition(record.id, state, 'accepted_unverified', data); state = 'accepted_unverified';
      if (await withReconciliation(()=>step.verify(saved.id))) record = await this.journal.transition(record.id, state, 'succeeded_verified', data);
      return record;
    } catch (error) {
      const definitive = !accepted && (state === 'ready' || (error instanceof AppError && rejects.has(error.code)));
      const outcome = definitive ? 'failed' : state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome';
      if (state === outcome) return record;
      return this.recordFailure(p, record, state, outcome, { ...data, error_code: this.errorCode(error) });
    }
  }
  private async reserveSteps(p: Principal, root: JournalRecord, definition: FixedDefinition): Promise<Steps> {
    const steps: Steps = {};
    for (const step of definition.steps) {
      const reserved = await this.journal.reserve({ actorKey: actorKey(p), requestKey: `wf:${root.id}:${step.key}:1`, payloadHash: intentHash({ root: root.payloadHash, key: step.key }),
        operation: step.operation, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, resourceId: p.resourceId,
        result: { ticket_id: root.result?.ticket_id, recorded_resource_id: p.resourceId } });
      steps[step.key] = { operation_id: reserved.record.id, state: reserved.record.state, attempt: 1 };
    }
    return steps;
  }
  private async run(p: Principal, root: JournalRecord, definition: FixedDefinition, steps: Steps) {
    const data = () => ({ ...definition.receipt, ticket_id: definition.ticketId, requires_time: definition.steps.some(step => step.key === 'time'), steps });
    try {
      for (const step of definition.steps) {
        const prior = steps[step.key];
        if (prior?.state === 'succeeded_verified') {
          if (!prior.native_id || !await step.verify(prior.native_id)) throw new AppError('precondition_failed', 'A previously saved effect no longer matches the original work.');
          continue;
        }
        if (prior && !['failed','ready'].includes(prior.state)) throw new AppError('unknown_outcome', 'The earlier effect must be reconciled.');
        const attempt = prior?.state === 'ready' ? prior.attempt : (prior?.attempt ?? 0) + 1;
        if (attempt > 10) throw new AppError('conflict', 'The workflow retry limit was reached.');
        const child = await this.atomic(p, root, step, attempt);
        const id = child.result?.[step.key === 'note' ? 'note_id' : step.key === 'time' ? 'time_entry_id' : 'ticket_id'];
        steps[step.key] = { operation_id: child.id, state: child.state, attempt, ...(typeof id === 'number' ? { native_id: id } : {}) };
        root = await this.journal.transition(root.id, 'dispatching', 'dispatching', data());
        if (child.state !== 'succeeded_verified') {
          const outcome = child.state === 'failed' ? 'partial' : child.state === 'accepted_unverified' ? 'accepted_unverified' : 'unknown_outcome';
          root = await this.journal.transition(root.id, 'dispatching', outcome, data());
          return this.receipt(p, root, true);
        }
      }
      root = await this.journal.transition(root.id, 'dispatching', 'succeeded_verified', data());
    } catch (error) {
      root = await this.recordFailure(p, root, 'dispatching', 'unknown_outcome', { ...data(), error_code: this.errorCode(error) });
    }
    return this.receipt(p, root, true);
  }
  private read(p: Principal, r: JournalRecord): Saved {
    if (!r.encryptedIntent || !r.intentExpiresAt || Date.parse(r.intentExpiresAt) <= this.now()) throw new AppError('conflict', 'Original workflow input expired or is unavailable.');
    const saved = this.cipher.open(r.encryptedIntent, this.binding(r)) as Saved;
    if (saved?.version !== 1 || saved.kind !== r.operation || saved.ticketId !== r.result?.ticket_id || saved.inputHash !== r.payloadHash) throw new AppError('conflict', 'Saved workflow input does not match its immutable identity.');
    return saved;
  }
  async resume(p: Principal, id: string) {
    let root = await this.scoped(p, id);
    if (!['partial','ready'].includes(root.state)) throw new AppError('conflict', 'Only a definitively failed or undispatched remaining step can resume.');
    const saved = this.read(p, root);
    const definition = await this.define(p, saved.kind, saved.prepared);
    const steps = root.state === 'ready' ? await this.reserveSteps(p, root, definition) : (root.result?.steps ?? {}) as Steps;
    if (!Object.values(steps).some(s => ['failed','ready'].includes(s.state)) || Object.values(steps).some(s => !['succeeded_verified','failed','ready'].includes(s.state) || (s.state === 'failed' && s.attempt >= 10))) throw new AppError('conflict', 'This workflow is not eligible for another attempt.');
    for (const step of definition.steps) if (steps[step.key]?.state !== 'succeeded_verified') await step.preflight();
    root = await this.journal.transition(root.id, root.state, 'dispatching', { ...root.result, steps });
    return this.run(p, root, definition, steps);
  }
  async reconcile(p: Principal, id: string) {
    let root = await this.scoped(p, id);
    if (!['unknown_outcome','accepted_unverified'].includes(root.state)) return this.receipt(p, root);
    const saved = this.read(p, root), definition = await this.define(p, saved.kind, saved.prepared), steps = (root.result?.steps ?? {}) as Steps;
    for (const step of definition.steps) {
      const child = steps[step.key]; if (!child) break;
      const recorded = await this.journal.get(child.operation_id, actorKey(p));
      if (!recorded) return this.receipt(p, root);
      child.state = recorded.state;
      const persistedId = recorded.result?.[step.key === 'note' ? 'note_id' : step.key === 'time' ? 'time_entry_id' : 'ticket_id'];
      if (typeof persistedId === 'number') child.native_id = persistedId;
      if (['failed','ready'].includes(child.state)) continue;
      // Recorded ID is the only reconciliation path; no fuzzy duplicate matching.
      const nativeId = child.native_id ?? step.knownId;
      if (!nativeId || !await step.verify(nativeId)) return this.receipt(p, root);
      if (child.state !== 'succeeded_verified') {
        if (!['dispatching','unknown_outcome','accepted_unverified'].includes(recorded.state)) return this.receipt(p, root);
        await this.journal.transition(recorded.id, recorded.state, 'succeeded_verified', { ...recorded.result, [step.key === 'note' ? 'note_id' : step.key === 'time' ? 'time_entry_id' : 'ticket_id']: nativeId });
        child.state = 'succeeded_verified'; child.native_id = nativeId;
      }
    }
    const complete = definition.steps.every(s => steps[s.key]?.state === 'succeeded_verified');
    const partial = definition.steps.every(s => steps[s.key] && ['succeeded_verified','failed','ready'].includes(steps[s.key]!.state));
    if (complete || partial) root = await this.journal.transition(root.id, root.state, complete ? 'succeeded_verified' : 'partial', { ...root.result, steps });
    return this.receipt(p, root);
  }
  async status(p: Principal, id: string) { return this.receipt(p, await this.scoped(p, id)); }
  private async receipt(p: Principal, r: JournalRecord, mutationReturn = false) {
    try { const authorize=()=>this.authorize(p, r.operation as FixedKind, r.result?.ticket_id as number); await (mutationReturn?withReconciliation(authorize):authorize()); }
    catch(error) {
      if(!mutationReturn)throw error;
      // A post-write authorization or dependency failure must not invite replay,
      // and no formerly authorized ticket content may escape after revocation.
      return {status:'unknown_outcome',operation_id:r.id,correlation_id:randomUUID(),data:{} as Record<string,unknown>,can_resume:false,safe_to_redispatch:false,
        receipt:'This workflow may contain saved effects. Its outcome cannot currently be inspected. Do not replay it.',provenance:{source:this.source},warnings:[]};
    }
    const data = redactJournalResult(r.result) ?? {}, steps = data.steps as Steps | undefined;
    const saved = Object.entries(steps ?? {}).filter(([,s]) => s?.state === 'succeeded_verified').map(([key]) => key);
    const can_resume = ['partial','ready'].includes(r.state) && Boolean(r.intentExpiresAt && Date.parse(r.intentExpiresAt) > this.now()) && (r.state === 'ready' || Object.values(steps ?? {}).some(s => ['failed','ready'].includes(s.state))) && Object.values(steps ?? {}).every(s => ['succeeded_verified','ready'].includes(s.state) || (s.state === 'failed' && s.attempt < 10));
    return { status: r.state, operation_id: r.id, correlation_id: randomUUID(), data, can_resume, safe_to_redispatch: false,
      receipt: r.state === 'succeeded_verified' ? `${r.operation === 'ticket_handoff' ? 'Handoff' : 'Resolution'} saved and verified.` : `Verified steps: ${saved.join(', ') || 'none'}. Workflow state: ${r.state}. Inspect the recorded remainder; do not repeat saved work.`,
      provenance: { source: this.source }, warnings: this.source === 'fixture' ? ['Fictitious development data. No Autotask connection.'] : [] };
  }
}
