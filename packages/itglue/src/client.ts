import {providerFetch} from '../../execution/src/index.js';
import {createHash} from 'node:crypto';
import {AppError} from '../../contracts/src/index.js';
import type {ItGlueConfig,Row} from './store.js';
export const bases={us:'https://api.itglue.com',eu:'https://api.eu.itglue.com',au:'https://api.au.itglue.com'};
export interface ItGluePort {request(c:ItGlueConfig,path:string,query?:Row,body?:unknown,guard?:()=>Promise<void>,beforeWrite?:()=>Promise<void>,method?:'GET'|'POST'|'PATCH'):Promise<Row>}
export class ItGlueClient implements ItGluePort {
 private budgets=new Map<string,{calls:number[];blocked:number}>();
 constructor(private fetcher:typeof fetch=fetch,private now=Date.now){this.fetcher=providerFetch('IT Glue',fetcher);}
 async request(c:ItGlueConfig,path:string,query:Row={},body?:unknown,guard:()=>Promise<void>=async()=>{},beforeWrite?:()=>Promise<void>,method:'GET'|'POST'|'PATCH'=body===undefined?'GET':'PATCH'){
  if(!bases[c.region]||!c.key)throw new AppError('precondition_failed','Configure IT Glue credentials first.');
  if(!(path==='/document_images'&&method==='POST')&&!(/^\/document_images\/\d+$/.test(path)&&method==='GET')&&!(/^\/(?:configuration_types|configuration_statuses|contact_types)(\/\d+)?$/.test(path)&&method==='GET')&&!/^\/(organizations|configurations|contacts|flexible_assets|flexible_asset_types|documents|checklists)(\/\d+)?(\/relationships\/(documents|sections|checklists|expirations|flexible_asset_fields)(\/\d+)?)?(\/publish)?$/.test(path))throw new AppError('unsupported_operation','Unsupported IT Glue route.');
  if(path.includes('/relationships/expirations')&&(method!=='GET'||!/^\/organizations\/\d+\/relationships\/expirations$/.test(path)))throw new AppError('unsupported_operation','Unsupported expiration route.');
  await guard();const key=createHash('sha256').update(c.region+c.key).digest('hex'),b=this.budgets.get(key)??{calls:[],blocked:0};b.calls=b.calls.filter(t=>this.now()-t<60000);this.budgets.set(key,b);if(b.blocked>this.now()||b.calls.length>=120)throw new AppError('throttled','IT Glue request budget exhausted.');b.calls.push(this.now());
  const url=new URL(bases[c.region]+path);for(const [k,v]of Object.entries(query))url.searchParams.set(k,String(v));if(method!=='GET')await beforeWrite?.();
  let r:Response;try{r=await this.fetcher(url,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{'x-api-key':c.key,'content-type':'application/vnd.api+json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw new AppError('dependency_unavailable','IT Glue did not return a confirmed response.');}
  if(r.status===429){const h=r.headers.get('retry-after')??'',seconds=Number(h),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(h)-this.now();b.blocked=this.now()+Math.max(60000,Math.min(Number.isFinite(delay)?delay:60000,300000));throw new AppError('throttled','IT Glue requests temporarily paused.');}
  if(!r.ok)throw new AppError(r.status===401||r.status===403?'forbidden':r.status===404?'not_found_or_inaccessible':'dependency_unavailable','IT Glue request failed.');
  const reader=r.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];if(reader)while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2_000_000){await reader.cancel();throw new AppError('dependency_unavailable','IT Glue response exceeds the size limit.');}chunks.push(part.value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new AppError('dependency_unavailable','IT Glue returned invalid JSON.');}
 }
}
