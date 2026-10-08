import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {DiagnosticCipher,RETENTION_MS,type DiagnosticEvent} from '../packages/diagnostics/src/contracts.js';
import {MemoryDiagnosticStore,PostgresDiagnosticStore} from '../packages/diagnostics/src/store.js';
import {DiagnosticSpool} from '../packages/diagnostics/src/spool.js';
import {DurableDiagnostics} from '../packages/diagnostics/src/service.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
async function setup(t:any){const root=await mkdtemp(join(tmpdir(),'diagnostics-'));t.after(()=>rm(root,{recursive:true,force:true}));const cipher=new DiagnosticCipher(randomBytes(32)),store=new MemoryDiagnosticStore(),spool=new DiagnosticSpool(root,cipher),p={...fixturePrincipals()[0]!,capabilities:['platform.manage' as const]},state={p,now:Date.now()};const service=new DurableDiagnostics(store,spool,{instanceId:'instance-a',serverRelease:'test',principals:{get:async()=>state.p},cipher,now:()=>state.now});await service.initialize();return{root,cipher,store,spool,p,state,service};}
test('start and terminal are durable, separately encrypted, queryable only by current tenant admins',async t=>{const f=await setup(t),start=await f.service.start({tenantId:f.p.tenantId,actorId:f.p.objectId,tool:'ticket_get',details:{safe:'summary'}});assert(f.store.events.has(start.eventId));await f.service.finish(start,{outcome:'succeeded',durationMs:5,details:{count:1}});const list=await f.service.list(f.p,{});assert.equal(list.items.length,1);assert.equal(list.items[0]!.lifecycle,'finished');assert.equal((await f.service.detail(f.p,start.callId!)).events.length,2);await assert.rejects(()=>f.service.detail({...f.p,tenantId:'other'},start.callId!));f.state.p={...f.p,capabilities:[]};await assert.rejects(()=>f.service.list(f.p,{}));});
test('PostgreSQL event append deduplicates, encrypts details and atomically materializes call state',async t=>{const f=await setup(t),db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY)');await db.exec(await readFile('packages/storage/migrations/019_diagnostics.sql','utf8'));const pg=new PostgresDiagnosticStore(db,f.cipher),start=await f.service.start({tenantId:f.p.tenantId,actorId:f.p.objectId,tool:'test',details:{canary:'SANITIZED_DETAIL_ENCRYPTED'}});await pg.append(start);await pg.append(start);const terminal=await f.service.finish(start,{outcome:'accepted_unverified',details:{verification:'readback_failed'}});await pg.append(terminal);await pg.append({...start,eventId:randomUUID()});assert.equal((await pg.list({tenantId:f.p.tenantId}))[0]!.outcome,'accepted_unverified');assert.equal((await pg.detail(f.p.tenantId,start.callId!))!.events.length,3);assert.doesNotMatch(JSON.stringify((await db.query('SELECT * FROM diagnostic_events')).rows),/SANITIZED_DETAIL_ENCRYPTED/);await pg.heartbeat('old-instance');assert.equal((await pg.abandoned('new-instance',new Date(Date.now()-120000).toISOString())).length,0);});
test('database outage fsyncs encrypted spool and admin can read pending records; replay does not duplicate',async t=>{const f=await setup(t),append=f.store.append.bind(f.store);f.store.append=async()=>{throw Error('database unavailable');};const start=await f.service.start({tenantId:f.p.tenantId,actorId:f.p.objectId,tool:'read',details:{canary:'ENCRYPTED_CANARY'}});await f.service.finish(start,{outcome:'failed',errorOrigin:'schema'});assert.equal((await f.spool.health()).backlogEvents,2);for(const name of await readdir(f.root))if(name.endsWith('.pending'))assert.doesNotMatch((await readFile(join(f.root,name))).toString(),/ENCRYPTED_CANARY|schema/);assert.equal((await f.service.list(f.p,{})).items[0]!.outcome,'failed');assert.equal((await f.service.detail(f.p,start.callId!)).events.length,2);f.store.append=append;await f.service.maintenance();assert.equal((await f.spool.health()).backlogEvents,0);await f.store.append(start);assert.equal(f.store.events.size,2);});
test('total durability failure stops admission; terminal recovery preserves result evidence',async t=>{const f=await setup(t),start=await f.service.start({tenantId:f.p.tenantId,tool:'write'}),append=f.store.append.bind(f.store),spoolAppend=f.spool.append.bind(f.spool);f.store.append=async()=>{throw Error();};f.spool.append=async()=>{throw Error();};await assert.rejects(()=>f.service.finish(start,{outcome:'accepted_unverified',operationId:'operation-1'}));assert.equal(f.service.ready(),false);await assert.rejects(()=>f.service.start({tool:'next'}));f.store.append=append;f.spool.append=spoolAppend;await f.service.maintenance();assert.equal(f.service.ready(),true);assert.equal((await f.store.detail(f.p.tenantId,start.callId!))!.call.outcome,'accepted_unverified');assert([...f.store.events.values()].some(e=>e.type==='capture.recovered'));});
test('torn tails preserve complete segments, ignore live owners and expire after seven days',async t=>{const f=await setup(t),event=await f.service.start({tenantId:f.p.tenantId,tool:'read'});await f.spool.append(event);const pending=(await readdir(f.root)).find(n=>n.endsWith('.pending'))!,bytes=await readFile(join(f.root,pending));const owner=randomUUID(),name=`${owner}-${Date.now()}-${randomUUID()}.writing`;await writeFile(join(f.root,name),bytes.subarray(0,bytes.length-10));await writeFile(join(f.root,owner+'.owner'),'live');await f.spool.recover();assert((await readdir(f.root)).includes(name));const stale=new Date(Date.now()-180000);await utimes(join(f.root,name),stale,stale);await utimes(join(f.root,owner+'.owner'),stale,stale);await f.spool.recover();assert.equal((await f.spool.health()).tornFrames,1);assert.equal((await f.spool.events()).length,1);await f.spool.recover(Date.now()+RETENTION_MS+1000);assert.equal((await f.spool.health()).tornFrames,0);});
test('expired spool events never get replayed as fresh history and query expiry is immediate',async t=>{const f=await setup(t),event=await f.service.start({tenantId:f.p.tenantId,tool:'read'});await f.spool.append(event);f.state.now+=RETENTION_MS+1;assert.equal((await f.service.list(f.p,{})).items.length,0);await assert.rejects(()=>f.service.detail(f.p,event.callId!));const drain=await f.spool.drain(f.store,f.state.now);assert.equal(drain.expired,1);assert.equal(drain.delivered,0);assert.equal(await f.store.cleanup(f.state.now),2);});
test('lease-expired starts become interrupted unknown while live instance starts remain started',async t=>{const f=await setup(t),start=await f.service.start({tenantId:f.p.tenantId,tool:'read'});start.call!.instanceId='old';start.instanceId='old';start.eventId=randomUUID();await f.store.append(start);await f.store.heartbeat('old',f.state.now);f.state.now+=180000;await f.service.maintenance();assert.equal((await f.store.detail(f.p.tenantId,start.callId!,f.state.now))!.call.lifecycle,'interrupted');assert.equal((await f.store.detail(f.p.tenantId,start.callId!,f.state.now))!.call.outcome,'unknown_outcome');});

test('late interrupted replay cannot overwrite a finished call in memory or PostgreSQL',async t=>{
 const f=await setup(t),db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY)');await db.exec(await readFile('packages/storage/migrations/019_diagnostics.sql','utf8'));const pg=new PostgresDiagnosticStore(db,f.cipher),start=await f.service.start({tenantId:f.p.tenantId,tool:'write'}),done=await f.service.finish(start,{outcome:'succeeded'});const late={...done,eventId:randomUUID(),type:'call.interrupted',call:{...done.call!,lifecycle:'interrupted' as const,outcome:'unknown_outcome' as const,endedAt:new Date(Date.now()+1000).toISOString()}};
 for(const store of [f.store,pg]){await store.append(start);await store.append(done);await store.append(late);assert.equal((await store.detail(f.p.tenantId,start.callId!))!.call.outcome,'succeeded');}
});
test('cleanup removes expired spool frames during database outage and cursor binding rejects changed filters',async t=>{
 const f=await setup(t);const first=await f.service.start({tenantId:f.p.tenantId,actorId:f.p.objectId,tool:'read'});await f.spool.append(first);f.state.now++;await f.service.start({tenantId:f.p.tenantId,actorId:f.p.objectId,tool:'read'});const page=await f.service.list(f.p,{limit:1});assert(page.next_cursor);await assert.rejects(()=>f.service.list(f.p,{limit:1,tool:'changed',cursor:page.next_cursor}),{code:'conflict'});assert.equal((await f.service.list(f.p,{limit:1,cursor:page.next_cursor})).items.length,1);
 f.state.now+=RETENTION_MS+1000;f.store.ping=async()=>{throw Error('offline');};await f.service.maintenance();assert.equal((await f.spool.health()).backlogEvents,0);
});
test('capture continues beyond a display page or daily-style threshold without sampling',async t=>{const f=await setup(t);for(let i=0;i<1100;i++)await f.service.start({tenantId:f.p.tenantId,tool:'read'});assert.equal(f.store.calls.size,1100);assert.equal((await f.service.list(f.p,{limit:100})).items.length,100);});

test('list projects newer spool terminals before outcome filters and fills beyond evicted candidates',async t=>{
 const f=await setup(t),events:DiagnosticEvent[]=[];
 for(let i=0;i<105;i++){
  f.state.now++;
  const start=await f.service.start({tenantId:f.p.tenantId,tool:'read'});
  const done=await f.service.finish(start,{outcome:'succeeded'});
  if(i>=2)events.push({...done,eventId:randomUUID(),call:{...done.call!,outcome:'failed',endedAt:new Date(f.state.now+1).toISOString()}},start);
 }
 // Exercise both arbitrary terminal-before-start and start-before-terminal replay.
 for(const reverse of [false,true]){
  f.spool.iterate=async function*(){yield*(reverse?[...events].reverse():events);};
  const page=await f.service.list(f.p,{outcome:'succeeded',limit:2});
  assert.equal(page.items.length,2);
  assert(page.items.every(c=>!events.some(e=>e.callId===c.callId)));
  assert.equal(page.degraded,true);
  assert.equal((await f.service.list(f.p,{outcome:'failed',limit:100})).items.length,100);
 }
});
test('list excludes a matching database outcome superseded by a durable spool terminal',async t=>{
 const f=await setup(t),start=await f.service.start({tenantId:f.p.tenantId,tool:'read'}),done=await f.service.finish(start,{outcome:'succeeded'});
 await f.spool.append({...done,eventId:randomUUID(),call:{...done.call!,outcome:'failed',endedAt:new Date(f.state.now+1).toISOString()}},true);
 assert.equal((await f.service.list(f.p,{outcome:'succeeded'})).items.length,0);
 assert.equal((await f.service.list(f.p,{outcome:'failed'})).items[0]!.callId,start.callId);
});
