import {auditLabels,historyActionLabels,type HistoryFilter,type HistoryItem} from './history.js';
import { randomUUID } from 'node:crypto';
import { AppError, type Principal } from '../../contracts/src/index.js';
import { PostgresJournal, PostgresPrincipalStore, redactJournalResult, type SqlClient } from '../../storage/src/index.js';
import { auditEvent, controlConflict, controlNotFound, controlPage, controlUnavailable, jobActor, sameJob, validLease } from './index.js';
import type { AuditEvent, ControlActor, ControlPlaneStore, ControlSqlClient, DispatchControls, JobLease, JobLimits, JobRecord, JobReservation, LeaseIdentity, PageCursor, PermissionTemplate } from './contracts.js';

const iso = (value: unknown) => new Date(value as string).toISOString();
const object = (value: unknown) => value as Record<string, any>;
function jobRecord(value: unknown): JobRecord {
  const row = object(value);
  return { id: row.id, tenantId: row.tenant_id, actorKey: row.actor_key, requestKey: row.request_key, payloadHash: row.payload_hash, operation: row.operation,
    resourceId: Number(row.resource_id), mappingVersion: row.mapping_version, policyVersion: row.policy_version, state: row.state,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), runAfter: iso(row.run_after), expiresAt: iso(row.expires_at),
    ...(row.encrypted_payload ? { encryptedPayload: row.encrypted_payload } : {}), ...(row.payload_purged_at ? { payloadPurgedAt: iso(row.payload_purged_at) } : {}),
    fence: row.fence, dispatched: row.dispatched, cancelRequested: row.cancel_requested,
    ...(row.lease_token ? { leaseToken: row.lease_token, leaseOwner: row.lease_owner, leaseExpiresAt: iso(row.lease_expires_at) } : {}),
    ...(row.operation_id ? { operationId: row.operation_id } : {}) };
}
function failure(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error && typeof error === 'object' && 'code' in error && ['23505', '23514', '40001', '40P01'].includes(String(error.code))) throw controlConflict();
  throw controlUnavailable();
}

export class PostgresControlPlaneStore implements ControlPlaneStore {
  readonly backend = 'postgres' as const;
  constructor(private readonly client: ControlSqlClient) {}
  private async read<T>(run: () => Promise<T>): Promise<T> { try { return await run(); } catch (error) { return failure(error); } }
  private async tx<T>(run: (tx: SqlClient) => Promise<T>): Promise<T> {
    try {
      if (this.client.transaction) return await this.client.transaction(run);
      if (!this.client.connect) throw controlUnavailable();
      const client = await this.client.connect();
      try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
      catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve sanitized original outcome. */ } throw error; }
      finally { client.release(); }
    } catch (error) { return failure(error); }
  }
  private async audit(tx: SqlClient, event: AuditEvent) {
    await tx.query('INSERT INTO control_audit (id,tenant_id,actor_key,action,target_type,target_id,at,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [event.id, event.tenantId, event.actorKey, event.action, event.targetType, event.targetId, event.at, JSON.stringify(event.details)]);
  }
  async diagnosticAccess(actor:ControlActor,id:string,action:'detail'|'export',at:string){await this.tx(tx=>this.audit(tx,auditEvent(actor,action==='export'?'diagnostic.exported':'diagnostic.detail_viewed','diagnostic',id,at)));}
  async health() { return this.read(async () => { await this.client.query('SELECT 1 FROM control_jobs LIMIT 1'); return true; }); }
  async getMember(actor: ControlActor) { return new PostgresPrincipalStore(this.client).get(actor.tenantId, actor.objectId); }
  async listMembers(tenantId: string) {
    return this.read(async () => {
      const rows = await this.client.query('SELECT object_id FROM identity_mappings WHERE tenant_id = $1 ORDER BY object_id LIMIT 1001', [tenantId]);
      if (rows.rows.length > 1000) throw new AppError('unsupported_operation', 'Member listing exceeds its current administrative limit.');
      const store = new PostgresPrincipalStore(this.client), members: Principal[] = [];
      for (const row of rows.rows) { const member = await store.get(tenantId, object(row).object_id); if (member) members.push(member); }
      return members;
    });
  }
  async saveMember(actor: ControlActor, member: Principal, expectedVersion: number, at: string) {
    if (actor.tenantId !== member.tenantId || member.mappingVersion !== expectedVersion + 1) throw controlConflict();
    return this.tx(async tx => {
      const policy = JSON.stringify({ ...(member.areaPermissions!==undefined?{areaPermissions:member.areaPermissions}:{}), capabilities: member.capabilities, companyIds: member.companyIds, ...(member.allCompanies!==undefined?{allCompanies:member.allCompanies}:{}) });
      const result = expectedVersion === 0
        ? await tx.query(`INSERT INTO identity_mappings (tenant_id,object_id,resource_id,mapping_version,policy_version,active,resource_verified_at,policy,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9) RETURNING tenant_id`, [member.tenantId, member.objectId, member.resourceId, member.mappingVersion, member.policyVersion, member.active, member.resourceVerifiedAt, policy, at])
        : await tx.query(`UPDATE identity_mappings SET resource_id=$3,mapping_version=$4,policy_version=$5,active=$6,resource_verified_at=$7,policy=$8::jsonb,updated_at=$9
          WHERE tenant_id=$1 AND object_id=$2 AND mapping_version=$10 RETURNING tenant_id`, [member.tenantId, member.objectId, member.resourceId, member.mappingVersion, member.policyVersion, member.active, member.resourceVerifiedAt, policy, at, expectedVersion]);
      if (!result.rows.length) throw controlConflict();
      await this.audit(tx, auditEvent(actor, 'member.saved', 'member', member.objectId, at, { version: member.mappingVersion })); return structuredClone(member);
    });
  }
  async listTemplates(tenantId: string): Promise<PermissionTemplate[]> {
    return this.read(async () => (await this.client.query('SELECT * FROM control_permission_templates WHERE tenant_id=$1 ORDER BY template_key', [tenantId])).rows.map(value => {
      const row = object(value); return { tenantId: row.tenant_id, key: row.template_key, version: row.version, ...(row.policy.areaPermissions!==undefined?{areaPermissions:row.policy.areaPermissions}:{}), capabilities: row.policy.capabilities, companyIds: row.policy.companyIds, ...(typeof row.policy.allCompanies==='boolean'?{allCompanies:row.policy.allCompanies}:{}) };
    }));
  }
  async saveTemplate(actor: ControlActor, template: PermissionTemplate, expectedVersion: number, at: string) {
    if (actor.tenantId !== template.tenantId || template.version !== expectedVersion + 1) throw controlConflict();
    return this.tx(async tx => {
      const policy = JSON.stringify({ ...(template.areaPermissions!==undefined?{areaPermissions:template.areaPermissions}:{}), capabilities: template.capabilities, companyIds: template.companyIds, ...(template.allCompanies===undefined?{}:{allCompanies:template.allCompanies}) });
      const result = expectedVersion === 0
        ? await tx.query('INSERT INTO control_permission_templates (tenant_id,template_key,version,policy) VALUES ($1,$2,$3,$4::jsonb) RETURNING version', [actor.tenantId, template.key, template.version, policy])
        : await tx.query('UPDATE control_permission_templates SET version=$3,policy=$4::jsonb WHERE tenant_id=$1 AND template_key=$2 AND version=$5 RETURNING version', [actor.tenantId, template.key, template.version, policy, expectedVersion]);
      if (!result.rows.length) throw controlConflict(); await this.audit(tx, auditEvent(actor, 'template.saved', 'template', template.key, at, { version: template.version })); return structuredClone(template);
    });
  }
  async getControls(tenantId: string): Promise<DispatchControls> {
    return this.read(async () => {
      const row = (await this.client.query('SELECT * FROM control_dispatch_controls WHERE tenant_id=$1', [tenantId])).rows[0];
      return row ? { tenantId, version: object(row).version, writePaused: object(row).write_paused, tools: object(row).tools } : { tenantId, version: 0, writePaused: false, tools: {} };
    });
  }
  async saveControls(actor: ControlActor, controls: DispatchControls, expectedVersion: number, at: string) {
    if (actor.tenantId !== controls.tenantId || controls.version !== expectedVersion + 1) throw controlConflict();
    return this.tx(async tx => {
      const result = expectedVersion === 0
        ? await tx.query('INSERT INTO control_dispatch_controls (tenant_id,version,write_paused,tools) VALUES ($1,$2,$3,$4::jsonb) RETURNING version', [actor.tenantId, controls.version, controls.writePaused, JSON.stringify(controls.tools)])
        : await tx.query('UPDATE control_dispatch_controls SET version=$2,write_paused=$3,tools=$4::jsonb WHERE tenant_id=$1 AND version=$5 RETURNING version', [actor.tenantId, controls.version, controls.writePaused, JSON.stringify(controls.tools), expectedVersion]);
      if (!result.rows.length) throw controlConflict(); await this.audit(tx, auditEvent(actor, 'controls.saved', 'controls', 'dispatch', at, { version: controls.version })); return structuredClone(controls);
    });
  }
  async listHistory(tenantId:string,filter:HistoryFilter){
    return this.read(async()=>{
      const audit=filter.kind==='audit',at=audit?'at':'created_at',action=audit?'action':'operation',state=audit?"details->>'state'":'state';
      const args:unknown[]=[tenantId],where=[audit?'tenant_id=$1':"split_part(actor_key, ':', 1)=$1"];
      const param=(value:unknown)=>{args.push(value);return `$${args.length}`;};
      if(filter.user)where.push(`actor_key=${param(`${tenantId}:${filter.user}`)}`);
      if(filter.action)where.push(`${action}=${param(filter.action)}`);
      if(filter.state)where.push(`${state}=${param(filter.state)}`);
      if(filter.from)where.push(`${at}>=${param(filter.from)}::timestamptz`);
      if(filter.to)where.push(`${at}<=${param(filter.to)}::timestamptz`);
      if(filter.cursor)where.push(`(${at},id)<(${param(filter.cursor.at)}::timestamptz,${param(filter.cursor.id)}::uuid)`);
      // Literal substring search: % and _ supplied by users are not wildcards.
      for(const word of (filter.q??'').toLowerCase().split(/\s+/).filter(Boolean)){
        const labelKeys=Object.entries({...auditLabels,...historyActionLabels}).filter(([,label])=>label.toLowerCase().includes(word)).map(([key])=>key);
        const haystack=`lower(concat_ws(' ',id::text,replace(${action},'_',' '),${state}${audit?',target_type,target_id':''}))`;
        where.push(`(strpos(${haystack},${param(word)})>0 OR ${action}=ANY(${param(labelKeys)}::text[]))`);
      }
      const columns=audit?"id,actor_key,action,details->>'state' AS state,at,at AS updated_at,target_type,target_id":'id,actor_key,operation AS action,state,created_at AS at,updated_at';
      const result=await this.client.query(`SELECT ${columns} FROM ${audit?'control_audit':'operation_journal'} WHERE ${where.join(' AND ')} ORDER BY ${at} DESC,id DESC LIMIT ${param(filter.limit+1)}`,args);
      const rows:HistoryItem[]=result.rows.map(value=>{const r=object(value);return{id:r.id,userId:r.actor_key.split(':')[1],action:r.action,...(r.state?{state:r.state}:{}),at:iso(r.at),updatedAt:iso(r.updated_at),...(audit?{targetType:r.target_type,targetId:r.target_id}:{})};});
      return controlPage(rows,filter.limit,r=>r.at);
    });
  }
  async listAudit(tenantId: string, limit: number, cursor?: PageCursor) {
    return this.read(async () => {
      const rows = await this.client.query(`SELECT * FROM control_audit WHERE tenant_id=$1 AND ($2::timestamptz IS NULL OR (at,id) < ($2,$3::uuid)) ORDER BY at DESC,id DESC LIMIT $4`, [tenantId, cursor?.at ?? null, cursor?.id ?? null, limit + 1]);
      return controlPage(rows.rows.map(value => { const r = object(value); return { id: r.id, tenantId: r.tenant_id, actorKey: r.actor_key, action: r.action, targetType: r.target_type, targetId: r.target_id, at: iso(r.at), details: r.details } as AuditEvent; }), limit, r => r.at);
    });
  }
  async listOperations(owner: string, limit: number, cursor?: PageCursor) {
    return this.read(async () => {
      const rows = await this.client.query(`SELECT id,operation,state,created_at,updated_at,result FROM operation_journal WHERE actor_key=$1 AND ($2::timestamptz IS NULL OR (created_at,id) < ($2,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`, [owner, cursor?.at ?? null, cursor?.id ?? null, limit + 1]);
      return controlPage(rows.rows.map(value => { const r = object(value); return { id: r.id as string, operation: r.operation as string, state: r.state as JobRecord['state'] as import('../../contracts/src/index.js').OperationState, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), result: redactJournalResult(r.result) }; }), limit, r => r.createdAt);
    });
  }
  async getOperation(id: string, owner: string) { return new PostgresJournal(this.client).get(id, owner); }
  async enqueue(input: JobReservation, limits: JobLimits): Promise<JobRecord> {
    return this.tx(async tx => {
      // The tenant lock serializes both tenant and actor quotas; the next statement gets a fresh READ COMMITTED snapshot.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`control-jobs:${input.tenantId}`]);
      const old = (await tx.query('SELECT * FROM control_jobs WHERE actor_key=$1 AND request_key=$2', [input.actorKey, input.requestKey])).rows[0];
      if (old) { const prior = jobRecord(old); sameJob(prior, input); return prior; }
      const counts = object((await tx.query(`SELECT count(*)::integer AS tenant_count, count(*) FILTER (WHERE actor_key=$2)::integer AS actor_count FROM control_jobs WHERE tenant_id=$1 AND state IN ('queued','running')`, [input.tenantId, input.actorKey])).rows[0]);
      if (counts.tenant_count >= limits.tenant || counts.actor_count >= limits.actor) throw new AppError('throttled', 'The pending job quota is full.');
      const result = await tx.query(`INSERT INTO control_jobs (id,tenant_id,actor_key,request_key,payload_hash,operation,resource_id,mapping_version,policy_version,state,created_at,updated_at,run_after,expires_at,encrypted_payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$10,$11,$12,$13) RETURNING *`, [input.id, input.tenantId, input.actorKey, input.requestKey, input.payloadHash, input.operation, input.resourceId, input.mappingVersion, input.policyVersion, input.createdAt, input.runAfter, input.expiresAt, input.encryptedPayload]);
      const job = jobRecord(result.rows[0]); await this.audit(tx, auditEvent(jobActor(job), 'job.queued', 'job', job.id, job.createdAt, { state: job.state })); return job;
    });
  }
  async getJob(id: string, owner: string) { return this.read(async () => { const row = (await this.client.query('SELECT * FROM control_jobs WHERE id=$1 AND actor_key=$2', [id, owner])).rows[0]; return row ? jobRecord(row) : undefined; }); }
  async findJob(owner: string, requestKey: string) { return this.read(async () => { const row = (await this.client.query('SELECT * FROM control_jobs WHERE actor_key=$1 AND request_key=$2', [owner, requestKey])).rows[0]; return row ? jobRecord(row) : undefined; }); }
  async listJobs(owner: string, limit: number, cursor?: PageCursor) {
    return this.read(async () => {
      const rows = await this.client.query(`SELECT * FROM control_jobs WHERE actor_key=$1 AND ($2::timestamptz IS NULL OR (created_at,id) < ($2,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`, [owner, cursor?.at ?? null, cursor?.id ?? null, limit + 1]);
      return controlPage(rows.rows.map(jobRecord), limit, j => j.createdAt);
    });
  }
  async claim(workerId: string, at: string, leaseExpiresAt: string): Promise<JobLease | undefined> {
    return this.tx(async tx => {
      const stale = await tx.query(`SELECT * FROM control_jobs WHERE state IN ('queued','running') AND (expires_at <= $1 OR (state='running' AND lease_expires_at <= $1 AND (dispatched OR cancel_requested OR fence >= 10))) ORDER BY run_after,id FOR UPDATE SKIP LOCKED LIMIT 1000`, [at]);
      for (const row of stale.rows) {
        const old = jobRecord(row), state = old.dispatched ? 'uncertain' : old.cancelRequested ? 'cancelled' : old.fence >= 10 ? 'failed' : 'expired';
        await tx.query('UPDATE control_jobs SET state=$2,updated_at=$3 WHERE id=$1', [old.id, state, at]);
        await this.audit(tx, auditEvent(jobActor(old), state === 'uncertain' ? 'job.uncertain' : state === 'cancelled' ? 'job.cancelled' : 'job.expired', 'job', old.id, at, { state, fence: old.fence }));
      }
      const row = (await tx.query(`SELECT * FROM control_jobs WHERE run_after <= $1 AND expires_at > $1 AND NOT cancel_requested AND
        (state='queued' OR (state='running' AND NOT dispatched AND lease_expires_at <= $1 AND fence < 10)) ORDER BY run_after,id FOR UPDATE SKIP LOCKED LIMIT 1`, [at])).rows[0];
      if (!row) return undefined;
      const old = jobRecord(row), token = randomUUID();
      const updated = await tx.query(`UPDATE control_jobs SET state='running',fence=fence+1,lease_token=$2,lease_owner=$3,lease_expires_at=$4,updated_at=$5 WHERE id=$1 RETURNING *`, [old.id, token, workerId, leaseExpiresAt, at]);
      const job = jobRecord(updated.rows[0]); await this.audit(tx, auditEvent(jobActor(job), 'job.claimed', 'job', job.id, at, { state: job.state, fence: job.fence })); return { job, token, fence: job.fence };
    });
  }
  async markDispatch(lease: LeaseIdentity, at: string) {
    return this.tx(async tx => {
      const row = (await tx.query('SELECT * FROM control_jobs WHERE id=$1 FOR UPDATE', [lease.id])).rows[0]; const job = row ? jobRecord(row) : undefined; validLease(job, lease, at);
      if (job.dispatched || job.cancelRequested || Date.parse(job.expiresAt) <= Date.parse(at)) throw controlConflict();
      const changed = await tx.query('UPDATE control_jobs SET dispatched=true,updated_at=$2 WHERE id=$1 RETURNING *', [job.id, at]);
      await this.audit(tx, auditEvent(jobActor(job), 'job.dispatched', 'job', job.id, at, { state: job.state, fence: job.fence })); return jobRecord(changed.rows[0]);
    });
  }
  async finish(lease: LeaseIdentity, state: 'succeeded' | 'failed' | 'uncertain', at: string, operationId?: string) {
    return this.tx(async tx => {
      const row = (await tx.query('SELECT * FROM control_jobs WHERE id=$1 FOR UPDATE', [lease.id])).rows[0]; const job = row ? jobRecord(row) : undefined; validLease(job, lease, at);
      const changed = await tx.query('UPDATE control_jobs SET state=$2,updated_at=$3,operation_id=$4 WHERE id=$1 RETURNING *', [job.id, state, at, operationId ?? null]);
      await this.audit(tx, auditEvent(jobActor(job), 'job.finished', 'job', job.id, at, { state, fence: job.fence })); return jobRecord(changed.rows[0]);
    });
  }
  async cancel(id: string, owner: string, at: string) {
    return this.tx(async tx => {
      const row = (await tx.query('SELECT * FROM control_jobs WHERE id=$1 AND actor_key=$2 FOR UPDATE', [id, owner])).rows[0]; if (!row) throw controlNotFound(); const job = jobRecord(row);
      if (!['queued', 'running'].includes(job.state)) return job;
      const state = job.state === 'queued' ? 'cancelled' : 'running';
      const changed = await tx.query('UPDATE control_jobs SET state=$2,cancel_requested=true,updated_at=$3 WHERE id=$1 RETURNING *', [id, state, at]);
      await this.audit(tx, auditEvent(jobActor(job), state === 'cancelled' ? 'job.cancelled' : 'job.cancel_requested', 'job', id, at, { state })); return jobRecord(changed.rows[0]);
    });
  }
  async purgeJobPayloads(actor: ControlActor, before: string, at: string) {
    return this.tx(async tx => {
      const rows = await tx.query(`UPDATE control_jobs SET encrypted_payload=NULL,payload_purged_at=$3 WHERE tenant_id=$1 AND state NOT IN ('queued','running') AND updated_at < $2 AND encrypted_payload IS NOT NULL RETURNING *`, [actor.tenantId, before, at]);
      for (const row of rows.rows) { const job = jobRecord(row); await this.audit(tx, auditEvent(actor, 'job.payload_purged', 'job', job.id, at, { state: job.state })); }
      return rows.rows.length;
    });
  }
}
