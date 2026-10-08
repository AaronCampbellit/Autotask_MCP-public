import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AppError, actorKey, type Journal, type Principal } from '../packages/contracts/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore, PostgresJournal } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals, fixtureWorkMetadata } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';
import { TechnicianWorkflows, dayWindow, technicianPreferencesSchema } from '../packages/workflows/src/technician-workflows.js';
import { FixtureTechnicianPort, fixtureTechnicianMetadata } from '../packages/technician/src/fixtures.js';
import { TechnicianDomain } from '../packages/technician/src/index.js';
import { FixtureSchedulingPort } from '../packages/scheduling/src/fixtures.js';
import { SchedulingWorkflows } from '../packages/scheduling/src/index.js';

const ticket={kind:'id' as const,id:1001};
const note={title:'Work performed',text:'Internal restoration facts',audience:'internal' as const};
const time={work_date:'2026-09-10',timezone:'America/Chicago',minutes:30,summary:'Separate time summary'};
const handoff=(request_key:string)=>({ticket,target:{kind:'name' as const,name:'Example Colleague'},queue:{kind:'name' as const,name:'Escalations'},note,request_key});
const resolve=(request_key:string)=>({ticket,completion_status:{kind:'name' as const,name:'Complete'},note,time,request_key});
const update=(request_key:string)=>({ticket,changes:{priority:{kind:'name' as const,name:'High'}},expected:{priority:701},request_key});
const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected;
type Step={operation_id:string;state:string;attempt:number;native_id?:number};
const steps=(receipt:{data:Record<string,unknown>})=>receipt.data.steps as Record<'note'|'time'|'update',Step>;
function setup(journal:Journal=new MemoryJournal(),now:()=>number=Date.now){
  const[p,peer]=fixturePrincipals() as[Principal,Principal];const store=new MemoryPrincipalStore([p,peer]);const base=new FixtureAutotaskAdapter(p=>reauthorize(p,store));const core=new TicketWorkflows(base,store,journal);const cipher=new IntentCipher(Buffer.alloc(32,9));const writes=new TicketWriteWorkflows(core,cipher);const port=new FixtureTechnicianPort(base,store);const domain=new TechnicianDomain(port,store);const schedulePort=new FixtureSchedulingPort(base,store);const scheduling=new SchedulingWorkflows(core,schedulePort,cipher);const flows=new TechnicianWorkflows(core,writes,domain,scheduling,cipher,now);
  const order:string[]=[];const noteCreate=base.createTicketNote.bind(base),timeCreate=base.createTicketTime.bind(base),patch=port.patchTicket.bind(port);base.createTicketNote=async(...args)=>{order.push('note');return noteCreate(...args);};base.createTicketTime=async(...args)=>{order.push('time');return timeCreate(...args);};port.patchTicket=async(...args)=>{order.push('update');return patch(...args);};
  return{p,peer,store,base,core,cipher,writes,port,domain,schedulePort,scheduling,flows,journal,order};
}
type Setup=ReturnType<typeof setup>;
function failTime(s:Setup){const original=s.base.createTicketTime.bind(s.base);let attempts=0;s.base.createTicketTime=async(...args)=>{attempts++;if(attempts===1)throw new AppError('invalid_input','Synthetic rejection before dispatch.');return original(...args);};return()=>attempts;}

test('handoff creates a verified internal note before reassignment, with pre-reserved named steps',async()=>{
  const s=setup();const original=s.base.createTicketNote.bind(s.base);s.base.createTicketNote=async(...args)=>{const root=await s.journal.find(actorKey(s.p),'handoff-success');assert.ok(root);assert.ok(await s.journal.find(actorKey(s.p),`wf:${root.id}:note:1`));assert.ok(await s.journal.find(actorKey(s.p),`wf:${root.id}:update:1`));return original(...args);};
  const result=await s.flows.handoff(s.p,handoff('handoff-success'));assert.equal(result.status,'succeeded_verified');assert.deepEqual(s.order,['note','update']);assert.equal(result.data.audience,'internal');assert.equal(result.data.assigned_resource_id,103);assert.equal(s.base.records.Tickets[0]!.queueID,502);assert.equal(steps(result).note.state,'succeeded_verified');assert.equal(steps(result).update.native_id,1001);
  const journal=await s.journal.get(result.operation_id,actorKey(s.p));assert.ok(journal!.encryptedIntent);assert.doesNotMatch(JSON.stringify(journal),/Internal restoration facts|Work performed/);assert.equal(result.safe_to_redispatch,false);
});
test('resolution preserves separate note and time text, records time before completion and deduplicates same key',async()=>{
  const s=setup();const result=await s.flows.resolve(s.p,resolve('resolution-success'));assert.equal(result.status,'succeeded_verified');assert.deepEqual(s.order,['note','time','update']);assert.equal(s.base.records.Tickets[0]!.status,5);assert.equal(s.base.records.Tickets[0]!.resolution,note.text);assert.equal(s.base.records.TimeEntries.at(-1)!.summaryNotes,time.summary);assert.equal(s.base.records.TicketNotes.at(-1)!.description,note.text);
  const replay=await s.flows.resolve(s.p,resolve('resolution-success'));assert.equal(replay.operation_id,result.operation_id);assert.deepEqual(s.order,['note','time','update']);await assert.rejects(s.flows.resolve(s.p,{...resolve('resolution-success'),note:{...note,text:'Changed facts'}}),code('conflict'));
});
test('invalid time and completion blockers prevent the initial note or journal dispatch',async()=>{
  const s=setup();await assert.rejects(s.flows.resolve(s.p,{...resolve('resolve-invalid-time'),time:{...time,minutes:0}}));assert.deepEqual(s.order,[]);
  s.base.validateTicketTime=async()=>{throw new AppError('precondition_failed','The timesheet is locked.');};await assert.rejects(s.flows.resolve(s.p,resolve('resolve-locked-time')),code('precondition_failed'));assert.deepEqual(s.order,[]);
  const t=setup();t.port.records.checklist[0]!.isCompleted=false;await assert.rejects(t.flows.resolve(t.p,resolve('resolve-checklist')),code('precondition_failed'));assert.deepEqual(t.order,[]);
  await assert.rejects(t.flows.resolve(t.p,{...resolve('resolve-open-status'),completion_status:{kind:'id',id:1}}),code('invalid_input'));
});
test('a definitive note rejection stops handoff and does not claim reassignment',async()=>{
  const s=setup();s.base.createTicketNote=async()=>{throw new AppError('invalid_input','Synthetic rejection.');};const result=await s.flows.handoff(s.p,handoff('handoff-rejected'));assert.equal(result.status,'partial');assert.equal(steps(result).note.state,'failed');assert.equal(steps(result).update.state,'ready');assert.equal(s.base.records.Tickets[0]!.assignedResourceID,101);assert.deepEqual(s.order,[]);
});
test('definite time failure preserves the note, resumes original encrypted work and does not duplicate the note',async()=>{
  const s=setup();const attempts=failTime(s);const partial=await s.flows.resolve(s.p,resolve('resolve-partial'));assert.equal(partial.status,'partial');assert.equal(partial.can_resume,true);assert.deepEqual(s.order,['note']);assert.equal(s.base.records.Tickets[0]!.status,1);
  const resumed=await s.flows.runner.resume(s.p,partial.operation_id);assert.equal(resumed.status,'succeeded_verified');assert.deepEqual(s.order,['note','time','update']);assert.equal(attempts(),2);assert.equal(steps(resumed).time.attempt,2);assert.equal(steps(resumed).note.native_id,steps(partial).note.native_id);
});
test('unknown note response stops remaining work; without a recorded native ID neither reconcile nor resume guesses',async()=>{
  const s=setup();const create=s.base.createTicketNote.bind(s.base);s.base.createTicketNote=async(...args)=>{await create(...args);throw new AppError('unknown_outcome','Response lost.');};
  const result=await s.flows.resolve(s.p,resolve('resolve-lost-note'));assert.equal(result.status,'unknown_outcome');assert.equal(steps(result).note.native_id,undefined);assert.equal(result.can_resume,false);assert.deepEqual(s.order,['note']);
  const reconciled=await s.flows.runner.reconcile(s.p,result.operation_id);assert.equal(reconciled.status,'unknown_outcome');await assert.rejects(s.flows.runner.resume(s.p,result.operation_id),code('conflict'));await s.flows.resolve(s.p,resolve('resolve-lost-note'));assert.deepEqual(s.order,['note']);
});
test('unverified note blocks time; recorded-ID reconciliation works after metadata drift but further writes fail closed',async()=>{
  const s=setup();const get=s.base.getTicketNote.bind(s.base);let unavailable=true;s.base.getTicketNote=async(...args)=>{if(unavailable)throw new AppError('dependency_unavailable','Read unavailable.');return get(...args);};
  const result=await s.flows.resolve(s.p,resolve('resolve-unverified-note'));assert.equal(result.status,'accepted_unverified');assert.ok(steps(result).note.native_id);assert.deepEqual(s.order,['note']);
  unavailable=false;s.base.metadataFactory=(p,id)=>({...fixtureWorkMetadata(p,id),version:'drifted-metadata'});
  const reconciled=await s.flows.runner.reconcile(s.p,result.operation_id);assert.equal(reconciled.status,'partial');assert.equal(steps(reconciled).note.state,'succeeded_verified');await assert.rejects(s.flows.runner.resume(s.p,result.operation_id),code('precondition_failed'));assert.deepEqual(s.order,['note']);
});
test('material ticket/checklist changes after a note block subsequent time and completion',async()=>{
  const s=setup();const create=s.base.createTicketNote.bind(s.base);s.base.createTicketNote=async(...args)=>{const result=await create(...args);s.base.records.Tickets[0]!.priority=702;return result;};const result=await s.flows.resolve(s.p,resolve('resolve-drift-after-note'));assert.equal(result.status,'partial');assert.equal(steps(result).time.state,'failed');assert.deepEqual(s.order,['note']);
  const t=setup();const record=t.base.createTicketTime.bind(t.base);t.base.createTicketTime=async(...args)=>{const result=await record(...args);t.port.records.checklist[0]!.isCompleted=false;return result;};const blocked=await t.flows.resolve(t.p,resolve('resolve-checklist-drift'));assert.equal(blocked.status,'partial');assert.deepEqual(t.order,['note','time']);assert.equal(t.base.records.Tickets[0]!.status,1);
});
test('own note/time activity timestamp updates do not invalidate the frozen ticket business snapshot',async()=>{
  const s=setup();for(const method of ['createTicketNote','createTicketTime'] as const){const original=s.base[method].bind(s.base) as (...args:any[])=>Promise<{id:number}>;(s.base[method] as any)=async(...args:any[])=>{const result=await original(...args);s.base.records.Tickets[0]!.lastActivityDate=new Date().toISOString();return result;};}assert.equal((await s.flows.resolve(s.p,resolve('resolve-own-activity'))).status,'succeeded_verified');
});
test('previously verified note edits prevent continuation; saved work is never silently duplicated',async()=>{
  const s=setup();failTime(s);const result=await s.flows.resolve(s.p,resolve('resolve-note-edit'));const id=steps(result).note.native_id!;s.base.records.TicketNotes.find(n=>n.id===id)!.description='Concurrent edit';const resumed=await s.flows.runner.resume(s.p,result.operation_id);assert.equal(resumed.status,'unknown_outcome');assert.deepEqual(s.order,['note']);
});
test('concurrent starts and concurrent resumes claim each effect at most once',async()=>{
  const s=setup();const results=await Promise.all(Array.from({length:12},()=>s.flows.resolve(s.p,resolve('resolve-concurrent'))));assert.equal(new Set(results.map(r=>r.operation_id)).size,1);assert.deepEqual(s.order,['note','time','update']);
  const t=setup();failTime(t);const partial=await t.flows.resolve(t.p,resolve('resume-concurrent'));const resumed=await Promise.allSettled(Array.from({length:8},()=>t.flows.runner.resume(t.p,partial.operation_id)));assert.ok(resumed.some(r=>r.status==='fulfilled'&&r.value.status==='succeeded_verified'));assert.deepEqual(t.order,['note','time','update']);
});
test('journal step reservation failure dispatches nothing and lost final acknowledgement reloads durable success',async()=>{
  const s=setup();const reserve=s.journal.reserve.bind(s.journal);s.journal.reserve=async input=>{if(input.requestKey.includes(':update:1'))throw new AppError('dependency_unavailable','Synthetic reservation failure.');return reserve(input);};const stopped=await s.flows.handoff(s.p,handoff('handoff-reserve-fail'));assert.equal(stopped.status,'failed');assert.deepEqual(s.order,[]);
  const t=setup();const transition=t.journal.transition.bind(t.journal);let lost=false;t.journal.transition=async(...args)=>{const result=await transition(...args);if(!lost&&result.operation==='ticket_resolve'&&args[2]==='succeeded_verified'){lost=true;throw new AppError('conflict','Synthetic lost acknowledgement.');}return result;};const result=await t.flows.resolve(t.p,resolve('resolve-lost-final-ack'));assert.equal(result.status,'succeeded_verified');assert.deepEqual(t.order,['note','time','update']);
});
test('lost root progress acknowledgement reconciles persisted child IDs and resumes only the remaining work',async()=>{
  const s=setup();const transition=s.journal.transition.bind(s.journal);let lost=false;s.journal.transition=async(...args)=>{const result=await transition(...args);if(!lost&&result.operation==='ticket_resolve'&&args[1]==='dispatching'&&args[2]==='dispatching'){lost=true;throw new AppError('dependency_unavailable','Root checkpoint acknowledgement lost.');}return result;};const result=await s.flows.resolve(s.p,resolve('resolve-lost-checkpoint'));assert.equal(result.status,'unknown_outcome');assert.deepEqual(s.order,['note']);const reconciled=await s.flows.runner.reconcile(s.p,result.operation_id);assert.equal(reconciled.status,'partial');assert.equal((await s.flows.runner.resume(s.p,result.operation_id)).status,'succeeded_verified');assert.deepEqual(s.order,['note','time','update']);
});
test('accepted expanded updates remain unknown rather than failed when final journal storage rejects',async()=>{
  const s=setup();const transition=s.journal.transition.bind(s.journal);let fail=true;s.journal.transition=async(...args)=>{if(fail&&args[2]==='succeeded_verified'){fail=false;throw new AppError('conflict','Synthetic journal failure.');}return transition(...args);};const result=await s.flows.update(s.p,update('update-journal-fail'));assert.equal(result.status,'unknown_outcome');assert.equal(s.base.records.Tickets[0]!.priority,702);assert.deepEqual(s.order,['update']);assert.equal(result.can_resume,false);assert.equal((await s.flows.update(s.p,update('update-journal-fail'))).status,'unknown_outcome');assert.deepEqual(s.order,['update']);
});
test('post-write revocation returns an empty unknown receipt without replay permission',async()=>{
  const s=setup();const create=s.base.createTicketNote.bind(s.base);s.base.createTicketNote=async(...args)=>{const result=await create(...args);s.store.set({...s.p,active:false});return result;};const result=await s.flows.resolve(s.p,resolve('resolve-revoked-return'));assert.equal(result.status,'unknown_outcome');assert.deepEqual(result.data,{});assert.equal(result.can_resume,false);assert.deepEqual(s.order,['note']);
  const t=setup();const patch=t.port.patchTicket.bind(t.port);t.port.patchTicket=async(...args)=>{await patch(...args);t.store.set({...t.p,active:false});};const changed=await t.flows.update(t.p,update('update-revoked-return'));assert.equal(changed.status,'unknown_outcome');assert.deepEqual(changed.data,{});assert.equal(t.base.records.Tickets[0]!.priority,702);
});
test('operation status enforces actor, mapping, policy, and current ticket company scope',async()=>{
  const s=setup();const result=await s.flows.handoff(s.p,handoff('handoff-status-scope'));await assert.rejects(s.flows.runner.status(s.peer,result.operation_id),code('not_found_or_inaccessible'));s.base.records.Tickets[0]!.companyID=20;await assert.rejects(s.flows.runner.status(s.p,result.operation_id),code('not_found_or_inaccessible'));
  const t=setup();const changed=await t.flows.update(t.p,update('update-policy-scope'));const fresh={...t.p,policyVersion:'policy-v2'};t.store.set(fresh);await assert.rejects(t.flows.updateStatus(fresh,changed.operation_id),code('conflict'));
});
test('request-key internal namespaces are denied before any public mutation',async()=>{
  for(const prefix of ['wf:','sch:']){const s=setup();await assert.rejects(s.flows.handoff(s.p,handoff(`${prefix}internal-1`)));await assert.rejects(s.flows.resolve(s.p,resolve(`${prefix}internal-2`)));await assert.rejects(s.flows.update(s.p,update(`${prefix}internal-3`)));assert.deepEqual(s.order,[]);}
});
test('expired intent and ten definite failed attempts disable continuation without repeating saved work',async()=>{
  let now=Date.now();const s=setup(new MemoryJournal(),()=>now);failTime(s);const partial=await s.flows.resolve(s.p,resolve('resolve-expired'));now+=8*86400000;assert.equal((await s.flows.runner.status(s.p,partial.operation_id)).can_resume,false);await assert.rejects(s.flows.runner.resume(s.p,partial.operation_id),code('conflict'));assert.deepEqual(s.order,['note']);
  const t=setup();let attempts=0;t.base.createTicketTime=async()=>{attempts++;throw new AppError('invalid_input','Synthetic definite rejection.');};let result=await t.flows.resolve(t.p,resolve('resolve-attempt-budget'));for(let i=1;i<10;i++)result=await t.flows.runner.resume(t.p,result.operation_id);assert.equal(attempts,10);assert.equal(steps(result).time.attempt,10);assert.equal(result.can_resume,false);await assert.rejects(t.flows.runner.resume(t.p,result.operation_id),code('conflict'));assert.deepEqual(t.order,['note']);
});
test('lost ticket-update response reconciles only the recorded ticket target and never repeats saved note or time',async()=>{
  const s=setup();const patch=s.port.patchTicket.bind(s.port);s.port.patchTicket=async(...args)=>{await patch(...args);throw new AppError('unknown_outcome','Accepted update response lost.');};const result=await s.flows.resolve(s.p,resolve('resolve-update-lost'));assert.equal(result.status,'unknown_outcome');assert.deepEqual(s.order,['note','time','update']);const reconciled=await s.flows.runner.reconcile(s.p,result.operation_id);assert.equal(reconciled.status,'succeeded_verified');assert.deepEqual(s.order,['note','time','update']);assert.equal(steps(reconciled).update.native_id,1001);
});
test('ordinary JSON below 64 KiB encrypts with large prior ticket descriptions without duplicating plaintext snapshots',async()=>{
  const s=setup();s.base.records.Tickets[0]!.description='Prior description '.repeat(1600);s.base.records.Tickets[0]!.resolution='Prior resolution '.repeat(1600);const input={...resolve('resolve-large-input'),note:{...note,text:'N'.repeat(30000)},time:{...time,summary:'T'.repeat(30000)}};assert.ok(Buffer.byteLength(JSON.stringify(input))<65536);const result=await s.flows.resolve(s.p,input);assert.equal(result.status,'succeeded_verified');const root=await s.journal.get(result.operation_id,actorKey(s.p));assert.ok(root!.encryptedIntent);assert.doesNotMatch(JSON.stringify(root),/Prior description|NNNNNNNNNNNNNNNN|TTTTTTTTTTTTTTTT/);
});
test('DST and quarter-hour zones produce correct boundaries and workday date containers preserve recorded own time',async()=>{
  const spring=dayWindow('2026-03-08','America/Chicago'),fall=dayWindow('2026-11-01','America/Chicago'),nepal=dayWindow('2026-09-10','Asia/Kathmandu');assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);assert.equal(Date.parse(fall.end)-Date.parse(fall.start),25*3600000);assert.match(nepal.scheduleStart,/\+05:45$/);
  const s=setup();const result=await s.flows.workday(s.p,{date:'2026-09-10',timezone:'America/Chicago'});assert.equal(result.data.recorded_hours,0.5);assert.equal(result.data.recorded_time.items[0]!.id,4001);assert.equal(result.data.tasks.items[0]!.id,6701);assert.deepEqual(s.order,[]);
});
test('business reference search, context and visit preparation are scoped read-only evidence',async()=>{
  const s=setup();const result=await s.flows.search(s.p,{company:{kind:'name',name:'Example Engineering'},queue:{kind:'name',name:'Service Desk'},technician:{kind:'self'}});assert.deepEqual(result.data.map(t=>t.id),[1001]);assert.equal(JSON.stringify(result).includes('NEVER-RETURN'),false);
  const context=await s.flows.context(s.p,{ticket,purpose:'custom',collections:['history','assets','contact','site']});assert.equal(context.data.collections.assets.items[0].id,6301);assert.equal(context.data.collections.notes.status,'not_requested');
  const visit=await s.flows.visit(s.p,{ticket,date:'2026-09-10',timezone:'America/Chicago'});assert.equal(visit.data.appointment.id,5001);await assert.rejects(s.flows.visit(s.p,{ticket,date:'2026-09-10',timezone:'America/Chicago',appointment_id:9999}),code('invalid_input'));assert.deepEqual(s.order,[]);
});
test('search rejects an upstream out-of-company row instead of projecting it',async()=>{
  const s=setup();s.base.query=async()=>({items:[{id:9999,companyID:20,title:'Hidden'}],nextCursor:null,fetchedAt:new Date().toISOString()});await assert.rejects(s.flows.search(s.p,{}),code('not_found_or_inaccessible'));
});
test('fixed workflow continuation survives reconstruction with the real SQL journal and fourth migration',async()=>{
  const db=new PGlite();try{for(const file of ['001_foundation.sql','002_workflow_intents.sql','004_fixed_workflows.sql'])await db.exec(await readFile(new URL(`../packages/storage/migrations/${file}`,import.meta.url),'utf8'));const s=setup(new PostgresJournal(db));failTime(s);const partial=await s.flows.resolve(s.p,resolve('resolve-sql-restart'));assert.equal(partial.status,'partial');const journal=new PostgresJournal(db),core=new TicketWorkflows(s.base,s.store,journal),writes=new TicketWriteWorkflows(core,s.cipher),flows=new TechnicianWorkflows(core,writes,s.domain,s.scheduling,s.cipher);assert.equal((await flows.runner.resume(s.p,partial.operation_id)).status,'succeeded_verified');assert.deepEqual(s.order,['note','time','update']);const rows=await db.query<{count:number}>('SELECT count(*)::int AS count FROM operation_journal');assert.equal(rows.rows[0]!.count,5);}finally{await db.close();}
});

 test('assigned-self search uses the authenticated mapping without technician catalog qualification',async()=>{
  const s=setup();s.port.catalog=async()=>{throw new AppError('impersonation_not_qualified','Catalog unavailable');};
  for(const technician of [{kind:'self' as const},{kind:'id' as const,id:s.p.resourceId}]){
   const result=await s.flows.search(s.p,{technician});
   assert.ok(result.data.length>0);assert.ok(result.data.every(row=>row.assignedResourceID===s.p.resourceId));
  }
  await assert.rejects(s.flows.search(s.p,{technician:{kind:'id',id:s.peer.resourceId}}),code('impersonation_not_qualified'));
  await assert.rejects(s.flows.search(s.p,{status:{kind:'name',name:'Complete'},technician:{kind:'self'}}),code('impersonation_not_qualified'));
  s.store.set({...s.p,active:false});await assert.rejects(s.flows.search(s.p,{technician:{kind:'self'}}));
 });

 test('customer response search sends assignment and resolved status together and fails before querying on resolution failure',async()=>{
 const s=setup();Object.assign(s.base,{supportsTicketStatusLookup:true,resolveTicketStatus:async()=>7});let calls=0;
 s.base.query=async(_p,r)=>{calls++;assert.ok(r.filters.some(f=>f.field==='assignedResourceID'&&f.value===s.p.resourceId));assert.ok(r.filters.some(f=>f.field==='status'&&f.value===7));return{items:[],nextCursor:null,fetchedAt:new Date().toISOString()};};
 const args={technician:{kind:'self'},status:{kind:'name',name:'Customer Note Added'}};
 await s.flows.search(s.p,args);assert.equal(calls,1);
 Object.assign(s.base,{resolveTicketStatus:async()=>{throw new AppError('missing_metadata','Unavailable');}});
 await assert.rejects(s.flows.search(s.p,args),code('missing_metadata'));assert.equal(calls,1);
 });

 test('application company-name and open search preserves company and all excluded statuses',async()=>{
 const s=setup();Object.assign(s.base,{supportsTicketStatusLookup:true,resolveOpenTicketStatuses:async()=>[1,7,19]});
 s.port.catalog=async()=>{throw Error('Native catalog must not be used');};let ticketCalls=0;
 s.base.query=async(_p,r)=>{if(r.entity==='Companies')return{items:[{id:10,companyName:'Example Juniper and Redwood'}],nextCursor:null,fetchedAt:new Date().toISOString()};ticketCalls++;assert.deepEqual(r.filters.find(f=>f.field==='companyID')?.value,[10]);assert.deepEqual(r.filters.filter(f=>f.field==='status').map(f=>[f.op,f.value]),[['in',[1,7,19]]]);return{items:[],nextCursor:null,fetchedAt:new Date().toISOString()};};
 await s.flows.search(s.p,{company:{kind:'name',name:'Example Juniper and Redwood'},open_only:true});assert.equal(ticketCalls,1);
 s.base.query=async()=>({items:[],nextCursor:null,fetchedAt:new Date().toISOString()});await assert.rejects(s.flows.search(s.p,{company:{kind:'name',name:'Unknown'},open_only:true}),code('invalid_input'));
 });

test('client aliases resolve before scoped company lookup and cannot bypass an inaccessible company',async()=>{
 const s=setup();Object.assign(s.base,{supportsTicketStatusLookup:true});let ticketQueries=0;
 s.base.query=async(_p,r)=>{if(r.entity==='Companies'){assert.equal(r.filters[0]?.value,'Example Willow Architects');return{items:[],nextCursor:null,fetchedAt:new Date().toISOString()};}ticketQueries++;throw Error('Must not search tickets without authorized company');};
 await assert.rejects(s.flows.search(s.p,{company:{kind:'name',name:'EXA'}}),code('invalid_input'));assert.equal(ticketQueries,0);
});

test('workday and visit use explicit, employee, then workspace timezone and never guess',async()=>{
  const s=setup(),preferences={defaultTimezone:'UTC',resourceTimezones:{'101':'America/Chicago'}};
  const flows=new TechnicianWorkflows(s.core,s.writes,s.domain,s.scheduling,s.cipher,Date.now,preferences);
  const employee=await flows.workday(s.p,{date:'2026-09-10'});assert.equal(employee.data.timezone,'America/Chicago');assert.equal(employee.data.timezone_source,'employee_configuration');
  const explicit=await flows.workday(s.p,{date:'2026-09-10',timezone:'Asia/Kathmandu'});assert.equal(explicit.data.timezone_source,'request');assert.equal(explicit.data.timezone,'Asia/Kathmandu');
  const workspace=new TechnicianWorkflows(s.core,s.writes,s.domain,s.scheduling,s.cipher,Date.now,{defaultTimezone:'UTC'});assert.equal((await workspace.workday(s.p,{date:'2026-09-10'})).data.timezone_source,'workspace_configuration');
  assert.equal((await flows.visit(s.p,{ticket,date:'2026-09-10'})).data.timezone_source,'employee_configuration');
  await assert.rejects(s.flows.workday(s.p,{date:'2026-09-10'}),code('invalid_input'));assert.equal(technicianPreferencesSchema.safeParse({defaultTimezone:'bogus'}).success,false);assert.equal(technicianPreferencesSchema.safeParse({resourceTimezones:{wrong:'UTC'}}).success,false);
  assert.deepEqual(s.order,[]);
});
test('workday continuation counts only returned time, includes own internal time, and never labels a tail as a full day',async()=>{
  const s=setup();s.base.records.TimeEntries=Array.from({length:101},(_,i)=>({id:10000+i,resourceID:s.p.resourceId,ticketID:null,taskID:null,dateWorked:'2026-09-10T00:00:00Z',hoursWorked:.25,summaryNotes:'Internal work',hourlyBillingRate:900}));
  const input={date:'2026-09-10',timezone:'America/Chicago',max_pages:1};const first=await s.flows.workday(s.p,input);assert.equal(first.status,'partial');assert.equal(first.data.recorded_hours,25);assert.equal(first.data.recorded_hours_scope,'returned_batch');assert.equal(first.completeness.recorded_time_complete,false);
  const cursor=first.data.recorded_time.continuation!;assert(cursor);const tail=await s.flows.workday(s.p,{...input,cursors:{time:cursor}});assert.equal(tail.data.recorded_hours,.25);assert.equal(tail.completeness.complete,false);assert.equal(tail.completeness.recorded_time_complete,false);assert.equal(tail.data.recorded_time.continuation,null);assert.equal(JSON.stringify(tail).includes('hourlyBillingRate'),false);
  await assert.rejects(s.flows.workday(s.p,{...input,date:'2026-09-11',cursors:{time:cursor}}),code('invalid_input'));assert.deepEqual(s.order,[]);
});
test('workday withholds evidence when permission changes during final schedule retrieval',async()=>{
  const s=setup(),original=s.scheduling.search.bind(s.scheduling);s.scheduling.search=async(...args)=>{const result=await original(...args);s.store.set({...s.p,active:false});return result;};
  await assert.rejects(s.flows.workday(s.p,{date:'2026-09-10',timezone:'America/Chicago'}),code('identity_mapping_invalid'));
});

test('visit preparation requires a choice among multiple appointments and preserves partial context',async()=>{
  const s=setup(),original=s.scheduling.search.bind(s.scheduling);s.scheduling.search=async(...args)=>{const result=await original(...args);return{...result,data:{...result.data,entries:[...result.data.entries,{...result.data.entries[0]!,id:5999}]}};};
  const input={ticket,date:'2026-09-10',timezone:'America/Chicago'};
  await assert.rejects(s.flows.visit(s.p,input),e=>e instanceof AppError&&e.code==='invalid_input'&&e.message.includes('5999')&&e.message.includes('5001'));
  s.port.records.history=Array.from({length:101},(_,i)=>({id:8000+i,ticketID:1001,date:'2026-09-10T12:00:00Z',action:'Changed'}));
  const visit=await s.flows.visit(s.p,{...input,appointment_id:5999});assert.equal(visit.data.appointment.id,5999);assert.equal(visit.status,'partial');assert.equal(visit.completeness.complete,false);assert(visit.data.collections.history.continuation);assert.deepEqual(s.order,[]);
});
