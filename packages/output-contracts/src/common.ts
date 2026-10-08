import { z } from 'zod';

export const id = z.number().int().positive().safe();
export const companyId = z.number().int().nonnegative().safe();
export const count = z.number().int().nonnegative();
export const text = z.string();
export const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const json = z.json();
export const dictionary = z.record(z.string(), json.optional());
export const strings = z.array(text);
export const instant = z.string().datetime({offset:true});
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Extension fields are retained, never stripped. These schemas validate response
// contracts, not authorization or projection (which stay in the domain services).
export const object = <T extends z.ZodRawShape>(shape:T) => z.object(shape).catchall(json.optional());
export const provenance = object({source:text, fetched_at:text.nullable().optional(), schema_version:text.optional(), atomic_snapshot:z.boolean().optional()});
export const completeness = object({complete:z.boolean(), returned:count.optional(), next_cursor:text.nullable().optional()});
export const pageCompleteness = completeness.extend({returned:count,next_cursor:text.nullable()});
export const errorDetail = object({code:text, message:text, retryable:z.boolean()});
export const failure = object({status:z.enum(['failed','unknown_outcome']),correlation_id:z.string().uuid(),error:errorDetail});
export const contractFailure = object({status:z.literal('output_contract_error'),correlation_id:z.string().uuid(),error:errorDetail,operation_id:z.string().uuid().optional(),observed_status:text.optional().describe('Unvalidated status reported by the defective response; not proof of a successful write.'),safe_to_redispatch:z.literal(false)});
export const errors = z.union([failure,contractFailure]);
export const readStatus = z.enum(['succeeded','partial']);
export const states = ['ready','dispatching','accepted_unverified','succeeded_verified','failed','partial','unknown_outcome'] as const;
export const state = z.enum(states);
export const verification = object({performed:z.boolean(),matched_fields:strings.optional(),complete:z.boolean().optional()});
export const step = z.union([
 object({state:z.literal('succeeded_verified'),operation_id:z.string().uuid(),native_id:id,attempt:count.optional()}),
 object({state:z.enum(['ready','dispatching','accepted_unverified','failed','partial','unknown_outcome']),operation_id:z.string().uuid(),native_id:id.optional(),attempt:count.optional()})
]);
export const receiptData = object({
 ticket_id:id.optional(),time_entry_id:id.optional(),note_id:id.optional(),native_id:id.optional(),recorded_resource_id:id.optional(),resource_id:id.optional(),
 metadata_version:text.optional(),error_code:text.optional(),verification:verification.optional(),
 start_datetime:instant.optional().describe('Stored start instant when available; absence does not establish a start.'),
 end_datetime:instant.optional().describe('Stored end instant when available.'),timezone:text.optional(),work_date:date.optional(),
 hours_worked:z.number().nonnegative().optional().describe('Actual requested/stored duration in hours; multiply by 60 for minutes. Not scheduled duration.'),
 timing_basis:z.enum(['start_plus_duration','end_minus_duration','explicit_interval']).optional(),
 timing_source:z.enum(['user','calendar','chat','current_time']).optional(),steps:z.record(text,step).optional(),
 upstream_failure:object({reason:z.enum(['timeout','transport_failure','http_error','invalid_response','missing_record_id','start_stop_required']),http_status:z.number().int().optional()}).optional()
});
const receiptBase = {operation_id:z.string().uuid(),correlation_id:z.string().uuid().optional(),receipt:text.optional(),can_resume:z.boolean().optional(),safe_to_redispatch:z.literal(false).optional(),can_automatically_retry:z.literal(false).optional(),provenance:provenance.optional(),warnings:strings.optional()};
export const receipt = object({...receiptBase,status:state,data:receiptData.optional(),native_id:id.optional(),error:errorDetail.optional()});
export const timeReceipt = z.union([
 object({...receiptBase,status:z.literal('succeeded_verified'),data:receiptData.extend({ticket_id:id,time_entry_id:id.describe('Saved Autotask TimeEntry ID, required for verified success.'),verification:verification.extend({performed:z.literal(true)})})}),
 object({...receiptBase,status:z.enum(['ready','dispatching','accepted_unverified','failed','partial','unknown_outcome']),data:receiptData})
]).describe('Journal status is authoritative. accepted_unverified and unknown_outcome are not successful writes. Missing timing fields in legacy receipts must not be invented.');
export const workTimeReceipt = z.union([
 object({...receiptBase,status:z.literal('succeeded_verified'),data:receiptData.extend({time_entry_id:id,verification:verification.extend({performed:z.literal(true)})})}),
 object({...receiptBase,status:z.enum(['ready','dispatching','accepted_unverified','failed','partial','unknown_outcome']),data:receiptData})
]);
export const record = object({id:companyId});
/** Explicit projected field inventories reused from the domain's reviewed lists.
 * Native metadata determines scalar types for picklists/nullable tenant fields. */
export function projectedRecord(fields:readonly string[], title:string) {
 return z.object(Object.fromEntries(fields.map(f=>[f,f==='id'?companyId:scalar.optional()]))).extend({web_url:text.optional()}).strict().describe(title);
}
export const timeRecord = object({id,resourceID:id.optional(),ticketID:id.nullable().optional(),taskID:id.nullable().optional(),hoursWorked:z.number().nonnegative().optional(),dateWorked:text.optional(),startDateTime:text.nullable().optional(),endDateTime:text.nullable().optional(),summaryNotes:text.nullable().optional(),internalNotes:text.nullable().optional()});
export function read(data:z.ZodType, paginated=false) {
 return object({status:readStatus,data,completeness:paginated?pageCompleteness:completeness.optional(),provenance:provenance.optional(),correlation_id:z.string().uuid().optional(),warnings:strings.optional(),content_trust:text.optional()});
}
export const option = object({id:z.number().int(),label:text,active:z.boolean().optional()});
export const fieldMetadata = object({name:text,dataType:text.optional(),isReadOnly:z.boolean().optional(),isRequired:z.boolean().optional(),isPickList:z.boolean().optional(),picklistValues:z.array(object({value:z.union([text,z.number()]),label:text,isActive:z.boolean().optional()})).nullable().optional()});
export const collection = z.union([
 object({status:z.literal('not_requested')}),
 object({status:z.enum(['complete','partial','truncated','failed','unavailable']),items:z.array(dictionary).optional(),returned:count.optional(),complete_within_scope:z.boolean(),continuation:text.nullable().optional(),warnings:strings.optional()})
]);
export const collections = z.partialRecord(z.enum(['notes','time','history','assets','checklist','schedule','requirements','contact','site']),collection);
export const ticketContext = read(object({ticket:record,purpose:text,collections,content_trust:text.optional()}));
export const artifact = object({artifact_id:z.string().uuid(),kind:text,ticket_id:id.optional(),opportunity_id:id.optional(),filename:text,mime:text,bytes:count,sha256:text,created_at:text,expires_at:text,complete:z.boolean(),rows:count,warnings:strings});
export const chunk = {offset:count,content_base64:text,next_offset:count.nullable()};

/** Flat receipts used by generated CRM, sales, finance and inventory tools. */
export function flatReceipt(entity?:string, action?:string) {
 const fields={...receiptBase,entity:entity?z.literal(entity):text,action:action?z.literal(action):z.enum(['create','update','delete']),company_id:companyId.optional(),can_automatically_retry:z.literal(false)};
 return z.union([
  object({...fields,status:z.literal('succeeded_verified'),native_id:id,verified:z.literal(true)}),
  object({...receiptBase,status:z.enum(['ready','dispatching','accepted_unverified','failed','partial','unknown_outcome']),entity:fields.entity.optional(),action:fields.action.optional(),company_id:companyId.optional(),native_id:id.optional(),can_automatically_retry:z.literal(false),verification:text.optional()})
 ]);
}
export function savedRecordReceipt(key:string) {
 return z.union([
  object({...receiptBase,status:z.literal('succeeded_verified'),data:receiptData.extend({[key]:id,verification:verification.extend({performed:z.literal(true)})})}),
  object({...receiptBase,status:z.enum(['ready','dispatching','accepted_unverified','failed','partial','unknown_outcome']),data:receiptData.optional()})
 ]);
}
