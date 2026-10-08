import { SERVER_RELEASE, toolMetadataDigest } from '../apps/server/src/publication.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { createApplication } from '../apps/server/src/app.js';
import { ToolRuntime, operationCatalog } from '../apps/server/src/tool-runtime.js';
import { CONTROL_CAPABILITIES } from '../packages/control-plane/src/index.js';
import { PlaybookService } from '../packages/playbooks/src/index.js';
import { outputSchemaFor, successSchemaFor, outputJsonSchema } from '../apps/server/src/output-contracts.js';
import { AppError } from '../packages/contracts/src/index.js';
const ticket={kind:'id',id:1001};
const time={work_date:'2026-09-10',timezone:'America/Chicago',minutes:22,start_datetime:'2026-09-10T09:00:00-05:00',timing_source:'calendar',summary:'Fictitious 22-minute meeting'};
const note={title:'Fixture work',text:'Supplied fixture facts',audience:'internal'};
type App=ReturnType<typeof createApplication>;
async function rpc(app:App,token:string,name?:string,args:unknown={},modern=true){
 const method=name?'tools/call':'tools/list';const version=modern?'2026-07-28':'2025-11-25';
 const r=await app.fetch(new Request('http://127.0.0.1:3030/mcp',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':version,...(modern?{'mcp-method':method,...(name?{'mcp-name':name}:{})}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...(modern?{_meta:{'io.modelcontextprotocol/protocolVersion':version,'io.modelcontextprotocol/clientInfo':{name:'output-contract-test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}:{}),...(name?{name,arguments:args}:{})}})}));
 assert.equal(r.status,200);const raw=await r.text();const body=r.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(raw.split('\n').find(line=>line.startsWith('data: '))!.slice(6)):JSON.parse(raw);assert(!body.error,JSON.stringify(body));return body.result;
}
function content(r:any){assert(r.structuredContent,JSON.stringify(r));assert.equal(r.content[0].type,'text');assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);return r.structuredContent;}

test('every configured and generated tool exposes an object output contract on both MCP wire versions',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p={...s.principals[0]!,capabilities:[...CONTROL_CAPABILITIES]};
 const runtime=new ToolRuntime({...s,selection:s.runtime.options.selection,reports:s.runtime.options.reports,itglue:{enabled:async()=>({reads:true,writes:true})} as any,rmm:{enabled:async()=>({reads:true,jobs:true})} as any,playbooks:new PlaybookService(s.store),business:{} as any,sales:{} as any,operational:{} as any,ticketCreation:{} as any,secondaryResources:{} as any,ticketTags:{} as any,ticketChecklistLibraries:{} as any,workManagement:{} as any,attachments:{} as any,opportunityAttachments:{} as any,checklists:{} as any,workMetadata:{} as any,webhookInbox:{} as any});
 const app=createApplication({publicUrl:'http://127.0.0.1:3030',authenticate:async()=>p,workflows:s.core,writes:s.writes,runtime});t.after(()=>app.close());
 assert.deepEqual(runtime.tools.map(v=>v.name).sort(),Object.keys(operationCatalog).sort());
 for(const modern of [false,true]){
  const listed=await rpc(app,'fixture',undefined,{},modern);assert.equal(listed.tools.length,Object.keys(operationCatalog).length);const discoveryBytes=Buffer.byteLength(JSON.stringify(listed));t.diagnostic(`Full discovery (${modern?'modern':'legacy'}): ${discoveryBytes} bytes`);assert(discoveryBytes<1800000,'Full discovery must retain at least 200 KB headroom below the reported 2 MB connector object limit');
  const update=listed.tools.find((tool:any)=>tool.name==='ticket_update');assert(update.inputSchema.properties.changes.properties.role);assert.match(update.description,/expected.assignedResourceRoleID/);
  const creation=listed.tools.find((tool:any)=>tool.name==='ticket_create');assert(creation.inputSchema.properties.issue_type);assert(creation.inputSchema.properties.sub_issue_type);assert(creation.inputSchema.properties.creation_assumptions);assert.match(creation.description,/After verified creation/);assert.doesNotMatch(creation.description,/missing business details require user input/);
  for(const tool of listed.tools){assert.doesNotMatch(tool.description,/scanner-verified|malware scanning|configured scanner|configured scanning/i);if(/_(update|delete|correct|cancel)$/.test(tool.name)&&!tool.annotations.readOnlyHint&&tool.name!=='at_job_cancel')assert.equal(tool.annotations.destructiveHint,true,tool.name);if(['time_log_ticket','ticket_note_add','asset_create'].includes(tool.name))assert.equal(tool.annotations.destructiveHint,false,tool.name);assert(tool.outputSchema,tool.name);assert.equal(tool.outputSchema.type,'object',tool.name);assert(tool.outputSchema.anyOf,tool.name);assert.equal(successSchemaFor(tool.name).safeParse({}).success,false,tool.name);if(tool.name!=='at_invoke')assert.equal(outputSchemaFor(tool.name).safeParse({arbitrary:'response'}).success,false,tool.name);}
 }
 const legacy=createApplication({publicUrl:'http://127.0.0.1:3030',authenticate:async()=>p,workflows:s.core,writes:s.writes});t.after(()=>legacy.close());
 for(const modern of [false,true])for(const tool of (await rpc(legacy,'fixture',undefined,{},modern)).tools){assert(tool.outputSchema,tool.name);assert.equal(tool.outputSchema.type,'object');}
 assert.throws(()=>outputSchemaFor('unreviewed_new_tool'),/Missing output contract/);
});

test('read, projected query, pagination and incomplete context preserve structured and text contracts',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const token=s.tokens[0]!.token;
 for(const modern of [false,true]){
  for(const [name,args] of [['at_whoami',{}],['ticket_search',{page_size:1}],['ticket_context',{ticket,purpose:'custom',collections:['notes','assets'],max_pages:1}],['at_query',{entity:'Tickets',fields:['title'],page_size:1}],['at_get',{entity:'Tickets',id:1001,fields:['title']}],['time_entry_search',{ticket,page_size:1}],['my_workday',{date:'2026-09-10',timezone:'America/Chicago'}]] as const){const r=await rpc(s.app,token,name,args,modern);assert(!r.isError,JSON.stringify(r));const v=content(r);assert(outputSchemaFor(name).safeParse(v).success,name);}
 }
 const first=content(await rpc(s.app,token,'ticket_context',{ticket,purpose:'custom',collections:['notes'],max_pages:1}));assert.equal(first.status,'partial');const notes=first.data.collections.notes;assert.equal(notes.complete_within_scope,false);assert.equal(typeof notes.continuation,'string');
 const next=content(await rpc(s.app,token,'ticket_context',{ticket,purpose:'custom',collections:['notes'],max_pages:1,cursors:{notes:notes.continuation}}));assert.notEqual(next.data.collections.notes.items[0].id,notes.items[0].id);
 assert.equal(successSchemaFor('ticket_search').safeParse({status:'partial',data:[],completeness:{complete:false,returned:'one',next_cursor:'cursor'}}).success,false);
});

test('verified time requires saved entry ID and preserves exact interval, duration, provenance and replay',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const args={ticket,time,request_key:'output-time-contract'};
 const r=await rpc(s.app,s.tokens[0]!.token,'time_log_ticket',args);assert(!r.isError,JSON.stringify(r));const value=content(r);
 assert.equal(value.status,'succeeded_verified');assert.equal(value.data.ticket_id,1001);assert(value.data.time_entry_id);assert.equal(value.data.start_datetime,'2026-09-10T14:00:00.000Z');assert.equal(value.data.end_datetime,'2026-09-10T14:22:00.000Z');assert.equal(value.data.hours_worked,22/60);assert.equal(value.data.timezone,'America/Chicago');assert.equal(value.data.verification.performed,true);
 const broken=structuredClone(value);delete broken.data.time_entry_id;assert.equal(outputSchemaFor('time_log_ticket').safeParse(broken).success,false);
 const unverified=structuredClone(value);unverified.data.verification.performed=false;assert.equal(outputSchemaFor('time_log_ticket').safeParse(unverified).success,false);
 const replay=content(await rpc(s.app,s.tokens[0]!.token,'time_log_ticket',args,false));assert.equal(replay.operation_id,value.operation_id);assert.equal(s.adapter.records.TimeEntries.length,3);
 const old=structuredClone(value);delete old.data.start_datetime;delete old.data.end_datetime;delete old.data.timezone;delete old.data.hours_worked;assert(outputSchemaFor('time_log_ticket').safeParse(old).success,'Legacy fields must not be invented');
});

test('partial document, definitive failure and unknown effects remain distinct and never redispatch saved effects',async t=>{
 for(const outcome of ['failed','unknown_outcome'] as const){const s=createFixtureSystem();t.after(()=>s.app.close());let calls=0;const original=s.adapter.createTicketTime.bind(s.adapter);
  s.adapter.createTicketTime=async(...args)=>{calls++;if(outcome==='unknown_outcome'){await original(...args);throw new AppError('unknown_outcome','Fictitious lost acknowledgment');}throw new AppError('invalid_input','Fictitious rejected time');};
  const args={ticket,note,time,request_key:`contract-document-${outcome}`};const r=content(await rpc(s.app,s.tokens[0]!.token,'ticket_document_work',args));assert.equal(r.status,outcome==='failed'?'partial':'unknown_outcome');assert.equal(r.data.steps.note.state,'succeeded_verified');assert.equal(r.data.steps.time.state,outcome);assert.equal(r.safe_to_redispatch,false);assert(outputSchemaFor('ticket_document_work').safeParse(r).success);
  const replay=content(await rpc(s.app,s.tokens[0]!.token,'ticket_document_work',args));assert.equal(replay.operation_id,r.operation_id);assert.equal(calls,1);
 }
 const s=createFixtureSystem();t.after(()=>s.app.close());const denied=await rpc(s.app,s.tokens[0]!.token,'ticket_context',{ticket:{kind:'id',id:2001}});assert.equal(denied.isError,true);assert(outputSchemaFor('ticket_context').safeParse(content(denied)).success);
});

test('application contract defects preserve recovery reference and SDK also detects invalid normal output',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const run=s.writes.timeLog.bind(s.writes);
 s.writes.timeLog=async(...args)=>{const v=await run(...args);delete v.data.time_entry_id;return v;};
 const r=await rpc(s.app,s.tokens[0]!.token,'time_log_ticket',{ticket,time,request_key:'malformed-write-receipt'});const v=content(r);assert.equal(r.isError,true);assert.equal(v.status,'output_contract_error');assert.equal(v.observed_status,'succeeded_verified');assert.equal(v.safe_to_redispatch,false);assert(v.operation_id);assert.equal(s.adapter.records.TimeEntries.length,3);assert(outputSchemaFor('time_log_ticket').safeParse(v).success);
 // Force the installed SDK to reject a valid runtime response using a different
 // registered contract; app validation already passed, so this exercises the SDK.
 s.runtime.tools.find(t=>t.name==='time_entry_clock')!.outputSchema=z.object({mandatory_sdk_test_field:z.string()});
 const sdk=await rpc(s.app,s.tokens[0]!.token,'time_entry_clock',{timezone:'America/Chicago'});assert.equal(sdk.isError,true);assert.match(JSON.stringify(sdk.content),/Output validation error/);
});

test('metadata describes output contracts and generic invocation preserves the selected tool contract',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const r=content(await rpc(s.app,s.tokens[0]!.token,'at_describe',{operation:'time_log_ticket'}));assert.equal(r.output_schema_version,'autotask-output-v1');assert.deepEqual(r.output_schema,outputJsonSchema('time_log_ticket'));
 const wrapped=content(await rpc(s.app,s.tokens[0]!.token,'at_invoke',{operation:'time_log_ticket',arguments:{ticket,time},request_key:'contract-generic-time'}));assert.equal(wrapped.status,'succeeded_verified');assert(successSchemaFor('time_log_ticket').safeParse(wrapped).success);
});

test('standalone uncertain and rejected time receipts do not require or invent a saved ID',async t=>{
 for(const outcome of ['unknown_outcome','failed'] as const){
  const s=createFixtureSystem();t.after(()=>s.app.close());let calls=0;
  const original=s.adapter.createTicketTime.bind(s.adapter);
  s.adapter.createTicketTime=async(...args)=>{calls++;if(outcome==='unknown_outcome')await original(...args);throw new AppError(outcome==='failed'?'invalid_input':'unknown_outcome','Fictitious write result');};
  const args={ticket,time,request_key:`standalone-contract-${outcome}`};const r=content(await rpc(s.app,s.tokens[0]!.token,'time_log_ticket',args));
  assert.equal(r.status,outcome);assert.equal(r.data.time_entry_id,undefined);assert.equal(r.data.verification,undefined);assert.equal(r.safe_to_redispatch,false);assert(outputSchemaFor('time_log_ticket').safeParse(r).success);
  await rpc(s.app,s.tokens[0]!.token,'time_log_ticket',args);assert.equal(calls,1);
 }
});

test('SDK skips normal output validation for isError; application errors remain independently validated',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const clock=s.runtime.tools.find(v=>v.name==='time_entry_clock')!;
 clock.outputSchema=z.object({mandatory_sdk_test_field:z.string()});
 clock.run=async()=>{throw new AppError('unknown_outcome','Fictitious lost acknowledgment');};
 const r=await rpc(s.app,s.tokens[0]!.token,'time_entry_clock',{timezone:'America/Chicago'});const v=content(r);
 assert.equal(r.isError,true);assert.equal(v.status,'unknown_outcome');assert.equal(v.error.code,'unknown_outcome');assert(outputSchemaFor('time_entry_clock').safeParse(v).success);
 assert.equal(outputSchemaFor('time_entry_clock').safeParse({status:'failed',correlation_id:v.correlation_id,error:{code:'forbidden'}}).success,false);
});

test('wire normalization preserves PostgreSQL date values and optional fields without inventing content',async()=>{
 const {validateOutput}=await import('../apps/server/src/output-validation.js');
 const input={configured_subscriptions:1,streams:[{webhook_guid:'fixture-guid',entity_type:'Tickets',received:1,latest_sequence:'1',last_received:new Date('2026-09-15T12:00:00Z'),saw_deactivation:false,optional:undefined}],sequence_gaps:0,limitations:[]};
 const wire=validateOutput('sync_status',input);assert.deepEqual(wire,JSON.parse(JSON.stringify(input)));
});


test('stateless runtime and legacy discovery explicitly decline notifications and identify the release',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());
 const legacy=createApplication({publicUrl:'http://127.0.0.1:3030',authenticate:async()=>s.principals[0]!,workflows:s.core,writes:s.writes});t.after(()=>legacy.close());
 for(const app of [s.app,legacy])for(const modern of [false,true]){
  const version=modern?'2026-07-28':'2025-11-25',method=modern?'server/discover':'initialize';
  const params=modern?{_meta:{'io.modelcontextprotocol/protocolVersion':version,'io.modelcontextprotocol/clientInfo':{name:'publication-test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}:{protocolVersion:version,capabilities:{},clientInfo:{name:'publication-test',version:'1'}};
  const response=await app.fetch(new Request('http://127.0.0.1:3030/mcp',{method:'POST',headers:{authorization:`Bearer ${s.tokens[0]!.token}`,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':version,...(modern?{'mcp-method':method}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
  assert.equal(response.status,200);const raw=await response.text();const body=JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')?raw.split('\n').find(v=>v.startsWith('data: '))!.slice(6):raw);
  assert.equal(body.result.capabilities.tools.listChanged,false);
  assert.equal((body.result.serverInfo??body.result._meta['io.modelcontextprotocol/serverInfo']).version,SERVER_RELEASE);
 }
});

test('publication diagnostics fingerprint available metadata and detect schema, description and annotation changes',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
 const tools=await s.runtime.available(p);const digest=toolMetadataDigest(tools);
 assert.equal(toolMetadataDigest([...tools].reverse()),digest);
 assert.notEqual(toolMetadataDigest(tools.slice(1)),digest);
 const first=tools[0]!;
 for(const change of [{description:first.description+' changed'},{schema:z.object({new_field:z.string()})},{outputSchema:z.object({new_result:z.string()})},{destructive:!first.destructive}])assert.notEqual(toolMetadataDigest([{...first,...change},...tools.slice(1)]),digest);
 const result=content(await rpc(s.app,s.tokens[0]!.token,'at_diagnostics',{}));
 assert.equal(result.server_release,SERVER_RELEASE);assert.equal(result.metadata_sha256,digest);assert.equal(result.tool_change_notifications,false);assert.equal(result.client_refresh_required,true);
});


test('native nullable time notes survive MCP output validation without invented text',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());
 const row={id:35575,resourceID:29682920,ticketID:40859,taskID:null,hoursWorked:0.5,dateWorked:'2026-09-15T00:00:00.000Z',startDateTime:'2026-09-15T18:53:55.120Z',endDateTime:'2026-09-15T19:23:55.120Z',summaryNotes:null,internalNotes:null};
 const runtime=new ToolRuntime({...s,selection:s.runtime.options.selection,reports:s.runtime.options.reports,itglue:{enabled:async()=>({reads:true,writes:true})} as any,rmm:{enabled:async()=>({reads:true,jobs:true})} as any,playbooks:new PlaybookService(s.store),workManagement:{getTime:async()=>({status:'succeeded',data:row,provenance:{source:'fixture'}})} as any});
 const app=createApplication({publicUrl:'http://127.0.0.1:3030',authenticate:async()=>s.principals[0]!,workflows:s.core,writes:s.writes,runtime});t.after(()=>app.close());
 for(const modern of [false,true]){const r=await rpc(app,s.tokens[0]!.token,'time_get',{id:35575},modern);assert(!r.isError,JSON.stringify(r));const {web_url,...data}=content(r).data;assert.equal(typeof web_url,'string');assert.deepEqual(data,row);}
 assert.equal(successSchemaFor('time_get').safeParse({status:'succeeded',data:{...row,internalNotes:42},provenance:{source:'fixture'}}).success,false);
});

test('current-time fallback supplies an exact whole-second interval for strict verification',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());
 const clock=content(await rpc(s.app,s.tokens[0]!.token,'time_entry_clock',{timezone:'America/Chicago'})).data;
 assert.equal(Date.parse(clock.current_datetime)%1000,0);
 // Use the real clock anchor with the fixture work date so metadata stays valid.
 const end='2026-09-10T19:23:'+clock.current_datetime.slice(17);
 const r=content(await rpc(s.app,s.tokens[0]!.token,'time_log_ticket',{ticket,time:{work_date:'2026-09-10',timezone:'Etc/UTC',minutes:30,end_datetime:end,timing_source:'current_time',summary:'Fixture clock precision check'},request_key:'whole-second-time'}));
 assert.equal(r.status,'succeeded_verified');assert.equal(r.data.end_datetime,end);assert.equal(Date.parse(r.data.end_datetime)-Date.parse(r.data.start_datetime),30*60000);
});

test('MCP exposes due-date updates and requires titles in every ticket reference',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const row=s.adapter.records.Tickets.find(r=>r.id===1001)!;row.dueDateTime='2026-09-15T22:00:00.000Z';
 const listed=await rpc(s.app,s.tokens[0]!.token);const update=listed.tools.find((t:any)=>t.name==='ticket_update');
 assert(update.inputSchema.properties.changes.properties.due_datetime);assert.match(update.description,/Every ticket row needs its title/);
 const args={ticket,changes:{due_datetime:'2026-09-25T17:00:00-05:00'},expected:{dueDateTime:row.dueDateTime},request_key:'fixture-due-date-update'};
 const result=content(await rpc(s.app,s.tokens[0]!.token,'ticket_update',args));assert.equal(result.status,'succeeded_verified');assert.equal(row.dueDateTime,'2026-09-25T22:00:00.000Z');
 const replay=content(await rpc(s.app,s.tokens[0]!.token,'ticket_update',args));assert.equal(replay.operation_id,result.operation_id);
});
