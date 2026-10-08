import { classifyHistoryStatus } from './history-status.js';
import {IntentCipher} from '../../storage/src/intent-cipher.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, positiveId, type DataRecord, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, projectRecord, reauthorize } from '../../policy/src/index.js';
import type { FixtureAutotaskAdapter } from '../../workflows/src/fixtures.js';
import { actorBinding, assertReferenceCatalog, assertTechnicianMetadata, collectionRequestSchema, dateWindowSchema, domainFingerprint, domainProjectionFields, evidence, parseDomainInput, projectDomainRecord, referenceContextSchema, referenceKindSchema, revalidatePreparedUpdate, scopeOptions, timeEvidenceWindow, ownWorkRequestSchema } from './index.js';
import type { CollectionRequest, ContactReference, DateWindow, EvidenceCollection, OwnWorkEvidence, OwnWorkRequest, PortCollection, PreparedTicketUpdate, ReferenceCatalog, ReferenceContext, ReferenceKind, ReferenceOption, ResolvedContact, TechnicianMetadata, TechnicianPort } from './contracts.js';

export interface FixtureTechnicianRecords {
  history: DataRecord[]; checklist: DataRecord[]; assets: DataRecord[]; contacts: DataRecord[]; sites: DataRecord[]; tasks: DataRecord[]; projects: DataRecord[];
}
export interface FixtureTechnicianOptions {
  records?: FixtureTechnicianRecords;
  resolveMetadata?: (p:Principal,ticketId:number) => Promise<TechnicianMetadata>;
  resolveCatalog?: (p:Principal,kind:ReferenceKind,context:ReferenceContext) => Promise<ReferenceCatalog>;
  /** Explicitly model missing upstream collections without pretending they are empty. */
  unavailableCollections?: PortCollection[];
  now?:()=>number;
}
const unavailable = () => new AppError('not_found_or_inaccessible','The record was not found or is inaccessible.');

export function fixtureTechnicianMetadata(p:Principal,ticket:DataRecord):TechnicianMetadata {
  const companyIds=[10,20];const option=(id:number,label:string,extras:Partial<ReferenceOption>={}):ReferenceOption=>({id,label,active:true,companyIds,...extras});
  return {...actorBinding(p),source:'fixture',version:'fixture-technician-v1',validUntil:new Date(Date.now()+3600000).toISOString(),ticketId:ticket.id,companyId:ticket.companyID as number,
    options:{resource:[option(101,'Example Technician',{companyIds:[10],queueIds:[501],categoryIds:[601]}),option(103,'Example Colleague',{companyIds:[10],queueIds:[501,502],categoryIds:[601]}),option(102,'Sample Reader',{companyIds:[20],queueIds:[501],categoryIds:[601]})],
      queue:[option(501,'Service Desk'),option(502,'Escalations',{companyIds:[10]})],
      status:[option(1,'Open',{completed:false}),option(2,'In Progress',{completed:false}),option(5,'Complete',{completed:true})],category:[option(601,'Standard Support')],priority:[option(701,'Normal'),option(702,'High')]},
    assignments:[{resourceId:101,queueId:501,roleId:201,categoryIds:[601]},{resourceId:103,queueId:501,roleId:201,categoryIds:[601]},{resourceId:103,queueId:502,roleId:201,categoryIds:[601]},{resourceId:102,queueId:501,roleId:201,categoryIds:[601]}],
    categoryRules:[{categoryId:601,queueRequired:'always',completionRequiredFields:['resolution'],requiredCollections:['checklist'],requireImportantChecklistComplete:true}],
    statusTransitions:[{fromId:1,toId:2,categoryId:601},{fromId:1,toId:5,categoryId:601},{fromId:2,toId:5,categoryId:601},{fromId:5,toId:2,categoryId:601}],
  };
}
export function fixtureTechnicianRecords():FixtureTechnicianRecords {
  return {history:[{id:6101,ticketID:1001,action:'Ticket created',date:'2026-09-10T13:00:00Z',resourceID:101,detail:'Fixture operational history.'},{id:6102,ticketID:2001,action:'Ticket created',date:'2026-09-10T13:00:00Z',resourceID:102}],
    checklist:[{id:6201,ticketID:1001,itemName:'Confirm service restored',isImportant:true,isCompleted:true,position:1},{id:6202,ticketID:2001,itemName:'Confirm docking station',isImportant:false,isCompleted:false,position:1}],
    assets:[{id:6301,companyID:10,referenceTitle:'Example printer',referenceNumber:'DEMO-PRINTER',serialNumber:'FICTITIOUS-001',isActive:true},{id:6302,companyID:20,referenceTitle:'Sample dock',isActive:true}],
    contacts:[{id:6401,companyID:10,firstName:'Example',lastName:'Contact',isActive:true,emailAddress:'contact@example.invalid'},{id:6402,companyID:20,firstName:'Sample',lastName:'Contact',isActive:true}],
    sites:[{id:6501,companyID:10,name:'Example headquarters',isActive:true,address1:'100 Example Street',city:'Example City'},{id:6502,companyID:20,name:'Sample studio',isActive:true}],
    projects:[{id:6601,companyID:10,name:'Example maintenance'},{id:6602,companyID:20,name:'Sample project'}],
    tasks:[{id:6701,projectID:6601,assignedResourceID:101,title:'Example maintenance task',status:1,startDateTime:'2026-09-10T14:00:00Z',endDateTime:'2026-09-10T16:00:00Z'},{id:6702,projectID:6602,assignedResourceID:102,title:'Sample task',status:1,startDateTime:'2026-09-10T14:00:00Z',endDateTime:'2026-09-10T16:00:00Z'}]};
}

/** Fictitious only. Ticket changes are shared with core note/time and scheduling adapters. */
export class FixtureTechnicianPort implements TechnicianPort {
  private readonly workdayCipher=new IntentCipher(randomBytes(32));
  readonly source='fixture' as const;
  readonly records:FixtureTechnicianRecords;
  readonly calls:{kind:string;resourceId:number;ticketId?:number;collection?:string}[]=[];
  private readonly secret=randomBytes(32);
  constructor(readonly base:FixtureAutotaskAdapter,readonly principals:PrincipalStore,readonly options:FixtureTechnicianOptions={}) {
    if(base.source!=='fixture')throw new AppError('invalid_input','The technician fixture requires fictitious data.');
    this.records=structuredClone(options.records??fixtureTechnicianRecords());
    for(const ticket of base.records.Tickets) {
      // These are explicitly fictitious data additions, never live tenant defaults.
      for(const [field,value] of Object.entries({ticketCategory:601,queueID:501,priority:701,assignedResourceRoleID:201,resolution:null})) if(!Object.hasOwn(ticket,field))ticket[field]=value;
      if(ticket.id===1001){ticket.configurationItemID??=6301;ticket.contactID??=6401;ticket.companylocationID??=6501;}
      if(ticket.id===2001){ticket.configurationItemID??=6302;ticket.contactID??=6402;ticket.companylocationID??=6502;}
    }
  }
  private now(){return this.options.now?.()??Date.now();}
  private async actor(p:Principal,write=false){const fresh=await reauthorize(p,this.principals);assertCapability(fresh,'operational.read');if(write)assertCapability(fresh,'tickets.write');return fresh;}
  async getTicket(p:Principal,ticketId:number):Promise<DataRecord>{p=await this.actor(p);if(!positiveId(ticketId))throw new AppError('invalid_input','Invalid ticket identifier.');const row=await this.base.get(p,'Tickets',ticketId);assertCompanyScope(p,row.companyID);return row;}
  async findTicket(p:Principal,ticketNumber:string):Promise<DataRecord>{p=await this.actor(p);if(typeof ticketNumber!=='string'||!ticketNumber.trim()||ticketNumber.length>100)throw new AppError('invalid_input','Invalid ticket number.');const rows=this.base.records.Tickets.filter(t=>p.companyIds.includes(t.companyID as number)&&t.ticketNumber===ticketNumber);if(rows.length!==1)throw unavailable();return this.getTicket(p,rows[0]!.id);}
  async metadata(p:Principal,ticketId:number):Promise<TechnicianMetadata>{p=await this.actor(p);const ticket=await this.getTicket(p,ticketId);const m=this.options.resolveMetadata?await this.options.resolveMetadata(p,ticketId):fixtureTechnicianMetadata(p,ticket);assertTechnicianMetadata(m,p,ticket,this.source,this.now());return structuredClone(m);}
  async catalog(p:Principal,kind:ReferenceKind,context:ReferenceContext={}):Promise<ReferenceCatalog>{
    p=await this.actor(p);kind=parseDomainInput(referenceKindSchema,kind);context=parseDomainInput(referenceContextSchema,context);
    if(context.ticketId!==undefined){const ticket=await this.getTicket(p,context.ticketId);if(context.companyId!==undefined&&context.companyId!==ticket.companyID)throw unavailable();context={...context,companyId:ticket.companyID as number};}
    if(context.companyId!==undefined)assertCompanyScope(p,context.companyId);
    let catalog:ReferenceCatalog;
    if(this.options.resolveCatalog)catalog=await this.options.resolveCatalog(p,kind,context);
    else{
      const ticket=context.ticketId?await this.getTicket(p,context.ticketId):this.base.records.Tickets.find(t=>p.companyIds.includes(t.companyID as number));if(!ticket)throw unavailable();
      const m=await this.metadata(p,ticket.id);
      const items=kind==='company'?this.base.records.Companies.map(c=>({id:c.id,label:String(c.companyName),active:c.isActive!==false,companyIds:[c.id]})):m.options[kind];
      catalog={...actorBinding(p),source:this.source,version:m.version,validUntil:m.validUntil,kind,complete:true,items};
    }
    assertReferenceCatalog(catalog,p,kind,this.source,this.now());return{...structuredClone(catalog),items:structuredClone(scopeOptions(catalog.items,p,context))};
  }
  async resolveContact(p:Principal,companyId:number,reference:ContactReference):Promise<ResolvedContact>{
    p=await this.actor(p);assertCompanyScope(p,companyId);
    const company=this.base.records.Companies.find(row=>row.id===companyId);if(!company)throw unavailable();
    const allowed=[companyId,...(positiveId(company.parentCompanyID)&&company.parentCompanyID!==companyId&&p.companyIds.includes(company.parentCompanyID as number)?[company.parentCompanyID as number]:[])];
    const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
    const rows=this.records.contacts.filter(row=>allowed.includes(row.companyID as number));
    const matches=rows.filter(row=>reference.kind==='id'?row.id===reference.id:reference.kind==='email'?typeof row.emailAddress==='string'&&normalize(row.emailAddress)===normalize(reference.email):normalize(`${row.firstName??''} ${row.lastName??''}`)===normalize(reference.name));
    if(matches.length===0)throw unavailable();if(matches.length>1)throw new AppError('invalid_input','The contact reference is ambiguous; provide an exact contact ID or email.');
    const row=matches[0]!;if(row.isActive!==true)throw new AppError('invalid_input','The contact is inactive.');const label=`${row.firstName??''} ${row.lastName??''}`.trim();if(!positiveId(row.id)||!label)throw new AppError('dependency_unavailable','The contact record is invalid.');
    return{id:row.id,label,companyId:row.companyID as number,email:typeof row.emailAddress==='string'?row.emailAddress:undefined,active:true,match:reference.kind};
  }
  private page(p:Principal,ticketId:number,name:PortCollection,rows:DataRecord[],request:CollectionRequest):EvidenceCollection {
    const limit=request.limit??100;const binding=domainFingerprint({actor:actorBinding(p),scope:p.companyIds,ticketId,name,window:request.window??null,limit});let offset=0;
    if(request.cursor){try{const [body,sig,...extra]=request.cursor.split('.');if(!body||!sig||extra.length)throw new Error();const a=Buffer.from(sig,'base64url'),b=createHmac('sha256',this.secret).update(body).digest();if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error();const v=JSON.parse(Buffer.from(body,'base64url').toString());if(v.binding!==binding||!Number.isSafeInteger(v.offset)||v.offset<0||v.expires<=this.now())throw new Error();offset=v.offset;}catch{throw new AppError('invalid_input','The continuation is invalid, expired, or belongs to another scoped request.');}}
    const items=rows.slice(offset,offset+limit);let continuation:string|null=null;
    if(offset+items.length<rows.length){const body=Buffer.from(JSON.stringify({binding,offset:offset+items.length,expires:this.now()+900000})).toString('base64url');continuation=`${body}.${createHmac('sha256',this.secret).update(body).digest('base64url')}`;}
    const complete=offset===0&&continuation===null;
    return evidence(structuredClone(items),`ticket:${ticketId}:${name}`,request.window??null,{status:complete?'complete':'partial',complete_within_scope:complete,continuation,fetched_at:new Date(this.now()).toISOString()});
  }
  async collection(p:Principal,ticketId:number,name:PortCollection,request:CollectionRequest={}):Promise<EvidenceCollection>{
    p=await this.actor(p);if(!Object.hasOwn(domainProjectionFields,name))throw new AppError('invalid_input','Unknown collection.');request=parseDomainInput(collectionRequestSchema,request);const ticket=await this.getTicket(p,ticketId);
    if(request.window&&name!=='history')throw new AppError('invalid_input','Only history supports a date window.');
    this.calls.push({kind:'collection',resourceId:p.resourceId,ticketId,collection:name});
    if(this.options.unavailableCollections?.includes(name))return evidence([],`ticket:${ticketId}:${name}`,request.window??null,{status:'unavailable',complete_within_scope:false,warnings:['The collection is unavailable.']});
    let rows:DataRecord[];
    if(name==='history'||name==='checklist')rows=this.records[name].filter(r=>r.ticketID===ticketId);
    else{const source=name==='assets'?this.records.assets:name==='contact'?this.records.contacts:this.records.sites;const linked=name==='assets'?ticket.configurationItemID:name==='contact'?ticket.contactID:ticket.companylocationID;const company=this.base.records.Companies.find(row=>row.id===ticket.companyID);const allowed=[ticket.companyID,...(name==='contact'&&positiveId(company?.parentCompanyID)&&company?.parentCompanyID!==ticket.companyID&&p.companyIds.includes(company.parentCompanyID as number)?[company.parentCompanyID as number]:[])];rows=source.filter(r=>r.id===linked&&allowed.includes(r.companyID as number));if(linked!==null&&linked!==undefined&&rows.length!==1)return evidence([],`ticket:${ticketId}:${name}`,null,{status:'unavailable',complete_within_scope:false,warnings:['The linked record could not be verified.']});}
    if(name==='history')rows=rows.filter(r=>r.protectedChange!==true).map(classifyHistoryStatus).filter(r=>!request.window||(!Number.isFinite(Date.parse(String(r.date)))||(Date.parse(String(r.date))>=Date.parse(request.window.start)&&Date.parse(String(r.date))<Date.parse(request.window.end))));
    rows=rows.sort((a,b)=>a.id-b.id).map(r=>projectDomainRecord(r,domainProjectionFields[name]));return this.page(p,ticketId,name,rows,request);
  }
  async getTask(p:Principal,taskId:number):Promise<{task:DataRecord;companyId:number}>{p=await this.actor(p);if(!positiveId(taskId))throw new AppError('invalid_input','Invalid task identifier.');const task=this.records.tasks.find(t=>t.id===taskId);const project=this.records.projects.find(r=>r.id===task?.projectID);if(!task||!project)throw unavailable();assertCompanyScope(p,project.companyID);return{task:structuredClone(task),companyId:project.companyID as number};}
  async ownWork(p:Principal,window:DateWindow,workDate?:string,request:OwnWorkRequest={}):Promise<OwnWorkEvidence>{
    const paging=parseDomainInput(ownWorkRequestSchema,request);
    p=await this.actor(p);window=parseDomainInput(dateWindowSchema,window);
    const timeWindow=timeEvidenceWindow(window,workDate);const inWindow=(value:unknown)=>typeof value==='string'&&Date.parse(value)>=Date.parse(timeWindow.start)&&Date.parse(value)<Date.parse(timeWindow.end);
    const assigned=this.base.records.Tickets.filter(t=>t.assignedResourceID===p.resourceId&&p.companyIds.includes(t.companyID as number));const tickets:DataRecord[]=[];
    for(const ticket of assigned){const m=await this.metadata(p,ticket.id);const state=m.options.status.find(o=>o.id===ticket.status);if(!state)throw new AppError('missing_metadata','The ticket status meaning is unavailable.');if(!state.completed)tickets.push(projectRecord('Tickets',ticket,p));}
    const tasks=this.records.tasks.filter(t=>t.assignedResourceID===p.resourceId).filter(t=>{const project=this.records.projects.find(r=>r.id===t.projectID);return project&&p.companyIds.includes(project.companyID as number);}).filter(t=>typeof t.startDateTime==='string'&&typeof t.endDateTime==='string'&&Date.parse(t.startDateTime)<Date.parse(window.end)&&Date.parse(t.endDateTime)>=Date.parse(window.start)).map(t=>projectDomainRecord(t,['id','projectID','assignedResourceID','assignedResourceRoleID','title','status','startDateTime','endDateTime']));
    const time=this.base.records.TimeEntries.filter(t=>t.resourceID===p.resourceId&&inWindow(t.dateWorked)).filter(t=>{if(positiveId(t.ticketID)){const ticket=this.base.records.Tickets.find(r=>r.id===t.ticketID);return ticket&&p.companyIds.includes(ticket.companyID as number);}if(positiveId(t.taskID)){const task=this.records.tasks.find(r=>r.id===t.taskID);const project=this.records.projects.find(r=>r.id===task?.projectID);return project&&p.companyIds.includes(project.companyID as number);}return (t.ticketID===null||t.ticketID===undefined)&&(t.taskID===null||t.taskID===undefined);}).map(t=>projectRecord('TimeEntries',t,p));
    const capped=(key:'assigned_tickets'|'tasks'|'time',items:DataRecord[],scope:string,win:DateWindow|null)=>{
      const binding='fixture-workday:'+domainFingerprint({actor:actorBinding(p),companyIds:p.companyIds,capabilities:p.capabilities,window,workDate,key});let offset=0;
      const cursor=paging.cursors?.[key];if(cursor){let value:any;try{value=this.workdayCipher.open(cursor,binding);}catch{throw new AppError('invalid_input','Invalid workday cursor.');}if(!Number.isSafeInteger(value.offset)||value.offset<0||value.expires<=this.now())throw new AppError('invalid_input','Expired workday cursor.');offset=value.offset;}
      const sorted=[...items].sort((a,b)=>a.id-b.id),batch=sorted.slice(offset,offset+paging.max_pages*100),end=offset+batch.length,complete=end>=sorted.length;
      return evidence(batch,scope,win,{status:complete?'complete':'partial',complete_within_scope:complete,continuation:complete?null:this.workdayCipher.seal({offset:end,expires:this.now()+300_000},binding),warnings:complete?[]:['Follow the continuation for the rest of this collection.']});
    };
    return {assigned_tickets:capped('assigned_tickets',tickets,`resource:${p.resourceId}:currently-assigned-open-tickets`,null),tasks:capped('tasks',tasks,`resource:${p.resourceId}:assigned-tasks-overlapping-window`,window),time:capped('time',time,`resource:${p.resourceId}:recorded-time-in-window`,timeWindow)};
  }

  async patchTicket(p:Principal,plan:PreparedTicketUpdate):Promise<void>{p=await this.actor(p,true);const fresh=await revalidatePreparedUpdate(this,this.principals,p,plan);p=await this.actor(p,true);const actual=this.base.records.Tickets.find(t=>t.id===fresh.ticketId);if(!actual)throw unavailable();assertCompanyScope(p,actual.companyID);this.calls.push({kind:'patch',resourceId:p.resourceId,ticketId:fresh.ticketId});Object.assign(actual,structuredClone(fresh.changes));}
}
