import assert from 'node:assert/strict';
import test from 'node:test';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
import {ToolRuntime,operationCatalog} from '../apps/server/src/tool-runtime.js';
import {CONTROL_CAPABILITIES} from '../packages/control-plane/src/index.js';
import {PlaybookService} from '../packages/playbooks/src/index.js';

test('expanded tool registration has unique names, real capability controls and descriptions',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());
 const runtime=new ToolRuntime({...s,playbooks:new PlaybookService(s.store),business:{} as any,workManagement:{} as any,attachments:{} as any,checklists:{} as any});
 const names=runtime.tools.map(t=>t.name);assert.equal(new Set(names).size,names.length);
 assert.equal(names.filter(n=>n==='time_log_ticket').length,1);
 for(const tool of runtime.tools){
  const entry=operationCatalog[tool.name];assert(entry,tool.name);
  assert.equal(tool.write,entry.write);assert(tool.description.length>20);assert(!tool.description.includes('undefined'));
  for(const cap of entry.capabilities)assert(CONTROL_CAPABILITIES.includes(cap),`${tool.name}: ${cap}`);
 }
 for(const name of ['contract_create','project_create','asset_update','purchase_order_create','time_correct','expense_item_add','ticket_attachment_delete','checklist_item_create','checklist_search'])assert(names.includes(name),name);
 await s.control.setControls(s.principals[0]!,{writePaused:true,tools:{}},0);
 const available=await runtime.available(s.principals[0]!);assert(available.every(t=>!t.write));
});

test('completion discovery and invocation use the same schema and tool controls',async t=>{
 const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
 const description=await s.runtime.invoke(p,'at_describe',{operation:'ticket_completion_search'}) as any;assert(description.schema.properties.completed_by);assert(description.schema.properties.window);assert.match(description.description,/reopened/);
 const current=await s.runtime.invoke(p,'at_describe',{operation:'ticket_search'}) as any;assert(current.schema.properties.completed_window);assert(current.schema.properties.completed_by);
 const result=await s.runtime.invoke(p,'at_invoke',{operation:'ticket_completion_search',arguments:{window:{period:'custom',start_date:'2026-09-17',end_date:'2026-09-18',timezone:'America/Chicago'}}}) as any;assert.equal(result.data.counts.total_tickets,0);
 const controls=await s.control.store.getControls(p.tenantId);await s.control.setControls(p,{writePaused:false,tools:{ticket_completion_search:false}},controls.version);
 assert(!(await s.runtime.available(p)).some(t=>t.name==='ticket_completion_search'));
 await assert.rejects(s.runtime.invoke(p,'at_invoke',{operation:'ticket_completion_search',arguments:{window:{period:'yesterday',timezone:'America/Chicago'}}}));
});
