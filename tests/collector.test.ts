import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadOnlyCollector,normalizeThreshold,resourceObservation,collectorConfigSchema} from '../packages/collector/src/index.js';
import {LocalThresholdProvider,SharedRequestBudget} from '../packages/autotask/src/budget.js';
import {loadMetadataSnapshot,verifyLocalSources,RefreshingMetadataSnapshotProvider} from '../packages/metadata/src/index.js';
const config=collectorConfigSchema.parse({tenantId:'581437a9-8e26-4857-bc56-1d5a04e7f752',resourceId:17,policyVersion:'control-2',baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',windowMs:3600000,requestsPerWindow:100,externalHeadroom:1000,intervalMs:120000});
test('collector validates observed allowance, resource identity and fixed destination',()=>{
 assert.deepEqual(normalizeThreshold({externalRequestThreshold:10000,requestThresholdTimeframe:60,currentTimeframeRequestCount:660},config),{windowMs:3600000,limit:10000,used:660});
 for(const value of [{externalRequestThreshold:10000,requestThresholdTimeframe:1,currentTimeframeRequestCount:1},{externalRequestThreshold:10000,requestThresholdTimeframe:60,currentTimeframeRequestCount:9900}])assert.throws(()=>normalizeThreshold(value,config));
 assert.throws(()=>resourceObservation({items:[{id:18,isActive:true}]},17));
 assert.throws(()=>resourceObservation({items:[]},17));
 assert.equal(resourceObservation({items:[{id:17,isActive:false}]},17).isActive,false);
 assert.equal(collectorConfigSchema.safeParse({...config,baseUrl:'https://attacker.example/'}).success,false);
});
test('collector publishes verified evidence, preserves pinned metadata, charges failed calls, and does not renew on failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collector-'));let now=Date.now(),fail=false,changed=false;const calls:string[]=[];
 await mkdir(join(root,'registry'));await copyFile('registry/coverage.json',join(root,'registry/coverage.json'));
 const fetcher:typeof fetch=async(input,init)=>{
  assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');const url=new URL(String(input));calls.push(url.pathname);
  if(fail)return new Response('{}',{status:503});
  let data:unknown;
  if(url.pathname.endsWith('/ThresholdInformation'))data={externalRequestThreshold:10000,requestThresholdTimeframe:60,currentTimeframeRequestCount:660};
  else if(url.pathname.endsWith('/Resources/query'))data={items:[{id:17,isActive:true,secretBody:'not retained'}]};
  else {const entity=url.pathname.split('/').at(-3)!;const names=entity==='Resources'?['id','isActive']:entity==='Tickets'?['id','ticketNumber','companyID']:['id','companyName','isActive'];data={fields:names.map(name=>({name,dataType:name==='id'?'long':'string',isRequired:true,isReadOnly:true,isQueryable:!changed,isReference:false,referenceEntityType:'',secret:'not retained'}))};}
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 const collector=new ReadOnlyCollector(config,{root,directory:'config/metadata',credentials:{username:'u',secret:'s',integrationCode:'i'},fetch:fetcher,now:()=>now});
 try{
  await collector.run();const budget=new LocalThresholdProvider(new SharedRequestBudget({tenantId:config.tenantId,windowMs:config.windowMs,requestsPerWindow:200,reservedExternalHeadroom:1100,observationMaxAgeMs:240000,clock:()=>now}),{path:join(root,'config/metadata/threshold.json'),evidenceRoot:root,clock:()=>now});await budget.validate();assert.equal(budget.status().blocked,null);budget.close();const path=join(root,'config/metadata/snapshot.json');const first=await loadMetadataSnapshot(path,{now});await verifyLocalSources(first,root);assert.equal(first.qualifications.length,0);assert.equal(first.content.entities.every(e=>!e.complete),true);assert.equal(calls.length,5);
  const providerOptions={tenantId:config.tenantId,source:'Autotask' as const,clock:()=>now,verifiedSources:await verifyLocalSources(first,root),snapshotPath:path,workspaceRoot:root};
  const renewalProvider=new RefreshingMetadataSnapshotProvider(first,{...providerOptions,allowReadOnlyRenewal:true});const pinnedProvider=new RefreshingMetadataSnapshotProvider(first,providerOptions);
  now+=120000;await collector.run();const next=await loadMetadataSnapshot(path,{now});assert.equal(first.metadataDigest,next.metadataDigest);assert.notEqual(first.content.resourceVerifications[0]?.verifiedAt,next.content.resourceVerifications[0]?.verifiedAt);assert.equal(calls.length,7);
  const bytes=await readFile(path,'utf8');fail=true;await assert.rejects(collector.run());assert.equal(await readFile(path,'utf8'),bytes);assert.equal(JSON.parse(await readFile(join(root,'config/metadata/attempts.json'),'utf8')).attempts.length,8);
  fail=false;now+=86400000;await collector.run();const renewed=await loadMetadataSnapshot(path,{now});assert.notEqual(renewed.metadataDigest,first.metadataDigest);assert.ok(Date.parse(renewed.content.expiresAt)>Date.parse(first.content.expiresAt));
  assert.equal((await renewalProvider.getResourceVerification(config.tenantId,17)).active,true);await assert.rejects(pinnedProvider.getResourceVerification(config.tenantId,17));
  const unchanged=await readFile(path,'utf8');changed=true;now+=86400000;await assert.rejects(collector.run());assert.equal(await readFile(path,'utf8'),unchanged);
  const beforeCorrupt=calls.length;
  await writeFile(join(root,'config/metadata/attempts.json'),'bad');await assert.rejects(collector.run());assert.equal(calls.length,beforeCorrupt);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('multi-employee collector publishes and renews independent proofs without extra resource requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collector-multi-'));let now=Date.now(),resourceCalls=0,inactive=false,partial=false;
 await mkdir(join(root,'registry'));await copyFile('registry/coverage.json',join(root,'registry/coverage.json'));
 const collector=new ReadOnlyCollector({...config,verifyAllResources:true},{root,directory:'config/metadata',credentials:{username:'u',secret:'s',integrationCode:'i'},now:()=>now,fetch:async(input)=>{
  const url=new URL(String(input));if(url.pathname.endsWith('/ThresholdInformation'))return Response.json({externalRequestThreshold:10000,requestThresholdTimeframe:60,currentTimeframeRequestCount:100});
  if(url.pathname.endsWith('/Resources/query')){resourceCalls++;const q=JSON.parse(url.searchParams.get('search')!);assert.equal(q.MaxRecords,500);return Response.json({items:[{id:17,isActive:true},{id:18,isActive:!inactive}],pageDetails:{nextPageUrl:partial?'next':null}});}
  const entity=url.pathname.split('/').at(-3)!,names=entity==='Resources'?['id','isActive']:entity==='Tickets'?['id','ticketNumber','companyID']:['id','companyName','isActive'];return Response.json({fields:names.map(name=>({name,dataType:name==='id'?'long':'string',isRequired:true,isReadOnly:true,isQueryable:true,isReference:false,referenceEntityType:''}))});
 }});
 try{await collector.run();const path=join(root,'config/metadata/snapshot.json'),first=await loadMetadataSnapshot(path,{now});await verifyLocalSources(first,root);assert.equal(first.content.resourceVerifications.length,2);assert.equal(resourceCalls,1);
 now+=120000;inactive=true;await collector.run();const next=await loadMetadataSnapshot(path,{now});assert.equal(next.metadataDigest,first.metadataDigest);assert.equal(next.content.resourceVerifications.find(r=>r.resourceId===18)!.active,false);assert.equal(resourceCalls,2);const saved=await readFile(path,'utf8');partial=true;now+=120000;await assert.rejects(collector.run());assert.equal(await readFile(path,'utf8'),saved);
 }finally{await rm(root,{recursive:true,force:true});}
});
