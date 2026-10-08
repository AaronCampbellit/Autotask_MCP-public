import {providerFetch} from '../../execution/src/index.js';
import {validateNativeField,validateUdfs,nativeProjection,type NativeFields} from '../../native-fields/src/index.js';
import type {PersonIdentity} from '../../contracts/src/person-identity.js';
import {assertArea,canReadFinance} from '../../policy/src/areas.js';
import {assertPersonIdentity} from '../../contracts/src/person-identity.js';
import {assertAlignment,numberRange,chooseDefault,preferredRole,classificationGuidance,classificationPolicyVersion} from '../../classification/src/index.js';
import {contactIsActive} from './contact-status.js';
import {ticketCreationFields,ticketCreationGuidance,type TicketCreateInput} from './ticket-create.js';
import { createHash } from 'node:crypto';
import { AppError, actorKey, positiveId, validCompanyId, type DataRecord, type Principal, type TicketWorkMetadata, type TicketTimeCreate } from '../../contracts/src/index.js';
import { assertCompanyScope, reauthorize } from '../../policy/src/index.js';
import { requestScheduler } from '../../autotask/src/index.js';
import type { RequestBudgetPort } from '../../autotask/src/budget.js';
import type { PrincipalStore } from '../../contracts/src/index.js';
import { contactReferenceSchema } from '../../technician/src/index.js';
import type { ContactReference, ReferenceKind, ReferenceContext, ReferenceCatalog, ResolvedContact, TechnicianMetadata, ReferenceOption } from '../../technician/src/contracts.js';
import type { SchedulingMetadata, SchedulingResource } from '../../scheduling/src/contracts.js';
type Row = Record<string, any>;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const missing = (message: string) => new AppError('missing_metadata', message);
const terminal = ['complete', 'complete (with csat)', 'canceled', 'duplicate'];
const entities = ['TicketCategoryFieldDefaults','Opportunities','Tickets','TicketNotes','TimeEntries','Resources','Roles','ResourceRoleQueues','ResourceServiceDeskRoles','BillingCodes','ServiceCalls','TicketSecondaryResources','TicketTagAssociations','Tags','TicketChecklistItems','ChecklistLibraries','ChecklistLibraryChecklistItems','Companies','Contacts','Contracts','ConfigurationItems','CompanyLocations','Projects','ContractServices','ContractServiceBundles'];
export interface OperationalMetadataOptions {
 tenantId: string; baseUrl: string; username: string; secret: string; integrationCode: string;
 principals: PrincipalStore; requestBudget: RequestBudgetPort; fetch?: typeof fetch; now?: () => number;
}
/** Application policy is explicit here; these are not claims of native employee permission qualification.
 * Native API validation remains authoritative for tenant-specific UI/contract/timesheet rules. */
export class OperationalMetadata {
 private cache = new Map<string,{at:number;value:any}>();
 constructor(private o: OperationalMetadataOptions) {
  if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(o.baseUrl)) throw missing('Invalid operational API URL.');
 }
 private now(){return this.o.now?.()??Date.now();}
 private async actor(p:Principal){const fresh=await reauthorize(p,this.o.principals,{resourceMaxAgeMs:240000,now:()=>new Date(this.now())});if(fresh.tenantId!==this.o.tenantId)throw new AppError('forbidden','Operational tenant mismatch.');return fresh;}
 private binding(p:Principal){return {tenantId:p.tenantId,objectId:p.objectId,resourceId:p.resourceId,mappingVersion:p.mappingVersion,policyVersion:p.policyVersion};}
 private async read(p:Principal,entity:string,kind:'fields'|'udfs'|'query'|'get',filters:Row[]=[],id?:number,fresh=false):Promise<any>{
  await this.actor(p);if(!entities.includes(entity)||kind==='get'&&!(positiveId(id)||entity==='Companies'&&id===0))throw missing('Unsupported metadata route.');
  const path=kind==='udfs'?`${entity}/entityInformation/userDefinedFields`:kind==='fields'?`${entity}/entityInformation/fields`:kind==='get'?`${entity}/${id}`:`${entity}/query`;
  const body=kind==='query'?{filter:filters,MaxRecords:500}:undefined;
  // Ticket state and associations are always read fresh. Directory and picklists are bounded to one minute.
  const cacheable=kind==='fields'||!['Tickets','Opportunities','TicketSecondaryResources','TicketTagAssociations','Tags','TicketChecklistItems','ChecklistLibraries','ChecklistLibraryChecklistItems','Contacts','Companies'].includes(entity);
  const key=digest({actor:this.binding(p),companies:p.companyIds,path,body});const cached=this.cache.get(key);
  if(!fresh&&cacheable&&cached&&this.now()-cached.at<60000)return structuredClone(cached.value);
  const release=await requestScheduler.acquire(actorKey(p),15000);
  try{await this.o.requestBudget.take({tenantId:p.tenantId,actorKey:actorKey(p)});await this.actor(p);
   const r=await providerFetch('Autotask',this.o.fetch??fetch)(new URL(path,this.o.baseUrl),{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000),headers:{UserName:this.o.username,Secret:this.o.secret,ApiIntegrationCode:this.o.integrationCode,'Content-Type':'application/json'}});
   if(!r.ok)throw missing(`Operational metadata unavailable (HTTP ${r.status}).`);
   const reader=r.body?.getReader();if(!reader)throw missing('Empty metadata response.');const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024)throw missing('Metadata response too large.');chunks.push(part.value);}}finally{await reader.cancel();}
   const result=JSON.parse(Buffer.concat(chunks).toString());
   const value=kind==='fields'||kind==='udfs'?result.fields:kind==='get'?result.item:result.items;
   if(kind==='get'? !value||value.id!==id : !Array.isArray(value))throw missing('Invalid metadata response.');
   if(kind==='query'&&(!result.pageDetails||result.pageDetails.nextPageUrl!==null||value.length>500))throw missing('Metadata directory is incomplete; no write is authorized from a partial directory.');
   await this.actor(p);if(cacheable)this.cache.set(key,{at:this.now(),value:structuredClone(value)});return value;
  }finally{release();}
 }
 private async ticket(p:Principal,id:number){const t=await this.read(p,'Tickets','get',[],id);assertCompanyScope(p,t.companyID);return t;}
 private async picks(p:Principal,entity:string,field:string){const fields=await this.read(p,entity,'fields');const f=fields.find((f:Row)=>f.name===field);if(!f?.isPickList||!Array.isArray(f.picklistValues))throw missing(`No current ${entity}.${field} picklist.`);
  const items=f.picklistValues.map((v:Row)=>({id:Number(v.value),label:v.label,active:v.isActive}));if(items.some((v:Row)=>!Number.isSafeInteger(v.id)||v.id<0||typeof v.label!=='string'||typeof v.active!=='boolean')||new Set(items.map((v:Row)=>v.id)).size!==items.length)throw missing('Invalid picklist.');return items as {id:number;label:string;active:boolean}[];
 }
 private async workTypes(p:Principal):Promise<{id:number;label:string;active:boolean}[]>{
  const kinds=(await this.picks(p,'BillingCodes','useType')).filter(v=>v.active&&['work type','worktype','general allocation code','tickets (labor)'].includes(v.label.toLowerCase()));
  if(kinds.length!==1)throw missing('Work Type billing-code classification unavailable.');
  return (await this.read(p,'BillingCodes','query',[{field:'isActive',op:'eq',value:true},{field:'useType',op:'eq',value:kinds[0]!.id}])).filter((r:Row)=>r.isActive===true&&r.useType===kinds[0]!.id).map((r:Row)=>({id:r.id,label:r.name,active:true}));
 }
 private async categoryDefaults(p:Principal,categoryId:number){
  const rows=await this.read(p,'TicketCategoryFieldDefaults','query',[{field:'ticketCategoryID',op:'eq',value:categoryId}]);
  if(rows.some((r:Row)=>r.ticketCategoryID!==categoryId)||rows.length>1)throw missing('Category defaults are ambiguous or belong to another category.');
  return rows[0]??{};
 }
 private typeChoices(fields:Row[],categoryId?:number){
  const field=fields.find(f=>f.name==='ticketType'),values=field?.picklistValues??[];
  const scoped=['ticketCategory','ticketCategoryID'].includes(field?.picklistParentValueField);
  return {category_restrictions:scoped?'category_scoped':'unavailable',choices:values.filter((v:Row)=>v.isActive===true&&(!scoped||categoryId!==undefined&&String(v.parentValue)===String(categoryId)))};
 }
 private async directory(p:Principal){const rows=await this.read(p,'Resources','query',[{field:'isActive',op:'eq',value:true}]);return rows.filter((r:Row)=>r.isActive===true&&r.resourceType==='Employee');}
 readonly resolveResources=async(p:Principal):Promise<SchedulingResource[]> => (await this.directory(p)).map((r:Row)=>({id:r.id,label:`${r.firstName??''} ${r.lastName??''}`.trim(),active:true,companyIds:[...p.companyIds]}));
 readonly resolveTicketSecondaryResourceOptions=async(p:Principal,ticketId:number,knownTicket?:Row)=>{
  const ticket=knownTicket??await this.ticket(p,ticketId);
  if(ticket.id!==ticketId||!validCompanyId(ticket.companyID))throw missing('Ticket secondary-resource parent is invalid.');
  assertCompanyScope(p,ticket.companyID);
  // This resolver also runs inside the adapter's guarded write lease. That lease
  // permits one nested request at a time, so concurrent reads are rejected as
  // throttled before the TicketSecondaryResources POST can be dispatched.
  const existing=await this.read(p,'TicketSecondaryResources','query',[{field:'ticketID',op:'eq',value:ticketId}],undefined,true);
  const resources=await this.read(p,'Resources','query',[{field:'isActive',op:'eq',value:true}],undefined,true);
  const roles=await this.read(p,'Roles','query',[{field:'isActive',op:'eq',value:true}],undefined,true);
  const resourceRoles=await this.read(p,'ResourceServiceDeskRoles','query',[{field:'isActive',op:'eq',value:true}],undefined,true);
  if(existing.some((r:Row)=>r.ticketID!==ticketId||!positiveId(r.resourceID)||!positiveId(r.roleID))||existing.length>50)throw missing('Ticket secondary-resource assignments are invalid or exceed the Autotask limit.');
  const employees=resources.filter((r:Row)=>r.isActive===true&&r.resourceType==='Employee'&&positiveId(r.id));
  const activeRoles=roles.filter((r:Row)=>r.isActive===true&&positiveId(r.id));
  const choices=[] as {resource_id:number;resource_name:string;role_id:number;role_name:string}[];
  for(const link of resourceRoles){
   const resource=employees.find((r:Row)=>r.id===link.resourceID),role=activeRoles.find((r:Row)=>r.id===link.roleID);
   if(!resource||!role||link.isActive!==true)continue;
   const resourceName=`${resource.firstName??''} ${resource.lastName??''}`.trim(),roleName=String(role.name??'').trim();
   if(!resourceName||!roleName)continue;
   if(!choices.some(v=>v.resource_id===resource.id&&v.role_id===role.id))choices.push({resource_id:resource.id,resource_name:resourceName,role_id:role.id,role_name:roleName});
  }
  choices.sort((a,b)=>a.resource_name.localeCompare(b.resource_name)||a.role_name.localeCompare(b.role_name)||a.resource_id-b.resource_id||a.role_id-b.role_id);
 return {ticket_id:ticketId,company_id:ticket.companyID,primary_resource_id:positiveId(ticket.assignedResourceID)?ticket.assignedResourceID:null,primary_role_id:positiveId(ticket.assignedResourceRoleID)?ticket.assignedResourceRoleID:null,secondary_resources:existing.map((r:Row)=>({id:r.id,resource_id:r.resourceID,role_id:r.roleID})),eligible_resource_roles:choices,limit:50,remaining:50-existing.length,valid_until:new Date(this.now()+30000).toISOString()};
 };
 readonly resolveTicketTagOptions=async(p:Principal,ticketId:number,query:string,knownTicket?:Row)=>{
  const ticket=knownTicket??await this.ticket(p,ticketId);
  if(ticket.id!==ticketId||!validCompanyId(ticket.companyID))throw missing('Ticket tag parent is invalid.');
  assertCompanyScope(p,ticket.companyID);
  const associations=await this.read(p,'TicketTagAssociations','query',[{field:'ticketID',op:'eq',value:ticketId}],undefined,true);
  if(associations.some((r:Row)=>r.ticketID!==ticketId||!positiveId(r.id)||!positiveId(r.tagID))||associations.length>30)throw missing('Ticket tag associations are invalid or exceed the Autotask limit.');
  const activeTags=await this.read(p,'Tags','query',[{field:'isActive',op:'eq',value:true},{field:'label',op:'contains',value:query}],undefined,true);
  const active=activeTags.filter((r:Row)=>r.isActive===true&&positiveId(r.id)&&typeof r.label==='string'&&r.label.trim().length>0);
  if(active.length!==activeTags.length||new Set(active.map((r:Row)=>r.id)).size!==active.length)throw missing('Active ticket tag choices are invalid.');
  const ids=[...new Set(associations.map((r:Row)=>r.tagID as number))];
  const current=ids.length?await this.read(p,'Tags','query',[{field:'id',op:'in',value:ids}],undefined,true):[];
  if(current.some((r:Row)=>!ids.includes(r.id)||typeof r.label!=='string'))throw missing('Current ticket tags could not be resolved.');
  const labels=new Map(current.map((r:Row)=>[r.id,r.label]));
  return {ticket_id:ticketId,company_id:ticket.companyID,current_tags:associations.map((r:Row)=>({association_id:r.id,tag_id:r.tagID,label:labels.get(r.tagID)??`Tag ${r.tagID}`})),eligible_tags:active.map((r:Row)=>({id:r.id,label:r.label,group_id:positiveId(r.tagGroupID)?r.tagGroupID:null})).sort((a:Row,b:Row)=>a.label.localeCompare(b.label)||a.id-b.id),limit:30,remaining:30-associations.length,valid_until:new Date(this.now()+30000).toISOString()};
 };
 readonly resolveTicketChecklistLibraryOptions=async(p:Principal,ticketId:number,query:string,knownTicket?:Row)=>{
  const ticket=knownTicket??await this.ticket(p,ticketId);
  if(ticket.id!==ticketId||!validCompanyId(ticket.companyID))throw missing('Ticket checklist parent is invalid.');
  assertCompanyScope(p,ticket.companyID);
  const libraryFields=await this.read(p,'ChecklistLibraries','fields',[],undefined,true),entityType=libraryFields.find((field:Row)=>field.name==='entityType');
  if(!entityType?.isPickList||!Array.isArray(entityType.picklistValues))throw missing('Checklist library entity type metadata is unavailable.');
  const ticketTypes=entityType.picklistValues.filter((value:Row)=>value.isActive===true&&typeof value.label==='string'&&['ticket','tickets'].includes(value.label.trim().toLowerCase()));
  if(ticketTypes.length!==1||!Number.isSafeInteger(Number(ticketTypes[0].value)))throw missing('Ticket checklist library type is ambiguous.');
  const ticketType=Number(ticketTypes[0].value);
  const libraries=await this.read(p,'ChecklistLibraries','query',[{field:'isActive',op:'eq',value:true},{field:'entityType',op:'eq',value:ticketType},{field:'name',op:'contains',value:query}],undefined,true);
  const eligible=libraries.filter((row:Row)=>row.isActive===true&&row.entityType===ticketType&&positiveId(row.id)&&typeof row.name==='string'&&row.name.trim().length>0);
  if(eligible.length!==libraries.length||new Set(eligible.map((row:Row)=>row.id)).size!==eligible.length)throw missing('Ticket checklist library options are invalid.');
  const libraryOptions=[] as {id:number;name:string;description:string|null;item_count:number;fingerprint:string}[];
  const eligibleIds=eligible.map((library:Row)=>library.id),allLibraryItems=eligibleIds.length?await this.read(p,'ChecklistLibraryChecklistItems','query',[{field:'checklistLibraryID',op:'in',value:eligibleIds}],undefined,true):[];
  if(allLibraryItems.some((item:Row)=>!eligibleIds.includes(item.checklistLibraryID)||!positiveId(item.id)||typeof item.itemName!=='string'||item.isImportant!==undefined&&typeof item.isImportant!=='boolean'))throw missing('Checklist library items are invalid or incomplete.');
  const itemsByLibrary=new Map<number,Row[]>();for(const item of allLibraryItems){const rows=itemsByLibrary.get(item.checklistLibraryID)??[];rows.push(item);itemsByLibrary.set(item.checklistLibraryID,rows);}
  for(const library of eligible){
   const items=itemsByLibrary.get(library.id)??[];if(items.length>100)throw missing('Checklist library exceeds its 100-item limit.');
   const ordered=[...items].sort((a:Row,b:Row)=>(Number(a.position)||0)-(Number(b.position)||0)||a.id-b.id);
   libraryOptions.push({id:library.id,name:library.name,description:typeof library.description==='string'?library.description:null,item_count:ordered.length,fingerprint:digest({library:{id:library.id,name:library.name,isActive:library.isActive,entityType:library.entityType},items:ordered.map((item:Row)=>({id:item.id,itemName:item.itemName,isImportant:item.isImportant===true,position:item.position??null,knowledgebaseArticleID:item.knowledgebaseArticleID??null}))})});
  }
  const ticketItems=await this.read(p,'TicketChecklistItems','query',[{field:'ticketID',op:'eq',value:ticketId}],undefined,true);
  if(ticketItems.some((item:Row)=>item.ticketID!==ticketId||!positiveId(item.id)||typeof item.itemName!=='string')||ticketItems.length>40)throw missing('Current ticket checklist is invalid or exceeds the 40-item limit.');
  libraryOptions.sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
  return {ticket_id:ticketId,company_id:ticket.companyID,current_item_count:ticketItems.length,limit:40,remaining:40-ticketItems.length,libraries:libraryOptions,valid_until:new Date(this.now()+30000).toISOString()};
 };
 readonly resolveCatalog=async(p:Principal,kind:ReferenceKind,context:ReferenceContext={}):Promise<ReferenceCatalog>=>{
  if(context.ticketId)await this.ticket(p,context.ticketId);if(context.companyId!==undefined)assertCompanyScope(p,context.companyId);
  let items:ReferenceOption[];
  if(kind==='resource')items=await this.resolveResources(p);
  else if(kind==='company'){const rows=await this.read(p,'Companies','query',[{field:'id',op:'in',value:p.companyIds}]);items=rows.filter((r:Row)=>p.companyIds.includes(r.id)).map((r:Row)=>({id:r.id,label:r.companyName,active:r.isActive,companyIds:[r.id]}));}
  else{const field={queue:'queueID',status:'status',category:'ticketCategory',priority:'priority'}[kind];items=(await this.picks(p,'Tickets',field)).filter(v=>v.id>0).map(v=>({...v,companyIds:[...p.companyIds],...(kind==='status'?{completed:terminal.includes(v.label.toLowerCase())}:{})}));}
  return {...this.binding(p),kind,source:'Autotask',version:digest(items),validUntil:new Date(this.now()+60000).toISOString(),complete:true,items};
 };
 readonly resolveTechnicianMetadata=async(p:Principal,ticketId:number):Promise<TechnicianMetadata>=>{
  const t=await this.ticket(p,ticketId);const options={} as TechnicianMetadata['options'];
  for(const kind of ['resource','queue','status','category','priority'] as const)options[kind]=(await this.resolveCatalog(p,kind)).items;
  // Queue membership and service-desk roles are separate modern REST entities.
  const queues=await this.read(p,'ResourceRoleQueues','query',[{field:'id',op:'gte',value:0}]);
  const roleRows=await this.read(p,'ResourceServiceDeskRoles','query',[{field:'isActive',op:'eq',value:true}]);
  const roles=await this.read(p,'Roles','query',[{field:'isActive',op:'eq',value:true}]);
  const categories=options.category.map(v=>v.id);
  const assignments:TechnicianMetadata['assignments']=[];
  for(const q of queues){
   if(!options.resource.some(v=>v.id===q.resourceID)||!options.queue.some(v=>v.id===q.queueID))continue;
   const eligible=roleRows.filter((r:Row)=>r.resourceID===q.resourceID&&r.isActive===true&&roles.some((v:Row)=>v.id===r.roleID&&v.isActive===true));
   for(const role of eligible)if(!assignments.some(a=>a.resourceId===q.resourceID&&a.queueId===q.queueID&&a.roleId===role.roleID))assignments.push({resourceId:q.resourceID,roleId:role.roleID,roleLabel:roles.find((r:Row)=>r.id===role.roleID)!.name,isDefault:role.isDefault===true,queueId:q.queueID,categoryIds:categories});
  }
  // Conservative application rules, not inferred tenant UI requirements: retain a queue,
  // require title/resolution and complete Important checklist items for completion.
  const categoryRules:TechnicianMetadata['categoryRules']=categories.map(categoryId=>({categoryId,queueRequired:'always',completionRequiredFields:['title','resolution'],requiredCollections:[],requireImportantChecklistComplete:true}));
  const statusTransitions=categories.flatMap(categoryId=>options.status.filter(s=>s.active).map(s=>({fromId:t.status,toId:s.id,categoryId})));
  const content={options,assignments,categoryRules,statusTransitions};
  return {...this.binding(p),source:'Autotask',ticketId,companyId:t.companyID,version:digest(content),validUntil:new Date(this.now()+60000).toISOString(),...content};
 };
 private ticketFieldAllowed(p:Principal,name:string){return !/cost|price|revenue|rate|amount|purchaseOrder|contractID|userDefinedFields/i.test(name)||canReadFinance(p);}
 readonly ticketFieldOptions=async(p:Principal,ticketId:number,includeUdfs=false)=>{
  const ticket=await this.ticket(p,ticketId),fields=await this.read(p,'Tickets','fields',[],undefined,true);
  const visible=fields.filter((f:Row)=>this.ticketFieldAllowed(p,f.name));
  const udfs=includeUdfs&&canReadFinance(p)?await this.read(p,'Tickets','udfs',[],undefined,true):undefined;
  return {...(udfs?{user_defined_fields:udfs}:{}),fields:visible.map((f:Row)=>({...f,allowed_for_write:f.name!=='id'&&f.isReadOnly===false})),current_values:({...nativeProjection(ticket,visible),...(udfs&&Array.isArray(ticket.userDefinedFields)?{userDefinedFields:ticket.userDefinedFields}:{})} as NativeFields),work_types:await this.workTypes(p)};
 };
 readonly resolveWorkType=async(p:Principal,ticketId:number,value:number|string|null)=>{
  await this.ticket(p,ticketId);const fields=await this.read(p,'Tickets','fields',[],undefined,true),field=fields.find((f:Row)=>f.name==='billingCodeID');
  if(!field||field.isReadOnly!==false)throw missing('Writable ticket work type metadata unavailable.');
  if(value===null){if(field.isRequired)throw new AppError('invalid_input','A work type is required.');return null;}
  const choices=(await this.workTypes(p)).filter(v=>v.active&&(typeof value==='number'?v.id===value:v.label.trim().toLowerCase()===value.trim().toLowerCase()));
  if(choices.length!==1)throw new AppError('invalid_input','Choose one active work type by exact name or ID.');return choices[0]!.id;
 };
 readonly resolveTicketFields=async(p:Principal,ticketId:number,input:NativeFields,identities:Record<string,PersonIdentity>={})=>{
  const ticket=await this.ticket(p,ticketId),fields=await this.read(p,'Tickets','fields',[],undefined,true),out:NativeFields={};
  for(const [name,value]of Object.entries(input)){
   if(!this.ticketFieldAllowed(p,name))throw new AppError('forbidden',`Finance permission is required for ${name}.`);
   if(/cost|price|revenue|rate|amount|purchaseOrder|contractID|userDefinedFields/i.test(name)){assertArea(p,'finance',true);if(p.areaPermissions===undefined&&!p.capabilities.includes('finance.write'))throw new AppError('forbidden','Finance write permission is required.');}
   if(name==='userDefinedFields'){out[name]=validateUdfs(value,await this.read(p,'Tickets','udfs',[],undefined,true));continue;}
   out[name]=validateNativeField(fields.find((f:Row)=>f.name===name),value,{...ticket,...input});
  }
  const company=out.companyID??ticket.companyID;assertCompanyScope(p,company);
  for(const [field,entity]of Object.entries({contactID:'Contacts',createdByContactID:'Contacts',configurationItemID:'ConfigurationItems',contractID:'Contracts',companyLocationID:'CompanyLocations',companylocationID:'CompanyLocations',opportunityID:'Opportunities',projectID:'Projects',problemTicketId:'Tickets'})){
   const value=out[field]??(out.companyID!==undefined?ticket[field]:undefined);if(value==null)continue;
   if(!positiveId(value))throw new AppError('invalid_input',`Invalid ${field}.`);
   const related=await this.read(p,entity,'get',[],value as number);assertCompanyScope(p,related.companyID);
   if(related.companyID!==company&&field!=='contactID')throw new AppError('invalid_input',`${field} belongs to another company.`);
  }
  for(const [field,entity]of Object.entries({contractServiceID:'ContractServices',contractServiceBundleID:'ContractServiceBundles'})){if(out[field]==null)continue;const related=await this.read(p,entity,'get',[],out[field] as number),contract=await this.read(p,'Contracts','get',[],related.contractID);assertCompanyScope(p,contract.companyID);if(contract.companyID!==company||related.contractID!==(out.contractID??ticket.contractID))throw new AppError('invalid_input',`${field} belongs to another contract.`);}
  for(const [field,value]of Object.entries(out))if(value!=null&&/(?:ResourceID|ContactID|PersonID)$/.test(field)){
   const entity=/ContactID$/.test(field)||field==='contactID'?'Contacts':'Resources',person=await this.read(p,entity,'get',[],value as number);
   if(!contactIsActive(person))throw new AppError('invalid_input','The intended person must be active.');
   assertPersonIdentity(identities[field],{name:`${person.firstName??''} ${person.lastName??''}`.trim(),email:person.emailAddress},field);
  }
  return out;
 };
 readonly resolveIssuePair=async(p:Principal,ticketId:number,issue:number|string|undefined,sub:number|string|null|undefined)=>{
  const ticket=await this.ticket(p,ticketId),fields=await this.read(p,'Tickets','fields',[],undefined,true);
  const choose=(field:string,value:unknown,parent?:number)=>{
   const meta=fields.find((f:Row)=>f.name===field);if(!meta||meta.isReadOnly!==false||!Array.isArray(meta.picklistValues))throw missing(`Writable ${field} metadata unavailable.`);
   const matches=meta.picklistValues.filter((v:Row)=>v.isActive===true&&(parent===undefined||String(v.parentValue)===String(parent))&&(typeof value==='number'?Number(v.value)===value:typeof value==='string'&&v.label.trim().toLowerCase()===value.trim().toLowerCase()));
   if(matches.length!==1||!Number.isSafeInteger(Number(matches[0].value))||Number(matches[0].value)<=0)throw new AppError('invalid_input',`Choose one active ${field} compatible with the issue type.`);return Number(matches[0].value);
  };
  const issueType=choose('issueType',issue??ticket.issueType),value=sub===undefined?ticket.subIssueType:sub;
  const subMeta=fields.find((f:Row)=>f.name==='subIssueType');if(subMeta?.isReadOnly!==false)throw missing('Writable subIssueType metadata unavailable.');
  const subIssueType=value===null||value===undefined?null:choose('subIssueType',value,issueType);
  if(subIssueType===null&&subMeta.isRequired)throw new AppError('invalid_input','A sub-issue type is required.');
  return {issueType,subIssueType};
 };
 readonly validateClassification=async(p:Principal,ticketId:number,selection:{categoryId:number;queueId:number|null;workTypeId?:number|null},override?:string)=>{
  const ticket=await this.ticket(p,ticketId);
  const category=(await this.picks(p,'Tickets','ticketCategory')).find(v=>v.id===selection.categoryId)?.label;
  const queue=(await this.picks(p,'Tickets','queueID')).find(v=>v.id===selection.queueId)?.label;
  const workTypeId=selection.workTypeId===undefined?ticket.billingCodeID:selection.workTypeId;
  const workType=workTypeId===null||workTypeId===undefined?undefined:(await this.workTypes(p)).find(v=>v.id===workTypeId)?.label;
  assertAlignment({category,queue,work_type:workType},override);
 };
 readonly resolveTicketWork=async(p:Principal,ticketId:number,ticket?:Readonly<DataRecord>):Promise<TicketWorkMetadata>=>{
  await this.actor(p);
  const t=ticket??await this.ticket(p,ticketId);if(t.id!==ticketId)throw missing('Ticket metadata parent mismatch.');assertCompanyScope(p,t.companyID);const types=(await this.picks(p,'TicketNotes','noteType')).filter(v=>v.id>0);const publish=await this.picks(p,'TicketNotes','publish');
  const audiences:TicketWorkMetadata['note']['audiences']=[];
  for(const [audience,labels] of [['internal',['internal only','internal','internal project team']],['customer',['all','all users']]] as const){const choices=publish.filter(v=>v.active&&labels.includes(v.label.toLowerCase() as never));if(choices.length>1)throw missing(`Ambiguous ${audience} note visibility.`);if(!choices.length)continue;audiences.push({audience,publish:choices[0]!.id,label:choices[0]!.label,active:true});}
  const roles=await this.read(p,'Roles','query',[{field:'isActive',op:'eq',value:true}]);const rr=await this.read(p,'ResourceServiceDeskRoles','query',[{field:'resourceID',op:'eq',value:p.resourceId}]);
  const eligibleRoles=roles.filter((r:Row)=>r.isActive===true&&rr.some((v:Row)=>v.resourceID===p.resourceId&&v.roleID===r.id&&v.isActive===true)).map((r:Row)=>({id:r.id,label:r.name,active:true}));
  const workTypes=await this.workTypes(p);
  const defaultRoles=rr.filter((r:Row)=>r.isDefault===true&&r.isActive===true&&eligibleRoles.some((v:Row)=>v.id===r.roleID));
  const ordinary=types.filter(v=>v.active&&v.label.toLowerCase()==='task notes');const general=ordinary.length?ordinary:types.filter(v=>v.active&&v.label.toLowerCase()==='general');
  const category=(await this.picks(p,'Tickets','ticketCategory')).find(v=>v.id===t.ticketCategory)?.label,queue=(await this.picks(p,'Tickets','queueID')).find(v=>v.id===t.queueID)?.label;
  const preferred=preferredRole(eligibleRoles.map((v:Row)=>({...v,isDefault:defaultRoles.some((r:Row)=>r.roleID===v.id)})),numberRange(category)??numberRange(queue));
  const content={note:{titleRequired:true,attributionField:'impersonatorCreatorResourceID' as const,types,audiences,...(general.length===1?{defaultTypeId:general[0]!.id}:{})},time:{classification:{category,queue},eligible:eligibleRoles.length>0&&workTypes.length>0,roles:eligibleRoles,workTypes,...(preferred?{defaultRoleId:preferred.id}:{}),...(workTypes.some((v:Row)=>v.id===t.billingCodeID)?{defaultWorkTypeId:t.billingCodeID}:{})}};
  return {source:'Autotask',ticketId,resourceId:p.resourceId,mappingVersion:p.mappingVersion,policyVersion:p.policyVersion,version:digest(content),validUntil:new Date(this.now()+60000).toISOString(),defaultRuleVersion:classificationPolicyVersion,...content};
 };
 readonly validateTicketTimeEligibility=async(p:Principal,ticketId:number,payload:Readonly<TicketTimeCreate>,metadata?:Readonly<TicketWorkMetadata>):Promise<boolean>=>{
  await this.actor(p);
  const m=metadata??await this.resolveTicketWork(p,ticketId);
  if(m.ticketId!==ticketId||m.resourceId!==p.resourceId||m.mappingVersion!==p.mappingVersion||m.policyVersion!==p.policyVersion||Date.parse(m.validUntil)<=this.now())return false;
  // Local-date container is not a start time. Native API still checks submitted periods and contract rules.
  return payload.resourceID===p.resourceId&&/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(payload.dateWorked)&&Number.isFinite(Date.parse(payload.dateWorked))&&payload.hoursWorked>0&&payload.hoursWorked<=24&&m.time.roles.some(r=>r.active&&r.id===payload.roleID)&&m.time.workTypes.some(r=>r.active&&r.id===payload.billingCodeID);
 };
 readonly resolveSchedulingMetadata=async(p:Principal,ticketId:number):Promise<SchedulingMetadata>=>{
  const t=await this.ticket(p,ticketId);const secondary=await this.read(p,'TicketSecondaryResources','query',[{field:'ticketID',op:'eq',value:ticketId}]);if(secondary.some((r:Row)=>r.ticketID!==ticketId))throw missing('Secondary resource parent mismatch.');
  const statuses=(await this.picks(p,'ServiceCalls','status')).filter(s=>s.id>0).map(s=>({...s,bookable:s.active&&!['canceled','cancelled','complete','completed'].includes(s.label.toLowerCase())}));
  const scheduled=statuses.filter(s=>s.bookable&&s.label.toLowerCase()==='scheduled');const defaults=scheduled.length?scheduled:statuses.filter(s=>s.bookable&&s.label.toLowerCase()==='new');const resources=await this.resolveResources(p);
  const content={ticketResourceIds:[...new Set([t.assignedResourceID,...secondary.map((r:Row)=>r.resourceID)].filter(id=>positiveId(id)&&resources.some(r=>r.id===id)))],statuses,...(defaults.length===1?{defaultStatusId:defaults[0]!.id}:{}),allowOverlap:true,attributionField:'impersonatorCreatorResourceID' as const};
  const {objectId:_object,...binding}=this.binding(p);
  return {...binding,source:'Autotask',ticketId,companyId:t.companyID,version:digest(content),validUntil:new Date(this.now()+60000).toISOString(),...content};
 };
  readonly assertOpportunity=async(p:Principal,companyId:number,opportunityId:number)=>{assertCompanyScope(p,companyId);const row=await this.read(p,'Opportunities','get',[],opportunityId);if(row.companyID!==companyId)throw new AppError('invalid_input','The ticket and opportunity must belong to the same company.');};
  private async contactCompanyIds(p:Principal,companyId:number):Promise<number[]> {
    assertCompanyScope(p,companyId);
    const company=await this.read(p,'Companies','get',[],companyId);
    const parent=company.parentCompanyID;
    // The native API permits a parent-company contact, but application scope
    // still requires that parent company to be explicitly authorized.
    return positiveId(parent)&&parent!==companyId&&p.companyIds.includes(parent)?[companyId,parent]:[companyId];
  }
  /** Resolve an active contact for a ticket company. Autotask permits the ticket
   * company or its parent company; the parent relationship is read fresh. */
  readonly searchContacts=async(p:Principal,companyId:number,textValue?:string):Promise<DataRecord[]>=>{
    const companyIds=await this.contactCompanyIds(p,companyId);
    const rows=await this.read(p,'Contacts','query',[{field:'companyID',op:'in',value:companyIds}]);
    const needle=textValue?.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
    return rows.filter((row:Row)=>companyIds.includes(row.companyID)&&(!needle||`${row.firstName??''} ${row.lastName??''}`.trim().toLocaleLowerCase('en-US').includes(needle)||String(row.emailAddress??'').toLocaleLowerCase('en-US').includes(needle)));
  };
  readonly resolveContact=async(p:Principal,companyId:number,reference:ContactReference):Promise<ResolvedContact>=>{
    const parsed=contactReferenceSchema.safeParse(reference);if(!parsed.success)throw new AppError('invalid_input','The contact reference is invalid.');
    const rows=await this.searchContacts(p,companyId);const ref=parsed.data;
    const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
    const matches=rows.filter((row:Row)=>ref.kind==='id'?row.id===ref.id:ref.kind==='email'?typeof row.emailAddress==='string'&&normalize(row.emailAddress)===normalize(ref.email):normalize(`${row.firstName??''} ${row.lastName??''}`)===normalize(ref.name));
    if(matches.length===0)throw new AppError('not_found_or_inaccessible','The contact was not found or is inaccessible.');
    if(matches.length>1)throw new AppError('invalid_input','The contact reference is ambiguous; provide an exact contact ID or email.');
    const row=matches[0]!;if(!contactIsActive(row.isActive))throw new AppError('invalid_input','The contact is inactive.');
    const label=`${row.firstName??''} ${row.lastName??''}`.trim();if(!positiveId(row.id)||!validCompanyId(row.companyID)||!label)throw new AppError('dependency_unavailable','The contact record is invalid.');
    return {id:row.id,label,companyId:row.companyID,email:typeof row.emailAddress==='string'?row.emailAddress:undefined,active:true,match:ref.kind};
  };
 async ticketCreateOptions(p:Principal,input:{category?:string|number}={}){
  const names=['title','description','companyID','priority','status','queueID','ticketCategory','ticketType','dueDateTime','assignedResourceID','assignedResourceRoleID','billingCodeID','opportunityID','contactID','issueType','subIssueType'];
  const fields=(await this.read(p,'Tickets','fields')).filter((f:Row)=>names.includes(f.name));
  const roles=(await this.read(p,'Roles','query',[{field:'isActive',op:'eq',value:true}])).filter((r:Row)=>r.isActive).map((r:Row)=>({id:r.id,name:r.name}));
  const workTypes=(await this.workTypes(p)).map(v=>({id:v.id,name:v.label,number_range:numberRange(v.label)??null}));
  let categoryId:number|undefined;if(input.category!==undefined){const matches=(await this.picks(p,'Tickets','ticketCategory')).filter(v=>v.active&&(typeof input.category==='number'?v.id===input.category:v.label.trim().toLowerCase()===input.category!.toString().trim().toLowerCase()));if(matches.length!==1)throw new AppError('invalid_input','Choose one active ticket category.');categoryId=matches[0]!.id;}
  const categoryDefaults=categoryId===undefined?undefined:await this.categoryDefaults(p,categoryId);
  return {classification_policy:classificationGuidance,numbered_groups:Object.fromEntries(['ticketCategory','queueID'].map(name=>[name,(fields.find((f:Row)=>f.name===name)?.picklistValues??[]).map((v:Row)=>({id:Number(v.value),label:v.label,number_range:numberRange(v.label)??null,active:v.isActive}))])),category_defaults:categoryDefaults,ticket_type_availability:this.typeChoices(fields,categoryId),fields,resources:await this.resolveResources(p),roles:roles.map((r:Row)=>({...r,number_range:numberRange(r.name)??null})),work_types:workTypes,requirements:['company','title','priority','queue','due_datetime'],creation_fields:Object.keys(ticketCreationFields),creation_guidance:ticketCreationGuidance,input_field_mapping:{company:'companyID',priority:'priority',queue:'queueID',status:'status',category:'ticketCategory',ticket_type:'ticketType',owner:'assignedResourceID',role:'assignedResourceRoleID',work_type:'billingCodeID',due_datetime:'dueDateTime',opportunity_id:'opportunityID',contact_id:'contactID',issue_type:'issueType',sub_issue_type:'subIssueType',title:'title',description:'description'},defaults:{status:'New only as the omitted-input fallback; explicitly select In Progress or the tenant equivalent when substantive work is already underway',owner:'none unless supplied',description:'Title when description is omitted or blank',classification:'Prefer category defaults within the selected hundreds range; never pick an arbitrary same-range option. Optional unknown type/issue fields stay unresolved.',role:'Explicit/context role, then eligible same-range role, then employee default when no same-range role exists'},limitations:['Role and queue eligibility are checked for the chosen employee.','Native category requirements still apply.','Linking an opportunity does not run the Won Quote wizard.']};
 }

 async prepareTicketCreate(p:Principal,a:TicketCreateInput&{company:number}):Promise<Record<string,unknown>>{
  await this.actor(p);assertCompanyScope(p,a.company);await this.read(p,'Companies','get',[],a.company);
  const select=async(field:string,value:string|number)=>{const rows=await this.picks(p,'Tickets',field);const matches=rows.filter(v=>v.active&&(typeof value==='number'?v.id===value:v.label.toLowerCase()===value.trim().toLowerCase()));if(matches.length!==1)throw new AppError('invalid_input',`Choose one active ${field} value.`);return matches[0]!.id;};
  if(a.contact_identity&&a.contact_id===undefined)throw new AppError('invalid_input','contact_identity requires contact_id.');
  if(a.owner_identity&&a.owner===undefined)throw new AppError('invalid_input','owner_identity requires owner.');
  const contact=a.contact_id===undefined?undefined:await this.resolveContact(p,a.company,{kind:'id',id:a.contact_id});
  if(contact)assertPersonIdentity(a.contact_identity,{name:contact.label,email:contact.email},'contact_id');
  const body:Record<string,unknown>={companyID:a.company,title:a.title,priority:await select('priority',a.priority),queueID:await select('queueID',a.queue),status:await select('status',a.status??'New'),dueDateTime:a.due_datetime,description:a.description?.trim()?a.description:a.title,...(a.contact_id!==undefined?{contactID:contact!.id}: {})};
  const creationMetadata=await this.read(p,'Tickets','fields');
  const options=(field:string,parent?:number)=>(creationMetadata.find((f:Row)=>f.name===field)?.picklistValues??[]).filter((v:Row)=>parent===undefined||String(v.parentValue)===String(parent)).map((v:Row)=>({id:Number(v.value),label:v.label,active:v.isActive===true,isDefault:v.isDefaultValue===true}));
  const queueLabel=options('queueID').find((v:Row)=>v.id===body.queueID)?.label;
  if(a.category!==undefined)body.ticketCategory=await select('ticketCategory',a.category);
  else {const chosen=chooseDefault(options('ticketCategory'),numberRange(queueLabel));if(chosen)body.ticketCategory=chosen.id;}
  const categoryLabel=options('ticketCategory').find((v:Row)=>v.id===body.ticketCategory)?.label;
  const range=numberRange(categoryLabel)??numberRange(queueLabel);
  const defaults=typeof body.ticketCategory==='number'?await this.categoryDefaults(p,body.ticketCategory):{};
  const types=this.typeChoices(creationMetadata,typeof body.ticketCategory==='number'?body.ticketCategory:undefined);
  const chooseField=async(field:string,explicit:string|number|undefined,defaultId:unknown)=>{
    const choices=field==='ticketType'?types.choices:creationMetadata.find((f:Row)=>f.name===field)?.picklistValues??[];
    if(explicit!==undefined){const selected=await select(field,explicit);if(!choices.some((v:Row)=>v.isActive===true&&Number(v.value)===selected))throw new AppError('invalid_input',`The selected ${field} is not available for this category.`);return selected;}
    const native=choices.filter((v:Row)=>v.isActive===true&&Number(v.value)===defaultId);
    if(native.length===1)return Number(native[0].value);
    const selected=chooseDefault(choices.map((v:Row)=>({id:Number(v.value),label:v.label,active:v.isActive===true,isDefault:v.isDefaultValue===true})));return selected?.id;
  };
  const type=await chooseField('ticketType',a.ticket_type,defaults.ticketTypeID);if(type!==undefined)body.ticketType=type;
  const issue=await chooseField('issueType',a.issue_type,defaults.issueTypeID);if(issue!==undefined)body.issueType=issue;
  if(a.sub_issue_type===undefined&&typeof body.issueType==='number'){const choices=options('subIssueType',body.issueType);const native=choices.filter((v:Row)=>v.active&&v.id===defaults.subIssueTypeID);const chosen=native.length===1?native[0]:chooseDefault(choices);if(chosen)body.subIssueType=chosen.id;}
  let workTypeLabel:string|undefined;
  if(range!==undefined||a.work_type!==undefined){
    const workTypes=await this.workTypes(p);let selected;
    if(a.work_type!==undefined){const matches=workTypes.filter(v=>typeof a.work_type==='number'?v.id===a.work_type:v.label.trim().toLowerCase()===a.work_type!.toString().trim().toLowerCase());if(matches.length!==1)throw new AppError('invalid_input','Choose one active work type.');selected=matches[0];}
    else selected=chooseDefault(workTypes.map(v=>({...v,isDefault:v.id===defaults.workTypeID})),range);
    if(selected){body.billingCodeID=selected.id;workTypeLabel=selected.label;}
  }
  assertAlignment({category:categoryLabel,queue:queueLabel,work_type:workTypeLabel},a.classification_override);
  if(a.sub_issue_type!==undefined){if(body.issueType===undefined)throw new AppError('invalid_input','A sub-issue type requires an issue type.');const field=(await this.read(p,'Tickets','fields')).find((f:Row)=>f.name==='subIssueType');const matches=(field?.picklistValues??[]).filter((v:Row)=>v.isActive===true&&String(v.parentValue)===String(body.issueType)&&(typeof a.sub_issue_type==='number'?Number(v.value)===a.sub_issue_type:String(v.label).toLowerCase()===a.sub_issue_type!.toString().trim().toLowerCase()));if(matches.length!==1||!Number.isSafeInteger(Number(matches[0].value))||Number(matches[0].value)<0)throw new AppError('invalid_input','Choose one active sub-issue belonging to the selected issue type.');body.subIssueType=Number(matches[0].value);}
  if(a.opportunity_id!==undefined){await this.assertOpportunity(p,a.company,a.opportunity_id);body.opportunityID=a.opportunity_id;}
  if(a.owner!==undefined){const resources=await this.resolveResources(p);const matches=resources.filter(r=>a.owner==='self'?r.id===p.resourceId:typeof a.owner==='number'?r.id===a.owner:r.label.toLowerCase()===a.owner!.toString().toLowerCase());if(matches.length!==1)throw new AppError('invalid_input','Choose one active employee.');if(typeof a.owner==='number'||a.owner_identity)assertPersonIdentity(a.owner_identity,{name:matches[0]!.label},'owner');const owner=matches[0]!.id;
   const queues=await this.read(p,'ResourceRoleQueues','query',[{field:'resourceID',op:'eq',value:owner}]);if(!queues.some((r:Row)=>r.resourceID===owner&&Number.isSafeInteger(r.queueID)&&r.queueID>=0))throw new AppError('invalid_input','Employee must be associated with at least one Service Desk queue. Membership in the selected ticket queue is not required.');
   const assigned=await this.read(p,'ResourceServiceDeskRoles','query',[{field:'resourceID',op:'eq',value:owner}]);const roles=await this.read(p,'Roles','query',[{field:'isActive',op:'eq',value:true}]);const eligible=roles.filter((r:Row)=>r.isActive&&assigned.some((v:Row)=>v.resourceID===owner&&v.isActive&&v.roleID===r.id));
   const selected=a.role!==undefined?eligible.filter((r:Row)=>typeof a.role==='number'?r.id===a.role:r.name.toLowerCase()===a.role!.toString().toLowerCase()):[];const preferred=a.role===undefined?preferredRole(eligible.map((r:Row)=>({id:r.id,label:r.name,active:true,isDefault:assigned.some((v:Row)=>v.resourceID===owner&&v.roleID===r.id&&v.isActive&&v.isDefault)})),range):undefined;const final=a.role!==undefined?selected:preferred?[preferred]:[];if(final.length!==1)throw new AppError('invalid_input','Supply an eligible unambiguous service-desk role.');body.assignedResourceID=owner;body.assignedResourceRoleID=final[0].id;
  }else if(a.role!==undefined)throw new AppError('invalid_input','A role requires an owner.');

  const fields=await this.read(p,'Tickets','fields');for(const key of Object.keys(body))if(!fields.some((f:Row)=>f.name===key&&f.isReadOnly===false))throw missing(`Ticket field ${key} is not writable in current metadata.`);for(const f of fields)if(f.isRequired&&!f.isReadOnly&&body[f.name]===undefined)throw new AppError('invalid_input',`Required ticket field missing: ${f.name}.`);
  return body;
 }

}
