import {ContactLookup} from '../packages/operational/src/contacts.js';
import {outputSchemaFor} from '../apps/server/src/output-contracts.js';
import {TicketCreation} from '../packages/operational/src/ticket-create.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationalMetadata } from '../packages/operational/src/metadata.js';
import { HttpAutotaskAdapter, APPLICATION_READ_OPERATIONS } from '../packages/autotask/src/index.js';
import { HttpTechnicianTransport } from '../packages/autotask/src/technician-transport.js';
import { HttpTechnicianPort } from '../packages/technician/src/http.js';
import { TechnicianDomain } from '../packages/technician/src/index.js';
import { MemoryPrincipalStore, MemoryJournal, IntentCipher } from '../packages/storage/src/index.js';
import { FixtureUnlimitedRequestBudget } from '../packages/autotask/src/budget.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';
import { TechnicianWorkflows } from '../packages/workflows/src/technician-workflows.js';
import { SchedulingWorkflows } from '../packages/scheduling/src/index.js';
import { HttpSchedulingPort } from '../packages/scheduling/src/http.js';
import { reauthorize } from '../packages/policy/src/index.js';
import type { Principal } from '../packages/contracts/src/index.js';
const pick=(name:string,values:[number,string][])=>({name,isPickList:true,picklistValues:values.map(([value,label])=>({value:String(value),label,isActive:true}))});
function setup(){
 const p:Principal={tenantId:'tenant',objectId:'aaron',resourceId:42,mappingVersion:1,policyVersion:'p1',companyIds:[0],capabilities:['operational.read','tickets.write','time.self','scheduling.write'],active:true,resourceVerifiedAt:new Date().toISOString()};
 const store=new MemoryPrincipalStore([p]);const calls:{path:string;method:string;body:any;headers:Headers}[]=[];
 const ticket:any={id:100,companyID:0,title:'Work',description:'Details',status:1,ticketCategory:2,queueID:3,priority:4,assignedResourceID:42,assignedResourceRoleID:5,billingCodeID:6,resolution:null};
 const fields:Record<string,any[]>={Tickets:[pick('status',[[1,'New'],[7,'Complete']]),pick('ticketCategory',[[2,'Standard']]),pick('queueID',[[3,'Support']]),pick('priority',[[4,'Normal']])],TicketNotes:[pick('noteType',[[10,'General']]),pick('publish',[[1,'Internal Only'],[2,'All']])],BillingCodes:[pick('useType',[[8,'Work Type']])],ServiceCalls:[pick('status',[[1,'Scheduled'],[2,'Canceled']])]};
 for(const f of fields.Tickets!)Object.assign(f,{isReadOnly:false,isRequired:['priority','status'].includes(f.name)});for(const name of ['companyID','title','description','dueDateTime','assignedResourceID','assignedResourceRoleID','billingCodeID','opportunityID'])fields.Tickets!.push({name,isReadOnly:false,isRequired:['companyID','title'].includes(name)});
 const rows:Record<string,any[]>={Companies:[{id:0,companyName:'Rarity Solutions',isActive:true}],Opportunities:[{id:300,companyID:0,title:'Office PCs'}],Tickets:[],Resources:[{id:42,firstName:'Aaron',lastName:'Campbell',isActive:true,resourceType:'Employee'},{id:43,firstName:'Other',lastName:'Employee',isActive:true,resourceType:'Employee'}],Roles:[{id:5,name:'Engineer',isActive:true}],ResourceRoleQueues:[{id:1,resourceID:42,queueID:3},{id:2,resourceID:43,queueID:3}],ResourceServiceDeskRoles:[{id:1,resourceID:42,roleID:5,isActive:true,isDefault:true},{id:2,resourceID:43,roleID:5,isActive:true,isDefault:true}],BillingCodes:[{id:6,name:'Support',isActive:true,useType:8}],TicketSecondaryResources:[],TicketChecklistItems:[],ServiceCalls:[],ServiceCallTickets:[],ServiceCallTicketResources:[],TicketNotes:[],TimeEntries:[]};
 let partialEntity='';let failWrite='';let sequence=200;
 const fetcher:typeof fetch=async(url,init)=>{const path=new URL(String(url)).pathname.split('/v1.0/')[1]!;const method=init?.method??'GET';const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({path,method,body,headers:new Headers(init?.headers)});let value:any;
  if(path.endsWith('/entityInformation/fields'))value={fields:fields[path.split('/')[0]!]??[]};
  else if(path==='Tickets/100')value={item:{...ticket}};
  else if(path.endsWith('/query')){const entity=path.split('/')[0]!;const items=(rows[entity]??[]).filter(row=>(body?.filter??[]).every((f:any)=>f.op==='eq'?row[f.field]===f.value:f.op==='in'?f.value.includes(row[f.field]):f.op==='gte'?row[f.field]>=f.value:true));value={items,pageDetails:{nextPageUrl:partialEntity===entity?'https://webservices3.autotask.net/atservicesrest/v1.0/'+path+'?next=1':null}};}
  else if(path==='Tickets'&&method==='PATCH'){Object.assign(ticket,body);value={itemId:100};}
  else if(method==='POST'){
   if(failWrite===path)return new Response('{}',{status:503});
   const entity=path==='Tickets/100/Notes'?'TicketNotes':path==='ServiceCalls/201/Tickets'?'ServiceCallTickets':path.startsWith('ServiceCalls/')&&path.endsWith('/Tickets')?'ServiceCallTickets':path.startsWith('ServiceCallTickets/')?'ServiceCallTicketResources':path;
   const id=++sequence;const row={...body,id,impersonatorCreatorResourceID:42};(rows[entity]??=[]).push(row);value={itemId:id};
  }else{const parts=path.split('/');const entity=parts[0]==='Tickets'&&parts.length===4?'TicketNotes':parts[0]==='ServiceCalls'&&parts.length===4?'ServiceCallTickets':parts[0]==='ServiceCallTickets'&&parts.length===4?'ServiceCallTicketResources':parts[0]!;value={item:rows[entity]?.find(r=>r.id===Number(parts.at(-1)))};}
  return new Response(JSON.stringify(value),{status:200});
 };
 const http={baseUrl:'https://webservices3.autotask.net/atservicesrest/v1.0/',username:'test',secret:'test',integrationCode:'test',fetch:fetcher,requestBudget:new FixtureUnlimitedRequestBudget(),revalidatePrincipal:(p:Principal)=>reauthorize(p,store)};
 const metadata=new OperationalMetadata({...http,tenantId:p.tenantId,principals:store});
 const adapter=new HttpAutotaskAdapter({...http,cursorSecret:'test-cursor-secret-at-least-thirty-two-characters',applicationReads:{tenantId:p.tenantId,operations:APPLICATION_READ_OPERATIONS},applicationWrites:{tenantId:p.tenantId,operations:['Tickets.create','TicketNotes.create','TimeEntries.create','TimeEntries.get','Tickets.patch']},resolveTicketWorkMetadata:metadata.resolveTicketWork,validateTicketTimeEligibility:metadata.validateTicketTimeEligibility});
 const core=new TicketWorkflows(adapter,store,new MemoryJournal());const cipher=new IntentCipher(Buffer.alloc(32,7));const writes=new TicketWriteWorkflows(core,cipher);
 const port=new HttpTechnicianPort(adapter,store,{transport:new HttpTechnicianTransport(http),applicationOperations:{tenantId:p.tenantId,operations:['metadata.resolve','references.resolve','Tickets.patch.expanded','TicketChecklistItems.query']},resolveTicketFields:metadata.resolveTicketFields,resolveWorkType:metadata.resolveWorkType,resolveIssuePair:metadata.resolveIssuePair,validateClassification:metadata.validateClassification,assertOpportunity:metadata.assertOpportunity,resolveContact:metadata.resolveContact,resolveMetadata:metadata.resolveTechnicianMetadata,resolveCatalog:metadata.resolveCatalog});
 const domain=new TechnicianDomain(port,store);
 const scheduling=new SchedulingWorkflows(core,new HttpSchedulingPort(adapter,{...http,applicationOperations:{tenantId:p.tenantId,operations:['Resources.query','ServiceCalls.metadata','ServiceCalls.query','ServiceCalls.get','ServiceCalls.create','ServiceCallTickets.query','ServiceCallTickets.get','ServiceCallTickets.create','ServiceCallTicketResources.query','ServiceCallTicketResources.get','ServiceCallTicketResources.create']},resolveMetadata:metadata.resolveSchedulingMetadata,resolveResources:metadata.resolveResources}),cipher);
 const tech=new TechnicianWorkflows(core,writes,domain,scheduling,cipher);
 const creation=new TicketCreation(core,adapter,metadata,cipher);
 return{p,store,metadata,adapter,writes,tech,domain,scheduling,creation,core,cipher,calls,ticket,rows,fields,partial:(e:string)=>{partialEntity=e;},fail:(path:string)=>{failWrite=path;}};
}
const note={title:'Work',text:'Facts',audience:'internal'};
const time={work_date:'2026-09-14',timezone:'America/Chicago',minutes:30,summary:'Actual work'};
const ticket={kind:'id',id:100};
test('application write provider resolves real queue memberships, defaults and explicit conservative completion policy',async()=>{const s=setup();const m=await s.metadata.resolveTechnicianMetadata(s.p,100);assert.equal(m.assignments.length,2);assert.equal(m.assignments[0]!.roleId,5);assert.equal(m.categoryRules[0]!.requireImportantChecklistComplete,true);const w=await s.metadata.resolveTicketWork(s.p,100);assert.equal(w.time.defaultRoleId,5);assert.equal(w.time.defaultWorkTypeId,6);assert.equal(w.note.audiences[0]!.publish,1);assert.equal(s.calls.some(c=>!c.path.endsWith('/query')&&c.method==='POST'),false);});
test('application note and own time writes verify readback and do not duplicate on repeated keys',async()=>{const s=setup();const a={ticket,note,time,request_key:'document-application-1'};const result=await s.writes.documentWork(s.p,a);assert.equal(result.status,'succeeded_verified');assert.equal((await s.writes.documentWork(s.p,a)).operation_id,result.operation_id);assert.equal(s.rows.TicketNotes!.length,1);assert.equal(s.rows.TimeEntries!.length,1);assert.equal(s.rows.TimeEntries![0].resourceID,42);assert.equal(s.calls.find(c=>c.path==='Tickets/100/Notes'&&c.method==='POST')!.headers.get('ImpersonationResourceId'),'42');assert.equal(s.calls.find(c=>c.path==='Roles/query')!.headers.has('ImpersonationResourceId'),false);});
test('title update preserves expected state, rejects stale changes, and reads back saved fields',async()=>{const s=setup();const r=await s.tech.update(s.p,{ticket,changes:{title:'Changed'},expected:{title:'Work'},request_key:'update-application-1'});assert.equal(r.status,'succeeded_verified');assert.equal(s.ticket.title,'Changed');await assert.rejects(s.tech.update(s.p,{ticket,changes:{title:'Wrong'},expected:{title:'Work'},request_key:'update-application-2'}));});
test('important checklist blocks completion; no PATCH is sent',async()=>{const s=setup();s.rows.TicketChecklistItems!.push({id:1,ticketID:100,itemName:'Check',isImportant:true,isCompleted:false});await assert.rejects(s.domain.prepareUpdate(s.p,{ticket:ticket as any,changes:{status:{kind:'id',id:7},resolution:'Resolved'},expected:{status:1,resolution:null}}));assert.equal(s.calls.some(c=>c.method==='PATCH'),false);});
test('partial metadata and wrong company fail before any mutation',async()=>{const s=setup();s.partial('ResourceServiceDeskRoles');await assert.rejects(s.writes.noteAdd(s.p,{ticket,note,request_key:'partial-metadata-key'}));assert.equal(s.rows.TicketNotes!.length,0);s.ticket.companyID=99;await assert.rejects(s.metadata.resolveTechnicianMetadata(s.p,100));});
test('unknown note result never triggers the time step or repeated create',async()=>{const s=setup();s.fail('Tickets/100/Notes');const a={ticket,note,time,request_key:'unknown-application-key'};const r=await s.writes.documentWork(s.p,a);assert.equal(r.status,'unknown_outcome');await s.writes.documentWork(s.p,a);assert.equal(s.calls.filter(c=>c.path==='Tickets/100/Notes'&&c.method==='POST').length,1);assert.equal(s.rows.TimeEntries!.length,0);});
test('service call verifies all three native records and reuses the request key',async()=>{const s=setup();const input={ticket,resources:[{kind:'self'}],start:'2026-09-15T09:00:00-05:00',end:'2026-09-15T10:00:00-05:00',timezone:'America/Chicago',request_key:'schedule-application-key'};const r=await s.scheduling.create(s.p,input);assert.equal(r.status,'succeeded_verified');assert.equal((await s.scheduling.create(s.p,input)).operation_id,r.operation_id);assert.equal(s.rows.ServiceCalls!.length,1);assert.equal(s.rows.ServiceCallTickets!.length,1);assert.equal(s.rows.ServiceCallTicketResources!.length,1);});

test('handoff saves and verifies the note before changing ownership',async()=>{const s=setup();const result=await s.tech.handoff(s.p,{ticket,target:{kind:'id',id:43,name:'Other Employee'},note,request_key:'handoff-application-key'});assert.equal(result.status,'succeeded_verified');assert.equal(s.ticket.assignedResourceID,43);assert.ok(s.calls.findIndex(c=>c.path==='Tickets/100/Notes'&&c.method==='POST')<s.calls.findIndex(c=>c.method==='PATCH'));});
test('resolution verifies note, optional time and completion in order',async()=>{const s=setup();const result=await s.tech.resolve(s.p,{ticket,completion_status:{kind:'id',id:7},note,time,request_key:'resolve-application-key'});assert.equal(result.status,'succeeded_verified',JSON.stringify(result));assert.equal(s.ticket.status,7);assert.equal(s.ticket.resolution,'Facts');assert.deepEqual(s.calls.filter(c=>c.method==='PATCH'||c.method==='POST'&&!c.path.endsWith('/query')).map(c=>c.path),['Tickets/100/Notes','TimeEntries','Tickets']);});
test('missing write capability and a different tenant do not dispatch mutations',async()=>{const s=setup();s.p.capabilities=['operational.read'];await assert.rejects(s.writes.noteAdd(s.p,{ticket,note,request_key:'denied-application-key'}));await assert.rejects(s.metadata.resolveTicketWork({...s.p,tenantId:'other'},100));assert.equal(s.calls.some(c=>c.method==='PATCH'||c.method==='POST'&&!c.path.endsWith('/query')),false);});

test('observed tenant labels resolve internal notes, Task Notes, work types by useType and New service calls',async()=>{const s=setup();s.fields.TicketNotes=[pick('noteType',[[3,'Task Notes']]),pick('publish',[[1,'All Autotask Users'],[2,'Internal Project Team'],[4,'Internal & Co-Managed']])];s.fields.BillingCodes=[pick('billingCodeType',[[0,'Normal'],[1,'System'],[2,'Non-Billable']]),pick('useType',[[1,'General Allocation Code']])];s.rows.BillingCodes![0].useType=1;s.fields.ServiceCalls=[pick('status',[[1,'New'],[2,'Complete'],[101,'Canceled']])];const m=await s.metadata.resolveTicketWork(s.p,100);assert.equal(m.note.defaultTypeId,3);assert.deepEqual(m.note.audiences.map(a=>[a.audience,a.publish]),[['internal',2]]);assert.equal(m.time.defaultWorkTypeId,6);assert.equal((await s.metadata.resolveSchedulingMetadata(s.p,100)).defaultStatusId,1);await assert.rejects(s.writes.noteAdd(s.p,{ticket,note:{...note,audience:'customer'},request_key:'no-customer-audience'}));assert.equal((await s.writes.noteAdd(s.p,{ticket,note,request_key:'internal-observed-labels'})).status,'succeeded_verified');});

const createInput={company:0,title:'Office PCs',description:'Install approved PCs',queue:3,priority:4,due_datetime:'2026-09-21T10:00:00-05:00',owner:'self',opportunity_id:300,request_key:'ticket-create-key-1'};
test('ticket creation links the same-company opportunity, assigns self, verifies and prevents duplicate POSTs',async()=>{const s=setup();const r=await s.creation.create(s.p,createInput);assert.equal(r.status,'succeeded_verified',JSON.stringify(r));assert.equal(s.rows.Tickets!.length,1);assert.equal(s.rows.Tickets![0].opportunityID,300);assert.equal(s.rows.Tickets![0].assignedResourceID,42);assert.equal((await s.creation.create(s.p,createInput)).operation_id,r.operation_id);assert.equal(s.calls.filter(c=>c.path==='Tickets'&&c.method==='POST').length,1);await assert.rejects(s.creation.create(s.p,{...createInput,title:'Different'}));assert.equal(s.rows.Opportunities![0].title,'Office PCs');});
test('ticket creation resolves and verifies an active same-company contactID',async()=>{const s=setup();s.fields.Tickets!.push({name:'contactID',isReadOnly:false,isRequired:false});s.rows.Contacts=[{id:701,companyID:0,firstName:'Example',lastName:'Contact',isActive:true,emailAddress:'contact@example.invalid'}];const r=await s.creation.create(s.p,{...createInput,contact_id:701,contact_identity:{name:'Example Contact'},request_key:'ticket-create-contact-key'});assert.equal(r.status,'succeeded_verified',JSON.stringify(r));assert.equal(s.rows.Tickets![0]!.contactID,701);assert.equal((r as any).verified_saved_fields.contactID,701);});
test('cross-company opportunity creation and update are rejected before writes',async()=>{const s=setup();s.rows.Opportunities![0].companyID=99;await assert.rejects(s.creation.create(s.p,createInput));await assert.rejects(s.tech.update(s.p,{ticket,changes:{opportunity_id:300},expected:{opportunityID:null},request_key:'foreign-link-update'}));assert.equal(s.calls.some(c=>c.path==='Tickets'&&['POST','PATCH'].includes(c.method)),false);});
test('existing ticket update links the opportunity and requires the previous link value',async()=>{const s=setup();const r=await s.tech.update(s.p,{ticket,changes:{opportunity_id:300},expected:{opportunityID:null},request_key:'existing-link-update'});assert.equal(r.status,'succeeded_verified');assert.equal(s.ticket.opportunityID,300);await assert.rejects(s.tech.update(s.p,{ticket,changes:{opportunity_id:300},expected:{opportunityID:null},request_key:'stale-link-update'}));await assert.rejects(s.tech.update(s.p,{ticket,changes:{opportunity_id:300},expected:{title:'Work'},request_key:'missing-expected-link'}));});
test('unknown ticket create is not automatically replayed or converted to success',async()=>{const s=setup();s.fail('Tickets');const r=await s.creation.create(s.p,createInput);assert.equal(r.status,'unknown_outcome');assert.equal((await s.creation.create(s.p,createInput)).status,'unknown_outcome');assert.equal(s.calls.filter(c=>c.path==='Tickets'&&c.method==='POST').length,1);});
test('required creation inputs, read-only capability and invalid assignment fail before POST',async()=>{const s=setup();await assert.rejects(s.creation.create(s.p,{...createInput,priority:undefined}));await assert.rejects(s.creation.create(s.p,{...createInput,queue:'Missing Queue'}));await assert.rejects(s.creation.create(s.p,{...createInput,owner:999}));await assert.rejects(s.creation.create({...s.p,capabilities:['operational.read']},createInput));assert.equal(s.rows.Tickets!.length,0);});

test('SQL migration stores encrypted ticket intent and supports receipt recovery after reconstruction',async()=>{const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');const {PostgresJournal}=await import('../packages/storage/src/index.js');const {REQUIRED_MIGRATIONS}=await import('../scripts/preflight.js');const db=new PGlite();try{for(const file of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));const s=setup();const core=new TicketWorkflows(s.adapter,s.store,new PostgresJournal(db));const creation=new TicketCreation(core,s.adapter,s.metadata,s.cipher);const first=await creation.create(s.p,createInput);assert.equal(first.status,'succeeded_verified');await db.exec(await readFile('packages/storage/migrations/007_ticket_create_intents.sql','utf8'));const second=await new TicketCreation(core,s.adapter,s.metadata,s.cipher).create(s.p,createInput);assert.equal(second.operation_id,first.operation_id);assert.equal(s.rows.Tickets!.length,1);const record=await core.journal.get(first.operation_id,`${s.p.tenantId}:${s.p.objectId}`);assert(record?.encryptedIntent);assert.equal(JSON.stringify(record).includes('Install approved PCs'),false);}finally{await db.close();}});
test('opportunity movement after preparation prevents ticket POST at the dispatch guard',async()=>{const s=setup();const prepare=s.metadata.prepareTicketCreate.bind(s.metadata);let n=0;s.metadata.prepareTicketCreate=async(...args)=>{const body=await prepare(...args);if(++n===1)s.rows.Opportunities![0].companyID=99;return body;};const r=await s.creation.create(s.p,createInput);assert.equal(r.status,'failed');assert.equal(s.calls.some(c=>c.path==='Tickets'&&c.method==='POST'),false);});
test('created ticket with mismatching returned opportunity remains unverified',async()=>{const s=setup();const original=s.adapter.createTicket.bind(s.adapter);s.adapter.createTicket=async(...args)=>{const saved=await original(...args);s.rows.Tickets![0].opportunityID=999;return saved;};const r=await s.creation.create(s.p,createInput);assert.equal(r.status,'accepted_unverified');await s.creation.create(s.p,createInput);assert.equal(s.rows.Tickets!.length,1);});

test('authored request reaches ticket storage unchanged without executing requested investigation work',async()=>{
 const {readAiRequest}=await import('./fixtures/read-ai-work-request.js');const s=setup();
 const r=await s.creation.create(s.p,{...createInput,title:readAiRequest.title,description:readAiRequest.description});
 assert.equal(r.status,'succeeded_verified');assert.equal(s.rows.Tickets![0].title,readAiRequest.title);assert.equal(s.rows.Tickets![0].description,readAiRequest.description);
 assert.equal((r as any).verified_saved_fields.description,readAiRequest.description);
 assert.equal(s.calls.filter(c=>c.method!=='GET'&&!c.path.endsWith('/query')).length,1);
});


test('time preflight uses three scoped ticket reads with cold and warm directory caches',async()=>{
 const s=setup();
 for(let i=0;i<2;i++){
  s.calls.length=0;
  const result=await s.writes.validate(s.p,'time',{ticket,time:{...time,start_datetime:'2026-09-14T09:00:00-05:00'},request_key:'read-only-preflight-count'});
  assert.equal(result.valid,true);
  assert.equal(s.calls.filter(c=>c.path==='Tickets/100').length,3);
  assert.equal(s.calls.some(c=>c.method==='POST'&&!c.path.endsWith('/query')),false);
 }
 assert.equal(s.calls.length,3);
});

test('reused preflight metadata cannot hide ticket movement or default drift before final validation',async()=>{
 for(const change of ['company','default'] as const){
  const s=setup();s.rows.BillingCodes!.push({id:7,name:'Other work type',isActive:true,useType:8});
  const original=s.adapter.ticketWorkMetadata.bind(s.adapter);
  s.adapter.ticketWorkMetadata=async(...args)=>{const m=await original(...args);if(change==='company')s.ticket.companyID=99;else s.ticket.billingCodeID=7;return m;};
  await assert.rejects(s.writes.validate(s.p,'time',{ticket,time,request_key:'preflight-movement-check'}));
  assert.equal(s.calls.some(c=>c.method==='POST'&&!c.path.endsWith('/query')),false);
 }
});

test('ticket creation carries the complete creation checklist and verifies compatible issue classification',async()=>{
 const s=setup();
 s.fields.Tickets!.push({...pick('ticketType',[[1,'Service Request']]),isReadOnly:false},{...pick('issueType',[[11,'Hardware'],[12,'Software']]),isReadOnly:false},{...pick('subIssueType',[[21,'PC'],[22,'Application']]),isReadOnly:false},{name:'contactID',isReadOnly:false});
 const sub=s.fields.Tickets!.find(f=>f.name==='subIssueType');sub.picklistValues[0].parentValue='11';sub.picklistValues[1].parentValue='12';
 s.rows.Contacts=[{id:701,companyID:0,firstName:'Example',lastName:'Contact',isActive:true}];
 const options=await s.metadata.ticketCreateOptions(s.p);assert.equal(options.creation_fields.length,12);assert.equal(options.input_field_mapping.contact_id,'contactID');assert(options.fields.some((f:any)=>f.name==='subIssueType'));
 const input={...createInput,category:'Standard',ticket_type:'Service Request',issue_type:'Hardware',sub_issue_type:'PC',contact_id:701,contact_identity:{name:'Example Contact'},role:'Engineer',creation_assumptions:['Hardware inferred from requested PC installation.']};
 const result:any=await s.creation.create(s.p,input);assert.equal(result.status,'succeeded_verified');assert.equal(result.verified_saved_fields?.issueType,11);assert.equal(result.verified_saved_fields?.subIssueType,21);assert.deepEqual(result.creation_review?.unresolved_fields,[]);assert.deepEqual(result.creation_review?.assumptions,input.creation_assumptions);assert(outputSchemaFor('ticket_create').safeParse(result).success);assert.equal(outputSchemaFor('ticket_create').safeParse({...result,creation_review:{...result.creation_review,assumptions:42}}).success,false);assert.equal(s.rows.Tickets![0].creation_assumptions,undefined);
 assert.deepEqual((await s.creation.create(s.p,input) as any).creation_review,result.creation_review);assert.equal(s.calls.filter(c=>c.path==='Tickets'&&c.method==='POST').length,1);
});
test('ticket creation rejects mismatched, inactive and orphan sub-issues before creating',async()=>{
 for(const invalid of [{issue_type:11,sub_issue_type:22},{sub_issue_type:21},{issue_type:11,sub_issue_type:23}]){
 const s=setup();s.fields.Tickets!.push({...pick('issueType',[[11,'Hardware']]),isReadOnly:false},{...pick('subIssueType',[[21,'PC'],[22,'Application'],[23,'Retired']]),isReadOnly:false});
 const sub=s.fields.Tickets!.find(f=>f.name==='subIssueType');sub.picklistValues[0].parentValue='11';sub.picklistValues[1].parentValue='12';Object.assign(sub.picklistValues[2],{parentValue:'11',isActive:false});
 await assert.rejects(s.creation.create(s.p,{...createInput,...invalid}));assert.equal(s.calls.some(c=>c.path==='Tickets'&&c.method==='POST'),false);
 }
});
test('ticket creation uses tenant classification defaults and reports unknown optional fields after creation',async()=>{
 const s=setup();s.fields.Tickets!.find(f=>f.name==='ticketCategory').picklistValues[0].isDefaultValue=true;
 s.fields.Tickets!.push({...pick('issueType',[[11,'Hardware']]),isReadOnly:false},{...pick('subIssueType',[[21,'PC']]),isReadOnly:false});
 s.fields.Tickets!.find(f=>f.name==='issueType').picklistValues[0].isDefaultValue=true;Object.assign(s.fields.Tickets!.find(f=>f.name==='subIssueType').picklistValues[0],{isDefaultValue:true,parentValue:'11'});
 const result:any=await s.creation.create(s.p,{...createInput,description:undefined});assert.equal(result.status,'succeeded_verified');assert.equal(result.verified_saved_fields?.description,createInput.title);assert.equal(result.verified_saved_fields?.subIssueType,21);assert.deepEqual(result.creation_review?.unresolved_fields,['requester','ticket_type']);assert.deepEqual(result.creation_review?.defaulted_fields,['role','category','description','issue_type','sub_issue_type']);
});
test('uncertain ticket creation does not expose a verified creation review or repeat the write',async()=>{
 const s=setup();s.fail('Tickets');const input={...createInput,creation_assumptions:['Due date inferred from delivery plan.']};const result:any=await s.creation.create(s.p,input);assert.equal(result.status,'unknown_outcome');assert.equal(result.creation_review,undefined);assert.equal(result.verified_saved_fields,undefined);await s.creation.create(s.p,input);assert.equal(s.calls.filter(c=>c.path==='Tickets'&&c.method==='POST').length,1);
});


test('integer contact activity is consistent across search, creation and existing ticket linking',async()=>{
 const s=setup();s.fields.Tickets!.push({name:'contactID',isReadOnly:false});s.rows.Contacts=[{id:701,companyID:0,firstName:'Example',lastName:'Contact',isActive:1}];
 const lookup=new ContactLookup(s.metadata);assert.equal((await lookup.search(s.p,{company:0})).contacts[0]!.active,true);
 assert.equal((await s.creation.create(s.p,{...createInput,contact_id:701,contact_identity:{name:'Example Contact'}})).status,'succeeded_verified');
 const r=await s.tech.update(s.p,{ticket,changes:{contact_id:701,contact_identity:{name:'Example Contact'}},expected:{contactID:null},request_key:'integer-contact-link'});assert.equal(r.status,'succeeded_verified');assert.equal(s.ticket.contactID,701);
 s.rows.Contacts[0].isActive=0;assert.equal((await lookup.search(s.p,{company:0})).contacts[0]!.active,false);await assert.rejects(s.metadata.resolveContact(s.p,0,{kind:'id',id:701}),/inactive/);
 for(const value of [undefined,null,'1',2]){s.rows.Contacts[0].isActive=value;await assert.rejects(lookup.search(s.p,{company:0}),/status is unavailable or invalid/);await assert.rejects(s.metadata.resolveContact(s.p,0,{kind:'id',id:701}),/status is unavailable or invalid/);}
});
test('existing ticket role update exposes and selects a non-default eligible role and replays once',async()=>{
 const s=setup();s.rows.Roles!.push({id:8,name:'500-Sales Rep',isActive:true});s.rows.ResourceServiceDeskRoles!.push({id:3,resourceID:42,roleID:8,isActive:true,isDefault:false});
 const metadata=await s.metadata.resolveTechnicianMetadata(s.p,100);assert.deepEqual(metadata.assignments.filter(a=>a.resourceId===42).map(a=>a.roleId),[5,8]);
 const input={ticket,changes:{role:{kind:'name',name:'500-Sales Rep'}},expected:{assignedResourceRoleID:5},request_key:'explicit-sales-role'};
 const r=await s.tech.update(s.p,input);assert.equal(r.status,'succeeded_verified');assert.equal(s.ticket.assignedResourceRoleID,8);assert.equal(s.ticket.assignedResourceID,42);await s.tech.update(s.p,input);assert.equal(s.calls.filter(c=>c.path==='Tickets'&&c.method==='PATCH').length,1);
});
test('explicit role updates reject missing expected state, foreign roles and unassigned owners',async()=>{
 for(const scenario of ['expected','role','owner']){const s=setup();if(scenario==='owner')s.ticket.assignedResourceID=null;
 await assert.rejects(s.tech.update(s.p,{ticket,changes:{role:{kind:'id',id:scenario==='role'?999:5}},expected:scenario==='expected'?{}:{assignedResourceRoleID:5},request_key:'invalid-role-update'}));assert.equal(s.calls.some(c=>c.method==='PATCH'),false);}
});

function numberedSetup(){
 const s=setup();s.fields.Tickets!.find(f=>f.name==='ticketCategory').picklistValues=[{value:'2',label:'411 Deploy - PC',isActive:true,isDefaultValue:true},{value:'22',label:'300 TAM',isActive:true}];
 s.fields.Tickets!.find(f=>f.name==='queueID').picklistValues=[{value:'3',label:'410 PS-Deployments',isActive:true},{value:'33',label:'300 SA-TAM',isActive:true}];
 s.rows.BillingCodes=[{id:6,name:'411 Deploy Computer',isActive:true,useType:8},{id:66,name:'303 Design Desk',isActive:true,useType:8}];
 s.rows.Roles=[{id:5,name:'100 Engineer',isActive:true},{id:55,name:'400 Deployment Engineer',isActive:true}];
 s.rows.ResourceServiceDeskRoles!.push({id:3,resourceID:42,roleID:55,isActive:true,isDefault:false});
 s.rows.ResourceRoleQueues!.push({id:3,resourceID:42,queueID:33});
 s.rows.TicketCategoryFieldDefaults=[{id:9,ticketCategoryID:2,workTypeID:6}];
 return s;
}
test('ticket creation aligns hundreds and chooses matching eligible role before the employee default',async()=>{
 const s=numberedSetup();const result:any=await s.creation.create(s.p,{...createInput,queue:3,category:2,work_type:6});assert.equal(result.status,'succeeded_verified');assert.equal(result.verified_saved_fields.assignedResourceRoleID,55);assert.equal(result.verified_saved_fields.billingCodeID,6);
 const t=numberedSetup();const inferred:any=await t.creation.create(t.p,{...createInput,queue:3});assert.equal(inferred.status,'succeeded_verified');assert.equal(inferred.verified_saved_fields.ticketCategory,2);assert.equal(inferred.verified_saved_fields.billingCodeID,6);
 const other=numberedSetup();other.rows.Roles=other.rows.Roles!.filter(r=>r.id!==55);const fallback:any=await other.creation.create(other.p,{...createInput,queue:3});assert.equal(fallback.verified_saved_fields.assignedResourceRoleID,5);
 const explicit=numberedSetup();const overridden:any=await explicit.creation.create(explicit.p,{...createInput,queue:3,role:5});assert.equal(overridden.verified_saved_fields.assignedResourceRoleID,5);
});
test('cross-range creation requires an explicit override and preserves it without sending policy fields to Autotask',async()=>{
 const s=numberedSetup(),input={...createInput,queue:3,category:22,work_type:66};await assert.rejects(s.creation.create(s.p,input),/Classification must share/);assert.equal(s.calls.some(c=>c.method==='POST'&&c.path==='Tickets'),false);
 const reason='User requested TAM ownership while using the deployment queue.';const result:any=await s.creation.create(s.p,{...input,classification_override:reason});assert.equal(result.status,'succeeded_verified');assert(result.creation_review.assumptions.includes(`User classification override: ${reason}`));assert.equal(s.rows.Tickets![0].classification_override,undefined);
 assert.equal((await s.creation.create(s.p,{...input,classification_override:reason})).operation_id,result.operation_id);
 assert(!JSON.stringify(await s.core.journal.get(result.operation_id,'tenant:aaron')).includes(reason));
 await assert.rejects(s.creation.create(s.p,{...input,work_type:999,classification_override:reason,request_key:'invalid-type-override'}),/active work type/);
});
test('same-range ambiguity is not resolved by arbitrary ordering and inactive choices cannot be overridden',async()=>{
 const s=numberedSetup();s.rows.BillingCodes!.push({id:7,name:'412 Deploy Server',isActive:true,useType:8});s.rows.TicketCategoryFieldDefaults=[];
 await assert.rejects(s.creation.create(s.p,{...createInput,queue:3}),/Classification must share/);
 const active=numberedSetup();active.rows.BillingCodes!.find(r=>r.id===6).isActive=false;await assert.rejects(active.creation.create(active.p,{...createInput,queue:3,work_type:6,classification_override:'User requested this work type.'}),/active work type/);
});
test('category-specific type choices and defaults remain distinct; context choices override defaults within actual constraints',async()=>{
 const s=numberedSetup();s.fields.Tickets!.push({...pick('ticketType',[[81,'Incident'],[82,'Service Request']]),isReadOnly:false,picklistParentValueField:'ticketCategory'});
 for(const v of s.fields.Tickets!.find(f=>f.name==='ticketType').picklistValues)v.parentValue=v.value==='81'?'22':'2';
 s.rows.TicketCategoryFieldDefaults=[{id:9,ticketCategoryID:2,workTypeID:6,ticketTypeID:82}];
 const options=await s.metadata.ticketCreateOptions(s.p,{category:2});assert.equal(options.ticket_type_availability.category_restrictions,'category_scoped');assert.deepEqual(options.ticket_type_availability.choices.map((v:any)=>v.label),['Service Request']);
 await assert.rejects(s.creation.create(s.p,{...createInput,queue:3,ticket_type:81,classification_override:'User selected Incident.'}),/not available for this category/);
 const result:any=await s.creation.create(s.p,{...createInput,queue:3});assert.equal(result.verified_saved_fields.ticketType,82);
 const plain=numberedSetup();assert.equal((await plain.metadata.ticketCreateOptions(plain.p,{category:2})).ticket_type_availability.category_restrictions,'unavailable');
});
test('ticket-time classification checks range and keeps explicitly selected roles and work-type overrides',async()=>{
 const s=numberedSetup(),input={ticket,time:{...time,work_type:'303 Design Desk'},request_key:'cross-range-time'};
 await assert.rejects(s.writes.validate(s.p,'time',input),/Classification must share/);
 const result=await s.writes.timeLog(s.p,{...input,time:{...input.time,role:'100 Engineer',classification_override:'User requested Design Desk time for this deployment.'}});
 assert.equal(result.status,'succeeded_verified');assert.equal(s.rows.TimeEntries![0].billingCodeID,66);assert.equal(s.rows.TimeEntries![0].roleID,5);assert.equal(s.rows.TimeEntries![0].classification_override,undefined);
});
test('existing ticket classification edits require aligned current work type or a user override, but unrelated edits preserve legacy mismatches',async()=>{
 const s=numberedSetup();await assert.rejects(s.tech.update(s.p,{ticket,changes:{category:{kind:'id',id:22},queue:{kind:'id',id:33}},expected:{ticketCategory:2,queueID:3},request_key:'mismatched-existing-class'}),/Classification must share/);
 const reason='User requested moving this ticket to TAM without changing its work type.';
 const result=await s.tech.update(s.p,{ticket,changes:{category:{kind:'id',id:22},queue:{kind:'id',id:33},role:{kind:'id',id:5}},expected:{ticketCategory:2,queueID:3,assignedResourceRoleID:5},classification_override:reason,request_key:'override-existing-class'});assert.equal(result.status,'succeeded_verified');assert.equal(s.ticket.billingCodeID,6);
 const record=await s.core.journal.find('tenant:aaron','override-existing-class');assert(record?.encryptedIntent);assert(!JSON.stringify(record).includes(reason));assert.equal(s.calls.filter(c=>c.method==='PATCH').length,1);
 const title=await s.tech.update(s.p,{ticket,changes:{title:'Updated text only'},expected:{title:'Work'},request_key:'preserve-existing-class'});assert.equal(title.status,'succeeded_verified');assert.equal(s.ticket.queueID,33);
});


test('SQL classification override intents survive migration reruns and remain encrypted',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),{readFile}=await import('node:fs/promises'),{PostgresJournal}=await import('../packages/storage/src/index.js'),{REQUIRED_MIGRATIONS}=await import('../scripts/preflight.js');
 const db=new PGlite();try{
  for(const file of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));
  const s=setup(),journal=new PostgresJournal(db),instruction='Use the TAM queue for this deployment';
  const input={actorKey:'tenant:aaron',requestKey:'classification-sql',payloadHash:'b'.repeat(64),operation:'ticket_update',mappingVersion:1,resourceId:42,policyVersion:'v1',encryptedIntent:s.cipher.seal({classification_override:instruction},'classification-test'),intentExpiresAt:new Date(Date.now()+86400000).toISOString()};
  const first=await journal.reserve(input);
  await db.exec(await readFile('packages/storage/migrations/011_ticket_classification_intents.sql','utf8'));
  const saved=await new PostgresJournal(db).get(first.record.id,input.actorKey);
  assert.equal(saved?.encryptedIntent,input.encryptedIntent);assert.equal(JSON.stringify(saved).includes(instruction),false);
  assert.equal((await journal.reserve(input)).created,false);
 }finally{await db.close();}
});


test('ticket creation accepts an eligible role when the resource belongs to a different Service Desk queue',async()=>{
 const s=numberedSetup();s.rows.ResourceRoleQueues=[{id:901,resourceID:42,queueID:33}];
 const result=await s.creation.create(s.p,{...createInput,queue:3,role:55,request_key:'different-resource-queue'});
 assert.equal(result.status,'succeeded_verified');
 const created=s.rows.Tickets!.at(-1)!;assert.equal(created.queueID,3);assert.equal(created.assignedResourceID,42);assert.equal(created.assignedResourceRoleID,55);
 const missing=numberedSetup();missing.rows.ResourceRoleQueues=[];
 await assert.rejects(missing.creation.create(missing.p,{...createInput,queue:3,role:55,request_key:'no-resource-queues'}),/at least one Service Desk queue/);
});


test('issue updates validate the pair, expected state, exact readback and replay',async()=>{
 const s=setup();s.fields.Tickets!.push({...pick('issueType',[[27,'New Requests'],[28,'Fault']]),isReadOnly:false},{...pick('subIssueType',[[292,'Laptop'],[293,'Repair']]),isReadOnly:false});
 const sub=s.fields.Tickets!.find((f:any)=>f.name==='subIssueType');sub.picklistValues[0].parentValue='27';sub.picklistValues[1].parentValue='28';
 const input={ticket,changes:{issue_type:27,sub_issue_type:292},expected:{issueType:null,subIssueType:null},request_key:'issue-update-laptop'};
 const result=await s.tech.update(s.p,input);assert.equal(result.status,'succeeded_verified');assert.equal(s.ticket.issueType,27);assert.equal(s.ticket.subIssueType,292);const stored=await s.core.journal.get(result.operation_id,'tenant:aaron');assert.deepEqual((stored?.result?.verification as any).matched_fields,['issueType','subIssueType']);
 assert.equal((await s.tech.update(s.p,input)).operation_id,result.operation_id);assert.equal(s.calls.filter(c=>c.method==='PATCH').length,1);
 await assert.rejects(s.tech.update(s.p,{...input,request_key:'stale-issue-update'}));
 await assert.rejects(s.tech.update(s.p,{...input,expected:{issueType:27},request_key:'missing-issue-expected'}));
 await assert.rejects(s.tech.update(s.p,{...input,changes:{issue_type:28},expected:{issueType:27,subIssueType:292},request_key:'wrong-parent-issue'}),/compatible/);
 const cleared=await s.tech.update(s.p,{...input,changes:{issue_type:'Fault',sub_issue_type:null},expected:{issueType:27,subIssueType:292},request_key:'clear-issue-child'});assert.equal(cleared.status,'succeeded_verified');assert.equal(s.ticket.subIssueType,null);
 sub.picklistValues[1].isActive=false;
 await assert.rejects(s.tech.update(s.p,{...input,changes:{sub_issue_type:293},expected:{issueType:28,subIssueType:null},request_key:'inactive-issue-child'}),/compatible/);
});


test('live API role casing preserves a copied nondefault role and verifies role updates',async()=>{
 const s=setup();
 s.rows.Roles!.push({id:55,name:'Original role',isActive:true});
 s.rows.ResourceServiceDeskRoles!.push({id:3,resourceID:42,roleID:55,isActive:true,isDefault:false});
 s.ticket.assignedResourceRoleID=55;
 const original=await s.domain.resolveTicket(s.p,{kind:'id',id:100});
 assert.equal(original.assignedResourceRoleID,55);
 const options=await s.metadata.ticketCreateOptions(s.p,{});
 assert.equal(options.input_field_mapping.role,'assignedResourceRoleID');
 const copied:any=await s.creation.create(s.p,{...createInput,owner:original.assignedResourceID,owner_identity:{name:'Aaron Campbell'},role:original.assignedResourceRoleID});
 assert.equal(copied.status,'succeeded_verified');
 assert.equal(copied.verified_saved_fields.assignedResourceRoleID,55);
 const post=s.calls.find(c=>c.path==='Tickets'&&c.method==='POST')!;
 assert.equal(post.body.assignedResourceRoleID,55);
 assert.equal(Object.hasOwn(post.body,'assignedResourceroleID'),false);
 const updated=await s.tech.update(s.p,{ticket,changes:{role:{kind:'id',id:5}},expected:{assignedResourceRoleID:55},request_key:'native-casing-role-update'});
 assert.equal(updated.status,'succeeded_verified');
 assert.equal(s.ticket.assignedResourceRoleID,5);
});

test('ticket creation rejects missing or mismatched requester identity despite a valid same-company ID',async()=>{
 for(const identity of [undefined,{name:'Morgan Lee'}]){
  const s=setup();s.fields.Tickets!.push({name:'contactID',isReadOnly:false});s.rows.Contacts=[{id:9002,companyID:0,firstName:'Taylor',lastName:'Park',isActive:true}];
  await assert.rejects(s.creation.create(s.p,{...createInput,contact_id:9002,...(identity?{contact_identity:identity}:{}),creation_assumptions:['Morgan Lee is the requester.']}),(e:any)=>e.code===(identity?'conflict':'invalid_input'));
  assert.equal(s.calls.some(c=>c.path==='Tickets'&&c.method==='POST'),false);
 }
});
test('ticket creation requires intended identity for numeric owners and rejects mismatches',async()=>{
 for(const identity of [undefined,{name:'Aaron Campbell'}]){
  const s=setup();await assert.rejects(s.creation.create(s.p,{...createInput,owner:43,...(identity?{owner_identity:identity}:{})}),(e:any)=>e.code===(identity?'conflict':'invalid_input'));
  assert.equal(s.calls.some(c=>c.path==='Tickets'&&c.method==='POST'),false);
 }
 const s=setup();const result=await s.creation.create(s.p,{...createInput,owner:43,owner_identity:{name:'Other Employee'}});assert.equal(result.status,'succeeded_verified');
});

test('ticket work type updates resolve names, patch billingCodeID and verify persisted values',async()=>{
 const s=setup();s.rows.BillingCodes!.push({id:8,name:'New work type',isActive:true,useType:8});
 const input={ticket,changes:{work_type:'New work type'},expected:{billingCodeID:6},request_key:'update-work-type-native'};
 const result:any=await s.tech.update(s.p,input);assert.equal(result.status,'succeeded_verified');assert.equal(s.ticket.billingCodeID,8);
 assert.deepEqual(s.calls.find(c=>c.method==='PATCH')!.body,{id:100,billingCodeID:8});
 await s.tech.update(s.p,input);assert.equal(s.calls.filter(c=>c.method==='PATCH').length,1);
 await assert.rejects(s.tech.update(s.p,{...input,expected:{billingCodeID:6},request_key:'stale-work-type-native'}));
 await assert.rejects(s.tech.update(s.p,{...input,changes:{work_type:'Missing'},expected:{billingCodeID:8},request_key:'missing-work-type-native'}));
});
test('ticket native fields accept current metadata and reject readonly, unknown and stale fields',async()=>{
 const s=setup();s.fields.Tickets!.push({name:'estimatedHours',dataType:'double',isReadOnly:false,isRequired:false},{name:'externalID',dataType:'string',isReadOnly:false,isRequired:false},{name:'createDate',dataType:'datetime',isReadOnly:true});
 s.ticket.estimatedHours=1;
 const result:any=await s.tech.update(s.p,{ticket,changes:{description:'Updated description',fields:{estimatedHours:2.5,externalID:'CASE-1'}},expected:{description:'Details',estimatedHours:1,externalID:null},request_key:'native-fields-ticket'});
 assert.equal(result.status,'succeeded_verified');assert.equal(s.ticket.estimatedHours,2.5);assert.equal(s.ticket.externalID,'CASE-1');assert.equal(s.ticket.description,'Updated description');
 for(const fields of [{createDate:'2026-01-01'},{unknown:'bad'},{estimatedHours:'invalid'}])await assert.rejects(s.tech.update(s.p,{ticket,changes:{fields},expected:Object.fromEntries(Object.keys(fields).map(k=>[k,s.ticket[k]??null])),request_key:'reject-native-'+Object.keys(fields)[0]}));
 assert.equal(s.calls.filter(c=>c.method==='PATCH').length,1);
});
test('native ticket assignment aliases retain identity, completion and duplicate protections',async()=>{
 const s=setup();for(const field of s.fields.Tickets!)field.dataType??='integer';
 await assert.rejects(s.tech.update(s.p,{ticket,changes:{fields:{assignedResourceID:43}},expected:{assignedResourceID:42},request_key:'native-owner-no-proof'}));
 s.rows.TicketChecklistItems!.push({id:1,ticketID:100,itemName:'Important',isImportant:true,isCompleted:false});
 await assert.rejects(s.tech.update(s.p,{ticket,changes:{fields:{status:7},resolution:'Done'},expected:{status:1,resolution:null},request_key:'native-status-checklist'}));
 await assert.rejects(s.tech.update(s.p,{ticket,changes:{priority:{kind:'id',id:4},fields:{priority:4}},expected:{priority:4},request_key:'native-duplicate-field'}));
 assert.equal(s.calls.some(c=>c.method==='PATCH'),false);
});
test('ticket metadata exposes work type, editable fields and current values without writing',async()=>{
 const s=setup();const result=await s.metadata.ticketFieldOptions(s.p,100);assert.equal(result.current_values.billingCodeID,6);assert.ok(result.work_types.some(v=>v.id===6));assert.ok(result.fields.some((v:any)=>v.name==='billingCodeID'&&v.allowed_for_write));assert.equal(s.calls.some(c=>c.method==='PATCH'),false);
});
test('editing an already completed ticket does not rerun completion prerequisites',async()=>{
 const s=setup();s.ticket.status=7;s.ticket.resolution=null;s.rows.TicketChecklistItems!.push({id:1,ticketID:100,itemName:'Legacy unchecked',isImportant:true,isCompleted:false});
 const r:any=await s.tech.update(s.p,{ticket,changes:{description:'Corrected details'},expected:{description:'Details'},request_key:'completed-ticket-edit'});assert.equal(r.status,'succeeded_verified');assert.equal(s.ticket.description,'Corrected details');
});
test('native ticket fields reject foreign project and problem-ticket links before dispatch',async()=>{
 const s=setup();s.fields.Tickets!.push({name:'projectID',dataType:'integer',isReadOnly:false},{name:'problemTicketId',dataType:'long',isReadOnly:false});s.rows.Projects=[{id:44,companyID:99}];s.rows.Tickets!.push({id:45,companyID:99});
 for(const fields of [{projectID:44},{problemTicketId:45}])await assert.rejects(s.tech.update(s.p,{ticket,changes:{fields},expected:Object.fromEntries(Object.keys(fields).map(k=>[k,null])),request_key:'foreign-native-'+Object.keys(fields)[0]}));assert.equal(s.calls.some(c=>c.method==='PATCH'),false);
});
