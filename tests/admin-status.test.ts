import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { AppError } from '../packages/contracts/src/index.js';

const base='http://127.0.0.1:3030',ticket={kind:'id',id:1001};
const note={title:'Status fixture',text:'PRIVATE NOTE BODY',audience:'internal'},time={work_date:'2026-09-10',timezone:'America/Chicago',minutes:15,start_datetime:'2026-09-10T09:00:00-05:00',summary:'PRIVATE TIME BODY'};
type System=ReturnType<typeof createFixtureSystem>;
async function login(s:System,reader=false){const response=await s.app.fetch(new Request(`${base}/admin/auth/fixture`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:s.tokens[reader?1:0]!.token})}));assert.equal(response.status,200);return{cookie:response.headers.getSetCookie()[0]!.split(';')[0]!,csrf:(await response.json()).csrf as string};}
type Auth=Awaited<ReturnType<typeof login>>;
const get=(s:System,id:string,auth?:Auth)=>s.app.fetch(new Request(`${base}/admin/api/operations/${id}`,{headers:auth?{cookie:auth.cookie}:{}}));
const documentWork=(s:System)=>s.runtime.invoke(s.principals[0]!,'ticket_document_work',{ticket,note,time,request_key:randomUUID()}) as Promise<any>;

test('console status uses the scoped runtime and returns verified saved IDs without repeating work',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const created=await documentWork(s),auth=await login(s),count=s.adapter.records.TicketNotes.length;
  const response=await get(s,created.operation_id,auth);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const result=await response.json();assert.equal(result.status,'succeeded_verified');assert.equal(result.operation_id,created.operation_id);assert.equal(result.data.steps.note.state,'succeeded_verified');assert.equal(result.data.steps.time.state,'succeeded_verified');assert.ok(result.data.steps.note.native_id);assert.ok(result.data.steps.time.native_id);assert.doesNotMatch(JSON.stringify(result),/PRIVATE NOTE BODY|PRIVATE TIME BODY|encryptedIntent/);assert.equal(s.adapter.records.TicketNotes.length,count);
});

test('operation status requires a session and another employee cannot dereference an opaque ID',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const created=await documentWork(s);
  assert.equal((await get(s,created.operation_id)).status,401);
  const response=await get(s,created.operation_id,await login(s,true));assert.notEqual(response.status,200);assert.doesNotMatch(await response.text(),/ticket_id|note_id|time_entry_id|PRIVATE/);
});

for(const changed of ['mapping','company'] as const)test(`operation status rechecks current ${changed} access instead of using historical activity`,async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const created=await documentWork(s),auth=await login(s),p=s.principals[0]!;
  if(changed==='company')s.adapter.records.Tickets[0]!.companyID=20;
  else await s.control.saveMember(p,{objectId:p.objectId,resourceId:p.resourceId,active:true,capabilities:p.capabilities,companyIds:p.companyIds},1);
  const response=await get(s,created.operation_id,auth);assert.notEqual(response.status,200);assert.doesNotMatch(await response.text(),/ticket_id|note_id|time_entry_id|PRIVATE/);
});

test('status remains readable during write pause but obeys its own current tool switch',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const created=await documentWork(s),auth=await login(s),p=s.principals[0]!;
  await s.control.setControls(p,{writePaused:true,tools:{}},0);assert.equal((await get(s,created.operation_id,auth)).status,200);
  await s.control.setControls(p,{writePaused:true,tools:{at_operation_status:false}},1);assert.equal((await get(s,created.operation_id,auth)).status,403);
});

test('console status rejects malformed routes and injected query overrides without writes',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const created=await documentWork(s),auth=await login(s),count=s.journal.inspectAll().length;
  assert.equal((await get(s,'not-an-operation-id',auth)).status,404);
  assert.equal((await get(s,`${created.operation_id}?resource_id=102`,auth)).status,400);
  const post=await s.app.fetch(new Request(`${base}/admin/api/operations/${created.operation_id}`,{method:'POST',headers:{cookie:auth.cookie,origin:base,'x-csrf-token':auth.csrf}}));assert.equal(post.status,404);assert.equal(s.journal.inspectAll().length,count);
});

test('partial status and console resume preserve saved note and return separate verified outcomes',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const createTime=s.adapter.createTicketTime.bind(s.adapter);
  s.adapter.createTicketTime=async()=>{throw new AppError('precondition_failed','Fictitious time rejection.');};
  const created=await documentWork(s),auth=await login(s),notes=s.adapter.records.TicketNotes.length;assert.equal(created.status,'partial');
  const partial=await(await get(s,created.operation_id,auth)).json();assert.equal(partial.data.steps.note.state,'succeeded_verified');assert.equal(partial.data.steps.time.state,'failed');assert.equal(partial.can_resume,true);
  s.adapter.createTicketTime=createTime;
  const response=await s.app.fetch(new Request(`${base}/admin/api/recover`,{method:'POST',headers:{cookie:auth.cookie,origin:base,'content-type':'application/json','x-csrf-token':auth.csrf},body:JSON.stringify({operation_id:created.operation_id,action:'resume'})}));assert.equal(response.status,200);
  const recovered=await response.json();assert.equal(recovered.status,'succeeded_verified');assert.equal(recovered.data.steps.note.native_id,partial.data.steps.note.native_id);assert.equal(recovered.data.steps.time.state,'succeeded_verified');assert.equal(s.adapter.records.TicketNotes.length,notes);
});

class Element {
  children:Element[]=[];attributes:Record<string,string>={};className='';private content='';
  constructor(readonly tag:string){}
  set textContent(value:string){this.content=value;this.children=[];}get textContent():string{return this.content+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_value:string){throw new Error('HTML rendering is prohibited');}
  append(...children:Element[]){this.children.push(...children);}setAttribute(name:string,value:string){this.attributes[name]=value;}
  all():Element[]{return[this,...this.children.flatMap(child=>child.all())];}
}
const rendererUrl=pathToFileURL(resolve('apps/console/public/result-dialog.js')).href;
const renderer=await import(rendererUrl);

test('result rendering distinguishes partial and unknown steps and ignores arbitrary protected fields',()=>{
  const receipt={status:'partial',operation_id:randomUUID(),can_resume:true,receipt:'The note was saved. The time step is incomplete.',data:{ticket_id:1001,hours_worked:0.25,summaryNotes:'PRIVATE NOTE BODY',steps:{note:{operation_id:randomUUID(),state:'succeeded_verified',native_id:3001,label:'PRIVATE OVERRIDE'},time:{operation_id:randomUUID(),state:'failed'}}},warnings:['<img src=x onerror=alert(1)>']};
  const root=renderer.renderOperationResult({createElement:(tag:string)=>new Element(tag)},receipt) as Element;
  assert.match(root.textContent,/Partially completed/);assert.match(root.textContent,/Documentation note/);assert.match(root.textContent,/Saved and verified/);assert.match(root.textContent,/Failed/);assert.match(root.textContent,/15 minutes/);assert.match(root.textContent,/3001/);assert.match(root.textContent,/Resume can continue/);assert.doesNotMatch(root.textContent,/PRIVATE|summaryNotes|"ticket_id"/);assert.match(root.textContent,/<img src=x onerror=alert\(1\)>/);assert(!root.all().some(element=>['img','script','pre'].includes(element.tag)));assert(root.all().filter(element=>element.tag==='th').every(element=>element.attributes.scope==='col'));
  const uncertain=renderer.renderOperationResult({createElement:(tag:string)=>new Element(tag)},{status:'unknown_outcome',operation_id:randomUUID(),data:{note_id:3001}}) as Element;
  assert.match(uncertain.textContent,/Outcome unknown/);assert.match(uncertain.textContent,/Do not repeat this operation/);assert.match(uncertain.textContent,/Returned note ID/);
});

test('result dialog is labeled, keyboard-closeable, and its renderer is served under the existing CSP',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());const page=await(await s.app.fetch(new Request(`${base}/admin`))).text();assert.match(page,/id="result-dialog" aria-labelledby="result-title" aria-describedby="result-description"/);assert.match(page,/id="result-title" tabindex="-1"/);assert.match(page,/aria-label="Close operation result"/);
  const response=await s.app.fetch(new Request(`${base}/admin/result-dialog.js`));assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/javascript/);assert.match(response.headers.get('content-security-policy')!,/script-src 'self'/);
  const client=await readFile('apps/console/public/admin.js','utf8');assert.match(client,/button\('View result'/);assert.match(client,/async function recover[^\n]+showResult\(result\)/);assert.match(client,/'result-dialog'|#result-dialog/);
});
