import { createHash } from 'node:crypto';
import type { Principal } from '../../contracts/src/index.js';
import { fixturePrincipals, fixtureWorkMetadata } from '../../workflows/src/fixtures.js';
import { fixtureTechnicianMetadata } from '../../technician/src/fixtures.js';
import { actorBinding, scopeOptions, type ReferenceContext, type ReferenceKind } from '../../technician/src/index.js';
import { compileSnapshot, minimumBindingRequirements } from './index.js';
import type { EntityInventory, EntityMetadata, MetadataBinding, MetadataField, MetadataSnapshotInput } from './contracts.js';

/** Explicit fictitious values exercise local contracts; nothing here is tenant approval or a native metadata export. */
export function fixtureMetadataInput(inventory:EntityInventory,now=Date.now(),principal:Principal=fixturePrincipals()[0]!):MetadataSnapshotInput {
  const capturedAt=new Date(now).toISOString(),expiresAt=new Date(now+86_400_000).toISOString(),actor=actorBinding(principal),companyId=principal.companyIds[0]!;
  const ticket={id:1001,companyID:companyId},tech=fixtureTechnicianMetadata(principal,ticket),work=fixtureWorkMetadata(principal,ticket.id);
  tech.validUntil=expiresAt;work.validUntil=expiresAt;
  for(const [kind,options] of Object.entries(tech.options))tech.options[kind as keyof typeof tech.options]=options.map(option=>({...option,companyIds:option.companyIds.filter(id=>principal.companyIds.includes(id))})).filter(option=>option.companyIds.length);
  tech.assignments=tech.assignments.filter(assignment=>tech.options.resource.some(option=>option.id===assignment.resourceId));
  const bindings:MetadataBinding[]=[];
  const add=(id:string,kind:MetadataBinding['kind'],value:unknown,context:Partial<Pick<MetadataBinding,'ticketId'|'companyId'|'referenceKind'|'context'|'workDate'|'validUntil'>>={})=>{
    const binding={id,kind,actor,companyIds:[...principal.companyIds],validUntil:expiresAt,sourceIds:['fixture-metadata'],requires:[],value,...context};
    bindings.push({...binding,requires:minimumBindingRequirements(binding)});
  };
  add('ticket-work-1001','ticket-work',work,{ticketId:1001,companyId});
  add('technician-1001','technician',tech,{ticketId:1001,companyId});
  for(const kind of ['company','resource','queue','status','category','priority'] as ReferenceKind[]) {
    const items=kind==='company'?[{id:companyId,label:'Example Engineering',active:true,companyIds:[companyId]}]:tech.options[kind];
    const contexts:ReferenceContext[]=[{},{companyId},{ticketId:1001,companyId}];
    contexts.forEach((context,index)=>add(`catalog-${kind}-${index}`,'catalog',{...actor,source:'fixture',version:'fixture-metadata-v1',validUntil:expiresAt,kind,complete:true,items:scopeOptions(items,principal,context)},{referenceKind:kind,context}));
  }
  add('scheduling-1001','scheduling',{version:'fixture-scheduling-v1',source:'fixture',ticketId:1001,companyId,tenantId:principal.tenantId,resourceId:principal.resourceId,mappingVersion:principal.mappingVersion,policyVersion:principal.policyVersion,validUntil:expiresAt,ticketResourceIds:[principal.resourceId],statuses:[{id:801,label:'Scheduled',active:true,bookable:true}],defaultStatusId:801,allowOverlap:false,attributionField:'creatorResourceID'},{ticketId:1001,companyId});
  add('resources','resources',tech.options.resource.map(row=>({id:row.id,label:row.label,active:row.active,companyIds:row.companyIds})));
  const workDate=capturedAt.slice(0,10),operationalExpiresAt=new Date(now+300_000).toISOString();
  add('time-eligibility-1001','time-eligibility',{workDate,checkedAt:capturedAt,validUntil:operationalExpiresAt,timezone:'America/Chicago',
    period:{id:1,startsOn:workDate,endsOn:workDate,status:'open'},resourceActive:true,ticketAllowsTime:true,contractAllowsTime:true,dateContainerVerified:true,
    assignments:work.time.roles.flatMap(role=>work.time.workTypes.map(workType=>({roleId:role.id,workTypeId:workType.id,roleEffective:role.active,workTypeEffective:workType.active,remainingHours:8})))},
    {ticketId:1001,companyId,workDate,validUntil:operationalExpiresAt});
  const entityMap=new Map<string,Set<string>>();
  for(const binding of bindings)for(const requirement of binding.requires) {const fields=entityMap.get(requirement.entity)??new Set<string>();requirement.fields.forEach(field=>fields.add(field));entityMap.set(requirement.entity,fields);}
  const fieldsFor=(entity:string,fields:Set<string>):MetadataField[]=>[...fields].sort().map(name=>({name,
    dataType:name==='id'?'long':name==='hoursWorked'?'double':name==='isActive'?'boolean':/DateTime$|^dateWorked$/.test(name)?'datetime':['title','description','resolution','summaryNotes','internalNotes','companyName'].includes(name)?'string':'integer',
    required:['description','noteType','publish','resourceID','roleID','billingCodeID','hoursWorked','dateWorked','summaryNotes'].includes(name),
    readOnly:['id','creatorResourceID','impersonatorCreatorResourceID'].includes(name),queryable:true,
    referenceEntity:name.endsWith('ResourceID')||name==='resourceID'?'Resources':null,
    ...(['description','summaryNotes','internalNotes','resolution'].includes(name)?{maxLength:32000}:name==='title'?{maxLength:entity==='Tickets'?255:250}:{}),
  }));
  const entities:EntityMetadata[]=[...entityMap.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([entity,fields])=>({entity,runtimeName:entity,complete:false,fields:fieldsFor(entity,fields),userDefinedFields:[],sourceIds:['fixture-metadata']}));
  const picklist=(entity:string,field:string,options:{id:number;label:string;active:boolean}[],defaultId?:number)=>{
    entities.find(e=>e.entity===entity)!.fields.find(f=>f.name===field)!.picklist=options.map(option=>({value:option.id,label:option.label,active:option.active,default:option.id===defaultId}));
  };
  picklist('TicketNotes','noteType',work.note.types,work.note.defaultTypeId);
  picklist('TicketNotes','publish',work.note.audiences.map(a=>({id:a.publish,label:a.label,active:a.active})));
  picklist('TimeEntries','roleID',work.time.roles,work.time.defaultRoleId);picklist('TimeEntries','billingCodeID',work.time.workTypes,work.time.defaultWorkTypeId);
  for(const [kind,field] of Object.entries({queue:'queueID',status:'status',category:'ticketCategory',priority:'priority'}))picklist('Tickets',field,tech.options[kind as 'queue'|'status'|'category'|'priority']);
  picklist('ServiceCalls','status',[{id:801,label:'Scheduled',active:true}],801);
  return{content:{schemaVersion:1,source:'fixture',tenantId:principal.tenantId,policyVersion:principal.policyVersion,capturedAt,expiresAt,inventoryDigest:inventory.digest,
    sources:[{id:'fixture-metadata',kind:'fixture',reference:'fixture:metadata-v1',sha256:createHash('sha256').update('explicit fictitious metadata fixture v1').digest('hex'),capturedAt}],entities,bindings,
    resourceVerifications:[{tenantId:principal.tenantId,resourceId:principal.resourceId,active:true,verifiedAt:capturedAt,expiresAt:operationalExpiresAt,sourceIds:['fixture-metadata']}]},qualifications:[]};
}
export function fixtureMetadataSnapshot(inventory:EntityInventory,now=Date.now(),principal?:Principal) {
  return compileSnapshot(fixtureMetadataInput(inventory,now,principal),{inventory,now});
}
