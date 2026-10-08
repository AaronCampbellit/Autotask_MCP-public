import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {operationCatalog} from '../apps/server/src/tool-runtime.js';
import {CONTROL_CAPABILITIES} from '../packages/control-plane/src/index.js';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
const model=await import(pathToFileURL(resolve('apps/console/public/access-model.js')).href);
test('access groups preserve every operation exactly once and distinguish local mutations from reads',()=>{
 const entries=Object.entries(operationCatalog).map(([id,definition])=>({id,area:model.operationArea(id),write:model.operationWrites(id,definition),label:id}));const groups=model.permissionGroups(entries),flat=groups.flatMap((g:any)=>[...g.read,...g.write]);assert.equal(flat.length,entries.length);assert.equal(new Set(flat.map((e:any)=>e.id)).size,entries.length);
 for(const name of ['ticket_update','quote_create','at_job_cancel','at_artifact_delete','at_file_stage'])assert.equal(flat.find((e:any)=>e.id===name).write,true);
 assert.equal(model.operationArea('contract_context'),'Finance');assert.equal(model.operationArea('resource_availability_update'),'Scheduling');assert.equal(model.operationArea('ticket_create_options'),'Tickets');assert.equal(model.operationWrites('ticket_create_options',operationCatalog.ticket_create_options),false);
 assert(CONTROL_CAPABILITIES.every(id=>model.capabilityLabels[id]));
});
test('people includes unmapped directory members and unavailable saved mappings without activating either',()=>{
 const users=[{id:'ABC',displayName:'Alice',mail:'alice@example.test'},{id:'DEF',displayName:'Bob',mail:'bob@example.test'}],members=[{objectId:'abc',resourceId:17,active:true},{objectId:'gone',resourceId:18,active:false}],resources=[{id:17,displayName:'Alice Resource'}];
 const rows=model.peopleRows(users,members,resources);assert.equal(rows.length,3);assert.equal(rows[0].resource.displayName,'Alice Resource');assert.equal(rows[1].user.displayName,'Bob');assert.equal(rows[1].member,undefined);assert.equal(rows[2].member.objectId,'gone');assert.equal(rows[2].user,undefined);
});
test('access model is served and template all-client policy validates through the service',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const r=await s.app.fetch(new Request('http://127.0.0.1:3030/admin/access-model.js'));assert.equal(r.status,200);assert.match(r.headers.get('content-type')!,/javascript/);
 const p=s.principals[0]!;await s.control.saveTemplate(p,{key:'everyone',capabilities:['operational.read'],companyIds:[],allCompanies:true},0);assert.equal((await s.control.snapshot(p)).templates[0]!.allCompanies,true);
 await assert.rejects(s.control.saveTemplate(p,{key:'bad',capabilities:[],companyIds:[],allCompanies:'yes'} as any,0),{code:'invalid_input'});
});
