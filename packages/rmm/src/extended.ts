import {withReconciliation} from '../../execution/src/index.js';
import {createHash,randomUUID} from 'node:crypto';
import {AppError,actorKey,type Principal} from '../../contracts/src/index.js';
import {assertArea} from '../../policy/src/areas.js';
import {assertCapability,reauthorize} from '../../policy/src/index.js';
import type {RmmService} from './service.js';
import type {RmmConfig,RmmEntry,Row} from './store.js';
import type {RmmQuery} from './client.js';
import {project,redact} from './projection.js';
import {rmmAdminTools,rmmNativeWrites} from './extended-contracts.js';
import {runComposite} from './composites.js';
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
export const fingerprint=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
const denied=()=>new AppError('not_found_or_inaccessible','The RMM record is not accessible in your current scope.');
export async function gate(s:RmmService,p:Principal,c:RmmConfig,name:string){
 const fresh=await reauthorize(p,s.principals);await s.guard(fresh,c);
 if(name.startsWith('rmm_ticket_')){assertCapability(fresh,'operational.read');assertArea(fresh,'tickets',name==='rmm_ticket_diagnostic_attach');assertArea(fresh,'configuration');if(name==='rmm_ticket_diagnostic_attach')assertCapability(fresh,'tickets.write');}
 if(rmmAdminTools.has(name)){assertCapability(fresh,'platform.manage');await s.administrator(fresh);}
 if((rmmNativeWrites.has(name)&&name!=='rmm_ticket_diagnostic_run')||name==='rmm_ticket_device_link')assertCapability(fresh,'rmm.write');
 if(name==='rmm_ticket_diagnostic_run')assertCapability(fresh,'rmm.execute');
}
export function continuation(s:RmmService,p:Principal,c:RmmConfig,name:string,a:Row,position:Row){return s.cipher.seal({binding:fingerprint({actor:actorKey(p),policy:p.policyVersion,mapping:p.mappingVersion,companies:p.companyIds,version:c.version,name,args:{...a,cursor:undefined}}),expires:Date.now()+900000,position},`rmm:extended:${actorKey(p)}`);}
export function position(s:RmmService,p:Principal,c:RmmConfig,name:string,a:Row):Row{
 if(!a.cursor)return {page:0};
 const v=s.cipher.open(a.cursor,`rmm:extended:${actorKey(p)}`) as Row,expected=s.cipher.open(continuation(s,p,c,name,a,{}),`rmm:extended:${actorKey(p)}`) as Row;
 if(v.binding!==expected.binding||v.expires<Date.now()||!v.position||typeof v.position!=='object')throw new AppError('conflict','RMM continuation expired or scope or filters changed.');return v.position;
}
async function scopeRows(s:RmmService,p:Principal,c:RmmConfig,rows:Row[],kind:'devices'|'alerts'|'sites'){
 const allowed=rows.filter(r=>{const site=kind==='devices'?r.siteUid:kind==='alerts'?r.alertSourceInfo?.siteUid:r.uid;return typeof site==='string'&&!!c.sites[site]&&p.companyIds.includes(c.sites[site]!.companyId);});
 for(const id of new Set<string>(allowed.map(r=>kind==='devices'?r.siteUid:kind==='alerts'?r.alertSourceInfo.siteUid:r.uid)))await s.site(p,c,id);
 if(kind==='alerts')for(const row of allowed){const uid=row.alertSourceInfo?.deviceUid;if(typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw denied();const d=await s.device(p,c,uid);if(d.siteUid!==row.alertSourceInfo.siteUid)throw denied();}
 return allowed;
}
export function entryView(s:RmmService,e:RmmEntry){return {...s.envelope({operation_id:e.id,operation:e.kind,state:e.data.state??'succeeded',created_at:e.createdAt,...(e.data.result?{result:e.data.result}:{})}),status:e.data.state??'succeeded',warnings:e.data.state==='unknown_outcome'?['Dispatch or verification was not confirmed. Inspect native state; do not repeat this change under a new request key.']:[]};}
export async function reserve(s:RmmService,p:Principal,c:RmmConfig,name:string,a:Row,data:Row={},actor=actorKey(p)){
 const hash=fingerprint({account:c.accountUid,name,input:a,actor:actorKey(p),policy:p.policyVersion,mapping:p.mappingVersion});
 const saved=await s.store.reserveEntry(p.tenantId,{id:randomUUID(),actor,key:a.request_key,kind:name,accountUid:c.accountUid!,createdAt:new Date().toISOString(),data:{...data,hash,state:'reserved'}});
 if(saved.entry.data.hash!==hash||saved.entry.accountUid!==c.accountUid||saved.entry.kind!==name)throw new AppError('conflict','The request key already identifies a different RMM operation.');return saved;
}
async function mutate(s:RmmService,p:Principal,c:RmmConfig,name:string,a:Row){
 let path='',method:'PUT'|'POST'|'DELETE'='POST',body:unknown,deviceUid=a.device_uid,siteUid=a.site_uid,observedSite:string|undefined;
 const check=async()=>{await gate(s,p,c,name);if(deviceUid){const d=await s.device(p,c,deviceUid);if(observedSite!==undefined&&d.siteUid!==observedSite)throw new AppError('conflict','The device moved while the change was queued.');observedSite=d.siteUid;if(name==='rmm_device_warranty_set'&&(d.warrantyDate??null)!==a.expected_warranty_date)throw new AppError('conflict','The warranty changed since the request was prepared.');if(name==='rmm_device_move'&&d.siteUid!==a.expected_site_uid)throw new AppError('conflict','The device moved since the request was prepared.');}if(siteUid)await s.site(p,c,siteUid);if(name==='rmm_alert_resolve'){const alert=await s.run(p,'rmm_alert_get',{alert_uid:a.alert_uid});deviceUid=alert.data.alertSourceInfo.deviceUid;}
  if(name==='rmm_site_update'){const current=await s.call(p,c,`/v2/site/${siteUid}`);if(current.uid!==siteUid||Object.keys(a.fields).some(k=>(current[k]??null)!==a.expected[k]))throw new AppError('conflict','The site changed since the request was prepared.');}
  if(name==='rmm_variable_update'||name==='rmm_variable_delete'){
   let found=false;for(let page=0;page<100;page++){const variables=await s.call(p,c,a.scope==='site'?`/v2/site/${siteUid}/variables`:'/v2/account/variables',{page,max:100});if(!Array.isArray(variables.variables)||!variables.pageDetails||!Object.hasOwn(variables.pageDetails,'nextPageUrl'))throw new AppError('dependency_unavailable','Invalid variable catalog.');if(variables.variables.some((v:Row)=>v.id===a.variable_id)){found=true;break;}if(!variables.pageDetails.nextPageUrl)break;}if(!found)throw denied();
  }
 };
 if(name==='rmm_alert_resolve')path=`/v2/alert/${a.alert_uid}/resolve`;
 if(name==='rmm_device_warranty_set'){path=`/v2/device/${deviceUid}/warranty`;body={warrantyDate:a.warranty_date};}
 if(name==='rmm_device_udf_set'){path=`/v2/device/${deviceUid}/udf`;body=a.fields;}
 if(name==='rmm_device_move'){path=`/v2/device/${deviceUid}/site/${siteUid}`;method='PUT';}
 if(name==='rmm_site_create'){path='/v2/site';method='PUT';const {request_key,...fields}=a;body=fields;}
 if(name==='rmm_site_update'){path=`/v2/site/${siteUid}`;body=a.fields;}
 if(name.startsWith('rmm_variable_')){path=a.scope==='site'?`/v2/site/${siteUid}/variable`:'/v2/account/variable';if(name==='rmm_variable_create'){method='PUT';body={name:a.name,value:a.value,masked:a.masked};}else{path+=`/${a.variable_id}`;if(name==='rmm_variable_delete')method='DELETE';else body={name:a.name,value:a.value};}}
 if(name==='rmm_site_proxy_set'){path=`/v2/site/${siteUid}/settings/proxy`;body=a.settings;}
 if(name==='rmm_site_proxy_delete'){path=`/v2/site/${siteUid}/settings/proxy`;method='DELETE';}
 if(!path)throw new AppError('unsupported_operation','RMM write is not registered.');
 const saved=await reserve(s,p,c,name,a,{deviceUid,siteUid,admin:rmmAdminTools.has(name)});if(!saved.created){if(deviceUid)await s.device(p,c,deviceUid);if(siteUid)await s.site(p,c,siteUid);if(name==='rmm_alert_resolve')await s.run(p,'rmm_alert_get',{alert_uid:a.alert_uid});return entryView(s,saved.entry);}
 const e=saved.entry;let dispatched=false;
 try{
  await check();e.data.deviceUid=deviceUid;e.data.state='dispatching';await s.store.finishEntry(p.tenantId,e);
  const raw=await s.port.request(c,path,{},body,check,async()=>{await check();dispatched=true;},method);
  e.data.state='accepted';e.data.result={native_response_received:true,verified:false};
  return await withReconciliation(async()=>{
  if(name==='rmm_alert_resolve'){const result=await s.run(p,'rmm_alert_get',{alert_uid:a.alert_uid});if(result.data.resolved===true){e.data.state='succeeded';e.data.result.verified=true;}}
  if(name==='rmm_device_move'){const result=await s.device(p,c,deviceUid);if(result.siteUid===siteUid){e.data.state='succeeded';e.data.result.verified=true;}}
  if(name==='rmm_device_warranty_set'){const result=await s.device(p,c,deviceUid);if(String(result.warrantyDate).slice(0,10)===a.warranty_date){e.data.state='succeeded';e.data.result.verified=true;}}
  if(name==='rmm_site_update'){const result=await s.call(p,c,`/v2/site/${siteUid}`);if(result.uid===siteUid&&Object.keys(a.fields).every(k=>result[k]===a.fields[k])){e.data.state='succeeded';e.data.result.verified=true;}}
  if(name==='rmm_site_create'&&typeof raw.uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(raw.uid))e.data.result.site_uid=raw.uid;
  // Never persist or echo mutation responses: variable and proxy responses may contain secrets.
  await gate(s,p,c,name);await s.store.finishEntry(p.tenantId,e);return entryView(s,e);});
 }catch(error){e.data.state=dispatched?'unknown_outcome':'failed';await s.store.finishEntry(p.tenantId,e);if(!dispatched)throw error;return entryView(s,e);}
}
export async function runExtended(s:RmmService,p:Principal,c:RmmConfig,name:string,a:Row):Promise<any>{
 await gate(s,p,c,name);
 if(name.startsWith('rmm_ticket_')||name.startsWith('rmm_device_snapshot_')||name==='rmm_fleet_software_search')return runComposite(s,p,c,name,a);
 if(rmmNativeWrites.has(name))return mutate(s,p,c,name,a);
 if(name==='rmm_operation_get'){
  const e=await s.store.entry(p.tenantId,actorKey(p),a.operation_id);if(!e||e.accountUid!==c.accountUid)throw denied();
  await gate(s,p,c,e.kind);if(e.data.deviceUid)await s.device(p,c,e.data.deviceUid);if(e.data.siteUid)await s.site(p,c,e.data.siteUid);
  if(e.data.ticketId){if(!s.ticketBridge)throw denied();const ctx=await s.ticketBridge.context(p,{kind:'id',id:e.data.ticketId});const device=await s.device(p,c,e.data.deviceUid);if(ctx.ticket.id!==e.data.ticketId||ctx.asset?.id!==e.data.assetId||c.sites[device.siteUid]?.companyId!==ctx.ticket.companyID)throw denied();}
  return entryView(s,e);
 }
 if(name==='rmm_device_lookup'||name==='rmm_device_audit_by_mac'){
  const byMac=!!a.mac_address,path=byMac?`/v2/device/macAddress/${a.mac_address}`:`/v2/device/id/${a.device_id}`,raw=await s.call(p,c,path);
  if(byMac&&!Array.isArray(raw))throw new AppError('dependency_unavailable','Invalid MAC lookup response.');
  const rows=await scopeRows(s,p,c,byMac?raw as any:[raw],'devices');const data=[];
  for(const row of rows){if(typeof row.uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(row.uid))throw denied();if(!byMac&&row.id!==a.device_id)throw denied();const current=await s.device(p,c,row.uid);if(current.siteUid!==row.siteUid)throw denied();data.push(name==='rmm_device_audit_by_mac'?{device_uid:row.uid,audit:(await s.run(p,'rmm_device_audit_get',{device_uid:row.uid})).data}:project('/v2/device/{deviceUid}',row));}
  await gate(s,p,c,name);return s.envelope({devices:data});
 }
 const pos=position(s,p,c,name,a);let path='',template='',collection:string|undefined,q:RmmQuery={};
 if(a.site_uid)await s.site(p,c,a.site_uid);if(a.device_uid)await s.device(p,c,a.device_uid);
 if(name==='rmm_site_get')path=template='/v2/site/{siteUid}';
 if(name==='rmm_site_settings_get')path=template='/v2/site/{siteUid}/settings';
 if(name==='rmm_variable_list'){path=template=a.scope==='site'?'/v2/site/{siteUid}/variables':'/v2/account/variables';collection='variables';}
 if(name==='rmm_account_get')path=template='/v2/account';
 if(name==='rmm_account_user_list'){path=template='/v2/account/users';collection='users';}
 if(name==='rmm_network_mapping_list'){path=template='/v2/account/dnet-site-mappings';collection='dnetSiteMappings';}
 if(name==='rmm_system_get')path=template=`/v2/system/${a.kind}`;
 if(name==='rmm_filter_list'){path=template=`/v2/filter/${a.kind}-filters`;collection='filters';}
 if(name==='rmm_account_device_search'){path=template='/v2/account/devices';collection='devices';for(const [k,v]of Object.entries({filterId:a.filter_id,hostname:a.hostname,deviceType:a.device_type,operatingSystem:a.operating_system,siteName:a.site_name}))if(v!==undefined)q[k]=v;}
 if(name==='rmm_account_alert_list'){path=template=`/v2/account/alerts/${a.state}`;collection='alerts';}
 if(name==='rmm_activity_list'){path=template='/v2/activity-logs';collection='activities';q={size:a.page_size,order:a.order,...pos.activity};for(const [k,v]of Object.entries({from:a.from,until:a.until,searchQuery:a.search_query,entities:a.entities,categories:a.categories,actions:a.actions,siteIds:a.site_ids,userIds:a.user_ids}))if(v!==undefined)q[k]=v;}
 if(name==='rmm_external_job_get')path=template='/v2/job/{jobUid}';
 if(name==='rmm_job_component_list'){path=template='/v2/job/{jobUid}/components';collection='jobComponents';}
 if(name==='rmm_external_job_result_get')path=template='/v2/job/{jobUid}/results/{deviceUid}';
 if(name==='rmm_external_job_output_get')path=template=`/v2/job/{jobUid}/results/{deviceUid}/${a.stream}`;
 if(!path)throw new AppError('unsupported_operation','RMM read is not registered.');
 path=path.replace('{siteUid}',a.site_uid).replace('{deviceUid}',a.device_uid).replace('{jobUid}',a.job_uid);
 if(collection&&name!=='rmm_activity_list'){if(!Number.isInteger(pos.page)||pos.page<0||pos.page>999)throw new AppError('conflict','Invalid RMM continuation.');q={...q,page:pos.page,max:a.page_size};}
 // Prove the job/device relationship before retrieving potentially sensitive external output.
 if(name==='rmm_external_job_output_get'){const result=await s.call(p,c,`/v2/job/${a.job_uid}/results/${a.device_uid}`);if(result.jobUid!==a.job_uid||result.deviceUid!==a.device_uid)throw denied();}
 const raw=await s.call(p,c,path,q);
 if(name==='rmm_external_job_get'&&raw.uid!==a.job_uid||name==='rmm_external_job_result_get'&&(raw.jobUid!==a.job_uid||raw.deviceUid!==a.device_uid)||name==='rmm_site_get'&&raw.uid!==a.site_uid||name==='rmm_account_get'&&raw.uid!==c.accountUid)throw denied();
 if(raw.error)throw new AppError('dependency_unavailable','RMM activity data is unavailable.');
 let data=project(template,raw),next:string|null=null;
 if(collection){
  if(!raw.pageDetails||!Object.hasOwn(raw.pageDetails,'nextPageUrl')||!Array.isArray(raw[collection]))throw new AppError('dependency_unavailable','Invalid RMM page response.');
  if(collection==='devices'||collection==='alerts')data[collection]=await scopeRows(s,p,c,data[collection],collection);
  if(collection==='variables')data.variables=raw.variables.map((v:Row)=>({id:v.id,name:redact(String(v.name??'')),masked:v.masked===true,value:'[redacted]'}));
  if(raw.pageDetails.nextPageUrl){
   let nextPos:Row={page:pos.page+1};
   if(name==='rmm_activity_list'){
    const url=new URL(raw.pageDetails.nextPageUrl,`https://${c.platform}-api.centrastage.net`);
    if(url.pathname!=='/api/v2/activity-logs'&&url.pathname!=='/v2/activity-logs')throw new AppError('dependency_unavailable','Invalid activity continuation.');
    const searchAfter=url.searchParams.getAll('searchAfter');if(!searchAfter.length||searchAfter.join('').length>8000)throw new AppError('dependency_unavailable','Activity continuation is unavailable.');nextPos={activity:{searchAfter,page:'next'}};
   }else if(nextPos.page>999)throw new AppError('dependency_unavailable','RMM catalog exceeds the supported page limit.');
   next=continuation(s,p,c,name,a,nextPos);
  }delete data.pageDetails;
 }
 if(name==='rmm_site_settings_get'&&raw.proxySettings)data.proxySettings={host:redact(String(raw.proxySettings.host??'')),port:raw.proxySettings.port,type:raw.proxySettings.type,username:'[redacted]',password:'[redacted]'};
 if(a.site_uid)await s.site(p,c,a.site_uid);if(a.device_uid)await s.device(p,c,a.device_uid);await gate(s,p,c,name);
 return s.envelope(data,next,[...(name==='rmm_account_device_search'&&a.filter_id?['Datto filter_id overrides its other native search filters. Returned devices are still restricted to enabled sites in your company scope.']:[]),...(collection?['Follow every next_cursor, including after an empty scoped page, for complete coverage.']:[]),...(name==='rmm_variable_list'?['Variable values are intentionally redacted.']:[])]);
}
