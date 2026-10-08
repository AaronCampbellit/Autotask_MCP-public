import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {RmmService} from '../packages/rmm/src/service.js';
import {MemoryRmmStore,PostgresRmmStore,emptyConfig,type Row,type RmmConfig} from '../packages/rmm/src/store.js';
import {RmmClient,type RmmPort} from '../packages/rmm/src/client.js';
import {IntentCipher} from '../packages/storage/src/intent-cipher.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {actorKey,type Principal} from '../packages/contracts/src/index.js';
import {schemas,rmmOperations,rmmOutput} from '../packages/rmm/src/contracts.js';
import {rmmTools} from '../packages/rmm/src/tools.js';
const page=(key:string,items:unknown[])=>({[key]:items,pageDetails:{nextPageUrl:null}});
class Port implements RmmPort{
 calls:{path:string;method:string;body?:any;query:any}[]=[];unknown=false;before?:()=>void;site='site-a';model='First';resolved=false;warranty='2020-01-01';softwareVersion='1';
 device(uid='device-a'):Row{return{uid,id:11,siteUid:uid==='foreign'?'foreign':this.site,hostname:'PC',deviceClass:'device',warrantyDate:this.warranty};}
 async request(c:RmmConfig,path:string,q:Row={},body?:any,guard?:()=>Promise<void>,beforeWrite?:()=>Promise<void>,method:'GET'|'PUT'|'POST'|'DELETE'=body===undefined?'GET':'PUT'):Promise<any>{
  await guard?.();if(method!=='GET'){this.before?.();await beforeWrite?.();this.calls.push({path,method,body,query:q});if(this.unknown)throw Error('lost response');if(path.endsWith('/resolve'))this.resolved=true;if(path.includes('/device/')&&path.includes('/site/'))this.site=path.split('/').at(-1)!;if(path.endsWith('/warranty'))this.warranty=body.warrantyDate;if(path.endsWith('/quickjob'))return{job:{uid:'job-a'}};return{uid:'site-new',value:'DO_NOT_ECHO',password:'DO_NOT_ECHO'};}
  this.calls.push({path,method,query:q});
  if(path==='/v2/account')return{uid:'account-a',name:'Demo'};
  if(path==='/v2/account/components')return page('components',[{uid:'component-a',name:'Diagnostics',variables:[]}]);
  if(path==='/v2/account/users')return page('users',[{username:'Administrator'}]);
  if(path==='/v2/account/dnet-site-mappings')return page('dnetSiteMappings',[]);
  if(path==='/v2/account/devices')return page('devices',[this.device(),this.device('foreign')]);
  if(path.startsWith('/v2/site/')&&!path.slice('/v2/site/'.length).includes('/'))return{uid:path.split('/')[3],name:'Client',autotaskCompanyId:'10'};
  if(path.endsWith('/settings'))return{generalSettings:{name:'Client'},proxySettings:{host:'proxy',port:8080,type:'http',password:'DO_NOT_ECHO',username:'DO_NOT_ECHO'}};
  if(path.endsWith('/variables'))return page('variables',[{id:1,name:'Key',value:'DO_NOT_ECHO',masked:true}]);
  if(path.startsWith('/v2/filter/'))return page('filters',[{id:1,name:'Laptops'}]);
  if(path.startsWith('/v2/system/'))return path.endsWith('/status')?{version:'1',status:'OK'}:path.endsWith('/pagination')?{max:250}:{accountCount:1,accountWriteCount:0};
  if(path==='/v2/activity-logs')return page('activities',[{id:'log-a',details:'password=DO_NOT_ECHO'}]);
  if(path.startsWith('/v2/device/macAddress/'))return[this.device(),this.device('foreign')];
  if(path==='/v2/device/id/11'||path==='/v2/device/device-a')return this.device();
  if(path.endsWith('/devices'))return page('devices',q.page===0?[this.device()]:[]);
  if(path.endsWith('/alerts/open')||path.endsWith('/alerts/resolved'))return page('alerts',[{alertUid:'alert-a',resolved:this.resolved,alertSourceInfo:{siteUid:this.site,deviceUid:'device-a'}}]);
  if(path==='/v2/alert/alert-a')return{alertUid:'alert-a',resolved:this.resolved,alertSourceInfo:{siteUid:this.site,deviceUid:'device-a'}};
  if(path==='/v2/audit/device/device-a')return{systemInfo:{manufacturer:'Example',model:this.model}};
  if(path.endsWith('/software'))return page('software',[{name:'Example App',version:this.softwareVersion}]);
  if(path==='/v2/job/job-a')return{uid:'job-a',status:'completed'};
  if(path==='/v2/job/job-a/components')return page('jobComponents',[{uid:'component-a',name:'Diagnostics',variables:[{name:'x',value:'DO_NOT_ECHO'}]}]);
  if(path==='/v2/job/job-a/results/device-a')return{jobUid:'job-a',deviceUid:'device-a',jobDeploymentStatus:'Success',componentResults:[{componentUid:'component-a',componentStatus:'Success'}]};
  if(path.endsWith('/stdout')||path.endsWith('/stderr'))return[{componentUid:'component-a',stdData:'password=DO_NOT_ECHO Result'}];
  throw Error('Unexpected '+path);
 }
}
async function setup(){
 const p:Principal={...fixturePrincipals()[0]!,capabilities:['operational.read','platform.manage','rmm.read','rmm.write','rmm.execute','tickets.write'],resourceVerifiedAt:new Date().toISOString()},state={p},store=new MemoryRmmStore(),port=new Port(),cipher=new IntentCipher(randomBytes(32));
 await store.save(p.tenantId,actorKey(p),{...emptyConfig(),version:1,key:'API_KEY',secret:'API_SECRET',accountUid:'account-a',enabled:true,jobsEnabled:true,sites:{'site-a':{companyId:10,name:'A'},'site-b':{companyId:10,name:'B'}}},0,'connection.saved');
 const s=new RmmService(store,port,{get:async()=>state.p},cipher);return{s,p,state,store,port,cipher};
}
const reads:Record<string,Row>={rmm_device_lookup:{device_id:11},rmm_device_audit_by_mac:{mac_address:'00:11:22:33:44:55'},rmm_account_device_search:{filter_id:1},rmm_account_alert_list:{},rmm_filter_list:{kind:'default'},rmm_site_get:{site_uid:'site-a'},rmm_site_settings_get:{site_uid:'site-a'},rmm_account_get:{},rmm_account_user_list:{},rmm_network_mapping_list:{},rmm_system_get:{kind:'request_rate'},rmm_activity_list:{},rmm_variable_list:{scope:'site',site_uid:'site-a'},rmm_external_job_get:{job_uid:'job-a'},rmm_job_component_list:{job_uid:'job-a'},rmm_external_job_result_get:{job_uid:'job-a',device_uid:'device-a'},rmm_external_job_output_get:{job_uid:'job-a',device_uid:'device-a',stream:'stdout'}};
test('all additional native read tools route, project, redact and publish valid envelopes',async()=>{
 const {s,p}=await setup();for(const [name,a]of Object.entries(reads)){const result=await s.run(p,name as keyof typeof schemas,a);assert(rmmOutput.safeParse(result).success,name);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_ECHO|API_SECRET|foreign/,name);}
 const lookup=await s.run(p,'rmm_device_lookup',{mac_address:'001122334455'});assert.equal(lookup.data.devices.length,1);
});
test('administrator data and new mutations cannot be unlocked by component-execution permission',async()=>{
 const f=await setup();f.state.p={...f.p,capabilities:['rmm.read','rmm.execute']};
 for(const name of ['rmm_account_get','rmm_account_user_list','rmm_variable_list','rmm_activity_list'])await assert.rejects(()=>f.s.run(f.state.p,name as keyof typeof schemas,reads[name]));
 await assert.rejects(()=>f.s.run(f.state.p,'rmm_device_warranty_set',{device_uid:'device-a',warranty_date:'2030-01-01',expected_warranty_date:'2020-01-01',request_key:'write-denied'}));assert.equal(f.port.calls.length,0);
});
const writes:Record<string,{args:Row;method:string;path:string}>={
 rmm_alert_resolve:{args:{alert_uid:'alert-a'},method:'POST',path:'/v2/alert/alert-a/resolve'},
 rmm_device_warranty_set:{args:{device_uid:'device-a',warranty_date:'2030-01-01',expected_warranty_date:'2020-01-01'},method:'POST',path:'/v2/device/device-a/warranty'},
 rmm_device_udf_set:{args:{device_uid:'device-a',fields:{udf1:'Value',udf300:'Last'}},method:'POST',path:'/v2/device/device-a/udf'},
 rmm_device_move:{args:{device_uid:'device-a',expected_site_uid:'site-a',site_uid:'site-b'},method:'PUT',path:'/v2/device/device-a/site/site-b'},
 rmm_site_create:{args:{name:'New'},method:'PUT',path:'/v2/site'},rmm_site_update:{args:{site_uid:'site-a',fields:{name:'Rename'},expected:{name:'Client'}},method:'POST',path:'/v2/site/site-a'},
 rmm_variable_create:{args:{scope:'account',name:'Key',value:'DO_NOT_ECHO'},method:'PUT',path:'/v2/account/variable'},rmm_variable_update:{args:{scope:'site',site_uid:'site-a',variable_id:1,name:'Key',value:'DO_NOT_ECHO'},method:'POST',path:'/v2/site/site-a/variable/1'},rmm_variable_delete:{args:{scope:'account',variable_id:1},method:'DELETE',path:'/v2/account/variable/1'},
 rmm_site_proxy_set:{args:{site_uid:'site-a',settings:{host:'proxy',port:8080,type:'http',password:'DO_NOT_ECHO'}},method:'POST',path:'/v2/site/site-a/settings/proxy'},rmm_site_proxy_delete:{args:{site_uid:'site-a'},method:'DELETE',path:'/v2/site/site-a/settings/proxy'},
};
test('all native writes use correct verbs, durable deduplication and honest readback states',async()=>{
 for(const [name,{args,method,path}]of Object.entries(writes)){
  const {s,p,port}=await setup(),input={...args,request_key:'same-request'};
  const first=await s.run(p,name as keyof typeof schemas,input),second=await s.run(p,name as keyof typeof schemas,input);
  assert(rmmOutput.safeParse(first).success,name);assert.equal(first.data.operation_id,second.data.operation_id);assert.doesNotMatch(JSON.stringify(first),/DO_NOT_ECHO/);
  const sent=port.calls.filter(v=>v.method!=='GET');assert.equal(sent.length,1,name);assert.equal(sent[0]!.method,method);assert.equal(sent[0]!.path,path);
  assert.equal(first.status,['rmm_alert_resolve','rmm_device_warranty_set','rmm_device_move'].includes(name)?'succeeded':'accepted',name);
  const status=await s.run(p,'rmm_operation_get',{operation_id:first.data.operation_id});assert.equal(status.data.operation_id,first.data.operation_id);
  await assert.rejects(()=>s.run(p,name as keyof typeof schemas,{...input,request_key:input.request_key,...(name==='rmm_alert_resolve'?{alert_uid:'another'}:name==='rmm_device_move'?{site_uid:'site-a'}:name==='rmm_variable_delete'?{variable_id:2}:name==='rmm_site_proxy_delete'?{site_uid:'site-b'}:name==='rmm_device_udf_set'?{fields:{udf1:'Changed'}}:name==='rmm_site_update'?{fields:{name:'Changed'}}:name==='rmm_site_proxy_set'?{settings:{host:'changed',port:80,type:'http'}}:name==='rmm_device_warranty_set'?{warranty_date:'2040-01-01'}:{name:'Changed'})}));
 }
});
test('unknown writes are never replayed and revocation before dispatch sends nothing',async()=>{
 const f=await setup();f.port.unknown=true;const args={alert_uid:'alert-a',request_key:'unknown-alert'};
 assert.equal((await f.s.run(f.p,'rmm_alert_resolve',args)).status,'unknown_outcome');await f.s.run(f.p,'rmm_alert_resolve',args);assert.equal(f.port.calls.filter(c=>c.method!=='GET').length,1);
 const g=await setup();g.port.before=()=>{g.state.p={...g.p,capabilities:['rmm.read']};};await assert.rejects(()=>g.s.run(g.p,'rmm_alert_resolve',args));assert.equal(g.port.calls.filter(c=>c.method!=='GET').length,0);
});
test('fleet software search, snapshots and differences preserve complete observed inventory',async()=>{
 const {s,p,port}=await setup();const software=await s.run(p,'rmm_fleet_software_search',{site_uid:'site-a',name:'example',version:'1'});assert.equal(software.data.devices[0].software[0].name,'Example App');assert.equal(software.completeness.complete,true);
 const before=await s.run(p,'rmm_device_snapshot_save',{device_uid:'device-a',request_key:'snapshot-before'});port.model='Second';port.softwareVersion='2';
 const after=await s.run(p,'rmm_device_snapshot_save',{device_uid:'device-a',request_key:'snapshot-after'});
 const changes=await s.run(p,'rmm_device_snapshot_compare',{device_uid:'device-a',before_id:before.data.operation_id,after_id:after.data.operation_id});assert(changes.data.changes.some((v:Row)=>v.field==='audit.systemInfo.model'));assert(changes.data.changes.some((v:Row)=>v.field==='software'));
 assert.equal((await s.run(p,'rmm_device_snapshot_list',{device_uid:'device-a'})).data.snapshots.length,2);
});
test('ticket link, diagnostics and internal note attachment keep exact parent and receipt ownership',async()=>{
 const {s,p,port}=await setup();let ticket={id:1001,companyID:10},asset={id:501,companyID:10};const notes:Row[]=[];
 s.ticketBridge={context:async()=>({ticket,asset}),note:async(_p,t,text,key,guard)=>{await guard?.();notes.push({ticket:t,text,key});return{status:'succeeded_verified',operation_id:'note-receipt'};}};
 assert.equal((await s.run(p,'rmm_ticket_context',{ticket:{kind:'id',id:1001}})).data.link_state,'unlinked');
 await s.run(p,'rmm_ticket_device_link',{ticket:{kind:'id',id:1001},device_uid:'device-a',request_key:'link-device'});
 assert.equal((await s.run(p,'rmm_ticket_context',{ticket:{kind:'id',id:1001}})).data.device.uid,'device-a');
 await s.approve(p,{version:1,component_uid:'component-a',approved:true,variables:{}});
 const run=await s.run(p,'rmm_ticket_diagnostic_run',{ticket:{kind:'id',id:1001},component_uid:'component-a',job_name:'Diagnostics',request_key:'run-diagnostic'});
 assert.equal(run.status,'accepted');const args={ticket:{kind:'id',id:1001},operation_id:run.data.operation_id,request_key:'attach-diagnostic'};
 assert.equal((await s.run(p,'rmm_ticket_diagnostic_attach',args)).status,'succeeded');await s.run(p,'rmm_ticket_diagnostic_attach',args);assert.equal(notes.length,1);assert.doesNotMatch(notes[0]!.text,/DO_NOT_ECHO/);assert.equal(port.calls.filter(v=>v.path.endsWith('/quickjob')).length,1);
 asset={id:502,companyID:10};await assert.rejects(()=>s.run(p,'rmm_ticket_diagnostic_attach',{...args,request_key:'different-attach'}));
});
test('extended receipts and snapshot payloads are encrypted and reserved atomically in PostgreSQL',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY)');await db.exec(await readFile('packages/storage/migrations/016_rmm_extended.sql','utf8'));
 const store=new PostgresRmmStore(db,new IntentCipher(randomBytes(32))),entry={id:'00000000-0000-4000-8000-000000000001',actor:'actor',key:'request',kind:'test',accountUid:'account',createdAt:new Date().toISOString(),data:{sensitive:'DO_NOT_ECHO'}};
 const results=await Promise.all([store.reserveEntry('tenant',entry),store.reserveEntry('tenant',entry)]);assert.equal(results.filter(v=>v.created).length,1);assert.doesNotMatch(JSON.stringify((await db.query('SELECT * FROM rmm_entries')).rows),/DO_NOT_ECHO/);assert.equal((await store.entry('tenant','actor',entry.id))!.data.sensitive,'DO_NOT_ECHO');assert.equal(await store.entry('other','actor',entry.id),undefined);
});
test('transport sends bodyless POST/DELETE, repeated query parameters and excludes key reset',async()=>{
 const requests:Request[]=[],client=new RmmClient(async(url,init)=>{const r=new Request(url,init);requests.push(r);return r.url.includes('/auth/')?Response.json({access_token:'token'}):Response.json({});});const c={...emptyConfig(),key:'key',secret:'secret'};let writes=0;
 await client.request(c,'/v2/alert/a/resolve',{},undefined,undefined,async()=>{writes++;},'POST');await client.request(c,'/v2/account/variable/1',{},undefined,undefined,async()=>{writes++;},'DELETE');await client.request(c,'/v2/activity-logs',{siteIds:[1,2]});
 assert.equal(requests[1]!.method,'POST');assert.equal(requests[2]!.method,'DELETE');assert.deepEqual(new URL(requests[3]!.url).searchParams.getAll('siteIds'),['1','2']);assert.equal(writes,2);
 await assert.rejects(()=>client.request(c,'/v2/user/resetApiKeys',{},undefined,undefined,undefined,'POST'));assert.equal(requests.length,4);
});
test('every added schema is registered and privileged changes are classified as writes',async()=>{
 const {s}=await setup(),tools=rmmTools(s);assert.equal(tools.length,Object.keys(schemas).length);
 for(const name of Object.keys(writes)){assert(rmmOperations[name]!.write);assert(rmmOperations[name]!.capabilities.includes('rmm.write'));}
 assert(!schemas.rmm_ticket_diagnostic_run.safeParse({ticket:{kind:'id',id:1001},component_uid:'component-a',job_name:'x'.repeat(101),request_key:'long-job-name'}).success);assert(!Object.keys(schemas).some(n=>/reset|mute/.test(n)));assert(!schemas.rmm_device_udf_set.safeParse({device_uid:'a',request_key:'test-key',fields:{udf301:'bad'}}).success);
});

test('account device search filters foreign sites and binds continuation to the saved filter',async()=>{
 const f=await setup(),original=f.port.request.bind(f.port);f.port.request=async(c,path,q={},...rest)=>path==='/v2/account/devices'?{devices:q.page===0?[f.port.device('foreign')]:[f.port.device()],pageDetails:{nextPageUrl:q.page===0?'https://evil.invalid/next':null}}:original(c,path,q,...rest);
 const first=await f.s.run(f.p,'rmm_account_device_search',{filter_id:1});assert.deepEqual(first.data.devices,[]);assert.equal(first.status,'partial');
 const next=await f.s.run(f.p,'rmm_account_device_search',{filter_id:1,cursor:first.completeness.next_cursor});assert.equal(next.data.devices.length,1);assert.equal(next.status,'succeeded');
 await assert.rejects(()=>f.s.run(f.p,'rmm_account_device_search',{filter_id:2,cursor:first.completeness.next_cursor}));
 const config=await f.store.config(f.p.tenantId);await f.store.save(f.p.tenantId,actorKey(f.p),{...config,version:config.version+1},config.version,'connection.saved');await assert.rejects(()=>f.s.run(f.p,'rmm_account_device_search',{filter_id:1,cursor:first.completeness.next_cursor}));
});
test('activity continuation forwards only reviewed paging tokens to the pinned native route',async()=>{
 const f=await setup(),queries:Row[]=[],original=f.port.request.bind(f.port);
 f.port.request=async(c,path,q={},...rest)=>{if(path==='/v2/activity-logs'){queries.push(q);return{activities:[],pageDetails:{nextPageUrl:q.searchAfter?null:'https://evil.invalid/api/v2/activity-logs?searchAfter=100&searchAfter=abc&page=next&searchQuery=injected'}};}return original(c,path,q,...rest);};
 const args={search_query:'requested',site_ids:[1,2]};const first=await f.s.run(f.p,'rmm_activity_list',args);await f.s.run(f.p,'rmm_activity_list',{...args,cursor:first.completeness.next_cursor});assert.deepEqual(queries[1]!.searchAfter,['100','abc']);assert.equal(queries[1]!.searchQuery,'requested');assert.deepEqual(queries[1]!.siteIds,[1,2]);
});
test('simultaneous identical writes dispatch once; wrong variable ID and expected source site dispatch nothing',async()=>{
 const f=await setup(),a={alert_uid:'alert-a',request_key:'concurrent-alert'};const results=await Promise.all([f.s.run(f.p,'rmm_alert_resolve',a),f.s.run(f.p,'rmm_alert_resolve',a)]);assert.equal(results[0].data.operation_id,results[1].data.operation_id);assert.equal(f.port.calls.filter(v=>v.method!=='GET').length,1);
 const g=await setup();await assert.rejects(()=>g.s.run(g.p,'rmm_variable_delete',{scope:'site',site_uid:'site-a',variable_id:999,request_key:'wrong-variable'}));await assert.rejects(()=>g.s.run(g.p,'rmm_device_move',{device_uid:'device-a',expected_site_uid:'site-b',site_uid:'site-a',request_key:'wrong-source'}));assert.equal(g.port.calls.filter(v=>v.method!=='GET').length,0);
});
test('native Autotask asset identifiers link automatically and a changed link blocks component dispatch',async()=>{
 const f=await setup();let asset:Row={id:501,companyID:10,rmmDeviceUID:'device-a'};f.s.ticketBridge={context:async()=>({ticket:{id:1001,companyID:10},asset}),note:async()=>({})};
 assert.equal((await f.s.run(f.p,'rmm_ticket_context',{ticket:{kind:'id',id:1001}})).data.link_state,'verified');
 await f.s.approve(f.p,{version:1,component_uid:'component-a',approved:true,variables:{}});
 f.port.before=()=>{asset={id:502,companyID:10};};await assert.rejects(()=>f.s.run(f.p,'rmm_ticket_diagnostic_run',{ticket:{kind:'id',id:1001},component_uid:'component-a',job_name:'Test',request_key:'changing-link'}));assert.equal(f.port.calls.filter(v=>v.path.endsWith('/quickjob')).length,0);
});
test('new write capabilities and write pause control discovery without changing existing component grants',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js');const f=createFixtureSystem();t.after(()=>f.app.close());const old=f.principals[0]!,p={...old,capabilities:[...old.capabilities,'rmm.read' as const,'rmm.execute' as const],mappingVersion:old.mappingVersion+1};await f.controlStore.saveMember(old,p,old.mappingVersion,new Date().toISOString());
 await f.runtime.options.rmm!.configure(p,{version:0,platform:'zinfandel',key:'key',secret:'secret',enabled:false,jobs_enabled:false});await f.runtime.options.rmm!.test(p);await f.runtime.options.rmm!.configure(p,{version:2,platform:'zinfandel',enabled:true,jobs_enabled:true});
 assert(!(await f.runtime.available(p)).some(v=>v.name==='rmm_alert_resolve'));assert((await f.runtime.available(p)).some(v=>v.name==='rmm_quickjob_run'));
 const writer={...p,capabilities:[...p.capabilities,'rmm.write' as const],mappingVersion:p.mappingVersion+1};await f.controlStore.saveMember(p,writer,p.mappingVersion,new Date().toISOString());assert((await f.runtime.available(writer)).some(v=>v.name==='rmm_alert_resolve'));
 const controls=await f.controlStore.getControls(writer.tenantId);await f.controlStore.saveControls(writer,{...controls,version:controls.version+1,writePaused:true},controls.version,new Date().toISOString());assert(!(await f.runtime.available(writer)).some(v=>v.name==='rmm_alert_resolve'));assert((await f.runtime.available(writer)).some(v=>v.name==='rmm_device_search'));
});

test('coverage accounts for every pinned API operation and only excludes key reset and deprecated mute routes',async()=>{
 const spec=JSON.parse(await readFile('packages/rmm/src/openapi.json','utf8')),coverage=JSON.parse(await readFile('docs/RMM-API-COVERAGE.json','utf8'));
 const native=Object.entries(spec.paths).flatMap(([path,methods]:[string,any])=>Object.keys(methods).filter(m=>['get','post','put','delete','patch'].includes(m)).map(m=>`${m.toUpperCase()} ${path}`)).sort();
 assert.deepEqual(coverage.operations.map((v:Row)=>`${v.method} ${v.path}`).sort(),native);
 assert.deepEqual(coverage.operations.filter((v:Row)=>v.status==='excluded').map((v:Row)=>v.path).sort(),['/v2/alert/{alertUid}/mute','/v2/alert/{alertUid}/unmute','/v2/user/resetApiKeys']);
 for(const row of coverage.operations)for(const name of row.tools)assert(name in schemas,name);
});
test('ticket operation receipts recheck current ticket company and asset association',async()=>{
 const f=await setup();let company=10;f.s.ticketBridge={context:async()=>({ticket:{id:1001,companyID:company},asset:{id:501,companyID:company,rmmDeviceUID:'device-a'}}),note:async()=>({})};
 await f.s.approve(f.p,{version:1,component_uid:'component-a',approved:true,variables:{}});const run=await f.s.run(f.p,'rmm_ticket_diagnostic_run',{ticket:{kind:'id',id:1001},component_uid:'component-a',job_name:'Test',request_key:'ticket-receipt'});
 assert.equal((await f.s.run(f.p,'rmm_operation_get',{operation_id:run.data.operation_id})).data.operation_id,run.data.operation_id);company=20;await assert.rejects(()=>f.s.run(f.p,'rmm_operation_get',{operation_id:run.data.operation_id}));
});

test('runtime diagnostic note workflow uses the real ticket writer and nested dispatch guards',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js');const f=createFixtureSystem();t.after(()=>f.app.close());const old=f.principals[0]!,p={...old,capabilities:[...old.capabilities,'rmm.read' as const,'rmm.execute' as const,'rmm.write' as const,'platform.manage' as const],mappingVersion:old.mappingVersion+1};await f.controlStore.saveMember(old,p,old.mappingVersion,new Date().toISOString());
 const r=f.runtime.options.rmm!;await r.configure(p,{version:0,platform:'zinfandel',key:'key',secret:'secret',enabled:false,jobs_enabled:false});await r.test(p);await r.configure(p,{version:2,platform:'zinfandel',enabled:true,jobs_enabled:true});await r.mapSite(p,{version:3,site_uid:'example-site',enabled:true});await r.approve(p,{version:4,component_uid:'example-diagnostics',approved:true,variables:{}});
 const original=r.port.request.bind(r.port);r.port.request=async(c,path,q={},...rest)=>{
  if(path==='/v2/job/example-job')return{uid:'example-job',status:'completed'};
  if(path==='/v2/job/example-job/results/example-device')return{jobUid:'example-job',deviceUid:'example-device',jobDeploymentStatus:'Success',componentResults:[]};
  if(path.endsWith('/stdout')||path.endsWith('/stderr'))return[{componentUid:'example-diagnostics',stdData:'Fictitious diagnostic output'}] as any;
  return original(c,path,q,...rest);
 };
 await f.runtime.invoke(p,'rmm_ticket_device_link',{ticket:{kind:'id',id:1001},device_uid:'example-device',request_key:'runtime-link'});
 const run=await f.runtime.invoke(p,'rmm_ticket_diagnostic_run',{ticket:{kind:'id',id:1001},component_uid:'example-diagnostics',job_name:'Test',request_key:'runtime-diagnostic'}) as Row;
 const args={ticket:{kind:'id',id:1001},operation_id:run.data.operation_id,request_key:'runtime-attach'};
 const attached=await f.runtime.invoke(p,'rmm_ticket_diagnostic_attach',args) as Row;assert.equal(attached.status,'succeeded');assert.equal(attached.data.result.note_operation.status,'succeeded_verified');
 const repeat=await f.runtime.invoke(p,'rmm_ticket_diagnostic_attach',args) as Row;assert.equal(repeat.data.operation_id,attached.data.operation_id);
});

test('fleet scan continues through empty software matches and rejects oversized device pages',async()=>{
 const f=await setup(),original=f.port.request.bind(f.port);let oversized=false;
 f.port.request=async(c,path,q={},...rest)=>{
  if(path.endsWith('/devices')&&oversized)return page('devices',[f.port.device(),f.port.device()]);
  if(path.endsWith('/software'))return{software:[{name:q.page===0?'Other':'Wanted',version:'1'}],pageDetails:{nextPageUrl:q.page===0?'https://evil.invalid':null}};
  return original(c,path,q,...rest);
 };
 const args={site_uid:'site-a',name:'wanted',page_size:1};const first=await f.s.run(f.p,'rmm_fleet_software_search',args);assert.deepEqual(first.data.devices,[]);assert.equal(first.status,'partial');const second=await f.s.run(f.p,'rmm_fleet_software_search',{...args,cursor:first.completeness.next_cursor});assert.equal(second.data.devices[0].software[0].name,'Wanted');assert.equal(second.completeness.complete,true);
 await assert.rejects(()=>f.s.run(f.p,'rmm_fleet_software_search',{...args,name:'changed',cursor:first.completeness.next_cursor}));oversized=true;await assert.rejects(()=>f.s.run(f.p,'rmm_fleet_software_search',args));
});

 test('warranty and site updates reject stale values including changes while queued',async()=>{
  for(const queued of [false,true]){
   const f=await setup();if(queued)f.port.before=()=>{f.port.warranty='2025-01-01';};else f.port.warranty='2025-01-01';
   await assert.rejects(()=>f.s.run(f.p,'rmm_device_warranty_set',{device_uid:'device-a',warranty_date:'2030-01-01',expected_warranty_date:'2020-01-01',request_key:'stale-warranty'}));
   assert.equal(f.port.calls.filter(v=>v.method!=='GET').length,0);
  }
  const f=await setup();await assert.rejects(()=>f.s.run(f.p,'rmm_site_update',{site_uid:'site-a',fields:{name:'New'},expected:{name:'Stale'},request_key:'stale-site'}));
  assert.equal(f.port.calls.filter(v=>v.method!=='GET').length,0);
  assert.equal(schemas.rmm_site_update.safeParse({site_uid:'site-a',fields:{name:'New',notes:'New notes'},expected:{name:'Client'},request_key:'missing-expected'}).success,false);
 });

test('a device moved between two allowed sites while queued is not silently edited',async()=>{
 const f=await setup();f.port.before=()=>{f.port.site='site-b';};
 await assert.rejects(()=>f.s.run(f.p,'rmm_device_udf_set',{device_uid:'device-a',fields:{udf1:'Value'},request_key:'moved-queued'}));
 assert.equal(f.port.calls.filter(v=>v.method!=='GET').length,0);
});

test('ticket context reuses read-stage observations while final moved-device checks stay fresh',async()=>{
 const f=await setup();f.s.ticketBridge={context:async()=>({ticket:{id:1001,companyID:10},asset:{id:501,companyID:10,rmmDeviceUID:'device-a'}}),note:async()=>({})};
 const args={ticket:{kind:'id',id:1001}};await f.s.run(f.p,'rmm_ticket_context',args);const optimized=f.port.calls.length;
 const g=await setup();g.s.ticketBridge=f.s.ticketBridge;g.s.readStage=run=>run();await g.s.run(g.p,'rmm_ticket_context',args);assert.equal(optimized,5);assert.equal(g.port.calls.length,11);
 assert.equal(f.port.calls.filter(c=>c.path==='/v2/device/device-a').length,2,'initial observation plus fresh final check');
 const h=await setup();h.s.ticketBridge=f.s.ticketBridge;const original=h.port.request.bind(h.port);h.port.request=async(c,path,q={},...rest)=>{const value=await original(c,path,q,...rest);if(path.endsWith('/alerts/open'))h.port.site='site-b';return value;};await assert.rejects(()=>h.s.run(h.p,'rmm_ticket_context',args));
});
test('reference cache coalesces dictionary reads but rechecks native site mappings on every consumer',async()=>{
 const f=await setup(),original=f.port.request.bind(f.port);f.port.request=async(c,path,q={},...rest)=>path.endsWith('/filters')?page('filters',[{id:1,name:'Workstations'}]):original(c,path,q,...rest);
 let loads=0;const wrapped=f.port.request;f.port.request=async(...args)=>{if(args[1].endsWith('/filters'))loads++;return wrapped(...args);};
 const first=await f.s.run(f.p,'rmm_site_filter_list',{site_uid:'site-a'}),second=await f.s.run(f.p,'rmm_site_filter_list',{site_uid:'site-a'});assert.equal(loads,1);assert.equal(second.provenance.fetched_at,first.provenance.fetched_at);assert.equal(second.provenance.cache_hit,true);
 const config=await f.store.config(f.p.tenantId);await f.store.save(f.p.tenantId,actorKey(f.p),{...config,version:config.version+1},config.version,'connection.saved');await f.s.run(f.p,'rmm_site_filter_list',{site_uid:'site-a'});assert.equal(loads,2);
});

test('accepted RMM mutation has bounded reconciliation while subsequent reads honor cancellation',async()=>{
 const {createExecution,withExecution,currentExecution}=await import('../packages/execution/src/index.js');const f=await setup(),abort=new AbortController(),context=createExecution(abort.signal),original=f.port.request.bind(f.port);
 f.port.request=async(c,path,q={},body,guard,beforeWrite,method)=>{currentExecution()?.signal.throwIfAborted();const result=await original(c,path,q,body,guard,beforeWrite,method);if(method==='POST'){context.effectStarted=true;abort.abort();}return result;};
 await withExecution(context,async()=>{const result=await f.s.run(f.p,'rmm_device_warranty_set',{device_uid:'device-a',warranty_date:'2030-01-01',expected_warranty_date:'2020-01-01',request_key:'cancel-after-rmm-accept'});assert.equal(result.status,'succeeded');const calls=f.port.calls.length;await assert.rejects(()=>f.s.run(f.p,'rmm_device_get',{device_uid:'device-a'}));assert.equal(f.port.calls.length,calls);});
 assert.equal(f.port.calls.filter(c=>c.method!=='GET').length,1);
});
