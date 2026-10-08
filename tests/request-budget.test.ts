import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { SharedRequestBudget, ClosedRequestBudget, FixtureUnlimitedRequestBudget, LocalThresholdProvider, RequestBudgetError, requestBudgetOptionsFromEnvironment, type BudgetTimers, type RequestBudgetPort, type SharedRequestBudgetOptions, type ThresholdObservation } from '../packages/autotask/src/budget.js';
import { HttpAutotaskAdapter, type AutotaskOperation, type HttpAutotaskAdapterOptions } from '../packages/autotask/src/index.js';
import type { Principal } from '../packages/contracts/src/index.js';
import { fixtureWorkMetadata } from '../packages/workflows/src/fixtures.js';

const NOW=Date.parse('2026-09-10T12:00:00.000Z');
class Clock {
  value=NOW;private sequence=0;private callbacks=new Map<number,{at:number;callback:()=>void}>();
  readonly now=()=>this.value;
  readonly timers:BudgetTimers={set:(callback,delay)=>{const id=++this.sequence;this.callbacks.set(id,{at:this.value+delay,callback});return id;},clear:handle=>{this.callbacks.delete(handle as number);}};
  async advance(milliseconds:number) {
    const until=this.value+milliseconds;
    for(;;){const next=[...this.callbacks.entries()].filter(([,task])=>task.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.value=next[1].at;this.callbacks.delete(next[0]);next[1].callback();await flush();}
    this.value=until;await flush();
  }
  get timersRemaining(){return this.callbacks.size;}
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
const request=(actor=0)=>({tenantId:'tenant',actorKey:`tenant:actor-${actor}`});
function harness(overrides:Partial<SharedRequestBudgetOptions>={}) {
  const clock=new Clock(),configuration={tenantId:'tenant',requestsPerWindow:20,windowMs:1000,reservedExternalHeadroom:100,observationMaxAgeMs:1000,maxWaitMs:5000,maxQueueSize:100,...overrides};
  const budget=new SharedRequestBudget({...configuration,clock:clock.now,timers:clock.timers});
  const observe=(used=0,limit=1000,extras:Partial<ThresholdObservation>={})=>budget.updateObservation({tenantId:'tenant',source:'ThresholdInformation',observedAt:new Date(clock.value).toISOString(),expiresAt:new Date(clock.value+configuration.observationMaxAgeMs).toISOString(),windowMs:configuration.windowMs,limit,used,evidenceReference:'synthetic-threshold-fixture',...extras});
  return{budget,clock,observe,configuration};
}
const reason=(expected:string)=>(error:unknown)=>error instanceof RequestBudgetError&&error.reason===expected;

test('live allowance has no invented default; missing or partial environment remains closed',async()=>{
  assert.equal(requestBudgetOptionsFromEnvironment({},'tenant'),undefined);const closed=new ClosedRequestBudget();await assert.rejects(closed.take(),reason('not_configured'));assert.equal(closed.status().configured,false);
  assert.throws(()=>requestBudgetOptionsFromEnvironment({AUTOTASK_REQUESTS_PER_WINDOW:'100'},'tenant'));
  assert.equal(requestBudgetOptionsFromEnvironment({AUTOTASK_REQUESTS_PER_WINDOW:' ',AUTOTASK_THRESHOLD_PATH:'',AUTOTASK_BUDGET_MAX_WAIT_MS:''},'tenant'),undefined);
  for(const partial of [{AUTOTASK_BUDGET_MAX_WAIT_MS:'500'},{AUTOTASK_BUDGET_QUEUE_SIZE:'10'},{AUTOTASK_THRESHOLD_PATH:'work/threshold.json'}])assert.throws(()=>requestBudgetOptionsFromEnvironment(partial,'tenant'));
  const config=requestBudgetOptionsFromEnvironment({AUTOTASK_REQUESTS_PER_WINDOW:'20',AUTOTASK_BUDGET_WINDOW_MS:'1000',AUTOTASK_EXTERNAL_HEADROOM:'100',AUTOTASK_THRESHOLD_MAX_AGE_MS:'500',AUTOTASK_THRESHOLD_PATH:'work/threshold.json'},'tenant')!;assert.equal(config.requestsPerWindow,20);
  const fixture=new FixtureUnlimitedRequestBudget();await fixture.take();assert.equal(fixture.status().mode,'fixture');assert.equal(fixture.status().admitted,1);
  for(const value of [{requestsPerWindow:0},{reservedExternalHeadroom:-1},{observationMaxAgeMs:1001},{maxWaitMs:60001},{maxQueueSize:1001}])assert.throws(()=>harness(value));
});
test('missing, foreign, stale, future and mismatched threshold observations fail before admission',async()=>{
  const s=harness();await assert.rejects(s.budget.take(request()),reason('observation_missing'));
  for(const observation of [{tenantId:'foreign'},{windowMs:2000},{observedAt:new Date(NOW+1).toISOString()},{expiresAt:new Date(NOW).toISOString()},{used:-1}])assert.throws(()=>s.observe(0,1000,observation));
  s.observe();await assert.rejects(s.budget.take({tenantId:'foreign',actorKey:'foreign:actor'}),{code:'forbidden'});
  await s.clock.advance(1000);await assert.rejects(s.budget.take(request()),reason('observation_stale'));assert.equal(s.budget.status().admitted,0);
});
test('outside integration usage and reserved headroom independently reduce the configured local allowance',async()=>{
  const s=harness({requestsPerWindow:50,reservedExternalHeadroom:10,maxWaitMs:0});s.observe(85,100);
  await Promise.all(Array.from({length:5},(_,id)=>s.budget.take(request(id))));await assert.rejects(s.budget.take(request(6)),reason('shared_pressure'));
  assert.equal(s.budget.status().localRemaining,45);assert.equal(s.budget.status().observedRemaining,0);
  await s.clock.advance(1);s.observe(98,100);await assert.rejects(s.budget.take(request()),reason('shared_pressure'));
  await s.clock.advance(1);s.observe(30,100);await Promise.all(Array.from({length:45},(_,id)=>s.budget.take(request(id))));await assert.rejects(s.budget.take(request()),reason('local_budget'));
  assert.equal(s.budget.status().admitted,50);
});
test('refreshing an observation never resets local rolling usage or forgets requests captured at the same millisecond',async()=>{
  const s=harness({requestsPerWindow:3,maxWaitMs:0});s.observe();await s.budget.take(request());s.observe();assert.equal(s.budget.status().observedRemaining,899);
  await s.budget.take(request());await s.budget.take(request());s.observe();await assert.rejects(s.budget.take(request()),reason('local_budget'));
  await s.clock.advance(500);s.observe();await s.clock.advance(499);await assert.rejects(s.budget.take(request()),reason('local_budget'));
  await s.clock.advance(1);await s.budget.take(request());assert.equal(s.budget.status().localUsed,1);
});
test('queue has bounded length, per-request deadlines, cancellation and no timer left after closure',async()=>{
  const s=harness({requestsPerWindow:1,maxQueueSize:2,maxWaitMs:500});s.observe();await s.budget.take(request());
  const controller=new AbortController(),cancelled=s.budget.take({...request(1),signal:controller.signal}).then(()=>null,error=>error),expired=s.budget.take(request(2)).then(()=>null,error=>error);
  await assert.rejects(s.budget.take(request(3)),reason('queue_full'));controller.abort('PRIVATE CANCELLATION TEXT');assert.equal((await cancelled).reason,'cancelled');
  await s.clock.advance(500);assert.equal((await expired).reason,'deadline');assert.equal(s.budget.status().queued,0);assert.equal(s.clock.timersRemaining,0);
  s.budget.close();await assert.rejects(s.budget.take(request()),reason('closed'));assert.ok(!JSON.stringify(s.budget.status()).includes('PRIVATE'));
});
test('observation expiry and revocation reject queued permits rather than dispatching with stale pressure',async()=>{
  const s=harness({requestsPerWindow:1});s.observe();await s.budget.take(request());
  const queued=s.budget.take(request(1)).then(()=>null,error=>error);await s.clock.advance(1000);assert.equal((await queued).reason,'observation_stale');
  s.observe();const pending=s.budget.take(request(2));await pending;
  const revoked=s.budget.take(request(3)).then(()=>null,error=>error);s.budget.invalidateObservation();assert.equal((await revoked).reason,'observation_missing');assert.equal(s.clock.timersRemaining,0);
});
test('round-robin budget queue prevents one heavy actor from starving nineteen other active actors',async()=>{
  const s=harness({requestsPerWindow:2,maxWaitMs:60000}),admitted:{actor:number;at:number}[]=[];s.observe();
  const heavy=Array.from({length:20},()=>s.budget.take(request(0)).then(()=>{admitted.push({actor:0,at:s.clock.value});}));
  const peers=Array.from({length:19},(_,index)=>s.budget.take(request(index+1)).then(()=>{admitted.push({actor:index+1,at:s.clock.value});}));
  await flush();
  for(let halfSecond=0;halfSecond<40;halfSecond++){await s.clock.advance(500);s.observe();}
  await Promise.all([...heavy,...peers]);
  const peersDone=admitted.filter(row=>row.actor!==0);assert.equal(new Set(peersDone.map(row=>row.actor)).size,19);assert.ok(Math.max(...peersDone.map(row=>row.at-NOW))<=10000);
  assert.equal(admitted.filter(row=>row.actor===0&&row.at<NOW+9000).length,2);assert.equal(s.clock.timersRemaining,0);
});
test('20-actor mixed workflow burst accounts for all reads, writes, retries and readbacks within every rolling window',async()=>{
  const s=harness({requestsPerWindow:20,maxWaitMs:10000}),seen:{actor:number;kind:string;at:number}[]=[];s.observe();
  const sequences=[['read','read','read','read','read'],['preflight','note-create','readback'],['preflight','time-create','readback','safe-read-retry'],['read','schedule-create','child-create','readback']];
  const runs=Array.from({length:20},(_,actor)=>(async()=>{for(const kind of sequences[actor%4]!){await s.budget.take(request(actor));seen.push({actor,kind,at:s.clock.value});}})());
  await flush();for(let tick=0;tick<12;tick++){await s.clock.advance(500);s.observe(seen.filter(row=>row.at>s.clock.value-1000).length);}
  await Promise.all(runs);assert.equal(seen.length,80);assert.equal(new Set(seen.map(row=>row.actor)).size,20);assert.equal(s.budget.status().admitted,80);
  for(const row of seen)assert.ok(seen.filter(candidate=>candidate.at<=row.at&&candidate.at>row.at-1000).length<=20);
  assert.equal(seen.filter(row=>row.kind==='readback').length,15);assert.equal(seen.filter(row=>row.kind==='safe-read-retry').length,5);assert.equal(s.budget.status().queued,0);
  const completion=Array.from({length:20},(_,actor)=>Math.max(...seen.filter(row=>row.actor===actor).map(row=>row.at-NOW))).sort((a,b)=>a-b);
  await mkdir('work/budget-tests',{recursive:true});await writeFile('work/budget-tests/burst-results.json',JSON.stringify({source:'deterministic-simulator',liveTenantQualification:false,actors:20,physicalAttempts:seen.length,windowMs:1000,localRequestsPerWindow:20,workflowCompletionP95Ms:completion[Math.ceil(completion.length*.95)-1],workflowCompletionMaxMs:completion.at(-1),readbacks:15,safeReadRetries:5,status:s.budget.status()},null,2));
});
test('20-actor sustained synthetic soak preserves headroom under competing integration pressure',async()=>{
  const s=harness({requestsPerWindow:40,reservedExternalHeadroom:20,maxWaitMs:0}),seen:{actor:number;at:number}[]=[];let rejected=0;
  for(let round=0;round<240;round++) {
    const localInWindow=seen.filter(row=>row.at>s.clock.value-1000).length,external=round%20<10?65:40;s.observe(localInWindow+external,100);
    const results=await Promise.allSettled(Array.from({length:20},(_,actor)=>s.budget.take(request(actor)).then(()=>{seen.push({actor,at:s.clock.value});})));
    rejected+=results.filter(result=>result.status==='rejected').length;
    assert.ok(s.budget.status().localUsed!<=40);assert.ok(s.budget.status().observedRemaining!>=0);
    await s.clock.advance(250);
  }
  assert.ok(seen.length>200);assert.ok(rejected>0);assert.equal(new Set(seen.map(row=>row.actor)).size,20);assert.equal(s.budget.status().queued,0);assert.equal(s.clock.timersRemaining,0);
  for(const row of seen)assert.ok(seen.filter(candidate=>candidate.at<=row.at&&candidate.at>row.at-1000).length<=40);
  await mkdir('work/budget-tests',{recursive:true});await writeFile('work/budget-tests/soak-results.json',JSON.stringify({source:'deterministic-simulator',liveTenantQualification:false,actors:20,durationMs:60000,attempted:4800,admitted:seen.length,rejected,windowMs:1000,localRequestsPerWindow:40,syntheticGlobalLimit:100,reservedExternalHeadroom:20,simulatedExternalUsage:[65,40],status:s.budget.status()},null,2));
});
test('clock regression invalidates observations and never creates free capacity',async()=>{
  const s=harness();s.observe();await s.budget.take(request());s.clock.value--;await assert.rejects(s.budget.take(request()),reason('clock_invalid'));s.clock.value=NOW;
  await assert.rejects(s.budget.take(request()),reason('observation_missing'));s.observe();assert.equal(s.budget.status().localUsed,1);
});

const p:Principal={tenantId:'tenant',objectId:'actor-1',resourceId:42,mappingVersion:1,policyVersion:'v1',active:true,capabilities:['operational.read','tickets.write','time.self'],companyIds:[10],resourceVerifiedAt:new Date(NOW).toISOString()};
function adapter(budget:RequestBudgetPort,handler:(method:string,calls:number)=>Response|Promise<Response>,options:Partial<HttpAutotaskAdapterOptions>={}) {
  let calls=0;const operations:AutotaskOperation[]=['Tickets.query','Tickets.get','Tickets.patch'];
  const instance=new HttpAutotaskAdapter({baseUrl:'https://webservices3.autotask.net/atservicesrest/v1.0/',username:'synthetic',secret:'synthetic',integrationCode:'synthetic',cursorSecret:'synthetic-cursor-key-of-at-least-32-bytes',now:()=>NOW,sleep:async()=>{},requestBudget:budget,revalidatePrincipal:async()=>p,
    qualifications:operations.map(operation=>({operation,evidenceSource:'live',headerAccepted:true,permissionEnforced:true,nativeAttribution:true,testIds:['synthetic-only'],resourceIds:[42],tenantId:'tenant',policyVersion:'v1',qualifiedAt:new Date(NOW-1).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),evidenceReference:'synthetic-local-test-not-deployment'})),
    fetch:async(_url,init)=>handler(init!.method!,++calls),...options});return{instance,calls:()=>calls};
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('base HTTP adapter charges each safe read retry and rejects a mutation before its fetch when budget is exhausted',async()=>{
  const s=harness({requestsPerWindow:2,maxWaitMs:0});s.observe();
  const retry=adapter(s.budget,(_method,calls)=>calls===1?json({},503):json({items:[{id:1,companyID:10}],pageDetails:{nextPageUrl:null}}));
  await retry.instance.query(p,{entity:'Tickets',filters:[],pageSize:10});assert.equal(retry.calls(),2);assert.equal(s.budget.status().admitted,2);
  const second=harness({requestsPerWindow:1,maxWaitMs:0});second.observe();const methods:string[]=[];
  const write=adapter(second.budget,method=>{methods.push(method);return json({item:{id:1,companyID:10,title:'Original'}});});
  await assert.rejects(write.instance.patchTicket(p,1,{title:'New'}),reason('local_budget'));assert.deepEqual(methods,['GET']);
});
test('identity is rechecked after a budget wait before any HTTP mutation or read is sent',async()=>{
  let release!:()=>void;const waited=new Promise<void>(resolve=>{release=resolve;}),status=new FixtureUnlimitedRequestBudget().status();
  let entered!:()=>void;const admission=new Promise<void>(resolve=>{entered=resolve;});let active=true;
  const budget:RequestBudgetPort={take:async()=>{entered();await waited;},status:()=>status};
  const s=adapter(budget,()=>json({}),{revalidatePrincipal:async()=>({...p,active})});
  const reading=s.instance.query(p,{entity:'Tickets',filters:[],pageSize:10});await admission;active=false;release();await assert.rejects(reading,{code:'identity_mapping_invalid'});assert.equal(s.calls(),0);
});
test('time eligibility is refreshed after a budget wait and an expired work-date observation prevents the POST',async()=>{
  let clock=NOW,takes=0,release!:()=>void,entered!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;}),admission=new Promise<void>(resolve=>{entered=resolve;});
  const budget:RequestBudgetPort={take:async()=>{if(++takes===2){entered();await wait;}},status:()=>new FixtureUnlimitedRequestBudget().status()};
  const checks:number[]=[],methods:string[]=[];
  const metadata={...fixtureWorkMetadata(p,1),source:'Autotask' as const,validUntil:new Date(NOW+60000).toISOString()};
  const operations:AutotaskOperation[]=['Tickets.get','TimeEntries.create'];
  const s=adapter(budget,method=>{methods.push(method);return json({item:{id:1,companyID:10,title:'Ticket'}});},{now:()=>clock,
    resolveTicketWorkMetadata:async()=>metadata,validateTicketTimeEligibility:async()=>{checks.push(clock);return clock<NOW+1000;},
    qualifications:operations.map(operation=>({operation,evidenceSource:'live',headerAccepted:true,permissionEnforced:true,nativeAttribution:true,testIds:['synthetic-only'],resourceIds:[42],tenantId:'tenant',policyVersion:'v1',qualifiedAt:new Date(NOW-1).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),evidenceReference:'synthetic-not-live'}))});
  const creating=s.instance.createTicketTime(p,1,{resourceID:42,roleID:201,billingCodeID:301,hoursWorked:1,dateWorked:'2026-09-10T00:00:00Z',summaryNotes:'Synthetic time'});
  await admission;clock+=2000;release();await assert.rejects(creating,{code:'precondition_failed'});
  // Preparation and the post-admission metadata boundary each read the scoped parent.
  assert.deepEqual(methods,['GET','GET']);assert.deepEqual(checks,[NOW+2000]);assert.equal(takes,3);
});

test('local threshold capture requires strict JSON, current mtimes and hash-verified evidence with no stale fallback',async()=>{
  await mkdir('work/budget-tests',{recursive:true});const root=await mkdtemp(resolve('work/budget-tests/case-')),path=resolve(root,'threshold.json'),evidencePath=resolve(root,'capture.json');
  const s=harness({windowMs:60000,observationMaxAgeMs:60000,requestsPerWindow:20,maxWaitMs:0}),provider=new LocalThresholdProvider(s.budget,{path,evidenceRoot:root,clock:s.clock.now});
  const write=async(used:number)=>{
    const source=JSON.stringify({synthetic_reviewed_capture:true,used}),hash=createHash('sha256').update(source).digest('hex');
    const observation={tenantId:'tenant',source:'ThresholdInformation',observedAt:new Date(s.clock.value).toISOString(),expiresAt:new Date(s.clock.value+60000).toISOString(),windowMs:60000,limit:1000,used,evidenceReference:`threshold:${hash}`};
    await writeFile(evidencePath,source);await writeFile(path,JSON.stringify({schemaVersion:1,observation,evidence:{path:'capture.json',sha256:hash}}));
    for(const file of [evidencePath,path])await utimes(file,new Date(s.clock.value),new Date(s.clock.value));
  };
  await write(0);await provider.validate();assert.equal(provider.status().admitted,0);await Promise.all(Array.from({length:10},(_,actor)=>provider.take(request(actor))));assert.equal(provider.status().admitted,10);
  await s.clock.advance(30000);await write(999);await assert.rejects(provider.take(request()),reason('shared_pressure'));
  await s.clock.advance(30000);await writeFile(evidencePath,'PRIVATE CHANGED EVIDENCE BODY');await utimes(evidencePath,new Date(s.clock.value),new Date(s.clock.value));
  await assert.rejects(provider.take(request()),error=>{assert.ok(error instanceof RequestBudgetError);assert.ok(!error.message.includes('PRIVATE'));return true;});assert.equal(provider.status().blocked,'observation_missing');
  await write(0);await assert.rejects(provider.take(request()),reason('observation_missing'));await s.clock.advance(30000);await provider.take(request());
  await s.clock.advance(30000);await assert.rejects(provider.take(request()));provider.close();assert.equal(s.clock.timersRemaining,0);
});
test('an already queued request refreshes its threshold file at thirty seconds and cannot use a corrupt replacement',async()=>{
  await mkdir('work/budget-tests',{recursive:true});const root=await mkdtemp(resolve('work/budget-tests/queued-')),path=resolve(root,'threshold.json'),sourcePath=resolve(root,'capture.json');
  const s=harness({requestsPerWindow:1,windowMs:60000,observationMaxAgeMs:60000,maxWaitMs:60000}),provider=new LocalThresholdProvider(s.budget,{path,evidenceRoot:root,clock:s.clock.now});
  const source='synthetic current threshold evidence',sha256=createHash('sha256').update(source).digest('hex');
  await writeFile(sourcePath,source);await writeFile(path,JSON.stringify({schemaVersion:1,observation:{tenantId:'tenant',source:'ThresholdInformation',observedAt:new Date(NOW).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),windowMs:60000,limit:1000,used:0,evidenceReference:'synthetic-only'},evidence:{path:'capture.json',sha256}}));
  for(const file of [sourcePath,path])await utimes(file,new Date(NOW),new Date(NOW));
  await provider.take(request());const queued=provider.take(request(1)).then(()=>null,error=>error);await flush();assert.equal(provider.status().queued,1);
  await writeFile(path,'CORRUPT REPLACEMENT');await utimes(path,new Date(NOW+29999),new Date(NOW+29999));await s.clock.advance(30000);
  await assert.rejects(provider.validate());assert.equal((await queued).reason,'observation_missing');assert.equal(provider.status().admitted,1);assert.equal(provider.status().queued,0);assert.equal(s.clock.timersRemaining,0);provider.close();
});

test('explicit zero reserve admits the full 10000 per hour but respects tenant usage',async()=>{
 const config=requestBudgetOptionsFromEnvironment({AUTOTASK_REQUESTS_PER_WINDOW:'10000',AUTOTASK_BUDGET_WINDOW_MS:'3600000',AUTOTASK_EXTERNAL_HEADROOM:'0',AUTOTASK_THRESHOLD_MAX_AGE_MS:'240000',AUTOTASK_THRESHOLD_PATH:'work/threshold.json'},'tenant')!;
 const s=harness(config);s.observe(0,10000);
 for(let i=0;i<10000;i++)await s.budget.take(request(i%10));
 assert.equal(s.budget.status().admitted,10000);await assert.rejects(s.budget.take(request()),reason('local_budget'));
 const shared=harness(config);shared.observe(9999,10000);await shared.budget.take(request());await assert.rejects(shared.budget.take(request()),reason('shared_pressure'));
});
