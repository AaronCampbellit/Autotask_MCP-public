import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AppError, type OperationState } from '../packages/contracts/src/index.js';
import { IntentCipher, MemoryJournal, PostgresJournal, redactJournalResult, workflowRoots } from '../packages/storage/src/index.js';
import { MAX_INTENT_BYTES } from '../packages/storage/src/intent-cipher.js';

const foundation = await readFile(new URL('../packages/storage/migrations/001_foundation.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../packages/storage/migrations/002_workflow_intents.sql', import.meta.url), 'utf8');
const controlPlane = await readFile(new URL('../packages/storage/migrations/003_control_plane.sql', import.meta.url), 'utf8');
const fixedWorkflows = await readFile(new URL('../packages/storage/migrations/004_fixed_workflows.sql', import.meta.url), 'utf8');
const db = new PGlite();
const postgres = new PostgresJournal(db);
const cipher = new IntentCipher(randomBytes(32));
const binding = 'tenant-a:employee-a:ticket-101:payload-sha256:mapping-1';
const expires = '2026-09-11T12:00:00.000Z';
const isError = (code: string) => (error: unknown): boolean => error instanceof AppError && error.code === code;
const reservation = (requestKey: string, overrides: Record<string, unknown> = {}) => ({
  actorKey: 'tenant-a:employee-a', requestKey,
  payloadHash: createHash('sha256').update('document ticket 101 work').digest('hex'),
  operation: 'ticket_document_work', mappingVersion: 1, resourceId: 101, policyVersion: 'policy-v1',
  encryptedIntent: cipher.seal({ note: 'private body', time: 'private summary' }, binding),
  intentExpiresAt: expires, ...overrides,
});

before(async () => { await db.exec(foundation); await db.exec(migration); await db.exec(controlPlane); await db.exec(fixedWorkflows); });
after(async () => { await db.close(); });

test('workflow migration preserves original foundation rows and is repeatable', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(foundation);
    const id = randomUUID();
    await isolated.query(`INSERT INTO operation_journal
      (id, actor_key, request_key, payload_hash, operation, mapping_version, resource_id, policy_version)
      VALUES ($1, 'tenant-a:employee-a', 'legacy-operation', $2, 'ticket_update', 1, 101, 'v1')`,
    [id, 'a'.repeat(64)]);
    await isolated.exec(migration);
    await isolated.exec(migration);
    const old = await new PostgresJournal(isolated).get(id, 'tenant-a:employee-a');
    assert.equal(old?.state, 'ready');
    assert.equal(old?.encryptedIntent, undefined);
    const versions = await isolated.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(versions.rows.map((row) => row.version), ['001_foundation', '002_workflow_intents']);
  } finally { await isolated.close(); }
});

test('interrupted workflow migration rolls back columns and transition changes', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(foundation);
    await assert.rejects(isolated.exec(migration.replace('COMMIT;', 'SELECT 1 / 0;\nCOMMIT;')));
    await isolated.exec('ROLLBACK;');
    const columns = await isolated.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'operation_journal' AND column_name = 'encrypted_intent'",
    );
    assert.equal(columns.rows.length, 0);
    const versions = await isolated.query<{ version: string }>('SELECT version FROM schema_migrations');
    assert.deepEqual(versions.rows, [{ version: '001_foundation' }]);
    await isolated.exec(migration);
    assert.equal((await new PostgresJournal(isolated).reserve(reservation('after-rollback'))).created, true);
  } finally { await isolated.close(); }
});

test('AES-GCM intent encryption is randomized, bound and recoverable after restart with the same key', () => {
  const secret = randomBytes(32);
  const firstCipher = new IntentCipher(secret);
  const restartedCipher = new IntentCipher(Buffer.from(secret));
  const value = { note: 'BODY-CANARY-42', nested: { time: 'SUMMARY-CANARY-42' }, hours: 0.5 };
  const first = firstCipher.seal(value, binding);
  const second = firstCipher.seal(value, binding);
  assert.notEqual(first, second);
  assert.ok(!first.includes('BODY-CANARY-42'));
  assert.ok(!first.includes('SUMMARY-CANARY-42'));
  assert.deepEqual(restartedCipher.open(first, binding), value);
  secret.fill(0);
  assert.deepEqual(firstCipher.open(second, binding), value);
  assert.equal(JSON.stringify(firstCipher), '{}');
});

test('wrong identity binding, key, version and tampered cipher components fail closed without leaking content', () => {
  const encrypted = cipher.seal({ note: 'SECRET-INPUT-CANARY' }, binding);
  const parts = encrypted.split('.');
  const mutated = parts.map((part, index) => index === 0 ? 'v2' : `${part[0] === 'A' ? 'B' : 'A'}${part.slice(1)}`);
  const cases = [
    () => cipher.open(encrypted, `${binding}:other`),
    () => new IntentCipher(randomBytes(32)).open(encrypted, binding),
    ...mutated.map((part, index) => () => cipher.open(parts.map((original, at) => at === index ? part : original).join('.'), binding)),
    () => cipher.open(`${encrypted}=`, binding),
    () => cipher.open(`${encrypted}.extra`, binding),
    () => cipher.open('SECRET-INPUT-CANARY', binding),
  ];
  for (const run of cases) assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError && error.code === 'conflict' && !error.retryable);
    assert.ok(!error.message.includes('SECRET-INPUT-CANARY'));
    return true;
  });
});

test('intent cipher rejects invalid key sizes, oversized input, non-JSON input and invalid binding', () => {
  for (const size of [0, 16, 31, 33, 64]) assert.throws(() => new IntentCipher(randomBytes(size)), isError('dependency_unavailable'));
  assert.throws(() => cipher.seal('x'.repeat(MAX_INTENT_BYTES), binding), isError('invalid_input'));
  assert.throws(() => cipher.seal(undefined, binding), isError('invalid_input'));
  assert.throws(() => cipher.seal(1n, binding), isError('invalid_input'));
  assert.throws(() => cipher.seal({}, ''), isError('invalid_input'));
  assert.throws(() => cipher.seal({}, 'x'.repeat(2049)), isError('invalid_input'));
  assert.throws(() => cipher.open('x'.repeat(MAX_INTENT_BYTES * 2), binding), isError('conflict'));
  const value = 'x'.repeat(MAX_INTENT_BYTES - 2);
  assert.equal(cipher.open(cipher.seal(value, binding), binding), value);
});

for (const [name, journal] of [['postgres', postgres], ['memory', new MemoryJournal()]] as const) {
  test(`${name}: request lookup is actor scoped and returns a copy of the saved intent`, async () => {
    const input = reservation(`${name}-request-lookup`);
    const { record } = await journal.reserve(input);
    const loaded = await journal.find(input.actorKey, input.requestKey);
    assert.deepEqual(loaded, record);
    assert.equal(await journal.find('tenant-b:employee-a', input.requestKey), undefined);
    assert.equal(await journal.find('tenant-a:employee-b', input.requestKey), undefined);
    assert.equal(await journal.find(input.actorKey, `${input.requestKey}-different`), undefined);
    loaded!.state = 'failed';
    assert.equal((await journal.find(input.actorKey, input.requestKey))?.state, 'ready');
  });

  test(`${name}: duplicate intent reservations retain original ciphertext and expiry`, async () => {
    const first = await journal.reserve(reservation(`${name}-immutable-intent`));
    const duplicateInput = reservation(`${name}-immutable-intent`, { intentExpiresAt: '2026-09-12T12:00:00.000Z' });
    assert.notEqual(duplicateInput.encryptedIntent, first.record.encryptedIntent);
    const duplicate = await journal.reserve(duplicateInput);
    assert.equal(duplicate.created, false);
    assert.deepEqual(duplicate.record, first.record);
    assert.deepEqual(cipher.open(duplicate.record.encryptedIntent!, binding), { note: 'private body', time: 'private summary' });
    assert.equal((await journal.get(first.record.id, first.record.actorKey))?.intentExpiresAt, expires);
  });

  test(`${name}: intent reservation requires paired bounded ciphertext and valid expiry on a workflow root`, async () => {
    for (const override of [
      { encryptedIntent: undefined }, { intentExpiresAt: undefined }, { encryptedIntent: 'plain body' },
      { intentExpiresAt: 'infinity' }, { intentExpiresAt: '2026-09-10' },
      { intentExpiresAt: '2026-02-30T12:00:00Z' }, { operation: 'ticket_note_add' },
    ]) await assert.rejects(journal.reserve(reservation(`${name}-invalid-${randomUUID()}`, override)), isError('invalid_input'));
  });

  test(`${name}: partial roots preserve child receipts and allow a single concurrent resume claim`, async () => {
    const first = await journal.reserve(reservation(`${name}-partial-root`));
    const steps = {
      note: { operation_id: randomUUID(), state: 'succeeded_verified', attempt: 1, native_id: 5001 },
      time: { operation_id: randomUUID(), state: 'failed', attempt: 1 },
    };
    await journal.transition(first.record.id, 'ready', 'dispatching');
    const checkpoint = await journal.transition(first.record.id, 'dispatching', 'dispatching', { ticket_id: 101, steps });
    assert.deepEqual(checkpoint.result, { ticket_id: 101, steps });
    const partial = await journal.transition(first.record.id, 'dispatching', 'partial', {
      ticket_id: 101, steps, body: 'MUST-NOT-PERSIST',
    });
    assert.deepEqual(partial.result, { ticket_id: 101, steps });
    const claims = await Promise.allSettled(Array.from({ length: 10 }, () => journal.transition(first.record.id, 'partial', 'dispatching')));
    assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
    for (const claim of claims) if (claim.status === 'rejected') assert.ok(isError('conflict')(claim.reason));
    await journal.transition(first.record.id, 'dispatching', 'partial', { ticket_id: 101, steps });
    await journal.transition(first.record.id, 'partial', 'failed');
    await assert.rejects(journal.transition(first.record.id, 'failed', 'dispatching'), isError('conflict'));
  });

  test(`${name}: single writes cannot enter partial and uncertainty never grants direct dispatch`, async () => {
    const single = await journal.reserve(reservation(`${name}-single`, {
      operation: 'ticket_note_add', encryptedIntent: undefined, intentExpiresAt: undefined,
    }));
    await journal.transition(single.record.id, 'ready', 'dispatching');
    await assert.rejects(journal.transition(single.record.id, 'dispatching', 'dispatching'), isError('conflict'));
    await assert.rejects(journal.transition(single.record.id, 'dispatching', 'partial'), isError('conflict'));
    await journal.transition(single.record.id, 'dispatching', 'failed');
    await assert.rejects(journal.transition(single.record.id, 'failed', 'dispatching'), isError('conflict'));
    await assert.rejects(journal.transition(single.record.id, 'failed', 'ready'), isError('conflict'));
    for (const state of ['accepted_unverified', 'unknown_outcome'] satisfies OperationState[]) {
      const root = await journal.reserve(reservation(`${name}-${state}-root`));
      await journal.transition(root.record.id, 'ready', 'dispatching');
      await journal.transition(root.record.id, 'dispatching', state);
      for (const next of ['ready', 'dispatching'] satisfies OperationState[]) {
        await assert.rejects(journal.transition(root.record.id, state, next), isError('conflict'));
      }
      // Only the workflow engine's recorded-ID reconciliation can request this
      // root transition. Storage does not itself authorize another native write.
      assert.equal((await journal.transition(root.record.id,state,'partial')).state,'partial');
    }
  });

  test(`${name}: all fixed roots support reconciliation checkpoints while ordinary child writes remain conservative`, async () => {
    for(const operation of workflowRoots)for(const state of ['unknown_outcome','accepted_unverified'] satisfies OperationState[]){
      const root=await journal.reserve(reservation(`${name}-${operation}-${state}`,{operation}));
      await journal.transition(root.record.id,'ready','dispatching');await journal.transition(root.record.id,'dispatching',state);
      for(const next of ['ready','dispatching'] satisfies OperationState[])await assert.rejects(journal.transition(root.record.id,state,next),isError('conflict'));
      const partial=await journal.transition(root.record.id,state,'partial',{ticket_id:101,steps:{note:{operation_id:randomUUID(),state:'succeeded_verified',attempt:1,native_id:1234},update:{operation_id:randomUUID(),state:'ready',attempt:1}}});
      assert.equal(partial.state,'partial');assert.equal((partial.result!.steps as any).note.native_id,1234);
    }
    for(const operation of ['ticket_note_add','time_log_ticket','ticket_update_fields','service_call_create_call','unreviewed_workflow'])for(const state of ['unknown_outcome','accepted_unverified'] satisfies OperationState[]){
      const child=await journal.reserve(reservation(`${name}-${operation}-${state}`,{operation,encryptedIntent:undefined,intentExpiresAt:undefined}));
      await journal.transition(child.record.id,'ready','dispatching');await journal.transition(child.record.id,'dispatching',state);
      for(const next of ['ready','dispatching','partial'] satisfies OperationState[])await assert.rejects(journal.transition(child.record.id,state,next),isError('conflict'));
      assert.equal((await journal.get(child.record.id,child.record.actorKey))!.state,state);
    }
  });
}

test('fourth migration is repeatable and its SQL guard permits only fixed-root reconciliation, never direct replay',async()=>{
  await db.exec(fixedWorkflows);
  const versions=await db.query<{version:string}>('SELECT version FROM schema_migrations ORDER BY version');assert.deepEqual(versions.rows.map(r=>r.version),['001_foundation','002_workflow_intents','003_control_plane','004_fixed_workflows']);
  for(const operation of workflowRoots){const root=await postgres.reserve(reservation(`sql-direct-${operation}`,{operation}));await postgres.transition(root.record.id,'ready','dispatching');await postgres.transition(root.record.id,'dispatching','unknown_outcome');
    for(const state of ['ready','dispatching'])await assert.rejects(db.query('UPDATE operation_journal SET state=$2 WHERE id=$1',[root.record.id,state]));
    await assert.rejects(db.query("UPDATE operation_journal SET operation='ticket_update',state='partial' WHERE id=$1",[root.record.id]));
    await db.query("UPDATE operation_journal SET state='partial' WHERE id=$1",[root.record.id]);assert.equal((await postgres.get(root.record.id,root.record.actorKey))!.state,'partial');
  }
  for(const operation of ['ticket_note_add','ticket_update_fields','service_call_create_resource']){const child=await postgres.reserve(reservation(`sql-child-${operation}`,{operation,encryptedIntent:undefined,intentExpiresAt:undefined}));await postgres.transition(child.record.id,'ready','dispatching');await postgres.transition(child.record.id,'dispatching','unknown_outcome');
    for(const state of ['ready','dispatching','partial'])await assert.rejects(db.query('UPDATE operation_journal SET state=$2 WHERE id=$1',[child.record.id,state]));
    await postgres.transition(child.record.id,'unknown_outcome','failed');await assert.rejects(db.query("UPDATE operation_journal SET state='ready' WHERE id=$1",[child.record.id]));
  }
});

test('database independently enforces immutable encrypted intent, paired columns, root partial and no uncertain replay', async () => {
  const { record } = await postgres.reserve(reservation('db-immutable'));
  for (const [column, value] of [
    ['encrypted_intent', cipher.seal({ replacement: true }, binding)],
    ['intent_expires_at', '2027-01-01T00:00:00.000Z'],
  ]) await assert.rejects(db.query(`UPDATE operation_journal SET state = 'dispatching', ${column} = $2 WHERE id = $1`, [record.id, value]));
  await assert.rejects(db.query(`INSERT INTO operation_journal
    (id, actor_key, request_key, payload_hash, operation, mapping_version, resource_id, policy_version, encrypted_intent)
    VALUES ($1, 'tenant-a:employee-a', 'db-half-intent', $2, 'ticket_document_work', 1, 101, 'v1', $3)`,
  [randomUUID(), 'a'.repeat(64), record.encryptedIntent]));
  const single = await postgres.reserve(reservation('db-no-partial-child', {
    operation: 'time_entry_create', encryptedIntent: undefined, intentExpiresAt: undefined,
  }));
  await postgres.transition(single.record.id, 'ready', 'dispatching');
  await assert.rejects(db.query("UPDATE operation_journal SET state = 'partial' WHERE id = $1", [single.record.id]));
  await postgres.transition(single.record.id, 'dispatching', 'unknown_outcome');
  await assert.rejects(db.query("UPDATE operation_journal SET state = 'dispatching' WHERE id = $1", [single.record.id]));
});

test('workflow result redaction retains reviewed identifiers, bounded accounting fields and named child receipts only', async () => {
  const canary = 'SECRET BODY with spaces and\nraw payload';
  const noteId = randomUUID();
  const timeId = randomUUID();
  const receipt = {
    ticket_id: 101, note_id: 5001, time_entry_id: 5002, recorded_resource_id: 9,
    audience: 'internal', hours_worked: 0.5, work_date: '2026-09-10', timezone: 'America/Chicago', metadata_version: 'fixture-work-v1',
    title: canary, note: canary, summary: canary, encryptedIntent: canary,
    matched_fields: ['description', 'publish', 'hoursWorked', 'summaryNotes', 'creatorResourceID', 'impersonatorCreatorResourceID', canary, 'publish'],
    verification: { performed: true, matched_fields: ['resourceID', 'dateWorked', canary], body: canary },
    steps: {
      note: { operation_id: noteId, state: 'succeeded_verified', attempt: 1, native_id: 5001, body: canary },
      time: { operation_id: timeId, state: 'failed', attempt: 2, native_id: -1, body: canary },
      [canary]: { operation_id: timeId, state: 'failed', attempt: 1 },
    },
    defaults: [
      { field: 'note_type', source: 'reviewed_default', rule_version: 'reviewed-v1', id: 1, label: canary },
      { field: 'role', source: 'explicit', rule_version: 'reviewed-v1', id: 2, label: canary },
      { field: 'work_type', source: 'reviewed_default', rule_version: 'reviewed-v1', id: 3, label: canary },
      { field: canary, source: 'explicit', rule_version: 'reviewed-v1', id: 4 },
    ],
  };
  const expected = {
    ticket_id: 101, note_id: 5001, time_entry_id: 5002, recorded_resource_id: 9,
    audience: 'internal', hours_worked: 0.5, work_date: '2026-09-10', timezone: 'America/Chicago', metadata_version: 'fixture-work-v1',
    matched_fields: ['description', 'publish', 'hoursWorked', 'summaryNotes', 'creatorResourceID', 'impersonatorCreatorResourceID'],
    verification: { performed: true, matched_fields: ['resourceID', 'dateWorked'] },
    steps: {
      note: { operation_id: noteId, state: 'succeeded_verified', attempt: 1, native_id: 5001 },
      time: { operation_id: timeId, state: 'failed', attempt: 2 },
    },
    defaults: [
      { field: 'note_type', source: 'reviewed_default', rule_version: 'reviewed-v1', id: 1 },
      { field: 'role', source: 'explicit', rule_version: 'reviewed-v1', id: 2 },
      { field: 'work_type', source: 'reviewed_default', rule_version: 'reviewed-v1', id: 3 },
    ],
  };
  assert.deepEqual(redactJournalResult(receipt), expected);
  const { record } = await postgres.reserve(reservation('redacted-workflow-receipt', { result: receipt }));
  assert.deepEqual(record.result, expected);
  const raw = await db.query('SELECT result FROM operation_journal WHERE id = $1', [record.id]);
  assert.ok(!JSON.stringify(raw.rows).includes('SECRET BODY'));
});

test('redactor drops forged child states, bad identifiers, oversized versions, invalid timezones and dates', () => {
  for (const receipt of [
    { metadata_version: 'secret value with spaces', timezone: 'SECRET-CANARY', work_date: '2026-02-30', hours_worked: 24.01 },
    { metadata_version: 'x'.repeat(101), timezone: '../secret', work_date: '2026-9-10', hours_worked: Number.NaN },
    { note_id: -1, time_entry_id: 1.5, recorded_resource_id: 0, audience: 'secret', hours_worked: 0 },
  ]) assert.deepEqual(redactJournalResult(receipt), {});
  for (const override of [
    { operation_id: 'not-a-uuid' }, { state: 'partial' }, { state: 'dispatch-again' }, { attempt: 0 }, { attempt: 11 }, { attempt: 1.5 },
  ]) assert.deepEqual(redactJournalResult({ steps: { note: { operation_id: randomUUID(), state: 'failed', attempt: 1, ...override } } }), { steps: {} });
  assert.deepEqual(redactJournalResult({ defaults: [{ field: 'role', source: 'unreviewed', rule_version: 'v1', id: 1 }] }), { defaults: [] });
});
