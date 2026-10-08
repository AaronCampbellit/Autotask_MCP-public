import {withReconciliation} from '../../execution/src/index.js';
import {fieldsSchema,valueSchema,fieldMatches} from '../../native-fields/src/index.js';
import {assertPersonIdentity,personIdentitySchema} from '../../contracts/src/person-identity.js';
import { assertArea } from '../../policy/src/areas.js';
import {assertAlignment,numberRange,preferredRole,classificationOverrideSchema} from '../../classification/src/index.js';
import { ticketWebUrl, recordWebUrl } from './web-links.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, positiveId, type DataRecord, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, projectRecord, reauthorize } from '../../policy/src/index.js';
import type { ActorBinding, BusinessReference, CollectionRequest, ContactReference, DateWindow, DomainCollection, EvidenceCollection, PortCollection, PreparedTicketUpdate, ReferenceCatalog, ReferenceContext, ReferenceKind, ReferenceOption, ResolvedContact, ResolvedReference, ResolvedTicketChanges, TechnicianMetadata, TechnicianPort, TechnicianSource, TechnicianTicketContext, TicketBusinessField, TicketExpectedState, TicketRequirements, TicketUpdateInput, TicketUpdateVerification } from './contracts.js';
export type * from './contracts.js';

const id = z.number().int().positive().safe();
const label = z.string().max(250).refine(v => v.trim().length > 0);
const text = (max: number) => z.string().max(max).refine(v => v.trim().length > 0);
export const businessReferenceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('id'), id, name:label.optional().describe('Intended full employee name; required with a numeric owner or handoff target on writes.') }).strict(), z.object({ kind: z.literal('name'), name: label }).strict(), z.object({ kind: z.literal('self') }).strict()]);
export const contactReferenceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('id'), id }).strict(), z.object({ kind: z.literal('name'), name: label }).strict(), z.object({ kind: z.literal('email'), email: z.string().email().max(254) }).strict()]);
export const companyReferenceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('id'), id: z.number().int().nonnegative().safe() }).strict(), z.object({ kind: z.literal('name'), name: label }).strict(), z.object({ kind: z.literal('self') }).strict()]);
export const ticketReferenceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('id'), id }).strict(), z.object({ kind: z.literal('ticket_number'), value: text(100) }).strict(), z.object({ kind: z.literal('ticket_url'), value: text(2048) }).strict()]);
export const referenceKindSchema = z.enum(['company', 'resource', 'queue', 'status', 'category', 'priority']);
export const referenceContextSchema = z.object({ ticketId: id.optional(), companyId: z.number().int().nonnegative().safe().optional(), queueId: id.optional(), categoryId: id.optional() }).strict();
export const ticketChangesSchema = z.object({ fields:fieldsSchema.optional().describe("Native ticket fields from ticket_write_options kind ticket, including userDefinedFields. Supply expected values for every changed field."), person_identities:z.record(z.string(),personIdentitySchema).optional(), work_type:z.union([id,label]).nullable().optional(), description:z.string().max(32000).optional(), contact_identity:personIdentitySchema.optional(), issue_type:z.union([id,label]).optional(),sub_issue_type:z.union([id,label]).nullable().optional(), role:z.union([z.object({kind:z.literal('id'),id}).strict(),z.object({kind:z.literal('name'),name:label}).strict()]).optional(), due_datetime:z.string().datetime({offset:true}).optional(), opportunity_id:id.optional(), contact: contactReferenceSchema.nullable().optional(), contact_id:id.nullable().optional(), title: text(255).optional(), owner: businessReferenceSchema.nullable().optional(), queue: businessReferenceSchema.nullable().optional(), status: businessReferenceSchema.optional(), category: businessReferenceSchema.optional(), priority: businessReferenceSchema.optional(), resolution: text(32000).optional() }).strict().refine(v => Object.keys(v).length > 0).refine(v => !(v.contact !== undefined && v.contact_id !== undefined));
export const ticketExpectedSchema = z.object({ issueType:id.nullable().optional(),subIssueType:id.nullable().optional(), dueDateTime:z.string().datetime({offset:true}).nullable().optional(), opportunityID:id.nullable().optional(), contactID: id.nullable().optional(), title: z.string().max(255).nullable().optional(), description: z.string().max(32000).nullable().optional(), assignedResourceID: id.nullable().optional(), assignedResourceRoleID: id.nullable().optional(), queueID: id.nullable().optional(), status: id.nullable().optional(), ticketCategory: id.nullable().optional(), priority: id.nullable().optional(), resolution: z.string().max(32000).nullable().optional() }).catchall(valueSchema);
export const ticketUpdateSchema = z.object({ classification_override:classificationOverrideSchema.optional(),ticket: ticketReferenceSchema, changes: ticketChangesSchema, expected: ticketExpectedSchema }).strict();
const date = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)));
export const dateWindowSchema = z.object({ start: date, end: date }).strict().refine(v => Date.parse(v.start) < Date.parse(v.end) && Date.parse(v.end) - Date.parse(v.start) <= 93 * 86400000 + 3600000);
export const workDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const stamp=Date.parse(`${v}T00:00:00Z`);return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===v; });
export function timeEvidenceWindow(window:DateWindow,workDate?:string):DateWindow { return workDate===undefined?window:{start:`${parseDomainInput(workDateSchema,workDate)}T00:00:00Z`,end:new Date(Date.parse(`${workDate}T00:00:00Z`)+86400000).toISOString()}; }
export const ownWorkRequestSchema = z.object({max_pages:z.number().int().min(1).max(10).default(4),cursors:z.object({assigned_tickets:z.string().max(16000).optional(),tasks:z.string().max(16000).optional(),time:z.string().max(16000).optional()}).strict().optional()}).strict();
export const collectionRequestSchema = z.object({ limit: z.number().int().min(1).max(500).optional(), cursor: text(4096).optional(), window: dateWindowSchema.optional() }).strict();
export const domainCollectionSchema = z.enum(['history', 'checklist', 'assets', 'contact', 'site', 'requirements']);
const portCollectionSchema = z.enum(['history', 'checklist', 'assets', 'contact', 'site']);
const bindingShape = { tenantId: text(200), objectId: text(200), resourceId: id, mappingVersion: id, policyVersion: text(200) };
export const referenceOptionSchema = z.object({ id, label, active: z.boolean(), companyIds: z.array(z.number().int().nonnegative().safe()).max(500), queueIds: z.array(id).max(500).optional(), categoryIds: z.array(id).max(500).optional(), completed: z.boolean().optional() }).strict();
export const referenceCatalogSchema = z.object({ ...bindingShape, source: z.enum(['fixture', 'Autotask']), version: text(200), validUntil: date, kind: referenceKindSchema, complete: z.boolean(), items: z.array(referenceOptionSchema.extend({id: z.number().int().nonnegative().safe()})).max(5000) }).strict().refine(v => v.kind === 'company' || v.items.every(o => o.id > 0));
export const technicianMetadataSchema = z.object({ ...bindingShape, source: z.enum(['fixture', 'Autotask']), version: text(200), validUntil: date, ticketId: id, companyId: z.number().int().nonnegative().safe(),
  options: z.object({ resource: z.array(referenceOptionSchema).max(5000), queue: z.array(referenceOptionSchema).max(5000), status: z.array(referenceOptionSchema).max(5000), category: z.array(referenceOptionSchema).max(5000), priority: z.array(referenceOptionSchema).max(5000) }).strict(),
  assignments: z.array(z.object({ resourceId: id, queueId: id.nullable(), roleId: id, roleLabel:label.optional(), isDefault:z.boolean().optional(), categoryIds: z.array(id).max(500) }).strict()).max(10000),
  categoryRules: z.array(z.object({ categoryId: id, queueRequired: z.enum(['always', 'when_unassigned', 'never']), completionRequiredFields: z.array(z.enum(['title', 'description', 'resolution'])).max(3), requiredCollections: z.array(portCollectionSchema).max(5), requireImportantChecklistComplete: z.boolean() }).strict()).max(500),
  statusTransitions: z.array(z.object({ fromId: id, toId: id, categoryId: id }).strict()).max(10000),
}).strict();

export const businessFields: TicketBusinessField[] = ['issueType','subIssueType','dueDateTime','opportunityID','contactID','title', 'description', 'assignedResourceID', 'assignedResourceRoleID', 'queueID', 'status', 'ticketCategory', 'priority', 'resolution'];
const semanticField = { work_type:'billingCodeID', description:'description', issue_type:'issueType',sub_issue_type:'subIssueType', role:'assignedResourceRoleID', due_datetime:'dueDateTime', opportunity_id:'opportunityID', contact:'contactID', contact_id:'contactID', title: 'title', owner: 'assignedResourceID', queue: 'queueID', status: 'status', category: 'ticketCategory', priority: 'priority', resolution: 'resolution' } as const;
const inputError = () => new AppError('invalid_input', 'The technician request is invalid or incomplete.');
const metadataError = () => new AppError('missing_metadata', 'Reviewed technician metadata is missing, incomplete, expired, or bound to another context.');
const conflict = () => new AppError('precondition_failed', 'The ticket or reviewed eligibility changed. Refresh its context before trying again.');
export function parseDomainInput<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw inputError(); return parsed.data; }
export function actorBinding(p: Principal): ActorBinding { return { tenantId: p.tenantId, objectId: p.objectId, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion }; }
export function assertBinding(binding: ActorBinding, p: Principal): void { if (Object.entries(actorBinding(p)).some(([key, value]) => binding[key as keyof ActorBinding] !== value)) throw metadataError(); }
function unique(values: unknown[]): boolean { return new Set(values.map(v => JSON.stringify(v))).size === values.length; }
export function assertTechnicianMetadata(value: unknown, p: Principal, ticket: DataRecord, source: TechnicianSource, now = Date.now()): asserts value is TechnicianMetadata {
  const result = technicianMetadataSchema.safeParse(value); if (!result.success) throw metadataError();
  const m = result.data; assertBinding(m, p); assertCompanyScope(p, ticket.companyID);
  if (m.source !== source || m.ticketId !== ticket.id || m.companyId !== ticket.companyID || Date.parse(m.validUntil) <= now) throw metadataError();
  for (const [kind, options] of Object.entries(m.options)) {
    if (!unique(options.map(o => o.id)) || options.some(o => !unique(o.companyIds) || !unique(o.queueIds ?? []) || !unique(o.categoryIds ?? []) || (kind === 'status' && o.completed === undefined))) throw metadataError();
  }
  if (!unique(m.categoryRules.map(r => r.categoryId)) || !unique(m.assignments) || !unique(m.statusTransitions)) throw metadataError();
  const exists = (kind: keyof typeof m.options, value: number) => m.options[kind].some(o => o.id === value);
  if (m.categoryRules.some(r => !exists('category', r.categoryId) || !unique(r.requiredCollections) || !unique(r.completionRequiredFields)) || m.assignments.some(a => !exists('resource', a.resourceId) || (a.queueId !== null && !exists('queue', a.queueId)) || a.categoryIds.some(c => !exists('category', c))) || m.statusTransitions.some(t => !exists('status', t.fromId) || !exists('status', t.toId) || !exists('category', t.categoryId))) throw metadataError();
}
export function assertReferenceCatalog(value: unknown, p: Principal, kind: ReferenceKind, source: TechnicianSource, now = Date.now()): asserts value is ReferenceCatalog {
  const result = referenceCatalogSchema.safeParse(value); if (!result.success) throw metadataError();
  const c = result.data; assertBinding(c, p);
  if (c.kind !== kind || c.source !== source || Date.parse(c.validUntil) <= now || !unique(c.items.map(o => o.id))) throw metadataError();
}
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)])); return value; }
export function domainFingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function metadataFingerprint(m: TechnicianMetadata): string { const { validUntil: _, ...stable } = m; return domainFingerprint(stable); }
export function ticketSnapshot(ticket: DataRecord): TicketExpectedState { return Object.fromEntries(businessFields.map(f => [f, ticket[f] ?? null])) as TicketExpectedState; }
export function ticketFieldMatches(field:string,actual:unknown,expected:unknown):boolean { return field==='dueDateTime'&&typeof actual==='string'&&typeof expected==='string' ? Number.isFinite(Date.parse(actual))&&Date.parse(actual)===Date.parse(expected) : fieldMatches(field,actual,expected); }
export function assertExpected(ticket: DataRecord, expected: TicketExpectedState): void { if (Object.entries(expected).some(([field, value]) => !ticketFieldMatches(field,ticket[field],value))) throw conflict(); }
export function scopeOptions(options: ReferenceOption[], p: Principal, context: ReferenceContext = {}): ReferenceOption[] {
  if (context.companyId !== undefined) assertCompanyScope(p, context.companyId);
  return options.filter(o => o.companyIds.some(c => p.companyIds.includes(c) && (context.companyId === undefined || c === context.companyId)) && (context.queueId === undefined || o.queueIds === undefined || o.queueIds.includes(context.queueId)) && (context.categoryId === undefined || o.categoryIds === undefined || o.categoryIds.includes(context.categoryId)));
}
const normalized = (v: string) => v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
export class ReferenceResolutionError extends AppError {
  constructor(public readonly reason: 'missing' | 'ambiguous' | 'inactive' | 'incomplete', public readonly candidates: { id: number; label: string }[] = []) { super('invalid_input', `The scoped reference is ${reason}; provide an eligible exact identifier.`); }
}
export function resolveScopedReference(kind: ReferenceKind, reference: BusinessReference, options: ReferenceOption[], version: string, p: Principal, context: ReferenceContext = {}, complete = true): ResolvedReference {
  const ref = parseDomainInput(kind === 'company' ? companyReferenceSchema : businessReferenceSchema, reference);
  if (ref.kind === 'self' && kind !== 'resource') throw inputError();
  if (ref.kind === 'name' && !complete) throw new ReferenceResolutionError('incomplete');
  const scoped = scopeOptions(options, p, context);
  const matches = scoped.filter(o => ref.kind === 'name' ? normalized(o.label) === normalized(ref.name) : o.id === (ref.kind === 'self' ? p.resourceId : ref.id));
  if (matches.length === 0) throw new ReferenceResolutionError('missing');
  if (matches.length > 1) throw new ReferenceResolutionError('ambiguous', matches.slice(0, 10).map(o => ({ id: o.id, label: o.label })));
  const selected = matches[0]!; if (!selected.active) throw new ReferenceResolutionError('inactive');
  return { kind, id: selected.id, label: selected.label, active: true, match: ref.kind, metadataVersion: version };
}
export function evidence<T = DataRecord>(items: T[], scope: string, window: DateWindow | null = null, options: Partial<Pick<EvidenceCollection<T>, 'status'|'complete_within_scope'|'continuation'|'warnings'|'fetched_at'>> = {}): EvidenceCollection<T> {
  return { status: 'complete', scope, window, fetched_at: new Date().toISOString(), returned: items.length, complete_within_scope: true, continuation: null, warnings: [], items, ...options };
}
export function assertEvidence(value: EvidenceCollection): void {
  if (!value || !['complete','partial','unavailable','failed'].includes(value.status) || !Array.isArray(value.items) || value.returned !== value.items.length || value.items.length > 1000 || !Number.isFinite(Date.parse(value.fetched_at)) || typeof value.scope !== 'string' || !Array.isArray(value.warnings) || typeof value.complete_within_scope !== 'boolean' || (value.continuation !== null && typeof value.continuation !== 'string') || (value.complete_within_scope && (value.status !== 'complete' || value.continuation !== null))) throw new AppError('dependency_unavailable', 'The collection evidence is invalid.');
}
export const domainProjectionFields: Record<PortCollection, string[]> = {
  history: ['id','ticketID','action','date','resourceID','status_transition_valid','from_status','to_status'], // Unstructured history detail can contain protected changes; omitted until classified.
  checklist: ['id','ticketID','itemName','isCompleted','isImportant','position','completedByResourceID','completedDateTime','knowledgebaseArticleID'],
  assets: ['id','companyID','referenceTitle','referenceNumber','serialNumber','isActive','rmmDeviceUID','rmmDeviceID'],
  contact: ['id','companyID','firstName','lastName','isActive','emailAddress','phone','mobilePhone'],
  site: ['id','companyID','name','isActive','address1','address2','city','state','postalCode','countryID','phone'],
};
export function projectDomainRecord(record: DataRecord, fields: readonly string[]): DataRecord {
  if (!positiveId(record.id)) throw new AppError('dependency_unavailable', 'The collection record is invalid.');
  const result: DataRecord = { id: record.id };
  for (const f of fields) { const v = record[f]; if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) result[f] = v; }
  return result;
}

export class TechnicianDomain {
  recordWebUrl(entity: string, id: unknown): string | undefined { return recordWebUrl(this.options.ticketHosts ?? [], entity, id); }
  ticketWebUrl(id: unknown): string | undefined { return ticketWebUrl(this.options.ticketHosts ?? [], id); }
  constructor(readonly port: TechnicianPort, readonly principalStore: PrincipalStore, private readonly options: { ticketHosts?: readonly string[]; now?: () => number } = {}) {}
  private async actor(p: Principal, write = false): Promise<Principal> { const fresh = await reauthorize(p, this.principalStore); assertCapability(fresh, write ? 'tickets.write' : 'operational.read'); if(write)assertArea(fresh,'tickets',true); return fresh; }
  async resolveTicket(p: Principal, reference: unknown): Promise<DataRecord> {
    p = await this.actor(p); assertArea(p,'tickets'); const ref = parseDomainInput(ticketReferenceSchema, reference); let ticket: DataRecord;
    if (ref.kind === 'ticket_number') ticket = await this.port.findTicket(p, ref.value);
    else {
      let ticketId: number;
      if (ref.kind === 'id') ticketId = ref.id;
      else {
        let url: URL; try { url = new URL(ref.value); } catch { throw inputError(); }
        const hosts = this.options.ticketHosts ?? [];
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !hosts.some(h => h.toLowerCase() === url.hostname.toLowerCase()) || url.pathname.toLowerCase() !== '/autotask/autotaskextend/executecommand.aspx' || !['OpenTicket', 'OpenTicketDetail'].includes(url.searchParams.get('Code') ?? '') || [...url.searchParams.keys()].length !== 2 || !/^\d+$/.test(url.searchParams.get('TicketID') ?? '')) throw inputError();
        ticketId = Number(url.searchParams.get('TicketID')); if (!positiveId(ticketId)) throw inputError();
      }
      ticket = await this.port.getTicket(p, ticketId);
    }
    p = await this.actor(p); assertCompanyScope(p, ticket.companyID); return projectRecord('Tickets', ticket, p);
  }
  async resolveReference(p: Principal, input: { kind: ReferenceKind; reference: BusinessReference; context?: ReferenceContext }): Promise<ResolvedReference> {
    const parsed = parseDomainInput(z.object({ kind: referenceKindSchema, reference: companyReferenceSchema, context: referenceContextSchema.optional() }).strict().refine(v => v.kind === 'company' || businessReferenceSchema.safeParse(v.reference).success), input); p = await this.actor(p);
    assertArea(p,parsed.kind==='company'||parsed.kind==='resource'?'clients':'tickets');
    const context = { ...parsed.context };
    if (context.ticketId !== undefined) { const ticket = await this.resolveTicket(p, {kind:'id',id:context.ticketId}); if (context.companyId !== undefined && context.companyId !== ticket.companyID) throw inputError(); context.companyId = ticket.companyID as number; }
    const c = await this.port.catalog(p, parsed.kind, context); assertReferenceCatalog(c, p, parsed.kind, this.port.source, this.options.now?.());
    await this.actor(p); return resolveScopedReference(parsed.kind, parsed.reference, c.items, c.version, p, context, c.complete);
  }
  async getMetadata(p: Principal, ticket: DataRecord): Promise<TechnicianMetadata> { p = await this.actor(p); const m = await this.port.metadata(p,ticket.id); assertTechnicianMetadata(m,p,ticket,this.port.source,this.options.now?.()); return m; }
  private async collect(p: Principal, ticket: DataRecord, name: PortCollection, request: CollectionRequest = {}, observedParent?: (parent: DataRecord) => void): Promise<EvidenceCollection> {
    p = await this.actor(p); assertArea(p,name==='assets'?'configuration':name==='contact'||name==='site'?'clients':'tickets'); assertCompanyScope(p,ticket.companyID); const result = await this.port.collection(p,ticket.id,name,parseDomainInput(collectionRequestSchema,request)); assertEvidence(result); await this.actor(p);
    const parent=await this.port.getTicket(p,ticket.id);assertCompanyScope(p,parent.companyID);if(parent.companyID!==ticket.companyID)throw conflict();observedParent?.(parent);
    const items = await Promise.all(result.items.map(async item => {
      if (name === 'history' || name === 'checklist') { if (item.ticketID !== ticket.id) throw new AppError('dependency_unavailable','The collection parent does not match.'); }
      else {
        if (name!=='contact' || item.companyID===ticket.companyID) assertCompanyScope(p,item.companyID);
        const linked=name==='assets'?parent.configurationItemID:name==='contact'?parent.contactID:parent.companylocationID;
        if (item.id!==linked) throw new AppError('dependency_unavailable','The collection parent or association does not match.');
        if (item.companyID !== ticket.companyID) {
          // Tickets may use a contact from their parent company. Re-run the
          // resolver so that this exception is established by the adapter's
          // current company relationship, rather than trusting the row.
          if (name!=='contact'||!this.port.resolveContact) throw new AppError('dependency_unavailable','The collection parent or association does not match.');
          const resolved=await this.port.resolveContact(p,ticket.companyID as number,{kind:'id',id:item.id as number});
          if (resolved.companyId!==item.companyID) throw new AppError('dependency_unavailable','The contact company relationship could not be verified.');
        }
      }
      return projectDomainRecord(item,domainProjectionFields[name]);
    }));
    return {...result,items};
  }
  async requirements(p: Principal, ticket: DataRecord, metadata?: TechnicianMetadata): Promise<TicketRequirements> {
    const m = metadata ?? await this.getMetadata(p,ticket); assertTechnicianMetadata(m,p,ticket,this.port.source,this.options.now?.());
    const rule = m.categoryRules.find(r => r.categoryId === ticket.ticketCategory); if (!rule) throw metadataError();
    // Cancellation needs no invented resolution; native validation still applies at dispatch.
    const status = m.options.status.find(option => option.id === ticket.status);
    const canceled = status !== undefined && ['canceled', 'cancelled'].includes(status.label.trim().toLowerCase());
    const fields = rule.completionRequiredFields.filter(field => !(canceled && field === 'resolution')).map(field => ({field, fulfilled: typeof ticket[field] === 'string' && (ticket[field] as string).trim().length > 0}));
    const required = [...new Set([...rule.requiredCollections,...(rule.requireImportantChecklistComplete ? ['checklist' as const] : [])])];
    const unmet = fields.filter(f => !f.fulfilled).map(f => `required_field:${f.field}`); let complete = true;
    for (const name of required) {
      const collection = await this.collect(p,ticket,name,{limit:100});
      if (!collection.complete_within_scope) { complete = false; unmet.push(`incomplete_evidence:${name}`); }
      if (name === 'checklist' && rule.requireImportantChecklistComplete) {
        if (collection.items.some(item => typeof item.isImportant !== 'boolean' || typeof item.isCompleted !== 'boolean')) { complete = false; unmet.push('invalid_evidence:checklist'); }
        if (collection.items.some(item => item.isImportant === true && item.isCompleted !== true)) unmet.push('important_checklist_incomplete');
      }
    }
    return {metadata_version:m.version,category_id:rule.categoryId,completion_statuses:scopeOptions(m.options.status,p,{companyId:m.companyId,categoryId:rule.categoryId}).filter(o=>o.active&&o.completed).map(o=>({id:o.id,label:o.label})),fields,required_collections:required,unmet,eligible:complete&&unmet.length===0,complete_within_scope:complete};
  }
  async completionHistory(p: Principal, ticket: DataRecord, window: DateWindow, limit=100) {
    let currentTicket = ticket;
    const history = await this.collect(p,ticket,'history',{limit,window},parent=>{currentTicket=parent;});
    return {history,ticket:projectRecord('Tickets',currentTicket,p)};
  }
  async ticketContext(p: Principal, input: { ticket: unknown; collections: DomainCollection[]; limit?: number; cursors?: Partial<Record<PortCollection,string>> }): Promise<TechnicianTicketContext> {
    const parsed = parseDomainInput(z.object({ticket:ticketReferenceSchema,collections:z.array(domainCollectionSchema).min(1).max(6).refine(unique),limit:z.number().int().min(1).max(100).optional(),cursors:z.object({history:text(4096).optional(),checklist:text(4096).optional(),assets:text(4096).optional(),contact:text(4096).optional(),site:text(4096).optional()}).strict().optional()}).strict(),input);
    const ticket = await this.resolveTicket(p,parsed.ticket); const collections:TechnicianTicketContext['collections'] = {};
    for (const name of parsed.collections) {
      if(name==='requirements'){const req=await this.requirements(p,ticket);collections[name]=evidence([req],`ticket:${ticket.id}:requirements`,null,{status:req.complete_within_scope?'complete':'partial',complete_within_scope:req.complete_within_scope});}
      else collections[name]=await this.collect(p,ticket,name,{limit:parsed.limit,cursor:parsed.cursors?.[name]});
    }
    return {ticket:projectRecord('Tickets',ticket,p),collections};
  }
  async ownWork(p:Principal, window:DateWindow, workDate?:string, request:unknown={}) {
    const paging=parseDomainInput(ownWorkRequestSchema,request);
    p=await this.actor(p);window=parseDomainInput(dateWindowSchema,window);if(workDate!==undefined)workDate=parseDomainInput(workDateSchema,workDate);
    assertArea(p,'time'); assertArea(p,'projects'); assertArea(p,'tickets'); assertCapability(p,'time.self');
    const result=await this.port.ownWork(p,window,workDate,paging);await this.actor(p);for(const collection of Object.values(result))assertEvidence(collection);
    const tickets:DataRecord[]=[];for(const record of result.assigned_tickets.items){const ticket=await this.resolveTicket(p,{kind:'id',id:record.id});if(ticket.assignedResourceID!==p.resourceId)throw new AppError('dependency_unavailable','Assigned work has an invalid resource.');const m=await this.getMetadata(p,ticket);const state=m.options.status.find(s=>s.id===ticket.status);if(!state)throw metadataError();if(!state.completed)tickets.push(projectRecord('Tickets',ticket,p));}
    const tasks:DataRecord[]=[];for(const record of result.tasks.items){const bound=await this.port.getTask(p,record.id);assertCompanyScope(p,bound.companyId);const start=typeof bound.task.startDateTime==='string'?Date.parse(bound.task.startDateTime):NaN;const end=typeof bound.task.endDateTime==='string'?Date.parse(bound.task.endDateTime):NaN;if(bound.task.id!==record.id||bound.task.assignedResourceID!==p.resourceId||!Number.isFinite(start)||!Number.isFinite(end)||start>=Date.parse(window.end)||end<Date.parse(window.start))throw new AppError('dependency_unavailable','Assigned task has an invalid resource or date window.');tasks.push(projectDomainRecord(bound.task,['id','projectID','assignedResourceID','assignedResourceRoleID','title','status','startDateTime','endDateTime']));}
    const timeWindow=timeEvidenceWindow(window,workDate);const time:DataRecord[]=[];
    for(const record of result.time.items){if(typeof record.hoursWorked!=='number'||!Number.isFinite(record.hoursWorked)||record.hoursWorked<=0||record.hoursWorked>24||record.resourceID!==p.resourceId||typeof record.dateWorked!=='string'||!Number.isFinite(Date.parse(record.dateWorked))||Date.parse(record.dateWorked)<Date.parse(timeWindow.start)||Date.parse(record.dateWorked)>=Date.parse(timeWindow.end))throw new AppError('dependency_unavailable','Recorded time has an invalid resource or date.');
      if(positiveId(record.ticketID))await this.resolveTicket(p,{kind:'id',id:record.ticketID});else if(positiveId(record.taskID)){const bound=await this.port.getTask(p,record.taskID);assertCompanyScope(p,bound.companyId);}else if(!((record.ticketID===null||record.ticketID===undefined)&&(record.taskID===null||record.taskID===undefined)))throw new AppError('dependency_unavailable','Recorded time has an invalid parent.');time.push(projectRecord('TimeEntries',record,p));}
    await this.actor(p);return {assigned_tickets:{...result.assigned_tickets,items:tickets,returned:tickets.length},tasks:{...result.tasks,items:tasks,returned:tasks.length},time:{...result.time,window:timeWindow,items:time,returned:time.length}};
  }
  async prepareUpdate(p:Principal,input:TicketUpdateInput):Promise<PreparedTicketUpdate> {
    const parsed=parseDomainInput(ticketUpdateSchema,input); p=await this.actor(p,true); const resolvedTicket=await this.resolveTicket(p,parsed.ticket); const ticket=await this.port.getTicket(p,resolvedTicket.id);assertCompanyScope(p,ticket.companyID);const m=await this.getMetadata(p,ticket);
    for(const semantic of Object.keys(parsed.changes) as (keyof typeof semanticField)[]) if(!['contact_identity','fields','person_identities'].includes(semantic as string)&&!Object.hasOwn(parsed.expected,semanticField[semantic])) throw inputError();
    if(Object.keys(parsed.expected).some(k=>!businessFields.includes(k as TicketBusinessField)&&k!=='billingCodeID'&&!Object.hasOwn(parsed.changes.fields??{},k)))throw inputError();
    const changes:ResolvedTicketChanges={};
    if(parsed.changes.person_identities&&!parsed.changes.fields)throw new AppError('invalid_input','person_identities requires native fields.');
    if(parsed.changes.fields){
      if(Array.isArray(parsed.changes.fields.userDefinedFields)&&parsed.changes.fields.userDefinedFields.some(v=>!Array.isArray(parsed.expected.userDefinedFields)||!parsed.expected.userDefinedFields.some(e=>e.name===v.name)))throw new AppError('invalid_input','Supply expected values for every changed UDF.');
      for(const field of Object.keys(parsed.changes.fields))if(!Object.hasOwn(parsed.expected,field))throw new AppError('invalid_input',`Supply expected.${field} from the last read.`);
      if(!this.port.resolveTicketFields)throw new AppError('unsupported_operation','Native ticket field updates are not configured.');
      const native=await this.port.resolveTicketFields(p,ticket.id,parsed.changes.fields,parsed.changes.person_identities);
      const aliases:Record<string,string>={status:'status',priority:'priority',queueID:'queue',ticketCategory:'category',assignedResourceID:'owner',assignedResourceRoleID:'role',issueType:'issue_type',subIssueType:'sub_issue_type',contactID:'contact_id',opportunityID:'opportunity_id',billingCodeID:'work_type'};
      for(const [field,value]of Object.entries(native)){
        const semantic=aliases[field];
        if(semantic&&value===null&&!['owner','queue','contact_id','work_type','sub_issue_type'].includes(semantic)){changes[field]=null;continue;}
        if(semantic){
          if(Object.hasOwn(parsed.changes,semantic))throw new AppError('invalid_input',`Supply either ${semantic} or fields.${field}, not both.`);
          (parsed.changes as any)[semantic]=['status','priority','queue','category','owner','role'].includes(semantic)&&value!==null?{kind:'id',id:value,...(semantic==='owner'?{name:parsed.changes.person_identities?.[field]?.name}:{})}:value;
          if(semantic==='contact_id'&&value!==null)parsed.changes.contact_identity=parsed.changes.person_identities?.[field];
        }else{
          if(Object.entries(semanticField).some(([semantic,native])=>native===field&&Object.hasOwn(parsed.changes,semantic)))throw new AppError('invalid_input',`Duplicate native field ${field}.`);
          changes[field]=value;
        }
      }
      // Keep the original request in the plan; aliases are only for this preparation.
    }
    if(parsed.changes.work_type!==undefined){if(!this.port.resolveWorkType)throw new AppError('unsupported_operation','Work type updates are not configured.');changes.billingCodeID=await this.port.resolveWorkType(p,ticket.id,parsed.changes.work_type);}
 const resolved:PreparedTicketUpdate['resolved']={};
    assertExpected(ticket,parsed.expected);
    let categoryId=ticket.ticketCategory; const ctx:ReferenceContext={companyId:ticket.companyID as number};
    const resolve=(kind:Exclude<ReferenceKind,'company'>,ref:BusinessReference,context=ctx)=>resolveScopedReference(kind,ref,m.options[kind],m.version,p,context);
    if(parsed.changes.category){resolved.category=resolve('category',parsed.changes.category); categoryId=changes.ticketCategory=resolved.category.id;}
    if(!positiveId(categoryId)) throw metadataError(); ctx.categoryId=categoryId;
    const category=scopeOptions(m.options.category,p,ctx).find(o=>o.id===categoryId&&o.active); const rule=m.categoryRules.find(r=>r.categoryId===categoryId); if(!category||!rule) throw metadataError();
    let queueId=ticket.queueID??null; if(parsed.changes.queue!==undefined){resolved.queue=parsed.changes.queue===null?undefined:resolve('queue',parsed.changes.queue);queueId=changes.queueID=resolved.queue?.id??null;}
    if(queueId!==null&&!positiveId(queueId)) throw metadataError(); if(queueId!==null&&!scopeOptions(m.options.queue,p,ctx).some(o=>o.id===queueId&&o.active)) throw new AppError('invalid_input','The selected queue is ineligible.');
    if(parsed.changes.category!==undefined||parsed.changes.queue!==undefined||parsed.changes.work_type!==undefined){
      const queue=m.options.queue.find(v=>v.id===queueId);assertAlignment({category:category.label,queue:queue?.label},parsed.classification_override);
      await this.port.validateClassification?.(p,ticket.id,{categoryId,queueId:queueId as number|null,...(Object.hasOwn(changes,'billingCodeID')?{workTypeId:changes.billingCodeID as number|null}:{})},parsed.classification_override);
    }
    let ownerId=ticket.assignedResourceID??null; if(parsed.changes.owner!==undefined){resolved.owner=parsed.changes.owner===null?undefined:resolve('resource',parsed.changes.owner,{...ctx,...(queueId===null?{}:{queueId})});ownerId=changes.assignedResourceID=resolved.owner?.id??null;}
    if(parsed.changes.owner?.kind==='id')assertPersonIdentity(parsed.changes.owner.name?{name:parsed.changes.owner.name}:undefined,{name:resolved.owner?.label},'owner');
    if(ownerId!==null&&!positiveId(ownerId)) throw metadataError();
    if(rule.queueRequired==='always'||(rule.queueRequired==='when_unassigned'&&ownerId===null)) if(queueId===null) throw new AppError('invalid_input','The category requires an eligible queue.');
    // Resolve roles only when changing assignment context. Unrelated edits must
    // preserve the existing role, even if current metadata offers several roles.
    if(parsed.changes.role!==undefined&&ownerId===null)throw new AppError('invalid_input','A ticket role requires an assigned employee.');
    const assignmentChanged=parsed.changes.role!==undefined||parsed.changes.owner!==undefined||parsed.changes.queue!==undefined||parsed.changes.category!==undefined;
    if(ownerId!==null&&assignmentChanged){
      if(!scopeOptions(m.options.resource,p,{...ctx,...(queueId===null?{}:{queueId})}).some(o=>o.id===ownerId&&o.active)) throw new AppError('invalid_input','The selected owner is ineligible.');
      const assignments=m.assignments.filter(a=>a.resourceId===ownerId&&a.queueId===queueId&&a.categoryIds.includes(categoryId));
      const current=assignments.find(a=>a.roleId===ticket.assignedResourceRoleID);
      const role=parsed.changes.role;
      const explicit=role?assignments.filter(a=>role.kind==='id'?a.roleId===role.id:a.roleLabel?.trim().toLowerCase()===role.name.trim().toLowerCase()):[];
      const preferred=preferredRole(assignments.map(a=>({id:a.roleId,label:a.roleLabel??'',active:true,isDefault:a.isDefault})),numberRange(category.label),ownerId===ticket.assignedResourceID?current?.roleId:undefined);
      const assignment=role?(explicit.length===1?explicit[0]:undefined):assignments.find(a=>a.roleId===preferred?.id);
      if(!assignment) throw new AppError('invalid_input','An unambiguous reviewed resource role is required.');
      if(assignmentChanged) changes.assignedResourceRoleID=assignment.roleId;
    }else if(parsed.changes.owner!==undefined) changes.assignedResourceRoleID=null;
    if(parsed.changes.issue_type!==undefined||parsed.changes.sub_issue_type!==undefined){
      if(!Object.hasOwn(parsed.expected,'issueType')||!Object.hasOwn(parsed.expected,'subIssueType'))throw new AppError('invalid_input','Supply expected issueType and subIssueType for an issue classification change.');
      if(!this.port.resolveIssuePair)throw new AppError('unsupported_operation','Issue classification updates are not configured.');
      Object.assign(changes,await this.port.resolveIssuePair(p,ticket.id,parsed.changes.issue_type,parsed.changes.sub_issue_type));
    }
    if(parsed.changes.status){resolved.status=resolve('status',parsed.changes.status);changes.status=resolved.status.id;}
    if(parsed.changes.priority){resolved.priority=resolve('priority',parsed.changes.priority);changes.priority=resolved.priority.id;}
    if(parsed.changes.opportunity_id!==undefined){if(!this.port.assertOpportunity)throw new AppError('unsupported_operation','Opportunity association is not configured.');await this.port.assertOpportunity(p,ticket.companyID as number,parsed.changes.opportunity_id);changes.opportunityID=parsed.changes.opportunity_id;}
    if(parsed.changes.contact!==undefined){
      if(parsed.changes.contact===null) changes.contactID=null;
      else { if(!this.port.resolveContact)throw new AppError('unsupported_operation','Contact linking is not configured.'); resolved.contact=await this.port.resolveContact(p,ticket.companyID as number,parsed.changes.contact as ContactReference); changes.contactID=resolved.contact.id; }
    }
    if(parsed.changes.contact_id!==undefined){
      if(parsed.changes.contact_id===null) changes.contactID=null;
      else { if(!this.port.resolveContact)throw new AppError('unsupported_operation','Contact linking is not configured.'); resolved.contact_id=await this.port.resolveContact(p,ticket.companyID as number,{kind:'id',id:parsed.changes.contact_id}); changes.contactID=parsed.changes.contact_id; }
    }
    const contactInput=parsed.changes.contact;
    if(parsed.changes.contact_identity&&!(parsed.changes.contact_id||contactInput?.kind==='id'))throw new AppError('invalid_input','contact_identity requires an explicit contact ID.');
    if(parsed.changes.contact_id||contactInput?.kind==='id'){const person=resolved.contact_id??resolved.contact;assertPersonIdentity(parsed.changes.contact_identity,{name:person?.label,email:(person as any)?.email},'contact');}
    if(parsed.changes.due_datetime!==undefined)changes.dueDateTime=new Date(parsed.changes.due_datetime).toISOString();
    if(parsed.changes.description!==undefined)changes.description=parsed.changes.description;
    if(parsed.changes.title!==undefined)changes.title=parsed.changes.title;
    if(parsed.changes.resolution!==undefined)changes.resolution=parsed.changes.resolution;
    const statusId=changes.status??ticket.status;const status=scopeOptions(m.options.status,p,ctx).find(o=>o.id===statusId&&o.active);if(!status)throw new AppError('invalid_input','The selected status is ineligible.');
    if(statusId!==ticket.status&&!m.statusTransitions.some(t=>t.fromId===ticket.status&&t.toId===statusId&&t.categoryId===categoryId))throw new AppError('invalid_input','The reviewed category does not allow this status transition.');
    if(status.completed&&statusId!==ticket.status){const requirements=await this.requirements(p,{...ticket,...changes},m);if(!requirements.eligible)throw new AppError('precondition_failed','Completion requirements are missing or their evidence is incomplete.');}
    return {version:1,source:this.port.source,actor:actorBinding(p),ticketId:ticket.id,companyId:ticket.companyID as number,metadataVersion:m.version,metadataFingerprint:metadataFingerprint(m),input:structuredClone(parseDomainInput(ticketUpdateSchema,input)),changes,expected:{...ticketSnapshot(ticket),...Object.fromEntries(Object.keys(changes).map(f=>[f,valueSchema.parse(ticket[f]??null)]))},completion:status.completed===true,resolved};
  }
  async commitUpdate(p:Principal,plan:PreparedTicketUpdate):Promise<TicketUpdateVerification> {
    p=await this.actor(p,true); if(!plan||plan.version!==1||plan.source!==this.port.source)throw inputError();assertBinding(plan.actor,p);
    const fresh=await this.prepareUpdate(p,plan.input);
    if(fresh.ticketId!==plan.ticketId||fresh.companyId!==plan.companyId||fresh.metadataFingerprint!==plan.metadataFingerprint||domainFingerprint(fresh.expected)!==domainFingerprint(plan.expected)||domainFingerprint(fresh.changes)!==domainFingerprint(plan.changes))throw conflict();
    await this.port.patchTicket(p,fresh);
    // The write has already been accepted. Every later error is an unverified receipt,
    // including permission revocation; callers must never interpret it as safe replay.
    return withReconciliation(()=>this.verifyUpdate(p,fresh));
  }
  async verifyUpdate(p:Principal,plan:PreparedTicketUpdate):Promise<TicketUpdateVerification> {
    const warnings=['Read-before-write is not an atomic upstream compare-and-swap.'];
    try { p=await this.actor(p);assertBinding(plan.actor,p);const ticket=await this.port.getTicket(p,plan.ticketId);assertCompanyScope(p,ticket.companyID);if(ticket.companyID!==(plan.changes.companyID??plan.companyId))throw conflict();const matched=Object.entries(plan.changes).filter(([field,value])=>ticketFieldMatches(field,ticket[field],value)).map(([field])=>field);return{ticket,verified:matched.length===Object.keys(plan.changes).length,matched_fields:matched,warnings}; }
    catch { return {verified:false,matched_fields:[],warnings:[...warnings,'The accepted update could not be verified. Do not replay it.']}; }
  }
}

/** Internal adapters repeat semantic preparation immediately before dispatch. */
export async function revalidatePreparedUpdate(port:TechnicianPort,store:PrincipalStore,p:Principal,plan:PreparedTicketUpdate):Promise<PreparedTicketUpdate> {
  if(!plan||plan.version!==1||plan.source!==port.source)throw inputError();assertBinding(plan.actor,p);
  const fresh=await new TechnicianDomain(port,store).prepareUpdate(p,{...plan.input,ticket:{kind:'id',id:plan.ticketId}});
  if(fresh.companyId!==plan.companyId||fresh.metadataFingerprint!==plan.metadataFingerprint||domainFingerprint(fresh.expected)!==domainFingerprint(plan.expected)||domainFingerprint(fresh.changes)!==domainFingerprint(plan.changes))throw conflict();
  return fresh;
}
