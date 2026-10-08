import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, positiveId, type DataRecord, type Principal, type QueryRequest } from '../../contracts/src/index.js';
import { assertArea } from '../../policy/src/areas.js';
import { assertCapability, assertCompanyScope, projectRecord, reauthorize, validateQuery } from '../../policy/src/index.js';
import { businessReferenceSchema, companyReferenceSchema, workDateSchema, ticketReferenceSchema, assertReferenceCatalog } from '../../technician/src/index.js';
import { IntentCipher } from '../../storage/src/index.js';
import { timeInputSchema } from '../../resolution/src/index.js';
import { dayWindow, type TechnicianWorkflows } from './technician-workflows.js';
import { canonicalCompanyName } from './company-aliases.js';

export const completionPeriodSchema = z.discriminatedUnion('period', [
  z.object({period:z.enum(['today','yesterday','this_week','last_week','this_month','last_month']),timezone:timeInputSchema.shape.timezone}).strict(),
  z.object({period:z.literal('custom'),start_date:workDateSchema,end_date:workDateSchema,timezone:timeInputSchema.shape.timezone}).strict(),
]).describe('Local calendar dates; weeks start Monday. Custom end_date is exclusive. Relative periods are frozen into continuations.');
export const completionSearchSchema = z.object({
  window:completionPeriodSchema,
  completed_by:businessReferenceSchema.optional().describe('Use self for I completed. Omit for all completing employees. Never substitute current assignee.'),
  technician:businessReferenceSchema.optional().describe('Optional CURRENT assignee, independent of the employee who completed the ticket.'),
  company:companyReferenceSchema.optional(),
  ticket:ticketReferenceSchema.optional().describe('Optional exact ticket for a completion-history audit.'),
  current_state:z.enum(['any','completed','reopened']).default('any'),
  page_size:z.number().int().min(1).max(25).default(10).describe('Candidate tickets examined per call; a page may contain no matches and still have a next_cursor.'),
  cursor:z.string().max(16000).optional(),
}).strict();
const windowSchema=z.object({start:z.string().datetime(),end:z.string().datetime(),timezone:z.string(),start_date:workDateSchema,end_date:workDateSchema}).strict();
const cursorSchema=z.object({next:z.string(),window:windowSchema,expires:z.number(),scanned:z.number().int().nonnegative(),tickets:z.number().int().nonnegative(),events:z.number().int().nonnegative(),incomplete:z.number().int().nonnegative(),resolution:z.string()}).strict();
export function completionWindow(input:z.infer<typeof completionPeriodSchema>,now:Date) {
  const v=completionPeriodSchema.parse(input);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:v.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  let start:string,end:string;
  if(v.period==='custom'){start=v.start_date;end=v.end_date;}
  else if(v.period==='today'||v.period==='yesterday'){start=shift(today,v.period==='today'?0:-1);end=shift(start,1);}
  else if(v.period==='this_week'||v.period==='last_week'){
    const weekday=new Date(today+'T00:00:00Z').getUTCDay();
    start=shift(today,-((weekday+6)%7)+(v.period==='last_week'?-7:0));end=shift(start,7);
  }else{
    const month=new Date(today.slice(0,7)+'-01T00:00:00Z');if(v.period==='last_month')month.setUTCMonth(month.getUTCMonth()-1);
    start=month.toISOString().slice(0,10);month.setUTCMonth(month.getUTCMonth()+1);end=month.toISOString().slice(0,10);
  }
  const days=(Date.parse(end)-Date.parse(start))/86400000;
  if(days<=0||days>93)throw new AppError('invalid_input','Completion windows must span 1–93 local calendar days, with an exclusive end date.');
  return {start:dayWindow(start,v.timezone).start,end:dayWindow(end,v.timezone).start,timezone:v.timezone,start_date:start,end_date:end};
}
const normalized=(value:unknown)=>typeof value==='string'?value.trim().toLowerCase():'';
const completedLabels=new Set(['complete','complete (with csat)']);
const otherTerminalLabels=new Set(['canceled','cancelled','duplicate']);

/** Historical completion activity. Candidate filters deliberately omit current completer/status.
 * Reopening clears native completion fields; all tickets active since the window start must be inspected.
 */
export class CompletionWorkflows {
  constructor(private readonly workflows:TechnicianWorkflows,private readonly cipher:IntentCipher,private readonly now:()=>number=Date.now){}
  async search(inputPrincipal:Principal,input:unknown){
    const args=completionSearchSchema.parse(input),core=this.workflows.core,domain=this.workflows.domain;
    const current=async()=>{const p=await reauthorize(inputPrincipal,core.principals);assertCapability(p,'operational.read');assertArea(p,'tickets');return p;};
    let p=await current();
    const {cursor,...query}=args;
    const binding='completion-history:v1:'+createHash('sha256').update(JSON.stringify([actorKey(p),p.resourceId,p.mappingVersion,p.policyVersion,[...p.companyIds].sort(),[...p.capabilities].sort(),[...(p.areaPermissions??[])].sort(),query])).digest('hex');
    let saved:z.infer<typeof cursorSchema>|undefined;
    if(cursor){try{saved=cursorSchema.parse(this.cipher.open(cursor,binding));if(saved.expires<=this.now())throw Error();}catch{throw new AppError('invalid_input','Completion continuation is expired or belongs to a different employee, permissions or query.');}}
    const window=saved?.window??completionWindow(args.window,new Date(this.now()));
    const catalog=await domain.port.catalog(p,'status',{});assertReferenceCatalog(catalog,p,'status',domain.port.source);
    if(!catalog.complete)throw new AppError('missing_metadata','Complete ticket status metadata is required to classify completion history.');
    const known=new Set(catalog.items.map(s=>normalized(s.label)));
    if(!known.has('complete'))throw new AppError('missing_metadata','The reviewed Complete status is unavailable.');
    const resource=async(ref:z.infer<typeof businessReferenceSchema>|undefined)=>!ref?undefined:ref.kind==='self'||(ref.kind==='id'&&ref.id===p.resourceId)?p.resourceId:(await domain.resolveReference(p,{kind:'resource',reference:ref})).id;
    const completer=await resource(args.completed_by),assignee=await resource(args.technician);
    let companies=p.companyIds;
    if(args.company){
      const reference=args.company.kind==='name'?{...args.company,name:canonicalCompanyName(args.company.name)}:args.company;
      if(reference.kind==='self')throw new AppError('invalid_input','Choose a company name or ID.');
      const id=(await domain.resolveReference(p,{kind:'company',reference})).id;assertCompanyScope(p,id);companies=[id];
    }
    const selectedTicket=args.ticket?await domain.resolveTicket(p,args.ticket):undefined;
    const resolution=createHash('sha256').update(JSON.stringify({completer,assignee,companies,ticket:selectedTicket?.id,statuses:catalog.items.map(s=>[s.id,s.label]).sort((a,b)=>Number(a[0])-Number(b[0]))})).digest('hex');
    if(saved&&saved.resolution!==resolution)throw new AppError('conflict','Completion search references or status definitions changed; restart the search.');
    const request:QueryRequest={entity:'Tickets',pageSize:args.page_size,cursor:saved?.next,filters:[
      {field:'companyID',op:'in',value:companies},{field:'lastActivityDate',op:'gte',value:window.start},{field:'createDate',op:'lt',value:window.end},
      ...(selectedTicket?[{field:'id',op:'eq' as const,value:selectedTicket.id}]:[]),
      ...(assignee===undefined?[]:[{field:'assignedResourceID',op:'eq' as const,value:assignee}]),
    ]};
    validateQuery(request,p);
    const page=await core.adapter.query(p,request);
    const results:{ticket:DataRecord;current_state:string;completion_events:{history_id:number;completed_at:string;completed_by_resource_id:number;from_status:string;to_status:string}[];history_complete:boolean}[]=[];
    let incomplete=0;
    const inspect=async(candidate:DataRecord)=>{
      const p=await current();assertCompanyScope(p,candidate.companyID);
      const {history,ticket}=await domain.completionHistory(p,candidate,{start:window.start,end:window.end});
      // The domain returns the authorized parent read again after history retrieval.
      if(ticket.companyID!==candidate.companyID||!companies.includes(ticket.companyID as number))throw new AppError('conflict','A ticket changed company during the completion search; restart the search.');
      if(assignee!==undefined&&ticket.assignedResourceID!==assignee)throw new AppError('conflict','Ticket assignment changed during the completion search; restart the search.');
      const status=catalog.items.find(s=>s.id===ticket.status),label=normalized(status?.label);
      let complete=history.complete_within_scope;
      if(!status)complete=false;
      const state=completedLabels.has(label)?'completed':otherTerminalLabels.has(label)?'other_terminal':status?'reopened':'unknown';
      const events:typeof results[number]['completion_events']=[],seen=new Set<string>();
      for(const row of history.items){
        const stamp=Date.parse(String(row.date));
        if(!Number.isFinite(stamp)){complete=false;continue;}
        if(stamp<Date.parse(window.start)||stamp>=Date.parse(window.end))continue;
        if(row.action!=='Status Changed')continue;
        const from=normalized(row.from_status),to=normalized(row.to_status);
        if(row.status_transition_valid!==true||!known.has(from)||!known.has(to)){complete=false;continue;}
        // Complete -> Complete (With CSAT) is not a second completion.
        if(!completedLabels.has(to)||completedLabels.has(from))continue;
        if(!positiveId(row.resourceID)){complete=false;continue;}
        if(completer!==undefined&&row.resourceID!==completer)continue;
        const key=JSON.stringify([row.id,stamp,row.resourceID,from,to]);if(seen.has(key))continue;seen.add(key);
        events.push({history_id:row.id,completed_at:new Date(stamp).toISOString(),completed_by_resource_id:row.resourceID as number,from_status:String(row.from_status),to_status:String(row.to_status)});
      }
      return {incomplete:!complete,match:events.length&&(args.current_state==='any'||args.current_state===state)?{ticket:projectRecord('Tickets',ticket,p),current_state:state,completion_events:events.sort((a,b)=>a.completed_at.localeCompare(b.completed_at)),history_complete:complete}:null};
    };
    // Two reads at a time respect the shared per-employee transport admission limit.
    for(let offset=0;offset<page.items.length;offset+=2){
      const batch=await Promise.allSettled(page.items.slice(offset,offset+2).map(inspect));
      const error=batch.find(r=>r.status==='rejected');if(error?.status==='rejected')throw error.reason;
      for(const result of batch)if(result.status==='fulfilled'){if(result.value.incomplete)incomplete++;if(result.value.match)results.push(result.value.match);}
    }
    const totals={scanned:(saved?.scanned??0)+page.items.length,tickets:(saved?.tickets??0)+results.length,events:(saved?.events??0)+results.reduce((sum,r)=>sum+r.completion_events.length,0),incomplete:(saved?.incomplete??0)+incomplete};
    const next=page.nextCursor?this.cipher.seal({next:page.nextCursor,window,expires:this.now()+900000,...totals,resolution},binding):null;
    const complete=!next&&totals.incomplete===0;
    p=await current();for(const row of results)assertCompanyScope(p,row.ticket.companyID);
    return {status:complete?'succeeded':'partial',data:{items:results,window,week_starts_on:'Monday',attribution:'native_ticket_history_resource',
      counts:{returned_tickets:results.length,returned_completion_events:results.reduce((sum,r)=>sum+r.completion_events.length,0),scanned_tickets:totals.scanned,matched_tickets_so_far:totals.tickets,completion_events_so_far:totals.events,incomplete_histories:totals.incomplete,total_tickets:complete?totals.tickets:null,total_completion_events:complete?totals.events:null},
      filters:{completed_by_resource_id:completer??null,current_assignee_resource_id:assignee??null,current_state:args.current_state}},
      completeness:{complete,returned:results.length,next_cursor:next},
      warnings:[...(next?['More candidate tickets remain. Continue with identical filters even when this page has no matches.']:[]),...(totals.incomplete?['Some histories are truncated, unavailable or unclassified. Counts are lower bounds; do not claim all tickets even after the candidate scan finishes.']:[]),'Company and assignee filters use current values. Results are live reads, not an atomic historical snapshot. Count each ticket once across pages; completion actions are a separate count.'],
      provenance:{source:core.adapter.source,fetched_at:new Date(this.now()).toISOString(),atomic_snapshot:false}};
  }
}
