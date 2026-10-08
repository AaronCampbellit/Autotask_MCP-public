import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from '../apps/server/src/app.js';
import { AppError } from '../packages/contracts/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';

const base = 'http://127.0.0.1:3030';
const ticket = { kind: 'id', id: 1001 };
const note = { title: 'Fictitious work note', text: 'Fictitious internal diagnostic detail.', audience: 'internal' };
const time = { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 30, summary: 'Separate fictitious time summary.' };
const documentInput = () => ({ ticket: { ...ticket }, note: { ...note }, time: { ...time }, request_key: 'mcp-document-work-001' });
const newTools = ['ticket_note_add', 'time_log_ticket', 'ticket_document_work', 'at_operation_resume'];

function setup(configureWrites = true) {
  const principals = fixturePrincipals(), store = new MemoryPrincipalStore(principals);
  const adapter = new FixtureAutotaskAdapter((p) => reauthorize(p, store));
  const journal = new MemoryJournal(), workflows = new TicketWorkflows(adapter, store, journal);
  const writes = new TicketWriteWorkflows(workflows, new IntentCipher(Buffer.alloc(32, 7)));
  const app = createApplication({ publicUrl: base, workflows, ...(configureWrites ? { writes } : {}), authenticate: async (token) => {
    const principal = token === 'technician' ? principals[0] : token === 'reader' ? principals[1] : undefined;
    if (!principal) throw new AppError('unauthenticated', 'Invalid fixture token.');
    return reauthorize(principal, store);
  } });
  return { app, principals, store, adapter, journal, workflows, writes };
}

function request(method: string, params: unknown, token = 'technician', modern = false) {
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'fixture-write-test', version: '1.0' }, 'io.modelcontextprotocol/clientCapabilities': {} };
  return new Request(`${base}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': modern ? '2026-07-28' : '2025-11-25', ...(modern ? { 'mcp-method': method } : {}),
    ...(modern && method === 'tools/call' ? { 'mcp-name': (params as { name: string }).name } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...(params as object), ...(modern ? { _meta: meta } : {}) } }) });
}
async function rpc(response: Response) {
  assert.equal(response.status, 200);
  const body = await response.text();
  return JSON.parse(body.startsWith('event:') || body.startsWith('data:') ? body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : body);
}
async function call(s: ReturnType<typeof setup>, name: string, args: unknown, token = 'technician', modern = false) {
  return rpc(await s.app.fetch(request('tools/call', { name, arguments: args }, token, modern)));
}
const creates = (s: ReturnType<typeof setup>) => s.adapter.calls.filter((entry) => entry.kind === 'create');

test('configured MCP exposes exactly ten tools for a full technician with accurate write annotations and schemas', async (t) => {
  const s = setup(); t.after(() => s.app.close());
  const response = await rpc(await s.app.fetch(request('tools/list', {})));
  const tools = response.result.tools as Array<{ name: string; annotations: Record<string, boolean>; inputSchema: any }>;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'at_whoami', 'ticket_search', 'ticket_context', 'time_entry_search', 'ticket_update', 'at_operation_status', ...newTools,
  ].sort());
  for (const name of newTools) {
    const tool = tools.find((item) => item.name === name)!;
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, name !== 'at_operation_resume');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const document = tools.find((item) => item.name === 'ticket_document_work')!.inputSchema;
  assert.deepEqual([...document.required].sort(), ['ticket', 'note', 'time', 'request_key'].sort());
  assert.deepEqual([...document.properties.note.required].sort(), ['text', 'audience'].sort());
  assert.deepEqual([...document.properties.time.required].sort(), ['work_date', 'timezone', 'minutes', 'summary'].sort());
  assert.equal(document.properties.note.additionalProperties, false);
  assert.equal(document.properties.time.additionalProperties, false);
  assert.equal(creates(s).length, 0);
});

test('read-only employee cannot discover or invoke any new mutation tool', async (t) => {
  const s = setup(); t.after(() => s.app.close());
  const response = await rpc(await s.app.fetch(request('tools/list', {}, 'reader')));
  const names = response.result.tools.map((tool: { name: string }) => tool.name);
  assert.deepEqual(names.sort(), ['at_whoami', 'ticket_search', 'ticket_context', 'at_operation_status'].sort());
  for (const name of newTools) {
    const result = await call(s, name, { ...documentInput(), ticket: { kind: 'id', id: 2001 } }, 'reader');
    assert.ok(result.error || result.result?.isError, JSON.stringify(result));
  }
  assert.equal(s.adapter.calls.length, 0);
});

test('actual legacy MCP document-work call saves verified note and time and same-key repetition returns their original operation', async (t) => {
  const s = setup(); t.after(() => s.app.close());
  const originalTicket = structuredClone(s.adapter.records.Tickets[0]);
  const response = await call(s, 'ticket_document_work', documentInput());
  assert.equal(response.result.isError, undefined, JSON.stringify(response));
  const result = response.result.structuredContent;
  assert.equal(result.status, 'succeeded_verified');
  assert.equal(result.provenance.source, 'fixture');
  assert.equal(result.data.steps.note.state, 'succeeded_verified');
  assert.equal(result.data.steps.time.state, 'succeeded_verified');
  assert.deepEqual(creates(s).map((entry) => entry.entity), ['TicketNotes', 'TimeEntries']);
  const savedNote = s.adapter.records.TicketNotes.find((row) => row.id === result.data.steps.note.native_id)!;
  const savedTime = s.adapter.records.TimeEntries.find((row) => row.id === result.data.steps.time.native_id)!;
  assert.equal(savedNote.description, note.text);
  assert.equal(savedNote.publish, 701);
  assert.equal(savedNote.creatorResourceID, s.principals[0]!.resourceId);
  assert.equal(savedTime.summaryNotes, time.summary);
  assert.equal(savedTime.hoursWorked, 0.5);
  assert.equal(savedTime.dateWorked, '2026-09-10T00:00:00Z');
  assert.equal(savedTime.resourceID, s.principals[0]!.resourceId);
  assert.equal(savedTime.internalNotes, undefined);
  assert.deepEqual(s.adapter.records.Tickets[0], originalTicket);
  const duplicate = await call(s, 'ticket_document_work', documentInput());
  assert.equal(duplicate.result.structuredContent.operation_id, result.operation_id);
  assert.equal(creates(s).length, 2);
  const status = await call(s, 'at_operation_status', { operation_id: result.operation_id });
  assert.equal(status.result.structuredContent.status, 'succeeded_verified');
  assert.equal(status.result.structuredContent.data.steps.note.native_id, savedNote.id);
  assert.equal(status.result.structuredContent.data.steps.time.native_id, savedTime.id);
  assert.equal(creates(s).length, 2);
});

test('standalone note/time tools also execute through modern MCP without creating an unrequested companion record', async (t) => {
  const s = setup(); t.after(() => s.app.close());
  const noteResult = await call(s, 'ticket_note_add', { ticket, note, request_key: 'modern-note-only-001' }, 'technician', true);
  assert.equal(noteResult.result.structuredContent.status, 'succeeded_verified', JSON.stringify(noteResult));
  assert.deepEqual(creates(s).map((entry) => entry.entity), ['TicketNotes']);
  const timeResult = await call(s, 'time_log_ticket', { ticket, time, request_key: 'modern-time-only-001' }, 'technician', true);
  assert.equal(timeResult.result.structuredContent.status, 'succeeded_verified', JSON.stringify(timeResult));
  assert.deepEqual(creates(s).map((entry) => entry.entity), ['TicketNotes', 'TimeEntries']);
});

test('MCP schemas reject missing business inputs and extra identity/publication/billing fields before executing the adapter', async (t) => {
  const s = setup(); t.after(() => s.app.close());
  const input = documentInput();
  const invalid: Array<{ name: string; args: unknown }> = [
    { name: 'ticket_document_work', args: { ...input, request_key: undefined } },
    { name: 'ticket_document_work', args: { ...input, ticket: undefined } },
    { name: 'ticket_document_work', args: { ...input, note: undefined } },
    { name: 'ticket_document_work', args: { ...input, time: undefined } },
    { name: 'ticket_document_work', args: { ...input, approval_token: 'not-a-tool-input' } },
    { name: 'ticket_document_work', args: { ...input, note: { ...note, audience: undefined } } },
    { name: 'ticket_document_work', args: { ...input, note: { ...note, text: undefined } } },
    { name: 'ticket_document_work', args: { ...input, note: { ...note, publish: 702 } } },
    { name: 'ticket_document_work', args: { ...input, time: { ...time, resourceID: 102 } } },
    { name: 'ticket_document_work', args: { ...input, time: { ...time, isNonBillable: false } } },
    { name: 'ticket_document_work', args: { ...input, time: { ...time, minutes: undefined } } },
    { name: 'ticket_document_work', args: { ...input, time: { ...time, work_date: undefined } } },
    { name: 'ticket_document_work', args: { ...input, time: { ...time, timezone: undefined } } },
    { name: 'ticket_document_work', args: { ...input, time: { ...time, summary: undefined } } },
    { name: 'ticket_note_add', args: { ticket, note: { ...note, audience: undefined }, request_key: 'invalid-note-001' } },
    { name: 'time_log_ticket', args: { ticket, time: { ...time, minutes: 0 }, request_key: 'invalid-time-001' } },
    { name: 'at_operation_resume', args: { operation_id: '00000000-0000-4000-8000-000000000001', note } },
  ];
  for (const { name, args } of invalid) {
    const result = await call(s, name, args);
    assert.ok(result.error || result.result?.isError, `${name}: ${JSON.stringify(args)}: ${JSON.stringify(result)}`);
  }
  assert.equal(s.adapter.calls.length, 0);
});

test('without configured write workflows MCP continues to expose only the foundation tools', async (t) => {
  const s = setup(false); t.after(() => s.app.close());
  const response = await rpc(await s.app.fetch(request('tools/list', {})));
  assert.equal(response.result.tools.length, 6);
  assert.ok(response.result.tools.every((tool: { name: string }) => !newTools.includes(tool.name)));
});
