import test from 'node:test';
import assert from 'node:assert/strict';
import {project} from '../packages/rmm/src/projection.js';
import {matchesDevice} from '../packages/rmm/src/device-search.js';

const path='/v2/site/{siteUid}/devices';
const timestamp=Date.parse('2026-09-21T14:00:00Z');
const page=(fields:Record<string,unknown>)=>({devices:[{uid:'device-a',siteUid:'site-a',lastLoggedInUser:'DOMAIN\\Ricky.Green',...fields}],pageDetails:{nextPageUrl:null}});
test('numeric device timestamps normalize before last-user and date filtering',()=>{
 const fields=Object.fromEntries(['lastSeen','lastReboot','lastAuditDate','creationDate'].map(k=>[k,timestamp]));
 const device=project(path,page(fields)).devices[0];
 for(const key of Object.keys(fields))assert.equal(device[key],'2026-09-21T14:00:00.000Z');
 assert.equal(matchesDevice(device,{last_logged_in_user:'ricky',last_seen_after:'2026-09-21T13:00:00Z'}),true);
 assert.equal(matchesDevice(device,{last_logged_in_user:'someone else'}),false);
 assert.equal(matchesDevice(device,{last_seen_before:'2026-09-21T13:00:00Z'}),false);
});
test('ISO dates and null timestamps remain unchanged; invalid types still fail closed',()=>{
 const device=project(path,page({lastSeen:null,lastReboot:'2026-09-21T14:00:00Z'})).devices[0];
 assert.equal(device.lastSeen,null);assert.equal(device.lastReboot,'2026-09-21T14:00:00Z');
 for(const value of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>project(path,page({lastSeen:value})),/timestamp is invalid/);
 assert.throws(()=>project(path,page({lastLoggedInUser:123})),/invalid type/);
 assert.throws(()=>project(path,page({online:1})),/invalid type/);
});
