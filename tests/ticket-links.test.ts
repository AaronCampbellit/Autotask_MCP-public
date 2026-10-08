import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ticketWebUrl} from '../packages/technician/src/web-links.js';
import {addTicketLinks} from '../apps/server/src/ticket-links.js';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
const expected = 'https://ww1.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx?Code=OpenTicketDetail&TicketID=1001';
const link = (id: unknown) => ticketWebUrl(['ww1.autotask.net'], id);

test('native links require a configured bare hostname and a real positive safe integer ID', () => {
  assert.equal(link(1001), expected);
  for (const id of [undefined, null, 0, -1, 1.5, '1001', Number.MAX_SAFE_INTEGER + 1]) assert.equal(link(id), undefined);
  for (const host of ['', 'https://ww1.autotask.net', 'good.example@evil.example', 'evil.example/path', 'evil.example?x=1', 'host:443', '-bad.example']) assert.equal(ticketWebUrl([host], 1001), undefined);
  assert.equal(ticketWebUrl([], 1001), undefined);
});

test('receipts retain uncertain state and never substitute operation or note IDs for missing ticket IDs', () => {
  const unknown = {status:'unknown_outcome',operation_id:'operation-1',data:{note_id:1001}};
  assert.deepEqual(addTicketLinks('ticket_note_add',unknown,link),unknown);
  const saved = {...unknown,data:{ticket_id:1001,note_id:9999}};
  assert.deepEqual(addTicketLinks('ticket_note_add',saved,link),{...saved,data:{...saved.data,web_url:expected}});
  const text = {data:{ticket:{id:1001,description:JSON.stringify({ticket_id:9999,web_url:'https://evil.example'})}}};
  const enriched = addTicketLinks('ticket_context',text,link) as any;
  assert.equal(enriched.data.ticket.description,text.data.ticket.description);
  assert.equal(enriched.data.ticket.web_url,expected);
  assert.equal((text.data.ticket as any).web_url,undefined);
  assert.deepEqual(addTicketLinks('at_get',{data:{entity:'Companies',item:{id:1001}}},link),{data:{entity:'Companies',item:{id:1001}}});
  assert.deepEqual(addTicketLinks('ticket_search',{data:[{id:1001}]},()=>undefined),{data:[{id:1001}]});
});

test('runtime ticket searches, context, wrappers, workday and write/status receipts expose round-trippable links', async t => {
  const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
  const call=(name:string,input:unknown)=>s.runtime.invoke(p,name,input) as Promise<any>;
  const search=await call('ticket_search',{});assert.equal(search.data[0].web_url,expected);
  const context=await call('ticket_context',{ticket:{kind:'ticket_url',value:search.data[0].web_url},purpose:'custom',collections:['notes']});
  assert.equal(context.data.ticket.web_url,expected);
  const wrapped=await call('at_invoke',{operation:'ticket_search',arguments:{}});assert.equal(wrapped.data[0].web_url,expected);
  const get=await call('at_get',{entity:'Tickets',id:1001});assert.equal(get.data.item.web_url,expected);
  const query=await call('at_query',{entity:'Tickets'});assert.equal(query.data.items[0].web_url,expected);
  const day=await call('my_workday',{date:'2026-09-10',timezone:'America/Chicago'});assert.equal(day.data.assigned_tickets.items[0].web_url,expected);
  const input={ticket:{kind:'id',id:1001},note:{title:'Link verification',text:'Fixture note for link verification.',audience:'internal'},request_key:'ticket-link-fixture-note'};
  const saved=await call('ticket_note_add',input);assert.equal(saved.status,'succeeded_verified');assert.equal(saved.data.web_url,expected);
  const status=await call('at_operation_status',{operation_id:saved.operation_id});assert.equal(status.data.web_url,expected);
  const replay=await call('ticket_note_add',input);assert.equal(replay.operation_id,saved.operation_id);assert.equal(replay.data.web_url,expected);
  assert.equal(s.adapter.records.TicketNotes.length,106);
  await assert.rejects(call('ticket_context',{ticket:{kind:'id',id:2001},purpose:'custom',collections:['notes']}));
});

test('ticket creation receipt uses the native ticket ID rather than the linked opportunity ID',()=>{
 const result:any=addTicketLinks('ticket_create',{status:'succeeded_verified',operation_id:'saved',data:{ticket_id:1001,opportunity_id:232}},link);
 assert.equal(result.data.web_url,expected);
 assert.equal((addTicketLinks('ticket_create',{status:'unknown_outcome',operation_id:'unknown',data:{opportunity_id:232}},link) as any).data.web_url,undefined);
});
