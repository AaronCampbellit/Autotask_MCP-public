import {diagnosticToolName} from './diagnostics.js';
import {summarizeArguments,summarizeResult,summarizeError} from '../../../packages/diagnostics/src/sanitize.js';
import type {DiagnosticEvent} from '../../../packages/diagnostics/src/contracts.js';
import type {DurableReadWorker} from '../../../packages/durable-read-jobs/src/index.js';
import {createExecution,withExecution} from '../../../packages/execution/src/index.js';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../packages/contracts/src/index.js';
import type { ToolRuntime } from './tool-runtime.js';

/** Bounded in-process executor. PostgreSQL owns leases; restart never replays a
 * dispatched job whose outcome was not durably linked to its operation journal. */
export class JobWorker {
  private timer?:ReturnType<typeof setInterval>;
  private stopping=false;
  private readonly active=new Set<Promise<boolean>>();
  private readonly id=`worker-${randomUUID()}`;
  private lastCleanup=0;
  constructor(private readonly runtime:ToolRuntime,private readonly now:()=>number=Date.now,private readonly readWorker?:DurableReadWorker){}
  start(){this.readWorker?.start();if(this.timer)return;this.stopping=false;this.timer=setInterval(()=>{if(!this.stopping&&this.active.size<2){const task=this.tick();this.active.add(task);void task.catch(()=>false).finally(()=>this.active.delete(task));}},1000);this.timer.unref();}
  async tick():Promise<boolean>{
    if(this.stopping)return false;
    const {control,core,execution}=this.runtime.options;
    if(this.runtime.options.artifacts&&this.now()-this.lastCleanup>=60_000){this.lastCleanup=this.now();try{await this.runtime.options.artifacts.cleanupExpired();}catch{/* Expired artifacts remain inaccessible; retry retention on the next maintenance cycle. */}}
    const lease=await control.claim(this.id,300_000);if(!lease)return false;
    let dispatched=false;
    const diagnostics=this.runtime.options.diagnostics,context=createExecution(new AbortController().signal,{timeoutMs:120000});context.operation=lease.job.operation;
    let diagnostic:DiagnosticEvent|undefined,diagnosticFinished=false;const started=performance.now();
    const finishDiagnostic=async(result:unknown,error?:unknown)=>{if(!diagnostics||!diagnostic||diagnosticFinished)return;diagnosticFinished=true;const safe=error?summarizeError(error):undefined;const value=result as {status?:string;operation_id?:string}|undefined;try{await diagnostics.finish(diagnostic,{outcome:error?(context.effectStarted?'unknown_outcome':'rejected'):value?.status==='succeeded_verified'?'succeeded':value?.status==='accepted_unverified'?'accepted_unverified':value?.status==='partial'?'partial':value?.status==='failed'?'failed':'unknown_outcome',durationMs:performance.now()-started,jobId:lease.job.id,operationId:value?.operation_id,errorOrigin:safe?.origin as string|undefined,errorCode:safe?.code as string|undefined,details:{result:summarizeResult(result),...(safe?{error:safe}:{}),effect_dispatched:context.effectStarted}});}catch{diagnostics.markFailure();}};
    try{
      if(diagnostics){diagnostic=await diagnostics.start({traceId:context.traceId,tool:diagnosticToolName(lease.job.operation),source:'background_job',tenantId:lease.job.tenantId,actorId:lease.job.actorKey.slice(lease.job.tenantId.length+1),jobId:lease.job.id,details:{identity_source:'persisted_job_submission'}});context.diagnosticCallId=diagnostic.callId;context.diagnosticFailure=()=>diagnostics.markFailure();context.diagnosticEvidence=async(type,details)=>{await diagnostics.record({traceId:context.traceId,callId:context.diagnosticCallId,tenantId:lease.job.tenantId,actorId:lease.job.actorKey.slice(lease.job.tenantId.length+1),type,details});};}

      const actor={tenantId:lease.job.tenantId,objectId:lease.job.actorKey.slice(lease.job.tenantId.length+1)};
      const principal=await control.store.getMember(actor);if(!principal)throw new AppError('identity_mapping_invalid','Job employee is unavailable.');
      const guard=async()=>{const fresh=await control.store.getJob(lease.job.id,lease.job.actorKey);if(this.stopping||!fresh||fresh.state!=='running'||fresh.fence!==lease.fence||fresh.leaseToken!==lease.token||fresh.cancelRequested||Date.parse(fresh.leaseExpiresAt??'')<=this.now())throw new AppError('precondition_failed','The job lease or cancellation state prevents further dispatch.');};
      await guard();const begun=await control.beginDispatch(lease);dispatched=true;
      if(diagnostics&&diagnostic)await diagnostics.record({traceId:context.traceId,callId:diagnostic.callId,tenantId:principal.tenantId,actorId:principal.objectId,type:'job.arguments',details:summarizeArguments(begun.job.operation,begun.payload)});
      const result=await withExecution(context,()=>execution.withGuard(guard,()=>this.runtime.invokeJob(principal,begun.job.operation,begun.payload,begun.job.id)));
      await finishDiagnostic(result);
      const record=await core.journal.find(lease.job.actorKey,`job:${lease.job.id}`);
      const state=record?.state==='succeeded_verified'?'succeeded':record?.state==='failed'?'failed':'uncertain';
      await control.finish(lease,state,record?.id);
    }catch(error){
      await finishDiagnostic(undefined,error);
      // The persisted checkpoint decides uncertainty. An ambiguous commit is
      // inspected before any attempt to finalize, and never causes redispatch.
      try{const current=await control.store.getJob(lease.job.id,lease.job.actorKey);dispatched=dispatched||current?.dispatched===true;const record=await core.journal.find(lease.job.actorKey,`job:${lease.job.id}`);await control.finish(lease,record?.state==='succeeded_verified'?'succeeded':record?.state==='failed'||!dispatched?'failed':'uncertain',record?.id);}catch{/* Expired fence is left for durable claim recovery. */}
    }
    return true;
  }
  async close(){await this.readWorker?.close();this.stopping=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;await Promise.allSettled([...this.active]);}
}
