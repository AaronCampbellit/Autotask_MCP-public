import {matchesHistory,type HistoryFilter,type HistoryItem} from './history.js';
import { randomUUID } from 'node:crypto';
import { AppError, type Journal, type JournalRecord, type Principal } from '../../contracts/src/index.js';
import { redactJournalResult } from '../../storage/src/index.js';
import { auditEvent, controlConflict, controlNotFound, controlPage, jobActor, sameJob, validLease } from './index.js';
import type { AuditEvent, ControlActor, ControlPlaneStore, DispatchControls, JobLease, JobLimits, JobRecord, JobReservation, LeaseIdentity, PageCursor, PermissionTemplate } from './contracts.js';

const actorKey = (a: ControlActor) => `${a.tenantId}:${a.objectId}`;
const active = (job: JobRecord) => job.state === 'queued' || job.state === 'running';
const clone = <T>(value: T): T => structuredClone(value);
function page<T extends { id: string }>(rows: T[], limit: number, at: (row: T) => string, cursor?: PageCursor) {
  return controlPage(rows.filter(row => !cursor || at(row) < cursor.at || (at(row) === cursor.at && row.id < cursor.id))
    .sort((a, b) => at(b).localeCompare(at(a)) || b.id.localeCompare(a.id)), limit, at);
}

/** Explicit local fixture store. Production uses PostgresControlPlaneStore. */
export class MemoryControlPlaneStore implements ControlPlaneStore {
  readonly backend = 'memory' as const;
  private readonly members = new Map<string, Principal>();
  private readonly templates = new Map<string, PermissionTemplate>();
  private readonly controls = new Map<string, DispatchControls>();
  private readonly events: AuditEvent[] = [];
  private readonly jobs = new Map<string, JobRecord>();
  constructor(members: Principal[] = [], private readonly journal?: Journal, private readonly operationSource?: () => Promise<JournalRecord[]>) {
    for (const member of members) this.members.set(actorKey(member), clone(member));
  }
  async diagnosticAccess(actor:ControlActor,id:string,action:'detail'|'export',at:string){this.events.push(auditEvent(actor,action==='export'?'diagnostic.exported':'diagnostic.detail_viewed','diagnostic',id,at));}
  async health() { return true; }
  async getMember(actor: ControlActor) { const member = this.members.get(actorKey(actor)); return member ? clone(member) : undefined; }
  async listMembers(tenantId: string) { return clone([...this.members.values()].filter(m => m.tenantId === tenantId).sort((a, b) => a.objectId.localeCompare(b.objectId))); }
  async saveMember(actor: ControlActor, member: Principal, expectedVersion: number, at: string) {
    const old = this.members.get(actorKey(member));
    if (actor.tenantId !== member.tenantId || (old?.mappingVersion ?? 0) !== expectedVersion
        || member.mappingVersion !== expectedVersion + 1 || [...this.members.values()].some(m => m.tenantId === member.tenantId && m.objectId !== member.objectId && m.resourceId === member.resourceId)) throw controlConflict();
    this.members.set(actorKey(member), clone(member)); this.events.push(auditEvent(actor, 'member.saved', 'member', member.objectId, at, { version: member.mappingVersion })); return clone(member);
  }
  async listTemplates(tenantId: string) { return clone([...this.templates.values()].filter(t => t.tenantId === tenantId)); }
  async saveTemplate(actor: ControlActor, template: PermissionTemplate, expectedVersion: number, at: string) {
    const key = `${template.tenantId}:${template.key}`;
    if (actor.tenantId !== template.tenantId || (this.templates.get(key)?.version ?? 0) !== expectedVersion || template.version !== expectedVersion + 1) throw controlConflict();
    this.templates.set(key, clone(template)); this.events.push(auditEvent(actor, 'template.saved', 'template', template.key, at, { version: template.version })); return clone(template);
  }
  async getControls(tenantId: string) { return clone(this.controls.get(tenantId) ?? { tenantId, version: 0, writePaused: false, tools: {} }); }
  async saveControls(actor: ControlActor, controls: DispatchControls, expectedVersion: number, at: string) {
    if (actor.tenantId !== controls.tenantId || (this.controls.get(actor.tenantId)?.version ?? 0) !== expectedVersion || controls.version !== expectedVersion + 1) throw controlConflict();
    this.controls.set(actor.tenantId, clone(controls)); this.events.push(auditEvent(actor, 'controls.saved', 'controls', 'dispatch', at, { version: controls.version })); return clone(controls);
  }
  async listHistory(tenantId:string,filter:HistoryFilter){
    const items:HistoryItem[]=filter.kind==='audit'?this.events.filter(e=>e.tenantId===tenantId).map(e=>({id:e.id,userId:e.actorKey.split(':')[1]!,action:e.action,state:e.details.state,at:e.at,updatedAt:e.at,targetType:e.targetType,targetId:e.targetId})):
      (await this.operationSource?.()??[]).filter(r=>r.actorKey.split(':')[0]===tenantId).map(r=>({id:r.id,userId:r.actorKey.split(':')[1]!,action:r.operation,state:r.state,at:r.createdAt,updatedAt:r.updatedAt}));
    return clone(page(items.filter(r=>matchesHistory(r,filter)),filter.limit,r=>r.at,filter.cursor));
  }
  async listAudit(tenantId: string, limit: number, cursor?: PageCursor) { return clone(page(this.events.filter(e => e.tenantId === tenantId), limit, e => e.at, cursor)); }
  async listOperations(owner: string, limit: number, cursor?: PageCursor) {
    if (!this.operationSource) throw new AppError('unsupported_operation', 'The fixture operation listing source is not configured.');
    const records = (await this.operationSource()).filter(record => record.actorKey === owner).map(record => ({ id: record.id, operation: record.operation, state: record.state, createdAt: record.createdAt, updatedAt: record.updatedAt, result: redactJournalResult(record.result) }));
    return clone(page(records, limit, r => r.createdAt, cursor));
  }
  async getOperation(id: string, owner: string) { return this.journal?.get(id, owner); }
  async enqueue(input: JobReservation, limits: JobLimits): Promise<JobRecord> {
    const prior = [...this.jobs.values()].find(j => j.actorKey === input.actorKey && j.requestKey === input.requestKey);
    if (prior) { sameJob(prior, input); return clone(prior); }
    const pending = [...this.jobs.values()].filter(active);
    if (pending.filter(j => j.actorKey === input.actorKey).length >= limits.actor || pending.filter(j => j.tenantId === input.tenantId).length >= limits.tenant) throw new AppError('throttled', 'The pending job quota is full.');
    const job: JobRecord = { ...clone(input), state: 'queued', updatedAt: input.createdAt, fence: 0, dispatched: false, cancelRequested: false };
    this.jobs.set(job.id, job); this.events.push(auditEvent(jobActor(job), 'job.queued', 'job', job.id, job.createdAt, { state: job.state })); return clone(job);
  }
  async getJob(id: string, owner: string) { const job = this.jobs.get(id); return job?.actorKey === owner ? clone(job) : undefined; }
  async findJob(owner: string, requestKey: string) { const job = [...this.jobs.values()].find(job => job.actorKey === owner && job.requestKey === requestKey); return job ? clone(job) : undefined; }
  async listJobs(owner: string, limit: number, cursor?: PageCursor) { return clone(page([...this.jobs.values()].filter(j => j.actorKey === owner), limit, j => j.createdAt, cursor)); }
  async claim(workerId: string, at: string, leaseExpiresAt: string): Promise<JobLease | undefined> {
    for (const job of this.jobs.values()) {
      if (!active(job)) continue;
      const leaseExpired = job.state === 'running' && Date.parse(job.leaseExpiresAt!) <= Date.parse(at);
      if (leaseExpired && job.dispatched) job.state = 'uncertain';
      else if (Date.parse(job.expiresAt) <= Date.parse(at)) job.state = job.dispatched ? 'uncertain' : 'expired';
      else if (leaseExpired && job.cancelRequested) job.state = 'cancelled';
      else if (leaseExpired && job.fence >= 10) job.state = 'failed';
      else continue;
      job.updatedAt = at; this.events.push(auditEvent(jobActor(job), job.state === 'uncertain' ? 'job.uncertain' : job.state === 'cancelled' ? 'job.cancelled' : 'job.expired', 'job', job.id, at, { state: job.state, fence: job.fence }));
    }
    const job = [...this.jobs.values()].filter(j => Date.parse(j.runAfter) <= Date.parse(at) && Date.parse(j.expiresAt) > Date.parse(at) && !j.cancelRequested
      && (j.state === 'queued' || (j.state === 'running' && !j.dispatched && Date.parse(j.leaseExpiresAt!) <= Date.parse(at))))
      .sort((a, b) => a.runAfter.localeCompare(b.runAfter) || a.id.localeCompare(b.id))[0];
    if (!job) return undefined;
    job.state = 'running'; job.fence++; job.leaseToken = randomUUID(); job.leaseOwner = workerId; job.leaseExpiresAt = leaseExpiresAt; job.updatedAt = at;
    this.events.push(auditEvent(jobActor(job), 'job.claimed', 'job', job.id, at, { state: job.state, fence: job.fence }));
    return { job: clone(job), token: job.leaseToken, fence: job.fence };
  }
  async markDispatch(lease: LeaseIdentity, at: string) {
    const job = this.jobs.get(lease.id); validLease(job, lease, at);
    if (job.dispatched || job.cancelRequested || Date.parse(job.expiresAt) <= Date.parse(at)) throw controlConflict();
    job.dispatched = true; job.updatedAt = at; this.events.push(auditEvent(jobActor(job), 'job.dispatched', 'job', job.id, at, { state: job.state, fence: job.fence })); return clone(job);
  }
  async finish(lease: LeaseIdentity, state: 'succeeded' | 'failed' | 'uncertain', at: string, operationId?: string) {
    const job = this.jobs.get(lease.id); validLease(job, lease, at);
    job.state = state; job.updatedAt = at; if (operationId) job.operationId = operationId;
    this.events.push(auditEvent(jobActor(job), 'job.finished', 'job', job.id, at, { state, fence: job.fence })); return clone(job);
  }
  async cancel(id: string, owner: string, at: string) {
    const job = this.jobs.get(id); if (!job || job.actorKey !== owner) throw controlNotFound();
    if (!active(job)) return clone(job);
    job.cancelRequested = true; if (job.state === 'queued') job.state = 'cancelled'; job.updatedAt = at;
    this.events.push(auditEvent(jobActor(job), job.state === 'cancelled' ? 'job.cancelled' : 'job.cancel_requested', 'job', job.id, at, { state: job.state })); return clone(job);
  }
  async purgeJobPayloads(actor: ControlActor, before: string, at: string) {
    let count = 0;
    for (const job of this.jobs.values()) if (job.tenantId === actor.tenantId && !active(job) && job.encryptedPayload && Date.parse(job.updatedAt) < Date.parse(before)) {
      delete job.encryptedPayload; job.payloadPurgedAt = at; count++;
      this.events.push(auditEvent(actor, 'job.payload_purged', 'job', job.id, at, { state: job.state }));
    }
    return count;
  }
}
