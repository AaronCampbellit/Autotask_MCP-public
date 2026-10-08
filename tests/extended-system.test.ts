import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { operationCatalog } from '../apps/server/src/tool-runtime.js';
import { AppError } from '../packages/contracts/src/index.js';
const base='http://127.0.0.1:3030',ticket={kind:'id',id:1001},note={title:'Integration note',text:'Fictitious integrated work.',audience:'internal'},time={work_date:'2026-09-10',timezone:'America/Chicago',minutes:15,start_datetime:'2026-09-10T09:00:00-05:00',summary:'Separate recorded work.'};
type System=ReturnType<typeof createFixtureSystem>;
async function rpc(s:System,name?:string,args:unknown={},reader=false){const method=name?'tools/call':'tools/list',meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'extended-local-test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
  const response=await s.app.fetch(new Request(`${base}/mcp`,{method:'POST',headers:{authorization:`Bearer ${s.tokens[reader?1:0]!.token}`,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,...(name?{'mcp-name':name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{_meta:meta,...(name?{name,arguments:args}:{})}})}));assert.equal(response.status,200);return (await response.json()).result;}
async function login(s:System,reader=false){const response=await s.app.fetch(new Request(`${base}/admin/auth/fixture`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:s.tokens[reader?1:0]!.token})}));assert.equal(response.status,200);const body=await response.json();return{cookie:response.headers.getSetCookie()[0]!.split(';')[0]!,csrf:body.csrf as string};}
function admin(s:System,auth:{cookie:string;csrf:string},path:string,data?:unknown,headers:Record<string,string>={}){return s.app.fetch(new Request(`${base}/admin/${path}`,{method:data===undefined?'GET':'POST',headers:{cookie:auth.cookie,...(data===undefined?{}:{origin:base,'content-type':'application/json','x-csrf-token':auth.csrf}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}));}

test('extended MCP catalog uses current capabilities and provides real context, references and versioned playbooks',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const names=(await rpc(s)).tools.map((v:any)=>v.name);assert.deepEqual(names.sort(),(await s.runtime.available(s.principals[0]!)).map(t=>t.name).sort());assert(!names.some((n:string)=>n.startsWith('rmm_')),'Unconfigured RMM tools must not be published');const reader=(await rpc(s,undefined,{},true)).tools.map((v:any)=>v.name);assert(!reader.includes('ticket_handoff'));assert(!reader.includes('service_call_create'));assert(!reader.includes('time_entry_search'));
  const context=(await rpc(s,'ticket_context',{ticket,purpose:'resolve'})).structuredContent;assert.equal(context.data.ticket.id,1001);assert.equal(context.data.collections.notes.returned,105);assert(context.data.collections.requirements);assert(!JSON.stringify(context).includes('NEVER-RETURN'));
  const ref=(await rpc(s,'at_reference_resolve',{kind:'queue',reference:{kind:'name',name:'Service Desk'},context:{ticketId:1001}})).structuredContent;assert.equal(ref.id,501);
  const book=(await rpc(s,'at_playbook_get',{id:'handoff'})).structuredContent;assert.equal(book.lifecycle,'draft');assert.equal(book.unavailable_tools.length,0);assert(book.body_sha256);
});
test('extended MCP performs handoff and completion with separate receipts and idempotent root keys',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const input={ticket,target:{kind:'name',name:'Example Colleague'},queue:{kind:'name',name:'Escalations'},note,request_key:'integration-handoff'};const handoff=(await rpc(s,'ticket_handoff',input)).structuredContent;assert.equal(handoff.status,'succeeded_verified');assert.equal(s.adapter.records.Tickets[0]!.assignedResourceID,103);const replay=(await rpc(s,'ticket_handoff',input)).structuredContent;assert.equal(replay.operation_id,handoff.operation_id);assert.equal(s.adapter.records.TicketNotes.length,106);
  const complete=(await rpc(s,'ticket_resolve',{ticket,note,time,completion_status:{kind:'name',name:'Complete'},request_key:'integration-resolution'})).structuredContent;assert.equal(complete.status,'succeeded_verified');assert.equal(s.adapter.records.Tickets[0]!.status,5);assert.equal(s.adapter.records.TimeEntries.length,3);assert.equal(s.adapter.records.Tickets[0]!.resolution,note.text);
});
test('console static surface, session, CSRF, server-owned administration and mapping edits share MCP identity state',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const page=await s.app.fetch(new Request(`${base}/admin`));assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/script-src 'self'/);assert.match(await page.text(),/People &amp; permissions|People & permissions/);
  assert.equal((await s.app.fetch(new Request(`${base}/admin/api/snapshot`))).status,401);const auth=await login(s),snapshot=await(await admin(s,auth,'api/snapshot')).json();assert.equal(snapshot.members.length,2);assert.equal(Object.keys(snapshot.operations).length,Object.keys(operationCatalog).length);assert(!JSON.stringify(snapshot).includes(s.tokens[0]!.token));
  const change={expectedVersion:0,controls:{writePaused:true,tools:{}}};assert.equal((await admin(s,auth,'api/controls',change,{'x-csrf-token':'wrong'})).status,403);assert.equal((await admin(s,auth,'api/controls',change,{origin:'https://foreign.invalid'})).status,403);
  const reader=await login(s,true);assert.equal((await admin(s,reader,'api/snapshot')).status,403);
  const p=s.principals[0]!;const updated=await admin(s,auth,'api/members',{expectedVersion:1,member:{objectId:p.objectId,resourceId:p.resourceId,active:true,companyIds:p.companyIds,capabilities:['operational.read']}});assert.equal(updated.status,200);assert(!(await rpc(s)).tools.some((v:any)=>v.name==='ticket_update'));const me=(await rpc(s,'at_whoami')).structuredContent;assert(!JSON.stringify(me).includes('tickets.write'));assert.equal((await admin(s,auth,'api/members',{expectedVersion:1,member:{objectId:p.objectId,resourceId:p.resourceId,active:true,companyIds:p.companyIds,capabilities:p.capabilities}})).status,409);
});
test('persisted write pause changes discovery and prevents dispatch, while status and reconciliation remain readable',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,created=await s.runtime.invoke(p,'ticket_handoff',{ticket,target:{kind:'id',id:103,name:'Example Colleague'},note,request_key:'pause-handoff-before'}) as any;await s.control.setControls(p,{writePaused:true,tools:{}},0);assert(!(await rpc(s)).tools.some((v:any)=>v.name==='ticket_note_add'));assert((await rpc(s)).tools.some((v:any)=>v.name==='at_operation_reconcile'));const state=(await rpc(s,'at_operation_status',{operation_id:created.operation_id})).structuredContent;assert.equal(state.status,'succeeded_verified');await assert.rejects(s.runtime.invoke(p,'ticket_note_add',{ticket,note,request_key:'paused-note-001'}),e=>e instanceof AppError&&e.code==='forbidden');assert.equal(s.adapter.records.TicketNotes.length,106);
});
test('a control change after verified note blocks later fixed-workflow mutation without duplicating the note',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const original=s.adapter.createTicketNote.bind(s.adapter);s.adapter.createTicketNote=async(...args)=>{const result=await original(...args);await s.control.setControls(s.principals[0]!,{writePaused:true,tools:{}},0);return result;};const outcome=await s.runtime.invoke(s.principals[0]!,'ticket_handoff',{ticket,target:{kind:'id',id:103,name:'Example Colleague'},note,request_key:'pause-between-steps'}) as any;assert.notEqual(outcome.status,'succeeded_verified');assert.equal(s.adapter.records.TicketNotes.length,106);assert.equal(s.adapter.records.Tickets[0]!.assignedResourceID,101);
});
test('durable executor records one job and one verified operation for concurrent enqueue and worker claims',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,input={operation:'ticket_document_work',arguments:{ticket,note,time},request_key:'same-queued-work'};const jobs=await Promise.all(Array.from({length:10},()=>s.runtime.enqueue(p,input)));assert.equal(new Set(jobs.map(j=>j.id)).size,1);await Promise.all([s.worker.tick(),s.worker.tick(),s.worker.tick()]);const job=await s.control.job(p,jobs[0]!.id);assert.equal(job.state,'succeeded');assert(job.operationId);assert.equal(s.adapter.records.TicketNotes.length,106);assert.equal(s.adapter.records.TimeEntries.length,3);assert.equal(await s.worker.tick(),false);assert(!JSON.stringify(job).includes('Fictitious integrated work'));assert(!JSON.stringify(job).includes('encryptedPayload'));
});
test('queued cancellation and pause prevent effects, and actor ownership applies to job reads',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,job=await s.runtime.enqueue(p,{operation:'ticket_note_add',arguments:{ticket,note},request_key:'cancel-queued-note'});await assert.rejects(s.control.job(s.principals[1]!,job.id));await s.control.cancel(p,job.id);assert.equal(await s.worker.tick(),false);const second=await s.runtime.enqueue(p,{operation:'ticket_note_add',arguments:{ticket,note},request_key:'pause-queued-note'});await s.control.setControls(p,{writePaused:true,tools:{}},0);await s.worker.tick();assert.equal((await s.control.job(p,second.id)).state,'failed');assert.equal(s.adapter.records.TicketNotes.length,105);
});
test('a tool switch disabled during a job-list storage read withholds the result',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,original=s.control.store.listJobs.bind(s.control.store);
  s.control.store.listJobs=async(...args)=>{const result=await original(...args);await s.control.setControls(p,{writePaused:false,tools:{at_job_list:false}},0);return result;};
  await assert.rejects(s.runtime.invoke(p,'at_job_list',{}),e=>e instanceof AppError&&e.code==='identity_validation_unavailable');
});
test('running job cancellation prevents the next association or ticket change after a saved effect',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,job=await s.runtime.enqueue(p,{operation:'ticket_handoff',arguments:{ticket,note,target:{kind:'id',id:103,name:'Example Colleague'}},request_key:'cancel-running-handoff'});const original=s.adapter.createTicketNote.bind(s.adapter);s.adapter.createTicketNote=async(...args)=>{const result=await original(...args);await s.control.cancel(p,job.id);return result;};await s.worker.tick();assert.equal(s.adapter.records.TicketNotes.length,106);assert.equal(s.adapter.records.Tickets[0]!.assignedResourceID,101);assert.equal((await s.control.job(p,job.id)).state,'uncertain');
});
test('supporting discovery, invocation and dry validation preserve direct-tool policy and perform no hidden writes',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;const described=await s.runtime.invoke(p,'at_describe',{operation:'ticket_resolve'}) as any;assert.equal(described.schema.additionalProperties,false);assert.equal(described.execution_authorized,false);
  for(const operation of ['ticket_update','ticket_document_work','ticket_handoff','ticket_resolve','service_call_create']){const args=operation==='ticket_update'?{ticket,changes:{title:'Validated only'},expected:{title:'Example printer offline'}}:operation==='ticket_handoff'?{ticket,note,target:{kind:'id',id:103,name:'Example Colleague'}}:operation==='ticket_resolve'?{ticket,note,time,completion_status:{kind:'name',name:'Complete'}}:operation==='service_call_create'?{ticket,resources:[{kind:'self'}],start:'2026-09-12T09:00:00-05:00',end:'2026-09-12T10:00:00-05:00',timezone:'America/Chicago'}:{ticket,note,time};const result=await s.runtime.invoke(p,'at_validate',{operation,arguments:args}) as any;assert.equal(result.valid,true);assert.equal(result.effects,'none');assert.equal(result.execution_authorized,false);}assert.equal(s.journal.inspectAll().length,0);assert.equal(s.adapter.records.TicketNotes.length,105);
  await s.control.setControls(p,{writePaused:false,tools:{ticket_note_add:false}},0);await assert.rejects(s.runtime.invoke(p,'at_invoke',{operation:'ticket_note_add',arguments:{ticket,note},request_key:'wrapper-cannot-bypass'}),e=>e instanceof AppError&&e.code==='forbidden');await assert.rejects(s.runtime.invoke(p,'at_invoke',{operation:'at_invoke',arguments:{}}));
  const job=await s.runtime.enqueue(p,{operation:'ticket_update',arguments:{ticket,changes:{title:'Queued safe title'},expected:{title:'Example printer offline'}},request_key:'reserved-job-test'});await assert.rejects(s.runtime.invoke(p,'ticket_update',{ticket,changes:{title:'Poisoned job result'},expected:{title:'Example printer offline'},request_key:`job:${job.id}`}),e=>e instanceof AppError&&e.code==='invalid_input');await s.worker.tick();assert.equal((await s.control.job(p,job.id)).state,'succeeded');assert.equal(s.adapter.records.Tickets[0]!.title,'Queued safe title');
});
test('reviewed query wrappers enforce filters, projections, actual child parent and self-time scope',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;const companies=await s.runtime.invoke(p,'at_query',{entity:'Companies'}) as any;assert.deepEqual(companies.data.items.map((r:any)=>r.id),[10]);const first=await s.runtime.invoke(p,'at_related',{parent:{entity:'Tickets',id:1001},relation:'notes',page_size:25}) as any;assert.equal(first.data.items.length,25);assert.equal(first.completeness.complete,false);const next=await s.runtime.invoke(p,'at_related',{parent:{entity:'Tickets',id:1001},relation:'notes',page_size:25,cursor:first.completeness.next_cursor}) as any;assert.notEqual(next.data.items[0].id,first.data.items[0].id);
  const time=await s.runtime.invoke(p,'at_get',{entity:'TimeEntries',id:4001,ticket_id:1001,fields:['summaryNotes','hoursWorked']}) as any;assert.equal(time.data.item.hoursWorked,.5);assert(!JSON.stringify(time).includes('hourlyBillingRate'));for(const args of [{entity:'Tickets',filter:{op:'and',conditions:[{field:'estimatedCost',op:'gte',value:0}]}},{entity:'Tickets',fields:['secretCanary']},{entity:'TicketNotes'},{entity:'TimeEntries',ticket_id:2001}])await assert.rejects(s.runtime.invoke(p,'at_query',args));await assert.rejects(s.runtime.invoke(p,'at_get',{entity:'TimeEntries',id:4002,ticket_id:1001}));await assert.rejects(s.runtime.invoke(p,'at_get',{entity:'TicketNotes',id:3000,ticket_id:2001}));
  const none=await s.runtime.invoke(p,'time_entry_search',{ticket,date_from:'2026-09-11',date_to:'2026-09-11'}) as any;assert.equal(none.data.entries.length,0);await assert.rejects(s.runtime.invoke(p,'time_entry_search',{ticket,date_from:'2026-09-12',date_to:'2026-09-10'}));
});
test('protected exports are usable through authenticated console and MCP, with scope checks on every download',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const auth=await login(s),created=await(await admin(s,auth,'api/artifacts/export',{ticket,collection:'ticket'})).json();assert.equal(created.status,'succeeded');const id=created.data.artifact_id;assert(id);t.after(async()=>{try{await s.artifacts.remove(s.principals[0]!,{artifact_id:id});}catch{}});
  const download=await admin(s,auth,`api/artifacts/${id}/download`);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/^attachment;/);assert.match(await download.text(),/Example printer offline/);const chunk=(await rpc(s,'at_artifact_get',{artifact_id:id,offset:0,length:32})).structuredContent;assert.equal(Buffer.from(chunk.content_base64,'base64').length,32);assert.equal(chunk.next_offset,32);const reader=await login(s,true);assert.notEqual((await admin(s,reader,`api/artifacts/${id}/download`)).status,200);
  const staged=await admin(s,auth,'api/artifacts/stage',{ticket,filename:'example.txt',mime:'text/plain',content_base64:Buffer.from('Fictitious upload').toString('base64')});assert.equal(staged.status,200);const stagedResult=await staged.json();const stagedId=stagedResult.data.artifact_id;assert(stagedId);t.after(async()=>{try{await s.artifacts.remove(s.principals[0]!,{artifact_id:stagedId});}catch{}});assert.equal(await(await admin(s,auth,`api/artifacts/${stagedId}/download`)).text(),'Fictitious upload');assert.equal((await s.artifacts.list(s.principals[0]!,{})).data.artifacts.length,2);assert.equal((await admin(s,auth,'api/artifacts/delete',{artifact_id:id})).status,200);assert.notEqual((await admin(s,auth,`api/artifacts/${id}/download`)).status,200);
});
test('all public ticket workflows accept a reviewed native URL and reject other hosts before mutations',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const native={kind:'ticket_url',value:'https://ww1.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx?Code=OpenTicket&TicketID=1001'};const result=await s.runtime.invoke(s.principals[0]!,'ticket_document_work',{ticket:native,note,time,request_key:'public-ticket-url'}) as any;assert.equal(result.status,'succeeded_verified');await assert.rejects(s.runtime.invoke(s.principals[0]!,'ticket_note_add',{ticket:{...native,value:native.value.replace('ww1.autotask.net','untrusted.invalid')},note,request_key:'bad-public-ticket-url'}));assert.equal(s.adapter.records.TicketNotes.length,106);
});
test('schedule response and artifact list cannot return earlier evidence after employee-wide revocation',async t=>{const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,original=s.schedulingPort.search.bind(s.schedulingPort);s.schedulingPort.search=async(...args)=>{const result=await original(...args);await s.control.setControls(p,{writePaused:false,tools:{schedule_search:false}},0);return result;};await assert.rejects(s.runtime.invoke(p,'schedule_search',{start:'2026-09-10T00:00:00-05:00',end:'2026-09-11T00:00:00-05:00',timezone:'America/Chicago'}));
  const list=s.artifacts.catalog.list.bind(s.artifacts.catalog);s.artifacts.catalog.list=async(...args)=>{const result=await list(...args);await s.control.saveMember(p,{objectId:p.objectId,resourceId:p.resourceId,active:false,capabilities:p.capabilities,companyIds:p.companyIds},p.mappingVersion);return result;};await assert.rejects(s.artifacts.list(p,{}));
});

test('authoring guidance reaches MCP tool listing and describe without an extra authoring tool',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const listed=await rpc(s);
 for(const name of ['ticket_update','ticket_note_add','ticket_document_work','ticket_resolve','time_log_ticket']){
  const tool=listed.tools.find((v:any)=>v.name===name);assert(tool);assert.match(tool.description,/preserve uncertainty and scope/);assert.match(tool.description,/Ticket financial privacy:/);assert.match(tool.description,/including internal notes/);assert.match(tool.description,/quantities, model numbers, dates/);if(['ticket_update','ticket_resolve'].includes(name)){assert.match(tool.description,/Status maintenance:/);assert.match(tool.description,/substantive work has already been performed/);}else assert.doesNotMatch(tool.description,/Status maintenance:/);
  const described=await s.runtime.invoke(s.principals[0]!,'at_describe',{operation:name}) as any;assert.equal(described.description,tool.description);
 }
 assert.equal(listed.tools.some((v:any)=>v.name==='authoring_review'),false);
 assert.equal(s.journal.inspectAll().length,0);
});

test('report wrappers honor disabled source tools and cannot bypass their controls',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
 await s.control.setControls(p,{writePaused:false,tools:{ticket_search:false}},0);
 await assert.rejects(s.runtime.invoke(p,'ticket_workload_report',{filters:{technician:{kind:'self'}}}),e=>e instanceof AppError&&e.code==='forbidden');
});

test('time-entry clock returns a fresh instant and local date through authenticated MCP',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const before=Date.now();
 const r=await rpc(s,'time_entry_clock',{timezone:'America/Chicago'});
 const data=r.structuredContent?.data??JSON.parse(r.content[0].text).data;
 assert.ok(Date.parse(data.current_datetime)>=Math.floor(before/1000)*1000&&Date.parse(data.current_datetime)<=Date.now());
 assert.equal(data.timezone,'America/Chicago');assert.match(data.local_date,/^\d{4}-\d{2}-\d{2}$/);
 const invalid=await rpc(s,'time_entry_clock',{timezone:'not/a/timezone'});assert.equal(invalid.isError,true);
});


test('stale time schemas fail before ticket lookup or journal reservation with actionable recovery',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
 let reads=0;const get=s.adapter.get.bind(s.adapter);s.adapter.get=async(...args)=>{reads++;return get(...args);};
 const {start_datetime,...stale}=time;
 for(const [name,input] of [
  ['time_log_ticket',{ticket,time:stale,request_key:'stale-client-no-write'}],
  ['at_invoke',{operation:'time_log_ticket',arguments:{ticket,time:stale},request_key:'stale-client-wrapper'}],
  ['at_validate',{operation:'time_log_ticket',arguments:{ticket,time:stale}}],
  ['ticket_document_work',{ticket,note,time:stale,request_key:'stale-document-no-note'}]
 ] as const)await assert.rejects(s.runtime.invoke(p,name,input),e=>e instanceof AppError&&e.code==='invalid_input'&&e.message.includes('at_invoke'));
 assert.equal(reads,0);assert.equal(s.journal.inspectAll().length,0);
 const receipt=await s.runtime.invoke(p,'at_invoke',{operation:'time_log_ticket',arguments:{ticket,time:{...time,minutes:22}},request_key:'current-schema-recovery'}) as any;
 assert.equal(receipt.status,'succeeded_verified');
 const row=s.adapter.records.TimeEntries.at(-1)!;assert.equal(row.hoursWorked,22/60);assert.equal(row.endDateTime,'2026-09-10T14:22:00.000Z');
});

test('five supporting tools run through MCP, exports download intact, and switches block discovery and execution',async t=>{
  const {createHash}=await import('node:crypto');const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
  const inputs:Record<string,unknown>={my_workday:{date:'2026-09-10',timezone:'America/Chicago'},ticket_prepare_visit:{ticket,date:'2026-09-10',timezone:'America/Chicago'},at_playbook_list:{},at_playbook_get:{id:'time_review'},at_artifact_export:{ticket,collection:'ticket'}};
  for(const [name,input] of Object.entries(inputs).filter(([name])=>name!=='at_artifact_export')){const result=await rpc(s,name,input);assert.notEqual(result.isError,true,name);assert(result.structuredContent,name);}
  for(const collection of ['ticket','notes','own_time']){
    const result=await rpc(s,'at_artifact_export',{ticket,collection});assert.notEqual(result.isError,true);const exported=result.structuredContent;const id=exported.data.artifact_id;assert(id);
    try{let offset=0;const parts:Buffer[]=[];do{const response=await rpc(s,'at_artifact_get',{artifact_id:id,offset,length:20000});assert.notEqual(response.isError,true);const chunk=response.structuredContent;parts.push(Buffer.from(chunk.content_base64,'base64'));if(chunk.next_offset===null)break;assert(chunk.next_offset>offset);offset=chunk.next_offset;}while(true);
      const bytes=Buffer.concat(parts);assert.equal(bytes.length,exported.data.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),exported.data.sha256);assert.match(bytes.toString(),/^"id",/);
    }finally{await s.artifacts.remove(p,{artifact_id:id});}
  }
  assert.equal(s.journal.inspectAll().length,0);
  await s.control.setControls(p,{writePaused:false,tools:Object.fromEntries(Object.keys(inputs).map(name=>[name,false]))},0);
  const listed=await rpc(s);for(const [name,input] of Object.entries(inputs)){assert(!listed.tools.some((tool:any)=>tool.name===name));await assert.rejects(s.runtime.invoke(p,name,input),e=>e instanceof AppError&&e.code==='forbidden');}
});

test('wire discovery declares ChatGPT file input and stages a large image without a large MCP body',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());
 const listing=(await rpc(s)).tools;
 const stage=listing.find((v:any)=>v.name==='at_file_stage');assert.deepEqual(stage._meta['openai/fileParams'],['file']);
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100_000)]);let downloads=0;
 t.mock.method(globalThis,'fetch',async()=>{downloads++;return new Response(bytes,{headers:{'content-type':'image/png'}});});
 const args={ticket:{kind:'id',id:1001},file:{file_id:'file-test',download_url:'https://files.oaiusercontent.com/test',file_name:'screenshot.png',mime_type:'image/png'}};
 const result=(await rpc(s,'at_file_stage',args)).structuredContent;assert.equal(result.status,'staged');assert.equal(result.data.bytes,bytes.length);assert.equal(downloads,1);
 const staged=await s.artifacts.download(s.principals[0]!,{artifact_id:result.data.artifact_id});assert.deepEqual(staged.bytes,bytes);t.after(()=>s.artifacts.remove(s.principals[0]!,{artifact_id:result.data.artifact_id}));
 const denied=(await rpc(s,'at_file_stage',{...args,ticket:{kind:'id',id:2001}})).structuredContent;assert.equal(denied.status,'failed');assert.equal(downloads,1,'Unauthorized parents cannot trigger file downloads');
 const malformed=(await rpc(s,'at_file_stage',{...args,file:{...args.file,file_name:'../wrong.pdf'}})).structuredContent;assert.equal(malformed.status,'failed');
});

test('direct, wrapped and queued handoffs cannot save notes for a mismatched target identity',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!,count=s.adapter.records.TicketNotes.length;
 const args={ticket,target:{kind:'id',id:103,name:'Wrong Employee'},note,request_key:'identity-handoff-direct'};
 await assert.rejects(s.runtime.invoke(p,'ticket_handoff',args),(e:any)=>e.code==='conflict');
 await assert.rejects(s.runtime.invoke(p,'at_invoke',{operation:'ticket_handoff',arguments:args}),(e:any)=>e.code==='conflict');
 const job=await s.runtime.enqueue(p,{operation:'ticket_handoff',arguments:args,request_key:'identity-handoff-job'});await s.worker.tick();
 assert.notEqual((await s.control.job(p,job.id)).state,'succeeded');assert.equal(s.adapter.records.TicketNotes.length,count);assert.equal(s.adapter.records.Tickets[0]!.assignedResourceID,101);
});
