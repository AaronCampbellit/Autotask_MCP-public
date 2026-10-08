import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExecution,withExecution,withReconciliation,providerFetch,currentExecution} from '../packages/execution/src/index.js';
test('cancelled accepted effect permits only explicit bounded recovery reads',async()=>{
 const abort=new AbortController(),context=createExecution(abort.signal);let writes=0,reads=0;
 const provider=providerFetch('fixture',async(_url,init)=>{if(init?.method==='POST'){writes++;abort.abort();}else{reads++;assert.equal(init?.signal?.aborted,false);}return Response.json({id:1});});
 await withExecution(context,async()=>{
  await provider('https://fixture.test/Tickets',{method:'POST'});
  await assert.rejects(provider('https://fixture.test/Tickets/1'),/cancelled/);
  await withReconciliation(async()=>{await provider('https://fixture.test/Tickets/1');await assert.rejects(provider('https://fixture.test/Tickets',{method:'POST'}),/Recovery scopes/);},20);
  await assert.rejects(provider('https://fixture.test/Tickets/1'),/cancelled/);
  const deadline=context.reconciliationDeadline;await withReconciliation(async()=>assert.equal(currentExecution()?.deadline,deadline),30000);
 });assert.equal(writes,1);assert.equal(reads,1);
});
test('recovery timeout reaches provider and cannot be extended by another scope',async()=>{
 const c=createExecution(new AbortController().signal);c.effectStarted=true;
 const provider=providerFetch('fixture',async(_url,init)=>{await new Promise<void>(resolve=>{const timer=setTimeout(resolve,100);init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});assert.equal(init?.signal?.aborted,true);throw new DOMException('Aborted','AbortError');});
 await withExecution(c,async()=>{await assert.rejects(withReconciliation(()=>provider('https://fixture.test/Tickets/1'),10));assert.throws(()=>withReconciliation(()=>1),/cancelled/);});
});
test('recovery wrapper cannot rescue a cancelled request before any effect',async()=>{const a=new AbortController(),c=createExecution(a.signal);a.abort();await withExecution(c,async()=>{await assert.rejects(withReconciliation(()=>providerFetch('fixture',async()=>{throw Error('unexpected dispatch');})('https://fixture.test/Tickets/1')),/cancelled/);});});
