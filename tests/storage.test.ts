import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AppError, type Principal } from '../packages/contracts/src/index.js';
import { CONTROL_CAPABILITIES } from '../packages/control-plane/src/index.js';
import {
  JOURNAL_WARNINGS, MemoryJournal, MemoryPrincipalStore, PostgresJournal,
  PostgresPrincipalStore, type SqlClient,
} from '../packages/storage/src/index.js';

const db = new PGlite();
const journal = new PostgresJournal(db);
const migration = await readFile(new URL('../packages/storage/migrations/001_foundation.sql', import.meta.url), 'utf8');
const workflowMigration = await readFile(new URL('../packages/storage/migrations/002_workflow_intents.sql', import.meta.url), 'utf8');
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const reservation = (requestKey: string, overrides: Record<string, unknown> = {}) => ({
  actorKey: 'tenant-a:employee-a', requestKey, payloadHash: hash('ticket:101:title-change'),
  operation: 'ticket_update', mappingVersion: 1, resourceId: 101, policyVersion: 'policy-v1', ...overrides,
});
const isError = (code: string) => (error: unknown): boolean => error instanceof AppError && error.code === code;

before(async () => { await db.exec(migration); await db.exec(workflowMigration); });
after(async () => { await db.close(); });

test('persisted principals accept every console capability, including Glue grants, but reject unknown grants', async () => {
  const row = {tenant_id:'tenant-a', object_id:'employee-a', resource_id:101, mapping_version:1,
    active:true, policy_version:'policy-v1', resource_verified_at:new Date(),
    policy:{capabilities:[...CONTROL_CAPABILITIES] as string[], companyIds:[1]}};
  const store = new PostgresPrincipalStore({query:async()=>({rows:[row]})});
  assert.deepEqual((await store.get('tenant-a','employee-a'))?.capabilities, [...CONTROL_CAPABILITIES]);
  row.policy.capabilities.push('documentation.unreviewed');
  await assert.rejects(store.get('tenant-a','employee-a'), isError('identity_mapping_invalid'));
});

test('foundation migration runs twice without losing an existing operation', async () => {
  const first = await journal.reserve(reservation('migration-survival'));
  await db.exec(migration);
  await db.exec(workflowMigration);
  assert.equal((await journal.get(first.record.id, first.record.actorKey))?.id, first.record.id);
  const versions = await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM schema_migrations');
  assert.equal(versions.rows[0]?.count, 2);
});

test('interrupted foundation migration rolls back all schema changes', async () => {
  const isolated = new PGlite();
  try {
    const brokenMigration = migration.replace('COMMIT;', 'SELECT 1 / 0;\nCOMMIT;');
    await assert.rejects(isolated.exec(brokenMigration));
    await isolated.exec('ROLLBACK;');
    const tables = await isolated.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    assert.deepEqual(tables.rows, []);
    await isolated.exec(migration);
    const versions = await isolated.query<{ count: number }>('SELECT count(*)::integer AS count FROM schema_migrations');
    assert.equal(versions.rows[0]?.count, 1);
  } finally {
    await isolated.close();
  }
});

test('twenty simultaneous reservations share one durable actor/request intent', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => journal.reserve(reservation('same-intent'))));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.record.id)).size, 1);
  const rows = await db.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM operation_journal WHERE request_key = $1', ['same-intent'],
  );
  assert.equal(rows.rows[0]?.count, 1);
});

test('only one concurrent compare-and-set claims dispatch and terminal success cannot redispatch', async () => {
  const { record } = await journal.reserve(reservation('claim-once'));
  const claims = await Promise.allSettled(Array.from({ length: 20 }, () =>
    journal.transition(record.id, 'ready', 'dispatching')));
  assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of claims) {
    if (result.status === 'rejected') assert.ok(isError('conflict')(result.reason));
  }
  await journal.transition(record.id, 'dispatching', 'succeeded_verified');
  await assert.rejects(journal.transition(record.id, 'ready', 'dispatching'), isError('conflict'));
  await assert.rejects(journal.transition(record.id, 'succeeded_verified', 'dispatching'), isError('conflict'));
  await assert.rejects(db.query('UPDATE operation_journal SET state = $2 WHERE id = $1', [record.id, 'ready']));
});

test('same key with changed payload, operation or mapping conflicts without rewriting intent', async () => {
  const original = await journal.reserve(reservation('intent-binding'));
  for (const override of [
    { payloadHash: hash('different ticket or title') }, { operation: 'ticket_delete' }, { mappingVersion: 2 }, { resourceId: 102 }, { policyVersion: 'policy-v2' },
  ]) {
    await assert.rejects(journal.reserve(reservation('intent-binding', override)), isError('conflict'));
  }
  const loaded = await journal.get(original.record.id, original.record.actorKey);
  assert.deepEqual(loaded, original.record);
  await assert.rejects(db.query(
    'UPDATE operation_journal SET state = $2, payload_hash = $3 WHERE id = $1',
    [original.record.id, 'dispatching', hash('substitution')],
  ));
});

test('same request key in separate tenants and actors stays separate and status is actor scoped', async () => {
  const actors = ['tenant-a:employee-b', 'tenant-b:employee-b', 'tenant-a:employee-c'];
  const results = await Promise.all(actors.map((actorKey) => journal.reserve(reservation('scoped-key', { actorKey }))));
  assert.equal(new Set(results.map((result) => result.record.id)).size, actors.length);
  for (const { record } of results) {
    for (const actor of actors) {
      const loaded = await journal.get(record.id, actor);
      assert.equal(loaded?.id, actor === record.actorKey ? record.id : undefined);
    }
  }
});

test('unknown or accepted-unverified outcomes cannot become another dispatch claim', async () => {
  const { record } = await journal.reserve(reservation('uncertain-no-repeat'));
  await journal.transition(record.id, 'ready', 'dispatching');
  await journal.transition(record.id, 'dispatching', 'accepted_unverified');
  await assert.rejects(journal.transition(record.id, 'accepted_unverified', 'dispatching'), isError('conflict'));
  await journal.transition(record.id, 'accepted_unverified', 'unknown_outcome');
  await assert.rejects(journal.transition(record.id, 'unknown_outcome', 'ready'), isError('conflict'));
  const reconciled = await journal.transition(record.id, 'unknown_outcome', 'succeeded_verified', {
    ticket_id: 101, verification: { performed: true, matched_fields: ['title'] },
  });
  assert.equal(reconciled.state, 'succeeded_verified');
});

test('journal receipts persist only safe identifiers, verification and fixed warnings', async () => {
  const canary = 'CUSTOMER-NOTE-AND-SECRET-CANARY';
  const { record } = await journal.reserve(reservation('redacted-result', {
    result: { title: canary, payload: { title: canary }, warnings: [canary] },
  }));
  await journal.transition(record.id, 'ready', 'dispatching');
  const saved = await journal.transition(record.id, 'dispatching', 'succeeded_verified', {
    ticket_id: 101, title: canary, note: canary, error_code: canary,
    matched_fields: ['title', canary],
    verification: { performed: true, matched_fields: ['title', canary], text: canary },
    warnings: [canary, JOURNAL_WARNINGS.concurrency],
  });
  const raw = await db.query('SELECT result FROM operation_journal WHERE id = $1', [record.id]);
  assert.ok(!JSON.stringify(raw.rows).includes(canary));
  assert.deepEqual(saved.result, {
    ticket_id: 101, matched_fields: ['title'],
    verification: { performed: true, matched_fields: ['title'] },
    warnings: [JOURNAL_WARNINGS.concurrency],
  });
});

test('database failures are sanitized and do not imply a safe retry or successful claim', async () => {
  const failing: SqlClient = { async query() { throw new Error('password=SECRET-CANARY from driver'); } };
  const unavailable = new PostgresJournal(failing);
  const assertUnavailable = (error: unknown): boolean => {
    assert.ok(isError('dependency_unavailable')(error));
    assert.ok(error instanceof AppError);
    assert.equal(error.retryable, false);
    assert.ok(!error.message.includes('SECRET-CANARY'));
    return true;
  };
  await assert.rejects(unavailable.reserve(reservation('database-unavailable')), assertUnavailable);
  await assert.rejects(unavailable.get('unused', 'tenant-a:employee-a'), assertUnavailable);
  await assert.rejects(unavailable.transition('unused', 'ready', 'dispatching'), assertUnavailable);
});

test('lost database acknowledgement preserves a committed claim and prevents duplicate dispatch', async () => {
  const { record } = await journal.reserve(reservation('lost-claim-response'));
  const lostResponse: SqlClient = {
    async query(sql, params) {
      const result = await db.query(sql, params);
      if (sql.startsWith('UPDATE operation_journal')) throw new Error('simulated response loss');
      return result;
    },
  };
  await assert.rejects(new PostgresJournal(lostResponse).transition(record.id, 'ready', 'dispatching'), isError('dependency_unavailable'));
  assert.equal((await journal.get(record.id, record.actorKey))?.state, 'dispatching');
  await assert.rejects(journal.transition(record.id, 'ready', 'dispatching'), isError('conflict'));
  const duplicate = await journal.reserve(reservation('lost-claim-response'));
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.state, 'dispatching');
});

test('lost reservation acknowledgement can be recovered without inserting a second record', async () => {
  const lostResponse: SqlClient = {
    async query(sql, params) {
      const result = await db.query(sql, params);
      if (sql.startsWith('INSERT INTO operation_journal')) throw new Error('simulated insert response loss');
      return result;
    },
  };
  await assert.rejects(new PostgresJournal(lostResponse).reserve(reservation('lost-reserve-response')), isError('dependency_unavailable'));
  const recovered = await journal.reserve(reservation('lost-reserve-response'));
  assert.equal(recovered.created, false);
  assert.equal(recovered.record.state, 'ready');
});

test('principal mappings use both tenant and object ID and reflect persisted revocation', async () => {
  const store = new PostgresPrincipalStore(db);
  const now = new Date().toISOString();
  for (const [tenant, resource] of [['tenant-a', 10], ['tenant-b', 20]] as const) {
    await db.query(
      `INSERT INTO identity_mappings
       (tenant_id, object_id, resource_id, mapping_version, policy_version, active, resource_verified_at, policy)
       VALUES ($1, $2, $3, 1, 'policy-1', true, $4, $5::jsonb)`,
      [tenant, 'same-object', resource, now, JSON.stringify({ capabilities: ['operational.read'], companyIds: [101] })],
    );
  }
  assert.equal((await store.get('tenant-a', 'same-object'))?.resourceId, 10);
  assert.equal((await store.get('tenant-b', 'same-object'))?.resourceId, 20);
  assert.equal(await store.get('tenant-c', 'same-object'), undefined);
  await db.query(
    `UPDATE identity_mappings SET active = false, mapping_version = 2,
      policy_version = 'policy-2', policy = $3::jsonb WHERE tenant_id = $1 AND object_id = $2`,
    ['tenant-a', 'same-object', JSON.stringify({ capabilities: [], companyIds: [] })],
  );
  const revoked = await store.get('tenant-a', 'same-object');
  assert.equal(revoked?.active, false);
  assert.equal(revoked?.mappingVersion, 2);
  assert.deepEqual(revoked?.capabilities, []);
  assert.equal((await store.get('tenant-b', 'same-object'))?.active, true);
  await db.query('UPDATE identity_mappings SET policy = $3::jsonb WHERE tenant_id = $1 AND object_id = $2',
    ['tenant-a', 'same-object', JSON.stringify({ capabilities: ['forged-admin'], companyIds: [101] })]);
  await assert.rejects(store.get('tenant-a', 'same-object'), isError('identity_mapping_invalid'));
});

test('principal database outage fails with no integration-identity fallback', async () => {
  const store = new PostgresPrincipalStore({ async query() { throw new Error('secret-driver-detail'); } });
  await assert.rejects(store.get('tenant-a', 'employee-a'), (error: unknown) => {
    assert.ok(isError('identity_validation_unavailable')(error));
    assert.ok(error instanceof Error && !error.message.includes('secret-driver-detail'));
    return true;
  });
});

test('explicit memory fixtures preserve CAS, scope and copies of mutable records', async () => {
  const memory = new MemoryJournal();
  const results = await Promise.all(Array.from({ length: 20 }, () => memory.reserve(reservation('fixture-only'))));
  assert.equal(results.filter((result) => result.created).length, 1);
  const first = results[0]!.record;
  first.state = 'failed';
  assert.equal((await memory.get(first.id, first.actorKey))?.state, 'ready');
  const claims = await Promise.allSettled(Array.from({ length: 20 }, () => memory.transition(first.id, 'ready', 'dispatching')));
  assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await memory.get(first.id, 'tenant-b:employee-a'), undefined);
  const principal: Principal = {
    tenantId: 'tenant-a', objectId: 'employee-a', resourceId: 1, mappingVersion: 1,
    policyVersion: 'v1', active: true, resourceVerifiedAt: new Date().toISOString(),
    capabilities: ['operational.read'], companyIds: [101],
  };
  const store = new MemoryPrincipalStore([principal]);
  principal.companyIds.push(999);
  const retrieved = (await store.get(principal.tenantId, principal.objectId))!;
  assert.deepEqual(retrieved.companyIds, [101]);
  retrieved.companyIds.push(555);
  assert.deepEqual((await store.get(principal.tenantId, principal.objectId))?.companyIds, [101]);
  store.delete(principal.tenantId, principal.objectId);
  assert.equal(await store.get(principal.tenantId, principal.objectId), undefined);
});
