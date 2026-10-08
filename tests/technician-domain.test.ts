import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, type AutotaskPort, type Principal } from '../packages/contracts/src/index.js';
import { IntentCipher, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { FixtureTechnicianPort, fixtureTechnicianMetadata, type FixtureTechnicianOptions } from '../packages/technician/src/fixtures.js';
import { HttpTechnicianPort, type HttpTechnicianOptions, type TechnicianHttpRequest, type TechnicianOperation, type TechnicianQualification } from '../packages/technician/src/http.js';
import { ReferenceResolutionError, TechnicianDomain, assertTechnicianMetadata, ticketChangesSchema, ticketUpdateSchema, workDateSchema } from '../packages/technician/src/index.js';
import type { TicketUpdateInput } from '../packages/technician/src/contracts.js';

const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected;
function setup(options:FixtureTechnicianOptions={}){const [p,peer]=fixturePrincipals() as [Principal,Principal];const store=new MemoryPrincipalStore([p,peer]);const base=new FixtureAutotaskAdapter(actor=>reauthorize(actor,store));const port=new FixtureTechnicianPort(base,store,options);const domain=new TechnicianDomain(port,store,{ticketHosts:['tickets.example.invalid']});return{p,peer,store,base,port,domain};}
const ticket={kind:'id' as const,id:1001};
const close:TicketUpdateInput={ticket,changes:{status:{kind:'name',name:'Complete'},resolution:'Restored service and confirmed with the contact.'},expected:{status:1,resolution:null}};
const window={start:'2026-09-10T05:00:00Z',end:'2026-09-11T05:00:00Z'};

test('strict semantic updates reject arbitrary, delegated, finance, empty and incomplete input',()=>{
  for(const value of [{},{billingCodeID:4},{companyID:20},{assignedResourceID:102},{resolution:''},{title:' '},{owner:{kind:'self',resourceID:102}}])assert.equal(ticketChangesSchema.safeParse(value).success,false);
  assert.equal(ticketUpdateSchema.safeParse({...close,expected:{status:1,financeCost:{invalid:true}}}).success,false);
  for(const date of ['2026-02-29','2026-09-31','2026-9-10'])assert.equal(workDateSchema.safeParse(date).success,false);
  assert.equal(workDateSchema.safeParse('2024-02-29').success,true);
});
test('company/resource reference resolution is exact, normalized, scoped, and self uses mapped identity',async()=>{
  const{p,domain}=setup();assert.equal((await domain.resolveReference(p,{kind:'company',reference:{kind:'name',name:'  EXAMPLE   Engineering '}})).id,10);
  assert.equal((await domain.resolveReference(p,{kind:'resource',reference:{kind:'self'},context:{ticketId:1001}})).id,101);
  await assert.rejects(domain.resolveReference(p,{kind:'resource',reference:{kind:'id',id:102}}),e=>e instanceof ReferenceResolutionError&&e.reason==='missing');
  await assert.rejects(domain.resolveReference(p,{kind:'company',reference:{kind:'name',name:'Example'}}),e=>e instanceof ReferenceResolutionError&&e.reason==='missing');
  await assert.rejects(domain.resolveReference(p,{kind:'company',reference:{kind:'self'}}),code('invalid_input'));
});
test('contact lookup resolves exact ID, name and email, and rejects ambiguous or cross-company contacts',async()=>{
  const{p,port}=setup();
  assert.equal((await port.resolveContact!(p,10,{kind:'id',id:6401})).id,6401);
  assert.equal((await port.resolveContact!(p,10,{kind:'name',name:' example contact '})).id,6401);
  assert.equal((await port.resolveContact!(p,10,{kind:'email',email:'CONTACT@EXAMPLE.INVALID'})).id,6401);
  await assert.rejects(port.resolveContact!(p,10,{kind:'id',id:6402}),code('not_found_or_inaccessible'));
  port.records.contacts.push({id:6403,companyID:10,firstName:'Example',lastName:'Contact',isActive:true});
  await assert.rejects(port.resolveContact!(p,10,{kind:'name',name:'Example Contact'}),code('invalid_input'));
});
test('ticket contact links use fresh expected contactID and parent-company exception',async()=>{
  const s=setup();
  const plan=await s.domain.prepareUpdate(s.p,{ticket,changes:{contact:{kind:'email',email:'contact@example.invalid'}},expected:{contactID:6401}});
  assert.equal(plan.changes.contactID,6401);assert.equal((await s.domain.commitUpdate(s.p,plan)).verified,true);
  const direct=await s.domain.prepareUpdate(s.p,{ticket,changes:{contact_id:6401,contact_identity:{email:'contact@example.invalid'}},expected:{contactID:6401}});assert.equal(direct.changes.contactID,6401);
  s.base.records.Companies[0]!.parentCompanyID=11;s.p.companyIds.push(11);s.store.set({...s.p,companyIds:[...s.p.companyIds]});
  s.port.records.contacts.push({id:6404,companyID:11,firstName:'Parent',lastName:'Contact',isActive:true,emailAddress:'parent@example.invalid'});
  s.base.records.Tickets[0]!.contactID=6404;
  const context=await s.domain.ticketContext(s.p,{ticket,collections:['contact']});assert.equal(context.collections.contact!.items[0]!.id,6404);
  await assert.rejects(s.domain.prepareUpdate(s.p,{ticket,changes:{contact:{kind:'id',id:6402}},expected:{contactID:6404}}),code('not_found_or_inaccessible'));
});
test('ambiguous and inactive explicit references never choose an arbitrary eligible replacement',async()=>{
  const{p,domain}=setup({resolveMetadata:async(p,id)=>{const m=fixtureTechnicianMetadata(p,{id,companyID:10});m.options.resource.push({...m.options.resource[0]!,id:104,label:'EXAMPLE Technician'});m.options.queue[1]!.active=false;return m;}});
  await assert.rejects(domain.resolveReference(p,{kind:'resource',reference:{kind:'name',name:'Example Technician'}}),e=>e instanceof ReferenceResolutionError&&e.reason==='ambiguous'&&e.candidates.length===2);
  await assert.rejects(domain.resolveReference(p,{kind:'queue',reference:{kind:'id',id:502}}),e=>e instanceof ReferenceResolutionError&&e.reason==='inactive');
});
test('incomplete metadata catalog cannot prove unique names',async()=>{
  const s=setup();const original=s.port.catalog.bind(s.port);s.port.catalog=async(...args)=>({...await original(...args),complete:false});
  await assert.rejects(s.domain.resolveReference(s.p,{kind:'queue',reference:{kind:'name',name:'Service Desk'}}),e=>e instanceof ReferenceResolutionError&&e.reason==='incomplete');
  assert.equal((await s.domain.resolveReference(s.p,{kind:'queue',reference:{kind:'id',id:501}})).id,501);
});
test('ticket identifiers, exact numbers, and reviewed-host links use identical scope guards',async()=>{
  const{p,domain}=setup();assert.equal((await domain.resolveTicket(p,{kind:'ticket_number',value:'T20260910.0001'})).id,1001);
  const url='https://tickets.example.invalid/Autotask/AutotaskExtend/ExecuteCommand.aspx?Code=OpenTicket&TicketID=1001';assert.equal((await domain.resolveTicket(p,{kind:'ticket_url',value:url})).id,1001);
  for(const value of [url.replace('tickets.example.invalid','evil.invalid'),url.replace('https:','http:'),url+'&extra=1',url.replace('https://','https://name:pass@')])await assert.rejects(domain.resolveTicket(p,{kind:'ticket_url',value}),code('invalid_input'));
  for(const ref of [{kind:'id',id:2001},{kind:'ticket_number',value:'T20260910.0002'}])await assert.rejects(domain.resolveTicket(p,ref),code('not_found_or_inaccessible'));
});
test('metadata validates exact actor, company, ticket, source, versions, expiry and duplicate IDs',()=>{
  const{p,base}=setup();const t=base.records.Tickets[0]!;
  for(const mutate of [(m:any)=>m.objectId='other',(m:any)=>m.tenantId='other',(m:any)=>m.resourceId=102,(m:any)=>m.mappingVersion++,(m:any)=>m.policyVersion='other',(m:any)=>m.companyId=20,(m:any)=>m.ticketId=2001,(m:any)=>m.source='Autotask',(m:any)=>m.validUntil='2000-01-01T00:00:00Z',(m:any)=>m.options.status[0].completed=undefined,(m:any)=>m.options.priority.push(m.options.priority[0]),(m:any)=>m.extra='unreviewed']){const m=fixtureTechnicianMetadata(p,t);mutate(m);assert.throws(()=>assertTechnicianMetadata(m,p,t,'fixture'),code('missing_metadata'));}
});
test('context returns allowlisted actual linked records and honest collection completeness',async()=>{
  const{p,domain}=setup();const result=await domain.ticketContext(p,{ticket,collections:['history','checklist','assets','contact','site','requirements']});
  assert.equal(result.collections.assets!.items[0]!.id,6301);assert.equal(result.collections.site!.items[0]!.id,6501);assert.equal(result.collections.contact!.items[0]!.id,6401);
  assert.equal(JSON.stringify(result).includes('NEVER-RETURN'),false);assert.equal(JSON.stringify(result).includes('detail'),false);
  const requirements=result.collections.requirements!.items[0] as any;assert.equal(requirements.eligible,false);assert.deepEqual(requirements.unmet,['required_field:resolution']);
});
test('collection continuations are signed and bound to actor, ticket, window and page size',async()=>{
  const s=setup();s.port.records.history.push({id:6103,ticketID:1001,action:'Changed',date:'2026-09-10T15:00:00Z'});
  const first=await s.port.collection(s.p,1001,'history',{limit:1});assert.equal(first.complete_within_scope,false);assert.ok(first.continuation);
  const second=await s.port.collection(s.p,1001,'history',{limit:1,cursor:first.continuation!});assert.equal(second.items[0]!.id,6103);assert.equal(second.continuation,null);assert.equal(second.complete_within_scope,false);
  await assert.rejects(s.port.collection(s.p,1001,'history',{limit:2,cursor:first.continuation!}),code('invalid_input'));
  await assert.rejects(s.port.collection(s.peer,2001,'history',{limit:1,cursor:first.continuation!}),code('invalid_input'));
  await assert.rejects(s.port.collection(s.p,1001,'history',{limit:1,cursor:first.continuation!+'x'}),code('invalid_input'));
});
test('expanded handoff derives reviewed role and preserves exact documented field casing',async()=>{
  const{p,domain,base}=setup();const plan=await domain.prepareUpdate(p,{ticket,changes:{owner:{kind:'name',name:'Example Colleague'},queue:{kind:'id',id:502},priority:{kind:'name',name:'High'}},expected:{assignedResourceID:101,queueID:501,priority:701}});
  assert.deepEqual(plan.changes,{queueID:502,assignedResourceID:103,assignedResourceRoleID:201,priority:702});assert.equal(plan.expected.assignedResourceRoleID,201);
  const result=await domain.commitUpdate(p,plan);assert.equal(result.verified,true);assert.equal(base.records.Tickets[0]!.assignedResourceID,103);assert.equal('assignedResourceroleID' in base.records.Tickets[0]!,false);
});
test('missing or stale expected values and ineligible assignment/queue combinations fail before mutation',async()=>{
  const{p,domain,port}=setup();
  await assert.rejects(domain.prepareUpdate(p,{ticket,changes:{priority:{kind:'id',id:702}},expected:{}}),code('invalid_input'));
  await assert.rejects(domain.prepareUpdate(p,{ticket,changes:{priority:{kind:'id',id:702}},expected:{priority:702}}),code('precondition_failed'));
  await assert.rejects(domain.prepareUpdate(p,{ticket,changes:{queue:{kind:'id',id:502}},expected:{queueID:501}}),code('invalid_input'));
  await assert.rejects(domain.prepareUpdate(p,{ticket,changes:{owner:null,queue:null},expected:{assignedResourceID:101,queueID:501}}),code('invalid_input'));
  assert.equal(port.calls.filter(c=>c.kind==='patch').length,0);
});
test('ambiguous reviewed roles reject reassignment and existing valid role can be preserved',async()=>{
  const{p,domain}=setup({resolveMetadata:async(p,id)=>{const m=fixtureTechnicianMetadata(p,{id,companyID:10});m.assignments.push({resourceId:103,queueId:501,roleId:202,categoryIds:[601]});return m;}});
  await assert.rejects(domain.prepareUpdate(p,{ticket,changes:{owner:{kind:'id',id:103}},expected:{assignedResourceID:101}}),code('invalid_input'));
  assert.equal((await domain.prepareUpdate(p,{ticket,changes:{title:'New title'},expected:{title:'Example printer offline'}})).changes.title,'New title');
});
test('completion needs text and complete evidence; Important checklist is a reviewed application rule',async()=>{
  const s=setup();await assert.rejects(s.domain.prepareUpdate(s.p,{ticket,changes:{status:{kind:'id',id:5}},expected:{status:1}}),code('precondition_failed'));
  s.port.records.checklist[0]!.isCompleted=false;await assert.rejects(s.domain.prepareUpdate(s.p,close),code('precondition_failed'));
  s.port.options.resolveMetadata=async(p,id)=>{const m=fixtureTechnicianMetadata(p,{id,companyID:10});m.categoryRules[0]!.requireImportantChecklistComplete=false;return m;};
  assert.equal((await s.domain.prepareUpdate(s.p,close)).completion,true);
  s.port.options.unavailableCollections=['checklist'];await assert.rejects(s.domain.prepareUpdate(s.p,close),code('precondition_failed'));
  const context=await s.domain.ticketContext(s.p,{ticket,collections:['requirements']});assert.equal(context.collections.requirements!.complete_within_scope,false);
});
test('incomplete mandatory retrieval and malformed important flags prevent closure',async()=>{
  const s=setup();s.port.records.checklist=Array.from({length:101},(_,i)=>({id:7000+i,ticketID:1001,itemName:'Item',isImportant:false,isCompleted:true}));
  await assert.rejects(s.domain.prepareUpdate(s.p,close),code('precondition_failed'));
  s.port.records.checklist=[{id:7000,ticketID:1001,itemName:'Malformed',isImportant:true}];await assert.rejects(s.domain.prepareUpdate(s.p,close),code('precondition_failed'));
});
test('commit ignores own note/time activity timestamps but rejects material ticket/metadata drift',async()=>{
  const s=setup();const plan=await s.domain.prepareUpdate(s.p,close);s.base.records.Tickets[0]!.lastActivityDate=new Date().toISOString();assert.equal((await s.domain.commitUpdate(s.p,plan)).verified,true);
  const t=setup();const stale=await t.domain.prepareUpdate(t.p,close);t.base.records.Tickets[0]!.description='A concurrent material change';await assert.rejects(t.domain.commitUpdate(t.p,stale),code('precondition_failed'));
  const u=setup();const before=await u.domain.prepareUpdate(u.p,close);u.port.options.resolveMetadata=async(p,id)=>({...fixtureTechnicianMetadata(p,{id,companyID:10}),version:'changed'});await assert.rejects(u.domain.commitUpdate(u.p,before),code('precondition_failed'));
});
test('commit rechecks checklist and prevents forged expanded payloads even through the internal port',async()=>{
  const s=setup();const plan=await s.domain.prepareUpdate(s.p,close);s.port.records.checklist[0]!.isCompleted=false;await assert.rejects(s.domain.commitUpdate(s.p,plan),code('precondition_failed'));
  const t=setup();const safe=await t.domain.prepareUpdate(t.p,close);(safe.changes as any).billingCodeID=777;await assert.rejects(t.port.patchTicket(t.p,safe),code('precondition_failed'));assert.equal(t.port.calls.filter(c=>c.kind==='patch').length,0);
});
test('readback loss or permission revocation after accepted patch is unverified, never a definite failure',async()=>{
  const s=setup();const plan=await s.domain.prepareUpdate(s.p,close);const patch=s.port.patchTicket.bind(s.port);s.port.patchTicket=async(...args)=>{await patch(...args);s.store.set({...s.p,active:false});};
  const result=await s.domain.commitUpdate(s.p,plan);assert.equal(result.verified,false);assert.equal(result.ticket,undefined);assert.equal(s.base.records.Tickets[0]!.status,5);
});
test('identity or policy revocation prevents scoped reads and prepared writes',async()=>{
  const s=setup();const plan=await s.domain.prepareUpdate(s.p,close);s.store.set({...s.p,mappingVersion:2});await assert.rejects(s.domain.commitUpdate(s.p,plan),code('identity_mapping_invalid'));await assert.rejects(s.port.collection(s.p,1001,'history',{}),code('identity_mapping_invalid'));
});
test('own work distinguishes actual local-date time from tasks and rechecks task project company scope',async()=>{
  const s=setup();s.port.records.tasks.push({id:6799,projectID:6602,assignedResourceID:101,title:'Hidden project task',startDateTime:window.start,endDateTime:window.end});
  const result=await s.domain.ownWork(s.p,window,'2026-09-10');assert.deepEqual(result.time.items.map(t=>t.id),[4001]);assert.equal(result.time.window!.start,'2026-09-10T00:00:00Z');assert.deepEqual(result.tasks.items.map(t=>t.id),[6701]);assert.equal(JSON.stringify(result).includes('hourlyBillingRate'),false);assert.equal(JSON.stringify(result).includes('Hidden project task'),false);
  assert.equal((await s.domain.ownWork(s.p,window)).time.items.length,0);await assert.rejects(s.port.getTask(s.p,6799),code('not_found_or_inaccessible'));
});
test('service boundary rejects malicious own-work rows and strips unknown/financial fields',async()=>{
  const s=setup();const original=s.port.ownWork.bind(s.port);s.port.ownWork=async(...args)=>{const result=await original(...args);result.time.items[0]!.secretCanary='HIDDEN';result.tasks.items[0]!.hourlyBillingRate=999;return result;};
  assert.equal(JSON.stringify(await s.domain.ownWork(s.p,window,'2026-09-10')).includes('HIDDEN'),false);
  s.port.ownWork=async(...args)=>{const result=await original(...args);result.time.items[0]!.resourceID=102;return result;};await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10'),code('dependency_unavailable'));
});

function qualification(p:Principal,operation:TechnicianOperation):TechnicianQualification{return{operation,evidenceSource:'live',headerAccepted:true,permissionEnforced:true,nativeAttribution:true,testIds:['mock-qualification'],resourceIds:[p.resourceId],tenantId:p.tenantId,policyVersion:p.policyVersion,qualifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),evidenceReference:'mock://qualification-test-only'};}
function httpSetup(options:HttpTechnicianOptions={}){const s=setup();const liveBase=new Proxy(s.base,{get(target,key){if(key==='source')return'Autotask';const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as AutotaskPort;const port=new HttpTechnicianPort(liveBase,s.store,options);const domain=new TechnicianDomain(port,s.store);return{...s,port,domain};}
test('live technician operations are disabled by default and fixture evidence never qualifies them',async()=>{
  const s=httpSetup();await assert.rejects(s.port.metadata(s.p,1001),code('impersonation_not_qualified'));await assert.rejects(s.port.collection(s.p,1001,'history',{}),code('impersonation_not_qualified'));
  const q=qualification(s.p,'TicketHistory.query');q.evidenceSource='fixture';s.port.options.qualifications=[q];await assert.rejects(s.port.collection(s.p,1001,'history',{}),code('impersonation_not_qualified'));
});
test('HTTP history uses documented single ticket filter, does not follow continuation URLs and omits raw detail',async()=>{
  const s=httpSetup();const requests:TechnicianHttpRequest[]=[];s.port.options.qualifications=[qualification(s.p,'TicketHistory.query')];s.port.options.transport={request:async(p,r)=>{requests.push(r);await r.beforeDispatch();return{items:[{id:1,ticketID:1001,action:'Changed',date:'2026-09-10T14:00:00Z',detail:'Financial secret'}],pageDetails:{nextPageUrl:'https://arbitrary.invalid/next'}};}};
  const result=await s.port.collection(s.p,1001,'history',{window});assert.equal(result.complete_within_scope,false);assert.equal(result.continuation,null);assert.equal(JSON.stringify(result).includes('Financial secret'),false);assert.equal(requests.length,1);assert.deepEqual(requests[0]!.body,{filter:[{op:'eq',field:'ticketID',value:1001}]});assert.equal(requests[0]!.path,'TicketHistory/query');
  await s.port.collection(s.p,1001,'history',{window,limit:500});assert.deepEqual(requests[1]!.body,{filter:[{op:'eq',field:'ticketID',value:1001}],MaxRecords:500});
  await assert.rejects(s.port.collection(s.p,1001,'checklist',{}),code('impersonation_not_qualified')); // Reviewed route exists, but this test only qualifies history.
});
test('HTTP expanded patch repeats full preparation after queue and rejects changed business state before dispatch',async()=>{
  const s=httpSetup();s.port.options.qualifications=['metadata.resolve','Tickets.patch.expanded'].map(op=>qualification(s.p,op as TechnicianOperation));s.port.options.resolveMetadata=async(p,id)=>{const m=fixtureTechnicianMetadata(p,{id,companyID:10});m.source='Autotask';return m;};let requestCount=0;
  s.port.options.transport={request:async(p,r)=>{requestCount++;s.base.records.Tickets[0]!.priority=702;await r.beforeDispatch();throw new Error('Must not dispatch');}};
  const plan=await s.domain.prepareUpdate(s.p,{ticket,changes:{title:'Changed title'},expected:{title:'Example printer offline'}});await assert.rejects(s.domain.commitUpdate(s.p,plan),code('precondition_failed'));assert.equal(requestCount,1);assert.equal(s.base.records.Tickets[0]!.title,'Example printer offline');
});
test('HTTP accepted malformed acknowledgement and absent transport guard never imply retry safety',async()=>{
  const s=httpSetup();s.port.options.qualifications=['metadata.resolve','Tickets.patch.expanded'].map(op=>qualification(s.p,op as TechnicianOperation));s.port.options.resolveMetadata=async(p,id)=>({...fixtureTechnicianMetadata(p,{id,companyID:10}),source:'Autotask'});
  const plan=await s.domain.prepareUpdate(s.p,{ticket,changes:{title:'Changed title'},expected:{title:'Example printer offline'}});
  s.port.options.transport={request:async(p,r)=>{await r.beforeDispatch();return{itemId:999};}};await assert.rejects(s.domain.commitUpdate(s.p,plan),code('unknown_outcome'));
  s.port.options.transport={request:async()=>({itemId:1001})};await assert.rejects(s.domain.commitUpdate(s.p,plan),code('unknown_outcome'));
});
test('HTTP workday uses a separately qualified own-time query and verifies each ticket/task company before projection',async()=>{
  const s=httpSetup(),requests:TechnicianHttpRequest[]=[];
  s.port.options.qualifications=['metadata.resolve','Tasks.query','Tasks.get','Projects.get','TimeEntries.query.own'].map(op=>qualification(s.p,op as TechnicianOperation));
  s.port.options.resolveMetadata=async(p,id)=>({...fixtureTechnicianMetadata(p,{id,companyID:10}),source:'Autotask'});
  const original=s.base.query.bind(s.base);s.base.query=async(p,r)=>{assert.notEqual(r.entity,'TimeEntries','Workday must not misuse the ticket-only time adapter.');return original(p,r);};
  s.port.options.transport={request:async(p,r)=>{requests.push(r);await r.beforeDispatch();if(r.operation==='Tasks.query')return{items:[],pageDetails:{nextPageUrl:null}};
    if(r.operation==='Tasks.get')return{item:{id:6701,projectID:6601,assignedResourceID:101,title:'Fictitious task',startDateTime:'2026-09-10T14:00:00Z',endDateTime:'2026-09-10T16:00:00Z'}};
    if(r.operation==='Projects.get')return{item:{id:6601,companyID:10}};
    assert.equal(r.operation,'TimeEntries.query.own');return{items:[{id:4001,ticketID:1001,resourceID:101,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:.5,hourlyBillingRate:200},{id:4901,taskID:6701,resourceID:101,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:1},{id:4902,ticketID:2001,resourceID:101,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:9}],pageDetails:{nextPageUrl:null}};
  }};
  const result=await s.domain.ownWork(s.p,window,'2026-09-10');assert.deepEqual(result.time.items.map(t=>t.id),[4001,4901]);assert(!JSON.stringify(result).includes('hourlyBillingRate'));assert(!JSON.stringify(result).includes('4902'));
  const request=requests.find(r=>r.operation==='TimeEntries.query.own')!;assert.deepEqual(request.body,{filter:[{field:'resourceID',op:'eq',value:101},{field:'dateWorked',op:'gte',value:'2026-09-10T00:00:00Z'},{field:'dateWorked',op:'lt',value:'2026-09-11T00:00:00.000Z'}],MaxRecords:100});
  s.port.options.qualifications=s.port.options.qualifications.filter(q=>q.operation!=='TimeEntries.query.own');await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10'),code('impersonation_not_qualified'));
});

function httpOwnTime(rows:Record<string,unknown>[],nextPageUrl:string|null=null){
  const s=httpSetup();s.port.options.qualifications=['metadata.resolve','Tasks.query','TimeEntries.query.own'].map(op=>qualification(s.p,op as TechnicianOperation));
  s.port.options.resolveMetadata=async(p,id)=>({...fixtureTechnicianMetadata(p,{id,companyID:10}),source:'Autotask'});
  s.port.options.transport={request:async(_p,r)=>{await r.beforeDispatch();if(r.operation==='Tasks.query')return{items:[],pageDetails:{nextPageUrl:null}};assert.equal(r.operation,'TimeEntries.query.own');return{items:structuredClone(rows),pageDetails:{nextPageUrl}};}};
  return s;
}
const validHttpTime={id:4001,ticketID:1001,resourceID:101,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:.5};

test('HTTP own time rejects malformed dates, nonfinite date parsing, wrong resources and either date boundary instead of skipping rows',async()=>{
  const invalidRows=[
    {...validHttpTime,id:0},
    {...validHttpTime,dateWorked:undefined},
    {...validHttpTime,dateWorked:null},
    {...validHttpTime,dateWorked:1789000000000},
    {...validHttpTime,dateWorked:'not-a-date'},
    {...validHttpTime,dateWorked:'Infinity'},
    {...validHttpTime,dateWorked:'2026-09-09T23:59:59.999Z'},
    {...validHttpTime,dateWorked:'2026-09-11T00:00:00.000Z'},
    {...validHttpTime,resourceID:102},
  ];
  for(const row of invalidRows){const s=httpOwnTime([validHttpTime,{...row,id:row.id===0?0:4901}]);await assert.rejects(s.port.ownWork(s.p,window,'2026-09-10'),code('dependency_unavailable'));}
  const valid=httpOwnTime([validHttpTime,{...validHttpTime,id:4901,dateWorked:'2026-09-10T23:59:59.999Z'}]);const result=await valid.domain.ownWork(valid.p,window,'2026-09-10');assert.equal(result.time.complete_within_scope,true);assert.deepEqual(result.time.items.map(t=>t.id),[4001,4901]);
});

test('HTTP own time includes self internal time without exposing other resources or financial fields',async()=>{
  for(const internal of [{id:4901,resourceID:101,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:2},{id:4901,ticketID:null,taskID:null,resourceID:101,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:2,summaryNotes:'Internal meeting',hourlyBillingRate:200}]){
    const s=httpOwnTime([validHttpTime,internal]),result=await s.domain.ownWork(s.p,window,'2026-09-10');
    assert.equal(result.time.complete_within_scope,true);assert.equal(result.time.scope,'resource:101:authorized-ticket-task-and-internal-time-in-window');assert.deepEqual(result.time.items.map(t=>t.id),[4001,4901]);assert.equal(JSON.stringify(result).includes('hourlyBillingRate'),false);
  }
  const paged=httpOwnTime([validHttpTime],'https://unfollowed.example.invalid/next'),incomplete=await paged.domain.ownWork(paged.p,window,'2026-09-10');assert.equal(incomplete.time.complete_within_scope,false);assert.equal(incomplete.time.continuation,null);
  for(const invalid of [{...validHttpTime,ticketID:0},{...validHttpTime,ticketID:null,taskID:'wrong'},{...validHttpTime,hoursWorked:NaN},{...validHttpTime,hoursWorked:-1}]){const s=httpOwnTime([invalid]);await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10'),code('dependency_unavailable'));}
});

test('due-date updates require current value, preserve timezone instant and verify saved date',async()=>{
 const {p,base,domain}=setup();const row=base.records.Tickets.find(r=>r.id===1001)!;row.dueDateTime='2026-09-15T22:00:00.000Z';
 const input={ticket,changes:{due_datetime:'2026-09-25T17:00:00-05:00'},expected:{dueDateTime:'2026-09-15T17:00:00-05:00'}};
 await assert.rejects(domain.prepareUpdate(p,{...input,expected:{}}),code('invalid_input'));
 await assert.rejects(domain.prepareUpdate(p,{...input,expected:{dueDateTime:null}}),code('precondition_failed'));
 const plan=await domain.prepareUpdate(p,input);assert.deepEqual(plan.changes,{dueDateTime:'2026-09-25T22:00:00.000Z'});
 const saved=await domain.commitUpdate(p,plan);assert.equal(saved.verified,true);assert(saved.matched_fields.includes('dueDateTime'));
 row.dueDateTime='2026-09-26T22:00:00.000Z';assert.equal((await domain.verifyUpdate(p,plan)).verified,false);
 for(const due_datetime of ['2026-09-25','2026-09-25T17:00:00','2026-02-30T17:00:00Z'])assert.equal(ticketChangesSchema.safeParse({due_datetime}).success,false);
});

test('due-date-only edits preserve ambiguous existing roles while assignment edits still require resolution',async()=>{
 const {p,base,domain}=setup({resolveMetadata:async(p,id)=>{const m=fixtureTechnicianMetadata(p,{id,companyID:10});m.assignments.push({resourceId:101,queueId:501,roleId:202,categoryIds:[601]});return m;}});
 const row=base.records.Tickets.find(r=>r.id===1001)!;row.assignedResourceRoleID=null;row.dueDateTime='2026-09-15T22:00:00Z';
 const input={ticket,changes:{due_datetime:'2026-09-25T17:00:00-05:00'},expected:{dueDateTime:'2026-09-15T22:00:00Z'}};
 const plan=await domain.prepareUpdate(p,input);assert.deepEqual(plan.changes,{dueDateTime:'2026-09-25T22:00:00.000Z'});
 assert.equal((await domain.commitUpdate(p,plan)).verified,true);assert.equal(row.assignedResourceRoleID,null);
 await assert.rejects(domain.prepareUpdate(p,{ticket,changes:{owner:{kind:'self'}},expected:{assignedResourceID:101}}),code('invalid_input'));
});

test('HTTP site reads use the linked location, project address fields and reject foreign or changed associations',async()=>{
  const s=httpSetup(),requests:TechnicianHttpRequest[]=[];s.port.options.qualifications=[qualification(s.p,'CompanyLocations.get')];
  let item={id:6501,companyID:10,name:'Branch',address1:'123 Example St',city:'Example',phone:'555-0100',countryID:1,taxRegionID:99};
  s.base.records.Tickets[0]!.companylocationID=6501;
  s.port.options.transport={request:async(_p,r)=>{requests.push(r);await r.beforeDispatch();return{item};}};
  const result=await s.domain.ticketContext(s.p,{ticket,collections:['site']});
  assert.equal(requests[0]!.path,'CompanyLocations/6501');assert.equal(result.collections.site!.items[0]!.phone,'555-0100');assert.equal(result.collections.site!.items[0]!.taxRegionID,undefined);
  item={...item,companyID:20};await assert.rejects(s.domain.ticketContext(s.p,{ticket,collections:['site']}));
  item={...item,companyID:10,id:6502};await assert.rejects(s.domain.ticketContext(s.p,{ticket,collections:['site']}));
  item={...item,id:6501};s.port.options.transport={request:async(_p,r)=>{await r.beforeDispatch();s.base.records.Tickets[0]!.companylocationID=6502;return{item};}};
  await assert.rejects(s.domain.ticketContext(s.p,{ticket,collections:['site']}),code('precondition_failed'));
  s.base.records.Tickets[0]!.companylocationID=null;const absent=await s.domain.ticketContext(s.p,{ticket,collections:['site']});assert.deepEqual(absent.collections.site!.items,[]);assert.match(absent.collections.site!.warnings.join(' '),/not been inferred/);
});

function pagedWorkday(){
  const s=httpOwnTime([]);s.port.options.baseUrl='https://webservices3.autotask.net/atservicesrest/v1.0/';s.port.options.cursorCipher=new IntentCipher(Buffer.alloc(32,3));
  const seen:TechnicianHttpRequest[]=[];
  s.port.options.transport={request:async(_p,r)=>{seen.push(r);await r.beforeDispatch();if(r.operation==='Tasks.query')return{items:[],pageDetails:{nextPageUrl:null}};
    assert.equal(r.operation,'TimeEntries.query.own');return{items:[{...validHttpTime,id:r.continuation?4003:4001,ticketID:null,taskID:null}],pageDetails:{nextPageUrl:r.continuation?null:s.port.options.baseUrl+'TimeEntries/query/next?paging=page2'}};
  }};return{...s,seen};
}
test('HTTP workday follows bounded pages and returns encrypted resumable cursors tied to employee/date/query',async()=>{
  const s=pagedWorkday();const all=await s.domain.ownWork(s.p,window,'2026-09-10');assert.equal(all.time.complete_within_scope,true);assert.deepEqual(all.time.items.map(r=>r.id),[4001,4003]);
  const first=await s.domain.ownWork(s.p,window,'2026-09-10',{max_pages:1});const cursor=first.time.continuation!;assert(cursor);assert(!cursor.includes('webservices'));assert.equal(first.time.complete_within_scope,false);
  const tail=await s.domain.ownWork(s.p,window,'2026-09-10',{max_pages:1,cursors:{time:cursor}});assert.deepEqual(tail.time.items.map(r=>r.id),[4003]);assert.equal(tail.time.continuation,null);
  await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-11',{cursors:{time:cursor}}),code('invalid_input'));
  await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10',{cursors:{tasks:cursor}}),code('invalid_input'));
  const changed={...s.p,companyIds:[10,20]};s.store.set(changed);await assert.rejects(s.domain.ownWork(changed,window,'2026-09-10',{cursors:{time:cursor}}),code('invalid_input'));
  s.store.set(s.p);for(const q of s.port.options.qualifications!)q.expiresAt=new Date(Date.now()+3_600_000).toISOString();s.port.options.now=()=>Date.now()+301_000;await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10',{cursors:{time:cursor}}),code('invalid_input'));
});
test('workday rejects malformed, duplicate and out-of-scope time on subsequent pages',async()=>{
  for(const malicious of [{...validHttpTime,id:4003,resourceID:102},{...validHttpTime,id:4003,dateWorked:'2026-09-11T00:00:00Z'},{...validHttpTime,id:4001}]){
    const s=pagedWorkday(),original=s.port.options.transport!.request;s.port.options.transport={request:async(p,r)=>{const result:any=await original(p,r);if(r.continuation)result.items=[malicious];return result;}};
    await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10'),code('dependency_unavailable'));
  }
  for(const next of ['https://foreign.invalid/TimeEntries/query/next?paging=x','https://webservices3.autotask.net/atservicesrest/v1.0/Contacts/query/next?paging=x','https://webservices3.autotask.net/atservicesrest/v1.0/TimeEntries/query/next?paging=x&other=x']){
    const s=pagedWorkday(),original=s.port.options.transport!.request;s.port.options.transport={request:async(p,r)=>{const result:any=await original(p,r);if(r.operation==='TimeEntries.query.own')result.pageDetails.nextPageUrl=next;return result;}};
    await assert.rejects(s.domain.ownWork(s.p,window,'2026-09-10'),code('dependency_unavailable'));assert.equal(s.seen.filter(r=>r.continuation).length,0);
  }
});

test('assigned tickets and project tasks paginate independently without dropping the second page',async()=>{
  const s=pagedWorkday();s.base.records.Tickets.push({...s.base.records.Tickets[0]!,id:1003});
  s.port.options.qualifications=[...s.port.options.qualifications!,qualification(s.p,'Tasks.get'),qualification(s.p,'Projects.get')];
  s.base.query=async(_p,query)=>{assert.equal(query.entity,'Tickets');return{items:[s.base.records.Tickets.find(t=>t.id===(query.cursor?1003:1001))!],nextCursor:query.cursor?null:'base-page-2',fetchedAt:new Date().toISOString()};};
  const task=(id:number)=>({id,projectID:6601,assignedResourceID:101,title:'Task',startDateTime:'2026-09-10T14:00:00Z',endDateTime:'2026-09-10T16:00:00Z'});
  s.port.options.transport={request:async(_p,r)=>{await r.beforeDispatch();if(r.operation==='Tasks.query')return{items:[task(r.continuation?6702:6701)],pageDetails:{nextPageUrl:r.continuation?null:s.port.options.baseUrl+'Tasks/query/next?paging=2'}};if(r.operation==='Tasks.get')return{item:task(Number(r.path.split('/')[1]))};if(r.operation==='Projects.get')return{item:{id:6601,companyID:10}};return{items:[],pageDetails:{nextPageUrl:null}};}};
  const first=await s.domain.ownWork(s.p,window,'2026-09-10',{max_pages:1});assert(first.assigned_tickets.continuation);assert(first.tasks.continuation);assert.equal(first.time.continuation,null);
  const next=await s.domain.ownWork(s.p,window,'2026-09-10',{max_pages:1,cursors:{assigned_tickets:first.assigned_tickets.continuation!,tasks:first.tasks.continuation!}});
  assert.deepEqual(next.assigned_tickets.items.map(r=>r.id),[1003]);assert.deepEqual(next.tasks.items.map(r=>r.id),[6702]);assert.equal(next.assigned_tickets.continuation,null);assert.equal(next.tasks.continuation,null);
  const all=await s.domain.ownWork(s.p,window,'2026-09-10');assert.deepEqual(all.assigned_tickets.items.map(r=>r.id),[1001,1003]);assert.deepEqual(all.tasks.items.map(r=>r.id),[6701,6702]);
});

test('ticket updates require correct identity for both contact ID forms and owner IDs',async()=>{
 for(const contact of [{contact_id:6401},{contact:{kind:'id' as const,id:6401}}])for(const supplied of [false,true]){
  const s=setup();await assert.rejects(s.domain.prepareUpdate(s.p,{ticket,changes:{...contact,...(supplied?{contact_identity:{name:'Wrong Person'}}:{})},expected:{contactID:6401}}),code(supplied?'conflict':'invalid_input'));
  assert.equal(s.base.calls.some(c=>c.kind==='patch'),false);
 }
 for(const name of [undefined,'Wrong Employee']){
  const s=setup();await assert.rejects(s.domain.prepareUpdate(s.p,{ticket,changes:{owner:{kind:'id',id:101,...(name?{name}:{})}},expected:{assignedResourceID:101}}),code(name?'conflict':'invalid_input'));
 }
 const s=setup();const plan=await s.domain.prepareUpdate(s.p,{ticket,changes:{contact:{kind:'id',id:6401},contact_identity:{email:'contact@example.invalid'}},expected:{contactID:6401}});
 s.port.records.contacts[0]!.emailAddress='changed@example.invalid';
 await assert.rejects(s.domain.commitUpdate(s.p,plan),code('conflict'));assert.equal(s.base.calls.some(c=>c.kind==='patch'),false);
});

function cancellationSetup(label='Canceled') {
  return setup({resolveMetadata:async(p,id)=>{const m=fixtureTechnicianMetadata(p,{id,companyID:10});m.options.status.push({id:6,label,active:true,companyIds:[10],completed:true});m.statusTransitions.push({fromId:1,toId:6,categoryId:601});return m;}});
}
test('cancellation accepts no reason, preserves existing resolution and saves supplied reasons',async()=>{
  for(const label of ['Canceled','Cancelled']) for(const existing of [null,'Prior resolution']) {
    const s=cancellationSetup(label);s.base.records.Tickets[0]!.resolution=existing;
    const plan=await s.domain.prepareUpdate(s.p,{ticket,changes:{status:{kind:'id',id:6}},expected:{status:1}});
    assert.equal(Object.hasOwn(plan.changes,'resolution'),false);
    assert.equal((await s.domain.commitUpdate(s.p,plan)).verified,true);
    assert.equal(s.base.records.Tickets[0]!.resolution,existing);
  }
  const s=cancellationSetup();const reason='Duplicate of the customer request.';
  const plan=await s.domain.prepareUpdate(s.p,{ticket,changes:{status:{kind:'id',id:6},resolution:reason},expected:{status:1,resolution:null}});
  assert.equal((await s.domain.commitUpdate(s.p,plan)).verified,true);
  assert.equal(s.base.records.Tickets[0]!.resolution,reason);
});
test('cancellation retains other preconditions and propagates native rejection without adding a reason',async()=>{
  const s=cancellationSetup();const input:TicketUpdateInput={ticket,changes:{status:{kind:'id',id:6}},expected:{status:1}};
  s.port.records.checklist[0]!.isCompleted=false;
  await assert.rejects(s.domain.prepareUpdate(s.p,input),code('precondition_failed'));
  s.port.records.checklist[0]!.isCompleted=true;
  const plan=await s.domain.prepareUpdate(s.p,input);
  const rejection=new AppError('precondition_failed','Native validation requires resolution.');
  let calls=0;s.port.patchTicket=async()=>{calls++;throw rejection;};
  await assert.rejects(s.domain.commitUpdate(s.p,plan),error=>error===rejection);
  assert.equal(calls,1);assert.equal(s.base.records.Tickets[0]!.status,1);assert.equal(s.base.records.Tickets[0]!.resolution,null);
});
