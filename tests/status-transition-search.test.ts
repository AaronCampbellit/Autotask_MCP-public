import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
import {validateOutput} from '../apps/server/src/output-validation.js';

const created_window={start:'2026-08-01T00:00:00-05:00',end:'2026-09-01T00:00:00-05:00'};
const transition_window={start:'2026-09-01T00:00:00-05:00',end:'2026-10-01T00:00:00-05:00'};
const args={created_window,transition_window,to_status:{kind:'name' as const,name:'Canceled'}};
function setup(){
  const s=createFixtureSystem();
  const catalog=s.technicianPort.catalog.bind(s.technicianPort);
  s.technicianPort.catalog=async(...a)=>{const result=await catalog(...a);if(a[1]==='status')result.items.push({id:49,label:'Canceled',active:true,companyIds:[10,20]});return result;};
  s.adapter.records.Tickets.length=0;
  const ticket=(id:number,createDate:string,lastTrackedModificationDateTime:string,status=49)=>({id,ticketNumber:`T20260801.${id}`,title:`Ticket ${id}`,companyID:10,createDate,lastTrackedModificationDateTime,status});
  const event=(id:number,ticketID:number,date:string,from='In Progress',to='Canceled')=>({id,ticketID,date,resourceID:101,action:'Status Changed',detail:`Status changed from ${from}\r\nTime in status:  5m to ${to}`});
  return{s,ticket,event};
}

test('creation plus tracked-modification filters narrow candidates; history proves September cancellation',async t=>{
  const {s,ticket,event}=setup();t.after(()=>s.app.close());
  s.adapter.records.Tickets.push(
    ticket(101,'2026-08-10T12:00:00Z','2026-10-03T12:00:00Z'), // canceled in September, edited later
    ticket(102,'2026-08-11T12:00:00Z','2026-09-15T12:00:00Z'), // canceled in August, edited in September
    ticket(103,'2026-08-12T12:00:00Z','2026-09-16T12:00:00Z',2), // canceled, then reopened
    ticket(104,'2026-08-13T12:00:00Z','2026-08-20T12:00:00Z'), // no modification after September 1
    ticket(105,'2026-09-01T05:00:00Z','2026-09-16T12:00:00Z'), // created after August local end
  );
  s.technicianPort.records.history.push(event(1,101,'2026-09-10T12:00:00Z'),event(2,102,'2026-08-25T12:00:00Z'),event(3,103,'2026-09-12T12:00:00Z'),event(4,103,'2026-09-20T12:00:00Z','Canceled','In Progress'));
  const result:any=await s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',args);
  assert.equal(result.completeness.complete,true);
  assert.equal(result.data.counts.scanned_candidates,3);
  assert.equal(result.data.counts.total_tickets,2);
  assert.deepEqual(result.data.items.map((x:any)=>x.ticket.id),[101,103]);
  assert.match(result.data.items[0].ticket.web_url,/101/);
  validateOutput('ticket_status_transition_search',result);
  const current:any=await s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',{...args,currently_in_status:true});
  assert.equal(current.data.counts.total_tickets,1);
  assert.deepEqual(current.data.items.map((x:any)=>x.ticket.id),[101]);
  assert.equal(s.technicianPort.calls.filter(c=>c.kind==='collection'&&c.collection==='history').length,5);
});

test('candidate pages and incomplete histories never claim an exact count',async t=>{
  const {s,ticket,event}=setup();t.after(()=>s.app.close());
  s.adapter.records.Tickets.push(ticket(101,'2026-08-10T12:00:00Z','2026-09-15T12:00:00Z'),ticket(102,'2026-08-11T12:00:00Z','2026-09-15T12:00:00Z'));
  s.technicianPort.records.history.push(event(1,102,'2026-09-10T12:00:00Z'));
  const first:any=await s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',{...args,page_size:1});
  assert.equal(first.data.items.length,0);assert.equal(first.data.counts.total_tickets,null);assert.ok(first.completeness.next_cursor);
  await assert.rejects(s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',{...args,page_size:1,currently_in_status:true,cursor:first.completeness.next_cursor}),/continuation/);
  const last:any=await s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',{...args,page_size:1,cursor:first.completeness.next_cursor});
  assert.equal(last.completeness.complete,true);assert.equal(last.data.counts.total_tickets,1);
  s.technicianPort.records.history.push({...event(2,101,'2026-09-11T12:00:00Z'),detail:'unknown grammar'});
  const incomplete:any=await s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',args);
  assert.equal(incomplete.completeness.complete,false);assert.equal(incomplete.data.counts.total_tickets,null);assert.equal(incomplete.data.counts.incomplete_histories,1);
});

test('a September history with more than 100 entries is fully inspected up to the reviewed 500-row bound',async t=>{
  const {s,ticket,event}=setup();t.after(()=>s.app.close());
  s.adapter.records.Tickets.push(ticket(101,'2026-08-10T12:00:00Z','2026-09-15T12:00:00Z'));
  for(let i=1;i<=120;i++)s.technicianPort.records.history.push({id:i,ticketID:101,date:'2026-09-11T12:00:00Z',action:'Title Changed',detail:'Fixture data'});
  s.technicianPort.records.history.push(event(121,101,'2026-09-12T12:00:00Z'));
  const result:any=await s.runtime.invoke(s.principals[0]!,'ticket_status_transition_search',args);
  assert.equal(result.completeness.complete,true);assert.equal(result.data.counts.total_tickets,1);assert.equal(result.data.counts.incomplete_histories,0);
});
