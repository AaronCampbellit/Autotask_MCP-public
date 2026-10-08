import {randomUUID} from 'node:crypto';
import {AppError} from '../../contracts/src/index.js';
import type {SqlClient} from '../../storage/src/index.js';
import {IntentCipher} from '../../storage/src/intent-cipher.js';
import type {State} from './model.js';
export interface Store {load(tenant:string):Promise<State|undefined>;save(tenant:string,actor:string,state:State,expected:number,action:string):Promise<void>;events(tenant:string):Promise<unknown[]>}
const conflict=()=>new AppError('conflict','Autotask settings changed. Refresh before continuing.');
export class MemoryStore implements Store {
 states=new Map<string,State>();audit:Record<string,unknown>[]=[];
 async load(t:string){return structuredClone(this.states.get(t));}
 async save(t:string,a:string,s:State,e:number,action:string){if((this.states.get(t)?.version??0)!==e)throw conflict();this.states.set(t,structuredClone(s));this.audit.push({tenant:t,actor:a,action,version:s.version,at:new Date().toISOString()});}
 async events(t:string){return this.audit.filter(e=>e.tenant===t).slice(-50).reverse();}
}
export class PostgresStore implements Store {
 constructor(private db:SqlClient,private cipher:IntentCipher){}
 async load(t:string){const r=await this.db.query('SELECT payload FROM autotask_connections WHERE tenant_id=$1',[t]);return r.rows[0]?this.cipher.open((r.rows[0] as {payload:string}).payload,`autotask-config:${t}`) as State:undefined;}
 async save(t:string,a:string,s:State,e:number,action:string){
 const payload=this.cipher.seal(s,`autotask-config:${t}`);
 const r=await this.db.query(`WITH changed AS (UPDATE autotask_connections SET version=$2,payload=$3 WHERE tenant_id=$1 AND version=$4 AND $4>0 RETURNING tenant_id), inserted AS (INSERT INTO autotask_connections(tenant_id,version,payload) SELECT $1,$2,$3 WHERE $4=0 ON CONFLICT DO NOTHING RETURNING tenant_id) INSERT INTO autotask_connection_audit(id,tenant_id,actor,action,version) SELECT $5,tenant_id,$6,$7,$2 FROM (SELECT tenant_id FROM changed UNION ALL SELECT tenant_id FROM inserted) AS mutations RETURNING id`,[t,s.version,payload,e,randomUUID(),a,action]);
 if(!r.rows.length)throw conflict();
 }
 async events(t:string){return (await this.db.query('SELECT actor,action,version,at FROM autotask_connection_audit WHERE tenant_id=$1 ORDER BY at DESC,id DESC LIMIT 50',[t])).rows;}
}
