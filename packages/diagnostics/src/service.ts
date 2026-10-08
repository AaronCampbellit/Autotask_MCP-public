import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError,actorKey,type Principal,type PrincipalStore} from '../../contracts/src/index.js';
import {reauthorize,assertCapability} from '../../policy/src/index.js';
import {DiagnosticCipher,MAX_EVENT_BYTES,RETENTION_MS,diagnosticEventSchema,type DiagnosticEvent,type DiagnosticCall,type DiagnosticOutcome,type DiagnosticQuery,type DiagnosticStore,type Row} from './contracts.js';
import {MemoryDiagnosticStore,matches,newerCall} from './store.js';
import {DiagnosticSpool} from './spool.js';
const querySchema=z.object({from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),actorId:z.string().max(256).optional(),tool:z.string().max(256).optional(),outcome:z.string().max(80).optional(),errorOrigin:z.string().max(80).optional(),errorCode:z.string().max(100).optional(),recordId:z.string().max(128).optional(),operationId:z.string().max(128).optional(),jobId:z.string().max(128).optional(),traceId:z.string().max(128).optional(),serverRelease:z.string().max(128).optional(),limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(8000).optional()}).strict();
export interface DiagnosticStart {recordId?:string;traceId?:string;callId?:string;parentId?:string;requestId?:string;tenantId?:string;actorId?:string;resourceId?:number;tool:string;requestedTool?:string;source?:string;serverRelease?:string;metadataDigest?:string;details?:Row;jobId?:string;operationId?:string}
export class DurableDiagnostics {
 private healthy=true;private databaseAvailable=true;private failures=0;private expired=0;private cleanupAt:string|null=null;private pending=new Map<string,DiagnosticEvent>();private maintenanceRunning?:Promise<void>;private timer?:ReturnType<typeof setInterval>;
 private now:()=>number;
 constructor(readonly store:DiagnosticStore,readonly spool:DiagnosticSpool,readonly options:{instanceId:string;serverRelease:string;metadataDigest?:string;principals?:PrincipalStore;cipher:DiagnosticCipher;now?:()=>number}){this.now=options.now??Date.now;}
 ready(){return this.healthy;}
 markFailure(){this.healthy=false;this.failures++;}
 async initialize(){await this.spool.initialize();await this.maintenance();}
 close(){this.stopWorker();}
 private normalize(input:Partial<DiagnosticEvent>&{type:string;details?:Row}):DiagnosticEvent{const occurredAt=input.occurredAt??new Date(this.now()).toISOString(),event={...input,eventId:input.eventId??randomUUID(),traceId:input.traceId??randomUUID(),instanceId:input.instanceId??this.options.instanceId,occurredAt,expiresAt:new Date(Date.parse(occurredAt)+RETENTION_MS).toISOString(),schemaVersion:1 as const,details:input.details??{}};if(Buffer.byteLength(JSON.stringify(event))>MAX_EVENT_BYTES)event.details={omitted:true,reason:'summary_exceeds_bound'};return diagnosticEventSchema.parse(event) as DiagnosticEvent;}
 async record(input:Partial<DiagnosticEvent>&{type:string;details?:Row},terminal=false){const event=this.normalize(input);try{await this.store.append(event);this.databaseAvailable=true;return event;}catch{this.databaseAvailable=false;}try{await this.spool.append(event,terminal);return event;}catch{this.healthy=false;this.failures++;this.pending.set(event.eventId,event);throw new AppError('dependency_unavailable','Diagnostic durable storage is unavailable.');}}
 async start(input:DiagnosticStart){if(!this.healthy)throw new AppError('dependency_unavailable','Diagnostic durable storage is unavailable.');const at=new Date(this.now()).toISOString(),call:DiagnosticCall={callId:input.callId??randomUUID(),traceId:input.traceId??randomUUID(),...(input.parentId?{parentId:input.parentId}:{}),...(input.requestId?{requestId:input.requestId}:{}),tenantId:input.tenantId,actorId:input.actorId,resourceId:input.resourceId,recordId:input.recordId,tool:input.tool.slice(0,256),requestedTool:input.requestedTool?.slice(0,256),source:input.source??'mcp',startedAt:at,lifecycle:'started',serverRelease:input.serverRelease??this.options.serverRelease,metadataDigest:input.metadataDigest??this.options.metadataDigest,instanceId:this.options.instanceId,expiresAt:new Date(this.now()+RETENTION_MS).toISOString(),jobId:input.jobId,operationId:input.operationId};
  // Reserve fallback terminal headroom before admitting an execution, even while PostgreSQL is healthy.
  try{if(!(await this.spool.capacity()).available)throw Error();}catch{this.healthy=false;this.failures++;throw new AppError('dependency_unavailable','Diagnostic terminal headroom is unavailable.');}
  return this.record({type:'call.started',traceId:call.traceId,callId:call.callId,parentId:call.parentId,tenantId:call.tenantId,actorId:call.actorId,occurredAt:at,call,details:input.details??{}});
 }
 async finish(start:DiagnosticEvent,input:{outcome:DiagnosticOutcome;errorOrigin?:string;errorCode?:string;durationMs?:number;details?:Row;operationId?:string;jobId?:string;recordId?:string;interrupted?:boolean}){if(!start.call)throw new Error('Missing diagnostic start.');const {details,interrupted,...metadata}=input,call:DiagnosticCall={...start.call,...metadata,endedAt:new Date(this.now()).toISOString(),lifecycle:interrupted?'interrupted':'finished'};return this.record({type:interrupted?'call.interrupted':'call.finished',traceId:call.traceId,callId:call.callId,parentId:call.parentId,tenantId:call.tenantId,actorId:call.actorId,call,details:details??{}},true);}
 async health():Promise<Row>{let spool:Row;try{spool=await this.spool.health(this.now());}catch{spool={available:false,unavailable:true};}return{...spool,ready:this.healthy,databaseAvailable:this.databaseAvailable,captureFailures:this.failures,pendingFailedEvents:this.pending.size,expiredEvents:this.expired,cleanupAt:this.cleanupAt,cleanupLagMs:this.cleanupAt?this.now()-Date.parse(this.cleanupAt):null};}
 async maintenance(){if(this.maintenanceRunning)return this.maintenanceRunning;this.maintenanceRunning=(async()=>{try{await this.spool.initialize();const recovery=await this.spool.recover(this.now());this.expired+=recovery.expired;await this.store.ping();await this.store.heartbeat(this.options.instanceId,this.now());this.databaseAvailable=true;
   for(const [id,event]of this.pending){if(Date.parse(event.expiresAt)<=this.now()){this.pending.delete(id);this.expired++;}else{await this.store.append(event);this.pending.delete(id);}}
   const drained=await this.spool.drain(this.store,this.now());this.expired+=drained.expired;
   // Other instances are abandoned only after their heartbeat lease has expired.
   for(const call of await this.store.abandoned(this.options.instanceId,new Date(this.now()-120000).toISOString(),this.now()))await this.finish({eventId:randomUUID(),traceId:call.traceId,callId:call.callId,type:'call.started',occurredAt:call.startedAt,expiresAt:call.expiresAt,tenantId:call.tenantId,actorId:call.actorId,instanceId:call.instanceId,schemaVersion:1,details:{},call},{outcome:'unknown_outcome',interrupted:true,errorOrigin:'unknown',errorCode:'instance_lease_expired',details:{verification:'unknown',retry_safety:'unknown'}});
   for(let batch=0;batch<20;batch++){const count=await this.store.cleanup(this.now());this.expired+=count;if(count===0)break;}this.cleanupAt=new Date(this.now()).toISOString();if(!this.healthy&&this.pending.size===0)await this.record({type:'capture.recovered',details:{capture_failures:this.failures,previous_missing_evidence:'unknown'}},true);const health=await this.spool.health(this.now());this.healthy=this.pending.size===0&&health.available&&health.tornFrames===0;
  }catch{this.databaseAvailable=false;try{for(const [id,event]of this.pending){if(Date.parse(event.expiresAt)>this.now())await this.spool.append(event,true);else this.expired++;this.pending.delete(id);}if(!this.healthy&&this.pending.size===0)await this.record({type:'capture.recovered',details:{capture_failures:this.failures,previous_missing_evidence:'unknown'}},true);const health=await this.spool.health(this.now());this.healthy=this.pending.size===0&&health.available&&health.tornFrames===0;}catch{this.healthy=false;}}})().finally(()=>{this.maintenanceRunning=undefined;});return this.maintenanceRunning;}
 startWorker(){if(this.timer)return;this.timer=setInterval(()=>{void this.maintenance();},60000);this.timer.unref();void this.maintenance();}
 stopWorker(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
 private async administrator(p:Principal){if(!this.options.principals)throw new AppError('forbidden','Diagnostic administration is unavailable.');const fresh=await reauthorize(p,this.options.principals);assertCapability(fresh,'platform.manage');return fresh;}
 private async queryStore(q:DiagnosticQuery){
  const items:DiagnosticCall[]=[],now=this.now(),limit=q.limit??50;
  const order=(a:DiagnosticCall,b:DiagnosticCall)=>b.startedAt.localeCompare(a.startedAt)||b.callId.localeCompare(a.callId);
  let degraded=false,after=q.after;
  // Select bounded candidates using immutable identity/time only. Filtering mutable
  // outcome metadata before projecting every source can resurrect stale rows.
  while(items.length<limit){
   const window:DiagnosticQuery={tenantId:q.tenantId,from:q.from,to:q.to,after,limit:100},calls=new Map<string,DiagnosticCall>();
   try{for(const call of await this.store.list(window,now))calls.set(call.callId,call);}catch{degraded=true;}
   for await(const e of this.spool.iterate(now)){
    degraded=true;if(!e.call||!matches(e.call,window,now))continue;
    if(newerCall(calls.get(e.call.callId),e.call))calls.set(e.call.callId,e.call);
    if(calls.size>100){const oldest=[...calls.values()].sort(order).at(-1)!;calls.delete(oldest.callId);}
   }
   if(!calls.size)break;
   // Arbitrary directory ordering may have evicted a terminal before its start.
   // Resolve the selected identities again before applying any mutable filters.
   for await(const e of this.spool.iterate(now))if(e.call&&calls.has(e.call.callId)&&newerCall(calls.get(e.call.callId),e.call))calls.set(e.call.callId,e.call);
   const candidates=[...calls.values()].sort(order);
   for(const call of candidates)if(matches(call,q,now)&&items.length<limit)items.push(call);
   if(candidates.length<100)break;
   const last=candidates.at(-1)!;after={startedAt:last.startedAt,callId:last.callId};
  }
  return{items,degraded};
 }

 async list(p:Principal,input:unknown){p=await this.administrator(p);const a=querySchema.parse(input),{cursor,...filters}=a;const now=this.now();let from=a.from??new Date(now-86400000).toISOString(),to=a.to??new Date(now).toISOString();if(Date.parse(to)<Date.parse(from)||Date.parse(from)<now-RETENTION_MS||Date.parse(to)>now+1000)throw new AppError('invalid_input','Diagnostic queries must be within the last seven days.');let after:DiagnosticQuery['after'];const binding=JSON.stringify({actor:actorKey(p),mapping:p.mappingVersion,policy:p.policyVersion,filters});if(cursor){let c:Row;try{c=this.options.cipher.open(cursor,`cursor:${actorKey(p)}`);}catch{throw new AppError('conflict','Diagnostic cursor is invalid.');}if(c.binding!==binding||c.expires<=now)throw new AppError('conflict','Diagnostic cursor expired or filters changed.');after=c.after;if(!a.from)from=c.from;if(!a.to)to=c.to;}
  const page=await this.queryStore({...filters,tenantId:p.tenantId,from,to,after,limit:a.limit}),items=page.items,last=items.at(-1);await this.administrator(p);return{items,degraded:page.degraded,completeness:{complete:!page.degraded},next_cursor:items.length===a.limit&&last?this.options.cipher.seal({binding,from,to,after:{startedAt:last.startedAt,callId:last.callId},expires:now+900000},`cursor:${actorKey(p)}`):null};}
 async detail(p:Principal,id:string){p=await this.administrator(p);z.string().uuid().parse(id);const merged=new MemoryDiagnosticStore();let degraded=false;try{const base=await this.store.detail(p.tenantId,id,this.now());if(base){merged.calls.set(base.call.callId,base.call);for(const child of base.children)merged.calls.set(child.callId,child);for(const e of base.events)await merged.append(e);}}catch{degraded=true;}for await(const e of this.spool.iterate(this.now()))if(e.tenantId===p.tenantId&&(e.callId===id||e.call?.parentId===id))await merged.append(e);const result=await merged.detail(p.tenantId,id,this.now());await this.administrator(p);if(!result)throw new AppError('not_found_or_inaccessible','Diagnostic call is unavailable.');return{...result,degraded,completeness:{complete:!degraded}};}
}
