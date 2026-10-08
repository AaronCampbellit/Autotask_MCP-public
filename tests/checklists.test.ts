import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { ChecklistService, FixtureChecklistPort, HttpChecklistPort } from '../packages/checklists/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals, fixtureRecords } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { MemoryJournal, MemoryPrincipalStore, IntentCipher } from '../packages/storage/src/index.js';
import { actorKey, type Principal } from '../packages/contracts/src/index.js';

function fixtureSetup(clock?: () => number) {
  const principal = fixturePrincipals()[0]!;
  const store = new MemoryPrincipalStore([principal]);
  const adapter = new FixtureAutotaskAdapter(async p => { const fresh = await store.get(p.tenantId, p.objectId); if (!fresh) throw new Error('missing principal'); return fresh; }, fixtureRecords());
  const journal = new MemoryJournal();
  const core = new TicketWorkflows(adapter, store, journal);
  const port = new FixtureChecklistPort(store);
  const cipher = new IntentCipher(Buffer.alloc(32, 4));
  const service = new ChecklistService(core, port, cipher, 300_000, clock);
  return { principal, store, adapter, journal, port, cipher, service };
}

const ticket = { kind: 'id' as const, id: 1001 };
const expected = { item_name: 'Confirm service restored', is_completed: true, is_important: true, position: 1, knowledgebase_article_id: null };

test('checklist fixture CRUD enforces parent scope, expected values, readback and idempotency', async () => {
  const s = fixtureSetup();
  const created = await s.service.create(s.principal, { ticket, item_name: 'Verify monitoring', is_completed: false, is_important: true, position: 2, request_key: 'check-create-1' });
  assert.equal(created.status, 'succeeded_verified');
  assert.equal(s.port.records.items.length, 2);
  const repeated = await s.service.create(s.principal, { ticket, item_name: 'Verify monitoring', is_completed: false, is_important: true, position: 2, request_key: 'check-create-1' });
  assert.equal(repeated.operation_id, created.operation_id);
  assert.equal(s.port.records.items.length, 2);
  s.adapter.records.Tickets.push({ id: 1003, ticketNumber: 'T20260910.0003', title: 'Another ticket', companyID: 10, assignedResourceID: 101, status: 1 });
  await assert.rejects(s.service.create(s.principal, { ticket: { kind: 'id', id: 1003 }, item_name: 'Verify monitoring', is_completed: false, is_important: true, position: 2, request_key: 'check-create-1' }), error => (error as { code?: string }).code === 'conflict');
  const itemId = Number(created.data.item_id);
  const updated = await s.service.update(s.principal, { ticket, item_id: itemId, changes: { is_completed: true, item_name: 'Verify monitoring complete' }, expected: { ...expected, item_name: 'Verify monitoring', is_completed: false, position: 2 }, request_key: 'check-update-1' });
  assert.equal(updated.status, 'succeeded_verified');
  assert.equal(s.port.records.items.find(item => item.id === itemId)?.isCompleted, true);
  await assert.rejects(s.service.update(s.principal, { ticket, item_id: itemId, changes: { is_important: false }, expected: { ...expected, item_name: 'Verify monitoring complete', is_completed: false, position: 2 }, request_key: 'check-stale-1' }));
  const deleted = await s.service.delete(s.principal, { ticket, item_id: itemId, expected: { ...expected, item_name: 'Verify monitoring complete', is_completed: true, position: 2 }, request_key: 'check-delete-1' });
  assert.equal(deleted.status, 'succeeded_verified');
  assert.equal(s.port.records.items.some(item => item.id === itemId), false);
  const foreign = fixturePrincipals()[1]!;
  await assert.rejects(s.service.search(foreign, { ticket }), error => ['not_found_or_inaccessible', 'identity_mapping_invalid'].includes((error as { code?: string }).code ?? ''));
});

test('expired checklist intent does not perform native readback', async () => {
  let now = Date.now();
  const s = fixtureSetup(() => now);
  const intent = { ticket_id: 1001, body: { itemName: 'Expired item', isCompleted: false, isImportant: false } };
  const payloadHash = createHashForTest({ operation: 'checklist_item_create', intent, actor: actorKey(s.principal), mapping: s.principal.mappingVersion, policy: s.principal.policyVersion });
  const binding = `${actorKey(s.principal)}:${s.principal.mappingVersion}:${s.principal.resourceId}:${s.principal.policyVersion}:expired-check-key:${payloadHash}`;
  const reserved = await s.journal.reserve({ actorKey: actorKey(s.principal), requestKey: 'expired-check-key', payloadHash, operation: 'checklist_item_create', mappingVersion: s.principal.mappingVersion, resourceId: s.principal.resourceId, policyVersion: s.principal.policyVersion, encryptedIntent: s.cipher.seal(intent, binding), intentExpiresAt: new Date(now + 1_000).toISOString(), result: { ticket_id: 1001 } });
  await s.journal.transition(reserved.record.id, 'ready', 'dispatching');
  await s.journal.transition(reserved.record.id, 'dispatching', 'accepted_unverified', { ticket_id: 1001, item_id: 6201 });
  now += 2_000;
  const result = await s.service.operationStatus(s.principal, { operation_id: reserved.record.id });
  assert.equal(result.status, 'accepted_unverified');
  assert.equal(s.port.calls.some(call => call.operation === 'TicketChecklistItems.get'), false);
});

test('revocation after checklist readback preserves accepted-unverified and rejects the caller', async () => {
  const s = fixtureSetup();
  const originalGet = s.port.get.bind(s.port);
  s.port.get = async (...args) => { const row = await originalGet(...args); s.store.set({ ...s.principal, active: false }); return row; };
  await assert.rejects(s.service.create(s.principal, { ticket, item_name: 'Revoke after readback', request_key: 'check-revoke-key' }), error => ['identity_mapping_invalid', 'identity_validation_unavailable', 'forbidden'].includes((error as { code?: string }).code ?? ''));
  const record = s.journal.inspectAll().find(row => row.requestKey === 'check-revoke-key');
  assert.equal(record?.state, 'accepted_unverified');
});

function createHashForTest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

test('checklist completion and metadata are bounded to native fields', async () => {
  const s = fixtureSetup();
  const options = await s.service.options(s.principal, { ticket });
  assert.equal(options.limits.max_items, 40);
  assert.ok(options.fields.some(field => field.name === 'completedDateTime' && field.isReadOnly === true));
  await assert.rejects(s.service.create(s.principal, { ticket, item_name: 'Bad field', completed_date_time: '2026-09-14T00:00:00Z', request_key: 'check-bad-field' }));
  const before = s.port.records.items.length;
  const originalFields = s.port.fields.bind(s.port);
  s.port.fields = async (principal, ticketId) => (await originalFields(principal, ticketId)).map(field => field.name === 'itemName' ? { ...field, isReadOnly: true } : field);
  await assert.rejects(s.service.create(s.principal, { ticket, item_name: 'One', request_key: 'check-metadata-drift' }), error => (error as { code?: string }).code === 'missing_metadata');
  assert.equal(s.port.records.items.length, before);
});

test('HTTP checklist adapter uses the captured nested child routes and mapped actor', async () => {
  const principal: Principal = { tenantId: 'tenant', objectId: 'employee', resourceId: 101, mappingVersion: 1, policyVersion: 'policy', capabilities: ['operational.read', 'tickets.write'], companyIds: [10], active: true, resourceVerifiedAt: new Date().toISOString() };
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const fields = { fields: [
    { name: 'id', dataType: 'integer', isReadOnly: true, isRequired: true }, { name: 'completedByResourceID', dataType: 'integer', isReadOnly: true }, { name: 'completedDateTime', dataType: 'datetime', isReadOnly: true },
    { name: 'isCompleted', dataType: 'boolean', isReadOnly: false }, { name: 'isImportant', dataType: 'boolean', isReadOnly: false }, { name: 'itemName', dataType: 'string', isReadOnly: false, isRequired: true }, { name: 'knowledgebaseArticleID', dataType: 'integer', isReadOnly: false }, { name: 'position', dataType: 'integer', isReadOnly: false }, { name: 'ticketID', dataType: 'integer', isReadOnly: true, isRequired: true },
  ] };
  const port = new HttpChecklistPort({ baseUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/', username: 'u', secret: 's', integrationCode: 'i', writesEnabled: true, applicationOperations: { tenantId: principal.tenantId, operations: ['TicketChecklistItems.query', 'TicketChecklistItems.get', 'TicketChecklistItems.fields', 'TicketChecklistItems.create', 'TicketChecklistItems.update', 'TicketChecklistItems.delete'] }, revalidatePrincipal: async p => structuredClone(p), fetch: async (url, init) => { const path = new URL(String(url)).pathname.split('/v1.0/')[1]!; calls.push({ path, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }); if (path.endsWith('/entityInformation/fields')) return Response.json(fields); if (init?.method === 'POST') return Response.json({ itemId: 9002 }); if (init?.method === 'DELETE') return new Response(null, { status: 204 }); if (path.endsWith('/ChecklistItems')) return Response.json({ items: [{ id: 9001, ticketID: 1001, itemName: 'Check', isCompleted: false, isImportant: true, position: 1 }], pageDetails: { nextPageUrl: null } }); return Response.json({ item: { id: 9001, ticketID: 1001, itemName: 'Check', isCompleted: false, isImportant: true, position: 1 } }); } });
  assert.equal((await port.list(principal, 1001)).items[0]!.ticketID, 1001);
  assert.deepEqual(await port.create(principal, 1001, { itemName: 'Added', isCompleted: false, isImportant: false }), { id: 9002 });
  assert.deepEqual(await port.update(principal, 1001, 9001, { isCompleted: true }), { id: 9001 });
  await port.delete(principal, 1001, 9001);
  assert.deepEqual(calls.map(call => [call.method, call.path]), [['GET', 'Tickets/1001/ChecklistItems'], ['POST', 'Tickets/1001/ChecklistItems'], ['PATCH', 'Tickets/1001/ChecklistItems'], ['DELETE', 'Tickets/1001/ChecklistItems/9001']]);
  assert.deepEqual(calls[1]!.body, { itemName: 'Added', isCompleted: false, isImportant: false });
});
