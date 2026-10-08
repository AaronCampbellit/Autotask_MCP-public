import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
import {validateOutput} from '../apps/server/src/output-validation.js';
import {ticketCountSchema} from '../packages/workflows/src/technician-workflows.js';
import {expandedSearchSchema} from '../packages/workflows/src/technician-workflows.js';

const august={start:'2026-08-01T00:00:00-05:00',end:'2026-09-01T00:00:00-05:00'};

test('August Canceled ticket count is scoped, exact, and independent of pagination',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const catalog=s.technicianPort.catalog.bind(s.technicianPort);
  s.technicianPort.catalog=async(...args)=>{const result=await catalog(...args);if(args[1]==='status')result.items.push({id:49,label:'Canceled',active:true,companyIds:[10,20]});return result;};
  s.adapter.records.Tickets.length=0;
  const make=(id:number,createDate:string,status=49,companyID=10)=>({id,ticketNumber:`T20260801.${id}`,title:`Ticket ${id}`,createDate,status,companyID});
  for(let id=1;id<=250;id++)s.adapter.records.Tickets.push(make(id,'2026-07-20T12:00:00Z'));
  s.adapter.records.Tickets.push(make(251,'2026-08-01T05:00:00Z'),make(252,'2026-09-01T04:59:59.999Z'),make(253,'2026-08-15T12:00:00Z',2),make(254,'2026-08-15T12:00:00Z',49,20),make(255,'2026-09-01T05:00:00Z'));
  const args={created_window:august,status:{kind:'name',name:'Canceled'}};
  const result:any=await s.runtime.invoke(s.principals[0]!,'ticket_count',args);
  assert.equal(result.count,2);
  assert.equal(result.status,'succeeded');
  assert.equal(result.filters.status.name,'Canceled');
  assert.equal(s.adapter.calls.filter(c=>c.entity==='Tickets'&&c.kind==='count').length,1);
  assert.equal(s.adapter.calls.filter(c=>c.entity==='Tickets'&&c.kind==='query').length,0);
  validateOutput('ticket_count',result);
  const search:any=await s.runtime.invoke(s.principals[0]!,'ticket_search',{...args,page_size:1});
  assert.equal(search.completeness.complete,false);
  assert.equal(search.data.length,1);
  assert.equal(ticketCountSchema.safeParse({...args,cursor:'not-allowed'}).success,false);
  assert.equal(ticketCountSchema.safeParse({...args,page_size:1}).success,false);
});

test('native ticket type filter is shared by ticket count and search',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());
 s.adapter.records.Tickets.length=0;
 s.adapter.records.Tickets.push({id:1,companyID:10,ticketType:2,title:'Incident'},{id:2,companyID:10,ticketType:3,title:'Request'});
 const args={ticket_type_id:2};
 const count:any=await s.runtime.invoke(s.principals[0]!,'ticket_count',args);
 const search:any=await s.runtime.invoke(s.principals[0]!,'ticket_search',{...args,page_size:500});
 assert.equal(count.count,1);
 assert.deepEqual(search.data.map((row:any)=>row.id),[1]);
 assert.equal(search.completeness.complete,true);
});

test('ticket creation filters accept a year to date window and reject longer windows',()=>{
 const created_window={start:'2026-01-01T00:00:00-06:00',end:'2026-09-26T00:00:00-05:00'};
 assert(expandedSearchSchema.safeParse({created_window,page_size:500}).success);
 assert(ticketCountSchema.safeParse({created_window}).success);
 assert(!expandedSearchSchema.safeParse({created_window:{...created_window,end:'2027-02-01T00:00:00-06:00'}}).success);
});
