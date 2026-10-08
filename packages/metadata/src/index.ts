import { createHash } from 'node:crypto';
import { AppError, type Principal } from '../../contracts/src/index.js';
import { assertWorkMetadata } from '../../resolution/src/index.js';
import { assertReferenceCatalog, assertTechnicianMetadata } from '../../technician/src/index.js';
import { reviewedMetadata, reviewedResources } from '../../scheduling/src/contracts.js';
import { METADATA_OPERATIONS, snapshotInputSchema, snapshotSchema, type CompiledQualification, type EntityInventory, type MetadataBinding, type MetadataContent, type MetadataOperation, type MetadataSnapshot, type MetadataSnapshotInput } from './contracts.js';
import { reviewedTimeEligibility, validateResourceEvidence } from './eligibility.js';
export type * from './contracts.js';
export { METADATA_OPERATIONS } from './contracts.js';
export { compileInventory } from './inventory.js';

export const metadataError = () => new AppError('missing_metadata','Reviewed metadata is absent, invalid, expired, or does not match this context.');
export function canonicalMetadata(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonicalMetadata).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.keys(value).filter(k=>(value as Record<string,unknown>)[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${canonicalMetadata((value as Record<string,unknown>)[k])}`).join(',')}}`;
  const text=JSON.stringify(value);if(text===undefined)throw metadataError();return text;
}
export const metadataHash=(value:unknown)=>createHash('sha256').update(canonicalMetadata(value)).digest('hex');
export function metadataContentDigest(content:MetadataContent):string {
  // Operational observations and tenant-test captures do not change the metadata those tests evaluated.
  const {resourceVerifications:_observations,...metadata}=content;
  return metadataHash({...metadata,bindings:content.bindings.filter(binding=>binding.kind!=='time-eligibility'),sources:content.sources.filter(source=>!['tenant-test','operational-capture'].includes(source.kind))});
}
const unique=(values:unknown[])=>new Set(values.map(canonicalMetadata)).size===values.length;
export function safeSourceReference(reference:string,kind:string):boolean {
  if(reference.startsWith('fixture:'))return kind==='fixture'&&/^fixture:[A-Za-z0-9._-]+$/.test(reference);
  if(reference.startsWith('https://')) {
    try {const url=new URL(reference);return kind==='documentation'&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.hostname==='www.autotask.net'||/^webservices\d+\.autotask\.net$/.test(url.hostname));}catch{return false;}
  }
  return !reference.startsWith('/')&&!reference.includes('\\')&&!reference.includes(':')&&!reference.split('/').some(part=>!part||part==='.'||part==='..')&&!/[\0\r\n]/.test(reference);
}
export function bindingPrincipal(binding:MetadataBinding):Principal {
  return {...binding.actor,companyIds:[...binding.companyIds],capabilities:['operational.read','tickets.write','time.self','time.team','scheduling.write'],active:true,resourceVerifiedAt:binding.validUntil};
}
export function bindingLookupKey(binding:Pick<MetadataBinding,'kind'|'actor'|'ticketId'|'referenceKind'|'context'|'workDate'>):string {
  return canonicalMetadata({kind:binding.kind,actor:binding.actor,ticketId:binding.ticketId,referenceKind:binding.referenceKind,context:binding.context??{},workDate:binding.workDate});
}
export const NATIVE_METADATA_REQUIREMENTS={
  'ticket-work':{Tickets:['id'],TicketNotes:['id','title','description','noteType','publish','creatorResourceID','impersonatorCreatorResourceID'],TimeEntries:['id','resourceID','roleID','billingCodeID','hoursWorked','dateWorked','summaryNotes','internalNotes']},
  technician:{Tickets:['id','title','description','assignedResourceID','assignedResourceRoleID','queueID','status','ticketCategory','priority','resolution'],Resources:['id','isActive']},
  scheduling:{ServiceCalls:['id','companyID','startDateTime','endDateTime','status','description','creatorResourceID','impersonatorCreatorResourceID'],ServiceCallTickets:['id','serviceCallID','ticketID'],ServiceCallTicketResources:['id','serviceCallTicketID','resourceID']},
  resources:{Resources:['id','isActive']},
  'time-eligibility':{Tickets:['id'],Resources:['id','isActive'],TimeEntries:['resourceID','roleID','billingCodeID','hoursWorked','dateWorked','summaryNotes','internalNotes']},
} as const;
export function minimumBindingRequirements(binding:Pick<MetadataBinding,'kind'|'referenceKind'>):{entity:string;fields:string[]}[] {
  if(binding.kind==='catalog') {
    const field={queue:'queueID',status:'status',category:'ticketCategory',priority:'priority'};
    return binding.referenceKind==='company'?[{entity:'Companies',fields:['id','companyName']}]:binding.referenceKind==='resource'?[{entity:'Resources',fields:['id','isActive']}]:[{entity:'Tickets',fields:[field[binding.referenceKind as keyof typeof field]]}];
  }
  return Object.entries(NATIVE_METADATA_REQUIREMENTS[binding.kind]).map(([entity,fields])=>({entity,fields:[...fields]}));
}
export function validateMetadataBinding(binding:MetadataBinding,content:MetadataContent,at:number):void {
  const p=bindingPrincipal(binding),value=binding.value;
  if(content.source==='documentation'||binding.actor.tenantId!==content.tenantId||binding.actor.policyVersion!==content.policyVersion||!unique(binding.companyIds)
    ||Date.parse(binding.validUntil)<=at||Date.parse(binding.validUntil)>Date.parse(content.expiresAt))throw metadataError();
  if(binding.companyId!==undefined&&!binding.companyIds.includes(binding.companyId))throw metadataError();
  for(const requirement of [...binding.requires,...minimumBindingRequirements(binding)]) {
    const entity=content.entities.find(row=>row.entity===requirement.entity);
    if(!entity||!unique(requirement.fields)||requirement.fields.some(name=>!entity.fields.some(field=>field.name===name)))throw metadataError();
  }
  switch(binding.kind) {
    case 'ticket-work':
      if(!binding.ticketId||binding.referenceKind)throw metadataError();assertWorkMetadata(value,p,binding.ticketId,content.source,at);break;
    case 'technician':
      if(!binding.ticketId||binding.companyId===undefined||binding.referenceKind)throw metadataError();assertTechnicianMetadata(value,p,{id:binding.ticketId,companyID:binding.companyId},content.source,at);break;
    case 'catalog':
      if(!binding.referenceKind||binding.ticketId!==undefined)throw metadataError();assertReferenceCatalog(value,p,binding.referenceKind,content.source,at);break;
    case 'scheduling':
      if(!binding.ticketId||binding.companyId===undefined||binding.referenceKind)throw metadataError();reviewedMetadata(value,p,binding.ticketId,binding.companyId,content.source,at);break;
    case 'resources':
      if(binding.ticketId!==undefined||binding.referenceKind!==undefined)throw metadataError();
      if(canonicalMetadata(reviewedResources(value,p))!==canonicalMetadata(value))throw metadataError();break;
    case 'time-eligibility':
      if(!binding.ticketId||!binding.workDate||binding.referenceKind)throw metadataError();reviewedTimeEligibility(binding,content,at);break;
  }
  if(binding.kind!=='resources'&&value&&typeof value==='object') {
    const expires=(value as {validUntil?:string}).validUntil;
    if(typeof expires!=='string'||Date.parse(expires)>Date.parse(binding.validUntil))throw metadataError();
  }
  const matchOptions=(entityName:string,fieldName:string,options:{id:number;label:string;active:boolean}[])=>{
    const field=content.entities.find(e=>e.entity===entityName)?.fields.find(f=>f.name===fieldName);
    if(field?.picklist&&options.some(option=>!field.picklist!.some(item=>String(item.value)===String(option.id)&&item.label===option.label&&item.active===option.active)))throw metadataError();
  };
  if(binding.kind==='ticket-work') {const m=value as import('../../contracts/src/index.js').TicketWorkMetadata;matchOptions('TicketNotes','noteType',m.note.types);matchOptions('TimeEntries','roleID',m.time.roles);matchOptions('TimeEntries','billingCodeID',m.time.workTypes);}
  if(binding.kind==='technician') {const m=value as import('../../technician/src/contracts.js').TechnicianMetadata;for(const [kind,field] of Object.entries({queue:'queueID',status:'status',category:'ticketCategory',priority:'priority'}))matchOptions('Tickets',field,m.options[kind as 'queue'|'status'|'category'|'priority']);}
  if(binding.kind==='scheduling')matchOptions('ServiceCalls','status',(value as import('../../scheduling/src/contracts.js').SchedulingMetadata).statuses);
}
function validateContent(input:MetadataSnapshotInput,inventory:EntityInventory|undefined,now:number,requireFresh:boolean):void {
  const {content,qualifications}=input,captured=Date.parse(content.capturedAt),expires=Date.parse(content.expiresAt);
  if(!Number.isFinite(now)||captured>now||expires<=captured||expires-captured>31*86_400_000||(requireFresh&&expires<=now))throw metadataError();
  if(inventory&&content.inventoryDigest!==inventory.digest)throw metadataError();
  if(!unique(content.sources.map(s=>s.id))||!unique(content.entities.map(e=>e.entity))||!unique(content.bindings.map(b=>b.id))||!unique(content.bindings.map(bindingLookupKey))||!unique(qualifications.map(q=>q.operation))||!unique(content.resourceVerifications.map(r=>r.resourceId)))throw metadataError();
  const known=inventory?new Set(inventory.entities.map(e=>e.entity)):undefined;
  const sourceMap=new Map(content.sources.map(s=>[s.id,s]));
  for(const source of content.sources)if(!safeSourceReference(source.reference,source.kind)||Date.parse(source.capturedAt)>now||(content.source!=='fixture'&&source.kind==='fixture')
    ||(source.kind==='metadata-export'&&(Date.parse(source.capturedAt)>captured||expires-Date.parse(source.capturedAt)>31*86_400_000)))throw metadataError();
  const sources=(ids:string[])=>{if(!unique(ids)||ids.some(id=>!sourceMap.has(id)))throw metadataError();};
  for(const entity of content.entities) {
    if(known&&!known.has(entity.entity))throw metadataError();sources(entity.sourceIds);
    if(content.source==='Autotask'&&!entity.sourceIds.some(id=>sourceMap.get(id)?.kind==='metadata-export'))throw metadataError();
    if(!unique(entity.fields.map(field=>field.name.toLowerCase()))||!unique(entity.userDefinedFields.map(field=>field.name)))throw metadataError();
    for(const field of [...entity.fields,...entity.userDefinedFields])if(field.picklist) {
      if(!unique(field.picklist.map(option=>[option.value,option.parentValue??null])))throw metadataError();
      // Defaults can differ by parent; they cannot be ambiguous within one parent selection.
      const defaults=field.picklist.filter(option=>option.default);
      if(defaults.some(option=>!option.active)||!unique(defaults.map(option=>option.parentValue??null)))throw metadataError();
    }
    for(const field of entity.fields)if(field.picklistParentField&&!entity.fields.some(parent=>parent.name===field.picklistParentField))throw metadataError();
  }
  for(const binding of content.bindings) {
    sources(binding.sourceIds);if(content.source==='Autotask'&&!binding.sourceIds.some(id=>sourceMap.get(id)?.kind===(binding.kind==='time-eligibility'?'operational-capture':'metadata-export')))throw metadataError();
    const at=binding.kind==='time-eligibility'?Math.max(captured,Date.parse((binding.value as {checkedAt?:string})?.checkedAt??'')):captured;
    if(!Number.isFinite(at)||at>now)throw metadataError();validateMetadataBinding(binding,content,at);
  }
  for(const evidence of content.resourceVerifications) {
    sources(evidence.sourceIds);if(content.source==='documentation'||(content.source==='Autotask'&&!evidence.sourceIds.some(id=>sourceMap.get(id)?.kind==='operational-capture')))throw metadataError();
    validateResourceEvidence(evidence,content,now);
  }
  const digest=metadataContentDigest(content);
  for(const proof of qualifications) {
    sources(proof.sourceIds);
    if(proof.tenantId!==content.tenantId||proof.policyVersion!==content.policyVersion||proof.metadataDigest!==digest||!unique(proof.resourceIds)||!unique(proof.testIds)
      ||Date.parse(proof.qualifiedAt)>now||Date.parse(proof.qualifiedAt)>=Date.parse(proof.expiresAt)||Date.parse(proof.expiresAt)>expires)throw metadataError();
    if(proof.evidenceSource==='live'&&(content.source!=='Autotask'||!proof.sourceIds.some(id=>sourceMap.get(id)?.kind==='tenant-test')))throw metadataError();
  }
}
export function compileSnapshot(value:unknown,options:{inventory:EntityInventory;now?:number}):MetadataSnapshot {
  const parsed=snapshotInputSchema.safeParse(value);if(!parsed.success)throw metadataError();
  const input=parsed.data;validateContent(input,options.inventory,options.now??Date.now(),true);
  const metadataDigest=metadataContentDigest(input.content),version=`metadata-v1-${metadataDigest.slice(0,24)}`;
  return {...structuredClone(input),metadataDigest,version,digest:metadataHash({...input,metadataDigest,version})};
}
export function validateSnapshot(value:unknown,options:{inventory?:EntityInventory;now?:number;requireFresh?:boolean}={}):MetadataSnapshot {
  const parsed=snapshotSchema.safeParse(value);if(!parsed.success)throw metadataError();const {digest,...unsigned}=parsed.data;
  if(metadataHash(unsigned)!==digest||metadataContentDigest(unsigned.content)!==unsigned.metadataDigest||unsigned.version!==`metadata-v1-${unsigned.metadataDigest.slice(0,24)}`)throw metadataError();
  validateContent(parsed.data,options.inventory,options.now??Date.now(),options.requireFresh??true);return structuredClone(parsed.data);
}
export function compileQualifications<T extends MetadataOperation>(value:unknown,options:{operations:readonly T[];verifiedSources:Readonly<Record<string,string>>;now?:number}):CompiledQualification<T>[] {
  const now=options.now??Date.now(),snapshot=validateSnapshot(value,{now});
  if(!options.operations.length)return[];
  if(snapshot.content.source!=='Autotask'||!unique([...options.operations])||options.operations.some(op=>!METADATA_OPERATIONS.includes(op)))throw new AppError('impersonation_not_qualified','Live qualifications require explicitly requested operations and current tenant evidence.');
  return options.operations.map(operation=>{
    const proof=snapshot.qualifications.find(q=>q.operation===operation),mutation=operation.endsWith('.create')||operation.startsWith('Tickets.patch');
    if(!proof||proof.evidenceSource!=='live'||Date.parse(proof.expiresAt)<=now||!proof.headerAccepted||!proof.permissionEnforced||!proof.positiveScopeVerified||!proof.negativeScopeVerified||!proof.mappingRevocationVerified||(mutation&&!proof.nativeAttribution)
      ||proof.sourceIds.some(id=>options.verifiedSources[id]!==snapshot.content.sources.find(source=>source.id===id)?.sha256))throw new AppError('impersonation_not_qualified','The requested operation has incomplete, stale or unverified tenant evidence.');
    const evidenceReference=`metadata:${snapshot.metadataDigest}:${proof.sourceIds.join(',')}`;
    return{operation,evidenceSource:'live',tenantId:proof.tenantId,policyVersion:proof.policyVersion,resourceIds:[...proof.resourceIds],testIds:[...proof.testIds],headerAccepted:true,permissionEnforced:true,
      ...(proof.nativeAttribution!==undefined?{nativeAttribution:proof.nativeAttribution}:{}),qualifiedAt:proof.qualifiedAt,expiresAt:proof.expiresAt,evidenceReference};
  });
}
export function coverageReport(value:unknown,inventory:EntityInventory,now=Date.now()) {
  const snapshot=validateSnapshot(value,{inventory,now,requireFresh:false}),current=Date.parse(snapshot.content.expiresAt)>now;
  return{inventoryEntities:inventory.entities.length,capturedEntities:snapshot.content.entities.length,completeEntities:snapshot.content.entities.filter(e=>e.complete).length,
    source:snapshot.content.source,current,metadataVersion:snapshot.version,liveEnablement:false,
    entities:inventory.entities.map(row=>{const captured=snapshot.content.entities.find(e=>e.entity===row.entity);return{entity:row.entity,status:captured?(captured.complete?'captured-complete':'captured-partial'):'not-captured',fields:captured?.fields.length??0,userDefinedFields:captured?.userDefinedFields.length??0,documentaryOnly:true};}),
    operationEvidence:snapshot.qualifications.map(q=>({operation:q.operation,source:q.evidenceSource,current:Date.parse(q.expiresAt)>now,requestedEnablement:false}))};
}
export function diffSnapshots(before:unknown,after:unknown,now=Date.now()) {
  const old=validateSnapshot(before,{now,requireFresh:false}),next=validateSnapshot(after,{now,requireFresh:false});
  if(old.content.tenantId!==next.content.tenantId)throw new AppError('invalid_input','Metadata comparison requires the same tenant.');
  const added=next.content.entities.filter(e=>!old.content.entities.some(row=>row.entity===e.entity)).map(e=>e.entity),removed=old.content.entities.filter(e=>!next.content.entities.some(row=>row.entity===e.entity)).map(e=>e.entity);
  const fields:{entity:string;field:string;change:string}[]=[];
  for(const entity of next.content.entities) {const prior=old.content.entities.find(e=>e.entity===entity.entity);if(!prior)continue;
    for(const field of entity.fields) {const previous=prior.fields.find(f=>f.name===field.name);if(!previous)fields.push({entity:entity.entity,field:field.name,change:'added'});else if(metadataHash(field)!==metadataHash(previous))fields.push({entity:entity.entity,field:field.name,change:'definition-changed'});}
    for(const field of prior.fields)if(!entity.fields.some(f=>f.name===field.name))fields.push({entity:entity.entity,field:field.name,change:'removed'});
  }
  return{beforeVersion:old.version,afterVersion:next.version,changed:old.digest!==next.digest,metadataChanged:old.metadataDigest!==next.metadataDigest,addedEntities:added,removedEntities:removed,fields,
    bindingChanges:next.content.bindings.filter(b=>metadataHash(b)!==metadataHash(old.content.bindings.find(old=>old.id===b.id)??null)).length,
    removedBindings:old.content.bindings.filter(b=>!next.content.bindings.some(next=>next.id===b.id)).length,
    userDefinedFieldChanges:next.content.entities.filter(e=>metadataHash(e.userDefinedFields)!==metadataHash(old.content.entities.find(old=>old.entity===e.entity)?.userDefinedFields??[])).length,
    qualificationChanged:metadataHash(old.qualifications)!==metadataHash(next.qualifications),requiresNewQualification:old.metadataDigest!==next.metadataDigest};
}

export { MetadataSnapshotProvider } from './provider.js';
export type { MetadataProviderOptions } from './provider.js';
export { RefreshingMetadataSnapshotProvider } from './refreshing-provider.js';
export type { RefreshingMetadataProviderOptions } from './refreshing-provider.js';
export { verifyLocalSources, loadMetadataSnapshot } from './files.js';

/** Renewal is limited to identical partial read-only field definitions. It never
 * carries bindings or native qualifications into a different metadata capture. */
export function readOnlyDefinitionDigest(snapshot:MetadataSnapshot):string {
 if(snapshot.content.source!=='Autotask'||snapshot.qualifications.length||snapshot.content.bindings.length)throw metadataError();
 const {sources:_sources,capturedAt:_captured,expiresAt:_expires,resourceVerifications:_resources,...definition}=snapshot.content;
 return metadataHash({...definition,entities:definition.entities.map(({sourceIds:_ids,...entity})=>entity)});
}
