import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { actorKey, type Journal, type Principal } from '../packages/contracts/src/index.js';
import { IntentCipher, MemoryJournal, PostgresJournal } from '../packages/storage/src/index.js';
import { ControlPlaneService, MemoryControlPlaneStore, PostgresControlPlaneStore, type ControlPlaneStore, type ControlSqlClient } from '../packages/control-plane/src/index.js';

const foundation = await readFile('packages/storage/migrations/001_foundation.sql', 'utf8');
const intents = await readFile('packages/storage/migrations/002_workflow_intents.sql', 'utf8');
const migration = await readFile('packages/storage/migrations/003_control_plane.sql', 'utf8');
const db = new PGlite();
before(async () => { await db.exec(foundation); await db.exec(intents); await db.exec(migration); });
after(async () => { await db.close(); });

async function setup(backend: 'memory' | 'postgres', actorJobLimit = 32, tenantJobLimit = 256) {
  // Worker claims span all tenants. Isolate each in-memory database scenario's queue.
  if (backend === 'postgres') await db.query('TRUNCATE control_jobs');
  let now = Date.now();
  const tenantId = randomUUID();
  const owner: Principal = { tenantId, objectId: randomUUID(), resourceId: 101, mappingVersion: 1, policyVersion: 'v1', active: true,
    capabilities: ['operational.read', 'tickets.write', 'time.self', 'scheduling.write'], companyIds: [10], resourceVerifiedAt: new Date().toISOString() };
  const peer = { ...owner, objectId: randomUUID(), resourceId: 102 };
  const foreign = { ...owner, tenantId: randomUUID() };
  const journal: Journal = backend === 'postgres' ? new PostgresJournal(db) : new MemoryJournal();
  const operationRecords: import('../packages/contracts/src/index.js').JournalRecord[] = [];
  const store: ControlPlaneStore = backend === 'postgres' ? new PostgresControlPlaneStore(db) : new MemoryControlPlaneStore([owner, peer, foreign], journal, async () => operationRecords);
  if (backend === 'postgres') for (const p of [owner, peer, foreign]) {
    await db.query(`INSERT INTO identity_mappings (tenant_id,object_id,resource_id,mapping_version,policy_version,active,resource_verified_at,policy)
      VALUES ($1,$2,$3,1,'v1',true,$4,$5::jsonb)`, [p.tenantId, p.objectId, p.resourceId, p.resourceVerifiedAt, JSON.stringify({ capabilities: p.capabilities, companyIds: p.companyIds })]);
  }
  const secret = randomBytes(32);
  const options = { bootstrapIdentityKeys: [actorKey(owner)], cipher: new IntentCipher(secret), clock: () => now,
    actorJobLimit, tenantJobLimit, verifyResource: async (_tenant: string, id: number) => id < 1000,
    safeConfig: { mode: 'fixture' as const, liveQualified: false, databaseConfigured: backend === 'postgres', intentKeyConfigured: true, secretReferences: { autotask_secret: 'env:AUTOTASK_SECRET' } } };
  const service = new ControlPlaneService(store, options);
  const enqueue = (requestKey: string = randomUUID(), actor = owner, overrides: Record<string, unknown> = {}) => service.enqueue(actor, {
    operation: 'ticket_note_add', requestKey, payload: { ticket: { kind: 'id', id: 1001 }, note: { title: 'PRIVATE TITLE CANARY', text: 'PRIVATE NOTE BODY CANARY', audience: 'internal' }, request_key: 'untrusted-user-key' }, ...overrides,
  });
  const operation = async (jobId: string, state: 'succeeded_verified' | 'failed', requestKey = `job:${jobId}`) => {
    const reserved = await journal.reserve({ actorKey: actorKey(owner), requestKey, payloadHash: 'a'.repeat(64), operation: 'ticket_note_add', resourceId: owner.resourceId, mappingVersion: owner.mappingVersion, policyVersion: owner.policyVersion, result: { ticket_id: 1001, title: 'SECRET JOURNAL BODY' } });
    await journal.transition(reserved.record.id, 'ready', 'dispatching');
    const record = await journal.transition(reserved.record.id, 'dispatching', state, { ticket_id: 1001, note_id: 9001, title: 'SECRET JOURNAL BODY' });
    operationRecords.push(record); return record;
  };
  return { owner, peer, foreign, store, service, options, secret, journal, enqueue, operation, advance: (ms: number) => { now += ms; }, at: () => new Date(now).toISOString() };
}

for (const backend of ['memory', 'postgres'] as const) {
  test(`${backend}: member activation preserves the actual resource capture time and rejects stale or future evidence`, async () => {
    const s = await setup(backend), verifiedAt = new Date(Date.parse(s.at()) - 120_000).toISOString();
    const verifier = new ControlPlaneService(s.store, { ...s.options, verifyResource: async () => ({ verifiedAt }) });
    const input = { objectId: s.peer.objectId, resourceId: 102, active: true, capabilities: ['operational.read'] as Principal['capabilities'], companyIds: [10] };
    const saved = await verifier.saveMember(s.owner, input, 1); assert.equal(saved.resourceVerifiedAt, verifiedAt);
    for (const timestamp of ['invalid', new Date(Date.parse(s.at()) + 1).toISOString(), new Date(Date.parse(s.at()) - 300_000).toISOString()]) {
      const invalid = new ControlPlaneService(s.store, { ...s.options, verifyResource: async () => ({ verifiedAt: timestamp }) });
      await assert.rejects(invalid.saveMember(s.owner, input, 2), { code: 'identity_validation_unavailable' });
    }
  });
  test(`${backend}: administration requires a configured bootstrap identity or current platform.manage`, async () => {
    const s = await setup(backend);
    assert.equal((await s.service.snapshot(s.owner)).healthy, true);
    await assert.rejects(s.service.snapshot(s.peer), { code: 'forbidden' });
    const unconfigured = new ControlPlaneService(s.store, { ...s.options, bootstrapIdentityKeys: [] });
    await assert.rejects(unconfigured.snapshot(s.owner), { code: 'forbidden' });
    await assert.rejects(s.service.snapshot(s.foreign), { code: 'forbidden' });
    await assert.rejects(s.service.snapshot({ tenantId: s.owner.tenantId, objectId: randomUUID() }), { code: 'identity_mapping_invalid' });
    const promoted = await s.service.saveMember(s.owner, { objectId: s.peer.objectId, resourceId: 102, active: true, capabilities: ['operational.read', 'platform.manage'], companyIds: [10] }, 1);
    assert.equal(promoted.mappingVersion, 2);
    assert.equal((await unconfigured.snapshot(s.peer)).members.length, 2);
    await s.service.saveMember(s.owner, { objectId: s.peer.objectId, resourceId: 102, active: true, capabilities: ['operational.read'], companyIds: [10] }, 2);
    await assert.rejects(unconfigured.snapshot(s.peer), { code: 'forbidden' });
  });

  test(`${backend}: member mapping edits use CAS, tenant resource uniqueness and real activation verification`, async () => {
    const s = await setup(backend);
    const input = { objectId: s.peer.objectId, resourceId: 102, active: true, capabilities: ['operational.read'] as Principal['capabilities'], companyIds: [10] };
    const edits = await Promise.allSettled(Array.from({ length: 8 }, () => s.service.saveMember(s.owner, input, 1)));
    assert.equal(edits.filter(e => e.status === 'fulfilled').length, 1);
    await assert.rejects(s.service.saveMember(s.owner, { ...input, objectId: randomUUID(), resourceId: 101 }, 0), { code: 'conflict' });
    await assert.rejects(s.service.saveMember(s.owner, { ...input, objectId: randomUUID(), resourceId: 9999 }, 0), { code: 'identity_mapping_invalid' });
    const withoutVerifier = new ControlPlaneService(s.store, { ...s.options, verifyResource: undefined });
    await assert.rejects(withoutVerifier.saveMember(s.owner, { ...input, objectId: randomUUID(), resourceId: 500 }, 0), { code: 'identity_validation_unavailable' });
    const staged = await withoutVerifier.saveMember(s.owner, { ...input, objectId: randomUUID(), resourceId: 500, active: false }, 0);
    assert.equal(staged.resourceVerifiedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(staged.active, false);
  });

  test(`${backend}: permission templates and current dispatch controls are audited with bounded safe configuration`, async () => {
    const s = await setup(backend);
    const template = await s.service.saveTemplate(s.owner, { key: 'scheduler', capabilities: ['operational.read', 'scheduling.write'], companyIds: [10] }, 0);
    assert.equal(template.version, 1);
    await assert.rejects(s.service.saveTemplate(s.owner, { key: 'scheduler', capabilities: [], companyIds: [] }, 0), { code: 'conflict' });
    await s.service.assertDispatchAllowed(s.owner, 'ticket_note_add', true);
    await s.service.setControls(s.owner, { writePaused: true, tools: {} }, 0);
    await assert.rejects(s.service.assertDispatchAllowed(s.owner, 'ticket_note_add'), { code: 'forbidden' });
    await s.service.setControls(s.owner, { writePaused: false, tools: { ticket_note_add: false } }, 1);
    await assert.rejects(s.service.assertDispatchAllowed(s.owner, 'ticket_note_add'), { code: 'forbidden' });
    await s.service.assertDispatchAllowed(s.owner, 'time_log_ticket');
    await assert.rejects(s.service.setControls(s.owner, { writePaused: false, tools: { arbitrary_remote_execution: true } }, 2), { code: 'invalid_input' });
    const snapshot = await s.service.snapshot(s.owner);
    assert.equal(snapshot.config?.secretReferences.autotask_secret, 'env:AUTOTASK_SECRET');
    assert.throws(() => new ControlPlaneService(s.store, { ...s.options, safeConfig: { ...s.options.safeConfig, secretReferences: { api_key: 'PLAINTEXT-API-KEY-CANARY' } } }), { code: 'invalid_input' });
    const audit = await s.service.audit(s.owner);
    assert.equal(audit.items.filter(event => event.action === 'controls.saved').length, 2);
    assert.ok(!JSON.stringify(audit).includes('PLAINTEXT'));
  });

  test(`${backend}: actor-owned job reservations are encrypted, duplicate-safe and hidden from peers`, async () => {
    const s = await setup(backend);
    const jobs = await Promise.all(Array.from({ length: 10 }, () => s.enqueue('duplicate-job-key')));
    assert.equal(new Set(jobs.map(j => j.id)).size, 1);
    assert.equal((await s.service.jobs(s.owner)).items.length, 1);
    assert.equal((await s.service.jobs(s.peer)).items.length, 0);
    await assert.rejects(s.service.job(s.peer, jobs[0]!.id), { code: 'not_found_or_inaccessible' });
    await assert.rejects(s.service.cancel(s.foreign, jobs[0]!.id), { code: 'not_found_or_inaccessible' });
    await assert.rejects(s.enqueue('duplicate-job-key', s.owner, { payload: { changed: true } }), { code: 'conflict' });
    assert.ok(!JSON.stringify(jobs).includes('PRIVATE NOTE'));
    assert.ok(!JSON.stringify(jobs).includes('encryptedPayload'));
    const raw = await s.store.getJob(jobs[0]!.id, actorKey(s.owner));
    assert.ok(raw?.encryptedPayload?.startsWith('v1.'));
    assert.ok(!JSON.stringify(raw).includes('PRIVATE NOTE'));
  });

  test(`${backend}: job actor and tenant quotas hold under concurrent enqueue`, async () => {
    const s = await setup(backend, 2, 3);
    const requests = await Promise.allSettled(Array.from({ length: 8 }, () => s.enqueue()));
    assert.equal(requests.filter(r => r.status === 'fulfilled').length, 2);
    await s.enqueue('peer-job-0001', s.peer);
    await assert.rejects(s.enqueue('peer-job-0002', s.peer), { code: 'throttled' });
    assert.equal((await s.service.jobs(s.owner)).items.length, 2);
  });

  test(`${backend}: expired undispatched leases can be reclaimed with fencing, but cannot dispatch twice`, async () => {
    const s = await setup(backend), queued = await s.enqueue();
    const first = await s.service.claim('worker-a', 1000); assert.ok(first);
    assert.equal(await s.service.claim('worker-b', 1000), undefined);
    s.advance(1001);
    const second = await s.service.claim('worker-b', 1000); assert.ok(second);
    assert.equal(second.job.id, queued.id); assert.equal(second.fence, first.fence + 1);
    await assert.rejects(s.service.beginDispatch(first), { code: 'conflict' });
    await assert.rejects(s.service.finish(first, 'failed'), { code: 'conflict' });
    const begun = await s.service.beginDispatch(second);
    assert.equal((begun.payload as { request_key: string }).request_key, `job:${queued.id}`);
    assert.equal((begun.payload as { note: { text: string } }).note.text, 'PRIVATE NOTE BODY CANARY');
    await assert.rejects(s.service.beginDispatch(second), { code: 'conflict' });
  });

  test(`${backend}: dispatched lease loss becomes uncertain and never automatically replays creation`, async () => {
    const s = await setup(backend), job = await s.enqueue('uncertain-job-key');
    const lease = await s.service.claim('worker-a', 1000); assert.ok(lease); await s.service.beginDispatch(lease);
    s.advance(1001);
    assert.equal(await s.service.claim('worker-b', 1000), undefined);
    assert.equal((await s.service.job(s.owner, job.id)).state, 'uncertain');
    assert.equal((await s.enqueue('uncertain-job-key')).state, 'uncertain');
    await assert.rejects(s.service.finish(lease, 'succeeded'), { code: 'conflict' });
  });

  test(`${backend}: cancellation prevents queued dispatch and requests cancellation without erasing uncertain effects`, async () => {
    const s = await setup(backend);
    const queued = await s.enqueue(); assert.equal((await s.service.cancel(s.owner, queued.id)).state, 'cancelled');
    assert.equal(await s.service.claim('worker-a'), undefined);
    const running = await s.enqueue(), lease = await s.service.claim('worker-a', 1000); assert.ok(lease);
    const cancelled = await s.service.cancel(s.owner, running.id); assert.equal(cancelled.state, 'running'); assert.equal(cancelled.cancelRequested, true);
    await assert.rejects(s.service.beginDispatch(lease), { code: 'conflict' });
    s.advance(1001); assert.equal(await s.service.claim('worker-a'), undefined);
    assert.equal((await s.service.job(s.owner, running.id)).state, 'cancelled');
    const dispatched = await s.enqueue(), next = await s.service.claim('worker-a', 1000); assert.ok(next); await s.service.beginDispatch(next);
    assert.equal((await s.service.cancel(s.owner, dispatched.id)).state, 'running');
    s.advance(1001); await s.service.claim('worker-a'); assert.equal((await s.service.job(s.owner, dispatched.id)).state, 'uncertain');
  });

  test(`${backend}: scheduling and expiry are bounded; expired jobs retain idempotent status`, async () => {
    const s = await setup(backend);
    const scheduled = new Date(Date.parse(s.at()) + 10_000).toISOString(), expires = new Date(Date.parse(s.at()) + 20_000).toISOString();
    const job = await s.enqueue('scheduled-job-001', s.owner, { runAfter: scheduled, expiresAt: expires });
    assert.equal(await s.service.claim('worker-a'), undefined);
    s.advance(20_001); assert.equal(await s.service.claim('worker-a'), undefined);
    assert.equal((await s.service.job(s.owner, job.id)).state, 'expired');
    assert.equal((await s.enqueue('scheduled-job-001', s.owner, { runAfter: scheduled, expiresAt: expires })).state, 'expired');
    await assert.rejects(s.enqueue(randomUUID(), s.owner, { expiresAt: new Date(Date.parse(s.at()) + 8 * 86_400_000).toISOString() }), { code: 'invalid_input' });
  });

  test(`${backend}: dispatch rereads persisted operation controls and changed member mappings`, async () => {
    const s = await setup(backend); await s.enqueue(); const lease = await s.service.claim('worker-a'); assert.ok(lease);
    await s.service.setControls(s.owner, { writePaused: false, tools: { ticket_note_add: false } }, 0);
    lease.job.operation = 'time_log_ticket';
    await assert.rejects(s.service.beginDispatch(lease), { code: 'forbidden' });
    await s.service.setControls(s.owner, { writePaused: false, tools: {} }, 1);
    await s.service.saveMember(s.owner, { objectId: s.owner.objectId, resourceId: 101, active: true, capabilities: [...s.owner.capabilities], companyIds: [10] }, 1);
    await assert.rejects(s.service.beginDispatch(lease), { code: 'conflict' });
    assert.equal((await s.store.getJob(lease.job.id, actorKey(s.owner)))?.dispatched, false);
  });

  test(`${backend}: completion requires an actual matching journal receipt and cannot reuse an unrelated success`, async () => {
    const s = await setup(backend), job = await s.enqueue(), lease = await s.service.claim('worker-a'); assert.ok(lease); await s.service.beginDispatch(lease);
    await assert.rejects(s.service.finish(lease, 'succeeded'), { code: 'precondition_failed' });
    await assert.rejects(s.service.finish(lease, 'failed'), { code: 'precondition_failed' });
    const unrelated = await s.operation(job.id, 'succeeded_verified', 'different-operation-key');
    await assert.rejects(s.service.finish(lease, 'succeeded', unrelated.id), { code: 'precondition_failed' });
    const receipt = await s.operation(job.id, 'succeeded_verified');
    const completed = await s.service.finish(lease, 'succeeded', receipt.id);
    assert.equal(completed.state, 'succeeded'); assert.equal(completed.operationId, receipt.id);
    await assert.rejects(s.service.finish(lease, 'succeeded', receipt.id), { code: 'conflict' });
    assert.ok(!JSON.stringify(completed).includes('leaseToken'));
  });

  test(`${backend}: terminal payload retention purges only new job ciphertext and appends a safe audit event`, async () => {
    const s = await setup(backend), terminal = await s.enqueue(); await s.service.cancel(s.owner, terminal.id);
    const activeJob = await s.enqueue();
    const receipt = await s.operation(randomUUID(), 'succeeded_verified');
    s.advance(31 * 86_400_000);
    assert.equal(await s.service.purgeExpiredPayloads(s.owner, 30), 1);
    assert.equal((await s.store.getJob(terminal.id, actorKey(s.owner)))?.encryptedPayload, undefined);
    assert.ok((await s.store.getJob(activeJob.id, actorKey(s.owner)))?.encryptedPayload);
    assert.equal((await s.journal.get(receipt.id, actorKey(s.owner)))?.state, 'succeeded_verified');
    assert.equal(await s.service.purgeExpiredPayloads(s.owner, 30), 0);
    const audit = await s.service.audit(s.owner);
    assert.equal(audit.items.filter(e => e.action === 'job.payload_purged').length, 1);
    assert.ok(!JSON.stringify(audit).includes('PRIVATE NOTE'));
  });

  test(`${backend}: actor-scoped operation and audit pagination omit encrypted intent and arbitrary results`, async () => {
    const s = await setup(backend); await s.operation(randomUUID(), 'succeeded_verified'); await s.operation(randomUUID(), 'failed');
    const first = await s.service.activity(s.owner, 1); assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
    const second = await s.service.activity(s.owner, 1, first.nextCursor); assert.equal(second.items.length, 1); assert.notEqual(first.items[0]!.id, second.items[0]!.id);
    assert.equal((await s.service.activity(s.peer)).items.length, 0); assert.ok(!JSON.stringify(first).includes('SECRET JOURNAL'));
    await s.enqueue(); await s.enqueue(); const audit = await s.service.audit(s.owner, 1); assert.ok(audit.nextCursor);
    assert.equal((await s.service.audit(s.owner, 1, audit.nextCursor)).items.length, 1);
  });
}

test('control-plane migration is repeatable, preserves journal rows and makes audit append-only', async () => {
  const s = await setup('postgres'), receipt = await s.operation(randomUUID(), 'succeeded_verified');
  await s.enqueue(); await db.exec(migration);
  assert.equal((await s.journal.get(receipt.id, actorKey(s.owner)))?.state, 'succeeded_verified');
  const event = (await s.service.audit(s.owner)).items[0]!;
  await assert.rejects(db.query('UPDATE control_audit SET target_id=$2 WHERE id=$1', [event.id, 'altered']));
  await assert.rejects(db.query('DELETE FROM control_audit WHERE id=$1', [event.id]));
  await assert.rejects(db.query('TRUNCATE control_audit'));
  assert.equal((await db.query('SELECT version FROM schema_migrations WHERE version=$1', ['003_control_plane'])).rows.length, 1);
});

test('SQL job identity and encrypted payload cannot be replaced, and terminal states cannot be replayed', async () => {
  const s = await setup('postgres'), job = await s.enqueue();
  await assert.rejects(db.query('UPDATE control_jobs SET request_key=$2 WHERE id=$1', [job.id, 'replaced-request-key']));
  await assert.rejects(db.query('UPDATE control_jobs SET encrypted_payload=NULL,payload_purged_at=now() WHERE id=$1', [job.id]));
  await s.service.cancel(s.owner, job.id);
  await assert.rejects(db.query("UPDATE control_jobs SET state='queued' WHERE id=$1", [job.id]));
  await assert.rejects(db.query('UPDATE control_jobs SET encrypted_payload=NULL,payload_purged_at=now(),fence=1 WHERE id=$1', [job.id]));
  assert.equal((await s.service.job(s.owner, job.id)).state, 'cancelled');
});

test('failed control-plane migration rolls back new tables and leaves existing journal untouched', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(foundation); await isolated.exec(intents);
    await assert.rejects(isolated.exec(migration.replace('COMMIT;', 'SELECT 1/0;\nCOMMIT;'))); await isolated.exec('ROLLBACK;');
    const tables = await isolated.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'control_%'"); assert.equal(tables.rows.length, 0);
    assert.equal((await isolated.query('SELECT version FROM schema_migrations')).rows.length, 2);
    await isolated.exec(migration); assert.equal(await new PostgresControlPlaneStore(isolated).health(), true);
  } finally { await isolated.close(); }
});

test('reconstructed SQL control services preserve leases, key-bound inputs and no-replay uncertainty', async () => {
  const s = await setup('postgres'), job = await s.enqueue('restart-job-key');
  const first = await s.service.claim('worker-before', 1000); assert.ok(first);
  const restarted = new ControlPlaneService(new PostgresControlPlaneStore(db), { ...s.options, cipher: new IntentCipher(Buffer.from(s.secret)) });
  assert.equal((await restarted.job(s.owner, job.id)).state, 'running');
  s.advance(1001); const reclaimed = await restarted.claim('worker-after', 1000); assert.ok(reclaimed);
  await assert.rejects(restarted.beginDispatch(first), { code: 'conflict' });
  const wrongKey = new ControlPlaneService(new PostgresControlPlaneStore(db), { ...s.options, cipher: new IntentCipher(randomBytes(32)) });
  await assert.rejects(wrongKey.beginDispatch(reclaimed), { code: 'conflict' });
  await restarted.beginDispatch(reclaimed); s.advance(1001);
  assert.equal(await restarted.claim('worker-final'), undefined); assert.equal((await restarted.job(s.owner, job.id)).state, 'uncertain');
  const raw = await db.query('SELECT * FROM control_jobs WHERE id=$1', [job.id]); assert.ok(!JSON.stringify(raw.rows).includes('PRIVATE NOTE'));
});

test('lost SQL job reservation and dispatch acknowledgements retain one durable intent and never authorize replay', async () => {
  const s = await setup('postgres'); let loseNext = true;
  const lossy: ControlSqlClient = { query: db.query.bind(db), async transaction(run) {
    const result = await db.transaction(run);
    if (loseNext) { loseNext = false; throw new Error('DRIVER-SECRET-CANARY: acknowledgement lost'); }
    return result;
  } };
  const service = new ControlPlaneService(new PostgresControlPlaneStore(lossy), s.options);
  const input = { operation: 'ticket_note_add', requestKey: 'lost-job-acknowledgement', payload: { note: 'PRIVATE NOTE BODY CANARY' } };
  await assert.rejects(service.enqueue(s.owner, input), error => {
    assert.equal((error as { code: string }).code, 'dependency_unavailable'); assert.ok(!String(error).includes('DRIVER-SECRET')); return true;
  });
  const recovered = await service.enqueue(s.owner, input);
  assert.equal((await service.jobs(s.owner)).items.length, 1);
  const lease = await service.claim('worker-a', 1000); assert.ok(lease); loseNext = true;
  await assert.rejects(service.beginDispatch(lease), { code: 'dependency_unavailable' });
  assert.equal((await service.job(s.owner, recovered.id)).dispatched, true);
  await assert.rejects(service.beginDispatch(lease), { code: 'conflict' });
  s.advance(1001); assert.equal(await service.claim('worker-b'), undefined);
  assert.equal((await service.enqueue(s.owner, input)).state, 'uncertain');
  const audit = await service.audit(s.owner);
  assert.equal(audit.items.filter(event => event.action === 'job.queued').length, 1);
  assert.equal(audit.items.filter(event => event.action === 'job.dispatched').length, 1);
});

test('administrative mapping change rolls back if its append-only audit cannot be persisted', async () => {
  const s = await setup('postgres');
  const unavailableAudit: ControlSqlClient = { query: db.query.bind(db), async transaction(run) {
    return db.transaction(tx => run({ async query(sql, params) {
      if (sql.startsWith('INSERT INTO control_audit')) throw new Error('AUDIT-SECRET-CANARY');
      return tx.query(sql, params);
    } }));
  } };
  const service = new ControlPlaneService(new PostgresControlPlaneStore(unavailableAudit), s.options);
  await assert.rejects(service.saveMember(s.owner, { objectId: s.peer.objectId, resourceId: 102, active: false, capabilities: [], companyIds: [] }, 1), { code: 'dependency_unavailable' });
  const preserved = await s.store.getMember(s.peer);
  assert.equal(preserved?.mappingVersion, 1); assert.equal(preserved?.active, true);
  assert.equal((await s.service.audit(s.owner)).items.length, 0);
});

for (const backend of ['memory','postgres'] as const) test(`${backend}: internal company scope persists without allowing zero resource IDs`, async () => {
 const s=await setup(backend);
 const input={objectId:s.peer.objectId,resourceId:102,active:false,capabilities:['operational.read'] as Principal['capabilities'],companyIds:[0,186]};
 await s.service.saveMember(s.owner,input,1);
 assert.deepEqual((await s.store.getMember(s.peer))?.companyIds,[0,186]);
 await assert.rejects(s.service.saveMember(s.owner,{...input,resourceId:0},2),{code:'invalid_input'});
 await assert.rejects(s.service.saveMember(s.owner,{...input,companyIds:[-1]},2),{code:'invalid_input'});
});
