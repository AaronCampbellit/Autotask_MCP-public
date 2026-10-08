import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import type { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { createLiveSystem } from '../apps/server/src/live-system.js';
import { AppError, actorKey } from '../packages/contracts/src/index.js';
import { fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { REQUIRED_MIGRATIONS } from '../scripts/preflight.js';

const origin='https://mcp.example.test';
const env=():NodeJS.ProcessEnv=>({PUBLIC_URL:origin,ENTRA_TENANT_ID:'11111111-1111-4111-8111-111111111111',ENTRA_AUDIENCE:'api://22222222-2222-4222-8222-222222222222',ENTRA_SCOPE:'mcp.access',AUTOTASK_BASE_URL:'https://webservices1.autotask.net/atservicesrest/v1.0/',AUTOTASK_USERNAME:'fake-api-user@example.test',AUTOTASK_SECRET:'LIVE-FACTORY-SECRET-CANARY',AUTOTASK_INTEGRATION_CODE:'fake-integration-code',CURSOR_SECRET:'fake-cursor-012345678901234567890123456789',OPERATION_PAYLOAD_KEY:Buffer.alloc(32,11).toString('base64'),ARTIFACT_ENCRYPTION_KEY:Buffer.alloc(32,12).toString('base64')});
async function database(t:TestContext,count:number=REQUIRED_MIGRATIONS.length){const db=new PGlite();for(const name of REQUIRED_MIGRATIONS.slice(0,count))await db.exec(await readFile(`packages/storage/migrations/${name}`,'utf8'));t.after(()=>db.close());return db;}
function blockNetwork(t:TestContext){const calls:string[]=[];t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{calls.push(String(input));throw new Error('Unexpected network call during offline factory verification.');});return calls;}
async function system(t:TestContext,db:PGlite,configuration=env()){const live=await createLiveSystem(db as unknown as Pool,configuration);t.after(async()=>{await live.worker.close();await live.app.close();if('close'in live.requestBudget)live.requestBudget.close();});return live;}
const get=(live:Awaited<ReturnType<typeof createLiveSystem>>,path:string)=>live.app.fetch(new Request(`${origin}${path}`));

test('actual live factory exposes health, discovery and protected console routes without contacting Entra or Autotask',async t=>{
  const db=await database(t),calls=blockNetwork(t),live=await system(t,db);
  assert.deepEqual(live.qualifications,[]);assert.equal(live.runtime.options.core.adapter.source,'Autotask');assert.equal(live.control.store.backend,'postgres');assert.equal(live.requestBudget.status().blocked,'not_configured');
  for(const name of ['live','ready']){const response=await get(live,`/health/${name}`);assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:name});}
  const metadata=await(await get(live,'/.well-known/oauth-protected-resource/mcp')).json();assert.equal(metadata.resource,`${origin}/mcp`);assert.deepEqual(metadata.authorization_servers,[`https://login.microsoftonline.com/${env().ENTRA_TENANT_ID}/v2.0`]);assert.deepEqual(metadata.scopes_supported,[`${origin}/mcp/mcp.access`]);
  for(const path of ['/admin','/admin/admin.js','/admin/admin.css']){const response=await get(live,path);assert.equal(response.status,200);assert.ok((await response.text()).length>0);}
  assert.deepEqual(await(await get(live,'/admin/auth/config')).json(),{mode:'unavailable'});assert.equal((await get(live,'/admin/login')).status,503);assert.equal((await get(live,'/admin/api/snapshot')).status,401);
  const rejected=await live.app.fetch(new Request(`${origin}/mcp`,{method:'POST'}));assert.equal(rejected.status,401);assert.match(rejected.headers.get('www-authenticate')!,/oauth-protected-resource/);
  assert.equal((await get(live,'/mcp')).status,405);assert.equal((await get(live,'/unknown')).status,404);assert.equal((await live.app.fetch(new Request('https://foreign.example.test/health/live'))).status,403);
  const worker=await live.worker.tick();assert.equal(worker,false);assert.deepEqual(calls,[]);
});

test('zero-qualification live factory denies known tools before any upstream request while local identity still works',async t=>{
  const db=await database(t),p=fixturePrincipals()[0]!;
  // Local SQL fixture simulates an externally verified mapping; it grants no operation qualification.
  await db.query('INSERT INTO identity_mappings (tenant_id,object_id,resource_id,mapping_version,policy_version,active,resource_verified_at,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[p.tenantId,p.objectId,p.resourceId,p.mappingVersion,p.policyVersion,p.active,p.resourceVerifiedAt,JSON.stringify({capabilities:p.capabilities,companyIds:p.companyIds})]);
  const calls=blockNetwork(t),live=await system(t,db);const me=await live.runtime.invoke(p,'at_whoami',{}) as any;assert.equal(me.data.resource_id,p.resourceId);
  for(const [name,args] of [['ticket_search',{}],['at_reference_resolve',{kind:'queue',reference:{kind:'id',id:501}}],['ticket_requirements',{ticket:{kind:'id',id:1001}}],['schedule_search',{start:'2026-09-10T08:00:00-05:00',end:'2026-09-10T17:00:00-05:00',timezone:'America/Chicago'}]] as const){await assert.rejects(live.runtime.invoke(p,name,args),error=>error instanceof AppError&&error.code==='impersonation_not_qualified');}
  assert.equal((await db.query('SELECT id FROM operation_journal')).rows.length,0);assert.equal(live.requestBudget.status().admitted,0);assert.deepEqual(calls,[]);
});

test('live readiness requires the complete ordered migration set',async t=>{
  const db=await database(t,4),calls=blockNetwork(t),live=await system(t,db);const incomplete=await get(live,'/health/ready');assert.equal(incomplete.status,503);assert.deepEqual(await incomplete.json(),{status:'unavailable'});
  for(const [index,name]of REQUIRED_MIGRATIONS.slice(4).entries()){await db.exec(await readFile(`packages/storage/migrations/${name}`,'utf8'));assert.equal((await get(live,'/health/ready')).status,index===REQUIRED_MIGRATIONS.length-5?200:503,name);}assert.deepEqual(calls,[]);
});

test('configured Entra console builds its fixed authorization URL and rejects invalid callbacks without token exchange',async t=>{
  const db=await database(t),calls=blockNetwork(t),configuration:NodeJS.ProcessEnv={...env(),ADMIN_ENTRA_CLIENT_ID:'33333333-3333-4333-8333-333333333333',ADMIN_ENTRA_CLIENT_SECRET:'ADMIN-SECRET-CANARY'},live=await system(t,db,configuration);
  assert.deepEqual(await(await get(live,'/admin/auth/config')).json(),{mode:'entra'});const response=await get(live,'/admin/login');assert.equal(response.status,302);const url=new URL(response.headers.get('location')!);assert.equal(url.origin,'https://login.microsoftonline.com');assert.equal(url.pathname,`/${configuration.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`);assert.equal(url.searchParams.get('client_id'),configuration.ADMIN_ENTRA_CLIENT_ID);assert.equal(url.searchParams.get('redirect_uri'),`${origin}/admin/callback`);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('client_secret'),null);assert.match(response.headers.get('set-cookie')!,/__Host-rarity-login=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal((await get(live,'/admin/callback?code=fake-code&state=invalid')).status,401);assert.deepEqual(calls,[]);
});

test('live bootstrap can record an inactive mapping but cannot invent a verified active employee',async t=>{
  const db=await database(t),p=fixturePrincipals()[0]!,calls=blockNetwork(t),live=await system(t,db,{...env(),ADMIN_BOOTSTRAP_IDENTITIES:actorKey(p)});
  const member={objectId:p.objectId,resourceId:p.resourceId,active:false,capabilities:p.capabilities,companyIds:p.companyIds};const saved=await live.control.saveMember(p,member,0);assert.equal(saved.active,false);assert.equal(saved.resourceVerifiedAt,'1970-01-01T00:00:00.000Z');
  await assert.rejects(live.control.saveMember(p,{...member,active:true},1),error=>error instanceof AppError&&error.code==='identity_validation_unavailable');assert.equal((await live.control.snapshot(p)).members[0]!.active,false);assert.deepEqual(calls,[]);
});

test('live factory rejects partial settings, shared keys and unsupported enablement without network',async t=>{
  const db=await database(t),calls=blockNetwork(t);
  const cases:NodeJS.ProcessEnv[]=[{PUBLIC_URL:'http://mcp.example.test'},{ADMIN_ENTRA_CLIENT_ID:'33333333-3333-4333-8333-333333333333'},{ADMIN_ENTRA_CLIENT_SECRET:'secret'},{ARTIFACT_ENCRYPTION_KEY:env().OPERATION_PAYLOAD_KEY},{ARTIFACT_ENCRYPTION_KEY:Buffer.alloc(31).toString('base64')},{AUTOTASK_REQUESTS_PER_WINDOW:'20'},{AUTOTASK_THRESHOLD_PATH:'work/threshold.json'},{ENABLED_AUTOTASK_OPERATIONS:'Tickets.get'},{ENABLED_AUTOTASK_OPERATIONS:'*'},{ENABLED_AUTOTASK_OPERATIONS:'Tickets.get',METADATA_SNAPSHOT_PATH:'work/nonexistent.json'}];
  for(const changes of cases)await assert.rejects(createLiveSystem(db as unknown as Pool,{...env(),...changes}));assert.deepEqual(calls,[]);
  const blank={AUTOTASK_REQUESTS_PER_WINDOW:'',AUTOTASK_BUDGET_WINDOW_MS:'',AUTOTASK_EXTERNAL_HEADROOM:'',AUTOTASK_THRESHOLD_MAX_AGE_MS:'',AUTOTASK_THRESHOLD_PATH:'',AUTOTASK_BUDGET_MAX_WAIT_MS:'',AUTOTASK_BUDGET_QUEUE_SIZE:''};const disabled=await system(t,db,{...env(),...blank});assert.equal(disabled.requestBudget.status().blocked,'not_configured');
});

test('managed adoption preserves users and overrides obsolete or absent deployment credentials on restart',async t=>{
 const db=await database(t),p=fixturePrincipals()[0]!,calls=blockNetwork(t),configuration={...env(),ADMIN_BOOTSTRAP_IDENTITIES:actorKey(p)},live=await system(t,db,configuration);
 await live.control.saveMember(p,{objectId:p.objectId,resourceId:p.resourceId,active:false,capabilities:p.capabilities,companyIds:p.companyIds},0);
 const before=(await db.query('SELECT * FROM identity_mappings')).rows;
 await live.autotaskConfiguration.action(p,'adopt',{version:0});
 const changed={...configuration,AUTOTASK_USERNAME:undefined,AUTOTASK_SECRET:undefined,AUTOTASK_INTEGRATION_CODE:undefined,AUTOTASK_BASE_URL:undefined};
 const reloaded=await system(t,db,changed);assert.equal(reloaded.autotaskConfiguration.loaded.id,live.autotaskConfiguration.loaded.id);assert.equal(reloaded.autotaskConfiguration.loaded.config.secret,env().AUTOTASK_SECRET);
 assert.deepEqual((await db.query('SELECT * FROM identity_mappings')).rows,before);assert.deepEqual(calls,[]);
 const status=JSON.stringify(await reloaded.autotaskConfiguration.status(p));assert.ok(!status.includes('LIVE-FACTORY-SECRET-CANARY'));
});

test('recovery configuration authorization uses active durable admin role without expired native resource evidence',async t=>{
 const db=await database(t),p=fixturePrincipals()[0]!,calls=blockNetwork(t);
 await db.query('INSERT INTO identity_mappings (tenant_id,object_id,resource_id,mapping_version,policy_version,active,resource_verified_at,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[p.tenantId,p.objectId,p.resourceId,p.mappingVersion,p.policyVersion,true,'2000-01-01T00:00:00.000Z',JSON.stringify({capabilities:['platform.manage'],companyIds:p.companyIds})]);
 const live=await createLiveSystem(db as unknown as Pool,{...env(),METADATA_SNAPSHOT_PATH:'/missing/expired.json',APPLICATION_SCOPED_READ_OPERATIONS:'Tickets.get'},{recoveryOnly:true});t.after(async()=>{await live.app.close();await live.worker.close();if('close'in live.requestBudget)live.requestBudget.close();});
 assert.equal((await live.autotaskConfiguration.status(p)).recoveryMode,true);await assert.rejects(live.runtime.invoke(p,'ticket_search',{}));
 await db.query('UPDATE identity_mappings SET active=false');await assert.rejects(live.autotaskConfiguration.status(p));assert.deepEqual(calls,[]);
});
