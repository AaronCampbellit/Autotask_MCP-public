import type {SqlClient} from '../../storage/src/index.js';
import {DiagnosticCipher,type DiagnosticCall,type DiagnosticEvent,type DiagnosticQuery,type DiagnosticStore} from './contracts.js';
const copy=<T>(v:T):T=>structuredClone(v);
const fields=['actorId','tool','outcome','errorOrigin','errorCode','recordId','operationId','jobId','traceId','serverRelease'] as const;
export function matches(c:DiagnosticCall,q:DiagnosticQuery,now:number){return c.tenantId===q.tenantId&&Date.parse(c.expiresAt)>now&&(!q.from||c.startedAt>=q.from)&&(!q.to||c.startedAt<=q.to)&&fields.every(k=>!q[k]||c[k]===q[k])&&(!q.after||c.startedAt<q.after.startedAt||c.startedAt===q.after.startedAt&&c.callId<q.after.callId);}
export function newerCall(old:DiagnosticCall|undefined,next:DiagnosticCall){return !old||old.lifecycle==='started'||next.lifecycle==='finished'&&(old.lifecycle==='interrupted'||(next.endedAt??'')>=(old.endedAt??''));}
export class MemoryDiagnosticStore implements DiagnosticStore {
 instances=new Map<string,number>();events=new Map<string,DiagnosticEvent>();calls=new Map<string,DiagnosticCall>();
 async append(e:DiagnosticEvent){if(this.events.has(e.eventId))return;this.events.set(e.eventId,copy(e));if(e.call){const old=this.calls.get(e.call.callId);if(newerCall(old,e.call))this.calls.set(e.call.callId,copy(e.call));}}
 async list(q:DiagnosticQuery,now=Date.now()){return[...this.calls.values()].filter(c=>matches(c,q,now)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.callId.localeCompare(a.callId)).slice(0,Math.min(q.limit??50,100)).map(copy);}
 async detail(tenant:string,id:string,now=Date.now()){const call=this.calls.get(id);if(!call||call.tenantId!==tenant||Date.parse(call.expiresAt)<=now)return;return{call:copy(call),events:[...this.events.values()].filter(e=>e.tenantId===tenant&&e.callId===id&&Date.parse(e.expiresAt)>now).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).map(copy),children:[...this.calls.values()].filter(c=>c.tenantId===tenant&&c.parentId===id&&Date.parse(c.expiresAt)>now).map(copy)};}
 async cleanup(now=Date.now(),limit=500){let n=0;for(const [id,e]of this.events)if(n<limit&&Date.parse(e.expiresAt)<=now){this.events.delete(id);n++;}for(const [id,c]of this.calls)if(n<limit&&Date.parse(c.expiresAt)<=now){this.calls.delete(id);n++;}return n;}
 async abandoned(instance:string,before:string,now=Date.now()){return[...this.calls.values()].filter(c=>c.instanceId!==instance&&(this.instances.get(c.instanceId)??0)<Date.parse(before)&&c.lifecycle==='started'&&c.startedAt<before&&Date.parse(c.expiresAt)>now).slice(0,500).map(copy);}
 async ping(){}
 async heartbeat(instance:string,now=Date.now()){this.instances.set(instance,now);}
}
export class PostgresDiagnosticStore implements DiagnosticStore {
 constructor(readonly db:SqlClient,readonly cipher:DiagnosticCipher){}
 async append(e:DiagnosticEvent){const payload=this.cipher.seal(e,`event:${e.eventId}`),c=e.call;
  await this.db.query(`WITH inserted AS (
   INSERT INTO diagnostic_events(event_id,trace_id,call_id,tenant_id,actor_id,event_type,occurred_at,expires_at,instance_id,schema_version,details_cipher)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10) ON CONFLICT(event_id) DO NOTHING RETURNING event_id
  ), projected AS (
   INSERT INTO diagnostic_calls(call_id,tenant_id,actor_id,trace_id,parent_id,instance_id,started_at,expires_at,lifecycle,metadata)
   SELECT $11::uuid,$4,$5,$2,$12::uuid,$9,$13::timestamptz,$14::timestamptz,$15,$16::jsonb FROM inserted WHERE $11::uuid IS NOT NULL
   ON CONFLICT(call_id) DO UPDATE SET lifecycle=EXCLUDED.lifecycle,metadata=EXCLUDED.metadata
   WHERE diagnostic_calls.lifecycle='started' OR (EXCLUDED.lifecycle='finished' AND (diagnostic_calls.lifecycle='interrupted' OR COALESCE(EXCLUDED.metadata->>'endedAt','')>=COALESCE(diagnostic_calls.metadata->>'endedAt',''))) RETURNING call_id
  ) INSERT INTO diagnostic_provider_attempts(event_id,tenant_id,call_id,expires_at)
  SELECT event_id,$4,$3::uuid,$8::timestamptz FROM inserted WHERE $6 LIKE 'provider%' ON CONFLICT DO NOTHING`,[e.eventId,e.traceId,e.callId??null,e.tenantId??null,e.actorId??null,e.type,e.occurredAt,e.expiresAt,e.instanceId,payload,c?.callId??null,c?.parentId??null,c?.startedAt??null,c?.expiresAt??null,c?.lifecycle??null,c?JSON.stringify(c):null]);
 }
 async list(q:DiagnosticQuery,now=Date.now()){const args:unknown[]=[q.tenantId,new Date(now).toISOString()],where=['tenant_id=$1','expires_at>$2'];const add=(sql:string,value:unknown)=>{args.push(value);where.push(sql.replace('?',`$${args.length}`));};if(q.from)add('started_at>=?::timestamptz',q.from);if(q.to)add('started_at<=?::timestamptz',q.to);for(const key of fields)if(q[key])add(`metadata->>'${key}'=?`,q[key]);if(q.after){args.push(q.after.startedAt,q.after.callId);where.push(`(started_at,call_id)<($${args.length-1}::timestamptz,$${args.length}::uuid)`);}args.push(Math.min(q.limit??50,100));const r=await this.db.query(`SELECT metadata FROM diagnostic_calls WHERE ${where.join(' AND ')} ORDER BY started_at DESC,call_id DESC LIMIT $${args.length}`,args);return r.rows.map((r:any)=>r.metadata as DiagnosticCall);}
 async detail(tenant:string,id:string,now=Date.now()){const at=new Date(now).toISOString(),r=await this.db.query('SELECT metadata FROM diagnostic_calls WHERE tenant_id=$1 AND call_id=$2 AND expires_at>$3',[tenant,id,at]);if(!r.rows.length)return;const events=await this.db.query('SELECT event_id,details_cipher FROM diagnostic_events WHERE tenant_id=$1 AND call_id=$2 AND expires_at>$3 ORDER BY occurred_at,event_id',[tenant,id,at]),children=await this.db.query('SELECT metadata FROM diagnostic_calls WHERE tenant_id=$1 AND parent_id=$2 AND expires_at>$3 ORDER BY started_at,call_id',[tenant,id,at]);return{call:(r.rows[0] as any).metadata as DiagnosticCall,events:events.rows.map((row:any)=>this.cipher.open(row.details_cipher,`event:${row.event_id}`) as DiagnosticEvent),children:children.rows.map((row:any)=>row.metadata as DiagnosticCall)};}
 async cleanup(now=Date.now(),limit=500){let count=0;for(const [table,key]of [['diagnostic_provider_attempts','event_id'],['diagnostic_events','event_id'],['diagnostic_calls','call_id']]){const r=await this.db.query(`DELETE FROM ${table} WHERE ${key} IN(SELECT ${key} FROM ${table} WHERE expires_at<=$1 ORDER BY expires_at LIMIT $2) RETURNING ${key}`,[new Date(now).toISOString(),limit]);count+=r.rows.length;}return count;}
 async abandoned(instance:string,before:string,now=Date.now()){const r=await this.db.query("SELECT c.metadata FROM diagnostic_calls c LEFT JOIN diagnostic_instances i ON i.instance_id=c.instance_id WHERE c.instance_id<>$1 AND c.lifecycle='started' AND c.started_at<$2 AND c.expires_at>$3 AND (i.heartbeat_at IS NULL OR i.heartbeat_at<$2) ORDER BY c.started_at LIMIT 500",[instance,before,new Date(now).toISOString()]);return r.rows.map((r:any)=>r.metadata as DiagnosticCall);}
 async ping(){await this.db.query('SELECT 1 FROM diagnostic_events LIMIT 1');}
 async heartbeat(instance:string,now=Date.now()){await this.db.query('INSERT INTO diagnostic_instances(instance_id,heartbeat_at) VALUES($1,$2) ON CONFLICT(instance_id) DO UPDATE SET heartbeat_at=EXCLUDED.heartbeat_at',[instance,new Date(now).toISOString()]);}
}
