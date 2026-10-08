import test from 'node:test';
import assert from 'node:assert/strict';
import {IntegrationService} from '../packages/integrations/src/index.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {AppError,type Principal} from '../packages/contracts/src/index.js';
type Row=Record<string,any>;
const page=(data:unknown,cursor:string|null=null)=>({data,completeness:{complete:!cursor,next_cursor:cursor},provenance:{source:'fixture',fetched_at:'2026-09-19T00:00:00Z'}});
function setup(){
 const principal={...fixturePrincipals()[0]!,capabilities:['operational.read','rmm.read','documentation.read'],resourceVerifiedAt:new Date().toISOString()} as Principal;
 const state={p:principal,company:10,duplicate:false,next:false,unavailable:false,forbidden:false};const calls:Row[]=[];
 const invoke=async(_p:Principal,name:string,args:any)=>{calls.push({name,args});if(name.startsWith('itg_')){if(state.forbidden)throw new AppError('forbidden','denied');if(state.unavailable)throw new AppError('dependency_unavailable','provider down');return page([{id:'101',type:'configurations',attributes:{'serial-number':'SERIAL1'}},...(state.duplicate?[{id:'102',type:'configurations',attributes:{'serial-number':'SERIAL1'}}]:[])],state.next?'next-page':null);}
  if(name==='rmm_site_list')return page([{uid:'site-a',company_id:10},{uid:'site-b',company_id:20}]);
  if(name==='rmm_device_search')return page({devices:[{uid:'device-a',siteUid:'site-a',hostname:'PC',deviceClass:'device'}]},state.next?'device-next':null);
  if(name==='rmm_device_audit_get')return page({bios:{serialNumber:'serial1'}});
  if(name==='rmm_ticket_context')return page({link_state:'verified',device:{uid:'device-a'}});
  throw Error(name);
 };
 const service=new IntegrationService({get:async()=>state.p},invoke,async()=>({ticket:{id:1001,companyID:state.company},asset:{id:501}}));return{service,state,calls,principal};
}
test('inventory comparison scopes native reads to the company and reports evidence without creating mappings',async()=>{
 const f=setup(),r=await f.service.run(f.principal,'client_inventory_compare',{company:10});
 assert.equal(r.status,'succeeded');assert.equal(r.data.candidates.length,1);assert.equal(r.data.candidates[0].verified_mapping,false);
 assert(f.calls.filter(c=>c.name==='rmm_device_search').every(c=>c.args.site_uid==='site-a'));
 assert(f.calls.filter(c=>c.name==='itg_configuration_search').every(c=>c.args.company===10));
 assert(f.calls.every(c=>!/(create|update|set|run|link)$/.test(c.name)));
});
test('duplicate serials remain ambiguous, and page limits preserve per-source continuations',async()=>{
 const f=setup();f.state.duplicate=true;let r=await f.service.run(f.principal,'client_inventory_compare',{company:10});assert.equal(r.data.candidates.length,0);assert.equal(r.data.ambiguous.length,1);
 f.state.next=true;r=await f.service.run(f.principal,'client_inventory_compare',{company:10,max_pages:1});assert.equal(r.status,'partial');assert.equal(r.completeness.complete,false);assert(r.data.rmm.continuations.length);assert(r.data.documentation.continuations.length);
});
test('provider outages degrade independently while access denials fail closed',async()=>{
 const f=setup();f.state.unavailable=true;const r=await f.service.run(f.principal,'client_inventory_compare',{company:10});assert.equal(r.data.documentation.status,'unavailable');assert.equal(r.data.rmm.status,'available');assert.equal(r.status,'partial');
 f.state.forbidden=true;await assert.rejects(()=>f.service.run(f.principal,'client_inventory_compare',{company:10}),{code:'forbidden'});
});
test('context rechecks ticket ownership after independent provider retrieval',async()=>{
 const f=setup();const original=f.service.invoke;const s=new IntegrationService(f.service.principals,async(p,n,a)=>{const r=await original(p,n,a);if(n==='itg_document_search')f.state.company=20;return r;},f.service.ticketContext);
 await assert.rejects(()=>s.run(f.principal,'ticket_environment_context',{ticket:{kind:'id',id:1001}}),{code:'conflict'});
});
test('company scope and revocation prevent cross-provider disclosure',async()=>{
 const f=setup();await assert.rejects(()=>f.service.run(f.principal,'client_inventory_compare',{company:999}));assert.equal(f.calls.length,0);
 f.state.p={...f.principal,active:false};await assert.rejects(()=>f.service.run(f.principal,'client_inventory_compare',{company:10}));assert.equal(f.calls.length,0);
});

test('composites consume real ToolRuntime provider envelopes and verified ticket links',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js');const f=createFixtureSystem();t.after(()=>f.app.close());const old=f.principals[0]!,p={...old,capabilities:[...old.capabilities,'rmm.read' as const,'rmm.write' as const,'documentation.read' as const,'platform.manage' as const],mappingVersion:old.mappingVersion+1};await f.controlStore.saveMember(old,p,old.mappingVersion,new Date().toISOString());
 const r=f.runtime.options.rmm!;await r.configure(p,{version:0,platform:'zinfandel',key:'key',secret:'secret',enabled:false,jobs_enabled:false});await r.test(p);await r.configure(p,{version:2,platform:'zinfandel',enabled:true,jobs_enabled:false});await r.mapSite(p,{version:3,site_uid:'example-site',enabled:true});
 const original=r.port.request.bind(r.port);r.port.request=async(c,path,q={},...rest)=>{if(path.endsWith('/alerts/open'))return{alerts:[],pageDetails:{nextPageUrl:null}};return original(c,path,q,...rest);};
 await f.runtime.invoke(p,'rmm_ticket_device_link',{ticket:{kind:'id',id:1001},device_uid:'example-device',request_key:'context-fixture-link'});
 const glue=f.runtime.options.itglue!;await glue.configure(p,{version:0,region:'us',key:'fixture-glue-key',enabled:false,writes_enabled:false});await glue.mapOrganization(p,{version:1,company:10,organization_id:'100',enabled:true});await glue.configure(p,{version:2,region:'us',enabled:true,writes_enabled:false});
 const service=new IntegrationService(f.store,(p,n,a)=>f.runtime.invoke(p,n,a),r.ticketBridge!.context);
 const context=await f.runtime.invoke(p,'ticket_environment_context',{ticket:{kind:'id',id:1001}}) as Row;assert.equal(context.data.rmm.data[0].link_state,'verified');assert.equal(context.data.documentation.status,'available');assert.equal(context.status,'succeeded');
 const inventory=await f.runtime.invoke(p,'client_inventory_compare',{company:10}) as Row;assert.equal(inventory.data.rmm.data[0].id,'example-device');assert.equal(inventory.data.documentation.data[0].id,'200');assert.equal(inventory.data.candidates.length,0);
});
