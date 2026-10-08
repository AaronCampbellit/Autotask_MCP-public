import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {WebhookInbox,scanTicketChanges} from '../packages/sync/src/index.js';import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
const guid='9ec8f306-42f7-45e2-b4de-1da364738ac7',secret='mock-webhook-secret-only';
test('webhook inbox verifies exact raw bytes, deduplicates and stores no record text',async()=>{const db=new PGlite();try{await db.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY)');await db.exec(await readFile('packages/storage/migrations/009_webhook_inbox.sql','utf8'));const inbox=new WebhookInbox(db,[{tenantId:'tenant',guid,entityType:'Tickets',secret}]);
const body=JSON.stringify({Action:'Update',Guid:guid,EntityType:'Tickets',Id:123,EventTime:'2026-09-14T10:00:00Z',SequenceNumber:5,Fields:{description:'never store me'}});
const request=(raw=body,sig=createHmac('sha1',secret).update(body).digest('base64'))=>new Request('https://localhost/webhooks/autotask',{method:'POST',headers:{'x-hook-signature':'sha1='+sig},body:raw});
assert.equal((await inbox.receive(request())).status,200);assert.equal((await inbox.receive(request())).status,200);assert.equal((await inbox.receive(request(body+' '))).status,401);
const records=await db.query('SELECT * FROM webhook_inbox');assert.equal(records.rows.length,1);assert(!JSON.stringify(records).includes('never store me'));
assert.equal((await inbox.receive(request(body.replace(guid,'3ec8f306-42f7-45e2-b4de-1da364738ac7')))).status,401);}finally{await db.close();}});

test('change scans retain window and self filters with continuation and reject future/unbounded windows',async()=>{const p=fixturePrincipals()[0]!;let args:any;const result=await scanTicketChanges(p,{since:'2026-09-01T00:00:00Z',through:'2026-09-02T00:00:00Z',technician:'self',cursor:'cursor'},async(_p,name,a)=>{assert.equal(name,'at_query');args=a;return{status:'partial',data:[],completeness:{complete:false,returned:0,next_cursor:'next'}};});assert.equal(args.cursor,'cursor');assert(args.filter.conditions.some((v:any)=>v.field==='assignedResourceID'&&v.value===p.resourceId));assert.equal(result.window.through,'2026-09-02T00:00:00Z');await assert.rejects(scanTicketChanges(p,{since:'2026-01-01T00:00:00Z',through:'2026-09-02T00:00:00Z'},async()=>({})));});

test('change scan rejects out-of-scope companies before dispatch and malformed completeness',async()=>{
 const p=fixturePrincipals()[0]!,window={since:'2026-09-01T00:00:00Z',through:'2026-09-02T00:00:00Z'};let calls=0;
 await assert.rejects(scanTicketChanges(p,{...window,company_id:999999},async()=>{calls++;return{};}),(error:any)=>error.code==='not_found_or_inaccessible');assert.equal(calls,0);
 for(const result of [{status:'failed'}, {status:'succeeded',data:[],completeness:{complete:true,returned:0,next_cursor:'unexpected'}},{status:'succeeded',data:[{id:0}],completeness:{complete:true,returned:1,next_cursor:null}}])await assert.rejects(scanTicketChanges(p,window,async()=>result),(error:any)=>error.code==='dependency_unavailable');
});
