import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError,actorKey,type JournalRecord,type Principal} from '../../contracts/src/index.js';
import {assertCapability,assertCompanyScope,reauthorize} from '../../policy/src/index.js';
import {assertArea} from '../../policy/src/areas.js';
import type {TicketWorkflows} from './index.js';
import {ticketReferenceSchema} from './index.js';
import type {TechnicianWorkflows} from './technician-workflows.js';

const label=z.string().trim().min(1).max(250);
const personRef=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('id'),id:z.number().int().positive().safe(),name:label}).strict(),
 z.object({kind:z.literal('name'),name:label}).strict(),
]);
const roleRef=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('id'),id:z.number().int().positive().safe(),name:label}).strict(),
 z.object({kind:z.literal('name'),name:label}).strict(),
]);
const requestKey=z.string().min(8).max(128).refine(v=>!v.startsWith('job:')&&!v.startsWith('wf:'),'This request-key prefix is reserved.');
export const ticketSecondaryResourceOptionsSchema=z.object({ticket:ticketReferenceSchema}).strict();
export const ticketSecondaryResourceAddSchema=z.object({ticket:ticketReferenceSchema,resource:personRef,role:roleRef,request_key:requestKey}).strict();
export const ticketSecondaryResourceRemoveSchema=z.object({ticket:ticketReferenceSchema,secondary_resource_id:z.number().int().positive().safe(),resource_id:z.number().int().positive().safe(),role_id:z.number().int().positive().safe(),request_key:requestKey}).strict();
export const ticketPrimaryResourceAssignSchema=z.object({ticket:ticketReferenceSchema,resource:personRef,role:roleRef,expected_primary_resource_id:z.number().int().positive().safe().nullable(),expected_primary_role_id:z.number().int().positive().safe().nullable(),request_key:requestKey}).strict();
type Options={ticket_id:number;company_id:number;primary_resource_id:number|null;primary_role_id:number|null;secondary_resources:{id:number;resource_id:number;role_id:number}[];eligible_resource_roles:{resource_id:number;resource_name:string;role_id:number;role_name:string}[];limit:number;remaining:number;valid_until:string};
const normalized=(v:string)=>v.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`:JSON.stringify(v)??'null';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const unavailable=()=>new AppError('not_found_or_inaccessible','Ticket or secondary-resource choice is unavailable.');

/** Adds one explicitly selected ticket resource after a fresh complete role/resource read. */
export class TicketSecondaryResourceWorkflows {
 constructor(private readonly core:TicketWorkflows,private readonly resolveOptions:(p:Principal,ticketId:number,knownTicket?:Record<string,unknown>)=>Promise<Options>,private readonly technician:TechnicianWorkflows,private readonly now:()=>number=Date.now){}
 private async current(p:Principal,write:boolean){const fresh=await reauthorize(p,this.core.principals,{resourceMaxAgeMs:300_000,now:()=>new Date(this.now())});assertCapability(fresh,'operational.read');assertArea(fresh,'tickets',write);if(write)assertCapability(fresh,'tickets.write');return fresh;}
 private async ticket(p:Principal,ref:z.infer<typeof ticketReferenceSchema>){const t=await this.core.resolveTicket(p,ref);assertCompanyScope(p,t.companyID);return t;}
 async options(p:Principal,input:unknown){const a=ticketSecondaryResourceOptionsSchema.parse(input);p=await this.current(p,false);const ticket=await this.ticket(p,a.ticket),data=await this.resolveOptions(p,ticket.id,ticket);p=await this.current(p,false);if(data.ticket_id!==ticket.id||data.company_id!==ticket.companyID||Date.parse(data.valid_until)<=this.now())throw new AppError('missing_metadata','Current ticket resource and role options are incomplete or expired.');return{status:'succeeded',...data,provenance:{source:this.core.adapter.source,fetched_at:new Date(this.now()).toISOString()},warnings:['Only active employee/resource-role pairs returned by Autotask are eligible.']};}
 private selected(options:Options,resource:z.infer<typeof personRef>,role:z.infer<typeof roleRef>){
  let resourceRows=options.eligible_resource_roles.filter(v=>resource.kind==='id'?v.resource_id===resource.id:normalized(v.resource_name)===normalized(resource.name));
  if(resource.kind==='id')resourceRows=resourceRows.filter(v=>normalized(v.resource_name)===normalized(resource.name));
  if(new Set(resourceRows.map(v=>`${v.resource_id}:${normalized(v.resource_name)}`)).size!==1)throw unavailable();
  let roles=resourceRows.filter(v=>role.kind==='id'?v.role_id===role.id:normalized(v.role_name)===normalized(role.name));
  if(role.kind==='id')roles=roles.filter(v=>normalized(v.role_name)===normalized(role.name));
  if(roles.length!==1)throw unavailable();return roles[0]!;
 }
 private view(r:JournalRecord){const removed=r.operation==='ticket_secondary_resource_remove';return{status:r.state,operation_id:r.id,data:r.result??{},can_resume:false,safe_to_redispatch:false,receipt:r.state==='succeeded_verified'?`The secondary resource was ${removed?'removed':'added'} and verified.`:r.state==='failed'?`The secondary resource was not ${removed?'removed':'added'}.`:'The write outcome is not confirmed. Check the ticket before attempting another change.',provenance:{source:this.core.adapter.source}};}
 async assignPrimary(p:Principal,input:unknown){
  const a=ticketPrimaryResourceAssignSchema.parse(input);p=await this.current(p,true);
  const ticket=await this.ticket(p,a.ticket),options=await this.resolveOptions(p,ticket.id,ticket);
  if(options.ticket_id!==ticket.id||options.company_id!==ticket.companyID||Date.parse(options.valid_until)<=this.now())throw new AppError('missing_metadata','Current ticket assignment choices are incomplete or expired.');
  const selected=this.selected(options,a.resource,a.role);
  const prior=await this.core.journal.find(actorKey(p),a.request_key);
  if(!prior){
   if(options.primary_resource_id!==a.expected_primary_resource_id||options.primary_role_id!==a.expected_primary_role_id)throw new AppError('conflict','The primary assignment changed. Refresh ticket_secondary_resource_options.');
   if(options.secondary_resources.some(v=>v.resource_id===selected.resource_id))throw new AppError('precondition_failed','This employee is already secondary. Remove that exact secondary assignment first.');
   if(options.primary_resource_id===selected.resource_id&&options.primary_role_id===selected.role_id)throw new AppError('conflict','The selected primary employee and role are already assigned.');
  }
  return this.technician.update(p,{ticket:{kind:'id',id:ticket.id},changes:{owner:{kind:'id',id:selected.resource_id,name:selected.resource_name},role:{kind:'id',id:selected.role_id}},expected:{assignedResourceID:a.expected_primary_resource_id,assignedResourceRoleID:a.expected_primary_role_id},request_key:a.request_key});
 }
 async add(p:Principal,input:unknown){
  const a=ticketSecondaryResourceAddSchema.parse(input);p=await this.current(p,true);if(!this.core.adapter.createTicketSecondaryResource||!this.core.adapter.getTicketSecondaryResource)throw new AppError('unsupported_operation','Ticket secondary-resource writes are unavailable in this environment.');
  const ticket=await this.ticket(p,a.ticket),options=await this.resolveOptions(p,ticket.id,ticket);if(options.ticket_id!==ticket.id||options.company_id!==ticket.companyID||Date.parse(options.valid_until)<=this.now())throw new AppError('missing_metadata','Current ticket resource and role options are incomplete or expired.');
  const selected=this.selected(options,a.resource,a.role);if(selected.resource_id===options.primary_resource_id)throw new AppError('invalid_input','The selected employee is already the primary ticket resource.');
  const payload={ticket_id:ticket.id,resource_id:selected.resource_id,resource_name:selected.resource_name,role_id:selected.role_id,role_name:selected.role_name},payloadHash=hash({definition:'ticket-secondary-resource-add-v1',actor:actorKey(p),mapping:p.mappingVersion,policy:p.policyVersion,payload});
  const prior=await this.core.journal.find(actorKey(p),a.request_key);if(prior){if(prior.operation!=='ticket_secondary_resource_add'||prior.payloadHash!==payloadHash||prior.mappingVersion!==p.mappingVersion||prior.resourceId!==p.resourceId||prior.policyVersion!==p.policyVersion)throw new AppError('conflict','This request key belongs to different work.');return this.view(prior);}
  if(options.secondary_resources.some(v=>v.resource_id===selected.resource_id))throw new AppError('conflict','The selected employee is already assigned as a secondary resource.');if(options.secondary_resources.length>=50||options.remaining<=0)throw new AppError('precondition_failed','This ticket already has the maximum 50 secondary resources.');
  const reservation=await this.core.journal.reserve({actorKey:actorKey(p),requestKey:a.request_key,payloadHash,operation:'ticket_secondary_resource_add',mappingVersion:p.mappingVersion,resourceId:p.resourceId,policyVersion:p.policyVersion,result:{...payload}});if(!reservation.created)return this.view(reservation.record);
  let state:JournalRecord['state']='ready',accepted=false;
  try{
   await this.core.journal.transition(reservation.record.id,'ready','dispatching',{ticket_id:ticket.id,resource_id:selected.resource_id,role_id:selected.role_id});state='dispatching';
   const beforeDispatch=async()=>{p=await this.current(p,true);const freshTicket=await this.ticket(p,{kind:'id',id:ticket.id}),fresh=await this.resolveOptions(p,ticket.id,freshTicket);if(freshTicket.companyID!==ticket.companyID||fresh.company_id!==ticket.companyID||Date.parse(fresh.valid_until)<=this.now())throw new AppError('precondition_failed','Ticket access or secondary-resource options changed before dispatch.');const current=this.selected(fresh,a.resource,a.role);if(current.resource_id!==selected.resource_id||current.role_id!==selected.role_id||current.resource_name!==selected.resource_name||current.role_name!==selected.role_name||current.resource_id===fresh.primary_resource_id||fresh.secondary_resources.some(v=>v.resource_id===current.resource_id)||fresh.secondary_resources.length>=50)throw new AppError('precondition_failed','The selected employee, role or ticket assignments changed before dispatch. Refresh the options.');};
   const saved=await this.core.adapter.createTicketSecondaryResource(p,ticket.id,selected.resource_id,selected.role_id,beforeDispatch);accepted=true;
   let record=await this.core.journal.transition(reservation.record.id,'dispatching','accepted_unverified',{...payload,secondary_resource_id:saved.id,verification:{performed:false}});state='accepted_unverified';
   const row=await this.core.adapter.getTicketSecondaryResource(p,ticket.id,saved.id),verified=row.id===saved.id&&row.ticketID===ticket.id&&row.resourceID===selected.resource_id&&row.roleID===selected.role_id;
   if(verified)record=await this.core.journal.transition(record.id,'accepted_unverified','succeeded_verified',{...payload,secondary_resource_id:saved.id,verification:{performed:true,complete:true}});
   return this.view(record);
  }catch(error){const code=error instanceof AppError?error.code:'dependency_unavailable';const unknown=accepted||code==='unknown_outcome';try{await this.core.journal.transition(reservation.record.id,state,unknown?'unknown_outcome':'failed',{ticket_id:ticket.id,resource_id:selected.resource_id,role_id:selected.role_id,error_code:code,verification:{performed:false}});}catch{}const saved=await this.core.journal.get(reservation.record.id,actorKey(p));if(saved)return this.view(saved);throw error;}
 }
 async remove(p:Principal,input:unknown){
  const a=ticketSecondaryResourceRemoveSchema.parse(input);p=await this.current(p,true);
  if(!this.core.adapter.deleteTicketSecondaryResource)throw new AppError('unsupported_operation','Ticket secondary-resource removal is unavailable in this environment.');
  const ticket=await this.ticket(p,a.ticket),options=await this.resolveOptions(p,ticket.id,ticket);
  if(options.ticket_id!==ticket.id||options.company_id!==ticket.companyID||Date.parse(options.valid_until)<=this.now())throw new AppError('missing_metadata','Current ticket assignments are incomplete or expired.');
  const payload={ticket_id:ticket.id,secondary_resource_id:a.secondary_resource_id,resource_id:a.resource_id,role_id:a.role_id},payloadHash=hash({definition:'ticket-secondary-resource-remove-v1',actor:actorKey(p),mapping:p.mappingVersion,policy:p.policyVersion,payload});
  const prior=await this.core.journal.find(actorKey(p),a.request_key);
  if(prior){if(prior.operation!=='ticket_secondary_resource_remove'||prior.payloadHash!==payloadHash||prior.mappingVersion!==p.mappingVersion||prior.resourceId!==p.resourceId||prior.policyVersion!==p.policyVersion)throw new AppError('conflict','This request key belongs to different work.');return this.view(prior);}
  const match=options.secondary_resources.find(v=>v.id===a.secondary_resource_id&&v.resource_id===a.resource_id&&v.role_id===a.role_id);
  if(!match)throw unavailable();
  const reservation=await this.core.journal.reserve({actorKey:actorKey(p),requestKey:a.request_key,payloadHash,operation:'ticket_secondary_resource_remove',mappingVersion:p.mappingVersion,resourceId:p.resourceId,policyVersion:p.policyVersion,result:{...payload}});
  if(!reservation.created)return this.view(reservation.record);
  let state:JournalRecord['state']='ready',accepted=false;
  try{
   await this.core.journal.transition(reservation.record.id,'ready','dispatching',{...payload});state='dispatching';
   const beforeDispatch=async()=>{p=await this.current(p,true);const freshTicket=await this.ticket(p,{kind:'id',id:ticket.id}),fresh=await this.resolveOptions(p,ticket.id,freshTicket);if(freshTicket.companyID!==ticket.companyID||fresh.company_id!==ticket.companyID||Date.parse(fresh.valid_until)<=this.now()||!fresh.secondary_resources.some(v=>v.id===match.id&&v.resource_id===match.resource_id&&v.role_id===match.role_id))throw new AppError('precondition_failed','The secondary assignment changed before dispatch. Refresh the options.');};
   await this.core.adapter.deleteTicketSecondaryResource(p,ticket.id,match.id,beforeDispatch);accepted=true;
   let record=await this.core.journal.transition(reservation.record.id,'dispatching','accepted_unverified',{...payload,verification:{performed:false}});state='accepted_unverified';
   const currentTicket=await this.ticket(p,{kind:'id',id:ticket.id}),fresh=await this.resolveOptions(p,ticket.id,currentTicket);
   if(currentTicket.companyID===ticket.companyID&&fresh.company_id===ticket.companyID&&!fresh.secondary_resources.some(v=>v.id===match.id))record=await this.core.journal.transition(record.id,'accepted_unverified','succeeded_verified',{...payload,verification:{performed:true,complete:true}});
   return this.view(record);
  }catch(error){const code=error instanceof AppError?error.code:'dependency_unavailable';const unknown=accepted||code==='unknown_outcome';try{await this.core.journal.transition(reservation.record.id,state,unknown?'unknown_outcome':'failed',{...payload,error_code:code,verification:{performed:false}});}catch{}const saved=await this.core.journal.get(reservation.record.id,actorKey(p));if(saved)return this.view(saved);throw error;}
 }
 async status(p:Principal,input:unknown){const a=z.object({operation_id:z.string().uuid()}).strict().parse(input);p=await this.current(p,false);const r=await this.core.journal.get(a.operation_id,actorKey(p));if(!r||!['ticket_secondary_resource_add','ticket_secondary_resource_remove'].includes(r.operation)||r.mappingVersion!==p.mappingVersion||r.resourceId!==p.resourceId||r.policyVersion!==p.policyVersion)throw unavailable();if(r.result?.ticket_id)await this.ticket(p,{kind:'id',id:Number(r.result.ticket_id)});return this.view(r);}
}
