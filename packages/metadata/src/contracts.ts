import { z } from 'zod';
import type { OperationQualification } from '../../autotask/src/index.js';

export const METADATA_OPERATIONS = [
  'Tickets.query','Tickets.get','Tickets.patch','TicketNotes.query','TicketNotes.get','TicketNotes.create',
  'TimeEntries.query','TimeEntries.query.own','TimeEntries.get','TimeEntries.create','Companies.query','Companies.get',
  'references.resolve','metadata.resolve','Tickets.patch.expanded','TicketHistory.query','TicketChecklistItems.query',
  'ConfigurationItems.get','Contacts.get','CompanyLocations.get','Tasks.query','Tasks.get','Projects.get',
  'Resources.query','ServiceCalls.metadata','ServiceCalls.query','ServiceCalls.get','ServiceCalls.create',
  'ServiceCallTickets.query','ServiceCallTickets.get','ServiceCallTickets.create',
  'ServiceCallTicketResources.query','ServiceCallTicketResources.get','ServiceCallTicketResources.create',
] as const;
export type MetadataOperation = typeof METADATA_OPERATIONS[number];
export type CompiledQualification<T extends MetadataOperation = MetadataOperation> = Omit<OperationQualification,'operation'> & { operation:T };
const id = z.number().int().positive().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);
const entityLabel = z.string().regex(/^[A-Za-z_][A-Za-z0-9_ ()-]{0,199}$/);
const label = z.string().min(1).max(250).refine(v => v.trim().length > 0 && !/[\r\n\0]/.test(v));
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const date = z.iso.datetime().refine(v => Number.isFinite(Date.parse(v)));
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v);
const scalar = z.union([z.string().max(250), z.number().finite(), z.boolean()]);
export const metadataSourceSchema = z.object({
  id: identifier, kind: z.enum(['documentation','metadata-export','operational-capture','tenant-test','fixture']),
  /** Relative file path, official document URL, or an explicitly fictitious reference. */
  reference: z.string().min(1).max(1000).refine(v => !/[\r\n\0]/.test(v)), sha256: digest, capturedAt: date,
}).strict();
export const picklistSchema = z.object({ value: scalar, label, active: z.boolean(), default: z.boolean(), parentValue: scalar.optional() }).strict();
export const metadataFieldSchema = z.object({
  name, dataType: name, required: z.boolean().nullable(), readOnly: z.boolean().nullable(), queryable: z.boolean().nullable(),
  referenceEntity: name.nullable(), maxLength: z.number().int().positive().max(2_147_483_647).optional(),
  picklist: z.array(picklistSchema).max(10000).optional(), picklistParentField: name.optional(),
}).strict();
export const udfSchema = z.object({ name: label, dataType: name, required: z.boolean().nullable(), readOnly: z.boolean().nullable(), queryable: z.boolean().nullable(),
  picklist: z.array(picklistSchema).max(10000).optional(), maxLength: z.number().int().positive().max(2_147_483_647).optional() }).strict();
export const entityMetadataSchema = z.object({
  entity: entityLabel, runtimeName: name, complete: z.boolean(), fields: z.array(metadataFieldSchema).max(2000), userDefinedFields: z.array(udfSchema).max(2000),
  sourceIds: z.array(identifier).min(1).max(50),
}).strict();
const actor = z.object({ tenantId: identifier, objectId: identifier, resourceId:id, mappingVersion:id, policyVersion:identifier }).strict();
const context = z.object({ ticketId:id.optional(),companyId:z.number().int().nonnegative().safe().optional(),queueId:id.optional(),categoryId:id.optional() }).strict();
export const metadataBindingSchema = z.object({
  id: identifier, kind:z.enum(['ticket-work','technician','catalog','scheduling','resources','time-eligibility']), actor,
  companyIds:z.array(z.number().int().nonnegative().safe()).min(1).max(1000), ticketId:id.optional(), companyId:z.number().int().nonnegative().safe().optional(),
  referenceKind:z.enum(['company','resource','queue','status','category','priority']).optional(), context:context.optional(),
  workDate:calendarDateSchema.optional(),
  validUntil:date, sourceIds:z.array(identifier).min(1).max(50),
  requires:z.array(z.object({entity:entityLabel,fields:z.array(name).min(1).max(200)}).strict()).min(1).max(20),
  /** Strict provider-specific schemas are applied during compilation, before this data can be served. */
  value:z.unknown(),
}).strict();
export const timeEligibilitySchema = z.object({
  workDate:calendarDateSchema, checkedAt:date, validUntil:date,
  timezone:z.string().min(1).max(100).refine(value=>{try {new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}catch{return false;}}),
  period:z.object({id,startsOn:calendarDateSchema,endsOn:calendarDateSchema,status:z.enum(['open','locked','submitted','approved','unknown'])}).strict(),
  resourceActive:z.boolean(), ticketAllowsTime:z.boolean(), contractAllowsTime:z.boolean(), dateContainerVerified:z.boolean(),
  assignments:z.array(z.object({roleId:id,workTypeId:id,roleEffective:z.boolean(),workTypeEffective:z.boolean(),remainingHours:z.number().finite().min(0).max(24)}).strict()).min(1).max(1000),
}).strict();
export const resourceVerificationSchema = z.object({
  tenantId:identifier,resourceId:id,active:z.boolean(),verifiedAt:date,expiresAt:date,sourceIds:z.array(identifier).min(1).max(50),
}).strict();
export const metadataContentSchema = z.object({
  schemaVersion:z.literal(1),source:z.enum(['fixture','Autotask','documentation']),tenantId:identifier,policyVersion:identifier,
  capturedAt:date,expiresAt:date,inventoryDigest:digest,sources:z.array(metadataSourceSchema).max(2000),
  entities:z.array(entityMetadataSchema).max(500),bindings:z.array(metadataBindingSchema).max(10000),
  resourceVerifications:z.array(resourceVerificationSchema).max(1000).default([]),
}).strict();
export const qualificationEvidenceSchema = z.object({
  operation:z.enum(METADATA_OPERATIONS),evidenceSource:z.enum(['live','fixture']),tenantId:identifier,policyVersion:identifier,
  resourceIds:z.array(id).min(1).max(1000),testIds:z.array(identifier).min(1).max(1000),sourceIds:z.array(identifier).min(1).max(50),
  metadataDigest:digest,qualifiedAt:date,expiresAt:date,reviewedBy:identifier,
  headerAccepted:z.boolean(),permissionEnforced:z.boolean(),nativeAttribution:z.boolean().optional(),
  /** Evidence distinguishes allowed scope, denied scope and mapping revocation tests. */
  positiveScopeVerified:z.boolean(),negativeScopeVerified:z.boolean(),mappingRevocationVerified:z.boolean(),
}).strict();
export const snapshotInputSchema=z.object({content:metadataContentSchema,qualifications:z.array(qualificationEvidenceSchema).max(200)}).strict();
export const snapshotSchema=snapshotInputSchema.extend({version:z.string().regex(/^metadata-v1-[a-f0-9]{24}$/),metadataDigest:digest,digest}).strict();
export type MetadataSource=z.infer<typeof metadataSourceSchema>;
export type TimeEligibilityEvidence=z.infer<typeof timeEligibilitySchema>;
export type ResourceVerification=z.infer<typeof resourceVerificationSchema>;
export type MetadataField=z.infer<typeof metadataFieldSchema>;
export type EntityMetadata=z.infer<typeof entityMetadataSchema>;
export type MetadataBinding=z.infer<typeof metadataBindingSchema>;
export type MetadataContent=z.infer<typeof metadataContentSchema>;
export type QualificationEvidence=z.infer<typeof qualificationEvidenceSchema>;
export type MetadataSnapshotInput=z.infer<typeof snapshotInputSchema>;
export type MetadataSnapshot=z.infer<typeof snapshotSchema>;
export interface EntityInventory { digest:string; entities:{entity:string;documentationUrl?:string;documentedName?:string;parent?:string;documentaryOnly:true}[] }
