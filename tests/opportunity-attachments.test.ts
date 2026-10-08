import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {AppError,type Principal,type DataRecord} from '../packages/contracts/src/index.js';
import {MemoryJournal,MemoryPrincipalStore,IntentCipher,PostgresJournal} from '../packages/storage/src/index.js';
import {reauthorize,assertCompanyScope,assertCapability} from '../packages/policy/src/index.js';
import {FixtureAutotaskAdapter,fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {TicketWorkflows} from '../packages/workflows/src/index.js';
import {ArtifactService,PostgresArtifactCatalog} from '../packages/artifacts/src/index.js';
import {OpportunityAttachmentService} from '../packages/attachments/src/opportunity.js';
import {FixtureOpportunityAttachmentPort} from '../packages/attachments/src/opportunity-fixtures.js';
import {HttpOpportunityAttachmentPort,type OpportunityAttachmentHttpOptions} from '../packages/attachments/src/opportunity-http.js';
import {FixtureUnlimitedAttachmentByteBudget,TicketAttachmentService,FixtureTicketAttachmentPort} from '../packages/attachments/src/index.js';
import {FixtureUnlimitedRequestBudget} from '../packages/autotask/src/budget.js';
import {outputSchemaFor} from '../apps/server/src/output-contracts.js';
import {REQUIRED_MIGRATIONS} from '../scripts/preflight.js';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
import {ToolRuntime} from '../apps/server/src/tool-runtime.js';
import {PlaybookService} from '../packages/playbooks/src/index.js';
import {PGlite} from '@electric-sql/pglite';
const roots:string[]=[];
after(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
const code=(c:string)=>(e:unknown)=>e instanceof AppError&&e.code===c;
async function setup(db?:PGlite){
 const root=await mkdtemp(join(resolve('work'),'opportunity-attachments-'));roots.push(root);
 const p=fixturePrincipals()[0]!;p.capabilities=[...new Set([...p.capabilities,'finance.read','sales.write'] as Principal['capabilities'])];
 const store=new MemoryPrincipalStore([p]),adapter=new FixtureAutotaskAdapter(p=>reauthorize(p,store));
 const core=new TicketWorkflows(adapter,store,db?new PostgresJournal(db):new MemoryJournal());
 const parents:DataRecord[]=[{id:230,companyID:10,title:'Laptop purchase'},{id:231,companyID:20,title:'Other company'},{id:1001,companyID:10,title:'Same numeric ID as ticket'}];
 const resolveOpportunity=async(principal:Principal,id:number)=>{principal=await reauthorize(principal,store);assertCapability(principal,'finance.read');const row=parents.find(r=>r.id===id);if(!row)throw new AppError('not_found_or_inaccessible','Missing opportunity');assertCompanyScope(principal,row.companyID);return {...row};};
 const key=randomBytes(32),cipher=new IntentCipher(randomBytes(32));
 const artifacts=new ArtifactService(core,{projectRoot:root,encryptionKey:key,resolveOpportunity,...(db?{catalog:new PostgresArtifactCatalog(db)}:{})});
 const port=new FixtureOpportunityAttachmentPort(store,[{id:9001,opportunityID:230,title:'old.txt',attachmentType:'FILE_ATTACHMENT',contentType:'text/plain',fileSize:5,publish:1,data:Buffer.from('hello').toString('base64')},{id:9002,opportunityID:230,title:'nested',parentAttachmentID:9001},{id:9003,opportunityID:230,title:'note',companyNoteID:5}]);
 const budget=new FixtureUnlimitedAttachmentByteBudget(),options={resolveOpportunity,publishInternal:1,byteBudget:budget};
 const service=new OpportunityAttachmentService(core,port,artifacts,cipher,options);
 const stage=(id=230)=>artifacts.stageOpportunityUpload(p,{opportunity_id:id,filename:'new.txt',mime:'text/plain',content_base64:Buffer.from('file bytes').toString('base64')});
 return{p,store,core,parents,resolveOpportunity,artifacts,port,budget,service,stage,options,cipher,key,root};
}
test('opportunity staging, direct reads, upload, verified receipt, replay and deletion',async()=>{
 const s=await setup(),staged=await s.stage();assert.equal(staged.data.opportunity_id,230);assert.equal(staged.data.ticket_id,undefined);
 assert.equal((await s.artifacts.download(s.p,{artifact_id:staged.data.artifact_id})).bytes.toString(),'file bytes');
 const listed=await s.service.list(s.p,{opportunity_id:230});assert.deepEqual(listed.attachments.map(r=>r.id),[9001]);assert(outputSchemaFor('opportunity_attachment_list').safeParse(listed).success);
 await assert.rejects(s.service.get(s.p,{opportunity_id:230,attachment_id:9002}),code('not_found_or_inaccessible'));
 const input={opportunity_id:230,artifact_id:staged.data.artifact_id,title:'Purchase details',request_key:'opp-upload-one'};
 const result=await s.service.upload(s.p,input);assert.equal(result.status,'succeeded_verified');assert.equal(result.data.opportunity_id,230);assert.equal(result.data.ticket_id,undefined);assert(outputSchemaFor('opportunity_attachment_upload').safeParse(result).success);
 const replay=await s.service.upload(s.p,input);assert.equal(replay.operation_id,result.operation_id);assert.equal(s.port.calls.filter(c=>c.method==='create').length,1);assert.equal(s.budget.reservations.length,1);
 await assert.rejects(s.service.upload(s.p,{...input,title:'Different'}),code('conflict'));
 const attachment_id=result.data.attachment_id as number;
 const chunk=await s.service.download(s.p,{opportunity_id:230,attachment_id,offset:1,length:3});assert.equal(Buffer.from(chunk.content_base64,'base64').toString(),'ile');assert.equal(chunk.next_offset,4);
 const deletion={opportunity_id:230,attachment_id,request_key:'opp-delete-one'},deleted=await s.service.delete(s.p,deletion);assert.equal(deleted.status,'succeeded_verified');assert.equal((await s.service.delete(s.p,deletion)).operation_id,deleted.operation_id);assert.equal(s.port.calls.filter(c=>c.method==='delete').length,1);
});
test('opportunity artifacts cannot cross parents, parent types, company scope, or revoked access',async()=>{
 const s=await setup(),staged=await s.stage(1001),upload={opportunity_id:230,artifact_id:staged.data.artifact_id,title:'wrong parent',request_key:'wrong-parent-upload'};
 await assert.rejects(s.service.upload(s.p,upload),code('precondition_failed'));
 const tickets=new TicketAttachmentService(s.core,new FixtureTicketAttachmentPort(s.store),s.artifacts,s.cipher,{publishInternal:1,byteBudget:s.budget});
 await assert.rejects(tickets.upload(s.p,{ticket:{kind:'id',id:1001},artifact_id:staged.data.artifact_id,title:'wrong type',request_key:'wrong-type-upload'}),code('precondition_failed'));
 const ticketFile=await s.artifacts.stageUpload(s.p,{ticket:{kind:'id',id:1001},filename:'ticket.txt',mime:'text/plain',content_base64:Buffer.from('ticket').toString('base64')});
 await assert.rejects(s.service.upload(s.p,{...upload,opportunity_id:1001,artifact_id:ticketFile.data.artifact_id}),code('precondition_failed'));
 await assert.rejects(s.stage(231),code('not_found_or_inaccessible'));
 s.parents.find(r=>r.id===1001)!.companyID=20;await assert.rejects(s.artifacts.download(s.p,{artifact_id:staged.data.artifact_id}));
 assert.equal(s.port.calls.filter(c=>c.method==='create').length,0);
});
test('unknown opportunity uploads do not repeat native writes and receipt reads require current access',async()=>{
 const s=await setup(),staged=await s.stage(),create=s.port.create.bind(s.port);let attempts=0;
 s.port.create=async(...args)=>{attempts++;await create(...args);throw new AppError('unknown_outcome','Lost response');};
 const input={opportunity_id:230,artifact_id:staged.data.artifact_id,title:'uncertain',request_key:'uncertain-opp-upload'};
 const result=await s.service.upload(s.p,input);assert.equal(result.status,'unknown_outcome');assert.equal(result.data.attachment_id,undefined);
 assert.equal((await s.service.upload(s.p,input)).operation_id,result.operation_id);assert.equal(attempts,1);
 s.parents[0]!.companyID=20;await assert.rejects(s.service.operationStatus(s.p,{operation_id:result.operation_id}));
});
test('opportunity file validation enforces 6 MB, MIME syntax and filenames before native writes',async()=>{
 const s=await setup(),base={opportunity_id:230,filename:'file.txt',mime:'text/plain',content_base64:Buffer.from('valid').toString('base64')};
 for(const patch of [{filename:'../file.txt'},{mime:'invalid MIME'},{content_base64:Buffer.alloc(6_000_001,65).toString('base64')}])await assert.rejects(s.artifacts.stageOpportunityUpload(s.p,{...base,...patch}));
 assert.equal(s.port.calls.length,0);
});
test('SQL migration preserves ticket artifacts and stores/reconstructs opportunity files and intents',async()=>{
 const db=new PGlite();try{
  for(const file of REQUIRED_MIGRATIONS.filter(f=>!f.startsWith('012_')))await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));
  const s=await setup(db),ticket=await s.artifacts.stageUpload(s.p,{ticket:{kind:'id',id:1001},filename:'ticket.txt',mime:'text/plain',content_base64:Buffer.from('legacy compatible').toString('base64')});
  await db.exec(await readFile('packages/storage/migrations/012_opportunity_attachments.sql','utf8'));
  const staged=await s.stage();
  const result=await s.service.upload(s.p,{opportunity_id:230,artifact_id:staged.data.artifact_id,title:'SQL upload',request_key:'sql-opp-upload'});assert.equal(result.status,'succeeded_verified');
  await db.exec(await readFile('packages/storage/migrations/012_opportunity_attachments.sql','utf8'));
  const rebuilt=new ArtifactService(s.core,{projectRoot:s.root,encryptionKey:s.key,catalog:new PostgresArtifactCatalog(db),resolveOpportunity:s.resolveOpportunity});
  assert.equal((await rebuilt.download(s.p,{artifact_id:staged.data.artifact_id})).bytes.toString(),'file bytes');assert.equal((await rebuilt.download(s.p,{artifact_id:ticket.data.artifact_id})).bytes.toString(),'legacy compatible');
  assert.equal((await new OpportunityAttachmentService(s.core,s.port,rebuilt,s.cipher,s.options).operationStatus(s.p,{operation_id:result.operation_id})).status,'succeeded_verified');
  const record=await rebuilt.catalog.get(staged.data.artifact_id,`${s.p.tenantId}:${s.p.objectId}`);assert(record);await assert.rejects(rebuilt.catalog.reserve({...record,id:'22222222-2222-4222-8222-222222222222',state:'pending',ticketId:1001},{maxPerActor:20,maxBytesPerActor:40000000,maxBytesGlobal:160000000}));
 }finally{await db.close();}
});
test('opportunity HTTP adapter uses exact parent routes, current publish metadata and shared request admission',async()=>{
 const s=await setup(),requests:{path:string;method:string;body:any}[]=[];let deleted=false;
 const options:OpportunityAttachmentHttpOptions={baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'test',secret:'test',integrationCode:'test',principals:s.store,requestBudget:new FixtureUnlimitedRequestBudget(),writesEnabled:true,publishInternalLabel:'Internal',applicationOperations:{tenantId:s.p.tenantId,operations:['OpportunityAttachments.query','OpportunityAttachments.get','OpportunityAttachments.create','OpportunityAttachments.delete','OpportunityAttachments.fields']},fetch:async(url,init)=>{
  const path=new URL(String(url)).pathname.split('/v1.0/')[1]!,method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;requests.push({path,method,body});
  if(method==='DELETE'){deleted=true;return new Response('{}');}
  if(path.endsWith('/fields'))return Response.json({fields:[{name:'publish',isPickList:true,picklistValues:[{value:'1',label:'Internal',isActive:true}]}]});
  if(path.endsWith('/query'))return Response.json({items:[s.port.records[0]],pageDetails:{nextPageUrl:null}});
  if(method==='POST')return Response.json({itemId:9001});
  return deleted?new Response('{}',{status:404}):Response.json({item:s.port.records[0]});
 }};
 const port=new HttpOpportunityAttachmentPort(options);assert.equal(await port.resolvePublishInternal(s.p),1);await port.list(s.p,230);await port.get(s.p,230,9001);
 let checked=0;await port.create(s.p,230,{title:'test',fullPath:'test.txt',attachmentType:'FILE_ATTACHMENT',publish:1,contentType:'text/plain',data:'aGVsbG8='},async()=>{checked++;});await port.delete(s.p,230,9001,async()=>{checked++;});assert.equal(checked,2);
 assert(requests.some(r=>r.path==='Opportunities/230/Attachments'&&r.method==='POST'));assert(requests.some(r=>r.path==='Opportunities/230/Attachments/9001'&&r.method==='DELETE'));assert.equal(requests.find(r=>r.path.endsWith('/query'))!.body.filter[0].field,'opportunityID');
 await assert.rejects(new HttpOpportunityAttachmentPort({...options,writesEnabled:false}).create(s.p,230,{title:'test',fullPath:'test.txt',attachmentType:'FILE_ATTACHMENT',publish:1,contentType:'text/plain',data:'aGVsbG8='},async()=>{}));
});

test('runtime exposes opportunity tools and validates outputs, recovery, permissions and switches',async()=>{
 const base=createFixtureSystem(),old=base.principals[0]!;
 const p=await base.controlStore.saveMember(old,{...old,mappingVersion:old.mappingVersion+1,capabilities:[...new Set([...old.capabilities,'finance.read','sales.write'] as Principal['capabilities'])]},old.mappingVersion,new Date().toISOString());
 const root=await mkdtemp(join(resolve('work'),'opportunity-runtime-'));roots.push(root);
 const resolveOpportunity=async(principal:Principal,id:number)=>{await reauthorize(principal,base.store);if(id!==230)throw new AppError('not_found_or_inaccessible','Missing opportunity');return{id:230,companyID:10};};
 const artifacts=new ArtifactService(base.core,{projectRoot:root,encryptionKey:randomBytes(32),resolveOpportunity});
 const port=new FixtureOpportunityAttachmentPort(base.store,[]),service=new OpportunityAttachmentService(base.core,port,artifacts,new IntentCipher(randomBytes(32)),{resolveOpportunity,publishInternal:1,byteBudget:new FixtureUnlimitedAttachmentByteBudget()});
 const runtime=new ToolRuntime({...base,playbooks:new PlaybookService(base.store),artifacts,opportunityAttachments:service});
 const names=(await runtime.available(p)).map(t=>t.name);assert.equal(names.filter(n=>n.startsWith('opportunity_attachment_')||n==='opportunity_file_stage').length,7);
 const staged=await runtime.invoke(p,'opportunity_file_stage',{opportunity_id:230,filename:'runtime.txt',mime:'text/plain',content_base64:'aGVsbG8='}) as any;
 const uploaded=await runtime.invoke(p,'opportunity_attachment_upload',{opportunity_id:230,artifact_id:staged.data.artifact_id,title:'runtime upload',request_key:'runtime-opp-upload'}) as any;assert.equal(uploaded.status,'succeeded_verified');
 assert.equal((await runtime.invoke(p,'at_operation_status',{operation_id:uploaded.operation_id}) as any).status,'succeeded_verified');
 for(const name of ['opportunity_attachment_list','opportunity_attachment_get','opportunity_attachment_download'])await runtime.invoke(p,name,name.endsWith('_list')?{opportunity_id:230}:{opportunity_id:230,attachment_id:uploaded.data.attachment_id});
 await base.control.setControls(p,{writePaused:false,tools:{opportunity_attachment_upload:false}},0);
 assert(!(await runtime.available(p)).some(t=>t.name==='opportunity_attachment_upload'));
 await assert.rejects(runtime.invoke(p,'opportunity_attachment_upload',{opportunity_id:230,artifact_id:staged.data.artifact_id,title:'blocked',request_key:'blocked-opp-upload'}));
 assert.equal(port.calls.filter(c=>c.method==='create').length,1);
 assert(!(await runtime.available(base.principals[1]!)).some(t=>t.name==='opportunity_attachment_list'));
});
test('closed opportunity attachment uploads directly without changing parent status',async()=>{const s=await setup();s.parents[0]!.status=3;const staged=await s.stage();const r=await s.service.upload(s.p,{opportunity_id:230,artifact_id:staged.data.artifact_id,title:'Closed opportunity file',request_key:'closed-opportunity-attachment'});assert.equal(r.status,'succeeded_verified');assert.equal(s.parents[0]!.status,3);assert.equal(s.port.calls.filter(c=>c.method==='create').length,1);});

test('opportunity uploads preserve original CSV filename, MIME and bytes',async()=>{
 const s=await setup(),bytes=Buffer.from('\ufeffname,value\r\nA,=SUM(1)\r\n');
 const staged=await s.artifacts.stageOpportunityUpload(s.p,{opportunity_id:230,filename:'original.csv',mime:'text/plain',content_base64:bytes.toString('base64')});
 const result=await s.service.upload(s.p,{opportunity_id:230,artifact_id:staged.data.artifact_id,title:'Original CSV',request_key:'csv-original-upload'});
 assert.equal(result.status,'succeeded_verified');const row=s.port.records.find(r=>r.id===result.data.attachment_id)!;
 assert.equal(row.fullPath,'original.csv');assert.equal(row.contentType,'text/csv');assert.equal(row.data,bytes.toString('base64'));
});
