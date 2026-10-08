import {withReconciliation} from '../../execution/src/index.js';
import {providerFetch} from '../../execution/src/index.js';
import { impersonationHeader } from '../../autotask/src/impersonation.js';
import {validateNativeField,validateUdfs,nativeProjection,fieldMatches,type NativeField} from '../../native-fields/src/index.js';
import {assertPersonIdentity} from '../../contracts/src/person-identity.js';
import { assertArea } from '../../policy/src/areas.js';
import {createHash} from 'node:crypto';
import {AppError,actorKey,positiveId,type Principal,type DataRecord,type JournalRecord} from '../../contracts/src/index.js';
import {reauthorize,assertCapability,assertCompanyScope} from '../../policy/src/index.js';
import {requestScheduler} from '../../autotask/src/index.js';
import type {RequestBudgetPort} from '../../autotask/src/budget.js';
import {IntentCipher} from '../../storage/src/intent-cipher.js';
import type {TicketWorkflows} from '../../workflows/src/index.js';
import {canonicalCompanyName} from '../../workflows/src/company-aliases.js';
import * as c from './contracts.js';
export * from './contracts.js';
type Row=Record<string,any>;
type Field={name:string;dataType:string;isRequired:boolean;isReadOnly:boolean;isQueryable:boolean;length?:number;isPickList?:boolean;picklistValues?:Array<{value:string;label:string;isActive:boolean}>};
const canonical=(v:any):string=>Array.isArray(v)?`[${v.map(canonical)}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const failure=(message:string,code:'invalid_input'|'missing_metadata'|'conflict'|'dependency_unavailable'='invalid_input')=>new AppError(code,message);
const absent=()=>new AppError('not_found_or_inaccessible','Sales record not found or inaccessible.');
const identity=(p:Principal)=>hash({tenant:p.tenantId,actor:p.objectId,resource:p.resourceId,mapping:p.mappingVersion,policy:p.policyVersion,companies:[...p.companyIds].sort(),capabilities:[...p.capabilities].sort(),areas:p.areaPermissions??null});
const project=(entity:keyof typeof c.fields,row:Row)=>Object.fromEntries(c.fields[entity].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
export interface SalesOptions {tenantId:string;baseUrl:string;username:string;secret:string;integrationCode:string;requestBudget:RequestBudgetPort;writesEnabled:boolean;fetch?:typeof fetch;now?:()=>number}
/** Fixed sales endpoints. API-account reads; writes request native employee attribution, which receipts report without assuming support. */
export class SalesService {
 private base:URL;private cache=new Map<string,{at:number;fields:Field[]}>();
 constructor(private core:TicketWorkflows,private cipher:IntentCipher,private options:SalesOptions){
  if(!/^https:\/\/webservices\d+\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl)||!options.tenantId||[options.username,options.secret,options.integrationCode].some(v=>!v||/[\r\n]/.test(v)))throw failure('Invalid sales configuration.');this.base=new URL(options.baseUrl);
 }
 private now(){return this.options.now?.()??Date.now();}
 private async actor(p:Principal,write=false){const fresh=await reauthorize(p,this.core.principals,{resourceMaxAgeMs:240000,now:()=>new Date(this.now())});if(fresh.tenantId!==this.options.tenantId)throw absent();assertCapability(fresh,'operational.read');assertCapability(fresh,'finance.read');assertArea(fresh,'sales',write);if(write){assertCapability(fresh,'sales.write');if(!this.options.writesEnabled)throw new AppError('forbidden','Sales writes are disabled.');}return fresh;}
 private async request(p:Principal,path:string,method:'GET'|'POST'|'PATCH'|'DELETE'='GET',body?:unknown,write=false,allow404=false,maxResponseBytes=2*1024*1024):Promise<any>{
  const url=new URL(path,this.base);
  if(url.origin!==this.base.origin||!url.pathname.startsWith(this.base.pathname)||url.username||url.password||url.hash)throw failure('Invalid sales route.');
  const release=await requestScheduler.acquire(actorKey(p),15000);
  try{await this.actor(p,write);await this.options.requestBudget.take({tenantId:p.tenantId,actorKey:actorKey(p)});await this.actor(p,write);
   let response:Response;
   try{response=await providerFetch('Autotask',this.options.fetch??fetch)(url,{method,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000),headers:{UserName:this.options.username,Secret:this.options.secret,ApiIntegrationCode:this.options.integrationCode,'Content-Type':'application/json',Accept:'application/json',...(write?impersonationHeader(path.split('/').filter(Boolean)[0]??'',p.resourceId):{})}});}catch{throw new AppError(write?'unknown_outcome':'dependency_unavailable','Sales API transport failed; mutations are never automatically repeated.');}
   if(response.status===404&&allow404&&!write)return undefined;
   if(!response.ok){if(response.status===404&&!write)throw absent();throw new AppError(write&&(response.status>=500||response.status===408)?'unknown_outcome':[401,403].includes(response.status)?'forbidden':response.status===429?'throttled':write?'invalid_input':'dependency_unavailable',`Sales API returned HTTP ${response.status}. No automatic retry was sent.`);}
   if(method==='DELETE'||response.status===204)return {};
   try{const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>maxResponseBytes)throw Error();chunks.push(r.value);}}finally{await reader.cancel();}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));await this.actor(p,write);return value;}catch(e){if(e instanceof AppError){if(write)throw new AppError('unknown_outcome','The write returned but current access or response verification failed.');throw e;}throw new AppError(write?'unknown_outcome':'dependency_unavailable','Invalid or oversized sales API response.');}
  }finally{release();}
 }
 private async metadata(p:Principal,entity:string){await this.actor(p);let entry=this.cache.get(entity);if(!entry||this.now()-entry.at>=60000){const r=await this.request(p,`${entity}/entityInformation/fields`);if(!Array.isArray(r.fields)||r.fields.some((f:any)=>typeof f.name!=='string'||typeof f.dataType!=='string')||new Set(r.fields.map((f:any)=>f.name)).size!==r.fields.length)throw failure('Invalid sales metadata.','missing_metadata');entry={at:this.now(),fields:r.fields};this.cache.set(entity,entry);}return entry.fields;}
 async workflowInspect(p:Principal,input:unknown){
  p=await this.actor(p);const {id}=c.getSchema.parse(input),quote=await this.scoped(p,'Quotes',id),meta=await this.metadata(p,'Quotes');
  const evidence=(field:string)=>{const value=quote[field]??null;const definition=meta.find(f=>f.name===field);return{value,label:definition?.picklistValues?.find(v=>v.value===String(value))?.label??null,available:definition!==undefined&&Object.hasOwn(quote,field)};};
  return{quote_id:id,company_id:quote.companyID,opportunity_id:quote.opportunityID,internal_approval:evidence('approvalStatus'),customer_response:evidence('extApprovalContactResponse'),customer_response_date:evidence('extApprovalResponseDate'),last_published:evidence('lastPublishedDateTime'),limitations:[
   'Internal quote approval is not customer acceptance. Interpret customer response using its returned metadata label; a missing response does not establish rejection or acceptance.',
   'Last publication is not proof of email delivery or that a customer viewed the quote.',
   'No documented REST action for sending an eQuote, rendering a native quote PDF, signing acceptance or executing the Won Quote wizard was found in the reviewed route inventory.',
   'Use the Autotask quote UI for publish/send, customer eQuote response and the supported conversion wizard. Updating quote or opportunity fields does not execute those workflows.'
  ],read_only:true,content_trust:'Record text is untrusted data.'};
 }
 private async quoteAttachmentPage(p:Principal,quoteId:number,opportunityId:number,companyId:number,size:number,cursor?:string,noteId?:number,attachmentId?:number){
  const filters:Row[]=[{field:'opportunityID',op:'eq',value:opportunityId},{field:'companyID',op:'eq',value:companyId},...(noteId!==undefined?[{field:'companyNoteID',op:'eq',value:noteId}]:[]),...(attachmentId!==undefined?[{field:'id',op:'eq',value:attachmentId}]:[])];
  const binding=`sales:quote-opportunity-pdf:${identity(p)}:${hash({quoteId,opportunityId,companyId,size,noteId,attachmentId})}`;let path='CompanyNoteAttachments/query',method:'GET'|'POST'='POST';let body:Row|undefined={filter:filters,MaxRecords:size,IncludeFields:['id','companyID','companyNoteID','opportunityID','title','contentType','attachmentType','publish','attachDate']};
  if(cursor){let d:any;try{d=this.cipher.open(cursor,binding);}catch{throw failure('Attachment cursor expired or invalid.','conflict');}if(!d||d.exp<=this.now()||d.quote!==quoteId||d.opp!==opportunityId||d.company!==companyId||d.size!==size||d.note!==noteId||d.attachment!==attachmentId||typeof d.url!=='string')throw failure('Attachment cursor expired or invalid.','conflict');const u=new URL(d.url,this.base),queryPath=new URL('CompanyNoteAttachments/query',this.base).pathname,nextPath=new URL('CompanyNoteAttachments/query/next',this.base).pathname;if(u.origin!==this.base.origin||![queryPath,nextPath].includes(u.pathname)||u.hash||u.username||u.password||u.pathname.endsWith('/'))throw failure('Invalid attachment continuation.','conflict');path=u.href;}
  const r=await this.request(p,path,method,body,false,false);if(!r||!Array.isArray(r.items)||new Set(r.items.map((v:any)=>v?.id)).size!==r.items.length||r.items.length>size||!r.pageDetails||!(r.pageDetails.nextPageUrl===null||typeof r.pageDetails.nextPageUrl==='string')||r.items.some((v:any)=>!v||Array.isArray(v)||!positiveId(v.id)||!positiveId(v.companyNoteID)||v.companyID!==companyId||(v.opportunityID!==undefined&&v.opportunityID!==opportunityId)))throw failure('Invalid CompanyNoteAttachments response.','dependency_unavailable');
  let next:string|null=null;if(r.pageDetails.nextPageUrl!==null){if(!r.pageDetails.nextPageUrl)throw failure('Empty attachment continuation.','dependency_unavailable');const u=new URL(r.pageDetails.nextPageUrl,this.base),queryPath=new URL('CompanyNoteAttachments/query',this.base).pathname,nextPath=new URL('CompanyNoteAttachments/query/next',this.base).pathname;if(u.origin!==this.base.origin||![queryPath,nextPath].includes(u.pathname)||u.hash||u.username||u.password||u.pathname.endsWith('/'))throw failure('Unsafe attachment continuation.','dependency_unavailable');next=this.cipher.seal({url:u.href,exp:this.now()+600000,quote:quoteId,opp:opportunityId,company:companyId,size,note:noteId,attachment:attachmentId},binding);}
  return{items:r.items as Row[],next};
 }
 private async verifyQuoteNote(p:Principal,quote:Row,opportunity:Row,noteId:number){const note=await this.scoped(p,'CompanyNotes',noteId);if(note.companyID!==quote.companyID||note.opportunityID!==opportunity.id)throw absent();return note;}
 async quoteOpportunityPdfSearch(p:Principal,input:unknown){
  p=await this.actor(p);const a=c.quoteOpportunityPdfSearchSchema.parse(input),quote=await this.scoped(p,'Quotes',a.quote_id),opp=await this.scoped(p,'Opportunities',quote.opportunityID),page=await this.quoteAttachmentPage(p,quote.id,opp.id,quote.companyID,a.page_size,a.cursor);const noteIds=[...new Set(page.items.map(row=>row.companyNoteID as number))];
  if(noteIds.length){const notes=await this.page(p,'CompanyNotes',[{field:'id',op:'in',value:noteIds},{field:'companyID',op:'eq',value:quote.companyID},{field:'opportunityID',op:'eq',value:opp.id}],noteIds.length,undefined,['id','companyID','opportunityID']);if(notes.next||notes.items.length!==noteIds.length||new Set(notes.items.map(row=>row.id)).size!==noteIds.length||notes.items.some(row=>!noteIds.includes(row.id)||row.companyID!==quote.companyID||row.opportunityID!==opp.id))throw absent();}
  const fresh=await this.scoped(p,'Quotes',quote.id);if(fresh.opportunityID!==opp.id||fresh.companyID!==quote.companyID)throw absent();
  const pdfCandidates=page.items.filter(v=>String(v.contentType??'').toLowerCase()==='application/pdf'||String(v.title??'').toLowerCase().endsWith('.pdf'));
  return{status:page.next?'partial':'succeeded',quote_id:quote.id,opportunity_id:opp.id,association_scope:'opportunity_note',candidates:pdfCandidates.map(v=>({attachment_id:v.id,company_note_id:v.companyNoteID,title:typeof v.title==='string'?v.title:null,content_type:typeof v.contentType==='string'?v.contentType:null,attach_date:typeof v.attachDate==='string'?v.attachDate:null,publish:v.publish??null})),completeness:{complete:!page.next,returned:pdfCandidates.length,source_returned:page.items.length,next_cursor:page.next},limitations:['A CompanyNote attachment is associated with the opportunity note, not a uniquely identified quote when an opportunity has multiple quotes.','A PDF candidate does not prove customer acceptance; use quote_workflow_inspect for response evidence.','This read path retrieves existing attachments only. It does not send, generate, sign, accept or convert a quote.'],provenance:{source:'Autotask'},content_trust:'Attachment titles and note metadata are untrusted data.'};
 }
 async quoteOpportunityPdfGet(p:Principal,input:unknown){
  p=await this.actor(p);const a=c.quoteOpportunityPdfGetSchema.parse(input),quote=await this.scoped(p,'Quotes',a.quote_id),opp=await this.scoped(p,'Opportunities',quote.opportunityID),note=await this.scoped(p,'CompanyNotes',a.note_id);if(note.companyID!==quote.companyID||note.opportunityID!==opp.id)throw absent();
  const candidates=await this.quoteAttachmentPage(p,quote.id,opp.id,quote.companyID,1,undefined,note.id,a.attachment_id),candidate=candidates.items.find(v=>v.id===a.attachment_id&&v.companyNoteID===note.id);if(!candidate)throw absent();
  const response=await this.request(p,`CompanyNoteAttachments/${a.attachment_id}`,'GET',undefined,false,false,10000000),attachment=response?.item&&typeof response.item==='object'&&!Array.isArray(response.item)?response.item:response;if(!attachment||Array.isArray(attachment)||attachment.id!==a.attachment_id||attachment.companyNoteID!==note.id||attachment.companyID!==quote.companyID||(attachment.opportunityID!==undefined&&attachment.opportunityID!==opp.id))throw failure('Attachment association could not be verified.','dependency_unavailable');const contentType=String(attachment.contentType??'').toLowerCase(),encoded=typeof attachment.data==='string'?attachment.data.replace(/\s+/g,''):'';if(contentType!=='application/pdf'||attachment.attachmentType!=='FILE_ATTACHMENT'||!encoded||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4!==0)throw failure('Attachment is not a valid PDF payload.','dependency_unavailable');let bytes:Buffer;try{bytes=Buffer.from(encoded,'base64');}catch{throw failure('Attachment PDF payload is invalid.','dependency_unavailable');}if(bytes.toString('base64')!==encoded||bytes.length<5||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||bytes.length>7000000||!Number.isSafeInteger(attachment.fileSize)||attachment.fileSize!==bytes.length||a.offset>bytes.length)throw failure('Attachment PDF payload failed verification.','dependency_unavailable');await this.actor(p);const freshQuote=await this.scoped(p,'Quotes',quote.id),freshOpp=await this.scoped(p,'Opportunities',opp.id),freshNote=await this.verifyQuoteNote(p,freshQuote,freshOpp,note.id);if(freshQuote.opportunityID!==freshOpp.id||freshQuote.companyID!==quote.companyID||freshOpp.companyID!==quote.companyID||freshNote.companyID!==quote.companyID||freshNote.opportunityID!==freshOpp.id)throw absent();const end=Math.min(bytes.length,a.offset+a.length);return{status:'succeeded',quote_id:quote.id,opportunity_id:opp.id,company_note_id:note.id,attachment:{id:attachment.id,title:typeof attachment.title==='string'?attachment.title:null,content_type:attachment.contentType,file_size:bytes.length,offset:a.offset,length:end-a.offset,next_offset:end<bytes.length?end:null,chunk_base64:bytes.subarray(a.offset,end).toString('base64'),whole_sha256:createHash('sha256').update(bytes).digest('hex')},association_scope:'opportunity_note',acceptance_status:'not_established',limitations:['The attachment is verified against the supplied opportunity note and quote opportunity, but the REST data does not establish that it is the accepted quote PDF for this specific quote.','Use quote_workflow_inspect to interpret customer-response evidence. This tool never sends, generates, signs, accepts or converts quotes.'],provenance:{source:'Autotask'},content_trust:'Attachment titles and note metadata are untrusted data.'};
 }
 async quoteWorkflowPrepare(p:Principal,input:unknown){
  p=await this.actor(p);const a=c.quoteWorkflowPrepareSchema.parse(input),quote=await this.scoped(p,'Quotes',a.quote_id),opp=await this.scoped(p,'Opportunities',quote.opportunityID),evidence=await this.workflowInspect(p,{id:quote.id});const handoff:Record<string,{surface:string;path:string;action:string}>={send:{surface:'Autotask UI',path:'CRM > Quotes > View/Preview Quote',action:'Review the quote and use the native eQuote send/publish controls.'},pdf:{surface:'Autotask UI',path:'CRM > Quotes > View/Preview Quote',action:'Use the native preview/print workflow; after a customer response, use quote_opportunity_pdf_search to locate an existing CompanyNote PDF.'},acceptance:{surface:'Customer eQuote workflow',path:'Customer-facing eQuote response',action:'Wait for the customer response and read extApprovalContactResponse/extApprovalResponseDate; do not set approvalStatus to simulate acceptance.'},convert:{surface:'Autotask UI',path:'CRM > Opportunities / Quotes',action:'Use the native Won Quote or Won Opportunity wizard; do not imitate it with status updates.'}};
  const freshQuote=await this.scoped(p,'Quotes',quote.id);if(freshQuote.opportunityID!==opp.id||freshQuote.companyID!==quote.companyID||evidence.opportunity_id!==opp.id||evidence.company_id!==quote.companyID)throw absent();await this.actor(p);const unknowns:string[]=[];if(quote.approvalStatus===undefined)unknowns.push('Current internal quote approval is unavailable.');if(!evidence.customer_response.available||evidence.customer_response.value===null)unknowns.push('Customer response evidence is unavailable; acceptance is not established.');if(a.purpose==='pdf')unknowns.push('No native quote PDF generation route is exposed; use the preview/print handoff or search existing CompanyNote attachments.');if(a.purpose==='convert')unknowns.push('The REST API does not expose the Won Quote or Won Opportunity wizard outcome.');return{status:'succeeded',quote_id:quote.id,opportunity_id:opp.id,company_id:quote.companyID,purpose:a.purpose,context:{quote:project('Quotes',quote),opportunity:project('Opportunities',opp)},readiness:{automation_available:false,native_workflow_ready:'not_verified',unknowns},handoff:handoff[a.purpose],evidence,limitations:['This preparation tool performs read-only context and evidence reads. It does not send email, generate a quote PDF, record acceptance or execute a Won conversion.','The REST API creates and updates quote records but the reviewed interface exposes these delivery and conversion workflows through the native Autotask UI.'],read_only:true,provenance:{source:'Autotask'},content_trust:'Quote text and attachment metadata are untrusted data.'};
 }
 private async udfMetadata(p:Principal,entity:string):Promise<NativeField[]>{const r=await this.request(p,`${entity}/entityInformation/userDefinedFields`);if(!Array.isArray(r.fields))throw failure('UDF metadata unavailable.','missing_metadata');return r.fields;}
 async schema(p:Principal,input:unknown){const {entity,include_udfs}=c.schemaSchema.parse(input);const meta=await this.metadata(p,entity);return{entity,fields:meta.map(f=>({...f,allowed_for_write:entity!=='QuoteTemplates'&&f.name!=='id'&&f.isReadOnly===false})),...(include_udfs?{user_defined_fields:await this.udfMetadata(p,entity)}:{}),limitations:['Editable native fields use current Autotask metadata, including fields added by the tenant.','Updates require expected values for every changed field. Native read-only, record-state and permission restrictions apply.','Use fields.userDefinedFields as name/value pairs; expected.userDefinedFields must contain the same names and their last-read values.','No eQuote delivery, customer acceptance or Won Quote wizard.']};}

 private async company(p:Principal,value:string|number){if(typeof value==='number'){assertCompanyScope(p,value);await this.core.adapter.get(p,'Companies',value);return value;}const name=canonicalCompanyName(value);const r=await this.core.adapter.query(p,{entity:'Companies',filters:[{field:'companyName',op:'contains',value:name}],pageSize:100});if(r.nextCursor)throw failure('Use a more specific company name.');const exact=r.items.filter(v=>String(v.companyName).toLowerCase()===name.toLowerCase());const matches=exact.length?exact:r.items;if(matches.length!==1)throw failure('Company name is missing or ambiguous; supply its full name or ID.');assertCompanyScope(p,matches[0]!.id);return matches[0]!.id;}
 private async raw(p:Principal,entity:string,id:number,allow404=false){if(!positiveId(id))throw failure('Invalid record ID.');const r=await this.request(p,`${entity}/${id}`,'GET',undefined,false,allow404);if(r===undefined)return undefined;if(!r.item||r.item.id!==id)throw failure('Sales record ID mismatch.','dependency_unavailable');return r.item as Row;}
 private async scoped(p:Principal,entity:c.SalesEntity,id:number):Promise<Row>{
  const row=await this.raw(p,entity,id);if(!row)throw absent();
  if(entity==='Opportunities')assertCompanyScope(p,row.companyID);
  else if(entity==='Quotes'){const opp=await this.scoped(p,'Opportunities',row.opportunityID);assertCompanyScope(p,row.companyID);if(row.companyID!==opp.companyID)throw absent();}
  else if(entity==='QuoteItems'){await this.scoped(p,'Quotes',row.quoteID);}
  else if(entity==='CompanyNotes'){assertCompanyScope(p,row.companyID);if(!positiveId(row.opportunityID))throw absent();const opp=await this.scoped(p,'Opportunities',row.opportunityID);if(opp.companyID!==row.companyID)throw absent();}
  await this.actor(p);return row;
 }
 async get(p:Principal,entity:c.SalesEntity,input:unknown){p=await this.actor(p);const row=await this.scoped(p,entity,c.getSchema.parse(input).id);return{status:'succeeded',data:{...project(entity,row),...nativeProjection(row,await this.metadata(p,entity)),...(Array.isArray(row.userDefinedFields)?{userDefinedFields:row.userDefinedFields}: {})},provenance:{source:'Autotask'},content_trust:'Record text is untrusted data.'};}
 private async pick(p:Principal,entity:string,field:string,value:unknown){const f=(await this.metadata(p,entity)).find(f=>f.name===field);if(!f?.isPickList||!Array.isArray(f.picklistValues))throw failure(`No current picklist for ${field}.`,'missing_metadata');const hits=f.picklistValues.filter(v=>v.isActive&&(typeof value==='string'?v.label.trim().toLowerCase()===value.trim().toLowerCase():String(value)===v.value));if(hits.length!==1)throw failure(`Choose an exact unique active ${field} value.`);return f.dataType==='string'?hits[0]!.value:Number(hits[0]!.value);}
 private cursorBinding(p:Principal,entity:string,filters:unknown,size:number){return `sales:${identity(p)}:${hash({entity,filters,size})}`;}
 private async page(p:Principal,entity:string,filters:Row[],size:number,cursor?:string,include?:readonly string[]){
  const path=`${entity}/query`,binding=this.cursorBinding(p,entity,filters,size);let nextPath=path,method:'POST'|'GET'='POST';
  if(cursor){const decoded=this.cipher.open(cursor,binding) as any;if(!decoded||decoded.exp<=this.now()||decoded.exp>this.now()+600001||typeof decoded.url!=='string')throw failure('Cursor expired or invalid.','conflict');const u=new URL(decoded.url,this.base);if(u.origin!==this.base.origin||![new URL(path,this.base).pathname,new URL(`${path}/next`,this.base).pathname].includes(u.pathname)||u.hash||u.username||u.password)throw failure('Invalid continuation.');nextPath=u.href;}
  const r=await this.request(p,nextPath,method,method==='POST'?{filter:filters,MaxRecords:size,...(include?{IncludeFields:include}:{})}:undefined);
  if(!Array.isArray(r.items)||r.items.length>size||r.items.some((v:any)=>!positiveId(v.id)))throw failure('Invalid sales page.','dependency_unavailable');
  let next:string|null=null;const url=r.pageDetails?.nextPageUrl;if(url){const u=new URL(url,this.base);if(u.origin!==this.base.origin||![new URL(path,this.base).pathname,new URL(`${path}/next`,this.base).pathname].includes(u.pathname)||u.hash||u.username||u.password)throw failure('Unsafe sales continuation.','dependency_unavailable');next=this.cipher.seal({url:u.href,exp:this.now()+600000},binding);}return{items:r.items as Row[],next};
 }
 async search(p:Principal,entity:c.SalesEntity,input:unknown,countOnly=false){p=await this.actor(p);if(!c.searchSchemaFor(entity,countOnly).safeParse(input).success)throw failure(`Invalid search filters for ${entity}; use the advertised search schema.`);const a=c.searchSchema.parse(input),filters:Row[]=[];let companyId:number|undefined;
  if(a.company!==undefined)companyId=await this.company(p,a.company);
  if(entity==='Opportunities'||entity==='Quotes')filters.push({field:'companyID',op:'in',value:companyId===undefined?p.companyIds:[companyId]});
  if(entity==='CompanyNotes'){if(!a.opportunity_id)throw failure('Opportunity notes require opportunity_id.');const opp=await this.scoped(p,'Opportunities',a.opportunity_id);if(companyId!==undefined&&opp.companyID!==companyId)throw absent();filters.push({field:'opportunityID',op:'eq',value:opp.id},{field:'companyID',op:'eq',value:opp.companyID});}
  if(entity==='QuoteItems'){if(!a.quote_id)throw failure('Quote items require quote_id.');const quote=await this.scoped(p,'Quotes',a.quote_id);if(companyId!==undefined&&quote.companyID!==companyId)throw absent();if(a.opportunity_id&&quote.opportunityID!==a.opportunity_id)throw absent();filters.push({field:'quoteID',op:'eq',value:quote.id});}
  if(entity==='Quotes'&&a.opportunity_id){await this.scoped(p,'Opportunities',a.opportunity_id);filters.push({field:'opportunityID',op:'eq',value:a.opportunity_id});}
  if(entity==='Quotes'&&a.quote_id)filters.push({field:'id',op:'eq',value:a.quote_id});
  if(a.quote_id&&!['Quotes','QuoteItems'].includes(entity))throw failure('quote_id is only for quote items.');
  if(entity==='Opportunities'&&a.opportunity_id)filters.push({field:'id',op:'eq',value:a.opportunity_id});
  if(a.opportunity_id&&!['Opportunities','Quotes','CompanyNotes','QuoteItems'].includes(entity))throw failure('Unsupported opportunity filter.');
  if(entity==='QuoteTemplates'&&companyId!==undefined)throw failure('Templates are tenant-wide; company filtering is unsupported.');
  if(a.text)filters.push({field:entity==='Opportunities'?'title':'name',op:'contains',value:a.text});
  if(a.status!==undefined){if(!['Opportunities','Quotes'].includes(entity))throw failure('Status filter unsupported.');const field=entity==='Quotes'?'approvalStatus':'status';filters.push({field,op:'eq',value:await this.pick(p,entity,field,a.status)});}
  if(a.stage!==undefined){if(entity!=='Opportunities')throw failure('Stage filter only applies to opportunities.');filters.push({field:'stage',op:'eq',value:await this.pick(p,entity,'stage',a.stage)});}
  if(a.owner!==undefined){if(entity!=='Opportunities')throw failure('Owner filter only applies to opportunities.');filters.push({field:'ownerResourceID',op:'eq',value:a.owner==='self'?p.resourceId:a.owner});}
  if(!filters.length)filters.push({field:'id',op:'gte',value:0});
  const meta=await this.metadata(p,entity);for(const filter of filters)if(!meta.some(f=>f.name===filter.field&&f.isQueryable))throw failure(`Field ${filter.field} cannot be queried.`,'missing_metadata');
  if(countOnly){if(!['Opportunities','Quotes'].includes(entity)||a.cursor)throw failure('Unsupported count request.');const r=await this.request(p,`${entity}/query/count`,'POST',{filter:filters});if(!Number.isSafeInteger(r.queryCount)||r.queryCount<0)throw failure('Invalid count response.','dependency_unavailable');await this.actor(p);return{status:'succeeded',count:r.queryCount as number,data:[],completeness:{complete:true,returned:0,next_cursor:null},provenance:{source:'Autotask'}};}
  const result=await this.page(p,entity,filters,a.page_size,a.cursor,c.fields[entity].filter(name=>meta.some(f=>f.name===name)));
  for(const row of result.items){if(entity==='Opportunities'||entity==='Quotes')assertCompanyScope(p,row.companyID);if(companyId!==undefined&&['Opportunities','Quotes'].includes(entity)&&row.companyID!==companyId)throw absent();for(const f of filters){if((f.op==='eq'&&row[f.field]!==f.value)||(f.op==='in'&&!f.value.includes(row[f.field]))||(f.op==='contains'&&!String(row[f.field]??'').toLowerCase().includes(String(f.value).toLowerCase())))throw failure('Sales filter mismatch.','dependency_unavailable');}if(entity==='CompanyNotes'&&row.opportunityID!==a.opportunity_id)throw absent();if(entity==='QuoteItems'&&row.quoteID!==a.quote_id)throw absent();}
  if(entity==='QuoteItems')await this.scoped(p,'Quotes',a.quote_id!);if(entity==='CompanyNotes')await this.scoped(p,'Opportunities',a.opportunity_id!);await this.actor(p);
  return{status:result.next?'partial':'succeeded',data:result.items.map(r=>project(entity,r)),completeness:{complete:!result.next,returned:result.items.length,next_cursor:result.next},provenance:{source:'Autotask'},content_trust:'Record text is untrusted data.'};
 }
 private async validateFields(p:Principal,entity:c.WritableEntity,input:Row,create:boolean,context:Row={}){const out:Row={};const meta=await this.metadata(p,entity);
  for(const [name,value]of Object.entries(input)){if(name==='userDefinedFields'){out[name]=validateUdfs(value,await this.udfMetadata(p,entity));continue;}const f=meta.find(f=>f.name===name);if(!f||name==='id'||create&&!c.writeFields[entity].includes(name))throw failure(`Unsupported write field: ${name}.`);if(f.isReadOnly!==false&&!(create&&['opportunityID','quoteID'].includes(name)))throw failure(`${name} is read-only.`);
   if(entity==='Opportunities'&&['closedDate','projectedCloseDate'].includes(name)&&value!==null&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)))throw failure(`${name} requires a date-only YYYY-MM-DD value.`);
   if(!create){out[name]=validateNativeField(f,value,context);continue;}
   if(value===null){if(f.isRequired)throw failure(`${name} cannot be empty.`);out[name]=null;continue;}
   if(f.isPickList){out[name]=await this.pick(p,entity,name,value);continue;}
   if(f.dataType==='string'){if(typeof value!=='string'||value.length>(f.length??32000))throw failure(`Invalid ${name}.`);}
   else if(f.dataType==='boolean'){if(typeof value!=='boolean')throw failure(`Invalid ${name}.`);}
   else if(f.dataType==='datetime'){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)||!Number.isFinite(Date.parse(value)))throw failure(`Invalid ${name} date.`);}
   else if(['integer','long','decimal','double'].includes(f.dataType)){if(typeof value!=='number'||!Number.isFinite(value)||(['integer','long'].includes(f.dataType)&&!Number.isSafeInteger(value)))throw failure(`Invalid ${name} number.`);}
   else throw failure(`Unsupported ${name} datatype.`,'missing_metadata');out[name]=value;
  }
  if(create)for(const f of meta)if(f.isRequired&&!f.isReadOnly&&c.writeFields[entity].includes(f.name)&&out[f.name]===undefined)throw failure(`Required field missing: ${f.name}.`);
  return out;
 }
 private validateNoteTimingAndAssignment(p:Principal,row:Row){
  const start=Date.parse(row.startDateTime),end=Date.parse(row.endDateTime);
  if(!Number.isFinite(start)||!Number.isFinite(end))throw failure('Local validation: startDateTime and endDateTime must be valid note timestamps. No note write was sent to Autotask.');
  if(end<start)throw failure('Local validation: endDateTime precedes startDateTime. Equal timestamps are allowed. No note write was sent to Autotask.');
  if(row.assignedResourceID!==p.resourceId)throw failure('Local validation: assignedResourceID must match the signed-in employee. Omit assignedResourceID when creating a note to use that employee automatically; do not copy the opportunity owner. No note write was sent to Autotask.');
 }
 private async validateRelationships(p:Principal,entity:c.WritableEntity,row:Row,companyId:number,tokens:string[]=[],allowClosedNote=false){
  assertCompanyScope(p,companyId);
  if(entity==='Opportunities'){
   if(row.probability<0||row.probability>100)throw failure('Probability must be 0–100.');if(row.projectedCloseDate&&row.startDate&&Date.parse(row.projectedCloseDate)<Date.parse(row.startDate))throw failure('Projected close date precedes start date.');
   if(row.ownerResourceID){const owner=await this.raw(p,'Resources',row.ownerResourceID);if(!owner?.isActive||owner.resourceType!=='Employee')throw failure('Opportunity owner must be an active employee.');}
   if(row.useQuoteTotals){if(!positiveId(row.id))throw failure('Create the opportunity and primary quote before enabling quote totals.');const q=await this.page(p,'Quotes',[{field:'opportunityID',op:'eq',value:row.id},{field:'companyID',op:'eq',value:companyId},{field:'primaryQuote',op:'eq',value:true}],1,undefined,['id','companyID','opportunityID']);if(!row.id||!q.items.length)throw failure('Quote totals require an existing primary quote.');}
  }
  if(row.contactID){const contact=await this.raw(p,'Contacts',row.contactID);if(!contact?.isActive)throw failure('Contact must be active.');if(contact.companyID!==companyId){const company=await this.core.adapter.get(p,'Companies',companyId);if(company.parentCompanyID!==contact.companyID)throw failure('Contact belongs to another company.');}}
  if(entity==='Quotes'){
   if(row.proposalProjectID!=null){const project=await this.raw(p,'Projects',row.proposalProjectID);assertCompanyScope(p,project?.companyID);if(project?.companyID!==companyId)throw failure('Proposal project belongs to another company.');}
   const opp=await this.scoped(p,'Opportunities',row.opportunityID);if(opp.companyID!==companyId)throw absent();if(opp.status!==await this.pick(p,'Opportunities','status','Active'))throw failure('Quotes require an active opportunity.');
   if(row.expirationDate&&row.effectiveDate&&Date.parse(row.expirationDate)<Date.parse(row.effectiveDate))throw failure('Expiration precedes effective date.');
   if(row.externalQuoteNumber){const existing=await this.page(p,'Quotes',[{field:'opportunityID',op:'eq',value:row.opportunityID},{field:'externalQuoteNumber',op:'eq',value:row.externalQuoteNumber}],2,undefined,['id']);if(existing.items.some(q=>q.id!==row.id))throw failure('External quote number must be unique within the opportunity.');}
   if(row.primaryQuote===false){const primary=await this.page(p,'Quotes',[{field:'opportunityID',op:'eq',value:row.opportunityID},{field:'primaryQuote',op:'eq',value:true}],2,undefined,['id']);if(!primary.items.some(q=>q.id!==row.id))throw failure('The opportunity must retain a primary quote.');}
   if(row.quoteTemplateID)await this.raw(p,'QuoteTemplates',row.quoteTemplateID);
   for(const field of ['billToLocationID','shipToLocationID','soldToLocationID']){const locationId=row[field];if(!positiveId(locationId))throw failure(`Provide ${field} from a location receipt or an existing quote.`);let authorized=false;let receiptDigest:string|undefined;
    if(row.id){const prior=await this.scoped(p,'Quotes',row.id);authorized=prior[field]===locationId;}
    for(const token of tokens){try{const proof=this.cipher.open(token,`sales-location:${identity(p)}:${companyId}`) as any;if(proof.id===locationId&&proof.expiresAt>this.now()&&typeof proof.digest==='string'){authorized=true;receiptDigest=proof.digest;}}catch{/* Another receipt does not authorize this location. */}}
    if(!authorized)throw failure(`Location ${field} requires a current quote_location_create receipt; existing quote updates may preserve their locations.`);const location=await this.raw(p,'QuoteLocations',locationId);if(receiptDigest&&receiptDigest!==hash(project('QuoteLocations',location!)))throw failure('Quote location changed since its receipt.','conflict');
   }
  }
  if(entity==='QuoteItems'){
   const quote=await this.scoped(p,'Quotes',row.quoteID);if(quote.companyID!==companyId)throw absent();
   const refs=['productID','chargeID','laborID','expenseID','shippingID','serviceID','serviceBundleID'].filter(k=>row[k]!=null);if(refs.length>1)throw failure('A quote line may reference only one item.');
   if(row.quantity<0||['unitDiscount','percentageDiscount','lineDiscount'].some(k=>row[k]<0)||row.percentageDiscount>100)throw failure('Invalid quantity or discount.');
   if(['unitDiscount','percentageDiscount','lineDiscount'].filter(k=>row[k]>0).length>1)throw failure('Only one discount type may be nonzero.');
   const type=row.quoteItemType;const expected:Record<number,string>={1:'productID',2:'chargeID',3:'laborID',4:'expenseID',6:'shippingID',11:'serviceID',12:'serviceBundleID'};if(refs.length&&refs[0]!==expected[type])throw failure('Item reference does not match line type.');
   if([11,12].includes(type)&&!row[expected[type]!])throw failure('Service and bundle lines require their catalog reference.');if(![11,12].includes(type)&&!row.name?.trim())throw failure('Line name is required.');
   const oneTime=await this.pick(p,'QuoteItems','periodType','One-Time');if([2,3,4,6].includes(type)&&row.periodType!==oneTime)throw failure('This line type requires One-Time period.');if(type===1&&(row.periodType===undefined||row.periodType===await this.pick(p,'QuoteItems','periodType','Semi-Annual')))throw failure('Product period must be supplied and cannot be Semi-Annual.');
   if(type===10&&row.lineDiscount)throw failure('Discount lines cannot use lineDiscount.');if(type===13&&['unitCost','unitDiscount','percentageDiscount','lineDiscount'].some(k=>row[k]))throw failure('Setup fees cannot have costs or discounts.');
   const entities:Record<string,string>={productID:'Products',chargeID:'BillingCodes',laborID:'Roles',expenseID:'BillingCodes',shippingID:'ShippingTypes',serviceID:'Services',serviceBundleID:'ServiceBundles'};
   for(const ref of refs){const r=await this.raw(p,entities[ref]!,row[ref]);if(r?.isActive===false)throw failure('Catalog reference is inactive.');}
  }
  if(entity==='CompanyNotes'){const opp=await this.scoped(p,'Opportunities',row.opportunityID);if(opp.companyID!==companyId)throw absent();if(!allowClosedNote&&opp.status!==await this.pick(p,'Opportunities','status','Active'))throw failure('Confirmed API restriction: opportunity notes require an active opportunity. Use opportunity_note_create to prepare an explicit reopen-and-restore approval.');this.validateNoteTimingAndAssignment(p,row);}
 }
 private async verifyPersonInputs(p:Principal,entity:c.WritableEntity,a:Row){
  for(const field of Object.keys(a.fields??{}))if(/(?:ResourceID|ContactID|PersonID)$/.test(field)&&!['ownerResourceID','contactID','assignedResourceID'].includes(field)&&a.fields[field]!=null)throw failure(`Caller-supplied attribution ${field} is unsupported.`);
  if(a.contact_identity&& !a.fields?.contactID)throw failure('contact_identity requires an explicit contactID.');
  if(a.owner_identity&&(entity!=='Opportunities'||!a.fields?.ownerResourceID))throw failure('owner_identity requires an explicit opportunity ownerResourceID.');
  for(const [field,proof,target] of [['contactID','contact_identity','Contacts'],['ownerResourceID','owner_identity','Resources']] as const){
   if(!a.fields?.[field]||(field==='ownerResourceID'&&entity!=='Opportunities'))continue;
   // Explicit IDs need independently supplied intent; defaults remain server-owned.
   if(!a[proof])assertPersonIdentity(undefined,{},field);
   const person=await this.raw(p,target,a.fields[field]);
   assertPersonIdentity(a[proof],{name:`${person?.firstName??''} ${person?.lastName??''}`.trim(),email:person?.emailAddress},field);
  }
 }
 private bind(p:Principal,key:string,digest:string){return `sales-write:${identity(p)}:${key}:${digest}`;}
 private async receipt(p:Principal,r:JournalRecord){await this.actor(p);if(r.actorKey!==actorKey(p)||r.mappingVersion!==p.mappingVersion||r.resourceId!==p.resourceId||r.policyVersion!==p.policyVersion)throw absent();if(typeof r.result?.company_id==='number')assertCompanyScope(p,r.result.company_id);return{status:r.state,operation_id:r.id,...r.result,can_automatically_retry:false};}
 async write(p:Principal,entity:c.WritableEntity,action:'create'|'update'|'delete',input:unknown){
  p=await this.actor(p,true);const a:any=action==='create'?c.createSchema.parse(input):action==='update'?c.updateSchema.parse(input):c.deleteSchema.parse(input);
  if(action==='create'&&((a.opportunity_id!==undefined&&!['Quotes','CompanyNotes'].includes(entity))||(a.quote_id!==undefined&&entity!=='QuoteItems')))throw failure('Parent argument does not apply to this entity.');
  if(action==='delete'&&entity!=='QuoteItems')throw failure('Only quote items support deletion.');if(entity==='QuoteLocations'&&action!=='create')throw failure('Only location creation is supported.');
  if((a.location_tokens?.length||a.location_source_quote_id!==undefined)&&entity!=='Quotes')throw failure('Location arguments apply only to quotes.');
  const operation=`sales_${entity.toLowerCase()}_${action}`,digest=hash({operation,input:a,identity:identity(p)}),prior=await this.core.journal.find(actorKey(p),a.request_key);
  if(prior){if(prior.payloadHash!==digest||prior.operation!==operation)throw failure('Request key belongs to different work.','conflict');return this.receipt(p,prior);}
  let companyId:number,before:Row|undefined,body:Row=structuredClone(a.fields??{});
  if(action!=='create'){
   before=await this.scoped(p,entity as c.SalesEntity,a.id);companyId=entity==='QuoteItems'?(await this.scoped(p,'Quotes',before.quoteID)).companyID:before.companyID;
   if(entity==='QuoteItems'&&action==='delete'&&before.quoteID!==a.quote_id)throw absent();
   if(action==='update'&&Array.isArray(body.userDefinedFields)&&body.userDefinedFields.some((v:Row)=>!Array.isArray(a.expected.userDefinedFields)||!a.expected.userDefinedFields.some((e:Row)=>e.name===v.name)))throw failure('Supply expected values for every changed UDF.');
   const expectedKeys=Object.keys(a.expected);if(action==='update'&&Object.keys(body).some(k=>!expectedKeys.includes(k)))throw failure('Supply the previously read expected value for every changed field.');
   if(action==='delete'&&['name','quantity','unitPrice','quoteItemType'].some(k=>!expectedKeys.includes(k)))throw failure('Deletion requires expected name, quantity, unitPrice and quoteItemType.');
   for(const k of expectedKeys)if(!(k==='userDefinedFields'||(await this.metadata(p,entity)).some(f=>f.name===k))||!fieldMatches(k,before[k],a.expected[k]))throw failure('Record changed or expected field is invalid. Refresh before updating.','conflict');
  }else{
   if(entity==='Quotes'||entity==='CompanyNotes'){if(!a.opportunity_id)throw failure('An existing opportunity_id is required.');const opp=await this.scoped(p,'Opportunities',a.opportunity_id);companyId=opp.companyID;body.opportunityID=opp.id;body.companyID=companyId;}
   else if(entity==='QuoteItems'){if(!a.quote_id)throw failure('quote_id is required.');const quote=await this.scoped(p,'Quotes',a.quote_id);companyId=quote.companyID;body.quoteID=quote.id;}
   else{if(a.company===undefined)throw failure('Company is required.');companyId=await this.company(p,a.company);if(entity==='Opportunities')body.companyID=companyId;}
   if(a.company!==undefined&&await this.company(p,a.company)!==companyId)throw absent();
   for(const f of ['companyID','opportunityID','quoteID'])if(a.fields[f]!==undefined&&a.fields[f]!==body[f])throw failure('Supplied parent conflicts with scoped parent.');
   if(entity==='Opportunities'){body.ownerResourceID??=p.resourceId;body.useQuoteTotals??=false;}
   if(entity==='Quotes')body.approvalStatus??='Not Requested';
   if(entity==='Quotes'&&body.primaryQuote===undefined)throw failure('Supply primaryQuote explicitly for the draft.');
   if(entity==='CompanyNotes')body.assignedResourceID??=p.resourceId;
  }
  if(a.location_source_quote_id!==undefined){const source=await this.scoped(p,'Quotes',a.location_source_quote_id);if(source.companyID!==companyId)throw absent();a.location_tokens=[...(a.location_tokens??[])];for(const f of ['billToLocationID','shipToLocationID','soldToLocationID']){if(body[f]===source[f]){const row=await this.raw(p,'QuoteLocations',source[f]);a.location_tokens.push(this.cipher.seal({id:source[f],digest:hash(project('QuoteLocations',row!)),expiresAt:this.now()+60000},`sales-location:${identity(p)}:${companyId}`));}}}
  if(entity==='CompanyNotes'&&action==='create'){
   const opportunity=await this.scoped(p,'Opportunities',body.opportunityID);
   if(opportunity.status!==await this.pick(p,'Opportunities','status','Active'))return this.closedNoteOffer(p,a,body,opportunity);
  }
  if(action==='update'&&body.companyID!==undefined){assertCompanyScope(p,body.companyID);companyId=body.companyID;}
  if(action!=='delete'){body=await this.validateFields(p,entity,body,action==='create',{...before,...body});if(entity==='QuoteItems'&&[11,12].includes(body.quoteItemType??before?.quoteItemType)&&Object.hasOwn(body,'name'))throw failure('Service and service-bundle names come from the catalog; omit name.');await this.validateRelationships(p,entity,{...before,...body},companyId,a.location_tokens??[]);}
  const parentId=entity==='QuoteItems'?(body.quoteID??before?.quoteID):entity==='CompanyNotes'?companyId:undefined;
  const route=entity==='QuoteItems'?`Quotes/${parentId}/Items${action==='delete'?`/${a.id}`:''}`:entity==='CompanyNotes'?`Companies/${companyId}/Notes`:entity;
  if(action!=='delete')await this.verifyPersonInputs(p,entity,a);
  if(action==='update')body.id=a.id;
  const intent={entity,action,body,expected:a.expected,id:a.id,companyId,parentId,route};
  const reserved=await this.core.journal.reserve({actorKey:actorKey(p),requestKey:a.request_key,payloadHash:digest,operation,mappingVersion:p.mappingVersion,resourceId:p.resourceId,policyVersion:p.policyVersion,encryptedIntent:this.cipher.seal(intent,this.bind(p,a.request_key,digest)),intentExpiresAt:new Date(this.now()+7*86400000).toISOString(),result:{company_id:companyId,entity,action}});
  if(!reserved.created)return this.receipt(p,reserved.record);
  const record=reserved.record;let sent=false,nativeId:number|undefined=action==='create'?undefined:a.id;
  try{
   await this.actor(p,true);
   if(before){const fresh=await this.scoped(p,entity as c.SalesEntity,a.id);for(const k of Object.keys(a.expected))if(!fieldMatches(k,fresh[k],a.expected[k]))throw failure('Record changed before dispatch.','conflict');}
   if(entity==='Quotes'||entity==='CompanyNotes')await this.scoped(p,'Opportunities',body.opportunityID??before!.opportunityID);
   if(entity==='QuoteItems')await this.scoped(p,'Quotes',parentId);
   if(action!=='delete')await this.verifyPersonInputs(p,entity,a);
   await this.core.journal.transition(record.id,'ready','dispatching');sent=true;
   const r=await this.request(p,route,action==='create'?'POST':action==='update'?'PATCH':'DELETE',action==='delete'?undefined:body,true);
   if(action==='create'){nativeId=r.itemId;if(!positiveId(nativeId))throw new AppError('unknown_outcome','Create response has no valid native ID.');}
   const info={company_id:companyId,entity,action,native_id:nativeId};
   await this.core.journal.transition(record.id,'dispatching','accepted_unverified',info);
   return await withReconciliation(async()=>this.verify(p,(await this.core.journal.get(record.id,actorKey(p)))!,intent));
  }catch(e){const definite=e instanceof AppError&&['invalid_input','forbidden','throttled','conflict','identity_mapping_invalid','identity_validation_unavailable','not_found_or_inaccessible'].includes(e.code);const state=sent&&!definite?'unknown_outcome':'failed';try{const current=await this.core.journal.get(record.id,actorKey(p));if(current?.state==='ready'||current?.state==='dispatching')await this.core.journal.transition(record.id,current.state,state,{company_id:companyId,entity,action,...(positiveId(nativeId)?{native_id:nativeId}:{}),error_code:e instanceof AppError?e.code:'dependency_unavailable'});}catch{/* The durable pre-dispatch record prevents automatic replay even if persistence fails. */}
   try{return await this.receipt(p,(await this.core.journal.get(record.id,actorKey(p)))!);}catch{return{status:'unknown_outcome',operation_id:record.id,can_automatically_retry:false};}
  }
 }

 /** A documented CompanyNotes restriction is the only automatic reopen offer.
  * HTTP permission errors, generic validation failures and uncertain uploads never enter here. */
 private async closedNoteOffer(p:Principal,input:Row,body:Row,opportunity:Row){
  const meta=await this.metadata(p,'Opportunities');
  const status=meta.find(f=>f.name==='status')?.picklistValues?.find(v=>v.value===String(opportunity.status)&&v.isActive);
  if(!status||!['Closed','Implemented','Lost'].includes(status.label))throw failure('Opportunity is not active, but its status is not a confirmed closed status. Review manually.','conflict');
  body=await this.validateFields(p,'CompanyNotes',body,true);
  await this.verifyPersonInputs(p,'CompanyNotes',input);
  this.validateNoteTimingAndAssignment(p,body);
  // Both dates must be observed, not inferred from omitted fields. Lost transitions clear lostDate.
  if(!['closedDate','lostDate'].every(k=>Object.hasOwn(opportunity,k)))throw failure('Readback omitted closure dates; automatic restoration cannot be prepared.','missing_metadata');
  let closedDate=opportunity.closedDate;
  if(typeof closedDate==='string'&&/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z?$/.test(closedDate))closedDate=closedDate.slice(0,10);
  if(status.label==='Lost'&&!opportunity.lostDate)throw failure('A lost opportunity must have an observed lostDate to restore safely.','missing_metadata');
  const restore={status:opportunity.status,closedDate,lostDate:opportunity.lostDate};
  await this.validateRelationships(p,'CompanyNotes',body,opportunity.companyID,[],true);
  await this.validateFields(p,'Opportunities',restore,false);
  const expiresAt=this.now()+10*60000;
  const plan={input,body,before:project('Opportunities',opportunity),restore,expiresAt};
  return{status:'confirmation_required' as const,restriction:'opportunity_note_requires_active' as const,opportunity_id:opportunity.id,company_id:opportunity.companyID,original_status:{id:opportunity.status,label:status.label},note:body,restore,expires_at:new Date(expiresAt).toISOString(),confirmation_token:this.cipher.seal(plan,`closed-note:${identity(p)}`),warning:'Ask the user to approve temporarily reopening this opportunity, adding exactly this note, and restoring the original status and closure dates. Status changes can trigger Autotask workflows and history that restoration cannot undo. No writes have occurred.'};
 }
 async confirmClosedNote(p:Principal,input:unknown){
  p=await this.actor(p,true);const a=c.closedNoteConfirmSchema.parse(input);
  const plan=this.cipher.open(a.confirmation_token,`closed-note:${identity(p)}`) as any;
  const base=`cn:${hash({input:plan.input,before:plan.before,identity:identity(p)})}`;
  const keys={reopen:base+':open',note:plan.input.request_key,restore:base+':restore'};
  const steps:Record<string,unknown>={};
  // A second invocation only reports existing receipts; it never resumes an interrupted workflow.
  const existing=await this.core.journal.find(actorKey(p),keys.reopen);
  if(existing){for(const [step,key] of Object.entries(keys)){const r=await this.core.journal.find(actorKey(p),key as string);if(r)steps[step]=await this.receipt(p,r);}return this.closedNoteResult(plan,steps);}
  if(plan.expiresAt<=this.now())throw failure('Approval plan expired. Prepare and approve a fresh plan.','conflict');
  if(await this.core.journal.find(actorKey(p),keys.note))throw failure('The note request key already has a receipt. Reconcile it without reopening.','conflict');
  const before=await this.scoped(p,'Opportunities',plan.before.id);
  if(canonical(project('Opportunities',before))!==canonical(plan.before))throw failure('Opportunity changed after the approval preview. Prepare and approve a fresh plan.','conflict');
  const active=await this.pick(p,'Opportunities','status','Active');
  steps.reopen=await this.write(p,'Opportunities','update',{id:before.id,fields:{status:active},expected:plan.before,request_key:keys.reopen});
  if((steps.reopen as any).status!=='succeeded_verified')return this.closedNoteResult(plan,steps);
  try{
   const opened=await this.scoped(p,'Opportunities',before.id);
   const stable=(row:Row)=>Object.fromEntries(Object.entries(project('Opportunities',row)).filter(([k])=>!['status','closedDate','lostDate','lastActivity'].includes(k)));
   if(opened.status!==active||canonical(stable(opened))!==canonical(stable(before)))throw failure('Opportunity changed during reopening. Inspect before proceeding.','conflict');
   // Validate all note relationships again after reopening. Existing note writes retain their journal.
   const note=await this.write(p,'CompanyNotes','create',plan.input);
   if(note.status==='confirmation_required')throw failure('Opportunity became closed before note dispatch. Inspect the existing workflow; do not reopen again.','conflict');
   steps.note=note;
   if(!['succeeded_verified','failed'].includes((steps.note as any).status))return this.closedNoteResult(plan,steps);
   const current=await this.scoped(p,'Opportunities',before.id);
   if(canonical(stable(current))!==canonical(stable(opened))||current.status!==active||['closedDate','lostDate'].some(k=>canonical(current[k]??null)!==canonical(opened[k]??null)))throw failure('Opportunity changed before restoration. Inspect before changing status.','conflict');
   const expected=project('Opportunities',current);
   steps.restore=await this.write(p,'Opportunities','update',{id:before.id,fields:plan.restore,expected,request_key:keys.restore});
  }catch(e){return{...this.closedNoteResult(plan,steps),error_code:e instanceof AppError?e.code:'dependency_unavailable'};}
  return this.closedNoteResult(plan,steps);
 }
 private closedNoteResult(plan:any,steps:Record<string,unknown>){
  const saved=(steps.note as any)?.status==='succeeded_verified',restored=(steps.restore as any)?.status==='succeeded_verified';
  return{status:saved&&restored?'succeeded_verified':'review_required',opportunity_id:plan.before.id,original_status_id:plan.restore.status,note_verified:saved,restoration_verified:restored,steps,can_automatically_retry:false, guidance:saved&&restored?'Note and original status/dates verified.':'Inspect the listed sales_operation_status receipts and current opportunity before further writes. Do not repeat this note under another key. No automatic resumption is authorized. If reopening succeeded and restoration is unverified, the opportunity may remain active. Restore only after resolving uncertain writes and checking current values; preserve original closure dates from the approval preview. Read-before-write checks are not an atomic upstream lock.'};
 }
 private async verify(p:Principal,record:JournalRecord,intent:any){
  const nativeId=record.result?.native_id;if(!positiveId(nativeId))return this.receipt(p,record);
  assertCompanyScope(p,intent.companyId);if(intent.entity==='QuoteItems')await this.scoped(p,'Quotes',intent.parentId);
  const row=intent.action==='delete'?await this.raw(p,intent.entity,nativeId,true):intent.entity==='QuoteLocations'?await this.raw(p,intent.entity,nativeId):await this.scoped(p,intent.entity,nativeId);
  if(row&&['Opportunities','Quotes','CompanyNotes'].includes(intent.entity)&&row.companyID!==intent.companyId)throw absent();
  if(row&&intent.entity==='QuoteItems'&&row.quoteID!==intent.parentId)throw absent();
  const meta=intent.action==='delete'?[]:await this.metadata(p,intent.entity);
  const matches=intent.action==='delete'?row===undefined:Object.entries(intent.body).filter(([k])=>k!=='id').every(([k,v])=>meta.find(f=>f.name===k)?.dataType==='datetime'&&typeof v==='string'&&typeof row?.[k]==='string'?Date.parse(row[k])===Date.parse(v):fieldMatches(k,row?.[k],v));
  if(!matches)return{...await this.receipt(p,record),verification:'Saved fields did not match or readback was incomplete. Inspect before further changes.'};
  const result={...record.result,verified:true,...(intent.entity==='QuoteLocations'&&row?{location_digest:hash(project('QuoteLocations',row))}:{}),...(row?{attribution:{creatorResourceID:row.creatorResourceID??null,impersonatorCreatorResourceID:row.impersonatorCreatorResourceID??null,lastModifiedBy:row.lastModifiedBy??null}}:{})};
  const saved=await this.core.journal.transition(record.id,record.state,'succeeded_verified',result);
  const receipt=await this.receipt(p,saved);
  if(intent.entity==='QuoteLocations')return{...receipt,location_token:this.cipher.seal({id:nativeId,digest:(result as any).location_digest,expiresAt:this.now()+7*86400000},`sales-location:${identity(p)}:${intent.companyId}`)};
  return receipt;
 }
 async operationStatus(p:Principal,input:unknown){p=await this.actor(p);const {operation_id}=c.receiptSchema.parse(input),r=await this.core.journal.get(operation_id,actorKey(p));if(!r||!r.operation.startsWith('sales_'))throw absent();await this.receipt(p,r);
  if(!r.encryptedIntent||!r.intentExpiresAt||Date.parse(r.intentExpiresAt)<=this.now())return this.receipt(p,r);
  const intent=this.cipher.open(r.encryptedIntent,this.bind(p,r.requestKey,r.payloadHash));
  if(['accepted_unverified','unknown_outcome'].includes(r.state)&&positiveId(r.result?.native_id))return this.verify(p,r,intent);
  if(r.state==='succeeded_verified'&&(intent as any).entity==='QuoteLocations')return{...await this.receipt(p,r),location_token:this.cipher.seal({id:r.result?.native_id,digest:r.result?.location_digest,expiresAt:Date.parse(r.intentExpiresAt)},`sales-location:${identity(p)}:${r.result?.company_id}`)};
  return this.receipt(p,r);
 }
 async compare(p:Principal,input:unknown){const {quote_ids}=c.compareSchema.parse(input),quotes=[];for(const id of quote_ids){const quote=await this.get(p,'Quotes',{id}),items=await this.search(p,'QuoteItems',{quote_id:id,page_size:100});quotes.push({quote:quote.data,items:items.data,completeness:items.completeness});}return{status:quotes.every(q=>q.completeness.complete)?'succeeded':'partial',data:quotes,warnings:['Compare matching period types and customer currencies. No mixed-period total is inferred. Follow each quote item cursor if incomplete.']};}
 async references(p:Principal,input:unknown){p=await this.actor(p);const a=c.referenceSchema.parse(input);if(a.entity==='Contacts'||a.entity==='Resources')assertArea(p,'clients');if(a.entity==='Products')assertArea(p,'inventory');const fields:Record<string,string[]>={Products:['id','name','isActive','unitCost','unitPrice'],Services:['id','name','isActive','unitCost','unitPrice'],ServiceBundles:['id','name','isActive'],Roles:['id','name','isActive'],BillingCodes:['id','name','isActive','billingCodeType'],ShippingTypes:['id','name','isActive'],TaxCategories:['id','name','isActive'],Contacts:['id','companyID','firstName','lastName','isActive'],Resources:['id','firstName','lastName','isActive','resourceType']};
  const filters:Row[]=[];if(a.entity==='Contacts'){if(a.company===undefined)throw failure('Contact lookup requires company.');filters.push({field:'companyID',op:'eq',value:await this.company(p,a.company)});}else if(a.company!==undefined)throw failure('Company filter only applies to contacts.');
  if(a.text)filters.push({field:['Contacts','Resources'].includes(a.entity)?'lastName':'name',op:'contains',value:a.text});if(!filters.length)filters.push({field:'id',op:'gte',value:0});
  const meta=await this.metadata(p,a.entity),selected=fields[a.entity]!.filter(k=>meta.some(f=>f.name===k));const r=await this.page(p,a.entity,filters,a.page_size,a.cursor,selected);for(const item of r.items)if(a.entity==='Contacts'&&item.companyID!==filters[0]!.value)throw absent();await this.actor(p);return{status:r.next?'partial':'succeeded',data:r.items.map(row=>Object.fromEntries(selected.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]))),completeness:{complete:!r.next,returned:r.items.length,next_cursor:r.next}};
 }
}
