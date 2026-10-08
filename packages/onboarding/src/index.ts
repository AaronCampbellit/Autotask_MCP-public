import {providerFetch} from '../../execution/src/index.js';
import {AppError,type Principal} from '../../contracts/src/index.js';
import type {RequestBudgetPort} from '../../autotask/src/budget.js';
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=()=>new AppError('dependency_unavailable','The employee directory is unavailable. No mapping was changed.');
async function json(response:Response){
 if(!response.ok){await response.body?.cancel();if(response.status===403)throw new AppError('forbidden','Directory access was denied. For Entra, grant Microsoft Graph User.Read.All application permission and admin consent to the dashboard app.');throw fail();}
 const reader=response.body?.getReader();if(!reader)throw fail();let length=0;const chunks:Uint8Array[]=[];
 try{for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>4_000_000)throw fail();chunks.push(r.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel();}
}
export interface DirectoryUser{id:string;displayName:string;mail:string|null;userPrincipalName:string;accountEnabled:boolean;userType:string}
export class EntraDirectory {
 private token?:{value:string;expires:number};
 constructor(private readonly config:{tenantId:string;clientId:string;clientSecret:string;fetch?:typeof fetch}){if(!guid.test(config.tenantId)||!guid.test(config.clientId)||!config.clientSecret)throw fail();}
 private async get(path:string){
 try{
 const fetcher=providerFetch('Microsoft Graph',this.config.fetch??fetch);
 if(!this.token||this.token.expires<=Date.now()){
 const r=await json(await fetcher(`https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,grant_type:'client_credentials',scope:'https://graph.microsoft.com/.default'})}));
 if(typeof r.access_token!=='string'||!r.access_token||!Number.isFinite(r.expires_in)||r.expires_in<=60)throw fail();this.token={value:r.access_token,expires:Date.now()+Math.min(r.expires_in-60,3000)*1000};
 }
 const url=new URL(path,'https://graph.microsoft.com/v1.0/');if(url.origin!=='https://graph.microsoft.com'||url.username||url.password||url.hash||!/^\/v1\.0\/users(?:\/[0-9a-f-]{36})?$/.test(url.pathname))throw fail();
 return await json(await fetcher(url,{method:'GET',headers:{authorization:`Bearer ${this.token.value}`},redirect:'error',signal:AbortSignal.timeout(10000)}));
 }catch(e){if(e instanceof AppError)throw e;throw fail();}
 }
 private user(v:any):DirectoryUser {if(!v||!guid.test(v.id)||typeof v.displayName!=='string'||typeof v.userPrincipalName!=='string'||typeof v.accountEnabled!=='boolean'||typeof v.userType!=='string'||(v.mail!==null&&typeof v.mail!=='string'))throw fail();return{id:v.id,displayName:v.displayName,mail:v.mail,userPrincipalName:v.userPrincipalName,accountEnabled:v.accountEnabled,userType:v.userType};}
 async list(){const users:DirectoryUser[]=[];let path:string|undefined='users?$top=999&$select=id,displayName,mail,userPrincipalName,accountEnabled,userType';const seen=new Set<string>();
 for(let page=0;path&&page<10;page++){if(seen.has(path))throw fail();seen.add(path);const result=await this.get(path);if(!Array.isArray(result.value))throw fail();users.push(...result.value.map((v:unknown)=>this.user(v)));path=result['@odata.nextLink'];if(path!==undefined&&typeof path!=='string')throw fail();}
 if(path||new Set(users.map(u=>u.id)).size!==users.length)throw fail();return users.filter(u=>u.accountEnabled&&u.userType==='Member');}
 async verify(id:string){if(!guid.test(id))throw new AppError('invalid_input','Select a valid Entra user.');const u=this.user(await this.get(`users/${id}?$select=id,displayName,mail,userPrincipalName,accountEnabled,userType`));if(u.id.toLowerCase()!==id.toLowerCase()||!u.accountEnabled||u.userType!=='Member')throw new AppError('identity_mapping_invalid','Select an enabled Entra member account.');return u;}
}
export class AutotaskDirectory {
 private companies?:{ids:number[];expires:number};
 private companyLoad?:Promise<void>;
 constructor(private readonly config:{tenantId:string;baseUrl:string;username:string;secret:string;integrationCode:string;budget:RequestBudgetPort;fetch?:typeof fetch}){if(!/^https:\/\/webservices\d+\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(config.baseUrl))throw fail();}
 private async list(entity:'Resources'|'Companies',actorKey:string, names=false){
 const rows:any[]=[],seen=new Set<number>(),pages=new Set<string>();
 const fields=entity==='Companies'?(names?['id','companyName']:['id']):['id','firstName','lastName','email','isActive'];
 let url:URL|undefined=new URL(`${entity}/query?${new URLSearchParams({search:JSON.stringify({MaxRecords:500,IncludeFields:fields,filter:[{op:'gte',field:'id',value:entity==='Companies'?0:1}]})})}`,this.config.baseUrl);
 for(let page=0;page<20;page++){
 if(!url||pages.has(url.href))throw fail();pages.add(url.href);
 await this.config.budget.take({tenantId:this.config.tenantId,actorKey});
 let response:any;try{response=await json(await providerFetch('Autotask onboarding',this.config.fetch??fetch)(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{UserName:this.config.username,Secret:this.config.secret,ApiIntegrationCode:this.config.integrationCode,Accept:'application/json'}}));}catch(e){if(e instanceof AppError)throw e;throw fail();}
 if(!Array.isArray(response.items)||response.items.length>500||!response.pageDetails||!('nextPageUrl' in response.pageDetails))throw fail();for(const row of response.items){if(!Number.isSafeInteger(row.id)||row.id<0||seen.has(row.id))throw fail();seen.add(row.id);rows.push(row);}
 if(response.pageDetails.nextPageUrl===null)return rows;
 if(typeof response.pageDetails.nextPageUrl!=='string')throw fail();const next=new URL(response.pageDetails.nextPageUrl,this.config.baseUrl),base=new URL(this.config.baseUrl);
 if(next.origin!==base.origin||next.username||next.password||next.hash||next.pathname!==base.pathname+entity+'/query/nextPage')throw fail();url=next;
 }throw new AppError('unsupported_operation','The complete directory exceeds its supported size. No partial company scope was applied.');
 }
 async resources(actorKey:string){return(await this.list('Resources',actorKey)).filter(r=>r.isActive===true&&r.id>0).map(r=>{if(typeof r.firstName!=='string'||typeof r.lastName!=='string'||(r.email!==null&&typeof r.email!=='string'))throw fail();return{id:r.id,displayName:`${r.firstName} ${r.lastName}`.trim(),email:r.email};});}
 async companyChoices(actorKey:string){return(await this.list('Companies',actorKey,true)).map(r=>{if(typeof r.companyName!=='string'||!r.companyName.trim())throw fail();return{id:r.id,name:r.companyName};}).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);}
 async scope(p:Principal):Promise<Principal>{if(!p.allCompanies)return p;if(p.tenantId!==this.config.tenantId)throw fail();if(!this.companies||this.companies.expires<=Date.now()){this.companyLoad??=(async()=>{const rows=await this.list('Companies',`${p.tenantId}:${p.objectId}`);if(!rows.length)throw fail();this.companies={ids:rows.map(r=>r.id).sort((a,b)=>a-b),expires:Date.now()+60000};})().finally(()=>{this.companyLoad=undefined;});await this.companyLoad;}return{...p,companyIds:[...this.companies!.ids]};}
}
