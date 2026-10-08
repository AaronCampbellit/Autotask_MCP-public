import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deviceSearchFields,matchesDevice} from '../packages/rmm/src/device-search.js';
import {schemas} from '../packages/rmm/src/contracts.js';

test('every reviewed device field has a typed search filter',()=>{
 const spec=JSON.parse(readFileSync('packages/rmm/src/openapi.json','utf8'));
 const resolve=(s:any):any=>s.$ref?resolve(spec.components.schemas[s.$ref.split('/').at(-1)]):s;
 const response=resolve(spec.paths['/v2/site/{siteUid}/devices'].get.responses['200'].content['application/json'].schema);
 const fields=resolve(response.properties.devices.items).properties;
 const paths:string[]=[];
 for(const [key,schema] of Object.entries(fields)){const value=resolve(schema);if(value.properties)for(const child of Object.keys(value.properties))paths.push(`${key}.${child}`);else paths.push(key);}
 assert.deepEqual([...Object.values(deviceSearchFields).map(f=>f.path),'siteUid'].sort(),paths.sort());
 for(const [key,field] of Object.entries(deviceSearchFields)){
  const value=field.kind==='boolean'?false:field.kind==='number'?0:field.kind==='date'?'2026-09-17T00:00:00Z':'example';
  assert(schemas.rmm_device_search.safeParse({[key]:value}).success,key);
  const device:any={};const parts=field.path.split('.');let target=device;for(const part of parts.slice(0,-1))target=target[part]={};target[parts.at(-1)!]=value;
  assert(matchesDevice(device,{[key]:value}),key);assert(!matchesDevice({}, {[key]:value}),key);
 }
});
test('general query includes the site UID',()=>{assert(matchesDevice({siteUid:'site-example'},{query:'EXAMPLE'}));});
test('date filters support exact instants and inclusive bounds; missing dates do not match',()=>{
 const device={lastSeen:'2026-09-17T12:00:00Z'};
 assert(matchesDevice(device,{last_seen:'2026-09-17T07:00:00-05:00'}));
 assert(matchesDevice(device,{last_seen_after:'2026-09-17T12:00:00Z',last_seen_before:'2026-09-17T12:00:00Z'}));
 assert(!matchesDevice(device,{last_seen_after:'2026-09-18T00:00:00Z'}));
 assert(!matchesDevice({}, {last_seen_before:'2026-09-18T00:00:00Z'}));
 for(const args of [{last_seen:'yesterday'},{online:'false'},{patches_installed:-1},{query:' '},{unknown_filter:'x'}])assert(!schemas.rmm_device_search.safeParse(args).success);
});
