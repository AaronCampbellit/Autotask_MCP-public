import {providerFetch} from '../../execution/src/index.js';
import {createHash} from 'node:crypto';
import {AppError} from '../../contracts/src/index.js';
import type {RmmConfig,Row} from './store.js';
export const platforms=['zinfandel','vidal','merlot','concord','pinotage','syrah'] as const;
export type RmmQuery=Record<string,string|number|boolean|string[]|number[]>;
export interface RmmPort {request(c:RmmConfig,path:string,query?:RmmQuery,body?:unknown,guard?:()=>Promise<void>,beforeWrite?:()=>Promise<void>,method?:'GET'|'PUT'|'POST'|'DELETE'):Promise<Row>}
/** Per-process provider budget; deliberately below the shared upstream account limit. */
export class RmmClient implements RmmPort {
 private token?:{identity:string;value:string;expires:number};private loading?:Promise<void>;
 private requests:number[]=[];private writes:number[]=[];private blockedUntil=0;
 constructor(private fetcher:typeof fetch=fetch,private now=Date.now){this.fetcher=providerFetch('Datto RMM',fetcher);}
 private admit(write:boolean){const n=this.now();this.requests=this.requests.filter(t=>n-t<60000);this.writes=this.writes.filter(t=>n-t<60000);if(n<this.blockedUntil||this.requests.length>=120||(write&&this.writes.length>=20))throw new AppError('throttled','RMM request capacity is temporarily unavailable. Try again later.');this.requests.push(n);if(write)this.writes.push(n);}
 private async send(url:string,init:RequestInit):Promise<Row>{
  let r:Response;try{r=await this.fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new AppError('dependency_unavailable','RMM request did not return a confirmed response.');}
  if(r.status===429){const retry=Number(r.headers.get('retry-after'));this.blockedUntil=this.now()+Math.max(60000,Number.isFinite(retry)?Math.min(retry*1000,300000):60000);throw new AppError('throttled','RMM rate limit reached. Requests are paused temporarily.');}
  if(r.status===403){this.blockedUntil=this.now()+300000;throw new AppError('forbidden','RMM denied access. Check API permissions; requests are paused temporarily.');}
  if(r.status===401)throw new AppError('unauthenticated','RMM authentication failed. Check the saved credentials.');
  if(r.status===404)throw new AppError('not_found_or_inaccessible','The RMM record was not found or is inaccessible.');
  if(!r.ok)throw new AppError('dependency_unavailable','RMM could not complete the request.');
  const reader=r.body?.getReader();if(!reader)return{};let length=0;const chunks:Uint8Array[]=[];while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>2_000_000){await reader.cancel();throw new AppError('dependency_unavailable','RMM response exceeds the allowed size.');}chunks.push(part.value);}
  const text=Buffer.concat(chunks).toString('utf8');if(!text)return{};try{return JSON.parse(text);}catch{throw new AppError('dependency_unavailable','RMM returned an invalid response.');}
 }
 async request(c:RmmConfig,path:string,query:RmmQuery={},body?:unknown,guard:()=>Promise<void>=async()=>{},beforeWrite?:()=>Promise<void>,method:'GET'|'PUT'|'POST'|'DELETE'=body===undefined?'GET':'PUT'){
  if(!platforms.includes(c.platform as any)||!c.key||!c.secret)throw new AppError('precondition_failed','Add RMM credentials in the console first.');
  if(path==='/v2/user/resetApiKeys')throw new AppError('unsupported_operation','API key reset is excluded.');
  if(!/^\/v2\/[A-Za-z0-9_\-/]+$/.test(path))throw new AppError('invalid_input','Unsupported RMM route.');
  const base=`https://${c.platform}-api.centrastage.net`,identity=createHash('sha256').update(JSON.stringify([c.platform,c.version,c.key,c.secret])).digest('hex');
  if(!this.token||this.token.identity!==identity||this.token.expires<this.now()+60000){
   if(this.loading)await this.loading;
   if(!this.token||this.token.identity!==identity||this.token.expires<this.now()+60000){this.loading=(async()=>{await guard();this.admit(false);const token=await this.send(base+'/auth/oauth/token',{method:'POST',headers:{authorization:'Basic '+Buffer.from('public-client:public').toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',username:c.key,password:c.secret}).toString()});if(typeof token.access_token!=='string'||!token.access_token)throw new AppError('dependency_unavailable','RMM did not return an access token.');this.token={identity,value:token.access_token,expires:this.now()+Math.min(typeof token.expires_in==='number'?token.expires_in:360000,360000)*1000};})();try{await this.loading;}finally{this.loading=undefined;}}
  }
  await guard();this.admit(method!=='GET');const url=new URL(base+'/api'+path);for(const [k,v] of Object.entries(query)){for(const item of Array.isArray(v)?v:[v])url.searchParams.append(k,String(item));}
  if(method!=='GET'&&beforeWrite)await beforeWrite();
  try{return await this.send(url.href,{method,headers:{authorization:`Bearer ${this.token!.value}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch(e){if(e instanceof AppError&&e.code==='unauthenticated')this.token=undefined;throw e;}
 }
}
