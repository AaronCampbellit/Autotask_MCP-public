import type {HistoryFilter,HistoryItem} from './history.js';
import type { AreaPermission, Capability, JournalRecord, Principal } from '../../contracts/src/index.js';
import type { SqlClient } from '../../storage/src/index.js';

/** These identifiers must come from a verified Entra token, never from a request body. */
export interface ControlActor { tenantId: string; objectId: string }
export interface PageCursor { at: string; id: string }
export interface Page<T> { items: T[]; nextCursor?: PageCursor }
export interface MemberInput { areaPermissions?: AreaPermission[]; allCompanies?: boolean; objectId: string; resourceId: number; active: boolean; capabilities: Capability[]; companyIds: number[] }
export interface PermissionTemplate { areaPermissions?: AreaPermission[]; allCompanies?: boolean; tenantId: string; key: string; version: number; capabilities: Capability[]; companyIds: number[] }
export interface DispatchControls { tenantId: string; version: number; writePaused: boolean; tools: Record<string, boolean> }
export type AuditAction = 'diagnostic.detail_viewed' | 'diagnostic.exported' | 'member.saved' | 'template.saved' | 'controls.saved' | 'job.queued' | 'job.claimed' | 'job.dispatched' | 'job.finished' | 'job.cancelled' | 'job.cancel_requested' | 'job.expired' | 'job.uncertain' | 'job.payload_purged';
export interface AuditEvent {
  id: string; tenantId: string; actorKey: string; action: AuditAction;
  targetType: 'member' | 'template' | 'controls' | 'job' | 'diagnostic'; targetId: string; at: string;
  details: { version?: number; state?: JobState; fence?: number };
}
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'uncertain';
export interface JobRecord {
  id: string; tenantId: string; actorKey: string; requestKey: string; payloadHash: string; operation: string;
  resourceId: number; mappingVersion: number; policyVersion: string;
  state: JobState; createdAt: string; updatedAt: string; runAfter: string; expiresAt: string;
  encryptedPayload?: string; payloadPurgedAt?: string;
  fence: number; leaseToken?: string; leaseOwner?: string; leaseExpiresAt?: string;
  dispatched: boolean; cancelRequested: boolean; operationId?: string;
}
export type JobView = Omit<JobRecord, 'encryptedPayload' | 'leaseToken' | 'leaseOwner' | 'payloadHash' | 'requestKey'>;
export interface JobLease { job: JobRecord; token: string; fence: number }
export interface JobLimits { actor: number; tenant: number }
export interface JobReservation extends Omit<JobRecord, 'state' | 'updatedAt' | 'fence' | 'dispatched' | 'cancelRequested'> {}
export interface LeaseIdentity { id: string; token: string; fence: number }
export type OperationView = Pick<JournalRecord, 'id' | 'operation' | 'state' | 'createdAt' | 'updatedAt' | 'result'>;

export interface ControlPlaneStore {
  readonly backend: 'memory' | 'postgres';
  diagnosticAccess(actor:ControlActor,callId:string,action:'detail'|'export',at:string):Promise<void>;
  health(): Promise<boolean>;
  getMember(actor: ControlActor): Promise<Principal | undefined>;
  listMembers(tenantId: string): Promise<Principal[]>;
  saveMember(actor: ControlActor, member: Principal, expectedVersion: number, at: string): Promise<Principal>;
  listTemplates(tenantId: string): Promise<PermissionTemplate[]>;
  saveTemplate(actor: ControlActor, template: PermissionTemplate, expectedVersion: number, at: string): Promise<PermissionTemplate>;
  getControls(tenantId: string): Promise<DispatchControls>;
  saveControls(actor: ControlActor, controls: DispatchControls, expectedVersion: number, at: string): Promise<DispatchControls>;
  listHistory(tenantId:string, filter:HistoryFilter):Promise<Page<HistoryItem>>;
  listAudit(tenantId: string, limit: number, cursor?: PageCursor): Promise<Page<AuditEvent>>;
  listOperations(actorKey: string, limit: number, cursor?: PageCursor): Promise<Page<OperationView>>;
  getOperation(id: string, actorKey: string): Promise<JournalRecord | undefined>;
  enqueue(job: JobReservation, limits: JobLimits): Promise<JobRecord>;
  getJob(id: string, actorKey: string): Promise<JobRecord | undefined>;
  findJob(actorKey: string, requestKey: string): Promise<JobRecord | undefined>;
  listJobs(actorKey: string, limit: number, cursor?: PageCursor): Promise<Page<JobRecord>>;
  claim(workerId: string, at: string, leaseExpiresAt: string): Promise<JobLease | undefined>;
  markDispatch(lease: LeaseIdentity, at: string): Promise<JobRecord>;
  finish(lease: LeaseIdentity, state: 'succeeded' | 'failed' | 'uncertain', at: string, operationId?: string): Promise<JobRecord>;
  cancel(id: string, actorKey: string, at: string): Promise<JobRecord>;
  purgeJobPayloads(actor: ControlActor, before: string, at: string): Promise<number>;
}

/** Pool.connect or PGlite.transaction makes every mutation and its audit one transaction. */
export interface ControlSqlClient extends SqlClient {
  connect?(): Promise<SqlClient & { release(): void }>;
  transaction?<T>(callback: (client: SqlClient) => Promise<T>): Promise<T>;
}
