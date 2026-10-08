import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, actorKey, type JournalRecord, type Principal } from '../packages/contracts/src/index.js';
import { ControlPlaneService, MemoryControlPlaneStore } from '../packages/control-plane/src/index.js';
import { IntentCipher, MemoryJournal } from '../packages/storage/src/index.js';

function setup() {
  const principal: Principal = { tenantId: randomUUID(), objectId: randomUUID(), resourceId: 101, mappingVersion: 1, policyVersion: 'v1', active: true,
    capabilities: ['operational.read', 'tickets.write', 'platform.manage', 'audit.read'], companyIds: [10], resourceVerifiedAt: new Date().toISOString() };
  const journal = new MemoryJournal(), records: JournalRecord[] = [];
  const store = new MemoryControlPlaneStore([principal], journal, async () => records);
  const service = new ControlPlaneService(store, { bootstrapIdentityKeys: [], cipher: new IntentCipher(randomBytes(32)) });
  const change = (patch: Partial<Principal>) => store.saveMember(principal, { ...principal, mappingVersion: 2, policyVersion: 'v2', ...patch }, 1, new Date().toISOString());
  const enqueue = () => service.enqueue(principal, { operation: 'ticket_note_add', requestKey: randomUUID(), payload: { ticket: { kind: 'id', id: 1001 }, note: { text: 'Protected job input', audience: 'internal' } } });
  return { principal, store, service, change, enqueue, journal, records };
}
const denied = (error: unknown) => error instanceof AppError && ['forbidden', 'identity_mapping_invalid'].includes(error.code);

test('a revoked administrator cannot receive an already-read member snapshot', async () => {
  const s = setup(), list = s.store.listMembers.bind(s.store);
  s.store.listMembers = async (...args) => { const result = await list(...args); await s.change({ capabilities: ['operational.read'] }); return result; };
  await assert.rejects(s.service.snapshot(s.principal), denied);
});

test('audit role revocation during the audit-store read blocks the tenant audit response', async () => {
  const s = setup(); await s.enqueue(); const list = s.store.listAudit.bind(s.store);
  s.store.listAudit = async (...args) => { const result = await list(...args); assert.ok(result.items.length); await s.change({ capabilities: ['operational.read'] }); return result; };
  await assert.rejects(s.service.audit(s.principal), denied);
});

for (const method of ['activity', 'jobs', 'job'] as const) test(`${method} rejects a changed actor mapping after its storage read`, async () => {
  const s = setup(), job = await s.enqueue();
  if (method === 'activity') {
    const list = s.store.listOperations.bind(s.store);
    s.store.listOperations = async (...args) => { const result = await list(...args); await s.change({ resourceId: 102 }); return result; };
  } else if (method === 'jobs') {
    const list = s.store.listJobs.bind(s.store);
    s.store.listJobs = async (...args) => { const result = await list(...args); assert.ok(result.items.length); await s.change({ active: false }); return result; };
  } else {
    const get = s.store.getJob.bind(s.store);
    s.store.getJob = async (...args) => { const result = await get(...args); assert.ok(result); await s.change({ companyIds: [] }); return result; };
  }
  await assert.rejects(method === 'activity' ? s.service.activity(s.principal) : method === 'jobs' ? s.service.jobs(s.principal) : s.service.job(s.principal, job.id), denied);
});

test('unchanged scoped reads remain available and job bodies stay redacted', async () => {
  const s = setup(), job = await s.enqueue();
  assert.equal((await s.service.snapshot(s.principal)).members.length, 1);
  assert.ok((await s.service.audit(s.principal)).items.length);
  assert.equal((await s.service.jobs(s.principal)).items.length, 1);
  assert.equal((await s.service.job(s.principal, job.id)).id, job.id);
  assert.equal((await s.service.activity(s.principal)).items.length, 0);
  assert.doesNotMatch(JSON.stringify(await s.service.job(s.principal, job.id)), /Protected job input|encryptedPayload|leaseToken/);
});

for (const change of ['mapping', 'company'] as const) test(`historical activity omits saved business details after ${change} changes`, async () => {
  const s = setup();
  const { record } = await s.journal.reserve({ actorKey: actorKey(s.principal), requestKey: randomUUID(), operation: 'ticket_document_work', payloadHash: 'a'.repeat(64),
    resourceId: s.principal.resourceId, mappingVersion: s.principal.mappingVersion, policyVersion: s.principal.policyVersion,
    result: { ticket_id: 9131001, note_id: 9132001, time_entry_id: 9133001, recorded_resource_id: 101, actual_minutes: 47, audience: 'internal' } });
  s.records.push(record);
  await s.change(change === 'mapping' ? { resourceId: 102 } : { companyIds: [] });
  const activity = await s.service.activity(s.principal);
  assert.equal(activity.items.length, 1);
  assert.deepEqual(Object.keys(activity.items[0]!).sort(), ['id', 'operation', 'state', 'createdAt', 'updatedAt'].sort());
  assert.equal(activity.items[0]!.id, record.id);
  assert.doesNotMatch(JSON.stringify(activity), /9131001|9132001|9133001|ticket_id|note_id|time_entry_id|recorded_resource_id|actual_minutes|audience|result/);
});
