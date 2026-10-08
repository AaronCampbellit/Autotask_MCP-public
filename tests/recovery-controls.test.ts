import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { AppError, actorKey } from '../packages/contracts/src/index.js';
import { redactJournalResult } from '../packages/storage/src/index.js';

const ticket={kind:'id',id:1001};
const note={title:'Recovery facts',text:'Fictitious completed work.',audience:'internal'};
const time={work_date:'2026-09-10',timezone:'America/Chicago',minutes:15,start_datetime:'2026-09-10T09:00:00-05:00',summary:'Separate recorded work.'};
type System=ReturnType<typeof createFixtureSystem>;

/** Simulate losing the acknowledgement immediately after the root is durable. */
async function reserveInterruptedResolution(s:System,requestKey:string,withTime:boolean,legacy=false){
  const original=s.journal.reserve.bind(s.journal);
  s.journal.reserve=async input=>{
    if(input.operation==='ticket_resolve'){
      const prepared=structuredClone(input);
      if(legacy)delete prepared.result?.requires_time;
      await original(prepared);
      throw new AppError('dependency_unavailable','Synthetic lost reservation acknowledgement.');
    }
    return original(input);
  };
  try{
    await assert.rejects(s.runtime.invoke(s.principals[0]!,'ticket_resolve',{
      ticket,note,...(withTime?{time}:{}),completion_status:{kind:'name',name:'Complete'},request_key:requestKey,
    }));
  }finally{s.journal.reserve=original;}
  const root=await s.journal.find(actorKey(s.principals[0]!),requestKey);
  assert.ok(root);assert.equal(root.state,'ready');assert.equal(root.result?.steps,undefined);
  assert.equal(s.adapter.records.TicketNotes.length,105);
  assert.equal(s.adapter.records.TimeEntries.length,2);
  assert.equal(s.adapter.records.Tickets[0]!.status,1);
  return root;
}

for(const legacy of [false,true])test(`resolution recovery checks the time switch before any child reservation (${legacy?'legacy absent marker':'persisted marker'})`,async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const root=await reserveInterruptedResolution(s,`ready-resolution-${legacy}`,true,legacy);
  assert.equal(root.result?.requires_time,legacy?undefined:true);
  await s.control.setControls(s.principals[0]!,{writePaused:false,tools:{time_log_ticket:false}},0);
  await assert.rejects(s.runtime.invoke(s.principals[0]!,'at_operation_resume',{operation_id:root.id}),error=>error instanceof AppError&&error.code==='forbidden');
  assert.equal(s.journal.inspectAll().length,1);
  assert.equal(s.adapter.records.TicketNotes.length,105);
  assert.equal(s.adapter.records.TimeEntries.length,2);
  assert.equal(s.adapter.records.Tickets[0]!.status,1);
  await s.control.setControls(s.principals[0]!,{writePaused:false,tools:{}},1);
  const recovered=await s.runtime.invoke(s.principals[0]!,'at_operation_resume',{operation_id:root.id}) as any;
  assert.equal(recovered.status,'succeeded_verified');assert.equal(recovered.data.requires_time,true);
  assert.equal(s.adapter.records.TicketNotes.length,106);assert.equal(s.adapter.records.TimeEntries.length,3);
});

test('an explicitly time-free resolution resumes while the individual time tool is disabled',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const root=await reserveInterruptedResolution(s,'ready-resolution-without-time',false);
  assert.equal(root.result?.requires_time,false);
  await s.control.setControls(s.principals[0]!,{writePaused:false,tools:{time_log_ticket:false}},0);
  const result=await s.runtime.invoke(s.principals[0]!,'at_operation_resume',{operation_id:root.id}) as any;
  assert.equal(result.status,'succeeded_verified');assert.equal(result.data.requires_time,false);
  assert.equal(s.adapter.records.TicketNotes.length,106);assert.equal(s.adapter.records.TimeEntries.length,2);
});

test('journal redaction retains only a boolean planned-time marker',()=>{
  assert.deepEqual(redactJournalResult({requires_time:true}),{requires_time:true});
  assert.deepEqual(redactJournalResult({requires_time:false}),{requires_time:false});
  assert.deepEqual(redactJournalResult({requires_time:'private text'}),{});
});
