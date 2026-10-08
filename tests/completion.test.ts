import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, type Principal } from '../packages/contracts/src/index.js';
import { reauthorize, validateQuery } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';
import { TechnicianWorkflows } from '../packages/workflows/src/technician-workflows.js';
import { CompletionWorkflows, completionWindow } from '../packages/workflows/src/completion-workflows.js';
import { QueryWorkflows } from '../packages/workflows/src/query-workflows.js';
import { FixtureTechnicianPort } from '../packages/technician/src/fixtures.js';
import { TechnicianDomain } from '../packages/technician/src/index.js';
import { classifyHistoryStatus } from '../packages/technician/src/history-status.js';
import { FixtureSchedulingPort } from '../packages/scheduling/src/fixtures.js';
import { SchedulingWorkflows } from '../packages/scheduling/src/index.js';
import { validateOutput } from '../apps/server/src/output-validation.js';
import { addTicketLinks } from '../apps/server/src/ticket-links.js';
const now=Date.parse('2026-09-18T18:00:00Z');
const window={period:'yesterday' as const,timezone:'America/Chicago'};
function setup(){
 const [p,peer]=fixturePrincipals() as [Principal,Principal],store=new MemoryPrincipalStore([p,peer]);
 const base=new FixtureAutotaskAdapter(p=>reauthorize(p,store)),core=new TicketWorkflows(base,store,new MemoryJournal()),cipher=new IntentCipher(Buffer.alloc(32,4));
 const port=new FixtureTechnicianPort(base,store),domain=new TechnicianDomain(port,store),writes=new TicketWriteWorkflows(core,cipher),scheduling=new SchedulingWorkflows(core,new FixtureSchedulingPort(base,store),cipher),flows=new TechnicianWorkflows(core,writes,domain,scheduling,cipher);
 const tick=base.records.Tickets[0]!;Object.assign(tick,{createDate:'2026-09-01T00:00:00Z',lastActivityDate:'2026-09-18T12:00:00Z',status:2,assignedResourceID:103,completedDate:null,completedByResourceID:null});
 port.records.history=[];
 const catalog=port.catalog.bind(port);port.catalog=async(...args)=>{const c=await catalog(...args);if(args[1]==='status')c.items.push(...[{id:48,label:'Complete (With CSAT)'},{id:49,label:'Canceled'},{id:50,label:'Duplicate'}].map(v=>({...v,active:true,companyIds:[10,20]})));return c;};
 const event=(id:number,date:string,resourceID=101,from='In Progress',to='Complete',ticketID=1001)=>({id,ticketID,date,resourceID,action:'Status Changed',detail:`Status changed from ${from}\r\nTime in status:  5m to ${to}`});
 let clock=now;const completion=new CompletionWorkflows(flows,cipher,()=>clock);
 return {p,peer,store,base,port,core,flows,completion,event,tick,setClock:(v:number)=>{clock=v;}};
}
test('local dates use exclusive midnight boundaries, DST, Monday weeks and month/year rollover',()=>{
 const spring=completionWindow({period:'custom',start_date:'2026-03-08',end_date:'2026-03-09',timezone:'America/Chicago'},new Date(now));assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
 const fall=completionWindow({period:'custom',start_date:'2026-11-01',end_date:'2026-11-02',timezone:'America/Chicago'},new Date(now));assert.equal(Date.parse(fall.end)-Date.parse(fall.start),25*3600000);
 assert.equal(completionWindow({period:'this_week',timezone:'America/Chicago'},new Date('2026-09-20T18:00:00Z')).start_date,'2026-09-14');
 assert.equal(completionWindow({period:'last_month',timezone:'UTC'},new Date('2026-01-03T00:00:00Z')).start_date,'2025-12-01');
 assert.throws(()=>completionWindow({period:'custom',start_date:'2026-09-18',end_date:'2026-09-17',timezone:'UTC'},new Date(now)));
 assert.throws(()=>completionWindow({period:'custom',start_date:'2026-01-01',end_date:'2026-09-17',timezone:'UTC'},new Date(now)));
});
test('reopened and reassigned tickets are attributed to actual completer, counted once, and linked',async()=>{
 const s=setup();s.port.records.history.push(s.event(1,'2026-09-17T05:00:00Z'),s.event(2,'2026-09-17T12:00:00Z'),s.event(3,'2026-09-17T15:00:00Z',101,'Complete','Complete (With CSAT)'),s.event(4,'2026-09-18T05:00:00Z'),s.event(5,'2026-09-17T04:59:59.999Z'));
 const r=await s.completion.search(s.p,{window,completed_by:{kind:'self'}});
 assert.equal(r.completeness.complete,true);assert.equal(r.data.items.length,1);assert.equal(r.data.items[0]!.current_state,'reopened');assert.equal(r.data.items[0]!.completion_events.length,2);assert.equal(r.data.counts.total_tickets,1);assert.equal(r.data.counts.total_completion_events,2);
 const linked=addTicketLinks('ticket_completion_search',r,id=>`https://example.invalid/ticket/${id}`) as typeof r;validateOutput('ticket_completion_search',linked);assert.equal(linked.data.items[0]!.ticket.web_url,'https://example.invalid/ticket/1001');
 const owned=await s.completion.search(s.p,{window,completed_by:{kind:'self'},technician:{kind:'self'}});assert.equal(owned.data.items.length,0);
 const current=await s.completion.search(s.p,{window,completed_by:{kind:'self'},current_state:'completed'});assert.equal(current.data.items.length,0);
});
test('other employees, canceled and duplicate actions are excluded; CSAT completion counts',async()=>{
 const s=setup();s.port.records.history.push(s.event(1,'2026-09-17T15:00:00Z',103),s.event(2,'2026-09-17T16:00:00Z',101,'In Progress','Canceled'),s.event(3,'2026-09-17T17:00:00Z',101,'In Progress','Duplicate'),s.event(4,'2026-09-17T18:00:00Z',101,'In Progress','Complete (With CSAT)'));
 const r=await s.completion.search(s.p,{window,completed_by:{kind:'self'}});assert.deepEqual(r.data.items[0]!.completion_events.map(v=>v.history_id),[4]);
 const all=await s.completion.search(s.p,{window});assert.equal(all.data.counts.total_completion_events,2);
});
test('duplicate history rows do not count twice; raw history detail stays private',async()=>{
 const s=setup(),e=s.event(1,'2026-09-17T12:00:00Z');s.port.records.history.push(e,{...e},{...e,id:2,action:'Billing Rate Changed',detail:'SECRET $9999'});
 const r=await s.completion.search(s.p,{window});assert.equal(r.data.counts.total_completion_events,1);assert.doesNotMatch(JSON.stringify(r),/SECRET|Time in status/);
 assert.equal(classifyHistoryStatus({...e,detail:'Status changed from In Progress to Complete; SECRET'}).status_transition_valid,false);
});
test('incomplete and unrecognized histories suppress total counts, including when no matching events are visible',async()=>{
 const s=setup();s.port.records.history.push({...s.event(1,'2026-09-17T12:00:00Z'),detail:'unknown native grammar'});
 let r=await s.completion.search(s.p,{window});assert.equal(r.completeness.complete,false);assert.equal(r.data.counts.total_tickets,null);assert.equal(r.data.counts.incomplete_histories,1);assert.equal(r.completeness.next_cursor,null);
 s.port.records.history=[s.event(1,'2026-09-17T12:00:00Z')];const original=s.port.collection.bind(s.port);s.port.collection=async(...a)=>({...await original(...a),status:'partial',complete_within_scope:false});
 r=await s.completion.search(s.p,{window});assert.equal(r.data.items.length,1);assert.equal(r.data.counts.total_completion_events,null);
});
test('empty pages are resumable; continuations bind filters, identity and the frozen date window',async()=>{
 const s=setup();s.base.records.Tickets.push({...s.tick,id:1002});s.port.records.history.push(s.event(2,'2026-09-17T12:00:00Z',101,'In Progress','Complete',1002));
 const args={window,completed_by:{kind:'self' as const},page_size:1};const first=await s.completion.search(s.p,args);assert.equal(first.data.items.length,0);assert.ok(first.completeness.next_cursor);assert.equal(first.data.counts.total_tickets,null);
 await assert.rejects(s.completion.search(s.p,{...args,completed_by:{kind:'id',id:103},cursor:first.completeness.next_cursor}),/continuation/);
 await assert.rejects(s.completion.search(s.peer,{...args,cursor:first.completeness.next_cursor}),/continuation/);
 s.setClock(now+1000);const last=await s.completion.search(s.p,{...args,cursor:first.completeness.next_cursor});assert.equal(last.data.counts.total_tickets,1);assert.equal(last.data.counts.scanned_tickets,2);assert.deepEqual(last.data.window,first.data.window);assert.equal(last.completeness.complete,true);
 s.setClock(now+16*60000);await assert.rejects(s.completion.search(s.p,{...args,cursor:first.completeness.next_cursor}),/expired/);
});
test('current completion search and generic query filter completing employee and native dates at exact boundaries',async()=>{
 const s=setup();Object.assign(s.tick,{status:5,completedDate:'2026-09-17T05:00:00Z',completedByResourceID:101});s.base.records.Tickets.push({...s.tick,id:1002,completedDate:'2026-09-18T05:00:00Z'},{...s.tick,id:1003,completedByResourceID:103},{...s.tick,id:1004,completedDate:null});
 const r=await s.flows.search(s.p,{completed_by:{kind:'self'},completed_window:{start:'2026-09-17T00:00:00-05:00',end:'2026-09-18T00:00:00-05:00'}});assert.deepEqual(r.data.map(t=>t.id),[1001]);assert.equal(r.data[0]!.completedByResourceID,101);
 const q=await new QueryWorkflows(s.core).query(s.p,{entity:'Tickets',filter:{op:'and',conditions:[{field:'completedByResourceID',op:'eq',value:101},{field:'completedDate',op:'gte',value:'2026-09-17T05:00:00Z'},{field:'completedDate',op:'lt',value:'2026-09-18T05:00:00Z'}]}});assert.deepEqual((q.data as any).items.map((t:any)=>t.id),[1001]);
 assert.throws(()=>validateQuery({entity:'Tickets',filters:[{field:'completedByResourceID',op:'lt',value:101}],pageSize:10},s.p));
});
test('history candidate selection has no upper activity cutoff and never uses current completion or owner as attribution',async()=>{
 const s=setup();s.port.records.history.push(s.event(1,'2026-09-17T12:00:00Z'));const requests:any[]=[];const query=s.base.query.bind(s.base);s.base.query=async(p,r)=>{requests.push(r);return query(p,r);};await s.completion.search(s.p,{window,completed_by:{kind:'self'}});
 const ticket=requests.find(r=>r.entity==='Tickets');assert.ok(ticket.filters.some((f:any)=>f.field==='lastActivityDate'&&f.op==='gte'));assert.ok(!ticket.filters.some((f:any)=>['completedDate','completedByResourceID','assignedResourceID','status'].includes(f.field)));assert.ok(!ticket.filters.some((f:any)=>f.field==='lastActivityDate'&&['lt','lte'].includes(f.op)));
});
test('access revocation during history reads prevents returning records',async()=>{
 const s=setup(),original=s.port.collection.bind(s.port);s.port.records.history.push(s.event(1,'2026-09-17T12:00:00Z'));s.port.collection=async(...args)=>{const r=await original(...args);await s.store.set({...s.p,active:false});return r;};await assert.rejects(s.completion.search(s.p,{window}));
});

test('an exact-ticket audit preserves scope and returns only that ticket',async()=>{
 const s=setup();s.base.records.Tickets.push({...s.tick,id:1002});s.port.records.history.push(s.event(1,'2026-09-17T12:00:00Z'),s.event(2,'2026-09-17T12:00:00Z',101,'In Progress','Complete',1002));
 const r=await s.completion.search(s.p,{window,ticket:{kind:'id',id:1002}});assert.deepEqual(r.data.items.map(v=>v.ticket.id),[1002]);assert.equal(r.data.counts.scanned_tickets,1);
 await assert.rejects(s.completion.search(s.peer,{window,ticket:{kind:'id',id:1002}}));
});
test('status-definition changes and permission changes invalidate history continuations',async()=>{
 const s=setup();s.base.records.Tickets.push({...s.tick,id:1002});const args={window,page_size:1};const r=await s.completion.search(s.p,args);
 const catalog=s.port.catalog.bind(s.port);s.port.catalog=async(...a)=>{const c=await catalog(...a);if(a[1]==='status')c.items[0]!.label='Changed status';return c;};await assert.rejects(s.completion.search(s.p,{...args,cursor:r.completeness.next_cursor}),/definitions changed/);
 await s.store.set({...s.p,companyIds:[10,20]});await assert.rejects(s.completion.search(s.p,{...args,cursor:r.completeness.next_cursor}),/continuation|policy changed/);
});
test('malformed timestamps and missing actors cannot produce complete totals',async()=>{
 for(const change of [{date:'not a date'},{resourceID:0}]){const s=setup();s.port.records.history.push({...s.event(1,'2026-09-17T12:00:00Z'),...change});const r=await s.completion.search(s.p,{window});assert.equal(r.data.counts.total_tickets,null);assert.equal(r.completeness.complete,false);}
});

test('status labels containing to cannot be misparsed as a completion',()=>{
 const row=classifyHistoryStatus({id:1,action:'Status Changed',detail:'Status changed from In Progress\r\nTime in status:  5m to Waiting to Complete'});
 assert.equal(row.status_transition_valid,true);assert.equal(row.to_status,'Waiting to Complete');
 assert.equal(classifyHistoryStatus({id:1,action:'Status Changed',detail:'Status changed from In Progress\r\nTime in status: secret text to Complete'}).status_transition_valid,false);
});
