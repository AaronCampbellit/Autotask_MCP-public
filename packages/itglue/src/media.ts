import {withReconciliation} from '../../execution/src/index.js';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError,actorKey,type Principal} from '../../contracts/src/index.js';
import type {ArtifactService} from '../../artifacts/src/index.js';
import {filenameSchema} from '../../artifacts/src/file-types.js';
import type {ItGluePort} from './client.js';
import type {ItGlueConfig,ItGlueStore,ItGlueReceipt,Row} from './store.js';
const nativeId=z.string().regex(/^[1-9][0-9]{0,19}$/);
export const documentImageSchema=z.object({company:z.number().int().nonnegative(),organization_id:nativeId.optional(),document_id:nativeId,artifact_id:z.string().uuid(),request_key:z.string().min(8).max(128)}).strict();
export type DocumentImageInput=z.infer<typeof documentImageSchema>;
export interface DocumentImageContext {store:ItGlueStore;port:ItGluePort;artifacts:Pick<ArtifactService,'download'|'catalog'>;config:ItGlueConfig;organizationId:string;/** Must reauthorize, check write switches, connection version and current document organization. */guard:()=>Promise<void>}
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>new AppError('invalid_input','Document images require a bounded PNG or JPEG artifact with matching filename, MIME and content.');
/** Envelope and image framing checks only; no decoding or malware scanning is claimed. */
export function validateDocumentImage(bytes:Buffer,metadata:{filename:string;mime:string;bytes:number;sha256:string}){
 if(!filenameSchema.safeParse(metadata.filename).success||bytes.length===0||bytes.length>5_000_000||metadata.bytes!==bytes.length||metadata.sha256!==digest(bytes))throw invalid();
 const ext=metadata.filename.split('.').at(-1)?.toLowerCase();
 if(metadata.mime==='image/png'&&ext==='png'){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex')))throw invalid();
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>20000||height>20000||width*height>40_000_000)throw invalid();
 }else if(metadata.mime==='image/jpeg'&&(ext==='jpg'||ext==='jpeg')){if(bytes.length<4||!bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||!bytes.subarray(-2).equals(Buffer.from([255,217])))throw invalid();}
 else throw invalid();
 return {content:bytes.toString('base64'),'file-name':metadata.filename};
}
function imageProjection(data:Row,org:string,doc:string){
 const parsed=nativeId.safeParse(String(data?.id)),attrs=data?.attributes;if(!parsed.success||data?.type!=='document-images'||String(attrs?.['document-id'])!==doc||attrs?.target?.type!=='document'||String(attrs?.target?.id)!==doc)throw new AppError('dependency_unavailable','Document image parent was not confirmed.');
 const path=`/${org}/docs/${doc}/developer/images/${parsed.data}`;if(attrs?.['inline-resource-url']!==path)throw new AppError('dependency_unavailable','Document image reference was not confirmed.');
 return {image_id:parsed.data,document_id:doc,inline_resource_url:path};
}
export async function createDocumentImage(context:DocumentImageContext,p:Principal,input:unknown):Promise<ItGlueReceipt>{
 const a=documentImageSchema.parse(input),{config:c,organizationId:org,guard,store,port,artifacts}=context;
 if(a.organization_id!==undefined&&a.organization_id!==org)throw new AppError('not_found_or_inaccessible','Document organization is inaccessible.');
 // The native target body requires a JSON integer; refuse lossy ID conversion.
 const target=Number(a.document_id);if(!Number.isSafeInteger(target)||target<1)throw new AppError('invalid_input','Document image target cannot be represented as a native integer.');
 await guard();const hash=digest(JSON.stringify({name:'itg_document_image_create',company:a.company,organization:org,document:a.document_id,artifact:a.artifact_id,version:c.version}));
 const saved=await store.reserve(p.tenantId,{id:randomUUID(),actor:actorKey(p),requestKey:a.request_key,hash,organizationId:org,companyId:a.company,connectionVersion:c.version,state:'reserved',steps:[],intent:{name:'itg_document_image_create',args:a},createdAt:new Date().toISOString()});
 if(saved.receipt.hash!==hash)throw new AppError('conflict','Request key already identifies a different operation.');
 if(!saved.created){await guard();return saved.receipt;}
 const receipt=saved.receipt;let dispatched=false;
 const download=async()=>{const file=await artifacts.download(p,{artifact_id:a.artifact_id}),record=await artifacts.catalog.get(a.artifact_id,actorKey(p));if(!record||record.companyId!==a.company||record.kind!=='staged_upload')throw new AppError('not_found_or_inaccessible','The image artifact must be staged for the target company.');return file;};
 try{
  const artifact=await download(),image=validateDocumentImage(artifact.bytes,artifact.metadata);
  receipt.intent.artifact_sha256=artifact.metadata.sha256;receipt.intent.artifact_bytes=artifact.bytes.length;await store.finish(p.tenantId,receipt);
  const beforeWrite=async()=>{await guard();const fresh=await download();validateDocumentImage(fresh.bytes,fresh.metadata);if(fresh.metadata.sha256!==artifact.metadata.sha256||fresh.metadata.filename!==artifact.metadata.filename||fresh.metadata.mime!==artifact.metadata.mime)throw new AppError('conflict','The image artifact changed before upload.');await guard();receipt.state='dispatching';await store.finish(p.tenantId,receipt);dispatched=true;};
  const raw=await port.request(c,'/document_images',{}, {data:{type:'document-images',attributes:{target:{type:'document',id:target},image}}},guard,beforeWrite,'POST');
  const created=imageProjection(raw.data,org,a.document_id);receipt.steps.push({...created,status:'accepted_unverified'});receipt.state='accepted_unverified';await store.finish(p.tenantId,receipt);
  return await withReconciliation(async()=>{await guard();const readback=await port.request(c,`/document_images/${created.image_id}`,{},undefined,guard);const verified=imageProjection(readback.data,org,a.document_id);if(verified.image_id!==created.image_id)throw new AppError('dependency_unavailable','Uploaded image identity was not confirmed.');await guard();receipt.steps[0]={...verified,status:'verified'};receipt.state='verified';await store.finish(p.tenantId,receipt);return receipt;});
 }catch(error){receipt.state=dispatched?(receipt.steps.length?'accepted_unverified':'unknown_outcome'):'failed';await store.finish(p.tenantId,receipt);if(!dispatched)throw error;return receipt;}
}
