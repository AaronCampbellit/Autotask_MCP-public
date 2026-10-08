import { assertEntityArea } from '../../policy/src/areas.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type DataRecord, type Entity, type Principal, type QueryRequest } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, projectRecord, reauthorize, validateQuery, validateRequestedFields } from '../../policy/src/index.js';
import type { TicketWorkflows } from './index.js';
const id=z.number().int().positive().safe(),entity=z.enum(['Tickets','Companies','TicketNotes','TimeEntries']);
const scalar=z.union([z.string().min(1).max(2000),z.number().finite(),z.boolean()]);
const filter=z.object({field:z.string().min(1).max(100),op:z.enum(['eq','in','contains','gte','lte','lt']),value:z.union([scalar,z.array(scalar).min(1).max(100)])}).strict();
export const querySchema=z.object({entity,filter:z.object({op:z.literal('and'),conditions:z.array(filter).max(8)}).strict().optional(),fields:z.array(z.string()).min(1).max(40).optional(),ticket_id:id.optional(),resource:z.enum(['self','team']).default('self'),page_size:z.number().int().min(1).max(500).default(50),cursor:z.string().min(1).max(4096).optional()}).strict().refine(v=>v.entity==='Tickets'||v.page_size<=100,'Only ticket queries support more than 100 records per page.');
export const getSchema=z.object({entity,id:z.number().int().nonnegative().safe(),fields:z.array(z.string()).min(1).max(40).optional(),ticket_id:id.optional(),resource:z.enum(['self','team']).default('self')}).strict().refine(v=>v.entity==='Companies'||v.id>0);
export const relatedSchema=z.object({parent:z.object({entity:z.literal('Tickets'),id}).strict(),relation:z.enum(['notes','time']),fields:z.array(z.string()).min(1).max(40).optional(),resource:z.enum(['self','team']).default('self'),page_size:z.number().int().min(1).max(100).default(50),cursor:z.string().min(1).max(4096).optional()}).strict();
const queryable:Record<Entity,readonly string[]>={Tickets:['id','companyID','status','queueID','priority','ticketType','assignedResourceID','ticketNumber','title','description','dueDateTime','createDate','lastActivityDate','completedDate','completedByResourceID'],Companies:['id','companyName','isActive'],TicketNotes:['id','ticketID','noteType','publish','createDateTime','title','description','creatorResourceID'],TimeEntries:['id','ticketID','resourceID','dateWorked','startDateTime','endDateTime','hoursWorked']};
/** Small reviewed query surface. Registry inventory is never executable authority. */
export class QueryWorkflows{
  constructor(private readonly core:TicketWorkflows){}
  private async current(p:Principal){p=await reauthorize(p,this.core.principals);assertCapability(p,'operational.read');return p;}
  private async scope(p:Principal,e:Entity,ticketId:number|undefined,resource:'self'|'team'){
    assertEntityArea(p,e);
    if(e==='TimeEntries')assertCapability(p,resource==='team'?'time.team':'time.self');
    if(e==='TicketNotes'||e==='TimeEntries'){if(!ticketId)throw new AppError('invalid_input','Related records require the authorized ticket_id.');await this.core.resolveTicket(p,{kind:'id',id:ticketId});}
    else if(ticketId!==undefined)throw new AppError('invalid_input','ticket_id applies only to ticket notes and time entries.');
  }
  private row(p:Principal,e:Entity,row:DataRecord,ticketId:number|undefined,resource:'self'|'team',fields?:string[]){
    if(e==='Tickets')assertCompanyScope(p,row.companyID);else if(e==='Companies')assertCompanyScope(p,row.id);
    else if(row.ticketID!==ticketId||(e==='TimeEntries'&&resource==='self'&&row.resourceID!==p.resourceId))throw new AppError('not_found_or_inaccessible','Related record not found or inaccessible.');
    return projectRecord(e,row,p,fields);
  }
  private envelope(data:unknown,returned:number,cursor:string|null){return{status:cursor?'partial':'succeeded',correlation_id:randomUUID(),data,completeness:{complete:!cursor,returned,next_cursor:cursor},provenance:{source:this.core.adapter.source,fetched_at:new Date().toISOString(),schema_version:'reviewed-query-v1',atomic_snapshot:false},warnings:this.core.adapter.source==='fixture'?['Fictitious development data.']:[]};}
  async query(p:Principal,input:unknown){const args=querySchema.parse(input);p=await this.current(p);await this.scope(p,args.entity,args.ticket_id,args.resource);if(args.fields)validateRequestedFields(args.entity,args.fields,p);
    const filters=(args.filter?.conditions??[]) as QueryRequest['filters'];if(filters.some(f=>!queryable[args.entity].includes(f.field)))throw new AppError('forbidden','A requested query field is not available.');
    validateQuery({entity:args.entity,filters,pageSize:args.page_size,cursor:args.cursor,fields:args.fields},p);
    if(args.entity==='Tickets')filters.push({field:'companyID',op:'in',value:p.companyIds});else if(args.entity==='Companies')filters.push({field:'id',op:'in',value:p.companyIds});else filters.push({field:'ticketID',op:'eq',value:args.ticket_id});
    if(args.entity==='TimeEntries'&&args.resource==='self')filters.push({field:'resourceID',op:'eq',value:p.resourceId});
    const request:QueryRequest={entity:args.entity,filters,pageSize:args.page_size,cursor:args.cursor,...(args.entity==='TicketNotes'?{parentId:args.ticket_id}:{})};validateQuery(request,p);const page=await this.core.adapter.query(p,request);p=await this.current(p);await this.scope(p,args.entity,args.ticket_id,args.resource);return this.envelope({entity:args.entity,items:page.items.map(row=>this.row(p,args.entity,row,args.ticket_id,args.resource,args.fields))},page.items.length,page.nextCursor);
  }
  async get(p:Principal,input:unknown){const args=getSchema.parse(input);p=await this.current(p);await this.scope(p,args.entity,args.ticket_id,args.resource);if(args.fields)validateRequestedFields(args.entity,args.fields,p);let row:DataRecord;if(args.entity==='TimeEntries'){const filters:QueryRequest['filters']=[{field:'id',op:'eq',value:args.id},{field:'ticketID',op:'eq',value:args.ticket_id!}];if(args.resource==='self')filters.push({field:'resourceID',op:'eq',value:p.resourceId});const page=await this.core.adapter.query(p,{entity:'TimeEntries',filters,pageSize:2});if(page.items.length!==1||page.nextCursor||page.items[0]!.id!==args.id)throw new AppError('not_found_or_inaccessible','Time entry not found or inaccessible.');row=page.items[0]!;}else row=args.entity==='TicketNotes'?await this.core.adapter.getTicketNote(p,args.ticket_id!,args.id):await this.core.adapter.get(p,args.entity,args.id);p=await this.current(p);await this.scope(p,args.entity,args.ticket_id,args.resource);return this.envelope({entity:args.entity,item:this.row(p,args.entity,row,args.ticket_id,args.resource,args.fields)},1,null);}
  async related(p:Principal,input:unknown){const args=relatedSchema.parse(input);return this.query(p,{entity:args.relation==='notes'?'TicketNotes':'TimeEntries',ticket_id:args.parent.id,fields:args.fields,resource:args.resource,page_size:args.page_size,cursor:args.cursor});}
}
