import {z} from 'zod';
import {ticketReferenceSchema} from '../../technician/src/index.js';
const uid=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),id=z.number().int().positive(),text=z.string().trim().min(1).max(500),value=z.string().max(16000);
const page={page_size:z.number().int().min(1).max(100).default(50),cursor:z.string().max(16000).optional()},device={device_uid:uid},site={site_uid:uid},key={request_key:z.string().min(8).max(128)};
const mac=z.string().regex(/^(?:[0-9a-fA-F]{12}|(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})$/).transform(v=>v.replace(/[:-]/g,'').toUpperCase());
const siteFields={name:text,description:value.optional(),notes:value.optional(),onDemand:z.boolean().optional(),splashtopAutoInstall:z.boolean().optional()};
export const extendedSchemas={
 rmm_device_lookup:z.object({device_id:id.optional(),mac_address:mac.optional()}).strict().refine(v=>Number(v.device_id!==undefined)+Number(v.mac_address!==undefined)===1,'Supply exactly one lookup key.'),
 rmm_device_audit_by_mac:z.object({mac_address:mac}).strict(),
 rmm_account_device_search:z.object({...page,filter_id:id.optional(),hostname:text.optional(),device_type:text.optional(),operating_system:text.optional(),site_name:text.optional()}).strict(),
 rmm_account_alert_list:z.object({...page,page_size:z.number().int().min(1).max(20).default(10),state:z.enum(['open','resolved']).default('open')}).strict(),
 rmm_filter_list:z.object({...page,kind:z.enum(['default','custom'])}).strict(),
 rmm_site_get:z.object(site).strict(),rmm_site_settings_get:z.object(site).strict(),
 rmm_account_get:z.object({}).strict(),rmm_account_user_list:z.object(page).strict(),rmm_network_mapping_list:z.object(page).strict(),
 rmm_system_get:z.object({kind:z.enum(['status','request_rate','pagination'])}).strict(),
 rmm_activity_list:z.object({...page,from:z.iso.datetime({offset:true}).optional(),until:z.iso.datetime({offset:true}).optional(),search_query:text.optional(),order:z.enum(['asc','desc']).default('desc'),entities:z.array(z.enum(['device','user'])).max(2).optional(),categories:z.array(text).max(20).optional(),actions:z.array(text).max(20).optional(),site_ids:z.array(id).max(100).optional(),user_ids:z.array(id).max(100).optional()}).strict(),
 rmm_variable_list:z.object({...page,scope:z.enum(['site','account']),site_uid:uid.optional()}).strict().refine(v=>(v.scope==='site')===(v.site_uid!==undefined),'site_uid is required only for site scope.'),
 rmm_external_job_get:z.object({job_uid:uid}).strict(),
 rmm_job_component_list:z.object({...page,job_uid:uid}).strict(),
 rmm_external_job_result_get:z.object({job_uid:uid,...device}).strict(),
 rmm_external_job_output_get:z.object({job_uid:uid,...device,stream:z.enum(['stdout','stderr'])}).strict(),
 rmm_alert_resolve:z.object({alert_uid:uid,...key}).strict(),
 rmm_device_warranty_set:z.object({...device,...key,warranty_date:z.iso.date(),expected_warranty_date:z.string().max(100).nullable()}).strict(),
 rmm_device_udf_set:z.object({...device,...key,fields:z.record(z.string().regex(/^udf(?:[1-9]|[1-9][0-9]|[12][0-9]{2}|300)$/),value).refine(v=>Object.keys(v).length>0)}).strict(),
 rmm_device_move:z.object({...device,...site,...key,expected_site_uid:uid}).strict(),
 rmm_site_create:z.object({...siteFields,...key}).strict(),
 rmm_site_update:z.object({...site,...key,fields:z.object(siteFields).strict(),expected:z.object({name:text,description:value.nullable().optional(),notes:value.nullable().optional(),onDemand:z.boolean().nullable().optional(),splashtopAutoInstall:z.boolean().nullable().optional()}).strict()}).strict().refine(v=>Object.keys(v.fields).every(k=>Object.hasOwn(v.expected,k)),'Supply expected values for every changed field.'),
 rmm_variable_create:z.object({...key,scope:z.enum(['site','account']),site_uid:uid.optional(),name:text,value,masked:z.boolean().default(true)}).strict().refine(v=>(v.scope==='site')===(v.site_uid!==undefined)),
 rmm_variable_update:z.object({...key,scope:z.enum(['site','account']),site_uid:uid.optional(),variable_id:id,name:text,value}).strict().refine(v=>(v.scope==='site')===(v.site_uid!==undefined)),
 rmm_variable_delete:z.object({...key,scope:z.enum(['site','account']),site_uid:uid.optional(),variable_id:id}).strict().refine(v=>(v.scope==='site')===(v.site_uid!==undefined)),
 rmm_site_proxy_set:z.object({...site,...key,settings:z.object({host:text,port:z.number().int().min(1).max(65535),type:z.enum(['http','socks4','socks5']),username:value.optional(),password:value.optional()}).strict()}).strict(),
 rmm_site_proxy_delete:z.object({...site,...key}).strict(),
 rmm_operation_get:z.object({operation_id:z.string().uuid()}).strict(),
 rmm_fleet_software_search:z.object({...page,site_uid:uid.optional(),name:text,version:text.optional()}).strict(),
 rmm_device_snapshot_save:z.object({...device,...key}).strict(),
 rmm_device_snapshot_list:z.object(device).strict(),
 rmm_device_snapshot_compare:z.object({...device,before_id:z.string().uuid(),after_id:z.string().uuid()}).strict(),
 rmm_ticket_device_link:z.object({ticket:ticketReferenceSchema,...device,...key}).strict(),
 rmm_ticket_context:z.object({ticket:ticketReferenceSchema}).strict(),
 rmm_ticket_diagnostic_run:z.object({ticket:ticketReferenceSchema,component_uid:uid,job_name:z.string().trim().min(1).max(100),...key}).strict(),
 rmm_ticket_diagnostic_attach:z.object({ticket:ticketReferenceSchema,operation_id:z.string().uuid(),...key}).strict(),
};
export const rmmNativeWrites=new Set(['rmm_quickjob_run','rmm_alert_resolve','rmm_device_warranty_set','rmm_device_udf_set','rmm_device_move','rmm_site_create','rmm_site_update','rmm_variable_create','rmm_variable_update','rmm_variable_delete','rmm_site_proxy_set','rmm_site_proxy_delete','rmm_ticket_diagnostic_run','rmm_ticket_diagnostic_attach']);
export const rmmLocalWrites=new Set(['rmm_device_snapshot_save','rmm_ticket_device_link']);
export const rmmAdminTools=new Set(['rmm_account_get','rmm_account_user_list','rmm_network_mapping_list','rmm_system_get','rmm_activity_list','rmm_site_settings_get','rmm_variable_list','rmm_external_job_get','rmm_job_component_list','rmm_external_job_result_get','rmm_external_job_output_get','rmm_site_create','rmm_site_update','rmm_variable_create','rmm_variable_update','rmm_variable_delete','rmm_site_proxy_set','rmm_site_proxy_delete','rmm_ticket_device_link']);
export const rmmExecutionTools=new Set(['rmm_quickjob_run','rmm_ticket_diagnostic_run']);
