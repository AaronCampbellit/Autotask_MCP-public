import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {AutotaskConfiguration} from '../packages/autotask-config/src/service.js';
import {MemoryStore,PostgresStore} from '../packages/autotask-config/src/store.js';
import {MemoryHandoff,FileHandoff} from '../packages/autotask-config/src/handoff.js';
import {fromEnvironment,environment,validate,type State} from '../packages/autotask-config/src/model.js';
import {IntentCipher} from '../packages/storage/src/intent-cipher.js';
import {SharedRequestBudget,requestBudgetOptionsFromEnvironment} from '../packages/autotask/src/budget.js';
import {ReadOnlyCollector} from '../packages/collector/src/index.js';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
const tenant='11111111-1111-4111-8111-111111111111',actor={tenantId:tenant,objectId:'22222222-2222-4222-8222-222222222222'};
const base='https://webservices1.autotask.net/atservicesrest/v1.0/';
const baseline=()=>fromEnvironment({AUTOTASK_BASE_URL:base,AUTOTASK_USERNAME:'existing@example.test',AUTOTASK_SECRET:'SECRET-CANARY',AUTOTASK_INTEGRATION_CODE:'INTEGRATION-CANARY',AUTOTASK_WEBHOOK_BINDINGS:'[]'}, {tenantId:tenant,resourceId:17,policyVersion:'control-1',baseUrl:base,verifyAllResources:false,windowMs:3600000,requestsPerWindow:100,externalHeadroom:1000,intervalMs:120000});
function setup(){let allowed=true,now=Date.now();const store=new MemoryStore(),handoff=new MemoryHandoff(),loaded={id:'original',config:baseline(),createdAt:new Date(now).toISOString()};const service=new AutotaskConfiguration(store,tenant,loaded,{handoff,reloadAvailable:true,now:()=>now,authorize:async()=>{if(!allowed)throw new Error('forbidden');}});return{service,store,handoff,loaded,revoke:()=>{allowed=false;},advance:(ms:number)=>{now+=ms;},now:()=>now};}
async function adopt(s:ReturnType<typeof setup>){await s.service.action(actor,'adopt',{version:0});}
async function draft(s:ReturnType<typeof setup>,extra:Record<string,unknown>={}){await adopt(s);await s.service.action(actor,'save',{version:1,config:{secret:'REPLACEMENT-CANARY',...extra}});}
async function tested(s:ReturnType<typeof setup>){await draft(s);await s.service.action(actor,'test',{version:2});const m=s.handoff.manifest!;s.handoff.testResult={id:m.test!.id,revision:m.test!.revision.id,ok:true,at:new Date(s.now()).toISOString()};}

test('adoption keeps exact existing settings and masks every credential in console output',async()=>{
 const s=setup();await adopt(s);assert.deepEqual((await s.store.load(tenant))!.active.config,s.loaded.config);
 const status=JSON.stringify(await s.service.status(actor));for(const secret of ['SECRET-CANARY','INTEGRATION-CANARY'])assert.ok(!status.includes(secret));
 assert.equal((await s.service.status(actor)).managed,true);await assert.rejects(s.service.action(actor,'adopt',{version:0}));assert.equal((await s.store.load(tenant))!.version,1);
});
test('draft edits never change active credentials and concurrent edits fail version checks',async()=>{
 const s=setup();await draft(s);const state=(await s.store.load(tenant))!;assert.equal(state.active.config.secret,'SECRET-CANARY');assert.equal(state.draft!.config.secret,'REPLACEMENT-CANARY');assert.equal(s.handoff.manifest!.active.config.secret,'SECRET-CANARY');
 await assert.rejects(s.service.action(actor,'save',{version:1,config:{secret:'stale'}}));assert.equal((await s.store.load(tenant))!.version,2);
});
test('account, zone, evidence bindings and native request window cannot be changed through rotation',async()=>{
 const s=setup();await adopt(s);
 for(const config of [{username:'other@example.test'},{baseUrl:'https://webservices2.autotask.net/atservicesrest/v1.0/'},{collector:{...s.loaded.config.collector,resourceId:18}},{settings:{...s.loaded.config.settings,AUTOTASK_BUDGET_WINDOW_MS:'60000'}}])await assert.rejects(s.service.action(actor,'save',{version:1,config}));
 assert.equal((await s.store.load(tenant))!.version,1);
});
test('only an authenticated fresh test of the exact draft allows activation; collector switch waits for drain',async()=>{
 const s=setup();await tested(s);await s.service.action(actor,'activate',{version:3});const state=(await s.store.load(tenant))!;
 assert.equal(state.active.config.secret,'REPLACEMENT-CANARY');assert.equal(state.previous!.config.secret,'SECRET-CANARY');assert.equal(s.handoff.manifest!.active.id,'original');assert.equal((await s.service.status(actor)).reloadPending,true);
 await s.service.synchronize();assert.equal(s.handoff.manifest!.active.id,state.active.id);assert.equal(await s.service.collectorReady(),false);s.handoff.ack={revision:state.active.id,at:new Date(s.now()).toISOString()};assert.equal(await s.service.collectorReady(),true);
});
test('failed, expired and mismatched tests cannot activate or silently fall back',async()=>{
 const s=setup();await tested(s);
 for(const replacement of [{ok:false},{at:'invalid'},{revision:'another-draft'},{at:new Date(s.now()-300001).toISOString()},{at:new Date(s.now()+1000).toISOString()}]){const good=s.handoff.testResult!;s.handoff.testResult={...good,...replacement};await assert.rejects(s.service.action(actor,'activate',{version:3}));s.handoff.testResult=good;}
 assert.equal((await s.store.load(tenant))!.active.id,'original');
});
test('failed reload restores prior revision and retains failed settings as a draft',async()=>{
 const s=setup();await tested(s);await s.service.action(actor,'activate',{version:3});await s.service.rollbackFailedActivation();const result=(await s.store.load(tenant))!;
 assert.equal(result.active.id,'original');assert.equal(result.draft!.config.secret,'REPLACEMENT-CANARY');assert.equal(result.activationError,true);assert.equal(s.handoff.manifest!.active.id,'original');
});
test('administration revocation and cross-tenant access prevent all configuration reads and writes',async()=>{
 const s=setup();await adopt(s);await assert.rejects(s.service.status({...actor,tenantId:'foreign'}));s.revoke();await assert.rejects(s.service.status(actor));await assert.rejects(s.service.action(actor,'save',{version:1,config:{secret:'x'}}));assert.equal((await s.store.load(tenant))!.version,1);
});
test('editing a tested draft invalidates previous test and preserves omitted credentials',async()=>{
 const s=setup();await tested(s);await s.service.action(actor,'save',{version:3,config:{settings:{...s.loaded.config.settings,WORKSPACE_TIMEZONE:'America/Chicago'}}});const row=(await s.store.load(tenant))!;assert.equal(row.test,undefined);assert.equal(row.draft!.config.secret,'REPLACEMENT-CANARY');assert.equal(row.draft!.config.webhookBindings,'[]');await assert.rejects(s.service.action(actor,'activate',{version:4}));
});
test('strict settings validation rejects unknown fields, invalid flags, timezones and allowance mismatches',()=>{
 for(const change of [{SALES_ENABLED:'yes'},{SALES_WRITES_ENABLED:'true'},{WORKSPACE_TIMEZONE:'wrong/timezone'},{RESOURCE_TIMEZONES:'[]'},{AUTOTASK_TICKET_HOSTS:'https://bad.example'}])assert.throws(()=>validate({...baseline(),settings:{...baseline().settings,...change}},tenant));
 const c=baseline();assert.equal(environment({PUBLIC_URL:'https://unchanged.example'},c).PUBLIC_URL,'https://unchanged.example');assert.equal(environment({},c).AUTOTASK_SECRET,'SECRET-CANARY');
});
test('Postgres config is encrypted, optimistic writes are atomic, audit contains no secrets',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY)');await db.exec(await readFile('packages/storage/migrations/015_autotask_connections.sql','utf8'));
 const store=new PostgresStore(db,new IntentCipher(Buffer.alloc(32,4))),state:State={version:1,active:{id:'original',config:baseline(),createdAt:new Date().toISOString()}};
 await store.save(tenant,'admin',state,0,'connection.adopted');assert.deepEqual(await store.load(tenant),state);
 const bytes=JSON.stringify((await db.query('SELECT * FROM autotask_connections')).rows);assert.ok(!bytes.includes('CANARY'));await assert.rejects(store.save(tenant,'admin',{...state,version:2},0,'stale'));assert.equal((await store.events(tenant)).length,1);
 await store.save(tenant,'admin',{...state,version:2},1,'draft.saved');assert.equal((await store.load(tenant))!.version,2);
 await assert.rejects(store.save('missing','admin',{...state,version:3},2,'missing'));assert.equal(await store.load('missing'),undefined);
 assert.ok(!JSON.stringify(await store.events(tenant)).includes('CANARY'));
});
test('collector handoff uses its own key and tenant binding; secrets never appear in shared JSON',async t=>{
 const root=await mkdtemp(join(tmpdir(),'at-config-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'metadata'));
 const handoff=new FileHandoff(join(root,'handoff'),join(root,'metadata'),tenant),s=setup();await handoff.publish({tenant,active:s.loaded});
 assert.ok(!(await readFile(join(root,'handoff','connection.json'),'utf8')).includes('CANARY'));assert.deepEqual((await handoff.read()).active,s.loaded);
 await handoff.report('connection-test.json',{id:'test',revision:'original',ok:true,at:new Date().toISOString()});assert.equal((await handoff.result())!.ok,true);
 await assert.rejects(new FileHandoff(join(root,'handoff'),join(root,'metadata'),'foreign').read());
});
test('configuration reload carries charged requests instead of resetting local allowance',async()=>{
 const now=Date.now(),opts={tenantId:tenant,windowMs:3600000,requestsPerWindow:2,reservedExternalHeadroom:100,observationMaxAgeMs:240000,clock:()=>now};const old=new SharedRequestBudget(opts),next=new SharedRequestBudget({...opts,requestsPerWindow:1});const observation={tenantId:tenant,source:'ThresholdInformation',observedAt:new Date(now).toISOString(),expiresAt:new Date(now+200000).toISOString(),windowMs:3600000,limit:10000,used:0,evidenceReference:'test'};
 old.updateObservation(observation);await old.take({tenantId:tenant,actorKey:`${tenant}:admin`});next.importUsage(old.exportUsage());next.updateObservation(observation);await assert.rejects(next.take({tenantId:tenant,actorKey:`${tenant}:admin`}));old.close();next.close();
});
test('credential probe is read-only, uses persisted collector budget, and writes no metadata evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'at-probe-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'config/metadata'),{recursive:true});const calls:string[]=[];
 const collector=new ReadOnlyCollector(baseline().collector,{root,directory:'config/metadata',credentials:{username:'existing@example.test',secret:'candidate',integrationCode:'code'},fetch:async(url,init)=>{assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Secret'),'candidate');calls.push(String(url));return String(url).includes('ThresholdInformation')?Response.json({externalRequestThreshold:10000,requestThresholdTimeframe:60,currentTimeframeRequestCount:0}):Response.json({items:[{id:17,isActive:true}]});}});
 await collector.probe();assert.equal(calls.length,2);assert.equal(JSON.parse(await readFile(join(root,'config/metadata/attempts.json'),'utf8')).attempts.length,2);await assert.rejects(readFile(join(root,'config/metadata/snapshot.json')));
});
test('console settings routes require session, CSRF and administrator authorization',async t=>{
 const system=createFixtureSystem();t.after(()=>system.app.close());const origin='http://127.0.0.1:3030';
 assert.equal((await system.app.fetch(new Request(`${origin}/admin/api/autotask/status`))).status,401);
 const login=await system.app.fetch(new Request(`${origin}/admin/auth/fixture`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:system.tokens[0]!.token})}));const {csrf}=await login.json(),cookie=login.headers.get('set-cookie')!.split(';')[0]!;
 const status=await system.app.fetch(new Request(`${origin}/admin/api/autotask/status`,{headers:{cookie}}));assert.equal(status.status,200);assert.ok(!(await status.text()).includes('fixture-secret'));
 const request=(csrfValue:string)=>new Request(`${origin}/admin/api/autotask/adopt`,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrfValue,'content-type':'application/json'},body:JSON.stringify({version:0})});assert.equal((await system.app.fetch(request('wrong'))).status,403);assert.equal((await system.app.fetch(request(csrf))).status,200);
});

test('parallel console module imports do not exhaust authenticated administration admission',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const files=['admin.js','admin.css','autotask.js','rmm.js','access-model.js','console-language.js','result-dialog.js'];
 const responses=await Promise.all(files.map(file=>s.app.fetch(new Request(`http://127.0.0.1:3030/admin/${file}`))));assert.deepEqual(responses.map(r=>r.status),files.map(()=>200));
});

test('configuration drain waits for accepted work and nested operations while rejecting new work',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>{release=r;}),begun=new Promise<void>(r=>{started=r;});
 const accepted=s.execution.run(p,['at_whoami'],async()=>{started();await gate;return s.execution.run(p,['at_whoami'],async()=>42);});
 await begun;let drained=false;const draining=s.execution.drain().then(()=>{drained=true;});
 await assert.rejects(s.execution.run(p,['at_whoami'],async()=>0));assert.equal(drained,false);release();assert.equal(await accepted,42);await draining;assert.equal(drained,true);
 s.execution.resume();assert.equal(await s.execution.run(p,['at_whoami'],async()=>7),7);
});


test('adoption and draft edits preserve the deployed 10000/hour budget without copying deployment paths',async()=>{
 const s=setup();Object.assign(s.loaded.config.settings,{AUTOTASK_REQUESTS_PER_WINDOW:'10000',AUTOTASK_BUDGET_WINDOW_MS:'3600000',AUTOTASK_EXTERNAL_HEADROOM:'0',AUTOTASK_THRESHOLD_MAX_AGE_MS:'120000',AUTOTASK_BUDGET_MAX_WAIT_MS:'1000',AUTOTASK_BUDGET_QUEUE_SIZE:'100'});
 const original=structuredClone(s.loaded.config);await adopt(s);assert.deepEqual((await s.store.load(tenant))!.active.config,original);
 await s.service.action(actor,'save',{version:1,config:{secret:'ROTATED-CANARY'}});const draft=(await s.store.load(tenant))!.draft!.config;assert.deepEqual(draft.settings,original.settings);assert.deepEqual(draft.collector,original.collector);
 assert(!('AUTOTASK_THRESHOLD_PATH' in draft.settings));
 assert.throws(()=>requestBudgetOptionsFromEnvironment(environment({},draft),tenant),/reviewed local threshold capture/);
 const options=requestBudgetOptionsFromEnvironment(environment({AUTOTASK_THRESHOLD_PATH:'/deployment/threshold.json'},draft),tenant);assert.equal(options!.requestsPerWindow,10000);assert.equal(options!.reservedExternalHeadroom,0);
 for(const patch of [{AUTOTASK_REQUESTS_PER_WINDOW:''},{AUTOTASK_REQUESTS_PER_WINDOW:'invalid'},{AUTOTASK_THRESHOLD_MAX_AGE_MS:'999999'}])assert.throws(()=>validate({...draft,settings:{...draft.settings,...patch}},tenant));
 assert.throws(()=>validate({...draft,collector:{...draft.collector!,windowMs:60000}},tenant),/window/);
});
