import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runPreflight, checkDeployedHealth, REQUIRED_MIGRATIONS } from '../scripts/preflight.js';
import { compileInventory } from '../packages/metadata/src/index.js';
import { fixtureMetadataSnapshot } from '../packages/metadata/src/fixtures.js';

const environment=()=>({PUBLIC_URL:'https://mcp.rarity.example',ENTRA_TENANT_ID:'11111111-1111-4111-8111-111111111111',ENTRA_AUDIENCE:'api://22222222-2222-4222-8222-222222222222',ENTRA_SCOPE:'mcp.access',DATABASE_URL:'postgresql://app:opaque-database-secret@postgres/autotask_mcp',MIGRATION_DATABASE_URL:'postgresql://migration:opaque-migration-secret@postgres/autotask_mcp',AUTOTASK_BASE_URL:'https://webservices1.autotask.net/atservicesrest/v1.0/',AUTOTASK_USERNAME:'api-user@example.test',AUTOTASK_SECRET:'OPAQUE-SECRET-CANARY',AUTOTASK_INTEGRATION_CODE:'opaque-integration-code',CURSOR_SECRET:'cursor-key-012345678901234567890123456789',OPERATION_PAYLOAD_KEY:Buffer.alloc(32,7).toString('base64'),ARTIFACT_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')});
const failed=(result:Awaited<ReturnType<typeof runPreflight>>,name:string)=>result.checks.some(c=>c.name===name&&c.status==='fail');

test('offline preflight validates local shapes/assets without network or secret output',async()=>{
  const env=environment();const result=await runPreflight(env,{nodeVersion:'v24.16.0'});assert.equal(result.ok,true);assert.equal(result.mode,'offline');assert.equal(result.network_requests,0);assert.ok(result.checks.some(c=>c.name==='live_operations'&&c.status==='warning'));for(const value of [env.AUTOTASK_SECRET,env.DATABASE_URL,env.OPERATION_PAYLOAD_KEY,env.ARTIFACT_ENCRYPTION_KEY])assert.equal(JSON.stringify(result).includes(value),false);
  assert.equal(REQUIRED_MIGRATIONS.at(-1),'019_diagnostics.sql');
});
test('invalid origin, tenant, credentials, key sizes and configuration-name mistakes fail safely',async()=>{
  for(const [field,value] of Object.entries({PUBLIC_URL:'http://mcp.example.test',ENTRA_TENANT_ID:'not-a-guid',DATABASE_URL:'postgresql://app:replace_password@postgres/database',AUTOTASK_BASE_URL:'https://webservices1.autotask.net@evil.example/atservicesrest/v1.0/',CURSOR_SECRET:'short',OPERATION_PAYLOAD_KEY:Buffer.alloc(31).toString('base64'),ARTIFACT_ENCRYPTION_KEY:'not-a-key',PORT:'65536',AUTOTASK_SECRT:'SUPER-SECRET-TYPO'})){const result=await runPreflight({...environment(),[field]:value},{checkFiles:false});assert.equal(result.ok,false,field);assert.equal(JSON.stringify(result).includes('SUPER-SECRET-TYPO'),false);}
  for(const PUBLIC_URL of ['https://user:secret@example.test','https://example.test/nested','https://mcp.example.invalid'])assert.equal((await runPreflight({...environment(),PUBLIC_URL},{checkFiles:false})).ok,false);
});
test('runtime and encryption key separation match the one-instance deployment contract',async()=>{
  for(const nodeVersion of ['v22.20.0','v24.15.9','v25.0.0'])assert.equal(failed(await runPreflight(environment(),{nodeVersion,checkFiles:false}),'node'),true);
  assert.equal(failed(await runPreflight(environment(),{nodeVersion:'v24.21.0',checkFiles:false}),'node'),false);
  assert.equal(failed(await runPreflight({...environment(),ARTIFACT_ENCRYPTION_KEY:environment().OPERATION_PAYLOAD_KEY},{checkFiles:false}),'encryption_key_separation'),true);
  assert.equal(failed(await runPreflight({...environment(),MIGRATION_DATABASE_URL:environment().DATABASE_URL},{checkFiles:false}),'database_roles'),true);
  assert.equal(failed(await runPreflight({...environment(),JOB_WORKER_ENABLED:'no'},{checkFiles:false}),'JOB_WORKER_ENABLED'),true);
});
test('admin pairing and explicit same-tenant bootstrap identities are checked without requiring bootstrap forever',async()=>{
  const optional=await runPreflight(environment(),{checkFiles:false});assert.equal(optional.ok,true);assert.ok(optional.checks.some(c=>c.name==='ADMIN_BOOTSTRAP_IDENTITIES'&&c.status==='warning'));
  assert.equal((await runPreflight({...environment(),ADMIN_ENTRA_CLIENT_ID:'22222222-2222-4222-8222-222222222222'},{checkFiles:false})).ok,false);
  const enabled={...environment(),ADMIN_ENTRA_CLIENT_ID:'22222222-2222-4222-8222-222222222222',ADMIN_ENTRA_CLIENT_SECRET:'opaque-admin-secret',ADMIN_BOOTSTRAP_IDENTITIES:'11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333'};assert.equal((await runPreflight(enabled,{checkFiles:false})).ok,true);
  assert.equal((await runPreflight({...enabled,ADMIN_BOOTSTRAP_IDENTITIES:'22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333'},{checkFiles:false})).ok,false);
});

test('budget configuration rejects partial settings and accepts an all-empty disabled Compose environment',async()=>{
  const blank={AUTOTASK_REQUESTS_PER_WINDOW:'',AUTOTASK_BUDGET_WINDOW_MS:'',AUTOTASK_EXTERNAL_HEADROOM:'',AUTOTASK_THRESHOLD_MAX_AGE_MS:'',AUTOTASK_THRESHOLD_PATH:'',AUTOTASK_BUDGET_MAX_WAIT_MS:'',AUTOTASK_BUDGET_QUEUE_SIZE:''};
  const closed=await runPreflight({...environment(),...blank},{checkFiles:false});assert.equal(closed.ok,true);assert.ok(closed.checks.some(c=>c.name==='request_budget'&&c.status==='warning'));
  for(const extra of [{AUTOTASK_REQUESTS_PER_WINDOW:'25'},{AUTOTASK_BUDGET_QUEUE_SIZE:'10'},{AUTOTASK_BUDGET_MAX_WAIT_MS:'1000'},{AUTOTASK_THRESHOLD_PATH:resolve('work/missing-threshold.json')}])assert.equal(failed(await runPreflight({...environment(),...extra},{checkFiles:false}),'request_budget'),true);
});
test('offline budget validation checks local capture freshness and hash without native requests or secret output',async()=>{
  const now=Date.now(),dir=await mkdtemp(resolve('work/preflight-budget-')),source=join(dir,'capture.json'),path=join(dir,'threshold.json');
  const bytes=Buffer.from('{"documentary_test_only":"THRESHOLD-CANARY"}');await writeFile(source,bytes);
  const manifest={schemaVersion:1,observation:{tenantId:environment().ENTRA_TENANT_ID,source:'ThresholdInformation',observedAt:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString(),windowMs:60000,limit:100,used:10,evidenceReference:'preflight-fixture-capture'},evidence:{path:relative(process.cwd(),source).split(sep).join('/'),sha256:createHash('sha256').update(bytes).digest('hex')}};
  await writeFile(path,JSON.stringify(manifest));
  const config={...environment(),AUTOTASK_REQUESTS_PER_WINDOW:'25',AUTOTASK_BUDGET_WINDOW_MS:'60000',AUTOTASK_EXTERNAL_HEADROOM:'20',AUTOTASK_THRESHOLD_MAX_AGE_MS:'30000',AUTOTASK_THRESHOLD_PATH:path};
  const valid=await runPreflight(config,{checkFiles:false,now});assert.equal(valid.ok,true);assert.equal(valid.network_requests,0);assert.ok(valid.checks.some(c=>c.name==='threshold_observation'&&c.status==='pass'));assert.equal(JSON.stringify(valid).includes('THRESHOLD-CANARY'),false);
  for(const extra of [{AUTOTASK_REQUESTS_PER_WINDOW:'0'},{AUTOTASK_THRESHOLD_MAX_AGE_MS:'60001'},{AUTOTASK_BUDGET_MAX_WAIT_MS:'60001'},{AUTOTASK_BUDGET_QUEUE_SIZE:'1001'}])assert.equal(failed(await runPreflight({...config,...extra},{checkFiles:false,now}),'request_budget'),true);
  const stale=await runPreflight(config,{checkFiles:false,now:now+30001});assert.equal(failed(stale,'request_budget'),true);
  await writeFile(source,'CHANGED-CAPTURE-CANARY');const corrupt=await runPreflight(config,{checkFiles:false,now});assert.equal(failed(corrupt,'request_budget'),true);assert.equal(JSON.stringify(corrupt).includes('CHANGED-CAPTURE-CANARY'),false);
});
test('explicit operation enablement needs evidence and never accepts wildcards or ignored empty entries',async()=>{
  for(const ENABLED_AUTOTASK_OPERATIONS of ['*','Tickets.get,','Tickets.get,Tickets.get','Tickets.get'])assert.equal((await runPreflight({...environment(),ENABLED_AUTOTASK_OPERATIONS},{checkFiles:false})).ok,false);
  for(const AUTOTASK_TICKET_HOSTS of ['https://tickets.example.test','tickets.example.test:443','user@tickets.example.test','tickets.example.test,tickets.example.test'])assert.equal((await runPreflight({...environment(),AUTOTASK_TICKET_HOSTS},{checkFiles:false})).ok,false);
  assert.equal((await runPreflight({...environment(),AUTOTASK_TICKET_HOSTS:'tickets.example.test'},{checkFiles:false})).ok,true);
});
test('snapshot paths reject relative/UNC access and missing, stale, malformed or fixture evidence cannot initialize live providers',async()=>{
  for(const METADATA_SNAPSHOT_PATH of ['relative.json','\\\\server\share\tenant.json','//server/share/tenant.json',resolve('work/missing-snapshot.json')])assert.equal((await runPreflight({...environment(),METADATA_SNAPSHOT_PATH},{checkFiles:false})).ok,false);
  const dir=await mkdtemp(resolve('work/preflight-test-'));const path=join(dir,'snapshot.json');await writeFile(path,'{"secret":"FILE-CANARY"}');const malformed=await runPreflight({...environment(),METADATA_SNAPSHOT_PATH:path},{checkFiles:false});assert.equal(malformed.ok,false);assert.equal(JSON.stringify(malformed).includes('FILE-CANARY'),false);
  const inventory=compileInventory(JSON.parse(await readFile('registry/coverage.json','utf8')));await writeFile(path,JSON.stringify(fixtureMetadataSnapshot(inventory)));assert.equal(failed(await runPreflight({...environment(),METADATA_SNAPSHOT_PATH:path},{checkFiles:false}),'metadata_source'),true);
});
test('optional health checks issue only fixed GETs without credentials or redirects',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];const result=await checkDeployedHealth('https://mcp.rarity.example',async(input,init)=>{const url=String(input);calls.push({url,init});return Response.json({status:url.endsWith('/live')?'live':'ready'});});assert.equal(result.ok,true);assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/health/live','/health/ready']);for(const call of calls){assert.equal(call.init!.method,'GET');assert.equal(call.init!.redirect,'error');assert.equal(new Headers(call.init!.headers).has('authorization'),false);}
  let invoked=false;assert.equal((await checkDeployedHealth('http://bad.example',async()=>{invoked=true;return new Response();})).ok,false);assert.equal(invoked,false);
});
test('health failures, remote secrets and oversized streaming bodies remain bounded and redacted',async()=>{
  const failed=await checkDeployedHealth('https://mcp.rarity.example',async()=>new Response('SECRET-REMOTE-CANARY',{status:503}));assert.equal(failed.ok,false);assert.equal(JSON.stringify(failed).includes('SECRET-REMOTE-CANARY'),false);
  let cancelled=0;const large=await checkDeployedHealth('https://mcp.rarity.example',async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2000));},cancel(){cancelled++;}})));assert.equal(large.ok,false);assert.equal(cancelled,2);
});
test('deployment role grants support ordered migrations and runtime data access without schema ownership',async()=>{
  const db=new PGlite();try{const roleSql=await readFile('deploy/postgres-roles.sql','utf8');await db.exec(roleSql);await db.exec('SET ROLE autotask_mcp_migrator');for(const migration of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${migration}`,'utf8'));await db.exec('RESET ROLE');await db.exec(roleSql);await db.exec('SET ROLE autotask_mcp_app');const versions=await db.query('SELECT version FROM schema_migrations');assert.equal(versions.rows.length,REQUIRED_MIGRATIONS.length);
    await db.query("INSERT INTO identity_mappings(tenant_id,object_id,resource_id,mapping_version,policy_version,active,resource_verified_at,policy) VALUES('test-tenant','test-person',101,1,'test-v1',false,now(),'{\"capabilities\":[],\"companyIds\":[]}')");
    await assert.rejects(db.exec('ALTER TABLE operation_journal ADD COLUMN forbidden_test_column boolean'));
    await assert.rejects(db.exec('ALTER TABLE operation_journal DISABLE TRIGGER ALL'));
    await assert.rejects(db.exec('CREATE TABLE forbidden_test_table(id int)'));
  }finally{await db.close();}
});

test('domain enablement flags require matching packs, metadata and request budgets',async()=>{
  for(const pack of ['BUSINESS','WORK_MANAGEMENT','ATTACHMENTS']){
    assert.equal((await runPreflight({...environment(),[`${pack}_WRITES_ENABLED`]:'true'},{checkFiles:false})).ok,false);
    assert.equal((await runPreflight({...environment(),[`${pack}_ENABLED`]:'true'},{checkFiles:false})).ok,false);
    assert.equal((await runPreflight({...environment(),[`${pack}_ENABLED`]:'sometimes'},{checkFiles:false})).ok,false);
    assert.equal((await runPreflight({...environment(),[`${pack}_ENABLED`]:'false',[`${pack}_WRITES_ENABLED`]:'false'},{checkFiles:false})).ok,true);
  }
});

test('diagnostics preflight requires persistent path and distinct rotation keys without echoing secrets',async()=>{const key=Buffer.alloc(32,11).toString('base64'),base={...environment(),DIAGNOSTICS_ENABLED:'true',DIAGNOSTICS_SPOOL_DIRECTORY:'/app/work/diagnostics',DIAGNOSTICS_ENCRYPTION_KEY:key};const options={checkFiles:false};assert.equal(failed(await runPreflight(base,options),'DIAGNOSTICS_ENCRYPTION_KEY'),false);assert.equal(failed(await runPreflight({...base,DIAGNOSTICS_SPOOL_DIRECTORY:'relative'},options),'DIAGNOSTICS_SPOOL_DIRECTORY'),true);assert.equal(failed(await runPreflight({...base,DIAGNOSTICS_ENCRYPTION_KEY:base.OPERATION_PAYLOAD_KEY},options),'DIAGNOSTICS_ENCRYPTION_KEY'),true);const ring=JSON.stringify({active:'new',keys:{'1':key,new:Buffer.alloc(32,12).toString('base64')}}),result=await runPreflight({...base,DIAGNOSTICS_ENCRYPTION_KEY:'',DIAGNOSTICS_KEYRING:ring},options);assert.equal(failed(result,'DIAGNOSTICS_KEYRING'),false);assert.doesNotMatch(JSON.stringify(result),new RegExp(key));assert.equal(failed(await runPreflight({...base,DIAGNOSTICS_KEYRING:ring},options),'DIAGNOSTICS_KEYRING'),true);});
