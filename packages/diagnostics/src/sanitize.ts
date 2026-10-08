import {AppError} from '../../contracts/src/index.js';
type Row=Record<string,unknown>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const type=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
const textSummary=(v:unknown)=>({type:type(v),present:v!==undefined,...(typeof v==='string'?{blank:v.trim().length===0,length:v.length}:{})});
const textFields=new Set(['title','text','description','resolution','summary','summaryNotes','internal_notes','notes','name','query','search','search_text','filename','file_name','mime','mime_type','content_base64','download_url','file_id','request_key']);
const ids=new Set(['id','ticket_id','company_id','company','opportunity_id','resource_id','note_id','time_entry_id','statusID','queueID','companyID','ticketID','contactID','assignedResourceID','status_id','queue_id']);
const uuidFields=new Set(['operation_id','job_id','artifact_id','report_id','correlation_id']);
const containers=new Set(['ticket','note','time','fields','changes','expected','patch','arguments','input','data','result','verification','steps','completeness']);
const enumValues=new Set(['Canceled','Complete','Complete (With CSAT)','Duplicate','New','In Progress','Customer Note Added','internal','customer','succeeded','failed','partial','accepted_unverified','unknown_outcome','succeeded_verified','verified','queued','running','completed','cancelled','read','write']);
const safeFields=new Set([...textFields,...ids,...uuidFields,'audience','status','state','noteType','publish','hoursWorked','minutes','page_size','limit','offset','returned','complete','next_cursor','warnings','operation','kind','resolution','expected']);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER;
/** Versioned allowlist. Unknown keys/values never become log strings, even omission paths. */
function summarize(value:unknown,depth=0):unknown{
 if(depth>4)return{omitted:true,reason:'depth_bound'};
 if(Array.isArray(value))return{type:'array',count:value.length,omitted:true};
 if(!object(value))return textSummary(value);
 const result:Row={};let omitted=0;
 for(const key of Object.keys(value).slice(0,128)){
  const v=value[key];
  if(textFields.has(key)){result[key]=textSummary(v);continue;}
  if(ids.has(key)){result[key]=number(v)&&v>=0?v:typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)?v:object(v)?summarize(v,depth+1):textSummary(v);continue;}
  if(uuidFields.has(key)){result[key]=typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)?v:textSummary(v);continue;}
  if(containers.has(key)){result[key]=summarize(v,depth+1);continue;}
  if(['status','state','audience'].includes(key)){result[key]=typeof v==='string'&&enumValues.has(v)?v:object(v)&&typeof v.name==='string'&&enumValues.has(v.name)?{name:v.name,...(typeof v.kind==='string'&&['name','id'].includes(v.kind)?{kind:v.kind}:{})}:object(v)?summarize(v,depth+1):textSummary(v);continue;}
  if(['noteType','publish','hoursWorked','minutes','page_size','limit','offset','returned'].includes(key)&&number(v)){result[key]=v;continue;}
  if(key==='complete'&&typeof v==='boolean'){result[key]=v;continue;}
  if(key==='next_cursor'){result.has_continuation=typeof v==='string'&&v.length>0;continue;}
  if(key==='warnings'&&Array.isArray(v)){result.warning_count=v.length;continue;}
  omitted++;
 }
 if(Object.keys(value).length>128)omitted+=Object.keys(value).length-128;
 if(omitted)result.omitted_field_count=omitted;
 return result;
}
export function attachmentShape(input:unknown){try{const a=object(input)?input:{},file=a.file,hasFile=Object.hasOwn(a,'file'),hasBase64=Object.hasOwn(a,'content_base64');const shape=hasFile&&hasBase64?'conflicting_sources':typeof file==='string'?'bare_file_id':object(file)?'file_object':hasBase64?'base64':!hasFile?'missing':'invalid_file_object';const validation_codes:string[]=[];if(shape==='conflicting_sources'||shape==='bare_file_id'||shape==='invalid_file_object')validation_codes.push(shape);if(shape==='missing')validation_codes.push('missing_file_source');if(object(file)&&typeof file.file_id!=='string')validation_codes.push('missing_file_id');if(object(file)&&typeof file.download_url!=='string')validation_codes.push(file.download_url===undefined?'url_missing':'url_wrong_type');return{source_kind:shape,validation_codes,file_type:type(file),properties:Object.fromEntries(['download_url','file_id','file_name','mime_type'].map(key=>[key,{present:object(file)&&Object.hasOwn(file,key),type:type(object(file)?file[key]:undefined)}]))};}catch{return{source_kind:'invalid_file_object',summary_failed:true};}}
export function summarizeArguments(tool:string,input:unknown):Row{try{const changes=object(input)&&object(input.changes)?input.changes:object(input)&&object(input.fields)?input.fields:undefined;return{redaction_version:1,summary:summarize(input),...(changes?{requested_change_fields:reviewedFieldNames(changes),field_presence:Object.fromEntries(['title','description','resolution'].map(k=>[k,textSummary(changes[k])]))}:{}),...(['at_file_stage','opportunity_file_stage'].includes(tool)?{attachment:attachmentShape(input)}:{}),omitted_content:true};}catch{return{redaction_version:1,omitted_content:true,summary_failed:true};}}
export function summarizeResult(toolOrValue:unknown,result?:unknown):Row{const value=arguments.length>1?result:toolOrValue;try{return{redaction_version:1,summary:summarize(value),omitted_content:true};}catch{return{redaction_version:1,omitted_content:true,summary_failed:true};}}
const codes=new Set(['invalid_input','unauthenticated','forbidden','not_found_or_inaccessible','unsupported_operation','missing_metadata','precondition_failed','conflict','throttled','dependency_unavailable','unknown_outcome','identity_mapping_invalid','identity_validation_unavailable','impersonation_not_qualified']);
export function sanitizeError(error:unknown):Row{const e=error instanceof AppError?error:undefined,code=e&&codes.has(e.code)?e.code:'internal_error',upstream=e?.upstreamFailure;let origin='internal';if(upstream)origin='upstream';else if(code==='invalid_input')origin='schema';else if(code==='unauthenticated')origin='authentication';else if(['forbidden','identity_mapping_invalid','identity_validation_unavailable','impersonation_not_qualified'].includes(code))origin='authorization';else if(['precondition_failed','missing_metadata','conflict','not_found_or_inaccessible','unsupported_operation'].includes(code))origin='local_preflight';else if(code==='dependency_unavailable'||code==='throttled'||code==='unknown_outcome')origin='unknown';return{code,origin,...(upstream&&Number.isInteger(upstream.http_status)&&upstream.http_status!>=100&&upstream.http_status!<=599?{http_status:upstream.http_status}:{}),message_omitted:true};}
export function reviewedFieldNames(value:unknown){return object(value)?Object.keys(value).filter(key=>safeFields.has(key)).slice(0,64):[];}

export const summarizeError=sanitizeError;
export function safeToolName(value:unknown){return typeof value==='string'&&/^[a-z0-9_]{1,100}$/.test(value)?value:'<invalid>';}
