import {providerFetch} from '../../execution/src/index.js';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {compileInventory,compileSnapshot,readOnlyDefinitionDigest,loadMetadataSnapshot,verifyLocalSources,type MetadataSnapshot,type MetadataSource,type EntityMetadata} from '../../metadata/src/index.js';

// This collector has no operation qualification authority. Its persisted allowance is
// a separate, small partition; deployments must reserve it from any application budget.
export const collectorConfigSchema=z.object({
 verifyAllResources:z.boolean().default(false),tenantId:z.string().uuid(),resourceId:z.number().int().positive().safe(),policyVersion:z.string().regex(/^[A-Za-z0-9._:-]+$/),
 baseUrl:z.string().regex(/^https:\/\/webservices\d+\.autotask\.net\/atservicesrest\/v1\.0\/$/),
 windowMs:z.number().int().min(60000).max(86400000),requestsPerWindow:z.number().int().min(10).max(100),
 externalHeadroom:z.number().int().positive().max(1000000),intervalMs:z.number().int().min(120000).max(180000),
}).strict();
export type CollectorConfig=z.infer<typeof collectorConfigSchema>;
const thresholdSchema=z.object({externalRequestThreshold:z.number().int().positive().max(1000000),requestThresholdTimeframe:z.number().int().positive().max(1440),currentTimeframeRequestCount:z.number().int().nonnegative()});
const selections={Resources:['id','isActive'],Tickets:['id','ticketNumber','companyID'],Companies:['id','companyName','isActive']} as const;
const fieldSchema=z.object({name:z.string(),dataType:z.string(),isRequired:z.boolean(),isReadOnly:z.boolean(),isQueryable:z.boolean(),isReference:z.boolean(),referenceEntityType:z.string().nullable()});
export function normalizeThreshold(value:unknown,config:CollectorConfig){
 const raw=thresholdSchema.parse(value);
 if(raw.requestThresholdTimeframe*60000!==config.windowMs)throw new Error('threshold_window_changed');
 if(raw.externalRequestThreshold-raw.currentTimeframeRequestCount<=config.externalHeadroom+config.requestsPerWindow)throw new Error('threshold_headroom_unavailable');
 return {windowMs:config.windowMs,limit:raw.externalRequestThreshold,used:raw.currentTimeframeRequestCount};
}
export function resourceObservation(value:unknown,resourceId:number){
 const parsed=z.object({items:z.array(z.object({id:z.number().int().positive().safe(),isActive:z.boolean()})).length(1)}).parse(value);
 if(parsed.items[0]!.id!==resourceId)throw new Error('resource_mismatch');
 return parsed.items[0]!;
}
export async function atomicJson(path:string,value:unknown){
 const temp=`${path}.${randomUUID()}.tmp`;
 await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});
 await rename(temp,path);
}
export function allResourceObservations(value:unknown){
 const parsed=z.object({items:z.array(z.object({id:z.number().int().positive().safe(),isActive:z.boolean()})).min(1).max(500),pageDetails:z.object({nextPageUrl:z.null()})}).parse(value);
 if(new Set(parsed.items.map(r=>r.id)).size!==parsed.items.length)throw new Error('duplicate_resource');return parsed.items;
}
export class ReadOnlyCollector {
 private readonly root:string;
 private readonly directory:string;
 private readonly config:CollectorConfig;
 constructor(config:unknown,private readonly options:{root:string;directory:string;credentials:{username:string;secret:string;integrationCode:string};fetch?:typeof fetch;now?:()=>number}){
  this.config=collectorConfigSchema.parse(config);this.root=resolve(options.root);this.directory=resolve(this.root,options.directory);
  if(this.directory!==resolve(this.root,'config/metadata'))throw new Error('collector_directory_invalid');
  if(Object.values(options.credentials).some(v=>!v||/[\r\n]/.test(v)))throw new Error('collector_credentials_invalid');
 }
 private now(){return this.options.now?.()??Date.now();}
 private async admit(){
  const path=resolve(this.directory,'attempts.json'),now=this.now();
  let state:{lastAt:number;attempts:number[]}={lastAt:now,attempts:[]};
  try{state=z.object({lastAt:z.number().int(),attempts:z.array(z.number().int()).max(100)}).strict().parse(JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('collector_accounting_invalid');}
  if(now<state.lastAt||state.attempts.some(t=>t>now))throw new Error('collector_clock_regression');
  state.attempts=state.attempts.filter(t=>now-t<this.config.windowMs);
  if(state.attempts.length>=this.config.requestsPerWindow)throw new Error('collector_allowance_exhausted');
  state.attempts.push(now);state.lastAt=now;await atomicJson(path,state);
 }
 private async get(route:string){
  const allowed=['ThresholdInformation',...Object.keys(selections).map(e=>`${e}/entityInformation/fields`)];
  const resourceQuery=this.resourceQuery();
  if(!allowed.includes(route)&&route!==resourceQuery)throw new Error('collector_route_invalid');
  await this.admit();
  const {username,secret,integrationCode}=this.options.credentials;
  const response=await providerFetch('Autotask collector',this.options.fetch??fetch)(new URL(route,this.config.baseUrl),{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{UserName:username,Secret:secret,ApiIntegrationCode:integrationCode,Accept:'application/json'}});
  if(!response.ok)throw new Error(`collector_http_${response.status}`);
  if(Number(response.headers.get('content-length')??0)>16*1024*1024)throw new Error('collector_response_oversized');
  const reader=response.body?.getReader();if(!reader)throw new Error('collector_response_empty');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024)throw new Error('collector_response_oversized');chunks.push(value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }
 private resourceQuery(){return 'Resources/query?'+new URLSearchParams({search:JSON.stringify(this.config.verifyAllResources?{MaxRecords:500,IncludeFields:['id','isActive'],filter:[{op:'gte',field:'id',value:1}]}:{MaxRecords:1,IncludeFields:['id','isActive'],filter:[{op:'eq',field:'id',value:this.config.resourceId}]})});}
 private async capture(id:string,kind:MetadataSource['kind'],value:unknown,at:string):Promise<MetadataSource>{
  const name=`${id}-${randomUUID()}.json`,reference=`config/metadata/captures/${name}`;
  await atomicJson(resolve(this.root,reference),value);
  return{id,kind,reference,sha256:createHash('sha256').update(await readFile(resolve(this.root,reference))).digest('hex'),capturedAt:at};
 }
 async probe(){
  normalizeThreshold(await this.get('ThresholdInformation'),this.config);
  const raw=await this.get(this.resourceQuery());
  const resources=this.config.verifyAllResources?allResourceObservations(raw):[resourceObservation(raw,this.config.resourceId)];
  if(!resources.some(r=>r.id===this.config.resourceId&&r.isActive))throw new Error('primary_resource_inactive');
 }
 async run(options:{refreshMetadata?:boolean}={}){
  await mkdir(resolve(this.directory,'captures'),{recursive:true,mode:0o700});
  const threshold=normalizeThreshold(await this.get('ThresholdInformation'),this.config),observedAt=new Date(this.now()).toISOString();
  const thresholdSource=await this.capture('threshold','operational-capture',threshold,observedAt);
  await atomicJson(resolve(this.directory,'threshold.json'),{schemaVersion:1,observation:{tenantId:this.config.tenantId,source:'ThresholdInformation',observedAt,expiresAt:new Date(Date.parse(observedAt)+240000).toISOString(),...threshold,evidenceReference:thresholdSource.reference.split('/').at(-1)!.slice(0,-5)},evidence:{path:thresholdSource.reference,sha256:thresholdSource.sha256}});
  const inventory=compileInventory(JSON.parse(await readFile(resolve(this.root,'registry/coverage.json'),'utf8')));
  const collectMetadata=async()=>{
   const sources:MetadataSource[]=[],entities:EntityMetadata[]=[];
   for(const [entity,names] of Object.entries(selections)){
    const raw=z.object({fields:z.array(z.unknown())}).parse(await this.get(`${entity}/entityInformation/fields`));
    const fields=raw.fields.filter(f=>f&&typeof f==='object'&&names.includes((f as {name:string}).name as never)).map(f=>fieldSchema.parse(f));
    if(fields.length!==names.length||new Set(fields.map(f=>f.name)).size!==names.length)throw new Error('collector_fields_missing');
    const at=new Date(this.now()).toISOString(),source=await this.capture(`fields-${entity}`,'metadata-export',{fields},at);sources.push(source);
    entities.push({entity,runtimeName:entity,complete:false,sourceIds:[source.id],userDefinedFields:[],fields:fields.map(f=>({name:f.name,dataType:f.dataType,required:f.isRequired,readOnly:f.isReadOnly,queryable:f.isQueryable,referenceEntity:f.isReference?f.referenceEntityType:null}))});
   }
   const now=this.now();return compileSnapshot({content:{schemaVersion:1,source:'Autotask',tenantId:this.config.tenantId,policyVersion:this.config.policyVersion,capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+7*86400000).toISOString(),inventoryDigest:inventory.digest,sources,entities,bindings:[],resourceVerifications:[]},qualifications:[]},{inventory,now});
  };
  let snapshot:MetadataSnapshot;
  try{
   snapshot=await loadMetadataSnapshot(resolve(this.directory,'snapshot.json'),{inventory,requireFresh:false,now:this.now()});
   await verifyLocalSources(snapshot,this.root);
   if(snapshot.content.tenantId!==this.config.tenantId||snapshot.content.policyVersion!==this.config.policyVersion||snapshot.qualifications.length||snapshot.content.bindings.length)throw new Error('collector_snapshot_binding_invalid');
  }catch(error){
   // Only absence permits initialization. Existing snapshots must validate before
   // any renewal can compare newly captured definitions against them.
   try{await readFile(resolve(this.directory,'snapshot.json'));throw error;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   snapshot=await collectMetadata();
  }
  if(options.refreshMetadata||this.now()-Date.parse(snapshot.content.capturedAt)>=86400000){
   const renewed=await collectMetadata();
   if(readOnlyDefinitionDigest(renewed)!==readOnlyDefinitionDigest(snapshot))throw new Error('collector_definition_changed');
   snapshot=renewed;
  }
  const query=this.resourceQuery();
  const raw=await this.get(query),verifiedAt=new Date(this.now()).toISOString();
  const resources=this.config.verifyAllResources?allResourceObservations(raw):[resourceObservation(raw,this.config.resourceId)];
  if(!resources.some(r=>r.id===this.config.resourceId))throw new Error('primary_resource_missing');
  const proofs=await Promise.all(resources.map(resource=>this.capture(`employee-${resource.id}`,'operational-capture',resource,verifiedAt)));
  const content={...snapshot.content,sources:[...snapshot.content.sources.filter(s=>s.kind!=='operational-capture'),...proofs],resourceVerifications:resources.map((resource,i)=>({tenantId:this.config.tenantId,resourceId:resource.id,active:resource.isActive,verifiedAt,expiresAt:new Date(Date.parse(verifiedAt)+240000).toISOString(),sourceIds:[proofs[i]!.id]}))};
  const next=compileSnapshot({content,qualifications:[]},{inventory,now:this.now()});
  if(next.metadataDigest!==snapshot.metadataDigest)throw new Error('collector_metadata_changed');
  await verifyLocalSources(next,this.root);await atomicJson(resolve(this.directory,'snapshot.json'),next);
  return {status:'collected',resourceActive:resources.find(r=>r.id===this.config.resourceId)!.isActive,verifiedResources:resources.length,verifiedAt,metadataDigest:next.metadataDigest,qualifiedOperations:0};
 }
}
