import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../contracts/src/index.js';
export interface TraceEvent {trace_id:string;span_id:string;parent_span_id?:string;stage:string;operation?:string;provider?:string;method?:string;route?:string;http_status?:number;duration_ms:number;outcome:'succeeded'|'failed';at:string}
export interface ExecutionContext {reconciliationDeadline?:number;reconciling?:boolean;lastProviderAttemptId?:string;providerAttempts?:Map<string,number>;completeDiagnostic?:(result?:unknown,error?:unknown)=>Promise<void>;diagnosticCallId?:string;diagnosticFailure?:()=>void;diagnosticEvidence?:(kind:string,details:Record<string,unknown>)=>Promise<void>;interaction?:{protocol:string;capabilities:unknown;requestState?:unknown;inputResponses?:Record<string,unknown>;enabled:boolean};traceId:string;spanId:string;signal:AbortSignal;deadline:number;operation?:string;effectStarted:boolean;events:TraceEvent[];sink?:(event:TraceEvent)=>void;progress?:(completed:number,message:string)=>Promise<void>;progressCount:number;active:Set<Promise<unknown>>}
const storage=new AsyncLocalStorage<ExecutionContext>();
export function currentExecution(){return storage.getStore();}
export function createExecution(signal:AbortSignal,options:{timeoutMs?:number;sink?:(event:TraceEvent)=>void}={}):ExecutionContext{const timeout=options.timeoutMs??120000;return{traceId:randomUUID(),spanId:randomUUID(),signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),deadline:Date.now()+timeout,effectStarted:false,events:[],sink:options.sink,progressCount:0,active:new Set()};}
export function withExecution<T>(context:ExecutionContext,run:()=>T):T{return storage.run(context,run);}
export function assertExecutionActive(){const c=currentExecution();if(c&&(c.signal.aborted||Date.now()>=c.deadline))throw new AppError('precondition_failed','Execution was cancelled or its deadline expired before further dispatch.');}
/** A bounded read-only recovery scope, available only after a native effect started.
 * All scopes in one execution share the first recovery deadline; nesting cannot extend it. */
export function withReconciliation<T>(run:()=>T,maxMs=30000):T {
 const parent=currentExecution();if(!parent?.effectStarted)return run();
 const duration=Math.max(1,Math.min(30000,Number.isFinite(maxMs)?maxMs:30000));
 const deadline=parent.reconciliationDeadline??=Date.now()+duration;
 const child={...parent,reconciling:true,deadline,signal:AbortSignal.timeout(Math.max(0,deadline-Date.now()))};
 for(const key of ['progressCount','lastProviderAttemptId','providerAttempts'] as const)Object.defineProperty(child,key,{get:()=>parent[key],set:value=>{(parent as any)[key]=value;}});
 return withExecution(child,()=>{assertExecutionActive();return run();});
}
export async function traceStage<T>(stage:string,run:()=>Promise<T>,details:Partial<Pick<TraceEvent,'provider'|'method'|'route'|'http_status'>>={}):Promise<T>{const c=currentExecution();if(!c)return run();const start=performance.now();let outcome:TraceEvent['outcome']='succeeded';try{return await run();}catch(error){outcome='failed';throw error;}finally{const event:TraceEvent={trace_id:c.traceId,span_id:randomUUID(),parent_span_id:c.spanId,stage,operation:c.operation,...details,duration_ms:performance.now()-start,outcome:details.http_status&&details.http_status>=400?'failed':outcome,at:new Date().toISOString()};if(c.events.length<2048)c.events.push(event);try{c.sink?.(event);}catch{/* Measurement observers never change business outcomes. */}}}
export async function reportProgress(message:string){const c=currentExecution();if(!c?.progress||c.signal.aborted)return;try{await c.progress(++c.progressCount,message.slice(0,160));}catch{/* A disconnected client does not alter accepted effects. */}}
/** Only reviewed static route segments are retained; native identifiers and query strings never enter traces. */
export function providerRoute(input:RequestInfo|URL){try{const url=new URL(input instanceof Request?input.url:String(input));const known=new Set(['atservicesrest','v1.0','api','v2','auth','oauth','token','query','count','relationships','documents','sections','publish','organizations','configurations','contacts','flexible_assets','flexible_asset_types','flexible_asset_fields','document_images','checklists','account','sites','site','devices','device','alerts','alert','open','resolved','audit','software','patches','job','results','stdout','stderr','quickjob','udf','warranty','move','Tickets','TicketSecondaryResources','TaskSecondaryResources','TicketChecklistItems','TicketTagAssociations','TagAssociations','Tags','TicketChecklistLibraries','ChecklistLibraries','ServiceCalls','ServiceCallTickets','ServiceCallTicketResources','Companies','TicketNotes','TimeEntries','BillingItemApprovalLevels','ResourceTimeOffApprovers','TimeOffRequests','Approve','Reject','Contacts','ConfigurationItems','Resources','fields']);return url.pathname.split('/').map(s=>!s?'':known.has(s)?s:':id').join('/');}catch{return 'unclassified';}}
/** Wrap every actual provider attempt; never capture headers, queries, bodies or native error text. */
export function providerFetch(provider:string,fetcher:typeof fetch=fetch):typeof fetch{return async(input,init)=>{
 const c=currentExecution();assertExecutionActive();
 const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase(),url=new URL(input instanceof Request?input.url:String(input));
 // Autotask's GET TimeOffRequests/{id}/Approve mutates the request.
 const read=(method==='GET'&&!/\/TimeOffRequests\/\d+\/Approve\/?$/.test(url.pathname))||method==='HEAD'||(method==='POST'&&(/\/query\/?$/.test(url.pathname)||url.pathname==='/auth/oauth/token'||/\/oauth2\/v2\.0\/token$/.test(url.pathname)));
 const route=provider==='file_download'?'/download':providerRoute(input),providerName=/^[a-z][a-z0-9_]{0,39}$/.test(provider)?provider:'unknown',safeMethod=['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'].includes(method)?method:'OTHER';
 const attemptId=randomUUID(),started=performance.now(),counterKey=providerName+':'+safeMethod+':'+route;
 if(c&&!c.providerAttempts)c.providerAttempts=new Map();const attemptNumber=(c?.providerAttempts?.get(counterKey)??0)+1;c?.providerAttempts?.set(counterKey,attemptNumber);
 const evidence={attempt_id:attemptId,provider:providerName,method:safeMethod,route,attempt_number:attemptNumber,read_only:read};
 // A missing durable attempt start prevents new dispatch. Mandatory reconciliation
 // after an accepted mutation must continue even when diagnostic storage fails.
 if(c?.diagnosticEvidence){try{await c.diagnosticEvidence('provider_attempt',{...evidence,phase:'started',dispatch_state:'pending'});}catch{c.diagnosticFailure?.();if(!c.reconciling||!read)throw new AppError('dependency_unavailable','Diagnostic storage prevents provider dispatch.');}}
 if(c)c.lastProviderAttemptId=attemptId;
 if(c&&!read){if(c.reconciling)throw new AppError('precondition_failed','Recovery scopes cannot dispatch mutations.');if(c.signal.aborted){await diagnosticEvidence('provider_attempt',{...evidence,phase:'finished',fetch_attempted:false,outcome:'cancelled',duration_ms:performance.now()-started});throw new AppError('precondition_failed','Execution was cancelled before provider mutation.');}c.effectStarted=true;}
 const originalSignal=init?.signal??(input instanceof Request?input.signal:undefined);
 const signal=c&&read?AbortSignal.any([c.signal,...(originalSignal?[originalSignal]:[])]):originalSignal;
 const details:Partial<Pick<TraceEvent,'provider'|'method'|'route'|'http_status'>>={provider:providerName,method:safeMethod,route};
 try{const result=await traceStage('provider',async()=>{const response=await fetcher(input,{...init,...(signal?{signal}:{})});details.http_status=response.status;return response;},details);
 if(c)c.lastProviderAttemptId=attemptId;await diagnosticEvidence('provider_attempt',{...evidence,phase:'finished',fetch_attempted:true,http_status:result.status,duration_ms:performance.now()-started,outcome:result.ok?'succeeded':'http_error'});
 await reportProgress('Provider evidence received');return result;
 }catch(error){if(c)c.lastProviderAttemptId=attemptId;await diagnosticEvidence('provider_attempt',{...evidence,phase:'finished',fetch_attempted:true,duration_ms:performance.now()-started,outcome:signal?.aborted?'interrupted':'transport_error'});throw error;}
 };}
/** Child logical calls share effect/cancellation lifetime without overwriting parent identity. */
export function childExecution(parent:ExecutionContext,operation:string):ExecutionContext{const child={...parent,operation,spanId:randomUUID(),completeDiagnostic:undefined,diagnosticCallId:undefined};if(!parent.providerAttempts)parent.providerAttempts=new Map();child.providerAttempts=parent.providerAttempts;for(const key of ['effectStarted','progressCount','lastProviderAttemptId','reconciliationDeadline'] as const)Object.defineProperty(child,key,{enumerable:true,configurable:true,get:()=>parent[key],set:(value)=>{(parent as any)[key]=value;}});return child;}

/** Evidence payloads must be pre-sanitized by their reviewed caller. */
export async function diagnosticEvidence(kind:string,details:Record<string,unknown>){const c=currentExecution();try{await c?.diagnosticEvidence?.(kind,details);}catch{c?.diagnosticFailure?.();}}
