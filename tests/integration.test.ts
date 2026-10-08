import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { AppError, actorKey } from '../packages/contracts/src/index.js';
import { IntentCipher, PostgresJournal, PostgresPrincipalStore } from '../packages/storage/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';

test('ticket workflow uses SQL identity and journal; reconstructed services retain uncertain intent and prevent replay', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile('packages/storage/migrations/001_foundation.sql', 'utf8'));
    await db.exec(await readFile('packages/storage/migrations/002_workflow_intents.sql', 'utf8'));
    const principal = fixturePrincipals()[0]!;
    await db.query(`INSERT INTO identity_mappings (tenant_id, object_id, resource_id, mapping_version, policy_version, active, resource_verified_at, policy)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [principal.tenantId, principal.objectId, principal.resourceId, principal.mappingVersion, principal.policyVersion, true, principal.resourceVerifiedAt, JSON.stringify({ capabilities: principal.capabilities, companyIds: principal.companyIds })]);
    const store = new PostgresPrincipalStore(db), journal = new PostgresJournal(db);
    const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store));
    const workflow = new TicketWorkflows(adapter, store, journal);
    const input = { ticket: { kind: 'id', id: 1001 }, request_key: 'persisted-unknown-update', changes: { title: 'Observed saved title' }, expected: { title: 'Example printer offline' } };
    const originalPatch = adapter.patchTicket.bind(adapter);
    adapter.patchTicket = async (...args) => { await originalPatch(...args); throw new AppError('unknown_outcome', 'Response lost.'); };
    const first = await workflow.update(principal, input);
    assert.equal(first.status, 'unknown_outcome');
    const reconstructed = new TicketWorkflows(adapter, new PostgresPrincipalStore(db), new PostgresJournal(db));
    const duplicate = await reconstructed.update(principal, input);
    assert.equal(duplicate.status, 'unknown_outcome');
    assert.equal(duplicate.operation_id, first.operation_id);
    assert.equal(adapter.calls.filter(call => call.kind === 'patch').length, 1);
    const rows = await db.query('SELECT payload_hash, result, state FROM operation_journal');
    assert.equal(rows.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(rows.rows), /Observed saved title|Example printer offline/);
    await db.query('UPDATE identity_mappings SET active = false WHERE tenant_id = $1 AND object_id = $2', [principal.tenantId, principal.objectId]);
    await assert.rejects(reconstructed.search(principal, {}), { code: 'identity_mapping_invalid' });
  } finally { await db.close(); }
});

test('SQL document work resumes after service reconstruction using encrypted intent without repeating its verified note', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile('packages/storage/migrations/001_foundation.sql', 'utf8'));
    await db.exec(await readFile('packages/storage/migrations/002_workflow_intents.sql', 'utf8'));
    const principal = fixturePrincipals()[0]!;
    const otherActor = { ...principal, objectId: '00000000-0000-4000-8000-000000000003', resourceId: 103 };
    for (const actor of [principal, otherActor]) {
      await db.query(`INSERT INTO identity_mappings
        (tenant_id, object_id, resource_id, mapping_version, policy_version, active, resource_verified_at, policy)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.tenantId, actor.objectId, actor.resourceId,
        actor.mappingVersion, actor.policyVersion, true, actor.resourceVerifiedAt,
        JSON.stringify({ capabilities: actor.capabilities, companyIds: actor.companyIds })]);
    }
    const secret = randomBytes(32);
    const store = new PostgresPrincipalStore(db), journal = new PostgresJournal(db);
    const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store));
    adapter.createTicketTime = async () => {
      throw new AppError('invalid_input', 'The tenant definitively rejected the first time entry.');
    };
    const writes = new TicketWriteWorkflows(new TicketWorkflows(adapter, store, journal), new IntentCipher(secret));
    const input = {
      ticket: { kind: 'id', id: 1001 }, request_key: 'persisted-document-work',
      note: { title: 'PRIVATE TITLE CANARY 86c34', text: 'PRIVATE NOTE BODY CANARY 86c34', audience: 'internal' },
      time: { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 35,
        summary: 'PRIVATE TIME SUMMARY CANARY 86c34', internal_notes: 'PRIVATE INTERNAL TEXT CANARY 86c34' },
    };
    const first = await writes.documentWork(principal, input);
    assert.equal(first.status, 'partial');
    assert.equal(first.can_resume, true);
    assert.equal(adapter.calls.filter(call => call.entity === 'TicketNotes' && call.kind === 'create').length, 1);
    assert.equal(adapter.calls.filter(call => call.entity === 'TimeEntries' && call.kind === 'create').length, 0);
    type StoredStep = { operation_id: string; state: string; attempt: number; native_id?: number };
    const initialSteps = first.data.steps as { note: StoredStep; time: StoredStep };
    assert.equal(initialSteps.note.state, 'succeeded_verified');
    assert.equal(initialSteps.note.attempt, 1);
    assert.equal(initialSteps.time.state, 'failed');
    assert.equal(initialSteps.time.attempt, 1);
    const beforeRestart = await journal.get(first.operation_id, actorKey(principal));
    assert.ok(beforeRestart);
    assert.ok(beforeRestart.encryptedIntent?.startsWith('v1.'));
    assert.ok(Date.parse(beforeRestart.intentExpiresAt!) > Date.now());
    const savedCiphertext = beforeRestart.encryptedIntent;

    // A new adapter sees the same upstream records; all identity/journal/cipher services are reconstructed.
    const resumedStore = new PostgresPrincipalStore(db), resumedJournal = new PostgresJournal(db);
    const resumedAdapter = new FixtureAutotaskAdapter(p => reauthorize(p, resumedStore), adapter.records);
    const resumedCore = new TicketWorkflows(resumedAdapter, resumedStore, resumedJournal);
    const reconstructed = new TicketWriteWorkflows(resumedCore, new IntentCipher(Buffer.from(secret)));
    assert.equal(await resumedJournal.get(first.operation_id, actorKey(otherActor)), undefined);
    assert.equal(await resumedJournal.find(actorKey(otherActor), input.request_key), undefined);
    await assert.rejects(reconstructed.status(otherActor, { operation_id: first.operation_id }), { code: 'not_found_or_inaccessible' });
    await assert.rejects(reconstructed.resume(otherActor, { operation_id: first.operation_id }), { code: 'not_found_or_inaccessible' });
    const wrongKey = new TicketWriteWorkflows(resumedCore, new IntentCipher(randomBytes(32)));
    await assert.rejects(wrongKey.resume(principal, { operation_id: first.operation_id }), { code: 'conflict' });
    assert.equal((await resumedJournal.get(first.operation_id, actorKey(principal)))?.state, 'partial');

    const complete = await reconstructed.resume(principal, { operation_id: first.operation_id });
    assert.equal(complete.status, 'succeeded_verified');
    assert.equal(complete.operation_id, first.operation_id);
    assert.equal(complete.can_resume, false);
    const finalSteps = complete.data.steps as { note: StoredStep; time: StoredStep };
    assert.deepEqual(finalSteps.note, initialSteps.note);
    assert.equal(finalSteps.time.state, 'succeeded_verified');
    assert.equal(finalSteps.time.attempt, 2);
    assert.notEqual(finalSteps.time.operation_id, initialSteps.time.operation_id);
    assert.ok(finalSteps.time.native_id);
    assert.equal(resumedAdapter.calls.filter(call => call.entity === 'TicketNotes' && call.kind === 'create').length, 0);
    assert.equal(resumedAdapter.calls.filter(call => call.entity === 'TimeEntries' && call.kind === 'create').length, 1);
    assert.equal(resumedAdapter.records.TicketNotes.filter(row => row.description === input.note.text).length, 1);
    const savedTime = resumedAdapter.records.TimeEntries.filter(row => row.summaryNotes === input.time.summary);
    assert.equal(savedTime.length, 1);
    assert.equal(savedTime[0]!.resourceID, principal.resourceId);
    assert.equal(savedTime[0]!.hoursWorked, 35 / 60);
    assert.equal(savedTime[0]!.internalNotes, input.time.internal_notes);
    const duplicate = await reconstructed.documentWork(principal, input);
    assert.equal(duplicate.status, 'succeeded_verified');
    assert.equal(duplicate.operation_id, first.operation_id);
    await assert.rejects(reconstructed.resume(principal, { operation_id: first.operation_id }), { code: 'conflict' });
    assert.equal(resumedAdapter.calls.filter(call => call.kind === 'create').length, 1);

    const root = await resumedJournal.get(first.operation_id, actorKey(principal));
    assert.equal(root?.encryptedIntent, savedCiphertext);
    assert.equal(root?.intentExpiresAt, beforeRestart.intentExpiresAt);
    const rows = await db.query<{ operation: string; state: string; encrypted_intent: string | null }>('SELECT * FROM operation_journal');
    assert.equal(rows.rows.length, 4);
    assert.equal(rows.rows.filter(row => row.encrypted_intent !== null).length, 1);
    assert.equal(rows.rows.find(row => row.operation === 'ticket_document_work')?.state, 'succeeded_verified');
    assert.equal(rows.rows.filter(row => row.operation === 'time_log_ticket' && row.state === 'failed').length, 1);
    const persisted = JSON.stringify(rows.rows), response = JSON.stringify([first, complete, duplicate]);
    for (const privateText of [input.note.title, input.note.text, input.time.summary, input.time.internal_notes]) {
      assert.ok(!persisted.includes(privateText), 'No request text is stored in plaintext journal columns.');
      assert.ok(!response.includes(privateText), 'Write receipts contain no note or time text.');
    }
    assert.ok(!response.includes(savedCiphertext!));
  } finally { await db.close(); }
});
