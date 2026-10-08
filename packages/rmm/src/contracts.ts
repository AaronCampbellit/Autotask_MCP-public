import {z} from 'zod';
import {extendedSchemas,rmmNativeWrites,rmmLocalWrites,rmmAdminTools,rmmExecutionTools} from './extended-contracts.js';
import {deviceSearchShape} from './device-search.js';
import type {Capability} from '../../contracts/src/index.js';
export const uid=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const page={page_size:z.number().int().min(1).max(100).default(50),cursor:z.string().max(8192).optional()};
const device={device_uid:uid};const site={site_uid:uid};
export const schemas={
 ...extendedSchemas,
 rmm_site_list:z.object({}).strict(),
 rmm_device_search:z.object({...deviceSearchShape,site_uid:uid.optional().describe('Limit to one authorized site. Omit to search all enabled sites in your company scope.'),...page}).strict(),
 rmm_device_get:z.object(device).strict(),
 rmm_device_audit_get:z.object(device).strict(),
 rmm_device_software_list:z.object({...device,...page}).strict(),
 rmm_device_patch_list:z.object({...device,...page}).strict(),
 rmm_site_patch_list:z.object({...site,...page}).strict(),
 rmm_device_alert_list:z.object({...device,...page,state:z.enum(['open','resolved']).default('open')}).strict(),
 rmm_site_alert_list:z.object({...site,...page,state:z.enum(['open','resolved']).default('open')}).strict(),
 rmm_alert_get:z.object({alert_uid:uid}).strict(),
 rmm_site_network_list:z.object({...site,...page}).strict(),
 rmm_site_filter_list:z.object({...site,...page}).strict(),
 rmm_component_list:z.object({...page}).strict(),
 rmm_job_list:z.object({}).strict(),
 rmm_job_get:z.object({operation_id:z.string().uuid()}).strict(),
 rmm_job_result_get:z.object({operation_id:z.string().uuid()}).strict(),
 rmm_job_output_get:z.object({operation_id:z.string().uuid(),stream:z.enum(['stdout','stderr'])}).strict(),
 rmm_quickjob_run:z.object({...device,component_uid:uid,job_name:z.string().min(1).max(100),request_key:z.string().min(8).max(128)}).strict(),
};
export type RmmTool=keyof typeof schemas;
export const rmmOperations:Record<string,{write:boolean;capabilities:Capability[]}>=Object.fromEntries(Object.keys(schemas).map(name=>[name,{write:rmmNativeWrites.has(name)||rmmLocalWrites.has(name),capabilities:['rmm.read',...(rmmExecutionTools.has(name)?['rmm.execute']:rmmNativeWrites.has(name)||name==='rmm_ticket_device_link'?['rmm.write']:[]),...(rmmAdminTools.has(name)?['platform.manage']:[]),...(name.startsWith('rmm_ticket_')?['operational.read']:[]),...(name==='rmm_ticket_diagnostic_attach'?['tickets.write']:[])] as Capability[]}]));
export const rmmOutput=z.object({status:z.enum(['succeeded','partial','accepted','unknown_outcome','failed','dispatching','reserved']),data:z.unknown(),completeness:z.object({complete:z.boolean(),next_cursor:z.string().nullable()}),provenance:z.object({source:z.literal('Datto RMM'),fetched_at:z.string(),cache_age_ms:z.number().nonnegative().optional(),cache_hit:z.boolean().optional()}),warnings:z.array(z.string())}).strict();
