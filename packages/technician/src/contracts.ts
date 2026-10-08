import type {NativeFields, NativeValue} from '../../native-fields/src/index.js';
import type {PersonIdentity} from '../../contracts/src/person-identity.js';
import type { DataRecord, Principal } from '../../contracts/src/index.js';

export type TechnicianSource = 'fixture' | 'Autotask';
export type ReferenceKind = 'company' | 'resource' | 'queue' | 'status' | 'category' | 'priority';
export type BusinessReference = { kind: 'id'; id: number; name?: string } | { kind: 'name'; name: string } | { kind: 'self' };
export type ContactReference = { kind: 'id'; id: number } | { kind: 'name'; name: string } | { kind: 'email'; email: string };
export type TechnicianTicketReference = { kind: 'id'; id: number } | { kind: 'ticket_number'; value: string } | { kind: 'ticket_url'; value: string };
export interface ReferenceContext { ticketId?: number; companyId?: number; queueId?: number; categoryId?: number }
export interface ActorBinding { tenantId: string; objectId: string; resourceId: number; mappingVersion: number; policyVersion: string }
export interface ReferenceOption {
  id: number;
  label: string;
  active: boolean;
  /** Server-reviewed visibility/eligibility, never supplied by a tool caller. */
  companyIds: number[];
  queueIds?: number[];
  categoryIds?: number[];
  completed?: boolean;
}
export interface ReferenceCatalog extends ActorBinding {
  source: TechnicianSource;
  version: string;
  validUntil: string;
  kind: ReferenceKind;
  complete: boolean;
  items: ReferenceOption[];
}
export interface ResolvedReference { kind: ReferenceKind; id: number; label: string; active: boolean; match: BusinessReference['kind']; metadataVersion: string }
export interface ResolvedContact { id: number; label: string; email?: string; companyId: number; active: true; match: ContactReference['kind'] }
export type DomainCollection = 'history' | 'checklist' | 'assets' | 'contact' | 'site' | 'requirements';
export type PortCollection = Exclude<DomainCollection, 'requirements'>;
export interface DateWindow { start: string; end: string }
export interface CollectionRequest { limit?: number; cursor?: string; window?: DateWindow }
export interface EvidenceCollection<T = DataRecord> {
  status: 'complete' | 'partial' | 'unavailable' | 'failed';
  scope: string;
  window: DateWindow | null;
  fetched_at: string;
  returned: number;
  complete_within_scope: boolean;
  continuation: string | null;
  items: T[];
  warnings: string[];
}
export interface CategoryRule {
  categoryId: number;
  queueRequired: 'always' | 'when_unassigned' | 'never';
  completionRequiredFields: ('title' | 'description' | 'resolution')[];
  requiredCollections: PortCollection[];
  /** Application rule, separately reviewed; the native API does not enforce it. */
  requireImportantChecklistComplete: boolean;
}
export interface TechnicianMetadata extends ActorBinding {
  source: TechnicianSource;
  version: string;
  validUntil: string;
  ticketId: number;
  companyId: number;
  options: Record<Exclude<ReferenceKind, 'company'>, ReferenceOption[]>;
  assignments: { resourceId: number; queueId: number | null; roleId: number; roleLabel?: string; isDefault?: boolean; categoryIds: number[] }[];
  categoryRules: CategoryRule[];
  statusTransitions: { fromId: number; toId: number; categoryId: number }[];
}
/** Public semantic changes. Arbitrary API fields, finance fields and company moves are excluded. */
export interface TicketChanges {
  fields?: NativeFields;
  person_identities?: Record<string,PersonIdentity>;
  work_type?: number|string|null;
  description?: string;
  issue_type?: number | string;
  sub_issue_type?: number | string | null;
  due_datetime?: string;
  opportunity_id?: number;
  contact?: ContactReference | null;
  /** Direct native ID alias for callers that resolved a contact beforehand. */
  contact_id?: number | null;
  contact_identity?: {name?:string;email?:string};
  title?: string;
  owner?: BusinessReference | null;
  queue?: BusinessReference | null;
  status?: BusinessReference;
  category?: BusinessReference;
  priority?: BusinessReference;
  resolution?: string;
}
export type TicketBusinessField = 'issueType' | 'subIssueType' | 'dueDateTime' | 'opportunityID' | 'contactID' | 'title' | 'description' | 'assignedResourceID' | 'assignedResourceRoleID' | 'queueID' | 'status' | 'ticketCategory' | 'priority' | 'resolution';
export type TicketExpectedState = NativeFields;
export type ResolvedTicketChanges = NativeFields;
export interface TicketUpdateInput { classification_override?:string; ticket: TechnicianTicketReference; changes: TicketChanges; expected: TicketExpectedState }
export interface PreparedTicketUpdate {
  version: 1;
  source: TechnicianSource;
  actor: ActorBinding;
  ticketId: number;
  companyId: number;
  metadataVersion: string;
  metadataFingerprint: string;
  input: TicketUpdateInput;
  changes: ResolvedTicketChanges;
  /** Full relevant business state; note/time activity timestamps are deliberately excluded. */
  expected: TicketExpectedState;
  completion: boolean;
  resolved: Partial<Record<keyof TicketChanges, ResolvedReference | ResolvedContact>>;
}
export interface TicketRequirements {
  metadata_version: string;
  category_id: number;
  completion_statuses: { id: number; label: string }[];
  fields: { field: CategoryRule['completionRequiredFields'][number]; fulfilled: boolean }[];
  required_collections: PortCollection[];
  unmet: string[];
  eligible: boolean;
  complete_within_scope: boolean;
}
export interface TechnicianTicketContext {
  ticket:DataRecord;
  collections:Partial<Record<PortCollection,EvidenceCollection>> & {requirements?:EvidenceCollection<TicketRequirements>};
}
export interface OwnWorkRequest { max_pages?: number; cursors?: Partial<Record<'assigned_tickets' | 'tasks' | 'time', string>> }
export interface OwnWorkEvidence {
  assigned_tickets: EvidenceCollection;
  tasks: EvidenceCollection;
  /** Distinct from assigned/due work; this port does not infer recorded time. */
  time: EvidenceCollection;
}
export interface TicketUpdateVerification { ticket?: DataRecord; verified: boolean; matched_fields: string[]; warnings: string[] }
export interface TechnicianPort {
  resolveTicketFields?(p:Principal,ticketId:number,fields:NativeFields,identities?:Record<string,PersonIdentity>):Promise<NativeFields>;
  resolveWorkType?(p:Principal,ticketId:number,value:number|string|null):Promise<number|null>;
  resolveIssuePair?(p:Principal,ticketId:number,issue:number|string|undefined,sub:number|string|null|undefined):Promise<{issueType:number;subIssueType:number|null}>;
  validateClassification?(p:Principal,ticketId:number,selection:{categoryId:number;queueId:number|null;workTypeId?:number|null},override?:string):Promise<void>;
  readonly source: TechnicianSource;
  assertOpportunity?(p:Principal,companyId:number,opportunityId:number):Promise<void>;
  resolveContact?(p:Principal,companyId:number,reference:ContactReference):Promise<ResolvedContact>;
  getTicket(principal: Principal, ticketId: number): Promise<DataRecord>;
  findTicket(principal: Principal, ticketNumber: string): Promise<DataRecord>;
  catalog(principal: Principal, kind: ReferenceKind, context?: ReferenceContext): Promise<ReferenceCatalog>;
  metadata(principal: Principal, ticketId: number): Promise<TechnicianMetadata>;
  collection(principal: Principal, ticketId: number, name: PortCollection, request: CollectionRequest): Promise<EvidenceCollection>;
  getTask(principal: Principal, taskId: number): Promise<{task:DataRecord;companyId:number}>;
  ownWork(principal: Principal, window: DateWindow, workDate?: string, request?: OwnWorkRequest): Promise<OwnWorkEvidence>;
  /** Only a freshly revalidated resolved plan reaches this internal mutation method. */
  patchTicket(principal: Principal, plan: PreparedTicketUpdate): Promise<void>;
}
