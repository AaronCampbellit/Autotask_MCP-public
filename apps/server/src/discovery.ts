import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError,actorKey,type Principal} from '../../../packages/contracts/src/index.js';
import {IntentCipher} from '../../../packages/storage/src/intent-cipher.js';
import type {ToolSpec} from './tool-runtime.js';
export const effectKinds=['read','local_persistence','native_mutation','orchestration','cancellation'] as const;
export type EffectKind=typeof effectKinds[number];
export function effectMetadata(tool:Pick<ToolSpec,'name'|'write'|'mixed'|'localEffect'|'destructive'|'idempotent'>){
 const localNames=new Set(['at_operation_reconcile','at_artifact_export','at_artifact_delete','at_file_stage','opportunity_file_stage','rmm_device_snapshot_save','rmm_ticket_device_link','at_select_company']);
 const kind:EffectKind=tool.name==='at_job_cancel'||tool.name==='report_job_cancel'||tool.name==='read_report_cancel'?'cancellation':tool.mixed||tool.name==='at_invoke'||tool.name==='at_job_start'||tool.name==='report_job_start'||tool.name==='client_health_report_start'?'orchestration':tool.localEffect||localNames.has(tool.name)?'local_persistence':tool.write?'native_mutation':'read';
 return{kind,readOnly:kind==='read',destructive:tool.destructive??false,idempotent:tool.idempotent??true};
}
export const discoverySchema=z.object({query:z.string().max(100).optional(),effect:z.enum(['read','write']).optional(),effect_kind:z.enum(effectKinds).optional(),category:z.string().regex(/^[a-z_]{1,40}$/).optional(),page_size:z.number().int().min(1).max(100).default(25),cursor:z.string().max(8192).optional()}).strict();
export const readInvokeSchema=z.object({operation:z.string().min(1).max(128),arguments:z.record(z.string(),z.unknown())}).strict();
export const operationCategory=(name:string)=>name.startsWith('itg_')?'documentation':name.startsWith('rmm_')?'rmm':name.startsWith('at_')?'support':name.split('_')[0]!;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function principalMetadataPartition(p:Principal,configurationVersion:string,profile:string){return digest({actor:actorKey(p),mapping:p.mappingVersion,policy:p.policyVersion,active:p.active,capabilities:[...p.capabilities].sort(),areas:[...(p.areaPermissions??[])].sort(),companies:[...p.companyIds].sort((a,b)=>a-b),allCompanies:p.allCompanies??false,configurationVersion,profile});}
/** The supplied list MUST already be freshly authorized. A cursor never grants access. */
export function discoverPage(tools:readonly ToolSpec[],p:Principal,input:unknown,cipher:IntentCipher,now=Date.now()){
 const a=discoverySchema.parse(input),{cursor,...filters}=a;
 const operations=tools.map(t=>{const e=effectMetadata(t);return{name:t.name,description:t.description,effect:t.mixed?'mixed':e.readOnly?'read':'write',effect_kind:e.kind,category:operationCategory(t.name),schema_version:'technician-v2'};}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 const metadata_digest=digest(operations),binding=digest({partition:principalMetadataPartition(p,metadata_digest,'operation-search'),filters});let offset=0;
 if(cursor){const v=cipher.open(cursor,`discovery:${actorKey(p)}`) as Record<string,unknown>;if(v.binding!==binding||typeof v.expires!=='number'||v.expires<now||!Number.isInteger(v.offset)||(v.offset as number)<0)throw new AppError('conflict','Discovery cursor expired or permissions/catalog changed.');offset=v.offset as number;}
 const filtered=operations.filter(t=>(!a.query||`${t.name} ${t.description}`.toLowerCase().includes(a.query.toLowerCase()))&&(!a.effect||(a.effect==='read'?t.effect_kind==='read':t.effect_kind!=='read'))&&(!a.effect_kind||t.effect_kind===a.effect_kind)&&(!a.category||t.category===a.category));
 if(offset>filtered.length)throw new AppError('conflict','Discovery cursor is outside this result set.');
 const next=offset+a.page_size<filtered.length?cipher.seal({binding,offset:offset+a.page_size,expires:now+900000},`discovery:${actorKey(p)}`):null;
 return{operations:filtered.slice(offset,offset+a.page_size),next_cursor:next,metadata_digest,complete:next===null};
}
export function assertReadDispatch(tool:Pick<ToolSpec,'name'|'write'|'mixed'|'localEffect'|'destructive'|'idempotent'>){if(!effectMetadata(tool).readOnly||['at_invoke','at_read_invoke'].includes(tool.name))throw new AppError('unsupported_operation','Read dispatcher accepts only concrete operations without side effects.');}
export type DiscoveryProfile='full'|'technician';
const technicianReads=new Set(['at_discover','at_describe','at_read_invoke','at_diagnostics','at_operation_status','at_operation_reconcile','at_job_status','at_job_list','ticket_search','ticket_context','ticket_requirements','ticket_completion_search','ticket_status_transition_search','time_entry_search','my_workday','schedule_search','ticket_environment_context','client_inventory_compare','at_reference_resolve','at_playbook_list','at_playbook_get','at_invoke','at_whoami','ticket_write_options','ticket_create_options','time_entry_clock','ticket_create','ticket_update','ticket_note_add','time_log_ticket','ticket_document_work','ticket_complete','at_operation_resume','at_operation_reconcile','at_job_start','at_job_cancel','client_health_report_start','read_report_status','read_report_cancel']);
/** Selection depends only on configured profile + authorized operations, never discovery history. */
export function selectDiscoveryProfile(tools:readonly ToolSpec[],profile:DiscoveryProfile){return tools.filter(t=>profile==='full'||technicianReads.has(t.name)).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);}
/** Metadata only. Disabled unless a configured host pilot has acceptance evidence. Never cache execution permission. */
export class PrivateMetadataCache<T> {
 private entries=new Map<string,{expires:number;value:T}>();
 constructor(private options:{ttlMs:number;hostEvidence?:string;maxEntries?:number},private now=Date.now){if(!Number.isInteger(options.maxEntries??100)||(options.maxEntries??100)<1)throw new Error('Metadata cache requires a positive entry bound.');if(options.ttlMs<0||options.ttlMs>60000)throw new Error('Metadata TTL must be between 0 and 60 seconds.');}
 get(key:string):T|undefined{if(!this.options.hostEvidence||!this.options.ttlMs)return;const entry=this.entries.get(key);if(!entry)return;if(entry.expires<=this.now()){this.entries.delete(key);return;}return structuredClone(entry.value);}
 set(key:string,value:T){if(!this.options.hostEvidence||!this.options.ttlMs)return;for(const [k,v]of this.entries)if(v.expires<=this.now())this.entries.delete(k);this.entries.delete(key);while(this.entries.size>=(this.options.maxEntries??100))this.entries.delete(this.entries.keys().next().value!);this.entries.set(key,{expires:this.now()+this.options.ttlMs,value:structuredClone(value)});}
 clear(){this.entries.clear();}
}
