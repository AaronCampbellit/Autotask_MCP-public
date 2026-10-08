import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureHttp, protocols } from '../scripts/project2-benchmark.js';
for (const protocol of protocols) test(`Project2 actual HTTP compatibility: ${protocol}`, async () => {
  const fixture = await fixtureHttp();
  try {
    const list = await fixture.call(protocol, 'tools/list');
    assert.equal(list.status, 200); assert.ok(list.rpc.result.tools.some((t: {name:string}) => t.name === 'ticket_context'));
    const context = await fixture.call(protocol, 'tools/call', { name: 'ticket_context', arguments: { ticket: { kind: 'id', id: 1001 }, purpose: 'custom', collections: ['notes','time'] } });
    assert.equal(context.status,200); assert.ok(context.rpc.result.structuredContent); assert.ok(context.fixture_autotask_calls > 0);
    const before = fixture.system.adapter.calls.length;
    for (const params of [{ name: 'not_a_tool', arguments: {} }, { name: 'ticket_update', arguments: { unexpected: true } }]) {
      const rejected = await fixture.call(protocol,'tools/call',params);
      assert.ok(rejected.rpc?.error || rejected.rpc?.result?.isError, JSON.stringify(rejected.rpc));
    }
    assert.equal(fixture.system.adapter.calls.length,before,'Rejected tools must not reach the fixture provider');
    const unknown = await fixture.call(protocol,'unknown/method'); assert.ok(unknown.rpc?.error);
  } finally { await fixture.close(); }
});
test('Project2 modern mismatched method and unsupported version fail at actual HTTP boundary', async () => {
  const fixture = await fixtureHttp();
  try {
    const mismatch = await fixture.call('2026-07-28','tools/list',{}, {'mcp-method':'tools/call'});
    assert.ok(mismatch.status >= 400 || mismatch.rpc?.error);
    for (const overrides of [{ 'mcp-method': null }, { 'mcp-name': 'wrong' }] as Record<string, string | null>[]) {
      const rejected = await fixture.call('2026-07-28','tools/call',{name:'at_whoami',arguments:{}},overrides);
      assert.equal(rejected.status,400); assert.ok(rejected.rpc?.error);
    }
    const metadataVersion = await fixture.call('2026-07-28','tools/call',{name:'at_whoami',arguments:{}},{'mcp-protocol-version':null});
    assert.equal(metadataVersion.status,200); assert.ok(metadataVersion.rpc.result.structuredContent);
    const unsupported = await fixture.call('2099-01-01','tools/list'); assert.ok(unsupported.status >= 400 || unsupported.rpc?.error);
    assert.equal(fixture.system.adapter.calls.length,0);
  } finally { await fixture.close(); }
});
