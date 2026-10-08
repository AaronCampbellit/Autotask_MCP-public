import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { AppError } from '../packages/contracts/src/index.js';

const ticket={kind:'id' as const,id:1001};
type System=ReturnType<typeof createFixtureSystem>;
const lostAccess=(error:unknown)=>error instanceof AppError&&['forbidden','identity_mapping_invalid','identity_validation_unavailable'].includes(error.code);
async function revoke(s:System){const p=s.principals[0]!;await s.control.saveMember(p,{objectId:p.objectId,resourceId:p.resourceId,active:false,capabilities:p.capabilities,companyIds:p.companyIds},1);}

for(const mode of ['time','search'] as const)test(`core ${mode} read rejects revocation after the adapter response`,async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const query=s.adapter.query.bind(s.adapter);s.adapter.query=async(...args)=>{const result=await query(...args);await revoke(s);return result;};
  await assert.rejects(mode==='time'?s.core.timeSearch(s.principals[0]!,{ticket}):s.core.search(s.principals[0]!,{}),lostAccess);
});

test('resolved ticket content does not escape a revoked identity after get',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const get=s.adapter.get.bind(s.adapter);s.adapter.get=async(...args)=>{const result=await get(...args);await revoke(s);return result;};
  await assert.rejects(s.core.resolveTicket(s.principals[0]!,ticket),lostAccess);
});

test('a context continuation does not return earlier pages after its tool is disabled',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());let notePages=0;
  const query=s.adapter.query.bind(s.adapter);s.adapter.query=async(...args)=>{const result=await query(...args);if(args[1].entity==='TicketNotes'&&++notePages===2)await s.control.setControls(s.principals[0]!,{writePaused:false,tools:{ticket_context:false}},0);return result;};
  await assert.rejects(s.runtime.invoke(s.principals[0]!,'ticket_context',{ticket,purpose:'custom',collections:['notes']}),lostAccess);
  assert.equal(notePages,2);
});

test('aggregate context propagates a disabled tool during its final schedule read',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const search=s.scheduling.search.bind(s.scheduling);s.scheduling.search=async(...args)=>{await s.control.setControls(s.principals[0]!,{writePaused:false,tools:{ticket_context:false}},0);return search(...args);};
  await assert.rejects(s.runtime.invoke(s.principals[0]!,'ticket_context',{ticket,purpose:'custom',collections:['notes','schedule']}),lostAccess);
});

test('aggregate context reauthorizes once more after the final successful collection',async t=>{
  const s=createFixtureSystem();t.after(()=>s.app.close());
  const search=s.scheduling.search.bind(s.scheduling);s.scheduling.search=async(...args)=>{const result=await search(...args);await s.control.setControls(s.principals[0]!,{writePaused:false,tools:{ticket_context:false}},0);return result;};
  await assert.rejects(s.runtime.invoke(s.principals[0]!,'ticket_context',{ticket,purpose:'custom',collections:['notes','schedule']}),lostAccess);
});
