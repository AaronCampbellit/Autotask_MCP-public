export type DataRecord = { id: number; [key: string]: unknown };
export type Capability = 'documentation.read' | 'documentation.write' | 'rmm.read' | 'rmm.execute' | 'rmm.write' | 'operational.read' | 'tickets.write' | 'time.self' | 'time.team' | 'time.approve' | 'scheduling.write' | 'finance.read' | 'sales.write' | 'finance.write' | 'projects.write' | 'procurement.write' | 'configuration.write' | 'expenses.write' | 'platform.manage' | 'audit.read';
export const permissionAreas = ['tickets', 'clients', 'time', 'scheduling', 'projects', 'sales', 'finance', 'purchasing', 'inventory', 'configuration', 'expenses'] as const;
export type PermissionArea = typeof permissionAreas[number];
export type AreaPermission = `${PermissionArea}.${'read' | 'write'}`;
export interface Principal {
  /** Authoritative area grants. Absent only for legacy policies pending conversion. */
  areaPermissions?: AreaPermission[];
  tenantId: string;
  objectId: string;
  resourceId: number;
  mappingVersion: number;
  policyVersion: string;
  capabilities: Capability[];
  companyIds: number[];
  allCompanies?: boolean;
  active: boolean;
  resourceVerifiedAt: string;
}
export interface PrincipalStore {
  get(tenantId: string, objectId: string): Promise<Principal | undefined>;
}
export type ErrorCode = 'invalid_input' | 'unauthenticated' | 'forbidden' | 'not_found_or_inaccessible' | 'unsupported_operation' | 'missing_metadata' | 'precondition_failed' | 'conflict' | 'throttled' | 'dependency_unavailable' | 'unknown_outcome' | 'identity_mapping_invalid' | 'identity_validation_unavailable' | 'impersonation_not_qualified';
export interface UpstreamFailure {
  reason: 'timeout' | 'transport_failure' | 'http_error' | 'invalid_response' | 'missing_record_id' | 'start_stop_required';
  http_status?: number;
}
export class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false, public readonly upstreamFailure?: UpstreamFailure) {
    super(message);
    this.name = 'AppError';
  }
}
export type Entity = 'Tickets' | 'TicketNotes' | 'TimeEntries' | 'Companies';
export type Filter = { field: string; op: 'eq' | 'in' | 'contains' | 'gte' | 'lte' | 'lt'; value: unknown };
export interface QueryRequest {
  entity: Entity;
  filters: Filter[];
  pageSize: number;
  cursor?: string;
  parentId?: number;
}
export interface Page {
  items: DataRecord[];
  nextCursor: string | null;
  fetchedAt: string;
}
export type NoteAudience = 'internal' | 'customer';
export interface WriteOption { id: number; label: string; active: boolean }
/** Server-owned, operation-specific metadata; no values are accepted from tool arguments. */
export interface TicketWorkMetadata {
  version: string;
  source: 'fixture' | 'Autotask';
  ticketId: number;
  resourceId: number;
  mappingVersion: number;
  policyVersion: string;
  validUntil: string;
  note: {
    titleRequired: boolean;
    attributionField: 'creatorResourceID' | 'impersonatorCreatorResourceID';
    types: WriteOption[];
    audiences: { audience: NoteAudience; publish: number; label: string; active: boolean }[];
    defaultTypeId?: number;
  };
  time: {
    eligible: boolean;
    roles: WriteOption[];
    workTypes: WriteOption[];
    defaultRoleId?: number;
    defaultWorkTypeId?: number;
    classification?: {category?:string;queue?:string};
  };
  defaultRuleVersion: string;
}
export interface TicketNoteCreate {
  title?: string;
  description: string;
  noteType: number;
  publish: number;
}
export interface TicketTimeCreate {
  resourceID: number;
  roleID: number;
  billingCodeID: number;
  hoursWorked: number;
  dateWorked: string;
  startDateTime?: string;
  endDateTime?: string;
  summaryNotes: string;
  internalNotes?: string;
}
export interface AutotaskPort {
  readonly source: 'fixture' | 'Autotask';
  resolveOpenTicketStatuses?(principal: Principal): Promise<number[]>;
  readonly supportsTicketStatusLookup?: boolean;
  resolveTicketStatus?(principal: Principal, reference: {kind: 'id'; id: number} | {kind: 'name'; name: string}): Promise<number>;
  query(principal: Principal, request: QueryRequest): Promise<Page>;
  countTickets(principal: Principal, filters: Filter[]): Promise<number>;
  get(principal: Principal, entity: Entity, id: number): Promise<DataRecord>;
  patchTicket(principal: Principal, id: number, changes: Record<string, unknown>): Promise<void>;
  ticketWorkMetadata(principal: Principal, ticketId: number): Promise<TicketWorkMetadata>;
  createTicketNote(principal: Principal, ticketId: number, payload: TicketNoteCreate): Promise<{ id: number }>;
  getTicketNote(principal: Principal, ticketId: number, id: number): Promise<DataRecord>;
  createTicketSecondaryResource?(principal: Principal, ticketId: number, resourceId: number, roleId: number, beforeDispatch: () => Promise<void>): Promise<{ id: number }>;
  getTicketSecondaryResource?(principal: Principal, ticketId: number, id: number): Promise<DataRecord>;
  deleteTicketSecondaryResource?(principal: Principal, ticketId: number, id: number, beforeDispatch: () => Promise<void>): Promise<void>;
  createTicketTagAssociation?(principal: Principal, ticketId: number, tagId: number, beforeDispatch: () => Promise<void>): Promise<{ id: number }>;
  deleteTicketTagAssociation?(principal: Principal, ticketId: number, associationId: number, beforeDispatch: () => Promise<void>): Promise<void>;
  applyTicketChecklistLibrary?(principal: Principal, ticketId: number, libraryId: number, beforeDispatch: () => Promise<void>): Promise<{ id: number }>;
  /** Read-only validation of the complete proposed own-time payload before related writes. */
  validateTicketTime(principal: Principal, ticketId: number, payload: TicketTimeCreate, prepared?: TicketWorkMetadata): Promise<void>;
  createTicketTime(principal: Principal, ticketId: number, payload: TicketTimeCreate): Promise<{ id: number }>;
  getTicketTime(principal: Principal, ticketId: number, id: number): Promise<DataRecord>;
}
export type OperationState = 'ready' | 'dispatching' | 'succeeded_verified' | 'accepted_unverified' | 'failed' | 'unknown_outcome' | 'partial';
export interface JournalRecord {
  id: string;
  actorKey: string;
  requestKey: string;
  payloadHash: string;
  operation: string;
  mappingVersion: number;
  resourceId: number;
  policyVersion: string;
  state: OperationState;
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
  encryptedIntent?: string;
  intentExpiresAt?: string;
}
export interface Journal {
  reserve(input: Omit<JournalRecord, 'id' | 'state' | 'createdAt' | 'updatedAt'>): Promise<{ record: JournalRecord; created: boolean }>;
  transition(id: string, expected: OperationState, next: OperationState, result?: Record<string, unknown>): Promise<JournalRecord>;
  get(id: string, actorKey: string): Promise<JournalRecord | undefined>;
  find(actorKey: string, requestKey: string): Promise<JournalRecord | undefined>;
}
export const actorKey = (principal: Principal): string => `${principal.tenantId}:${principal.objectId}`;
export function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Autotask's internal company uses ID 0; other record identifiers remain positive. */
export function validCompanyId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export const salesJournalOperations = ['sales_opportunities_create', 'sales_opportunities_update', 'sales_quotes_create', 'sales_quotes_update', 'sales_quoteitems_create', 'sales_quoteitems_update', 'sales_quoteitems_delete', 'sales_companynotes_create', 'sales_quotelocations_create'] as const;
export const attachmentJournalOperations = ['opportunity_attachment_upload','opportunity_attachment_delete','ticket_attachment_upload', 'ticket_attachment_delete'] as const;
