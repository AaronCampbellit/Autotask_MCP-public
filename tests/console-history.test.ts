import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ControlPlaneService,MemoryControlPlaneStore,PostgresControlPlaneStore} from '../packages/control-plane/src/index.js';
import {MemoryJournal,PostgresJournal,IntentCipher} from '../packages/storage/src/index.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {actorKey,type JournalRecord} from '../packages/contracts/src/index.js';
import {REQUIRED_MIGRATIONS} from '../scripts/preflight.js';
import {historyFilterSchema} from '../packages/control-plane/src/history.js';

function setup(){const admin={...fixturePrincipals()[0]!,capabilities:['operational.read','platform.manage'] as const},p={...admin,capabilities:[...admin.capabilities]},peer={...fixturePrincipals()[1]!,tenantId:p.tenantId},outsider={...peer,tenantId:randomUUID(),objectId:randomUUID()},records:JournalRecord[]=[],journal=new MemoryJournal(),store=new MemoryControlPlaneStore([p,peer,outsider],journal,async()=>records),service=new ControlPlaneService(store,{bootstrapIdentityKeys:[],cipher:new IntentCipher(randomBytes(32))});return{p,peer,outsider,records,journal,store,service};}
async function seed(s:ReturnType<typeof setup>){for(const p of [s.p,s.peer,s.outsider]){const {record}=await s.journal.reserve({actorKey:actorKey(p),requestKey:randomUUID(),operation:'ticket_note_add',payloadHash:'a'.repeat(64),mappingVersion:1,resourceId:p.resourceId,policyVersion:p.policyVersion,result:{title:'PRIVATE BODY',ticket_id:1234}});s.records.push(record);}}
test('admin history spans users only within its tenant and exposes no protected payloads or results',async()=>{const s=setup();await seed(s);const data=await s.service.history(s.p,{kind:'activity',limit:50});assert.equal(data.scope,'all');assert.equal(data.items.length,2);assert.deepEqual(new Set(data.items.map(i=>i.userId)),new Set([s.p.objectId,s.peer.objectId]));assert.doesNotMatch(JSON.stringify(data),/PRIVATE|ticket_id|result|payload|resourceId/);assert.equal((await s.service.history(s.peer,{kind:'activity',limit:50})).items.length,1);await assert.rejects(s.service.history(s.peer,{kind:'activity',user:s.p.objectId,limit:50}),{code:'forbidden'});await assert.rejects(s.service.history(s.peer,{kind:'audit',limit:50}),{code:'forbidden'});});
test('history rejects administrator revocation during the storage read',async()=>{const s=setup();await seed(s);const list=s.store.listHistory.bind(s.store);s.store.listHistory=async(...args)=>{const r=await list(...args);await s.store.saveMember(s.p,{...s.p,capabilities:['operational.read'],mappingVersion:2,policyVersion:'v2'},1,new Date().toISOString());return r;};await assert.rejects(s.service.history(s.p,{kind:'activity',limit:50}));});
test('history validates limits, filters and cursor shape',()=>{for(const input of [{kind:'activity',limit:101},{kind:'activity',user:'bad'},{kind:'audit',from:'2026-09-20T00:00:00Z',to:'2026-09-01T00:00:00Z'},{kind:'activity',cursor:{at:'bad',id:randomUUID()}},{kind:'activity',tenantId:randomUUID()}])assert.equal(historyFilterSchema.safeParse(input).success,false);});

test('SQL history supports stable paging, literal searches, filters and tenant isolation with matching memory results',async()=>{
 const db=new PGlite();try{for(const file of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));const sql=new PostgresControlPlaneStore(db),journal=new MemoryJournal(),s=setup();
 for(const [index,p] of [s.p,s.peer,s.outsider,s.peer].entries()){
  const {record}=await journal.reserve({actorKey:actorKey(p),requestKey:randomUUID(),operation:index===3?'business_configurationitems_update':'ticket_note_add',payloadHash:'a'.repeat(64),resourceId:p.resourceId,mappingVersion:1,policyVersion:p.policyVersion,result:{title:'PRIVATE'}});
  // Same timestamp deliberately exercises the UUID tie-breaker.
  const at='2026-09-17T10:00:00.000Z';await db.query('INSERT INTO operation_journal (id,actor_key,request_key,payload_hash,operation,mapping_version,resource_id,policy_version,state,result,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9::jsonb,$10,$10)',[record.id,record.actorKey,record.requestKey,record.payloadHash,record.operation,record.resourceId,record.policyVersion,record.state,JSON.stringify(record.result),at]);s.records.push({...record,createdAt:at,updatedAt:at});
 }
 const first=await sql.listHistory(s.p.tenantId,{kind:'activity',limit:2});assert.equal(first.items.length,2);assert(first.nextCursor);const next=await sql.listHistory(s.p.tenantId,{kind:'activity',limit:2,cursor:first.nextCursor});assert.equal(next.items.length,1);assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,3);
 for(const filter of [{kind:'activity' as const,limit:50,user:s.peer.objectId},{kind:'activity' as const,limit:50,q:'update asset'},{kind:'activity' as const,limit:50,q:'%'},{kind:'activity' as const,limit:50,state:'ready' as const,from:'2026-09-18T00:00:00.000Z'},{kind:'activity' as const,limit:50,action:'ticket_note_add'}])assert.deepEqual(await sql.listHistory(s.p.tenantId,filter),await s.store.listHistory(s.p.tenantId,filter));
 assert.equal((await sql.listHistory(s.p.tenantId,{kind:'activity',limit:50,q:'update asset'})).items.length,1);
 await sql.saveTemplate(s.p,{tenantId:s.p.tenantId,key:'example',version:1,capabilities:[],companyIds:[10]},0,'2026-09-17T10:00:00.000Z');assert.equal((await sql.listHistory(s.p.tenantId,{kind:'audit',limit:50,q:'saved permission template',user:s.p.objectId})).items.length,1);assert.equal((await sql.listHistory(s.outsider.tenantId,{kind:'audit',limit:50})).items.length,0);
 const indexes=await db.query("SELECT indexname FROM pg_indexes WHERE indexname='operation_journal_tenant_created_idx'");assert.equal(indexes.rows.length,1);
 }finally{await db.close();}
});

test('console history routes cache names, validate queries, and do not permit cross-user result reads or retries',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js'),{createAdminRoutes}=await import('../apps/server/src/admin.js');const s=createFixtureSystem();t.after(()=>s.app.close());let reads=0;const base='http://127.0.0.1:3030';const routes=createAdminRoutes({publicUrl:base,sessions:s.sessions,control:s.control,operations:{ticket_note_add:{write:true,capabilities:[]}},principal:async()=>s.principals[0]!,recover:async()=>({}),onboarding:{entra:{list:async()=>{reads++;return s.principals.map((p,i)=>({id:p.objectId,displayName:`Employee ${i+1}`,mail:`person${i+1}@example.test`,userPrincipalName:`person${i+1}@example.test`}));}} as any,autotask:{} as any}});
 const login=async(index:number)=>{const r=await routes.fetch(new Request(`${base}/admin/auth/fixture`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:s.tokens[index]!.token})}));return r!.headers.getSetCookie()[0]!.split(';')[0]!;};const cookie=await login(0),reader=await login(1);
 const peer=s.principals[1]!,{record}=await s.journal.reserve({actorKey:actorKey(peer),requestKey:randomUUID(),operation:'ticket_note_add',payloadHash:'a'.repeat(64),resourceId:peer.resourceId,mappingVersion:peer.mappingVersion,policyVersion:peer.policyVersion,result:{title:'PRIVATE'}});
 const get=(path:string,who=cookie)=>routes.fetch(new Request(`${base}/admin/api/${path}`,{headers:{cookie:who}}));
 const response=await get('history?kind=activity'),body=await response!.json();assert.equal(response!.status,200);assert.equal(body.items[0].user.name,'Employee 2');assert.equal(body.scope,'all');assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);await get('history?kind=activity&state=ready');assert.equal(reads,1);
 assert.equal((await get('history?kind=activity&limit=999'))!.status,400);assert.equal((await get('history?kind=activity&kind=audit'))!.status,400);assert.equal((await get('history?kind=audit',reader))!.status,403);
 const denied=await s.app.fetch(new Request(`${base}/admin/api/operations/${record.id}`,{headers:{cookie}}));assert.notEqual(denied.status,200);
 assert.equal((await s.journal.get(record.id,actorKey(s.principals[0]!))),undefined);
});

test('history route denies access revoked while resolving names',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js'),{createAdminRoutes}=await import('../apps/server/src/admin.js');const s=createFixtureSystem();t.after(()=>s.app.close());const original=s.principals[0]!,p={...original,capabilities:[...original.capabilities,'platform.manage' as const],mappingVersion:2,policyVersion:'v2'};await s.controlStore.saveMember(original,p,1,new Date().toISOString());
 const control=new ControlPlaneService(s.controlStore,{bootstrapIdentityKeys:[],cipher:new IntentCipher(randomBytes(32))});const base='http://127.0.0.1:3030';const routes=createAdminRoutes({publicUrl:base,sessions:s.sessions,control,principal:async()=>p,recover:async()=>({}),onboarding:{entra:{list:async()=>{await s.controlStore.saveMember(p,{...p,capabilities:['operational.read'],mappingVersion:3,policyVersion:'v3'},2,new Date().toISOString());return[];}} as any,autotask:{} as any}});
 const login=await routes.fetch(new Request(`${base}/admin/auth/fixture`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:s.tokens[0]!.token})}));assert.equal(login!.status,200);const cookie=login!.headers.getSetCookie()[0]!.split(';')[0]!;
 const result=await routes.fetch(new Request(`${base}/admin/api/history?kind=activity`,{headers:{cookie}}));assert.equal(result!.status,403);
});
