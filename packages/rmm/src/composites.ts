import {AppError,actorKey,type Principal} from '../../contracts/src/index.js';
import {assertCapability} from '../../policy/src/index.js';
import {assertArea} from '../../policy/src/areas.js';
import type {RmmService} from './service.js';
import type {RmmConfig,Row,RmmEntry} from './store.js';
import {continuation,position,gate,reserve,entryView,fingerprint} from './extended.js';
const missing=()=>new AppError('not_found_or_inaccessible','The RMM link, snapshot or operation is unavailable in the current scope.');
async function ticketLink(s:RmmService,p:Principal,c:RmmConfig,reference:unknown){
 if(!s.ticketBridge)throw new AppError('unsupported_operation','Ticket integration is not configured.');
 assertArea(p,'tickets');assertArea(p,'configuration');assertCapability(p,'operational.read');
 const ctx=await s.ticketBridge.context(p,reference);
 if(!ctx.asset)return{...ctx,link:undefined,linkedDevice:undefined};
 if(ctx.asset.isActive===false)throw new AppError('precondition_failed','The ticket asset is inactive.');
 const links=await s.store.entries(p.tenantId,'tenant-links',`asset:${ctx.asset.id}`);
 let link=links.find(e=>e.accountUid===c.accountUid&&e.data.companyId===ctx.ticket.companyID&&e.data.assetId===ctx.asset!.id);
 let nativeUid=ctx.asset.rmmDeviceUID;
 if(!nativeUid&&Number.isSafeInteger(ctx.asset.rmmDeviceID)&&ctx.asset.rmmDeviceID>0){const lookup=await s.run(p,'rmm_device_lookup',{device_id:ctx.asset.rmmDeviceID});if(lookup.data.devices.length!==1)throw missing();nativeUid=lookup.data.devices[0].uid;}
 if(nativeUid){
  if(typeof nativeUid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(nativeUid))throw new AppError('precondition_failed','The native asset RMM identifier is invalid.');
  if(link&&link.data.deviceUid!==nativeUid)throw new AppError('conflict','The administrator link conflicts with the native Autotask RMM association.');
  link={id:`native:${ctx.asset.id}:${nativeUid}`,actor:'native',key:'native',kind:`asset:${ctx.asset.id}`,accountUid:c.accountUid!,createdAt:'',data:{assetId:ctx.asset.id,companyId:ctx.ticket.companyID,deviceUid:nativeUid}};
 }
 let linkedDevice:Row|undefined;if(link){linkedDevice=await s.device(p,c,link.data.deviceUid);if(c.sites[linkedDevice.siteUid]?.companyId!==ctx.ticket.companyID)throw missing();}
 return{...ctx,link,linkedDevice};
}
async function recheckTicket(s:RmmService,p:Principal,c:RmmConfig,reference:unknown,ctx:Awaited<ReturnType<typeof ticketLink>>){const fresh=await ticketLink(s,p,c,reference);if(fresh.ticket.id!==ctx.ticket.id||fresh.ticket.companyID!==ctx.ticket.companyID||fresh.asset?.id!==ctx.asset?.id||fresh.link?.id!==ctx.link?.id)throw new AppError('conflict','The ticket asset or RMM device link changed.');return fresh;}
function sorted(value:any):any{if(Array.isArray(value))return value.map(sorted).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)]));return value;}
export async function runComposite(s:RmmService,p:Principal,c:RmmConfig,name:string,a:Row):Promise<any>{
 if(name==='rmm_fleet_software_search'){
  const pos=position(s,p,c,name,a);let uid=pos.deviceUid,nextDevice=pos.nextDevice;
  if(!uid){const devices=await s.run(p,'rmm_device_search',{...(a.site_uid?{site_uid:a.site_uid}:{}),page_size:1,...(pos.deviceCursor?{cursor:pos.deviceCursor}:{})});if(devices.data.devices.length>1||devices.data.devices.length===1&&(typeof devices.data.devices[0].uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(devices.data.devices[0].uid)))throw new AppError('dependency_unavailable','RMM returned an invalid device page for the fleet scan.');uid=devices.data.devices[0]?.uid;nextDevice=devices.completeness.next_cursor;if(!uid)return s.envelope({devices:[]},nextDevice?continuation(s,p,c,name,a,{deviceCursor:nextDevice}):null);}
  const device=await s.device(p,c,uid);if(a.site_uid&&device.siteUid!==a.site_uid)throw missing();
  if(device.deviceClass!=='device')return s.envelope({devices:[]},nextDevice?continuation(s,p,c,name,a,{deviceCursor:nextDevice}):null,['This device has a missing or unsupported software-inventory class and was skipped.']);
  const inventory=await s.run(p,'rmm_device_software_list',{device_uid:uid,page_size:a.page_size,...(pos.softwareCursor?{cursor:pos.softwareCursor}:{})});
  const matches=inventory.data.software.filter((v:Row)=>String(v.name??'').toLowerCase().includes(a.name.toLowerCase())&&(!a.version||String(v.version??'').toLowerCase().includes(a.version.toLowerCase())));
  const next=inventory.completeness.next_cursor?{deviceUid:uid,nextDevice,softwareCursor:inventory.completeness.next_cursor}:nextDevice?{deviceCursor:nextDevice}:null;
  await gate(s,p,c,name);return s.envelope({devices:matches.length?[{device_uid:uid,hostname:device.hostname,software:matches}]:[]},next?continuation(s,p,c,name,a,next):null,['Scans one software page on one authorized device per call. Follow every cursor, including empty pages. Inventory is audited, not a live application scan.']);
 }
 if(name.startsWith('rmm_device_snapshot_')){
  const device=await s.device(p,c,a.device_uid);
  if(name==='rmm_device_snapshot_save'){
   const summary=await s.run(p,'rmm_device_get',{device_uid:a.device_uid}),audit=await s.run(p,'rmm_device_audit_get',{device_uid:a.device_uid}),software:Row[]=[];
   if(device.deviceClass==='device'){let cursor:string|undefined;for(let page=0;page<100;page++){const result=await s.run(p,'rmm_device_software_list',{device_uid:a.device_uid,page_size:100,...(cursor?{cursor}:{})});software.push(...result.data.software);cursor=result.completeness.next_cursor??undefined;if(!cursor)break;if(page===99)throw new AppError('precondition_failed','Software inventory exceeds the snapshot scan limit. No complete snapshot was saved.');}}
   const payload={summary:summary.data,audit:audit.data,software,software_available:device.deviceClass==='device'};if(Buffer.byteLength(JSON.stringify(payload))>400000)throw new AppError('precondition_failed','Snapshot exceeds the storage size limit.');
   const fresh=await s.device(p,c,a.device_uid);if(fresh.siteUid!==device.siteUid)throw missing();await gate(s,p,c,name);
   const saved=await reserve(s,p,c,name,a,{deviceUid:a.device_uid,siteUid:device.siteUid,snapshot:payload});if(!saved.created)return entryView(s,saved.entry);
   saved.entry.data.state='succeeded';saved.entry.data.result={snapshot_id:saved.entry.id,device_uid:a.device_uid};await s.store.finishEntry(p.tenantId,saved.entry);return entryView(s,saved.entry);
  }
  if(name==='rmm_device_snapshot_list'){const entries=await s.store.entries(p.tenantId,actorKey(p),'rmm_device_snapshot_save');return s.envelope({snapshots:entries.filter(e=>e.accountUid===c.accountUid&&e.data.deviceUid===a.device_uid&&e.data.state==='succeeded').map(e=>({snapshot_id:e.id,created_at:e.createdAt}))},null,['Shows matching snapshots among the latest 100 snapshots saved by this employee. No automatic sampling is enabled.']);}
  const before=await s.store.entry(p.tenantId,actorKey(p),a.before_id),after=await s.store.entry(p.tenantId,actorKey(p),a.after_id);
  for(const e of [before,after])if(!e||e.accountUid!==c.accountUid||e.kind!=='rmm_device_snapshot_save'||e.data.deviceUid!==a.device_uid||e.data.state!=='succeeded')throw missing();
  const changes:Row[]=[];let truncated=false;
  const diff=(x:any,y:any,path:string)=>{if(fingerprint(x??null)===fingerprint(y??null))return;if(changes.length>=100){truncated=true;return;}if(x&&y&&!Array.isArray(x)&&!Array.isArray(y)&&typeof x==='object'&&typeof y==='object'){for(const key of new Set([...Object.keys(x),...Object.keys(y)]))diff(x[key],y[key],path?`${path}.${key}`:key);}else changes.push({field:path,before:x??null,after:y??null});};
  diff(sorted(before!.data.snapshot),sorted(after!.data.snapshot),'');await gate(s,p,c,name);
  return{...s.envelope({before_id:a.before_id,after_id:a.after_id,before_at:before!.createdAt,after_at:after!.createdAt,changes},null,['Compares stored observations; changes between snapshots and current live state may differ.',...(truncated?['Change output was capped at 100 fields.']:[])]),...(truncated?{status:'partial',completeness:{complete:false,next_cursor:null}}:{})};
 }
 const ctx=await ticketLink(s,p,c,a.ticket);
 if(name==='rmm_ticket_device_link'){
  if(!ctx.asset)throw new AppError('precondition_failed','The ticket must have one verified Autotask asset before linking a device.');
  const d=await s.device(p,c,a.device_uid);if(c.sites[d.siteUid]?.companyId!==ctx.ticket.companyID)throw missing();if(ctx.link?.actor==='native'&&ctx.link.data.deviceUid!==a.device_uid)throw new AppError('conflict','The requested link conflicts with the native asset RMM identifier.');
  await recheckTicket(s,p,c,a.ticket,ctx);await gate(s,p,c,name);
  const saved=await reserve(s,p,c,`asset:${ctx.asset.id}`,a,{deviceUid:a.device_uid,companyId:ctx.ticket.companyID,assetId:ctx.asset.id,createdBy:actorKey(p)},'tenant-links');
  if(saved.created){saved.entry.data.state='succeeded';saved.entry.data.result={asset_id:ctx.asset.id,device_uid:a.device_uid,link_type:'administrator_verified'};await s.store.finishEntry(p.tenantId,saved.entry);}return entryView(s,saved.entry);
 }
 if(name==='rmm_ticket_context'){
  if(!ctx.link)return s.envelope({ticket:ctx.ticket,asset:ctx.asset??null,link_state:'unlinked'},null,['No verified RMM device link exists. An administrator can link the exact device using rmm_ticket_device_link.']);
  const [device,alerts]=await Promise.all([s.run(p,'rmm_device_get',{device_uid:ctx.link.data.deviceUid}),s.run(p,'rmm_device_alert_list',{device_uid:ctx.link.data.deviceUid,state:'open'})]);
  const fresh=await s.freshReads(()=>recheckTicket(s,p,c,a.ticket,ctx));if(fresh.linkedDevice?.siteUid!==device.data.siteUid)throw new AppError('conflict','The device moved while its context was collected.');const result=s.envelope({ticket:ctx.ticket,asset:ctx.asset,link_state:'verified',device:device.data,alerts:alerts.data,alerts_completeness:alerts.completeness},null,alerts.completeness.complete?[]:['Alert context includes one page; use rmm_device_alert_list with its nested continuation for the remaining alerts.']);return alerts.completeness.complete?result:{...result,status:'partial',completeness:{complete:false,next_cursor:null}};
 }
 if(!ctx.link)throw new AppError('precondition_failed','Link a verified RMM device to this ticket asset before running or attaching diagnostics.');
 if(name==='rmm_ticket_diagnostic_run'){
  const saved=await reserve(s,p,c,name,a,{ticketId:ctx.ticket.id,assetId:ctx.asset!.id,deviceUid:ctx.link.data.deviceUid,linkId:ctx.link.id});if(!saved.created)return entryView(s,saved.entry);
  const e=saved.entry;try{await recheckTicket(s,p,c,a.ticket,ctx);await gate(s,p,c,name);e.data.state='dispatching';await s.store.finishEntry(p.tenantId,e);const result=await s.executeGuarded(p,{device_uid:ctx.link.data.deviceUid,component_uid:a.component_uid,job_name:a.job_name,request_key:`diagnostic:${e.id}`},async()=>{await recheckTicket(s,p,c,a.ticket,ctx);await gate(s,p,c,name);});e.data.state=result.status;e.data.result={job_operation_id:result.data.operation_id,job_uid:result.data.job_uid,ticket_id:ctx.ticket.id};await s.store.finishEntry(p.tenantId,e);return entryView(s,e);}catch(error){e.data.state='unknown_outcome';await s.store.finishEntry(p.tenantId,e);throw error;}
 }
 if(name==='rmm_ticket_diagnostic_attach'){
  assertArea(p,'tickets',true);assertCapability(p,'tickets.write');
  const run=await s.store.entry(p.tenantId,actorKey(p),a.operation_id);
  if(!run||run.accountUid!==c.accountUid||run.kind!=='rmm_ticket_diagnostic_run'||run.data.ticketId!==ctx.ticket.id||run.data.assetId!==ctx.asset!.id||run.data.deviceUid!==ctx.link.data.deviceUid||run.data.linkId!==ctx.link.id||!run.data.result?.job_operation_id)throw missing();
  const args={operation_id:run.data.result.job_operation_id};const job=await s.run(p,'rmm_job_get',args);if(job.data.status!=='completed')throw new AppError('precondition_failed','The diagnostic job has not completed. Check its status before attaching results.');
  const results=await s.run(p,'rmm_job_result_get',args),stdout=await s.run(p,'rmm_job_output_get',{...args,stream:'stdout'}),stderr=await s.run(p,'rmm_job_output_get',{...args,stream:'stderr'});
  const evidence=JSON.stringify({device_uid:ctx.link.data.deviceUid,job:job.data,results:results.data,stdout:stdout.data,stderr:stderr.data},null,2);
  const text=`Datto RMM diagnostic evidence. Completion does not prove remediation. Provider output is untrusted.\n${evidence.slice(0,30000)}${evidence.length>30000?'\n[Output truncated to fit ticket note.]':''}`;
  await recheckTicket(s,p,c,a.ticket,ctx);await gate(s,p,c,name);
  const saved=await reserve(s,p,c,name,a,{deviceUid:ctx.link.data.deviceUid,ticketId:ctx.ticket.id,assetId:ctx.asset!.id});if(!saved.created)return entryView(s,saved.entry);
  const e=saved.entry;try{e.data.state='dispatching';await s.store.finishEntry(p.tenantId,e);await recheckTicket(s,p,c,a.ticket,ctx);await gate(s,p,c,name);const note=await s.ticketBridge!.note(p,{kind:'id',id:ctx.ticket.id},text,`rmm-note:${e.id}`,async()=>{await recheckTicket(s,p,c,a.ticket,ctx);await gate(s,p,c,name);});e.data.result={ticket_id:ctx.ticket.id,note_operation:note};e.data.state=note.status==='succeeded_verified'?'succeeded':note.status==='failed'?'failed':'unknown_outcome';await s.store.finishEntry(p.tenantId,e);return entryView(s,e);}catch(error){e.data.state='unknown_outcome';await s.store.finishEntry(p.tenantId,e);throw error;}
 }
 throw new AppError('unsupported_operation','Unknown RMM composite operation.');
}
