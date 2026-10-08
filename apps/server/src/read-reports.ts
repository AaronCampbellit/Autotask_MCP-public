import {sanitizeError} from '../../../packages/diagnostics/src/sanitize.js';
import {DurableReadReports,DurableReadWorker} from '../../../packages/durable-read-jobs/src/index.js';
import type {ReadJobStore} from '../../../packages/durable-read-jobs/src/store.js';
import type {IntentCipher} from '../../../packages/storage/src/intent-cipher.js';
import {AppError,type PrincipalStore} from '../../../packages/contracts/src/index.js';
import {createExecution,currentExecution,withExecution} from '../../../packages/execution/src/index.js';
import type {ToolRuntime} from './tool-runtime.js';
export function createReadReports(store:ReadJobStore,cipher:IntentCipher,principals:PrincipalStore,runtime:()=>ToolRuntime){
 const reports=new DurableReadReports(store,cipher,principals,async(p,input,execution)=>withExecution(currentExecution()??createExecution(execution.signal),()=>runtime().options.execution.withGuard(async()=>{await execution.guard();},async()=>{
  const sections:Record<string,unknown>={},limitations:string[]=[];let complete=true;
  const invoke=async(name:string,args:unknown)=>{await execution.guard();return await runtime().invoke(p,name,args) as any;};
  for(const section of input.sections){
   try{
    let result:any;
    if(section==='tickets')result=await invoke('ticket_search',{company:{kind:'id',id:input.company_id},page_size:Math.min(input.max_items,100),open_only:true});
    else if(section==='documentation')result=await invoke('itg_document_search',{company:input.company_id,page_size:Math.min(input.max_items,100),all_folders:true});
    else{
     const sites=await invoke('rmm_site_list',{}),selected=sites.data.filter((s:any)=>s.company_id===input.company_id),pages=[];let remaining=input.max_items;
     for(const site of selected){if(remaining<=0)break;const page=await invoke(section==='devices'?'rmm_device_search':'rmm_site_alert_list',{site_uid:site.uid,page_size:Math.min(remaining,20),...(section==='alerts'?{state:'open'}:{})});pages.push({site_uid:site.uid,result:page});remaining-=section==='devices'?(page.data?.devices?.length??0):(page.data?.alerts?.length??0);if(pages.length>=10)break;}
     result={pages,completeness:{complete:selected.length>0&&pages.length===selected.length&&pages.every(v=>v.result.completeness?.complete===true)},limitations:['At most ten mapped sites and one page per site; use returned source continuations.']};
    }
    sections[section]=result;if(result.completeness?.complete!==true)complete=false;
   }catch(error){if(!(error instanceof AppError)||!['unsupported_operation','dependency_unavailable','throttled','precondition_failed','missing_metadata','impersonation_not_qualified'].includes(error.code))throw error;complete=false;sections[section]={status:'unavailable',error_code:error.code};limitations.push(`${section} could not be fully retrieved.`);}
  }
  await execution.guard();const result={status:complete?'succeeded':'partial',scope:{company_id:input.company_id},sections,completeness:{complete},limitations,observed_at:new Date().toISOString(),atomic_snapshot:false};if(Buffer.byteLength(JSON.stringify(result))>100_000)throw new AppError('precondition_failed','Report exceeds the result bound; select fewer sections or records.');return result;
 })));
 return{reports,readWorker:new DurableReadWorker(reports,30000,120000,async(job,signal,run)=>{
   const diagnostics=runtime().options.diagnostics;if(!diagnostics)return run();
   const context=createExecution(signal);context.operation='client_health_report_execute';
   return withExecution(context,async()=>{
    const start=await diagnostics.start({traceId:context.traceId,tenantId:job.tenant,actorId:job.actor,tool:'client_health_report_execute',source:'background_read_job',jobId:job.id,details:{attempt:job.attempts}});
    context.diagnosticCallId=start.callId;context.diagnosticFailure=()=>diagnostics.markFailure();context.diagnosticEvidence=async(type,details)=>{await diagnostics.record({traceId:context.traceId,callId:currentExecution()?.diagnosticCallId??start.callId,tenantId:job.tenant,actorId:job.actor,type,details});};
    try{const result=await run();const summary=cipher.open(result,`read-report:v1:${job.tenant}:${job.actor}:${job.id}:result`) as {status?:string};try{await diagnostics.finish(start,{outcome:summary.status==='partial'?'partial':'succeeded',jobId:job.id,details:{encrypted_result_stored:true}});}catch{diagnostics.markFailure();}return result;}
    catch(error){const safe=sanitizeError(error);try{await diagnostics.finish(start,{outcome:'failed',jobId:job.id,errorCode:String(safe.code),errorOrigin:String(safe.origin),details:{error:safe}});}catch{diagnostics.markFailure();}throw error;}
   });
  })};
}
