import {companySelectionOutput} from '../../../packages/read-selection/src/index.js';
import {investigationSchemas,investigationOutput} from '../../../packages/investigations/src/index.js';
import {integrationSchemas,integrationOutput} from '../../../packages/integrations/src/index.js';
import {schemas as itGlueSchemas,itGlueOutput} from '../../../packages/itglue/src/contracts.js';
import {schemas as rmmSchemas,rmmOutput} from '../../../packages/rmm/src/contracts.js';
import {publishedJsonSchema} from './schema-publication.js';
import { z } from 'zod';
import * as c from '../../../packages/output-contracts/src/common.js';
import { businessToolDefinitions } from '../../../packages/business/src/tools.js';
import { salesToolDefinitions } from '../../../packages/sales/src/tools.js';
import { fields as businessFields } from '../../../packages/business/src/contracts.js';
import { fields as salesFields } from '../../../packages/sales/src/contracts.js';
import { operationalFields, financialFields } from '../../../packages/policy/src/index.js';
import { workManagementOperations } from '../../../packages/work-management/src/tools.js';
import { checklistOperations } from '../../../packages/checklists/src/tools.js';

export const OUTPUT_CONTRACT_VERSION = 'autotask-output-v1';
const {object:o,text:t,id,count,strings,record,read,receipt,dictionary:d,scalar,option,fieldMetadata,provenance,completeness,collection} = c;
const schemas:Record<string,z.ZodType> = Object.fromEntries([...Object.keys(rmmSchemas).map(name=>[name,rmmOutput]),...Object.keys(itGlueSchemas).map(name=>[name,itGlueOutput]),...Object.keys(integrationSchemas).map(name=>[name,integrationOutput]),...Object.keys(investigationSchemas).map(name=>[name,investigationOutput])]);
schemas.at_select_company=companySelectionOutput;
const reportOutput=z.object({report_id:z.string().uuid(),state:z.enum(['queued','running','completed','failed','cancelled']),company_id:z.number(),created_at:z.string(),updated_at:z.string(),expires_at:z.string(),schema_version:z.literal(1),poll_interval_ms:z.number(),error_code:z.string().optional()}).strict();
for(const name of ['client_health_report_start','read_report_status','read_report_cancel'])schemas[name]=reportOutput;
schemas.read_report_result=reportOutput.extend({data:z.unknown()});
const assign=(names:string[],schema:z.ZodType)=>{for(const name of names)schemas[name]=schema;};
const rows=(entity:string,fields:readonly string[])=>c.projectedRecord(fields,`Projected ${entity} record. Fields may be absent according to metadata and access; native nullable/picklist scalar types are preserved.`);
const nativeRecord=z.object({id:c.companyId,userDefinedFields:z.array(z.object({name:t,value:scalar})).optional()}).catchall(scalar.optional()).describe('Native metadata-defined record fields; values are projected according to access permissions.');
const ticket=rows('Tickets',[...operationalFields.Tickets,...financialFields.Tickets]);
for(const [name,{entity,action}] of Object.entries(businessToolDefinitions)){
 const row=rows(entity,businessFields[entity]);
 schemas[name]=action==='search'?read(z.array(row),true):action==='get'?read(nativeRecord):c.flatReceipt(entity,action);
}
for(const [name,entity,action] of salesToolDefinitions){
 const row=rows(entity,salesFields[entity]);
 schemas[name]=action==='search'?read(z.array(row),true):action==='get'?read(nativeRecord):action==='count'?read(z.array(row).length(0),true).extend({count}):c.flatReceipt(entity,action);
}
for(const [name,v] of Object.entries(workManagementOperations))if(v.write)schemas[name]=receipt;
assign(['time_log_task','time_log_internal','time_correct'],c.workTimeReceipt);
for(const [name,v] of Object.entries(checklistOperations))if(v.write)schemas[name]=receipt;
assign(['ticket_note_add','ticket_document_work','ticket_handoff','ticket_resolve','ticket_update','ticket_create','service_call_create','service_call_update','service_call_cancel','opportunity_attachment_upload','opportunity_attachment_delete','opportunity_attachment_operation_status','ticket_attachment_copy','ticket_attachment_upload','ticket_attachment_delete','attachment_operation_status','checklist_operation_status','work_operation_status','business_operation_status','sales_operation_status','at_operation_status','at_operation_resume','at_operation_reconcile'],receipt);
const ticketRelationshipReceipt=z.object({status:c.state,operation_id:z.string().uuid(),data:z.object({ticket_id:id.optional(),resource_id:id.optional(),resource_name:t.optional(),role_id:id.optional(),role_name:t.optional(),secondary_resource_id:id.optional(),association_id:id.optional(),tag_id:id.optional(),library_id:id.optional(),error_code:t.optional(),verification:z.object({performed:z.boolean(),complete:z.boolean().optional(),matched_fields:strings.optional()}).optional()}).catchall(z.unknown()).optional(),can_resume:z.boolean().optional(),safe_to_redispatch:z.literal(false).optional(),receipt:t.optional(),provenance:z.object({source:t}).catchall(z.unknown()).optional()}).catchall(z.unknown());
assign(['ticket_secondary_resource_add','ticket_secondary_resource_remove','ticket_primary_resource_assign','ticket_tag_add','ticket_tag_remove','ticket_checklist_library_apply'],ticketRelationshipReceipt);
schemas.ticket_secondary_resource_options=o({status:z.literal('succeeded'),ticket_id:id,company_id:id,primary_resource_id:id.nullable(),primary_role_id:id.nullable(),secondary_resources:z.array(o({id,resource_id:id,role_id:id})),eligible_resource_roles:z.array(o({resource_id:id,resource_name:t,role_id:id,role_name:t})),limit:count,remaining:count,valid_until:t,provenance,warnings:strings});
schemas.ticket_tag_options=o({status:z.literal('succeeded'),ticket_id:id,company_id:id,current_tags:z.array(o({association_id:id,tag_id:id,label:t})),eligible_tags:z.array(o({id,label:t,group_id:id.nullable()})),limit:count,remaining:count,valid_until:t,provenance,warnings:strings});
schemas.ticket_checklist_library_options=o({status:z.literal('succeeded'),ticket_id:id,company_id:id,current_item_count:count,limit:count,remaining:count,libraries:z.array(o({id,name:t,description:t.nullable(),item_count:count,can_apply:z.boolean()})),valid_until:t,provenance,warnings:strings});
schemas.time_log_ticket=c.timeReceipt;
schemas.ticket_note_add=c.savedRecordReceipt('note_id');
assign(['checklist_item_create','checklist_item_update','checklist_item_delete'],c.savedRecordReceipt('item_id'));
assign(['expense_report_create','expense_item_add','expense_report_submit','resource_availability_update','time_off_request','time_off_cancel'],c.savedRecordReceipt('native_id'));
assign(['business_operation_status','sales_operation_status'],c.flatReceipt());
// Legacy search returns a foundation envelope with the same array-shaped data.
schemas.ticket_search=read(z.array(ticket),true);
schemas.ticket_count=o({status:z.literal('succeeded'),count,filters:d,count_scope:t,provenance});
schemas.ticket_completion_search=read(o({items:z.array(o({ticket,current_state:z.enum(['completed','reopened','other_terminal','unknown']),completion_events:z.array(o({history_id:id,completed_at:c.instant,completed_by_resource_id:id,from_status:t,to_status:t})),history_complete:z.boolean()})),window:o({start:c.instant,end:c.instant,timezone:t,start_date:c.date,end_date:c.date}),week_starts_on:z.literal('Monday'),attribution:z.literal('native_ticket_history_resource'),counts:o({returned_tickets:count,returned_completion_events:count,scanned_tickets:count,matched_tickets_so_far:count,completion_events_so_far:count,incomplete_histories:count,total_tickets:count.nullable(),total_completion_events:count.nullable()}),filters:o({completed_by_resource_id:id.nullable(),current_assignee_resource_id:id.nullable(),current_state:z.enum(['any','completed','reopened'])})}),true);
schemas.ticket_status_transition_search=read(o({items:z.array(o({ticket,current_status:t,transition_events:z.array(o({history_id:id,changed_at:c.instant,from_status:t,to_status:t})),history_complete:z.boolean()})),created_window:o({start:c.instant,end:c.instant}),transition_window:o({start:c.instant,end:c.instant}),target_status:t,counts:o({returned_tickets:count,scanned_candidates:count,matched_tickets_so_far:count,transition_events_so_far:count,incomplete_histories:count,total_tickets:count.nullable(),total_transition_events:count.nullable()}),filters:o({company_id:c.companyId.nullable(),currently_in_status:z.boolean()})}),true);
schemas.ticket_context=c.ticketContext;
schemas.time_entry_search=read(o({ticket_id:id.optional(),entries:z.array(c.timeRecord),scope:t}),true);
schemas.time_search=read(z.array(c.timeRecord),true);
schemas.time_get=read(c.timeRecord);
schemas.time_timesheet_review=read(o({resource_id:id,from:c.date,to:c.date,entries:z.array(c.timeRecord),returned_page_hours:z.number().nonnegative(),native_timesheet_status:z.literal('unavailable_via_rest')}),true);
schemas.time_billing_approval_review=read(o({time_entry:c.timeRecord,approval_levels:z.array(record),latest_level:count,native_timesheet_status:z.literal('unavailable_via_rest')}));
schemas.time_off_approver_resources=read(z.array(record.extend({resourceID:id,approverResourceID:id,approvalLevel:count})),true);
schemas.time_off_review=read(z.array(record.extend({resourceID:id,can_act:z.boolean(),next_approval_level:count.nullable(),reviewed_last_level:count})),true);
schemas.time_entry_clock=read(o({current_datetime:c.instant,local_date:c.date,timezone:t}));
schemas.at_whoami=read(o({tenant_id:t,object_id:t,resource_id:id,capabilities:strings,policy_version:t,mapping_version:count}));
const projected=z.union(Object.entries(operationalFields).map(([entity,fields])=>rows(entity,[...fields,...financialFields[entity as keyof typeof financialFields]]).partial()) as unknown as [z.ZodType,z.ZodType,...z.ZodType[]]);
schemas.at_query=read(o({entity:z.enum(['Tickets','Companies','TicketNotes','TimeEntries']),items:z.array(projected)}),true);
schemas.at_related=schemas.at_query;
schemas.at_get=read(o({entity:z.enum(['Tickets','Companies','TicketNotes','TimeEntries']),item:projected}),true);
schemas.at_reference_resolve=o({kind:t,id:c.companyId,label:t,active:z.literal(true),match:t,metadataVersion:t});
schemas.ticket_requirements=o({metadata_version:t,category_id:count,completion_statuses:z.array(option),fields:z.array(c.json),required_collections:strings,unmet:strings,eligible:z.boolean(),complete_within_scope:z.boolean()});
const scheduleData=o({entries:z.array(o({id,ticket_ids:z.array(id),resource_ids:z.array(id),start:t.optional(),end:t.optional(),startDateTime:t.optional(),endDateTime:t.optional()})),window:o({start:t,end:t,timezone:t.optional()}),scope:t.optional()});
schemas.schedule_search=read(scheduleData);
schemas.my_workday=read(o({date:c.date,timezone:t,assigned_tickets:collection,tasks:collection,recorded_time:collection,schedule:scheduleData,recorded_hours:z.number().nonnegative(),recorded_hours_scope:z.literal('returned_batch'),timezone_source:z.enum(['request','employee_configuration','workspace_configuration'])}));
schemas.ticket_prepare_visit=read(o({ticket:record,purpose:t,collections:c.collections,appointment:o({id,ticket_ids:z.array(id),resource_ids:z.array(id)}),date:c.date,timezone:t,timezone_source:z.enum(['request','employee_configuration','workspace_configuration'])}));
schemas.at_validate=o({valid:z.literal(true),validation:z.literal('current_preflight'),ticket_id:id,metadata_version:t,effects:z.literal('none'),execution_authorized:z.literal(false),recheck_required:z.literal(true)});
schemas.at_discover=o({operations:z.array(o({name:t,description:t,effect:z.enum(['read','write','mixed']),effect_kind:z.enum(['read','local_persistence','native_mutation','orchestration','cancellation']),category:t,schema_version:t})),next_cursor:t.nullable(),metadata_digest:t,complete:z.boolean()});
schemas.at_read_invoke=o({operation:t,result:z.unknown()});
const jsonSchemaDocument=d.describe('JSON Schema document describing an input/output contract; vocabulary keys are intentionally dynamic.');
schemas.at_describe=o({name:t,description:t,schema:jsonSchemaDocument,output_schema:jsonSchemaDocument,output_schema_version:z.literal(OUTPUT_CONTRACT_VERSION),capabilities:strings,schema_version:t,execution_authorized:z.literal(false)});
schemas.at_diagnostics=o({server_release:t,metadata_sha256:z.string().regex(/^[a-f0-9]{64}$/),metadata_scope:z.literal('published_tools'),tool_change_notifications:z.literal(false),client_refresh_required:z.literal(true),source:t,storage:t,configured_tools:count,available_tools:count,writes_paused:z.boolean(),policy_version:t,upstream_capacity_qualified:z.literal(false),live_evidence:t});
const playbook=o({id:t,version:t,title:t,lifecycle:z.literal('draft'),procedure_status:t,owner:z.null(),published_at:z.null(),source_type:t,required_tools:strings,unavailable_tools:strings,business_mutation:z.boolean(),resource_uri:t,source:t});
schemas.at_playbook_list=o({playbooks:z.array(playbook),warnings:strings});
schemas.at_playbook_get=playbook.extend({body_sha256:t,markdown:t,warnings:strings});
const job=o({id:z.string().uuid(),tenantId:t,actorKey:t,operation:t,resourceId:id,mappingVersion:count,policyVersion:t,state:z.enum(['queued','running','succeeded','failed','cancelled','expired','uncertain']),createdAt:t,updatedAt:t,runAfter:t,expiresAt:t,fence:count,dispatched:z.boolean(),cancelRequested:z.boolean(),operationId:z.string().uuid().optional()});
assign(['at_job_start','at_job_status','at_job_cancel'],job);
schemas.at_job_list=o({items:z.array(job),nextCursor:o({at:t,id:z.string().uuid()}).optional()});
schemas.at_artifact_export=read(c.artifact).extend({preview:z.array(d),warnings:strings});
schemas.at_file_stage=o({status:z.literal('staged'),data:c.artifact,warnings:strings});
schemas.at_artifact_list=o({data:o({artifacts:z.array(c.artifact)}),complete:z.literal(true)});
schemas.at_artifact_get=o({metadata:c.artifact,...c.chunk});
schemas.at_artifact_delete=o({artifact_id:z.string().uuid(),deleted:z.literal(true)});
schemas.opportunity_file_stage=schemas.at_file_stage!;
const attachment=o({id,ticket_id:id.optional(),opportunity_id:id.optional(),title:t.nullable().optional(),content_type:t.nullable().optional(),attachment_type:t.optional()});
schemas.ticket_attachment_list=o({status:c.readStatus,ticket_id:id,attachments:z.array(attachment),completeness,warnings:strings,provenance});
schemas.ticket_attachment_get=o({status:z.literal('succeeded'),ticket_id:id,attachment,provenance});
schemas.ticket_attachment_download=o({status:z.literal('succeeded'),ticket_id:id,attachment,...c.chunk,complete:z.boolean(),provenance});
schemas.opportunity_attachment_list=o({status:c.readStatus,opportunity_id:id,attachments:z.array(attachment),completeness,warnings:strings,provenance});
schemas.opportunity_attachment_get=o({status:z.literal('succeeded'),opportunity_id:id,attachment,provenance});
schemas.opportunity_attachment_download=o({status:z.literal('succeeded'),opportunity_id:id,attachment,...c.chunk,complete:z.boolean(),provenance});
const checklist=o({id,ticket_id:id,item_name:t,is_completed:z.boolean(),is_important:z.boolean(),position:z.number().nullable().optional(),knowledgebase_article_id:id.nullable().optional(),completed_by_resource_id:id.nullable().optional(),completed_date_time:t.nullable().optional()});
schemas.checklist_search=o({status:z.literal('succeeded'),ticket_id:id,items:z.array(checklist),completeness,provenance});
schemas.checklist_get=o({status:z.literal('succeeded'),ticket_id:id,item:checklist,provenance});
schemas.checklist_options=o({status:z.literal('succeeded'),ticket_id:id,fields:z.array(fieldMetadata),limits:o({max_items:z.literal(40)}),provenance});
const workOption=o({id:z.number(),label:t,active:z.boolean()});
const noteMetadata=o({titleRequired:z.boolean(),attributionField:t,types:z.array(workOption),audiences:z.array(o({audience:z.enum(['internal','customer']),publish:z.number(),label:t,active:z.boolean()})),defaultTypeId:z.number().optional()});
const timeMetadata=o({eligible:z.boolean(),roles:z.array(workOption),workTypes:z.array(workOption),defaultRoleId:z.number().optional(),defaultWorkTypeId:z.number().optional()});
schemas.ticket_write_options=z.union([
 o({ticket_id:id,note:noteMetadata,time:timeMetadata,execution_authorized:z.literal(false)}),
 o({ticket_id:id,assignments:z.array(o({resourceId:id,queueId:id.nullable(),roleId:id,roleLabel:t.optional(),isDefault:z.boolean().optional(),categoryIds:z.array(id)})).optional(),options:z.record(t,z.array(option)),completion_policy:t,execution_authorized:z.literal(false)}),
 o({ticket_id:id,statuses:z.array(option),eligible_resource_ids:z.array(id),execution_authorized:z.literal(false)})
]);
schemas.ticket_create=receipt.extend({verified_saved_fields:o({companyID:z.number().int().nonnegative(),title:t}).optional(),verified_saved_fields_scope:t.optional(),creation_review:o({assumptions:strings,defaulted_fields:strings,unresolved_fields:strings}).optional()});
schemas.ticket_create_options=o({fields:z.array(fieldMetadata),resources:z.array(option),roles:z.array(o({id,name:t})),work_types:z.array(o({id,name:t})),requirements:strings,creation_fields:strings,creation_guidance:t,input_field_mapping:z.record(t,t),defaults:z.record(t,t),limitations:strings});
schemas.work_write_options=o({status:c.readStatus,fields:z.record(t,z.array(o({name:t,type:t,read_only:z.boolean(),choices:z.array(o({value:scalar,label:t})).optional()}))),currencies:z.array(o({id,name:t})).optional(),currency_lookup:z.enum(['available','unavailable']).optional(),limitations:strings});
schemas.contact_search=o({status:z.literal('succeeded'),company_id:c.companyId,returned:count,contacts:z.array(o({id,company_id:c.companyId,active:z.boolean(),first_name:t.nullable().optional(),last_name:t.nullable().optional(),email:t.nullable().optional()})),provenance});
schemas.contact_get=o({status:z.literal('succeeded'),company_id:c.companyId,contact:o({id,label:t,companyId:c.companyId,active:z.literal(true),match:t,email:t.optional()}),provenance});
assign(['business_schema','sales_schema'],o({entity:t,fields:z.array(fieldMetadata),limitations:strings,status:z.literal('succeeded').optional()}));
schemas.sales_reference_search=read(z.array(record),true);
schemas.quote_compare=o({status:c.readStatus,data:z.array(o({quote:rows('Quotes',salesFields.Quotes),items:z.array(rows('QuoteItems',salesFields.QuoteItems)),completeness:c.pageCompleteness})),warnings:strings});
schemas.opportunity_note_create=z.union([schemas.opportunity_note_create!,o({status:z.literal('confirmation_required'),restriction:z.literal('opportunity_note_requires_active'),opportunity_id:id,company_id:c.companyId,original_status:o({id,label:t}),note:z.record(t,scalar),restore:z.record(t,scalar),expires_at:t,confirmation_token:t,warning:t})]);
schemas.opportunity_note_confirm_reopen=o({status:z.enum(['succeeded_verified','review_required']),opportunity_id:id,original_status_id:id,note_verified:z.boolean(),restoration_verified:z.boolean(),steps:z.record(t,c.flatReceipt()),can_automatically_retry:z.literal(false),guidance:t,error_code:t.optional()});
const quoteEvidence=o({value:scalar,label:t.nullable(),available:z.boolean()});
schemas.quote_workflow_inspect=o({quote_id:id,company_id:c.companyId,opportunity_id:id,internal_approval:quoteEvidence,customer_response:quoteEvidence,customer_response_date:quoteEvidence,last_published:quoteEvidence,limitations:strings});
schemas.quote_workflow_prepare=o({status:z.literal('succeeded'),quote_id:id,opportunity_id:id,company_id:c.companyId,purpose:z.enum(['send','pdf','acceptance','convert']),context:o({quote:rows('Quotes',salesFields.Quotes),opportunity:rows('Opportunities',salesFields.Opportunities)}),readiness:o({automation_available:z.literal(false),native_workflow_ready:z.literal('not_verified'),unknowns:strings}),handoff:o({surface:t,path:t,action:t}),evidence:schemas.quote_workflow_inspect!,limitations:strings,read_only:z.literal(true),provenance});
schemas.quote_opportunity_pdf_search=o({status:c.readStatus,quote_id:id,opportunity_id:id,association_scope:z.literal('opportunity_note'),candidates:z.array(o({attachment_id:id,company_note_id:id,title:t.nullable(),content_type:t.nullable(),attach_date:t.nullable(),publish:scalar})),completeness:c.pageCompleteness,limitations:strings,provenance});
schemas.quote_opportunity_pdf_get=o({status:z.literal('succeeded'),quote_id:id,opportunity_id:id,company_note_id:id,attachment:o({id,title:t.nullable(),content_type:z.literal('application/pdf'),file_size:count,offset:count,length:count,next_offset:count.nullable(),chunk_base64:t,whole_sha256:t}),association_scope:z.literal('opportunity_note'),acceptance_status:z.literal('not_established'),limitations:strings,provenance});
schemas.contract_context=o({status:c.readStatus,contract:record,collections:z.record(t,o({data:z.array(record),completeness:c.pageCompleteness})),limitations:strings});
schemas.project_context=o({status:c.readStatus,project:record,phases:read(z.array(record),true),tasks:read(z.array(record),true)});
schemas.invoice_context=o({status:z.literal('succeeded'),invoice:record,limitations:strings});
schemas.invoice_export=o({status:z.literal('succeeded'),invoice_id:id,format:z.literal('pdf'),export:o({content_type:z.literal('application/pdf'),file_name:t,data_base64:t,bytes:count}),limitations:strings});
schemas.billing_true_up=o({status:c.readStatus,contract:record,evidence:o({services:read(z.array(record),true),units:read(z.array(record),true)}),calculation:z.literal('not_performed'),warnings:strings});
schemas.expense_report_status=read(record.extend({submitterID:id}));
schemas.resource_availability=read(record.extend({resourceID:id}));
schemas.time_off_search=read(z.array(record.extend({resourceID:id})),true);
schemas.sync_ticket_changes=schemas.ticket_search!;
schemas.sync_status=o({configured_subscriptions:count,streams:z.array(o({webhook_guid:t,entity_type:t,received:count,latest_sequence:z.union([t,z.number()]),last_received:t,saw_deactivation:z.boolean()})),sequence_gaps:count,limitations:strings});
const report=o({definition:t,filters:d,group_by:t,data:z.array(o({value:scalar,count})),records:z.array(record),completeness:completeness.extend({returned:count,pages:count,next_cursor:t.nullable()}),count_scope:t,warnings:strings,continuation:o({operation:t,arguments:d}).nullable(),content_trust:t});
schemas.ticket_workload_report=report.extend({exclude_title_contains:t.nullable(),sort_by:z.array(o({field:z.enum(['companyID','ticketType','createDate','completedDate','status','queueID','priority','assignedResourceID','ticketNumber','title','id']),direction:z.enum(['asc','desc'])})),scanned_records:count,excluded_records:count});
schemas.sales_pipeline_report=report;
// The selected operation is validated against its exact output contract inside
// ToolRuntime before this generic dispatcher returns. Publishing every selected
// schema again here makes discovery unnecessarily large for MCP clients.
schemas.at_invoke=z.object({}).catchall(z.unknown()).refine(value=>Object.keys(value).length>0);
const cache=new Map<string,z.ZodType>();
export function outputSchemaFor(name:string):z.ZodType {
 const schema=schemas[name];if(!schema)throw new Error(`Missing output contract for exposed tool: ${name}`);
 if(!cache.has(name))cache.set(name,z.union([schema,c.errors]));
 return cache.get(name)!;
}
export function successSchemaFor(name:string):z.ZodType {
 const schema=schemas[name];if(!schema)throw new Error(`Missing output contract: ${name}`);return schema;
}
export function outputJsonSchema(name:string) {
 return publishedJsonSchema(outputSchemaFor(name),'output');
}
