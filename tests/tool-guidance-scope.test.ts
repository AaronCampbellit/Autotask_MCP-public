import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
import {ToolRuntime} from '../apps/server/src/tool-runtime.js';
import {toolAnnotations} from '../apps/server/src/publication.js';
import type {SalesService} from '../packages/sales/src/index.js';
import {authoringStandard} from '../packages/authoring/src/index.js';

test('opportunity note metadata describes its actual write without unrelated ticket or status directives',async t=>{
 const system=createFixtureSystem();t.after(()=>system.app.close());
 // Descriptions and schemas are assembled without executing the service.
 const runtime=new ToolRuntime({...system.runtime.options,sales:{} as SalesService});
 const tool=runtime.tools.find(t=>t.name==='opportunity_note_create')!;
 assert.match(tool.description,/company note associated with an existing opportunity/);
 assert.match(tool.description,/does not change opportunity status/);
 assert.match(tool.description,/stable request_key/);
 assert.match(tool.description,/preserve uncertainty and scope/);
 assert.doesNotMatch(tool.description,/Status maintenance:|Every ticket row|Follow the shared|no separate AI|approval round trip|routine approval step/i);
 assert.equal(toolAnnotations(tool).readOnlyHint,false);
 assert.equal(tool.write,true);
 assert.match(authoringStandard,/Status maintenance:/);
 assert.match(authoringStandard,/Ticket financial privacy:/);
 assert.doesNotMatch(authoringStandard,/routine approval step is required|not a requirement for another approval round trip/);
});
