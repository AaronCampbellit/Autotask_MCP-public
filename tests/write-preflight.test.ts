import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, actorKey } from '../packages/contracts/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';

test('date-specific time preflight rejects document work before its note is created', async () => {
  const principal = fixturePrincipals()[0]!, store = new MemoryPrincipalStore([principal]);
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store));
  const writes = new TicketWriteWorkflows(new TicketWorkflows(adapter, store, new MemoryJournal()), new IntentCipher(Buffer.alloc(32, 7)));
  let validations = 0;
  adapter.validateTicketTime = async (p, ticketId, payload) => {
    validations++;
    assert.equal(p.resourceId, principal.resourceId);
    assert.equal(ticketId, 1001);
    assert.equal(payload.dateWorked, '2026-09-10T00:00:00Z');
    assert.equal(payload.hoursWorked, 0.5);
    throw new AppError('precondition_failed', 'The specified work date is in a locked period.');
  };
  await assert.rejects(writes.documentWork(principal, {
    ticket: { kind: 'id', id: 1001 }, request_key: 'date-preflight-001',
    note: { title: 'Requested work', text: 'Fictitious supplied note.', audience: 'internal' },
    time: { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 30, summary: 'Separate supplied time summary.' },
  }), { code: 'precondition_failed' });
  assert.equal(validations, 1);
  assert.equal(adapter.calls.filter(call => call.kind === 'create' || call.kind === 'patch').length, 0);
});

test('two verified child effects stay explicit in the receipt when root completion cannot commit', async () => {
  const principal = fixturePrincipals()[0]!, store = new MemoryPrincipalStore([principal]);
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store)), journal = new MemoryJournal();
  const transition = journal.transition.bind(journal);
  journal.transition = async (...args) => {
    const prior = await journal.get(args[0], actorKey(principal));
    if (prior?.operation === 'ticket_document_work' && args[2] === 'succeeded_verified') {
      throw new AppError('dependency_unavailable', 'Synthetic failure before root completion commit.');
    }
    return transition(...args);
  };
  const writes = new TicketWriteWorkflows(new TicketWorkflows(adapter, store, journal), new IntentCipher(Buffer.alloc(32, 7)));
  const result = await writes.documentWork(principal, {
    ticket: { kind: 'id', id: 1001 }, request_key: 'completion-precommit-fault',
    note: { title: 'Requested work', text: 'Fictitious supplied note.', audience: 'internal' },
    time: { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 30, summary: 'Separate supplied time summary.' },
  });
  assert.equal(result.status, 'unknown_outcome');
  assert.match(result.receipt, /note and time entry were saved and verified/i);
  assert.match(result.receipt, /do not recreate either record/i);
  assert.doesNotMatch(result.receipt, /time step is incomplete/i);
  assert.equal(result.can_resume, false);
  assert.equal(adapter.calls.filter(call => call.kind === 'create').length, 2);
});
