import {providerFetch} from '../../execution/src/index.js';
import {fileEvidence,inspectFileUrl,FILE_URL_POLICY_VERSION,attachmentShape} from '../../diagnostics/src/evidence.js';
import { fileMime } from './file-types.js';
import { z } from 'zod';
import { AppError } from '../../contracts/src/index.js';
import { artifactStageSchema } from './contracts.js';
type Input = Pick<z.infer<typeof artifactStageSchema>, 'file'|'content_base64'|'filename'|'mime'>;
const invalid = (message:string) => new AppError('invalid_input',message);
/** File URLs are credentials: never log, persist, or forward application credentials to them. */
export async function resolveUploadInput(input:Input,maxBytes:number,signal:AbortSignal,download:typeof fetch=fetch):Promise<Required<Pick<Input,'filename'|'mime'|'content_base64'>>> {
  await fileEvidence('received',attachmentShape(input));
  if (!!input.file === (input.content_base64 !== undefined)) throw invalid('Supply either a ChatGPT file reference or base64 bytes, not both.');
  if (!input.file) {
    if(!input.filename)throw invalid('Base64 uploads require the original filename.');
    return {filename:input.filename,mime:fileMime(input.filename,input.mime),content_base64:input.content_base64!};
  }
  const file=input.file,validation=inspectFileUrl(file.download_url);
  await fileEvidence('url_validation',{...validation,allowlist_policy_version:FILE_URL_POLICY_VERSION,selected_rule:validation.failed[0]??null,fetch_attempted:false});
  if(validation.failed.length)throw invalid('This file download host is not supported. Use the authenticated console to upload the original file.');
  const url=new URL(file.download_url),started=performance.now();
  let response:Response;
  try { response=await providerFetch('file_download',download)(url,{signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'}); }
  catch(error) { const cause=(error as {cause?:{message?:unknown}})?.cause;await fileEvidence('download',{fetch_attempted:true,duration_ms:performance.now()-started,outcome:signal.aborted?(signal.reason?.name==='TimeoutError'?'timeout':'cancelled'):cause?.message==='unexpected redirect'?'redirect_rejected':'fetch_failed'});throw invalid('The ChatGPT file could not be downloaded. Supply a fresh file reference or use the console.'); }
  const declaredText=response.headers.get('content-length'),declared=declaredText!==null&&/^\d+$/.test(declaredText)?Number(declaredText):undefined;
  const evidence=(outcome:string,size?:number)=>fileEvidence('download',{fetch_attempted:true,duration_ms:performance.now()-started,http_status:response.status,...(declared!==undefined&&Number.isSafeInteger(declared)?{declared_bytes:declared}:{}),...(size!==undefined?{received_bytes:size}:{}),outcome});
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});await evidence(response.ok?'empty_body':response.status>=300&&response.status<400?'redirect_rejected':'http_error');throw invalid('The ChatGPT file link is unavailable. Supply the file again.');}
  if(declared!==undefined&&declared>maxBytes){await response.body.cancel().catch(()=>{});await evidence('declared_oversize',0);throw invalid('The file exceeds the attachment size limit.');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try { while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw invalid('The file exceeds the attachment size limit.');chunks.push(part.value);} }
  catch(error){await reader.cancel().catch(()=>{});await evidence(size>maxBytes?'streamed_oversize':signal.aborted?(signal.reason?.name==='TimeoutError'?'timeout':'cancelled'):'stream_interrupted',size);if(error instanceof AppError)throw error;throw invalid('The file download was interrupted. Supply a fresh file reference.');}
  finally {reader.releaseLock();}
  if(!size){await evidence('empty_body',0);throw invalid('The supplied file is empty.');}
  await evidence('downloaded',size);
  const bytes=Buffer.concat(chunks),filename=input.filename??file.file_name;
  if(!filename)throw invalid('Supply the original filename; the server will not invent or change its extension.');
  const mime=fileMime(filename,input.mime??file.mime_type??response.headers.get('content-type')?.split(';')[0]);
  return {filename,mime,content_base64:bytes.toString('base64')};
}
