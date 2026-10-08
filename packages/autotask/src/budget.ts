import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from '../../contracts/src/index.js';

const identity=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
const positive=z.number().int().positive().safe();
const timestamp=z.iso.datetime();
export const thresholdObservationSchema=z.object({
  tenantId:identity,source:z.literal('ThresholdInformation'),observedAt:timestamp,expiresAt:timestamp,
  windowMs:positive.max(86_400_000),limit:positive.max(1_000_000),used:z.number().int().nonnegative().max(1_000_000),
  evidenceReference:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
}).strict();
export type ThresholdObservation=z.infer<typeof thresholdObservationSchema>;
export interface BudgetRequest { tenantId:string;actorKey:string;deadlineAt?:number;signal?:AbortSignal }
export type BudgetBlock='not_configured'|'observation_missing'|'observation_stale'|'shared_pressure'|'local_budget'|'queue_full'|'deadline'|'cancelled'|'closed'|'clock_invalid';
export interface RequestBudgetStatus {
  configured:boolean;mode:'live'|'fixture';blocked:BudgetBlock|null;queued:number;admitted:number;rejected:number;
  localUsed?:number;localRemaining?:number;observedRemaining?:number;windowMs?:number;requestsPerWindow?:number;reservedExternalHeadroom?:number;
  observationAgeMs?:number;observationExpiresAt?:string;queueHighWater?:number;maxQueueWaitMs?:number;
}
export interface RequestBudgetPort {
  /** Account for one physical HTTP attempt, including retries and verification reads. Never pass tool-supplied configuration. */
  take(request:BudgetRequest):Promise<void>;
  status():RequestBudgetStatus;
  updateObservation?(observation:unknown):void;
}
export class RequestBudgetError extends AppError {
  constructor(readonly reason:BudgetBlock) {super('throttled',reason==='not_configured'?'A reviewed shared Autotask request budget is required before live dispatch.':'The shared Autotask request budget cannot admit this request.',true);}
}
export interface BudgetTimers { set(callback:()=>void,delayMs:number):unknown;clear(handle:unknown):void }
export interface SharedRequestBudgetOptions {
  tenantId:string;requestsPerWindow:number;windowMs:number;reservedExternalHeadroom:number;observationMaxAgeMs:number;
  maxQueueSize?:number;maxWaitMs?:number;clock?:()=>number;timers?:BudgetTimers;
}
type Waiting={actor:string;enqueuedAt:number;deadline:number;resolve:()=>void;reject:(error:RequestBudgetError)=>void;signal?:AbortSignal;abort?:()=>void};
const optionsSchema=z.object({tenantId:identity,requestsPerWindow:positive.max(1_000_000),windowMs:positive.max(86_400_000),reservedExternalHeadroom:z.number().int().nonnegative().max(1_000_000),observationMaxAgeMs:positive.max(300_000),maxQueueSize:z.number().int().min(0).max(1000),maxWaitMs:z.number().int().min(0).max(60_000)}).strict();
const defaultTimers:BudgetTimers={set:(callback,delay)=>setTimeout(callback,delay),clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};

/** One instance is shared across every adapter in a single application process for the same Autotask database. */
export class SharedRequestBudget implements RequestBudgetPort {
  private readonly config:z.infer<typeof optionsSchema>;
  private readonly clock:()=>number;
  private readonly timers:BudgetTimers;
  private observation:ThresholdObservation|undefined;
  private readonly requests:number[]=[];
  private head=0;
  private readonly pending:Waiting[]=[];
  private timer:unknown;
  private readonly actorTurns=new Map<string,number>();
  private turn=0;
  private lastTime=-1;
  private closed=false;
  private admitted=0;
  private rejected=0;
  private highWater=0;
  private maxQueueWait=0;
  constructor(options:SharedRequestBudgetOptions) {
    const {clock,timers,...configuration}=options;
    const parsed=optionsSchema.safeParse({...configuration,maxQueueSize:options.maxQueueSize??100,maxWaitMs:options.maxWaitMs??0});
    if(!parsed.success||parsed.data.observationMaxAgeMs>parsed.data.windowMs)throw new AppError('invalid_input','The configured shared request budget is invalid.');
    this.config=parsed.data;this.clock=clock??Date.now;this.timers=timers??defaultTimers;
  }
  /** Carry charged attempts across a drained, same-tenant configuration reload. */
  exportUsage(){return {tenantId:this.config.tenantId,windowMs:this.config.windowMs,attempts:this.requests.slice(this.head),lastTime:this.lastTime};}
  importUsage(value:ReturnType<SharedRequestBudget['exportUsage']>){
    if(value.tenantId!==this.config.tenantId||value.windowMs!==this.config.windowMs||this.requests.length)throw new AppError('invalid_input','Request accounting cannot cross tenant or window boundaries.');
    this.requests.push(...value.attempts);this.head=0;this.lastTime=value.lastTime;
  }
  get maxWaitMs():number{return this.config.maxWaitMs;}
  private served(actor:string):void {
    this.actorTurns.delete(actor);this.actorTurns.set(actor,++this.turn);
    if(this.actorTurns.size>this.config.maxQueueSize+64)for(const known of this.actorTurns.keys()) {
      if(!this.pending.some(row=>row.actor===known)){this.actorTurns.delete(known);break;}
    }
  }
  private now():number {
    const now=this.clock();
    if(!Number.isSafeInteger(now)||now<0||now<this.lastTime) {this.observation=undefined;throw new RequestBudgetError('clock_invalid');}
    this.lastTime=now;return now;
  }
  private lowerBound(at:number):number {let low=this.head,high=this.requests.length;while(low<high){const middle=Math.floor((low+high)/2);if(this.requests[middle]!<at)low=middle+1;else high=middle;}return low;}
  private prune(now:number):void {
    this.head=this.lowerBound(now-this.config.windowMs+1);
    if(this.head>4096||this.head>this.requests.length/2){this.requests.splice(0,this.head);this.head=0;}
  }
  private capacity(now:number):{blocked:BudgetBlock|null;localRemaining:number;observedRemaining:number} {
    this.prune(now);const localRemaining=Math.max(0,this.config.requestsPerWindow-(this.requests.length-this.head)),observation=this.observation;
    if(this.closed)return{blocked:'closed',localRemaining,observedRemaining:0};
    if(!observation)return{blocked:'observation_missing',localRemaining,observedRemaining:0};
    if(Date.parse(observation.expiresAt)<=now||now-Date.parse(observation.observedAt)>=this.config.observationMaxAgeMs)return{blocked:'observation_stale',localRemaining,observedRemaining:0};
    // Equal-millisecond requests are charged conservatively because the capture cannot establish their ordering.
    const sinceObservation=this.requests.length-this.lowerBound(Date.parse(observation.observedAt));
    const observedRemaining=Math.max(0,observation.limit-this.config.reservedExternalHeadroom-observation.used-sinceObservation);
    return{blocked:localRemaining<1?'local_budget':observedRemaining<1?'shared_pressure':null,localRemaining,observedRemaining};
  }
  updateObservation(value:unknown):void {
    const parsed=thresholdObservationSchema.safeParse(value);if(!parsed.success){this.invalidateObservation();throw new AppError('invalid_input','The reviewed threshold observation is invalid.');}
    const observation=parsed.data,now=this.now(),captured=Date.parse(observation.observedAt),expires=Date.parse(observation.expiresAt);
    if(observation.tenantId!==this.config.tenantId||observation.windowMs!==this.config.windowMs||captured>now||expires<=now||expires<=captured
      ||expires-captured>this.config.observationMaxAgeMs||now-captured>=this.config.observationMaxAgeMs
      ||(this.observation&&captured<Date.parse(this.observation.observedAt))) {
      this.invalidateObservation();throw new AppError('invalid_input','The reviewed threshold observation is stale or does not match the configured budget.');
    }
    this.observation=structuredClone(observation);this.drain();
  }
  invalidateObservation():void {this.observation=undefined;this.drain();}
  take(request:BudgetRequest):Promise<void> {
    let now:number;try{now=this.now();}catch(error){this.rejected++;return Promise.reject(error);}
    if(request.tenantId!==this.config.tenantId||typeof request.actorKey!=='string'||!request.actorKey.startsWith(`${request.tenantId}:`)||request.actorKey.length<=request.tenantId.length+1||request.actorKey.length>512||/[\s\0\r\n]/.test(request.actorKey))return Promise.reject(new AppError('forbidden','The request does not match the configured tenant budget.'));
    if(request.signal?.aborted){this.rejected++;return Promise.reject(new RequestBudgetError('cancelled'));}
    const deadline=request.deadlineAt??now+this.config.maxWaitMs;
    if(!Number.isSafeInteger(deadline)||deadline<now||deadline>now+this.config.maxWaitMs){this.rejected++;return Promise.reject(new RequestBudgetError('deadline'));}
    const availability=this.capacity(now);
    if(availability.blocked&& !['local_budget','shared_pressure'].includes(availability.blocked)){this.rejected++;return Promise.reject(new RequestBudgetError(availability.blocked));}
    if(!this.pending.length&&!availability.blocked) {this.requests.push(now);this.admitted++;this.served(request.actorKey);return Promise.resolve();}
    if(deadline<=now){this.rejected++;return Promise.reject(new RequestBudgetError(availability.blocked??'deadline'));}
    if(this.pending.length>=this.config.maxQueueSize){this.rejected++;return Promise.reject(new RequestBudgetError('queue_full'));}
    return new Promise<void>((resolve,reject)=>{
      const row:Waiting={actor:request.actorKey,enqueuedAt:now,deadline,resolve,reject,signal:request.signal};
      if(request.signal){row.abort=()=>{this.remove(row,new RequestBudgetError('cancelled'));this.drain();};request.signal.addEventListener('abort',row.abort,{once:true});}
      this.pending.push(row);this.highWater=Math.max(this.highWater,this.pending.length);this.drain();
    });
  }
  private remove(row:Waiting,error?:RequestBudgetError):void {
    const index=this.pending.indexOf(row);if(index<0)return;this.pending.splice(index,1);
    if(row.abort)row.signal?.removeEventListener('abort',row.abort);
    if(error){this.rejected++;row.reject(error);}else row.resolve();
  }
  private drain():void {
    if(this.timer!==undefined){this.timers.clear(this.timer);this.timer=undefined;}
    let now:number;try{now=this.now();}catch {for(const row of [...this.pending])this.remove(row,new RequestBudgetError('clock_invalid'));return;}
    for(const row of [...this.pending])if(row.deadline<=now||row.signal?.aborted)this.remove(row,new RequestBudgetError(row.signal?.aborted?'cancelled':'deadline'));
    while(this.pending.length) {
      const available=this.capacity(now);
      if(available.blocked) {
        if(!['local_budget','shared_pressure'].includes(available.blocked))for(const row of [...this.pending])this.remove(row,new RequestBudgetError(available.blocked));
        break;
      }
      const actors=[...new Set(this.pending.map(row=>row.actor))],actor=actors.reduce((next,candidate)=>(this.actorTurns.get(candidate)??-1)<(this.actorTurns.get(next)??-1)?candidate:next);
      const row=this.pending.find(row=>row.actor===actor)!;this.requests.push(now);this.admitted++;this.served(actor);this.maxQueueWait=Math.max(this.maxQueueWait,now-row.enqueuedAt);this.remove(row);
    }
    if(this.pending.length) {
      const deadlines=this.pending.map(row=>row.deadline),observation=this.observation;
      if(this.requests.length>this.head)deadlines.push(this.requests[this.head]!+this.config.windowMs);
      if(observation)deadlines.push(Date.parse(observation.expiresAt),Date.parse(observation.observedAt)+this.config.observationMaxAgeMs);
      this.timer=this.timers.set(()=>{this.timer=undefined;this.drain();},Math.max(1,Math.min(...deadlines)-now));
    }
  }
  status():RequestBudgetStatus {
    let now:number;try{now=this.now();}catch{return{configured:true,mode:'live',blocked:'clock_invalid',queued:this.pending.length,admitted:this.admitted,rejected:this.rejected};}
    const available=this.capacity(now),observation=this.observation;
    return{configured:true,mode:'live',blocked:available.blocked,queued:this.pending.length,admitted:this.admitted,rejected:this.rejected,localUsed:this.requests.length-this.head,localRemaining:available.localRemaining,observedRemaining:available.observedRemaining,
      windowMs:this.config.windowMs,requestsPerWindow:this.config.requestsPerWindow,reservedExternalHeadroom:this.config.reservedExternalHeadroom,
      ...(observation?{observationAgeMs:now-Date.parse(observation.observedAt),observationExpiresAt:observation.expiresAt}:{}),queueHighWater:this.highWater,maxQueueWaitMs:this.maxQueueWait};
  }
  close():void {this.closed=true;this.drain();}
}

export class ClosedRequestBudget implements RequestBudgetPort {
  async take():Promise<void>{throw new RequestBudgetError('not_configured');}
  status():RequestBudgetStatus{return{configured:false,mode:'live',blocked:'not_configured',queued:0,admitted:0,rejected:0};}
}
/** Explicit simulator capability. Production factories must never select this as a missing-configuration fallback. */
export class FixtureUnlimitedRequestBudget implements RequestBudgetPort {
  private admitted=0;
  async take():Promise<void>{this.admitted++;}
  status():RequestBudgetStatus{return{configured:true,mode:'fixture',blocked:null,queued:0,admitted:this.admitted,rejected:0};}
}

const thresholdFileSchema=z.object({schemaVersion:z.literal(1),observation:thresholdObservationSchema,
  evidence:z.object({path:z.string().min(1).max(1000),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
}).strict();
export interface LocalThresholdOptions { path:string;evidenceRoot:string;refreshIntervalMs?:number;clock?:()=>number }
/** Loads a trusted normalized capture from one fixed local path; it does not guess or call a native ThresholdInformation route. */
export class LocalThresholdProvider implements RequestBudgetPort {
  private readonly path:string;
  private readonly root:string;
  private readonly interval:number;
  private readonly clock:()=>number;
  private checkedAt=-Infinity;
  private failure=false;
  private pending:Promise<void>|undefined;
  constructor(readonly budget:SharedRequestBudget,options:LocalThresholdOptions) {
    this.path=resolve(options.path);this.root=resolve(options.evidenceRoot);this.interval=options.refreshIntervalMs??30_000;this.clock=options.clock??Date.now;
    if(!Number.isInteger(this.interval)||this.interval<1||this.interval>30_000)throw new AppError('invalid_input','The threshold refresh interval is invalid.');
  }
  private async refresh():Promise<void> {
    const now=this.clock();if(this.pending)return this.pending;
    if(now>=this.checkedAt&&now-this.checkedAt<this.interval){if(this.failure)throw new RequestBudgetError('observation_missing');return;}
    this.pending=(async()=>{
      try {
        const info=await stat(this.path);if(!info.isFile()||info.size>64*1024||info.mtimeMs>now+1000)throw new Error();
        const parsed=thresholdFileSchema.safeParse(JSON.parse(await readFile(this.path,'utf8')));if(!parsed.success)throw new Error();const input=parsed.data;
        if(info.mtimeMs<Date.parse(input.observation.observedAt)-1000)throw new Error();
        const relativePath=input.evidence.path;if(isAbsolute(relativePath)||relativePath.includes('\\')||relativePath.includes(':')||relativePath.split('/').some(segment=>!segment||segment==='.'||segment==='..'))throw new Error();
        const root=await realpath(this.root),path=await realpath(resolve(root,relativePath)),within=relative(root,path);if(!within||within.startsWith('..')||isAbsolute(within))throw new Error();
        const sourceInfo=await stat(path);if(!sourceInfo.isFile()||sourceInfo.size>2*1024*1024||sourceInfo.mtimeMs>now+1000||sourceInfo.mtimeMs<Date.parse(input.observation.observedAt)-1000)throw new Error();
        const hash=createHash('sha256').update(await readFile(path)).digest('hex');if(hash!==input.evidence.sha256)throw new Error();
        this.budget.updateObservation(input.observation);this.failure=false;
      }catch {this.failure=true;this.budget.invalidateObservation();throw new RequestBudgetError('observation_missing');}
      finally {this.checkedAt=this.clock();this.pending=undefined;}
    })();return this.pending;
  }
  async take(request:BudgetRequest):Promise<void> {
    let deadline=request.deadlineAt;
    for(;;) {
      await this.refresh();const now=this.clock();
      if(this.budget.maxWaitMs===0){await this.budget.take(request);return;}
      deadline??=now+this.budget.maxWaitMs;
      try {await this.budget.take({...request,deadlineAt:Math.min(deadline,now+this.budget.maxWaitMs,this.checkedAt+this.interval)});return;}
      catch(error) {if(error instanceof RequestBudgetError&&error.reason==='deadline'&&this.clock()<deadline&&this.clock()-this.checkedAt>=this.interval)continue;throw error;}
    }
  }
  /** Read-only startup/preflight validation; no request allowance is consumed. */
  async validate():Promise<void> {
    await this.refresh();const blocked=this.budget.status().blocked;
    if(blocked&& !['shared_pressure','local_budget'].includes(blocked))throw new RequestBudgetError(blocked);
  }
  status():RequestBudgetStatus{return this.budget.status();}
  close():void{this.budget.close();}
}

/** No default tenant allowance exists. Partial or invalid configuration is rejected instead of weakened. */
export function requestBudgetOptionsFromEnvironment(environment:Readonly<Record<string,string|undefined>>,tenantId:string):SharedRequestBudgetOptions|undefined {
  const options=requestBudgetSettingsFromEnvironment(environment,tenantId);
  if(options&&!environment.AUTOTASK_THRESHOLD_PATH?.trim())throw new AppError('invalid_input','Shared request budget configuration requires a reviewed local threshold capture.');
  return options;
}

/** Validate editable numeric settings without treating deployment-owned paths as editable settings. */
export function requestBudgetSettingsFromEnvironment(environment:Readonly<Record<string,string|undefined>>,tenantId:string):SharedRequestBudgetOptions|undefined {
  const keys=['AUTOTASK_REQUESTS_PER_WINDOW','AUTOTASK_BUDGET_WINDOW_MS','AUTOTASK_EXTERNAL_HEADROOM','AUTOTASK_THRESHOLD_MAX_AGE_MS'] as const;
  const value=(key:string)=>environment[key]?.trim()||undefined;
  if([...keys,'AUTOTASK_THRESHOLD_PATH','AUTOTASK_BUDGET_MAX_WAIT_MS','AUTOTASK_BUDGET_QUEUE_SIZE'].every(key=>value(key)===undefined))return undefined;
  const number=(key:string,optional=false)=>{const raw=value(key);if(optional&&raw===undefined)return undefined;if(!raw||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new AppError('invalid_input','Shared request budget configuration is incomplete or invalid.');return Number(raw);};
  const options={tenantId,requestsPerWindow:number(keys[0])!,windowMs:number(keys[1])!,reservedExternalHeadroom:number(keys[2])!,observationMaxAgeMs:number(keys[3])!,
    maxWaitMs:number('AUTOTASK_BUDGET_MAX_WAIT_MS',true)??0,maxQueueSize:number('AUTOTASK_BUDGET_QUEUE_SIZE',true)??100};
  const parsed=optionsSchema.safeParse(options);if(!parsed.success||options.observationMaxAgeMs>options.windowMs)throw new AppError('invalid_input','Shared request budget configuration is incomplete or invalid.');return parsed.data;
}
