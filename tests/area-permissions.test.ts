import test from 'node:test';
import assert from 'node:assert/strict';
import { type AreaPermission, type Principal, permissionAreas } from '../packages/contracts/src/index.js';
import { assertArea, assertOperationArea, compatibilityCapabilities, legacyAreaPermissions, validAreaPermissions } from '../packages/policy/src/areas.js';
import { projectRecord, reauthorize } from '../packages/policy/src/index.js';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { operationCatalog } from '../apps/server/src/tool-runtime.js';
import { fixturePrincipals } from '../packages/workflows/src/fixtures.js';

const scoped = (grants: AreaPermission[]): Principal => ({...fixturePrincipals()[0]!,areaPermissions:grants,capabilities:compatibilityCapabilities(grants,[])});
const denied = (error: unknown) => Boolean(error && typeof error==='object' && 'code' in error && ['forbidden','identity_mapping_invalid'].includes(String(error.code)));

test('each area is independent and write never follows from read or internal compatibility flags',()=>{
  for(const area of permissionAreas){
    const p=scoped([`${area}.read`]);assert.doesNotThrow(()=>assertArea(p,area));assert.throws(()=>assertArea(p,area,true),denied);
    for(const other of permissionAreas.filter(a=>a!==area))assert.throws(()=>assertArea(p,other),denied);
    const writer=scoped([`${area}.read`,`${area}.write`]);assert.doesNotThrow(()=>assertArea(writer,area,true));
  }
  const p=scoped(['projects.read','projects.write']);assert.ok(p.capabilities.includes('finance.write'));
  assert.throws(()=>assertOperationArea(p,'invoice_get',false),denied);
  assert.throws(()=>assertOperationArea(p,'contract_create',true),denied);
  assert.doesNotThrow(()=>assertOperationArea(p,'project_create',true));
});

test('sales, finance, purchasing and inventory cannot authorize one another',()=>{
  for(const [grant,allowed,blocked] of [
    ['sales.read','quote_get','invoice_get'],['finance.read','invoice_get','opportunity_get'],
    ['purchasing.read','purchase_order_get','inventory_item_get'],['inventory.read','inventory_item_get','purchase_order_get'],
  ] as const){const p=scoped([grant]);assert.doesNotThrow(()=>assertOperationArea(p,allowed,false));assert.throws(()=>assertOperationArea(p,blocked,false),denied);}
});

test('every configured MCP operation has an explicit area or reviewed shared classification',()=>{
  const p=scoped(permissionAreas.flatMap(area=>[`${area}.read`,`${area}.write`] as AreaPermission[]));
  for(const [name,definition] of Object.entries(operationCatalog))assert.doesNotThrow(()=>assertOperationArea(p,name,definition.write),name);
  assert.throws(()=>assertOperationArea(p,'future_unclassified_tool',false),denied);
});

test('protected ticket financial fields require Finance even when Sales sets internal flags',()=>{
  const p=scoped(['tickets.read','sales.read']);assert.ok(p.capabilities.includes('finance.read'));
  const row={id:1001,title:'Ticket',estimatedLaborRevenue:500};
  assert.equal(projectRecord('Tickets',row,p).estimatedLaborRevenue,undefined);
  assert.throws(()=>projectRecord('Tickets',row,p,['estimatedLaborRevenue']),denied);
  assert.equal(projectRecord('Tickets',row,scoped(['tickets.read','finance.read'])).estimatedLaborRevenue,500);
});

test('invalid grants fail closed and changing only area grants revokes an in-flight principal',async()=>{
  assert.equal(validAreaPermissions(['sales.write']),false);assert.equal(validAreaPermissions(['unknown.read']),false);assert.equal(validAreaPermissions(['sales.read','sales.read']),false);
  const p=scoped(['sales.read']),changed={...p,areaPermissions:['finance.read'] as AreaPermission[]};
  await assert.rejects(reauthorize(p,{get:async()=>changed}),denied);
});

test('legacy access is preserved until explicitly converted and has an honest editor preview',()=>{
  const p=fixturePrincipals()[0]!;assert.doesNotThrow(()=>assertArea(p,'sales'));
  const preview=legacyAreaPermissions(['operational.read','finance.read','projects.write']);
  assert.ok(preview.includes('sales.read'));assert.ok(preview.includes('projects.read'));assert.ok(!preview.includes('projects.write'));
});

test('admin saves explicit grants, hides denied tools, and blocks generic access before data fetch',async()=>{
  const system=createFixtureSystem();const original=system.tokens[0]!.principal;
  const p=await system.control.saveMember(original,{objectId:original.objectId,resourceId:original.resourceId,active:true,companyIds:original.companyIds,capabilities:[],areaPermissions:['tickets.read']},original.mappingVersion);
  const names=(await system.runtime.available(p)).map(t=>t.name);assert.ok(names.includes('ticket_search'));assert.ok(!names.includes('ticket_update'));assert.ok(!names.includes('time_log_ticket'));
  const adapter=system.core.adapter as {calls?:unknown[]};const before=adapter.calls?.length;
  await assert.rejects(system.runtime.invoke(p,'at_get',{entity:'Companies',id:10}),denied);
  await assert.rejects(system.runtime.invoke(p,'at_query',{entity:'TimeEntries',ticket_id:1001}),denied);
  await assert.rejects(system.runtime.invoke(p,'at_related',{parent:{entity:'Tickets',id:1001},relation:'time'}),denied);
  await assert.rejects(system.runtime.invoke(p,'at_artifact_export',{ticket:{kind:'id',id:1001},collection:'own_time'}),denied);
  assert.equal(adapter.calls?.length,before);
  await system.runtime.invoke(p,'ticket_search',{});
  await assert.rejects(system.control.saveMember(original,{objectId:p.objectId,resourceId:p.resourceId,active:true,companyIds:p.companyIds,capabilities:['operational.read']},p.mappingVersion),deniedOrInput);
});
function deniedOrInput(error:unknown){return denied(error)||Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='invalid_input');}

test('business and sales services deny other areas before upstream IO and allow their own metadata',async()=>{
  const {BusinessService}=await import('../packages/business/src/index.js');
  const {SalesService}=await import('../packages/sales/src/index.js');
  const {IntentCipher,MemoryJournal,MemoryPrincipalStore}=await import('../packages/storage/src/index.js');
  const {FixtureUnlimitedRequestBudget}=await import('../packages/autotask/src/budget.js');
  const {FixtureAutotaskAdapter}=await import('../packages/workflows/src/fixtures.js');
  const {TicketWorkflows}=await import('../packages/workflows/src/index.js');
  const p=scoped(['projects.read']),store=new MemoryPrincipalStore([p]);
  const core=new TicketWorkflows(new FixtureAutotaskAdapter(q=>reauthorize(q,store)),store,new MemoryJournal());
  let calls=0;const options={tenantId:p.tenantId,baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'fixture',secret:'fixture',integrationCode:'fixture',writesEnabled:true,requestBudget:new FixtureUnlimitedRequestBudget(),fetch:(async()=>{calls++;return new Response(JSON.stringify({fields:[{name:'id',dataType:'integer',isReadOnly:true,isRequired:false,isQueryable:true}]}),{headers:{'Content-Type':'application/json'}});}) as typeof fetch};
  const business=new BusinessService(core,new IntentCipher(Buffer.alloc(32,7)),options),sales=new SalesService(core,new IntentCipher(Buffer.alloc(32,7)),options);
  await assert.rejects(business.schema(p,{entity:'Invoices'}),denied);
  await assert.rejects(business.schema(p,{entity:'PurchaseOrders'}),denied);
  await assert.rejects(sales.schema(p,{entity:'Opportunities'}),denied);
  assert.equal(calls,0);await business.schema(p,{entity:'Projects'});assert.equal(calls,1);
});

test('Postgres persists explicit user and template grants, including an empty deny-all policy',async()=>{
  const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');
  const {PostgresControlPlaneStore}=await import('../packages/control-plane/src/index.js');const db=new PGlite();
  try{
    for(const name of ['001_foundation','002_workflow_intents','003_control_plane'])await db.exec(await readFile(`packages/storage/migrations/${name}.sql`,'utf8'));
    const store=new PostgresControlPlaneStore(db),p=scoped(['sales.read']),at=new Date().toISOString();
    await store.saveMember(p,p,0,at);assert.deepEqual((await store.getMember(p))?.areaPermissions,['sales.read']);
    await store.saveTemplate(p,{tenantId:p.tenantId,key:'deny-all',version:1,capabilities:[],companyIds:[10],areaPermissions:[]},0,at);
    assert.deepEqual((await store.listTemplates(p.tenantId))[0]?.areaPermissions,[]);
  }finally{await db.close();}
});

test('queue and validation dispatch cannot bypass area write denial',async()=>{
  const system=createFixtureSystem(),owner=system.tokens[0]!.principal;
  const p=await system.control.saveMember(owner,{objectId:owner.objectId,resourceId:owner.resourceId,active:true,companyIds:owner.companyIds,capabilities:[],areaPermissions:['tickets.read']},owner.mappingVersion);
  const args={operation:'ticket_note_add',arguments:{ticket:{kind:'id',id:1001},note:{title:'Example',text:'Example',audience:'internal'}}};
  await assert.rejects(system.runtime.validate(p,args),denied);
  await assert.rejects(system.runtime.enqueue(p,{...args,request_key:'area-denial-job'}),denied);
  assert.equal(system.adapter.calls.length,0);
});

test('expanded ticket context with Sales access still withholds Finance fields',async()=>{
  const system=createFixtureSystem(),owner=system.tokens[0]!.principal;
  const p=await system.control.saveMember(owner,{objectId:owner.objectId,resourceId:owner.resourceId,active:true,companyIds:owner.companyIds,capabilities:[],areaPermissions:['tickets.read','sales.read']},owner.mappingVersion);
  system.adapter.records.Tickets[0]!.estimatedLaborRevenue=987654;
  const response=await system.runtime.invoke(p,'ticket_context',{ticket:{kind:'id',id:system.adapter.records.Tickets[0]!.id},purpose:'custom',collections:['notes']});
  assert.equal(JSON.stringify(response).includes('987654'),false);
});

test('a scoped ticket writer can save a note without granting Sales or Finance',async()=>{
  const system=createFixtureSystem(),owner=system.tokens[0]!.principal;
  const p=await system.control.saveMember(owner,{objectId:owner.objectId,resourceId:owner.resourceId,active:true,companyIds:owner.companyIds,capabilities:[],areaPermissions:['tickets.read','tickets.write']},owner.mappingVersion);
  const result=await system.runtime.invoke(p,'ticket_note_add',{ticket:{kind:'id',id:system.adapter.records.Tickets[0]!.id},note:{title:'Work completed',text:'Reviewed the requested configuration.',audience:'internal'},request_key:'area-writer-success'}) as {status:string};
  assert.equal(result.status,'succeeded_verified');assert.ok(!p.areaPermissions?.includes('finance.read'));assert.ok(!p.areaPermissions?.includes('sales.read'));
});

test('project financial fields cannot be read, inferred through expected values, or changed without Finance',async()=>{
  const {BusinessService}=await import('../packages/business/src/index.js');
  const {IntentCipher,MemoryJournal,MemoryPrincipalStore}=await import('../packages/storage/src/index.js');
  const {FixtureUnlimitedRequestBudget}=await import('../packages/autotask/src/budget.js');
  const {FixtureAutotaskAdapter}=await import('../packages/workflows/src/fixtures.js');
  const {TicketWorkflows}=await import('../packages/workflows/src/index.js');
  const p=scoped(['projects.read','projects.write']),store=new MemoryPrincipalStore([p]);
  const core=new TicketWorkflows(new FixtureAutotaskAdapter(q=>reauthorize(q,store)),store,new MemoryJournal());let calls=0;
  const service=new BusinessService(core,new IntentCipher(Buffer.alloc(32,7)),{tenantId:p.tenantId,baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'fixture',secret:'fixture',integrationCode:'fixture',writesEnabled:true,requestBudget:new FixtureUnlimitedRequestBudget(),fetch:(async(url)=>{calls++;if(String(url).endsWith('/entityInformation/fields'))return new Response(JSON.stringify({fields:['projectName','laborEstimatedRevenue','projectCostsBudget'].map(name=>({name,dataType:name==='projectName'?'string':'decimal',isReadOnly:false}))}),{headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({item:{id:123,companyID:10,projectName:'Example',laborEstimatedRevenue:900,projectCostsBudget:800}}),{headers:{'Content-Type':'application/json'}});}) as typeof fetch});
  await assert.rejects(service.write(p,'Projects','create',{fields:{companyID:10,projectCostsBudget:100},request_key:'protected-create'}),denied);
  await assert.rejects(service.write(p,'Projects','update',{id:123,fields:{projectName:'Changed'},expected:{projectName:'Example',projectCostsBudget:800},request_key:'protected-expected'}),denied);
  assert.equal(calls,0);const result=await service.get(p,'Projects',{id:123});assert.equal(result.data.projectName,'Example');assert.equal(result.data.laborEstimatedRevenue,undefined);assert.equal(result.data.projectCostsBudget,undefined);
});

test('documentation permissions are explicit advanced grants, independent of finance and configuration',()=>{
  const grants=compatibilityCapabilities(['configuration.read','configuration.write','finance.read','finance.write'],[]);
  assert.ok(!grants.includes('documentation.read'));assert.ok(!grants.includes('documentation.write'));
  const documentation=compatibilityCapabilities([],['documentation.read']);
  assert.deepEqual(documentation,['documentation.read']);
  assert.deepEqual(compatibilityCapabilities([],['documentation.read','documentation.write']),['documentation.read','documentation.write']);
});
