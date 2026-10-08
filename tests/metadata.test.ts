import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { compileInventory, compileQualifications, compileSnapshot, coverageReport, diffSnapshots, metadataContentDigest, metadataHash, MetadataSnapshotProvider, validateSnapshot, type MetadataSnapshotInput, type TimeEligibilityEvidence } from '../packages/metadata/src/index.js';
import { fixtureMetadataInput, fixtureMetadataSnapshot } from '../packages/metadata/src/fixtures.js';
import { fixturePrincipals } from '../packages/workflows/src/fixtures.js';

const now=Date.parse('2026-09-10T12:00:00.000Z');
export const metadataInventory=compileInventory(JSON.parse(await readFile('registry/coverage.json','utf8')));
const p=fixturePrincipals()[0]!;
const make=()=>fixtureMetadataInput(metadataInventory,now,p);
const compile=(input:unknown)=>compileSnapshot(input,{inventory:metadataInventory,now});
const provider=(input=make(),clock=()=>now)=>new MetadataSnapshotProvider(compile(input),{inventory:metadataInventory,tenantId:p.tenantId,source:'fixture',clock});
const binding=(input:MetadataSnapshotInput,kind:string)=>input.content.bindings.find(b=>b.kind===kind)!;
const payload={resourceID:p.resourceId,roleID:201,billingCodeID:301,hoursWorked:1,dateWorked:'2026-09-10T00:00:00Z',summaryNotes:'PRIVATE WORK NOTES MUST NOT BE COPIED'};

/** Synthetic live-shaped test data only. These values are never shipped as tenant qualification. */
export function liveShapedMetadataInput():MetadataSnapshotInput {
  const input=make();input.content.source='Autotask';
  const meta=input.content.sources[0]!;meta.kind='metadata-export';meta.reference='work/metadata-tests/captured-metadata.json';
  const capture={...meta,id:'operational-observation',kind:'operational-capture' as const,reference:'work/metadata-tests/operational.json'};
  input.content.sources.push(capture);
  for(const b of input.content.bindings) {
    if(b.value&&typeof b.value==='object'&&!Array.isArray(b.value)&&'source' in b.value)(b.value as {source:string}).source='Autotask';
    if(b.kind==='time-eligibility')b.sourceIds=[capture.id];
  }
  input.content.resourceVerifications.forEach(row=>{row.sourceIds=[capture.id];});
  return input;
}

test('inventory preserves all 231 documentary labels without enabling any operation',()=>{
  assert.equal(metadataInventory.entities.length,231);assert.ok(metadataInventory.entities.some(e=>e.entity==='AttachmentInfo (REST API)'));
  const report=coverageReport(compile(make()),metadataInventory,now);assert.equal(report.entities.length,231);assert.equal(report.capturedEntities,8);assert.equal(report.completeEntities,0);assert.equal(report.liveEnablement,false);
  const raw=JSON.parse('{}');assert.throws(()=>compileInventory(raw));assert.throws(()=>compileInventory({entities:[{entity:'Tickets'},{entity:'Tickets'}]}));
});
test('snapshot digest is deterministic, versioned, tenant and inventory bound and immutable to caller edits',async()=>{
  const input=make(),snapshot=compile(input);assert.equal(snapshot.digest,compile(JSON.parse(JSON.stringify(input))).digest);assert.equal(snapshot.version,`metadata-v1-${snapshot.metadataDigest.slice(0,24)}`);
  const altered=structuredClone(snapshot);altered.content.entities[0]!.complete=true;assert.throws(()=>validateSnapshot(altered,{now}));
  assert.throws(()=>validateSnapshot(snapshot,{now,inventory:{...metadataInventory,digest:'f'.repeat(64)}}));
  assert.throws(()=>new MetadataSnapshotProvider(snapshot,{tenantId:'another-tenant',source:'fixture',clock:()=>now}));
  const service=provider(input);(binding(input,'ticket-work').value as any).note.types=[];
  const result=await service.resolveTicketWork(p,1001);assert.ok(result.note.types.length);result.note.types=[];assert.ok((await service.resolveTicketWork(p,1001)).note.types.length);
});
for(const [name,mutate] of [
  ['duplicate field',(input:MetadataSnapshotInput)=>input.content.entities[0]!.fields.push({...input.content.entities[0]!.fields[0]!})],
  ['wrong field case',(input:MetadataSnapshotInput)=>{input.content.entities.find(e=>e.entity==='Tickets')!.fields.find(f=>f.name==='assignedResourceRoleID')!.name='assignedResourceroleID';}],
  ['unreviewed picklist value',(input:MetadataSnapshotInput)=>{(binding(input,'ticket-work').value as any).note.types[0].label='changed';}],
  ['missing required native field',(input:MetadataSnapshotInput)=>{const e=input.content.entities.find(e=>e.entity==='TimeEntries')!;e.fields=e.fields.filter(f=>f.name!=='dateWorked');}],
  ['duplicate binding',(input:MetadataSnapshotInput)=>input.content.bindings.push({...input.content.bindings[0]!,id:'duplicate-lookup'})],
  ['unknown native entity',(input:MetadataSnapshotInput)=>{input.content.entities[0]!.entity='InventedEntity';}],
  ['raw record body',(input:MetadataSnapshotInput)=>{(binding(input,'ticket-work').value as any).summaryNotes='SECRET BODY';}],
  ['source path traversal',(input:MetadataSnapshotInput)=>{input.content.sources[0]!.reference='../private-secret.txt';}],
  ['source URL query secret',(input:MetadataSnapshotInput)=>{input.content.sources[0]!.kind='documentation';input.content.sources[0]!.reference='https://www.autotask.net/help?secret=canary';}],
  ['unbounded metadata expiry',(input:MetadataSnapshotInput)=>{input.content.expiresAt=new Date(now+32*86400000).toISOString();}],
  ['ambiguous parent default',(input:MetadataSnapshotInput)=>{const f=input.content.entities.find(e=>e.entity==='TicketNotes')!.fields.find(f=>f.name==='noteType')!;f.picklist!.push({...f.picklist![0]!,value:999,default:true});}],
  ['unbound resource capture',(input:MetadataSnapshotInput)=>{input.content.resourceVerifications[0]!.verifiedAt=new Date(now-1000).toISOString();}],
  ['operational window longer than five minutes',(input:MetadataSnapshotInput)=>{input.content.resourceVerifications[0]!.expiresAt=new Date(now+300001).toISOString();}],
] as const)test(`compiler rejects ${name}`,()=>{const input=make();mutate(input);assert.throws(()=>compile(input));});

test('provider requires exact actor mapping, policy, ticket, reference context and company scope',async()=>{
  const service=provider();assert.equal((await service.resolveTicketWork(p,1001)).version,compile(make()).version);
  assert.equal((await service.resolveTechnicianMetadata(p,1001)).ticketId,1001);assert.ok((await service.resolveCatalog(p,'company')).items.length);
  assert.equal((await service.resolveSchedulingMetadata(p,1001)).ticketId,1001);assert.ok((await service.resolveResources(p)).length);
  for(const changed of [{...p,objectId:'peer'},{...p,resourceId:p.resourceId+1},{...p,mappingVersion:2},{...p,policyVersion:'v2'},{...p,companyIds:[999]},{...p,active:false},{...p,capabilities:[]}])await assert.rejects(service.resolveTicketWork(changed,1001));
  await assert.rejects(service.resolveTicketWork(p,1002));await assert.rejects(service.resolveCatalog(p,'queue',{queueId:999}));
});
test('stale selected binding fails closed without blocking a different still-current metadata binding',async()=>{
  let clock=now;const service=provider(make(),()=>clock);clock+=300000;
  assert.equal((await service.resolveTicketWork(p,1001)).ticketId,1001);
  await assert.rejects(service.getResourceVerification(p.tenantId,p.resourceId));await assert.rejects(service.validateTicketTimeEligibility(p,1001,payload));
  clock=now+86400000;await assert.rejects(service.resolveTicketWork(p,1001));
});
test('time eligibility binds exact date, mapped resource, effective role/work type and remaining hours without retaining bodies',async()=>{
  const input=make(),value=binding(input,'time-eligibility').value as TimeEligibilityEvidence;
  const actual={...payload,roleID:value.assignments[0]!.roleId,billingCodeID:value.assignments[0]!.workTypeId};
  const service=provider(input);assert.equal(await service.validateTicketTimeEligibility(p,1001,actual),true);
  assert.equal(await service.validateTicketTimeEligibility(p,1001,{...actual,hoursWorked:9}),false);
  assert.equal(await service.validateTicketTimeEligibility(p,1001,{...actual,roleID:999}),false);
  await assert.rejects(service.validateTicketTimeEligibility(p,1001,{...actual,dateWorked:'2026-09-11T00:00:00Z'}));
  await assert.rejects(service.validateTicketTimeEligibility(p,1001,{...actual,resourceID:999}));
  assert.ok(!JSON.stringify(compile(input)).includes(payload.summaryNotes));
  for(const mutate of [(v:TimeEligibilityEvidence)=>{v.period.status='locked';},(v:TimeEligibilityEvidence)=>{v.contractAllowsTime=false;},(v:TimeEligibilityEvidence)=>{v.resourceActive=false;},(v:TimeEligibilityEvidence)=>{v.dateContainerVerified=false;},(v:TimeEligibilityEvidence)=>{v.assignments[0]!.roleEffective=false;}]) {
    const copy=make();mutate(binding(copy,'time-eligibility').value as TimeEligibilityEvidence);assert.equal(await provider(copy).validateTicketTimeEligibility(p,1001,actual),false);
  }
});
test('resource verification returns its actual captured timestamp and rejects unknown, inactive, foreign or expired resources',async()=>{
  const service=provider();const verified=await service.getResourceVerification(p.tenantId,p.resourceId);assert.equal(verified.verifiedAt,new Date(now).toISOString());
  assert.equal(await service.verifyResource(p.tenantId,p.resourceId),true);await assert.rejects(service.verifyResource('foreign',p.resourceId));await assert.rejects(service.verifyResource(p.tenantId,999));
  const input=make();input.content.resourceVerifications[0]!.active=false;await assert.rejects(provider(input).verifyResource(p.tenantId,p.resourceId));
});
test('live source files must be verified separately from a valid snapshot digest',async()=>{
  const input=liveShapedMetadataInput(),snapshot=compile(input),service=new MetadataSnapshotProvider(snapshot,{tenantId:p.tenantId,source:'Autotask',clock:()=>now});
  await assert.rejects(service.resolveTicketWork(p,1001));await assert.rejects(service.getResourceVerification(p.tenantId,p.resourceId));
  const verifiedSources=Object.fromEntries(input.content.sources.map(source=>[source.id,source.sha256]));
  const verified=new MetadataSnapshotProvider(snapshot,{tenantId:p.tenantId,source:'Autotask',clock:()=>now,verifiedSources});assert.equal((await verified.resolveTicketWork(p,1001)).source,'Autotask');
});
test('qualifications compile only explicitly requested exact operations with verified live test evidence',()=>{
  assert.deepEqual(compileQualifications(compile(make()),{operations:[],verifiedSources:{},now}),[]);
  assert.throws(()=>compileQualifications(compile(make()),{operations:['Tickets.query'],verifiedSources:{},now}));
  const input=liveShapedMetadataInput();input.content.sources.push({id:'tested-scope',kind:'tenant-test',reference:'work/metadata-tests/tests.json',sha256:createHash('sha256').update('synthetic test evidence').digest('hex'),capturedAt:new Date(now).toISOString()});
  input.qualifications.push({operation:'TimeEntries.create',evidenceSource:'live',tenantId:p.tenantId,policyVersion:p.policyVersion,resourceIds:[p.resourceId],testIds:['allow-scope','deny-scope','revoke-mapping','native-resource'],sourceIds:['tested-scope'],metadataDigest:metadataContentDigest(input.content),qualifiedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),reviewedBy:'synthetic-test-reviewer',headerAccepted:true,permissionEnforced:true,nativeAttribution:true,positiveScopeVerified:true,negativeScopeVerified:true,mappingRevocationVerified:true});
  const verifiedSources=Object.fromEntries(input.content.sources.map(source=>[source.id,source.sha256]));
  const output=compileQualifications(compile(input),{operations:['TimeEntries.create'],verifiedSources,now});assert.equal(output.length,1);assert.equal(output[0]!.operation,'TimeEntries.create');
  assert.throws(()=>compileQualifications(compile(input),{operations:['Tickets.query'],verifiedSources,now}));
  assert.throws(()=>compileQualifications(compile(input),{operations:['TimeEntries.create'],verifiedSources:{},now}));
  for(const flag of ['headerAccepted','permissionEnforced','nativeAttribution','positiveScopeVerified','negativeScopeVerified','mappingRevocationVerified'] as const) {const copy=structuredClone(input);copy.qualifications[0]![flag]=false;assert.throws(()=>compileQualifications(compile(copy),{operations:['TimeEntries.create'],verifiedSources,now}));}
  assert.throws(()=>compileQualifications(compile(input),{operations:['TimeEntries.create'],verifiedSources,now:now+60000}));
});
test('short-lived operational refresh changes envelope integrity but preserves the qualified metadata digest',()=>{
  const input=liveShapedMetadataInput(),before=compile(input),afterInput=structuredClone(input),later=now+1000;
  const source=afterInput.content.sources.find(source=>source.kind==='operational-capture')!;source.sha256='a'.repeat(64);source.capturedAt=new Date(later).toISOString();
  const b=binding(afterInput,'time-eligibility'),v=b.value as TimeEligibilityEvidence;v.checkedAt=source.capturedAt;v.validUntil=new Date(later+300000).toISOString();b.validUntil=v.validUntil;
  afterInput.content.resourceVerifications[0]!.verifiedAt=source.capturedAt;afterInput.content.resourceVerifications[0]!.expiresAt=v.validUntil;
  const after=compileSnapshot(afterInput,{inventory:metadataInventory,now:later});assert.notEqual(after.digest,before.digest);assert.equal(after.metadataDigest,before.metadataDigest);
  assert.equal(diffSnapshots(before,after,later).requiresNewQualification,false);
});
test('safe diff reports native field paths and counts without picklist labels, UDF names or bodies',()=>{
  const first=make(),second=make();const e=second.content.entities.find(e=>e.entity==='Tickets')!;e.fields.find(f=>f.name==='title')!.maxLength=200;
  e.userDefinedFields.push({name:'PRIVATE UDF LABEL',dataType:'string',required:false,readOnly:false,queryable:false});
  const report=diffSnapshots(compile(first),compile(second),now),text=JSON.stringify(report);assert.equal(report.requiresNewQualification,true);assert.ok(report.fields.some(row=>row.field==='title'));assert.equal(report.userDefinedFieldChanges,1);assert.ok(!text.includes('PRIVATE UDF LABEL'));
  assert.equal(metadataHash({b:1,a:2}),metadataHash({a:2,b:1}));
});
test('checked-in fixture is a reproducible documentation sample with no tenant qualifications',async()=>{
  const raw=JSON.parse(await readFile('packages/metadata/src/fixture.snapshot.json','utf8'));
  const snapshot=validateSnapshot(raw,{inventory:metadataInventory,now,requireFresh:false});assert.equal(snapshot.content.source,'fixture');assert.deepEqual(snapshot.qualifications,[]);assert.equal(snapshot.digest,fixtureMetadataSnapshot(metadataInventory,now).digest);
});
