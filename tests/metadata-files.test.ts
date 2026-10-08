import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compileInventory, compileSnapshot, loadMetadataSnapshot, RefreshingMetadataSnapshotProvider, verifyLocalSources, type TimeEligibilityEvidence } from '../packages/metadata/src/index.js';
import { fixtureMetadataInput } from '../packages/metadata/src/fixtures.js';
import { fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { runMetadataCli } from '../scripts/metadata-tool.js';

const now=Date.parse('2026-09-10T12:00:00.000Z'),p=fixturePrincipals()[0]!;
const inventory=compileInventory(JSON.parse(await readFile('registry/coverage.json','utf8')));
await mkdir('work/metadata-tests',{recursive:true});
const directory=()=>mkdtemp(resolve('work/metadata-tests/case-'));
async function liveFiles() {
  const root=await directory(),input=fixtureMetadataInput(inventory,now,p);input.content.source='Autotask';
  const bytes=JSON.stringify({synthetic_metadata:true,record_bodies:false}),sha256=createHash('sha256').update(bytes).digest('hex');
  const source=input.content.sources[0]!;source.kind='metadata-export';source.reference='metadata.json';source.sha256=sha256;
  input.content.sources.push({...source,id:'operational-observation',kind:'operational-capture',reference:'operational.json'});
  for(const b of input.content.bindings) {
    if(b.value&&typeof b.value==='object'&&!Array.isArray(b.value)&&'source' in b.value)(b.value as {source:string}).source='Autotask';
    if(b.kind==='time-eligibility')b.sourceIds=['operational-observation'];
  }
  input.content.resourceVerifications[0]!.sourceIds=['operational-observation'];
  await writeFile(resolve(root,'metadata.json'),bytes);await writeFile(resolve(root,'operational.json'),bytes);
  const snapshot=compileSnapshot(input,{inventory,now}),snapshotPath=resolve(root,'snapshot.json');await writeFile(snapshotPath,JSON.stringify(snapshot));
  return{root,input,snapshot,snapshotPath};
}

test('local snapshot loader and evidence verification validate hashes without exposing file contents',async()=>{
  const s=await liveFiles(),loaded=await loadMetadataSnapshot(s.snapshotPath,{inventory,now});assert.equal(loaded.digest,s.snapshot.digest);
  const verified=await verifyLocalSources(loaded,s.root);assert.equal(Object.keys(verified).length,2);assert.ok(Object.values(verified).every(hash=>/^[a-f0-9]{64}$/.test(hash)));
  await writeFile(resolve(s.root,'metadata.json'),'SECRET CANARY FILE BODY');
  await assert.rejects(verifyLocalSources(loaded,s.root),error=>{assert.ok(error instanceof Error);assert.ok(!error.message.includes('SECRET'));assert.ok(!error.message.includes(s.root));return true;});
  await writeFile(s.snapshotPath,'SECRET INVALID JSON CONTENT');await assert.rejects(loadMetadataSnapshot(s.snapshotPath,{now}),error=>{assert.ok(error instanceof Error);assert.ok(!error.message.includes('SECRET'));return true;});
});
test('evidence verification rejects paths outside its fixed root and never follows documentation URLs',async()=>{
  const s=await liveFiles(),escaped=structuredClone(s.snapshot);escaped.content.sources[0]!.reference='../outside.json';await assert.rejects(verifyLocalSources(escaped,s.root));
  const fixture=compileSnapshot(fixtureMetadataInput(inventory,now),{inventory,now});assert.deepEqual(await verifyLocalSources(fixture,s.root),{});
});
test('refresh replaces operational captures atomically while preserving the reviewed metadata version',async()=>{
  const s=await liveFiles();let clock=now;
  const provider=new RefreshingMetadataSnapshotProvider(s.snapshot,{tenantId:p.tenantId,source:'Autotask',inventory,clock:()=>clock,verifiedSources:await verifyLocalSources(s.snapshot,s.root),snapshotPath:s.snapshotPath,workspaceRoot:s.root});
  assert.equal((await provider.getResourceVerification(p.tenantId,p.resourceId)).verifiedAt,new Date(now).toISOString());
  clock+=30000;const capture=s.input.content.sources.find(source=>source.kind==='operational-capture')!,capturedAt=new Date(clock).toISOString(),expiresAt=new Date(clock+300000).toISOString();
  const bytes=JSON.stringify({synthetic_metadata:true,resourceId:p.resourceId,active:true,capturedAt});capture.sha256=createHash('sha256').update(bytes).digest('hex');capture.capturedAt=capturedAt;
  const binding=s.input.content.bindings.find(b=>b.kind==='time-eligibility')!;binding.validUntil=expiresAt;Object.assign(binding.value as TimeEligibilityEvidence,{checkedAt:capturedAt,validUntil:expiresAt});
  Object.assign(s.input.content.resourceVerifications[0]!,{verifiedAt:capturedAt,expiresAt});
  const next=compileSnapshot(s.input,{inventory,now:clock});assert.equal(next.metadataDigest,s.snapshot.metadataDigest);
  await writeFile(resolve(s.root,'operational.json'),bytes);await writeFile(s.snapshotPath,JSON.stringify(next));
  const responses=await Promise.all(Array.from({length:20},()=>provider.getResourceVerification(p.tenantId,p.resourceId)));
  assert.ok(responses.every(row=>row.verifiedAt===capturedAt));assert.equal((await provider.resolveTicketWork(p,1001)).version,s.snapshot.version);
});
test('missing or corrupt replacement fails every callback after the refresh deadline with no stale fallback',async()=>{
  const s=await liveFiles();let clock=now;
  const provider=new RefreshingMetadataSnapshotProvider(s.snapshot,{tenantId:p.tenantId,source:'Autotask',inventory,clock:()=>clock,verifiedSources:await verifyLocalSources(s.snapshot,s.root),snapshotPath:s.snapshotPath,workspaceRoot:s.root});
  await writeFile(s.snapshotPath,'INVALID REPLACEMENT CANARY');assert.equal((await provider.resolveTicketWork(p,1001)).ticketId,1001);
  clock+=30000;await assert.rejects(provider.resolveTicketWork(p,1001));await assert.rejects(provider.resolveTechnicianMetadata(p,1001));await assert.rejects(provider.resolveCatalog(p,'company'));await assert.rejects(provider.resolveSchedulingMetadata(p,1001));await assert.rejects(provider.resolveResources(p));await assert.rejects(provider.verifyResource(p.tenantId,p.resourceId));
  await writeFile(s.snapshotPath,JSON.stringify(s.snapshot));await assert.rejects(provider.resolveTicketWork(p,1001));clock+=30000;assert.equal((await provider.resolveTicketWork(p,1001)).ticketId,1001);
});
test('changed reviewed metadata or evidence files cannot silently preserve initial qualification',async()=>{
  const s=await liveFiles();let clock=now;
  const provider=new RefreshingMetadataSnapshotProvider(s.snapshot,{tenantId:p.tenantId,source:'Autotask',inventory,clock:()=>clock,verifiedSources:await verifyLocalSources(s.snapshot,s.root),snapshotPath:s.snapshotPath,workspaceRoot:s.root});
  s.input.content.entities.find(e=>e.entity==='Tickets')!.fields.find(f=>f.name==='title')!.maxLength=200;
  const replacement=compileSnapshot(s.input,{inventory,now});await writeFile(s.snapshotPath,JSON.stringify(replacement));clock+=30000;await assert.rejects(provider.resolveTicketWork(p,1001));
  await writeFile(s.snapshotPath,JSON.stringify(s.snapshot));await writeFile(resolve(s.root,'metadata.json'),'changed capture');clock+=30000;await assert.rejects(provider.resolveTicketWork(p,1001));
  assert.throws(()=>new RefreshingMetadataSnapshotProvider(s.snapshot,{tenantId:p.tenantId,source:'Autotask',clock:()=>now,snapshotPath:s.snapshotPath,workspaceRoot:s.root,refreshIntervalMs:30001}));
});
test('CLI inventory, fixture, validate, coverage, import and diff are local and produce only safe reports',async()=>{
  const root=await directory(),out=resolve(root,'fixture.json'),args=['--at',new Date(now).toISOString()];
  const inventoryReport=await runMetadataCli(['inventory',...args]) as any;assert.equal(inventoryReport.total,231);assert.equal(inventoryReport.liveEnablement,false);
  const created=await runMetadataCli(['fixture','--out',out,...args]) as any;assert.equal(created.source,'fixture');assert.equal(created.liveEnablement,false);
  assert.equal((await runMetadataCli(['validate','--input',out,...args]) as any).valid,true);
  assert.equal((await runMetadataCli(['coverage','--input',out,...args]) as any).entities.length,231);
  const inputPath=resolve(root,'input.json'),second=resolve(root,'imported.json');await writeFile(inputPath,JSON.stringify(fixtureMetadataInput(inventory,now)));
  assert.equal((await runMetadataCli(['import','--input',inputPath,'--out',second,...args]) as any).valid,true);
  assert.equal((await runMetadataCli(['diff','--before',out,'--after',second,...args]) as any).changed,false);
  await assert.rejects(runMetadataCli(['fixture','--out',out,...args]),{code:'conflict'});
  await assert.rejects(runMetadataCli(['validate','--input',out,'--at',new Date(now+86400000).toISOString()]));
  await assert.rejects(runMetadataCli(['validate','--input',out,'--token','SECRET']));
});
