import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecution,withExecution,currentExecution,providerFetch,assertExecutionActive,traceStage,withReconciliation} from '../packages/execution/src/index.js';
import {fixtureHttp} from '../scripts/project2-benchmark.js';
import {createApplication} from '../apps/server/src/app.js';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';

test('execution traces isolate concurrent actors, exclude payloads/URLs and abort pre-dispatch reads',async()=>{
 const abort=new AbortController(),a=createExecution(abort.signal),b=createExecution(new AbortController().signal);let calls=0;
 const fetcher=providerFetch('fixture',async(_input,init)=>{calls++;assert(init?.signal);return Response.json({private:'never traced'});});
 await Promise.all([withExecution(a,()=>traceStage('read',()=>fetcher('https://provider.test/Tickets/12345?secret=CANARY'))),withExecution(b,()=>traceStage('read',()=>fetcher('https://provider.test/Tickets/67890')))]);
 assert.notEqual(a.traceId,b.traceId);assert(a.events.every(e=>e.trace_id===a.traceId));assert.doesNotMatch(JSON.stringify(a.events),/12345|CANARY|never traced|provider.test/);
 abort.abort();await assert.rejects(withExecution(a,()=>fetcher('https://provider.test/Tickets/12345')),{code:'precondition_failed'});assert.equal(calls,2);assert.equal(currentExecution(),undefined);
});

test('cancellation after provider mutation preserves verification reads but blocks another mutation',async()=>{
 const controller=new AbortController(),context=createExecution(controller.signal);let calls=0;
 const fetcher=providerFetch('fixture',async()=>{calls++;return Response.json({id:1});});
 await withExecution(context,async()=>{await fetcher('https://provider.test/Tickets',{method:'POST'});controller.abort();assert.throws(assertExecutionActive,{code:'precondition_failed'});await withReconciliation(()=>fetcher('https://provider.test/Tickets/1'));await assert.rejects(fetcher('https://provider.test/Tickets',{method:'POST'}),{code:'precondition_failed'});});assert.equal(calls,2);
});

test('legacy progress reaches actual socket before tool completes',async t=>{
 const f=await fixtureHttp();t.after(()=>f.close());const tool=f.system.runtime.tools.find(v=>v.name==='at_whoami')!,original=tool.run;let finish!:()=>void,started!:()=>void;
 const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>finish=r);tool.run=async(p,a)=>{started();await gate;return original(p,a);};
 const pending=fetch(new Request(f.base+'/mcp',{method:'POST',headers:{authorization:`Bearer ${f.system.tokens[0]!.token}`,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'at_whoami',arguments:{},_meta:{progressToken:'progress-1'}}})}));
 await entered;const response=await Promise.race([pending,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Progress was buffered')),1000))]);assert.match(response.headers.get('content-type')??'',/event-stream/);const reader=response.body!.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/notifications\/progress/);finish();while(!(await reader.read()).done){};
});
