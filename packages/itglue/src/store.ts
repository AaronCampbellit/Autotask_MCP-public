import {AppError} from '../../contracts/src/index.js';
import type {SqlClient} from '../../storage/src/index.js';
import {IntentCipher} from '../../storage/src/intent-cipher.js';
export type Row=Record<string,any>;
export interface ItGlueConfig {version:number;region:'us'|'eu'|'au';key:string;enabled:boolean;writesEnabled:boolean;organizations:Record<string,{companyId:number;verifiedAt:string;evidence:string}>}
export const emptyConfig=():ItGlueConfig=>({version:0,region:'us',key:'',enabled:false,writesEnabled:false,organizations:{}});
export interface ItGlueReceipt {id:string;actor:string;requestKey:string;hash:string;organizationId:string;companyId:number;connectionVersion:number;state:'reserved'|'dispatching'|'accepted_unverified'|'verified'|'unknown_outcome'|'partial'|'failed';steps:Row[];intent:Row;createdAt:string}
export interface ItGlueStore {config(t:string):Promise<ItGlueConfig>;save(t:string,c:ItGlueConfig,expected:number):Promise<void>;reserve(t:string,r:ItGlueReceipt):Promise<{receipt:ItGlueReceipt;created:boolean}>;finish(t:string,r:ItGlueReceipt):Promise<void>;find(t:string,actor:string,key:string):Promise<ItGlueReceipt|undefined>;get(t:string,actor:string,id:string):Promise<ItGlueReceipt|undefined>}
export class MemoryItGlueStore implements ItGlueStore {
 configs=new Map<string,ItGlueConfig>();receipts=new Map<string,ItGlueReceipt>();
 async config(t:string){return structuredClone(this.configs.get(t)??emptyConfig());}
 async save(t:string,c:ItGlueConfig,e:number){if((await this.config(t)).version!==e)throw new AppError('conflict','IT Glue settings changed.');this.configs.set(t,structuredClone(c));}
 async reserve(t:string,r:ItGlueReceipt){const k=JSON.stringify([t,r.actor,r.requestKey]),old=this.receipts.get(k);if(old)return{receipt:structuredClone(old),created:false};this.receipts.set(k,structuredClone(r));return{receipt:r,created:true};}
 async finish(t:string,r:ItGlueReceipt){this.receipts.set(JSON.stringify([t,r.actor,r.requestKey]),structuredClone(r));}
 async find(t:string,a:string,key:string){return structuredClone(this.receipts.get(JSON.stringify([t,a,key])));}
 async get(t:string,a:string,id:string){return [...this.receipts].find(([k,r])=>JSON.parse(k)[0]===t&&r.actor===a&&r.id===id)?.[1];}
}
export class PostgresItGlueStore implements ItGlueStore {
 constructor(private db:SqlClient,private cipher:IntentCipher){}
 async config(t:string){const r=await this.db.query('SELECT payload FROM itglue_connections WHERE tenant_id=$1',[t]);return r.rows[0]?this.cipher.open((r.rows[0] as Row).payload,`itg:config:${t}`) as ItGlueConfig:emptyConfig();}
 async save(t:string,c:ItGlueConfig,e:number){const r=await this.db.query('INSERT INTO itglue_connections(tenant_id,version,payload) SELECT $1,$2,$3 WHERE $4=0 ON CONFLICT(tenant_id) DO UPDATE SET version=$2,payload=$3 WHERE itglue_connections.version=$4 RETURNING tenant_id',[t,c.version,this.cipher.seal(c,`itg:config:${t}`),e]);if(!r.rows.length){const u=await this.db.query('UPDATE itglue_connections SET version=$2,payload=$3 WHERE tenant_id=$1 AND version=$4 RETURNING tenant_id',[t,c.version,this.cipher.seal(c,`itg:config:${t}`),e]);if(!u.rows.length)throw new AppError('conflict','IT Glue settings changed.');}}
 async reserve(t:string,r:ItGlueReceipt){const binding=`itg:receipt:${t}:${r.actor}:${r.requestKey}`,q=await this.db.query('INSERT INTO itglue_receipts(id,tenant_id,actor,request_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,actor,request_key) DO NOTHING RETURNING id',[r.id,t,r.actor,r.requestKey,this.cipher.seal(r,binding)]);if(q.rows.length)return{receipt:r,created:true};const old=await this.db.query('SELECT payload FROM itglue_receipts WHERE tenant_id=$1 AND actor=$2 AND request_key=$3',[t,r.actor,r.requestKey]);return{receipt:this.cipher.open((old.rows[0] as Row).payload,binding) as ItGlueReceipt,created:false};}
 async finish(t:string,r:ItGlueReceipt){await this.db.query('UPDATE itglue_receipts SET payload=$1 WHERE tenant_id=$2 AND actor=$3 AND request_key=$4',[this.cipher.seal(r,`itg:receipt:${t}:${r.actor}:${r.requestKey}`),t,r.actor,r.requestKey]);}
 async find(t:string,a:string,key:string){const q=await this.db.query('SELECT payload FROM itglue_receipts WHERE tenant_id=$1 AND actor=$2 AND request_key=$3',[t,a,key]);return q.rows[0]?this.cipher.open((q.rows[0] as Row).payload,`itg:receipt:${t}:${a}:${key}`) as ItGlueReceipt:undefined;}
 async get(t:string,a:string,id:string){const q=await this.db.query('SELECT request_key,payload FROM itglue_receipts WHERE tenant_id=$1 AND actor=$2 AND id=$3',[t,a,id]);const r=q.rows[0] as Row|undefined;return r?this.cipher.open(r.payload,`itg:receipt:${t}:${a}:${r.request_key}`) as ItGlueReceipt:undefined;}
}
