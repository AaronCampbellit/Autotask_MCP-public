import {randomUUID} from 'node:crypto';
import {AppError} from '../../contracts/src/index.js';
import type {SqlClient} from '../../storage/src/index.js';
import {IntentCipher} from '../../storage/src/intent-cipher.js';
export type Row=Record<string,any>;
export type AuditDetails={target?:string;enabled?:boolean;version?:number};
export interface RmmConfig {version:number;platform:string;key:string;secret:string;enabled:boolean;jobsEnabled:boolean;allComponentsEnabled?:boolean;accountUid?:string;sites:Record<string,{companyId:number;name:string;companyName?:string}>;approvals:Record<string,{name:string;fingerprint:string;variables:Record<string,string>}>}
export const emptyConfig=():RmmConfig=>({version:0,platform:'zinfandel',key:'',secret:'',enabled:false,jobsEnabled:false,allComponentsEnabled:false,sites:{},approvals:{}});
export interface RmmJob {id:string;actor:string;requestKey:string;hash:string;connectionVersion:number;accountUid:string;deviceUid:string;siteUid:string;companyId:number;componentUid:string;state:'reserved'|'dispatching'|'accepted'|'unknown_outcome'|'failed';jobUid?:string;createdAt:string}
export interface RmmEntry {id:string;actor:string;key:string;kind:string;accountUid:string;createdAt:string;data:Row}
export interface RmmStore {
 reserveEntry(tenant:string,entry:RmmEntry):Promise<{entry:RmmEntry;created:boolean}>;
 finishEntry(tenant:string,entry:RmmEntry):Promise<void>;
 entry(tenant:string,actor:string,id:string):Promise<RmmEntry|undefined>;
 entries(tenant:string,actor:string,kind:string):Promise<RmmEntry[]>;
 config(tenant:string):Promise<RmmConfig>;
 save(tenant:string,actor:string,value:RmmConfig,expected:number,action:string,details?:AuditDetails):Promise<void>;
 reserve(tenant:string,job:RmmJob):Promise<{job:RmmJob;created:boolean}>;
 finish(tenant:string,job:RmmJob):Promise<void>;
 jobs(tenant:string,actor:string):Promise<RmmJob[]>;
 get(tenant:string,actor:string,id:string):Promise<RmmJob|undefined>;
 events(tenant:string):Promise<Row[]>;
}
export class MemoryRmmStore implements RmmStore {
 entriesMap=new Map<string,RmmEntry>();
 async reserveEntry(t:string,e:RmmEntry){const key=JSON.stringify([t,e.actor,e.key]),old=this.entriesMap.get(key);if(old)return{entry:structuredClone(old),created:false};this.entriesMap.set(key,structuredClone(e));return{entry:e,created:true};}
 async finishEntry(t:string,e:RmmEntry){this.entriesMap.set(JSON.stringify([t,e.actor,e.key]),structuredClone(e));}
 async entry(t:string,a:string,id:string){return [...this.entriesMap.entries()].filter(([k])=>JSON.parse(k)[0]===t).map(([,v])=>structuredClone(v)).find(v=>v.actor===a&&v.id===id);}
 async entries(t:string,a:string,kind:string){return [...this.entriesMap.entries()].filter(([k,v])=>JSON.parse(k)[0]===t&&v.actor===a&&v.kind===kind).map(([,v])=>structuredClone(v)).reverse().slice(0,100);}
 configs=new Map<string,RmmConfig>(); records=new Map<string,RmmJob>(); audit:Row[]=[];
 async config(t:string){return structuredClone(this.configs.get(t)??emptyConfig());}
 async save(t:string,a:string,v:RmmConfig,e:number,action:string,details:AuditDetails={}){if((await this.config(t)).version!==e)throw new AppError('conflict','RMM settings changed. Reload before saving.');this.configs.set(t,structuredClone(v));this.audit.push({tenant:t,actor:a,action,details:{...details,version:v.version},at:new Date().toISOString()});}
 async reserve(t:string,j:RmmJob){const key=`${t}:${j.actor}:${j.requestKey}`,old=this.records.get(key);if(old)return{job:structuredClone(old),created:false};this.records.set(key,structuredClone(j));return{job:j,created:true};}
 async finish(t:string,j:RmmJob){this.records.set(`${t}:${j.actor}:${j.requestKey}`,structuredClone(j));}
 async jobs(t:string,a:string){return [...this.records.entries()].filter(([k,v])=>k.startsWith(t+':')&&v.actor===a).map(([,v])=>structuredClone(v)).slice(-100).reverse();}
 async get(t:string,a:string,id:string){return [...this.records.entries()].filter(([k])=>k.startsWith(t+':')).map(([,j])=>j).find(j=>j.actor===a&&j.id===id);}
 async events(t:string){return this.audit.filter(r=>r.tenant===t).slice(-100).reverse();}
}
export class PostgresRmmStore implements RmmStore {
 constructor(private db:SqlClient,private cipher:IntentCipher){}
 async reserveEntry(t:string,e:RmmEntry){const payload=this.cipher.seal(e,`rmm:entry:${t}:${e.actor}:${e.key}`);const r=await this.db.query('INSERT INTO rmm_entries(id,tenant_id,actor,request_key,kind,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,actor,request_key) DO NOTHING RETURNING id',[e.id,t,e.actor,e.key,e.kind,payload]);if(r.rows.length)return{entry:e,created:true};const old=await this.db.query('SELECT payload FROM rmm_entries WHERE tenant_id=$1 AND actor=$2 AND request_key=$3',[t,e.actor,e.key]);return{entry:this.cipher.open((old.rows[0] as Row).payload,`rmm:entry:${t}:${e.actor}:${e.key}`) as RmmEntry,created:false};}
 async finishEntry(t:string,e:RmmEntry){await this.db.query('UPDATE rmm_entries SET payload=$1 WHERE tenant_id=$2 AND actor=$3 AND request_key=$4',[this.cipher.seal(e,`rmm:entry:${t}:${e.actor}:${e.key}`),t,e.actor,e.key]);}
 async entry(t:string,a:string,id:string){const r=await this.db.query('SELECT request_key,payload FROM rmm_entries WHERE tenant_id=$1 AND actor=$2 AND id=$3',[t,a,id]);const row=r.rows[0] as Row|undefined;return row?this.cipher.open(row.payload,`rmm:entry:${t}:${a}:${row.request_key}`) as RmmEntry:undefined;}
 async entries(t:string,a:string,kind:string){const r=await this.db.query('SELECT request_key,payload FROM rmm_entries WHERE tenant_id=$1 AND actor=$2 AND kind=$3 ORDER BY created_at DESC,id DESC LIMIT 100',[t,a,kind]);return r.rows.map(v=>{const row=v as Row;return this.cipher.open(row.payload,`rmm:entry:${t}:${a}:${row.request_key}`) as RmmEntry;});}
 async config(t:string){const {rows}=await this.db.query('SELECT payload FROM rmm_connections WHERE tenant_id=$1',[t]);return rows[0]?this.cipher.open((rows[0] as Row).payload,`rmm:connection:${t}`) as RmmConfig:emptyConfig();}
 async save(t:string,a:string,v:RmmConfig,e:number,action:string,details:AuditDetails={}){
  const payload=this.cipher.seal(v,`rmm:connection:${t}`);
  const {rows}=await this.db.query(`WITH saved AS (INSERT INTO rmm_connections(tenant_id,version,payload) SELECT $1,$2,$3 WHERE $4=0 ON CONFLICT(tenant_id) DO UPDATE SET version=$2,payload=$3 WHERE rmm_connections.version=$4 RETURNING tenant_id), updated AS (UPDATE rmm_connections SET version=$2,payload=$3 WHERE tenant_id=$1 AND version=$4 AND $4>0 RETURNING tenant_id), audited AS (INSERT INTO rmm_audit(id,tenant_id,actor,action,details) SELECT $5,$1,$6,$7,$8::jsonb WHERE EXISTS(SELECT 1 FROM saved UNION ALL SELECT 1 FROM updated) RETURNING id) SELECT id FROM audited`,[t,v.version,payload,e,randomUUID(),a,action,JSON.stringify({...details,version:v.version})]);
  if(!rows.length)throw new AppError('conflict','RMM settings changed. Reload before saving.');
 }
 async reserve(t:string,j:RmmJob){const payload=this.cipher.seal(j,`rmm:job:${t}:${j.actor}:${j.requestKey}`);const r=await this.db.query('INSERT INTO rmm_jobs(id,tenant_id,actor,request_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,actor,request_key) DO NOTHING RETURNING id',[j.id,t,j.actor,j.requestKey,payload]);if(r.rows.length)return{job:j,created:true};const old=await this.db.query('SELECT payload FROM rmm_jobs WHERE tenant_id=$1 AND actor=$2 AND request_key=$3',[t,j.actor,j.requestKey]);return{job:this.cipher.open((old.rows[0] as Row).payload,`rmm:job:${t}:${j.actor}:${j.requestKey}`) as RmmJob,created:false};}
 async finish(t:string,j:RmmJob){await this.db.query('UPDATE rmm_jobs SET payload=$1 WHERE tenant_id=$2 AND actor=$3 AND request_key=$4',[this.cipher.seal(j,`rmm:job:${t}:${j.actor}:${j.requestKey}`),t,j.actor,j.requestKey]);}
 async jobs(t:string,a:string){const r=await this.db.query('SELECT request_key,payload FROM rmm_jobs WHERE tenant_id=$1 AND actor=$2 ORDER BY created_at DESC,id DESC LIMIT 100',[t,a]);return r.rows.map(v=>{const r=v as Row;return this.cipher.open(r.payload,`rmm:job:${t}:${a}:${r.request_key}`) as RmmJob;});}
 async get(t:string,a:string,id:string){const r=await this.db.query('SELECT request_key,payload FROM rmm_jobs WHERE tenant_id=$1 AND actor=$2 AND id=$3',[t,a,id]);const row=r.rows[0] as Row|undefined;return row?this.cipher.open(row.payload,`rmm:job:${t}:${a}:${row.request_key}`) as RmmJob:undefined;}
 async events(t:string){return (await this.db.query('SELECT actor,action,details,at FROM rmm_audit WHERE tenant_id=$1 ORDER BY at DESC,id DESC LIMIT 100',[t])).rows as Row[];}
}
