import {createHash} from 'node:crypto';
import {AppError,actorKey,type Principal} from '../../contracts/src/index.js';
export function scopedReadKey(p:Principal,connection:string,version:unknown,entity:string,input:unknown){return createHash('sha256').update(JSON.stringify({actor:actorKey(p),resource:p.resourceId,policy:p.policyVersion,mapping:p.mappingVersion,companies:[...p.companyIds].sort(),all:p.allCompanies,capabilities:[...p.capabilities].sort(),areas:p.areaPermissions,connection,version,entity,input})).digest('hex');}
interface Entry {data:unknown;fetched:number;expires:number;bytes:number}
interface Flight {promise:Promise<Entry>;generation:number;expires:number}
export interface CacheResult<T>{data:T;fetched_at:string;cache_age_ms:number;cache_hit:boolean}
export class ScopedReadCache {
 private entries=new Map<string,Entry>();private flights=new Map<string,Flight>();private generation=0;private bytes=0;private active=0;
 readonly metrics={hits:0,misses:0,coalesced:0,evicted:0};
 constructor(readonly limits={entries:128,bytes:2_000_000,inflight:16},private now=Date.now){if(Object.values(limits).some(n=>!Number.isSafeInteger(n)||n<1))throw new Error('Invalid read cache limits.');}
 invalidate(){this.generation++;this.entries.clear();this.bytes=0;/* Old flights keep their admission slot until settled. */}
 private remove(key:string){const e=this.entries.get(key);if(e){this.bytes-=e.bytes;this.entries.delete(key);}}
 private prune(){for(const [key,e]of this.entries)if(e.expires<=this.now())this.remove(key);}
 async get<T>(a:{key:string;ttlMs:number;guard:()=>Promise<void>;load:()=>Promise<T>;signal?:AbortSignal}):Promise<CacheResult<T>>{
  if(!Number.isFinite(a.ttlMs)||a.ttlMs<=0||a.ttlMs>300000)throw new Error('Invalid cache TTL.');await a.guard();a.signal?.throwIfAborted();this.prune();
  let entry=this.entries.get(a.key),hit=!!entry;
  if(entry){this.metrics.hits++;this.entries.delete(a.key);this.entries.set(a.key,entry);}else{
   let flight=this.flights.get(a.key);if(flight&&(flight.generation!==this.generation||flight.expires<=this.now()))flight=undefined;
   if(flight){this.metrics.coalesced++;hit=true;}else{
    if(this.active>=this.limits.inflight)throw new AppError('throttled','Read cache in-flight limit reached.');this.metrics.misses++;this.active++;
    const generation=this.generation,expires=this.now()+a.ttlMs;
    const current:Flight={generation,expires,promise:Promise.resolve(undefined as never)};
    current.promise=(async()=>{const data=await a.load(),fetched=this.now(),bytes=Buffer.byteLength(JSON.stringify(data));const result={data:structuredClone(data),fetched,expires:fetched+a.ttlMs,bytes};
     if(generation===this.generation&&this.now()<expires&&this.flights.get(a.key)===current&&bytes<=this.limits.bytes){this.remove(a.key);while(this.entries.size>=this.limits.entries||this.bytes+bytes>this.limits.bytes){const oldest=this.entries.keys().next().value;if(oldest===undefined)break;this.remove(oldest);this.metrics.evicted++;}this.entries.set(a.key,result);this.bytes+=bytes;}return result;
    })().finally(()=>{this.active--;if(this.flights.get(a.key)===current)this.flights.delete(a.key);});this.flights.set(a.key,current);flight=current;
   }
   const promise=flight.promise;
   if(a.signal){entry=await new Promise<Entry>((resolve,reject)=>{const signal=a.signal!,abort=()=>reject(signal.reason??new Error('Aborted'));signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));if(signal.aborted)abort();});}else entry=await promise;
  }
  await a.guard();a.signal?.throwIfAborted();return{data:structuredClone(entry.data) as T,fetched_at:new Date(entry.fetched).toISOString(),cache_age_ms:Math.max(0,this.now()-entry.fetched),cache_hit:hit};
 }
}
export async function boundedMap<T,R>(items:readonly T[],concurrency:number,run:(item:T,index:number)=>Promise<R>):Promise<R[]>{if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Invalid fan-out limit.');const out=new Array<R>(items.length);let index=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(index<items.length){const i=index++;out[i]=await run(items[i]!,i);}}));return out;}
