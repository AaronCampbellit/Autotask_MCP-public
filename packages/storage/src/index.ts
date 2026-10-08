import { validAreaPermissions } from '../../policy/src/areas.js';
import {businessEntities, documentedWrites} from '../../business/src/contracts.js';
import { randomUUID } from 'node:crypto';
import {
  AppError, positiveId, validCompanyId, salesJournalOperations, attachmentJournalOperations,
  type Capability, type Journal, type JournalRecord, type OperationState,
  type Principal, type PrincipalStore,
} from '../../contracts/src/index.js';
import { MAX_ENCRYPTED_INTENT_LENGTH } from './intent-cipher.js';
export { IntentCipher } from './intent-cipher.js';

/** Both pg Pool/Client and an in-memory PGlite instance implement this surface. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

type Reservation = Parameters<Journal['reserve']>[0];
const transitions: Record<OperationState, readonly OperationState[]> = {
  ready: ['dispatching', 'failed'],
  dispatching: ['succeeded_verified', 'accepted_unverified', 'failed', 'unknown_outcome', 'partial', 'dispatching'],
  accepted_unverified: ['succeeded_verified', 'failed', 'unknown_outcome', 'partial'],
  unknown_outcome: ['succeeded_verified', 'failed', 'partial'],
  succeeded_verified: [],
  failed: [],
  partial: ['dispatching', 'failed'],
};
const capabilities: readonly Capability[] = [
  'documentation.read', 'documentation.write',
  'operational.read', 'tickets.write', 'time.self', 'time.team', 'time.approve', 'scheduling.write',
  'finance.read', 'sales.write', 'finance.write', 'projects.write', 'procurement.write', 'configuration.write', 'expenses.write', 'rmm.read', 'rmm.execute', 'rmm.write', 'platform.manage', 'audit.read',
];
const errorCodes = new Set([
  'invalid_input', 'unauthenticated', 'forbidden', 'not_found_or_inaccessible',
  'unsupported_operation', 'missing_metadata', 'precondition_failed', 'conflict',
  'throttled', 'dependency_unavailable', 'unknown_outcome', 'identity_mapping_invalid',
  'identity_validation_unavailable', 'impersonation_not_qualified',
]);
export const JOURNAL_WARNINGS = {
  unknownOutcome: 'The update outcome is unknown. Inspect the operation before retrying.',
  acceptedUnverified: 'The update was accepted but could not be verified.',
  concurrency: 'Read-before-write is not an atomic upstream compare-and-swap.',
} as const;
const allowedWarnings = new Set<string>(Object.values(JOURNAL_WARNINGS));
const matchedFields = new Set([
  'opportunityID', 'title', 'description', 'noteType', 'publish', 'ticketID', 'resourceID', 'roleID',
  'billingCodeID', 'hoursWorked', 'dateWorked', 'summaryNotes', 'internalNotes',
  'creatorResourceID', 'impersonatorCreatorResourceID', 'startDateTime', 'endDateTime',
  'issueType', 'subIssueType', 'status', 'queueID', 'assignedResourceID', 'assignedResourceRoleID', 'ticketCategory', 'priority', 'resolution',
]);
const versionIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const childStates = new Set(Object.keys(transitions).filter((state) => state !== 'partial'));
export const workflowRoots = ['ticket_document_work', 'ticket_handoff', 'ticket_resolve', 'service_call_create'] as const;
const domainIntentOperations = new Set([...Object.entries(documentedWrites).flatMap(([entity, actions]) => actions.map(action => `business_${entity.toLowerCase()}_${action}`)), 'service_call_update', 'service_call_cancel', 'time_log_ticket', 'time_log_task', 'time_log_internal', 'time_correct', 'time_delete', 'time_billing_approval_record', 'expense_report_create', 'expense_item_add', 'expense_report_submit', 'resource_availability_update', 'time_off_request', 'time_off_cancel', 'time_off_approve', 'time_off_reject', 'checklist_item_create', 'checklist_item_update', 'checklist_item_delete']);
const isWorkflowRoot = (operation: string) => workflowRoots.includes(operation as typeof workflowRoots[number]);

function safeFields(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((field): field is string =>
    typeof field === 'string' && matchedFields.has(field)))] : [];
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safeTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_+/-]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

function validInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString() === `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Receipts retain bounded identifiers and verification, never titles or note/time text. */
export function redactJournalResult(value?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const result: Record<string, unknown> = {};
  if(validCompanyId(value.company_id))result.company_id=value.company_id;
  if(positiveId(value.native_id))result.native_id=value.native_id;
  if([...businessEntities,'Opportunities','Quotes','QuoteItems','CompanyNotes','QuoteLocations'].includes(String(value.entity)))result.entity=value.entity;
  if(['create','update','delete'].includes(String(value.action)))result.action=value.action;
  if(typeof value.location_digest==='string'&&/^[a-f0-9]{64}$/.test(value.location_digest))result.location_digest=value.location_digest;
  if(typeof value.verified==='boolean')result.verified=value.verified;
  if(isObject(value.attribution)){const a=value.attribution;result.attribution=Object.fromEntries(['creatorResourceID','impersonatorCreatorResourceID','lastModifiedBy'].map(k=>[k,positiveId(a[k])?a[k]:null]));}
  for (const field of ['opportunity_id','ticket_id', 'note_id', 'time_entry_id', 'recorded_resource_id', 'service_call_id', 'service_call_ticket_id', 'assigned_resource_id', 'queue_id', 'status_id', 'report_id', 'expense_report_id', 'expense_item_id', 'availability_id', 'time_off_id', 'attachment_id', 'item_id', 'task_id', 'project_id']) {
    if (positiveId(value[field])) result[field] = value[field];
  }
  for (const key of ['start_datetime','end_datetime']) if (validInstant(value[key])) result[key] = value[key];
  if (['user','calendar','chat','current_time'].includes(value.timing_source as string)) result.timing_source = value.timing_source;
  if (['start_plus_duration','end_minus_duration','explicit_interval'].includes(value.timing_basis as string)) result.timing_basis = value.timing_basis;
  if (value.audience === 'internal' || value.audience === 'customer') result.audience = value.audience;
  if (typeof value.requires_time === 'boolean') result.requires_time = value.requires_time;
  if (typeof value.hours_worked === 'number' && Number.isFinite(value.hours_worked)
      && value.hours_worked > 0 && value.hours_worked <= 24) result.hours_worked = value.hours_worked;
  if (validDate(value.work_date)) result.work_date = value.work_date;
  if (safeTimezone(value.timezone)) result.timezone = value.timezone;
  for (const field of ['start', 'end']) if (typeof value[field] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value[field] as string) && Number.isFinite(Date.parse(value[field] as string))) result[field] = value[field];
  if (Array.isArray(value.resource_ids) && value.resource_ids.length <= 10 && value.resource_ids.every(positiveId)) result.resource_ids = [...new Set(value.resource_ids)];
  if (Array.isArray(value.scheduling_steps)) result.scheduling_steps = value.scheduling_steps.filter(step => isObject(step)
    && typeof step.key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(step.key)
    && typeof step.operation_id === 'string' && uuid.test(step.operation_id)
    && typeof step.state === 'string' && childStates.has(step.state)
    && Number.isInteger(step.attempt) && Number(step.attempt) >= 1 && Number(step.attempt) <= 10).slice(0, 12).map(step => ({
      key: step.key, operation_id: step.operation_id, state: step.state, attempt: step.attempt,
      ...(positiveId(step.native_id) ? { native_id: step.native_id } : {}), ...(positiveId(step.resource_id) ? { resource_id: step.resource_id } : {}),
    }));
  if (typeof value.metadata_version === 'string' && versionIdentifier.test(value.metadata_version)) {
    result.metadata_version = value.metadata_version;
  }
  if (isObject(value.steps)) {
    const steps: Record<string, unknown> = {};
    for (const name of ['note', 'time', 'update']) {
      const step = value.steps[name];
      if (!isObject(step) || typeof step.operation_id !== 'string' || !uuid.test(step.operation_id)
          || typeof step.state !== 'string' || !childStates.has(step.state)
          || !Number.isInteger(step.attempt) || Number(step.attempt) < 1 || Number(step.attempt) > 10) continue;
      steps[name] = {
        operation_id: step.operation_id, state: step.state, attempt: step.attempt,
        ...(positiveId(step.native_id) ? { native_id: step.native_id } : {}),
      };
    }
    result.steps = steps;
  }
  if (Array.isArray(value.defaults)) {
    result.defaults = value.defaults.filter((entry) => isObject(entry)
      && ['note_type', 'role', 'work_type'].includes(String(entry.field))
      && ['explicit', 'reviewed_default'].includes(String(entry.source))
      && typeof entry.rule_version === 'string' && versionIdentifier.test(entry.rule_version)
      && positiveId(entry.id)).slice(0, 3).map((entry) => ({
      field: entry.field, source: entry.source, rule_version: entry.rule_version, id: entry.id,
    }));
  }
  if (Array.isArray(value.matched_fields)) {
    result.matched_fields = safeFields(value.matched_fields);
  }
  if (isObject(value.verification) && typeof value.verification.performed === 'boolean') {
    result.verification = {
      performed: value.verification.performed,
      matched_fields: safeFields(value.verification.matched_fields),
    };
  }
  if (typeof value.error_code === 'string' && errorCodes.has(value.error_code)) {
    result.error_code = value.error_code;
  }
  // Persist only finite diagnostic categories and HTTP status, never native bodies,
  // arbitrary exception messages, headers, URLs or credentials.
  if (isObject(value.upstream_failure) && ['timeout', 'transport_failure', 'http_error', 'invalid_response', 'missing_record_id', 'start_stop_required'].includes(value.upstream_failure.reason as string)) {
    const failure = value.upstream_failure;
    result.upstream_failure = {
      reason: failure.reason,
      ...(typeof failure.http_status === 'number' && Number.isInteger(failure.http_status) && failure.http_status >= 100 && failure.http_status <= 599 ? { http_status: failure.http_status } : {}),
    };
  }
  if (Array.isArray(value.warnings)) {
    result.warnings = value.warnings.filter((warning): warning is string =>
      typeof warning === 'string' && allowedWarnings.has(warning));
  }
  return result;
}

function validateReservation(input: Reservation): void {
  if (typeof input.actorKey !== 'string' || !/^[^:\s]{1,256}:[^:\s]{1,256}$/.test(input.actorKey)
      || typeof input.requestKey !== 'string' || !input.requestKey.trim()
      || input.requestKey.length > 256 || input.requestKey.includes('\0')
      || typeof input.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.payloadHash)
      || typeof input.operation !== 'string' || !/^[a-z][a-z0-9_.-]{0,99}$/.test(input.operation)
      || !positiveId(input.mappingVersion) || !positiveId(input.resourceId)
      || typeof input.policyVersion !== 'string' || !input.policyVersion || input.policyVersion.length > 256) {
    throw new AppError('invalid_input', 'The operation journal request is invalid.');
  }
  const hasIntent = input.encryptedIntent !== undefined;
  const hasExpiry = input.intentExpiresAt !== undefined;
  if (hasIntent !== hasExpiry || (hasIntent && (
    !(domainIntentOperations.has(input.operation)||isWorkflowRoot(input.operation)||input.operation==='ticket_create'||input.operation==='ticket_update'||(salesJournalOperations as readonly string[]).includes(input.operation)||(attachmentJournalOperations as readonly string[]).includes(input.operation)) || typeof input.encryptedIntent !== 'string'
    || input.encryptedIntent.length > MAX_ENCRYPTED_INTENT_LENGTH
    || !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/.test(input.encryptedIntent)
    || !validInstant(input.intentExpiresAt)
  ))) throw new AppError('invalid_input', 'The encrypted workflow intent or its expiry is invalid.');
}

function assertSameReservation(record: JournalRecord, input: Reservation): void {
  if (record.payloadHash !== input.payloadHash || record.operation !== input.operation
      || record.mappingVersion !== input.mappingVersion || record.resourceId !== input.resourceId
      || record.policyVersion !== input.policyVersion) {
    throw new AppError('conflict', 'This request key already belongs to different work or an earlier employee mapping.');
  }
}

function assertTransition(expected: OperationState, next: OperationState): void {
  if (!transitions[expected]?.includes(next)) {
    throw new AppError('conflict', 'This operation cannot enter the requested state. Inspect its recorded outcome before continuing.');
  }
}

function conflict(): AppError {
  return new AppError('conflict', 'The operation state changed. Retrieve its current status before continuing.');
}

function journalUnavailable(): AppError {
  return new AppError('dependency_unavailable', 'The operation journal is unavailable. No new dispatch is authorized.');
}

function dateString(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw journalUnavailable();
  return date.toISOString();
}

function journalRecord(value: unknown): JournalRecord {
  if (!isObject(value)) throw journalUnavailable();
  const state = String(value.state) as OperationState;
  if (!Object.hasOwn(transitions, state)) throw journalUnavailable();
  return {
    id: String(value.id), actorKey: String(value.actor_key), requestKey: String(value.request_key),
    payloadHash: String(value.payload_hash), operation: String(value.operation),
    mappingVersion: Number(value.mapping_version), resourceId: Number(value.resource_id), policyVersion: String(value.policy_version), state,
    createdAt: dateString(value.created_at), updatedAt: dateString(value.updated_at),
    ...(isObject(value.result) ? { result: redactJournalResult(value.result) } : {}),
    ...(typeof value.encrypted_intent === 'string' ? {
      encryptedIntent: value.encrypted_intent, intentExpiresAt: dateString(value.intent_expires_at),
    } : {}),
  };
}

/** A durable reservation plus one compare-and-set claim precedes every dispatch. */
export class PostgresJournal implements Journal {
  constructor(private readonly client: SqlClient) {}

  async reserve(input: Reservation): Promise<{ record: JournalRecord; created: boolean }> {
    validateReservation(input);
    try {
      const inserted = await this.client.query(
        `INSERT INTO operation_journal
          (id, actor_key, request_key, payload_hash, operation, mapping_version, resource_id, policy_version, result,
           encrypted_intent, intent_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
         ON CONFLICT (actor_key, request_key) DO NOTHING RETURNING *`,
        [randomUUID(), input.actorKey, input.requestKey, input.payloadHash, input.operation,
          input.mappingVersion, input.resourceId, input.policyVersion, input.result ? JSON.stringify(redactJournalResult(input.result)) : null,
          input.encryptedIntent ?? null, input.intentExpiresAt ?? null],
      );
      if (inserted.rows[0]) return { record: journalRecord(inserted.rows[0]), created: true };
      // A separate statement sees the committed conflicting row under READ COMMITTED.
      const existing = await this.client.query(
        'SELECT * FROM operation_journal WHERE actor_key = $1 AND request_key = $2',
        [input.actorKey, input.requestKey],
      );
      if (!existing.rows[0]) throw journalUnavailable();
      const record = journalRecord(existing.rows[0]);
      assertSameReservation(record, input);
      return { record, created: false };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw journalUnavailable();
    }
  }

  async transition(id: string, expected: OperationState, next: OperationState,
    result?: Record<string, unknown>): Promise<JournalRecord> {
    assertTransition(expected, next);
    try {
      const changed = await this.client.query(
        `UPDATE operation_journal SET state = $3, updated_at = clock_timestamp(),
           result = CASE WHEN $4::jsonb IS NULL THEN result ELSE $4::jsonb END
         WHERE id = $1 AND state = $2
           AND (($2 <> 'partial' AND $3 <> 'partial' AND NOT ($2 = 'dispatching' AND $3 = 'dispatching'))
             OR operation IN ('ticket_document_work','ticket_handoff','ticket_resolve','service_call_create')) RETURNING *`,
        [id, expected, next, result ? JSON.stringify(redactJournalResult(result)) : null],
      );
      if (!changed.rows[0]) throw conflict();
      return journalRecord(changed.rows[0]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw journalUnavailable();
    }
  }

  async get(id: string, actorKey: string): Promise<JournalRecord | undefined> {
    try {
      const result = await this.client.query(
        'SELECT * FROM operation_journal WHERE id = $1 AND actor_key = $2', [id, actorKey],
      );
      return result.rows[0] ? journalRecord(result.rows[0]) : undefined;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw journalUnavailable();
    }
  }

  async find(actorKey: string, requestKey: string): Promise<JournalRecord | undefined> {
    try {
      const result = await this.client.query(
        'SELECT * FROM operation_journal WHERE actor_key = $1 AND request_key = $2', [actorKey, requestKey],
      );
      return result.rows[0] ? journalRecord(result.rows[0]) : undefined;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw journalUnavailable();
    }
  }
}

function mappedPrincipal(value: unknown): Principal {
  const invalid = (): AppError => new AppError('identity_mapping_invalid', 'The employee mapping or permission policy is invalid.');
  if (!isObject(value) || !isObject(value.policy)) throw invalid();
  const policy = value.policy;
  const resourceId = Number(value.resource_id);
  const mappingVersion = Number(value.mapping_version);
  if (typeof value.tenant_id !== 'string' || typeof value.object_id !== 'string'
      || !positiveId(resourceId) || !positiveId(mappingVersion)
      || typeof value.active !== 'boolean' || typeof value.policy_version !== 'string'
      || (policy.areaPermissions!==undefined&&!validAreaPermissions(policy.areaPermissions))
      || !value.policy_version || !Array.isArray(policy.capabilities)
      || !policy.capabilities.every((item) => capabilities.includes(item as Capability))
      || (policy.allCompanies!==undefined&&typeof policy.allCompanies!=='boolean') || !Array.isArray(policy.companyIds) || !policy.companyIds.every(validCompanyId)) throw invalid();
  const verifiedAt = value.resource_verified_at instanceof Date
    ? value.resource_verified_at : new Date(String(value.resource_verified_at));
  if (!Number.isFinite(verifiedAt.getTime())) throw invalid();
  return {
    tenantId: value.tenant_id, objectId: value.object_id, resourceId, mappingVersion,
    policyVersion: value.policy_version, active: value.active,
    ...(policy.areaPermissions!==undefined?{areaPermissions:policy.areaPermissions as import('../../contracts/src/index.js').AreaPermission[]}:{}), capabilities: [...policy.capabilities] as Capability[], companyIds: [...policy.companyIds], ...(policy.allCompanies!==undefined?{allCompanies:policy.allCompanies as boolean}:{}),
    resourceVerifiedAt: verifiedAt.toISOString(),
  };
}

export class PostgresPrincipalStore implements PrincipalStore {
  constructor(private readonly client: SqlClient) {}

  async get(tenantId: string, objectId: string): Promise<Principal | undefined> {
    try {
      const result = await this.client.query(
        'SELECT * FROM identity_mappings WHERE tenant_id = $1 AND object_id = $2', [tenantId, objectId],
      );
      return result.rows[0] ? mappedPrincipal(result.rows[0]) : undefined;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('identity_validation_unavailable', 'Employee identity validation is unavailable. No business operation is authorized.');
    }
  }
}

/** Non-durable fixture utility. Production must select PostgresJournal explicitly. */
export class MemoryJournal implements Journal {
  private readonly records = new Map<string, JournalRecord>();
  private readonly keys = new Map<string, string>();
  /** Internal fixture activity source; never expose this unscoped snapshot as an API. */
  inspectAll(): JournalRecord[] { return [...this.records.values()].map(record => structuredClone(record)); }

  async reserve(input: Reservation): Promise<{ record: JournalRecord; created: boolean }> {
    validateReservation(input);
    const key = JSON.stringify([input.actorKey, input.requestKey]);
    const priorId = this.keys.get(key);
    const prior = priorId ? this.records.get(priorId) : undefined;
    if (prior) {
      assertSameReservation(prior, input);
      return { record: structuredClone(prior), created: false };
    }
    const now = new Date().toISOString();
    const record: JournalRecord = {
      id: randomUUID(), actorKey: input.actorKey, requestKey: input.requestKey,
      payloadHash: input.payloadHash, operation: input.operation, mappingVersion: input.mappingVersion,
      resourceId: input.resourceId, policyVersion: input.policyVersion,
      state: 'ready', createdAt: now, updatedAt: now,
      ...(input.result ? { result: redactJournalResult(input.result) } : {}),
      ...(input.encryptedIntent ? { encryptedIntent: input.encryptedIntent, intentExpiresAt: input.intentExpiresAt } : {}),
    };
    this.records.set(record.id, record);
    this.keys.set(key, record.id);
    return { record: structuredClone(record), created: true };
  }

  async transition(id: string, expected: OperationState, next: OperationState,
    result?: Record<string, unknown>): Promise<JournalRecord> {
    assertTransition(expected, next);
    const record = this.records.get(id);
    if (!record || record.state !== expected) throw conflict();
    if ((expected === 'partial' || next === 'partial' || (expected === 'dispatching' && next === 'dispatching'))
        && !isWorkflowRoot(record.operation)) throw conflict();
    const changed: JournalRecord = {
      ...record, state: next, updatedAt: new Date().toISOString(),
      ...(result ? { result: redactJournalResult(result) } : {}),
    };
    this.records.set(id, changed);
    return structuredClone(changed);
  }

  async get(id: string, actorKey: string): Promise<JournalRecord | undefined> {
    const record = this.records.get(id);
    return record?.actorKey === actorKey ? structuredClone(record) : undefined;
  }

  async find(actorKey: string, requestKey: string): Promise<JournalRecord | undefined> {
    const id = this.keys.get(JSON.stringify([actorKey, requestKey]));
    return id ? this.get(id, actorKey) : undefined;
  }
}

/** Mutable only to simulate mapping and permission revocation in isolated tests. */
export class MemoryPrincipalStore implements PrincipalStore {
  private readonly records = new Map<string, Principal>();
  constructor(initial: Principal[] = []) { for (const principal of initial) this.set(principal); }
  set(principal: Principal): void {
    this.records.set(JSON.stringify([principal.tenantId, principal.objectId]), structuredClone(principal));
  }
  delete(tenantId: string, objectId: string): void {
    this.records.delete(JSON.stringify([tenantId, objectId]));
  }
  async get(tenantId: string, objectId: string): Promise<Principal | undefined> {
    const principal = this.records.get(JSON.stringify([tenantId, objectId]));
    return principal ? structuredClone(principal) : undefined;
  }
}
