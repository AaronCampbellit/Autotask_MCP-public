import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError, actorKey, type DataRecord, type Principal, type QueryRequest} from '../../contracts/src/index.js';
import {assertArea} from '../../policy/src/areas.js';
import {assertCapability, assertCompanyScope, projectRecord, reauthorize, validateQuery} from '../../policy/src/index.js';
import {IntentCipher} from '../../storage/src/index.js';
import {businessReferenceSchema, companyReferenceSchema, dateWindowSchema, assertReferenceCatalog} from '../../technician/src/index.js';
import {canonicalCompanyName} from './company-aliases.js';
import type {TechnicianWorkflows} from './technician-workflows.js';

export const statusTransitionSearchSchema=z.object({
  created_window:dateWindowSchema.describe('Ticket creation window, inclusive start and exclusive end; use explicit UTC offsets.'),
  transition_window:dateWindowSchema.describe('Status transition window, inclusive start and exclusive end; use explicit UTC offsets.'),
  to_status:businessReferenceSchema.describe('The status entered during transition_window, such as Canceled.'),
  company:companyReferenceSchema.optional(),
  currently_in_status:z.boolean().default(false).describe('If true, include only tickets that still have to_status. Omit to include reopened tickets.'),
  page_size:z.number().int().min(1).max(25).default(10).describe('Candidate tickets whose history is checked per call.'),
  cursor:z.string().max(16000).optional(),
}).strict();
const savedSchema=z.object({next:z.string(),expires:z.number(),scanned:z.number().int().nonnegative(),matched:z.number().int().nonnegative(),events:z.number().int().nonnegative(),incomplete:z.number().int().nonnegative(),resolution:z.string()}).strict();
const label=(value:unknown)=>typeof value==='string'?value.trim().toLocaleLowerCase('en-US'):'';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Native modification time only narrows candidates. TicketHistory proves the transition. */
export class StatusTransitionWorkflows {
  constructor(private readonly workflows:TechnicianWorkflows,private readonly cipher:IntentCipher,private readonly now:()=>number=Date.now){}
  async search(inputPrincipal:Principal,input:unknown){
    const args=statusTransitionSearchSchema.parse(input),core=this.workflows.core,domain=this.workflows.domain;
    const current=async()=>{const p=await reauthorize(inputPrincipal,core.principals);assertCapability(p,'operational.read');assertArea(p,'tickets');return p;};
    let p=await current();
    const {cursor,...query}=args;
    const binding='status-transition:v1:'+digest([actorKey(p),p.resourceId,p.mappingVersion,p.policyVersion,[...p.companyIds].sort((a,b)=>a-b),[...p.capabilities].sort(),[...(p.areaPermissions??[])].sort(),query]);
    let saved:z.infer<typeof savedSchema>|undefined;
    if(cursor){try{saved=savedSchema.parse(this.cipher.open(cursor,binding));if(saved.expires<=this.now())throw Error();}catch{throw new AppError('invalid_input','Status-transition continuation is expired or belongs to a different employee, permissions or query.');}}
    const catalog=await domain.port.catalog(p,'status',{});assertReferenceCatalog(catalog,p,'status',domain.port.source);
    if(!catalog.complete)throw new AppError('missing_metadata','Complete ticket status metadata is required to classify status history.');
    if(args.to_status.kind==='self')throw new AppError('invalid_input','Choose a ticket status by name or ID.');
    const requestedStatus=args.to_status;
    const statuses=catalog.items.filter(s=>requestedStatus.kind==='id'?s.id===requestedStatus.id:requestedStatus.kind==='name'&&label(s.label)===label(requestedStatus.name));
    if(statuses.length!==1)throw new AppError('missing_metadata','Choose an exact, unique ticket status available in current metadata.');
    const target=statuses[0]!;
    let companies=p.companyIds;
    if(args.company){
      const reference=args.company.kind==='name'?{...args.company,name:canonicalCompanyName(args.company.name)}:args.company;
      if(reference.kind==='self')throw new AppError('invalid_input','Choose a company name or ID.');
      const id=(await domain.resolveReference(p,{kind:'company',reference})).id;assertCompanyScope(p,id);companies=[id];
    }
    const resolution=digest({target:target.id,companies,statuses:catalog.items.map(s=>[s.id,s.label]).sort((a,b)=>Number(a[0])-Number(b[0]))});
    if(saved&&saved.resolution!==resolution)throw new AppError('conflict','Status definitions or company reference changed; restart the search.');
    const start=new Date(args.created_window.start).toISOString(),end=new Date(args.created_window.end).toISOString();
    const transitionStart=new Date(args.transition_window.start).toISOString(),transitionEnd=new Date(args.transition_window.end).toISOString();
    const request:QueryRequest={entity:'Tickets',pageSize:args.page_size,cursor:saved?.next,filters:[
      {field:'companyID',op:'in',value:companies},
      {field:'createDate',op:'gte',value:start},{field:'createDate',op:'lt',value:end},
      {field:'lastTrackedModificationDateTime',op:'gte',value:transitionStart},
      ...(args.currently_in_status?[{field:'status',op:'eq' as const,value:target.id}]:[]),
    ]};
    validateQuery(request,p);
    const page=await core.adapter.query(p,request);
    const known=new Set(catalog.items.map(s=>label(s.label)));
    const items:{ticket:DataRecord;current_status:string;transition_events:{history_id:number;changed_at:string;from_status:string;to_status:string}[];history_complete:boolean}[]=[];
    let incomplete=0;
    const inspect=async(candidate:DataRecord)=>{
      const actor=await current();assertCompanyScope(actor,candidate.companyID);
      const created=Date.parse(String(candidate.createDate)),modified=Date.parse(String(candidate.lastTrackedModificationDateTime));
      if(!Number.isFinite(created)||created<Date.parse(start)||created>=Date.parse(end)||!Number.isFinite(modified)||modified<Date.parse(transitionStart))throw new AppError('dependency_unavailable','Ticket candidate did not match the native date filters.');
      const {history,ticket}=await domain.completionHistory(actor,candidate,{start:transitionStart,end:transitionEnd},500);
      if(ticket.companyID!==candidate.companyID||!companies.includes(ticket.companyID as number))throw new AppError('conflict','A ticket changed company during the status search; restart the search.');
      const currentStatus=catalog.items.find(s=>s.id===ticket.status);
      let complete=history.complete_within_scope&&Boolean(currentStatus);
      const events:typeof items[number]['transition_events']=[],seen=new Set<number>();
      for(const row of history.items){
        if(row.action!=='Status Changed')continue;
        const stamp=Date.parse(String(row.date));
        if(!Number.isFinite(stamp)){complete=false;continue;}
        if(stamp<Date.parse(transitionStart)||stamp>=Date.parse(transitionEnd))continue;
        const from=label(row.from_status),to=label(row.to_status);
        if(row.status_transition_valid!==true||!known.has(from)||!known.has(to)){complete=false;continue;}
        if(to!==label(target.label)||from===to||seen.has(row.id as number))continue;
        seen.add(row.id as number);
        events.push({history_id:row.id as number,changed_at:new Date(stamp).toISOString(),from_status:String(row.from_status),to_status:String(row.to_status)});
      }
      const match=events.length>0&&(!args.currently_in_status||ticket.status===target.id);
      return{incomplete:!complete,match:match?{ticket:projectRecord('Tickets',ticket,actor),current_status:currentStatus?.label??'Unknown',transition_events:events.sort((a,b)=>a.changed_at.localeCompare(b.changed_at)),history_complete:complete}:null};
    };
    for(let offset=0;offset<page.items.length;offset+=2){
      const batch=await Promise.allSettled(page.items.slice(offset,offset+2).map(inspect));
      const error=batch.find(r=>r.status==='rejected');if(error?.status==='rejected')throw error.reason;
      for(const result of batch)if(result.status==='fulfilled'){if(result.value.incomplete)incomplete++;if(result.value.match)items.push(result.value.match);}
    }
    const totals={scanned:(saved?.scanned??0)+page.items.length,matched:(saved?.matched??0)+items.length,events:(saved?.events??0)+items.reduce((sum,item)=>sum+item.transition_events.length,0),incomplete:(saved?.incomplete??0)+incomplete};
    const next=page.nextCursor?this.cipher.seal({next:page.nextCursor,expires:this.now()+900000,...totals,resolution},binding):null;
    const complete=!next&&totals.incomplete===0;
    p=await current();for(const item of items)assertCompanyScope(p,item.ticket.companyID);
    return{status:complete?'succeeded':'partial',data:{items,created_window:{start,end},transition_window:{start:transitionStart,end:transitionEnd},target_status:target.label,
      counts:{returned_tickets:items.length,scanned_candidates:totals.scanned,matched_tickets_so_far:totals.matched,transition_events_so_far:totals.events,incomplete_histories:totals.incomplete,total_tickets:complete?totals.matched:null,total_transition_events:complete?totals.events:null},
      filters:{company_id:companies.length===1?companies[0]:null,currently_in_status:args.currently_in_status}},
      completeness:{complete,returned:items.length,next_cursor:next},
      warnings:[...(next?['More candidate tickets remain. Continue with identical arguments even if this page has no matches.']:[]),...(totals.incomplete?['Some ticket histories are incomplete or unclassified. Counts are lower bounds, not exact totals.']:[]),'Last tracked modification time is only a candidate filter; each reported transition is verified in ticket history. Results are live reads, not an atomic historical snapshot.'],
      provenance:{source:core.adapter.source,fetched_at:new Date(this.now()).toISOString(),atomic_snapshot:false}};
  }
}
