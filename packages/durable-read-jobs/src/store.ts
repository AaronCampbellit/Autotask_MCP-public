import type {SqlClient} from '../../storage/src/index.js';
import {AppError} from '../../contracts/src/index.js';
export type JobState='queued'|'running'|'completed'|'failed'|'cancelled';
export interface ReadJob {id:string;tenant:string;actor:string;requestKey:string;hash:string;company:number;state:JobState;input:string;result:string|null;error:string|null;created:number;updated:number;expires:number;leaseUntil:number;owner:string|null;fence:number;attempts:number}
export interface ReadJobStore {reserve(job:ReadJob):Promise<ReadJob>;get(tenant:string,actor:string,id:string,now:number):Promise<ReadJob|undefined>;claim(owner:string,now:number,leaseMs:number):Promise<ReadJob|undefined>;renew(job:ReadJob,now:number,leaseMs:number):Promise<boolean>;finish(job:ReadJob,now:number,state:'completed'|'failed',result:string|null,error:string|null):Promise<boolean>;cancel(tenant:string,actor:string,id:string,now:number):Promise<void>;purge(now:number):Promise<void>}
const active=(j:ReadJob)=>j.state==='queued'||j.state==='running';
const same=(a:ReadJob,b:ReadJob)=>a.id===b.id&&a.owner===b.owner&&a.fence===b.fence;
const copy=<T>(x:T):T=>structuredClone(x);
export class MemoryReadJobStore implements ReadJobStore {
 readonly rows=new Map<string,ReadJob>();
 async reserve(job:ReadJob){const old=[...this.rows.values()].find(j=>j.tenant===job.tenant&&j.actor===job.actor&&j.requestKey===job.requestKey&&j.expires>job.created);if(old)return copy(old);if([...this.rows.values()].filter(j=>j.tenant===job.tenant&&j.actor===job.actor&&j.expires>job.created&&active(j)).length>=4)throw new AppError('throttled','Four pending reports are already queued for this employee.');this.rows.set(job.id,copy(job));return copy(job);}
 async get(t:string,a:string,id:string,now:number){const j=this.rows.get(id);return j&&j.tenant===t&&j.actor===a&&j.expires>now?copy(j):undefined;}
 async claim(owner:string,now:number,leaseMs:number){for(const j of this.rows.values()){if(j.expires<=now||!active(j)||(j.state==='running'&&j.leaseUntil>now))continue;if(j.attempts>=3){j.state='failed';j.error='read_attempts_exhausted';j.updated=now;continue;}j.state='running';j.owner=owner;j.fence++;j.attempts++;j.leaseUntil=now+leaseMs;j.updated=now;return copy(j);}return undefined;}
 async renew(job:ReadJob,now:number,leaseMs:number){const j=this.rows.get(job.id);if(!j||!same(j,job)||j.state!=='running'||j.leaseUntil<=now||j.expires<=now)return false;j.leaseUntil=now+leaseMs;j.updated=now;return true;}
 async finish(job:ReadJob,now:number,state:'completed'|'failed',result:string|null,error:string|null){const j=this.rows.get(job.id);if(!j||!same(j,job)||j.state!=='running'||j.leaseUntil<=now||j.expires<=now)return false;Object.assign(j,{state,result,error,updated:now,owner:null,leaseUntil:0});return true;}
 async cancel(t:string,a:string,id:string,now:number){const j=this.rows.get(id);if(j&&j.tenant===t&&j.actor===a&&j.expires>now&&active(j)){j.state='cancelled';j.fence++;j.owner=null;j.leaseUntil=0;j.updated=now;}}
 async purge(now:number){for(const [id,j]of this.rows)if(j.expires<=now)this.rows.delete(id);}
}
function decode(r:any):ReadJob{return{id:r.id,tenant:r.tenant_id,actor:r.actor_id,requestKey:r.request_key,hash:r.input_hash,company:Number(r.company_id),state:r.state,input:r.encrypted_input,result:r.encrypted_result,error:r.error_code,created:Number(r.created_ms),updated:Number(r.updated_ms),expires:Number(r.expires_ms),leaseUntil:Number(r.lease_until_ms),owner:r.lease_owner,fence:Number(r.fence),attempts:r.attempts};}
export class PostgresReadJobStore implements ReadJobStore {
 constructor(private db:SqlClient){}
 async reserve(j:ReadJob){
  for(let tries=0;tries<8;tries++){
   const prior=await this.db.query('SELECT * FROM durable_read_jobs WHERE tenant_id=$1 AND actor_id=$2 AND request_key=$3 AND expires_ms>$4',[j.tenant,j.actor,j.requestKey,j.created]);if(prior.rows[0])return decode(prior.rows[0]);
   await this.purge(j.created);
   const q=await this.db.query(`INSERT INTO durable_read_jobs(id,tenant_id,actor_id,request_key,input_hash,company_id,state,encrypted_input,created_ms,updated_ms,expires_ms,slot)
    SELECT $1,$2,$3,$4,$5,$6,'queued',$7,$8,$8,$9,s FROM generate_series(1,4) s WHERE NOT EXISTS(SELECT 1 FROM durable_read_jobs WHERE tenant_id=$2 AND actor_id=$3 AND slot=s) ORDER BY s LIMIT 1 ON CONFLICT DO NOTHING RETURNING *`,[j.id,j.tenant,j.actor,j.requestKey,j.hash,j.company,j.input,j.created,j.expires]);if(q.rows[0])return decode(q.rows[0]);
  }
  throw new AppError('throttled','Four pending reports are already queued for this employee.');
 }
 async get(t:string,a:string,id:string,now:number){const r=await this.db.query('SELECT * FROM durable_read_jobs WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 AND expires_ms>$4',[t,a,id,now]);return r.rows[0]?decode(r.rows[0]):undefined;}
 async claim(owner:string,now:number,leaseMs:number){await this.db.query("UPDATE durable_read_jobs SET state='failed',error_code='read_attempts_exhausted',slot=NULL,updated_ms=$1 WHERE state IN ('queued','running') AND attempts>=3 AND lease_until_ms<=$1",[now]);const r=await this.db.query(`WITH candidate AS (SELECT id FROM durable_read_jobs WHERE state IN ('queued','running') AND lease_until_ms<=$1 AND expires_ms>$1 AND attempts<3 ORDER BY created_ms,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE durable_read_jobs j SET state='running',lease_owner=$2,lease_until_ms=$3,updated_ms=$1,fence=fence+1,attempts=attempts+1 FROM candidate WHERE j.id=candidate.id RETURNING j.*`,[now,owner,now+leaseMs]);return r.rows[0]?decode(r.rows[0]):undefined;}
 async renew(j:ReadJob,now:number,leaseMs:number){const r=await this.db.query("UPDATE durable_read_jobs SET lease_until_ms=$1,updated_ms=$2 WHERE id=$3 AND lease_owner=$4 AND fence=$5 AND state='running' AND lease_until_ms>$2 AND expires_ms>$2 RETURNING id",[now+leaseMs,now,j.id,j.owner,j.fence]);return!!r.rows.length;}
 async finish(j:ReadJob,now:number,state:'completed'|'failed',result:string|null,error:string|null){const r=await this.db.query("UPDATE durable_read_jobs SET state=$1,encrypted_result=$2,error_code=$3,updated_ms=$4,lease_owner=NULL,lease_until_ms=0,slot=NULL WHERE id=$5 AND lease_owner=$6 AND fence=$7 AND state='running' AND lease_until_ms>$4 AND expires_ms>$4 RETURNING id",[state,result,error,now,j.id,j.owner,j.fence]);return!!r.rows.length;}
 async cancel(t:string,a:string,id:string,now:number){await this.db.query("UPDATE durable_read_jobs SET state='cancelled',fence=fence+1,lease_owner=NULL,lease_until_ms=0,slot=NULL,updated_ms=$4 WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 AND expires_ms>$4 AND state IN ('queued','running')",[t,a,id,now]);}
 async purge(now:number){await this.db.query('DELETE FROM durable_read_jobs WHERE id IN (SELECT id FROM durable_read_jobs WHERE expires_ms<=$1 ORDER BY expires_ms LIMIT 500)',[now]);}
}
