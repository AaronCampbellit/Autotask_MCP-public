import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, actorKey, type Principal } from '../packages/contracts/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals, fixtureWorkMetadata } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';

const ticket = { kind: 'id', id: 1001 } as const;
const note = { title: 'Work performed', text: 'Internal facts', audience: 'internal' } as const;
const time = { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 30, summary: 'Separate time summary' };
const request = (request_key: string) => ({ ticket, note: { ...note }, time: { ...time }, request_key });
type Receipt = Awaited<ReturnType<TicketWriteWorkflows['documentWork']>>;
type Step = { operation_id: string; state: string; attempt: number; native_id?: number };
const steps = (receipt: Receipt): { note?: Step; time?: Step } => receipt.data.steps as { note?: Step; time?: Step };
const code = (expected: string) => (error: unknown): boolean => error instanceof AppError && error.code === expected;

function setup() {
  const [technician, reader] = fixturePrincipals() as [Principal, Principal];
  const store = new MemoryPrincipalStore([technician, reader]);
  const adapter = new FixtureAutotaskAdapter(principal => reauthorize(principal, store));
  const journal = new MemoryJournal();
  const core = new TicketWorkflows(adapter, store, journal);
  const cipher = new IntentCipher(Buffer.alloc(32, 7));
  const clock = { value: Date.now() };
  const workflows = new TicketWriteWorkflows(core, cipher, () => clock.value);
  return { technician, reader, store, adapter, journal, core, cipher, clock, workflows };
}

type Setup = ReturnType<typeof setup>;
const created = (s: Setup, entity: 'TicketNotes' | 'TimeEntries') =>
  s.adapter.calls.filter(call => call.entity === entity && call.kind === 'create').length;
const createdEntities = (s: Setup) => s.adapter.calls.filter(call => call.kind === 'create').map(call => call.entity);

function failFirstTime(s: Setup) {
  const original = s.adapter.createTicketTime.bind(s.adapter);
  let attempts = 0;
  s.adapter.createTicketTime = async (...args) => {
    attempts++;
    if (attempts === 1) throw new AppError('invalid_input', 'Synthetic definitive rejection before time creation.');
    return original(...args);
  };
  return { attempts: () => attempts };
}

test('standalone note preserves audience/text/defaults and same-key replay does not create another note', async () => {
  const s = setup();
  const input = { ticket, note: { ...note }, request_key: 'standalone-note-01' };
  const first = await s.workflows.noteAdd(s.technician, input);
  const duplicate = await s.workflows.noteAdd(s.technician, input);
  assert.equal(first.status, 'succeeded_verified');
  assert.equal(first.operation_id, duplicate.operation_id);
  assert.equal(created(s, 'TicketNotes'), 1);
  assert.equal(created(s, 'TimeEntries'), 0);
  const saved = s.adapter.records.TicketNotes.find(row => row.id === first.data.note_id)!;
  assert.equal(saved.title, note.title);
  assert.equal(saved.description, note.text);
  assert.equal(saved.publish, 701);
  assert.equal(saved.creatorResourceID, s.technician.resourceId);
  assert.equal(first.data.audience, 'internal');
  assert.deepEqual(first.data.defaults, [{ field: 'note_type', source: 'reviewed_default', rule_version: 'fixture-defaults-v1', id: 11 }]);
  assert.match(first.receipt, /internal note.*saved and verified/i);
  assert.equal(first.safe_to_redispatch, false);
  const record = await s.journal.get(first.operation_id, actorKey(s.technician));
  assert.equal(record?.operation, 'ticket_note_add');
  assert.equal(record?.encryptedIntent, undefined);
  assert.doesNotMatch(JSON.stringify(record), /Internal facts|Work performed/);
  await assert.rejects(s.workflows.noteAdd(s.technician, { ...input, note: { ...note, text: 'Changed work' } }), code('conflict'));
});

test('standalone time uses explicit date/minutes and its separate summary without adding a note', async () => {
  const s = setup();
  const input = { ticket, time: { ...time, internal_notes: 'Separate private time facts' }, request_key: 'standalone-time-01' };
  const first = await s.workflows.timeLog(s.technician, input);
  const duplicate = await s.workflows.timeLog(s.technician, input);
  assert.equal(first.status, 'succeeded_verified');
  assert.equal(first.operation_id, duplicate.operation_id);
  assert.equal(created(s, 'TimeEntries'), 1);
  assert.equal(created(s, 'TicketNotes'), 0);
  const saved = s.adapter.records.TimeEntries.find(row => row.id === first.data.time_entry_id)!;
  assert.equal(saved.summaryNotes, time.summary);
  assert.equal(saved.internalNotes, input.time.internal_notes);
  assert.equal(saved.hoursWorked, 0.5);
  assert.equal(saved.dateWorked, '2026-09-10T00:00:00Z');
  assert.equal(saved.resourceID, s.technician.resourceId);
  assert.equal(first.data.work_date, time.work_date);
  assert.equal(first.data.timezone, time.timezone);
  assert.deepEqual(first.data.defaults, [
    { field: 'role', source: 'reviewed_default', rule_version: 'fixture-defaults-v1', id: 201 },
    { field: 'work_type', source: 'reviewed_default', rule_version: 'fixture-defaults-v1', id: 301 },
  ]);
  assert.doesNotMatch(JSON.stringify(await s.journal.get(first.operation_id, actorKey(s.technician))), /Separate time summary|Separate private time facts/);
});

test('document work records named steps in note-before-time order and changes no ticket fields', async () => {
  const s = setup();
  const originalTicket = structuredClone(s.adapter.records.Tickets[0]);
  const result = await s.workflows.documentWork(s.technician, request('document-success-01'));
  assert.equal(result.status, 'succeeded_verified');
  assert.deepEqual(createdEntities(s), ['TicketNotes', 'TimeEntries']);
  const detail = steps(result);
  assert.equal(detail.note?.state, 'succeeded_verified');
  assert.equal(detail.time?.state, 'succeeded_verified');
  const savedNote = s.adapter.records.TicketNotes.find(row => row.id === detail.note?.native_id)!;
  const savedTime = s.adapter.records.TimeEntries.find(row => row.id === detail.time?.native_id)!;
  assert.equal(savedNote.description, note.text);
  assert.equal(savedNote.publish, 701);
  assert.equal(savedTime.summaryNotes, time.summary);
  assert.notEqual(savedTime.summaryNotes, savedNote.description);
  assert.ok(!Object.hasOwn(savedTime, 'internalNotes'));
  assert.deepEqual(s.adapter.records.Tickets[0], originalTicket);
  assert.equal((await s.journal.get(result.operation_id, actorKey(s.technician)))?.operation, 'ticket_document_work');
  assert.equal((await s.journal.get(detail.note!.operation_id, actorKey(s.technician)))?.operation, 'ticket_note_add');
  assert.equal((await s.journal.get(detail.time!.operation_id, actorKey(s.technician)))?.operation, 'time_log_ticket');
  assert.match(result.receipt, /internal note and requested time.*saved and verified/i);
  assert.equal(result.can_resume, false);
});

test('missing or invalid time and missing note facts fail before any document effect', async () => {
  for (const patch of [{ time: undefined }, { time: { ...time, minutes: 0 } },
    { time: { ...time, summary: '' } }, { time: { ...time, timezone: undefined } },
    { time: { ...time, role: 'Not an eligible role' } }, { note: { ...note, audience: undefined } },
    { note: { ...note, title: undefined } }]) {
    const s = setup();
    await assert.rejects(s.workflows.documentWork(s.technician, { ...request('invalid-document-01'), ...patch }));
    assert.deepEqual(createdEntities(s), []);
  }
  const s = setup();
  s.adapter.metadataFactory = (p, id) => { const current = fixtureWorkMetadata(p, id); current.time.eligible = false; return current; };
  await assert.rejects(s.workflows.documentWork(s.technician, request('ineligible-time-01')), code('precondition_failed'));
  assert.deepEqual(createdEntities(s), []);
});

test('a definitively rejected note prevents the time step', async () => {
  const s = setup();
  let noteAttempts = 0, timeAttempts = 0;
  s.adapter.createTicketNote = async () => { noteAttempts++; throw new AppError('invalid_input', 'Synthetic rejected note.'); };
  s.adapter.createTicketTime = async () => { timeAttempts++; throw new Error('Time must never be reached.'); };
  const result = await s.workflows.documentWork(s.technician, request('rejected-note-01'));
  assert.equal(result.status, 'partial');
  assert.equal(steps(result).note?.state, 'failed');
  assert.equal(steps(result).time?.state, 'ready');
  assert.equal(noteAttempts, 1);
  assert.equal(timeAttempts, 0);
  assert.deepEqual(createdEntities(s), []);
  assert.match(result.receipt, /Time was not attempted/);
});

test('definitive time failure preserves the note and resume uses the same encrypted original work', async () => {
  const s = setup();
  const fault = failFirstTime(s);
  const input = request('resumable-time-01');
  const partial = await s.workflows.documentWork(s.technician, input);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.can_resume, true);
  assert.equal(steps(partial).note?.state, 'succeeded_verified');
  assert.equal(steps(partial).time?.state, 'failed');
  const prior = (await s.journal.get(partial.operation_id, actorKey(s.technician)))!;
  assert.ok(prior.encryptedIntent?.startsWith('v1.'));
  assert.doesNotMatch(JSON.stringify(prior), /Internal facts|Separate time summary|Work performed/);
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: partial.operation_id, time: { ...time, minutes: 90 } }));
  const restarted = new TicketWriteWorkflows(s.core, new IntentCipher(Buffer.alloc(32, 7)));
  const completed = await restarted.resume(s.technician, { operation_id: partial.operation_id });
  assert.equal(completed.status, 'succeeded_verified');
  assert.equal(completed.operation_id, partial.operation_id);
  assert.equal(created(s, 'TicketNotes'), 1);
  assert.equal(created(s, 'TimeEntries'), 1);
  assert.equal(fault.attempts(), 2);
  assert.equal(steps(completed).note?.native_id, steps(partial).note?.native_id);
  assert.equal(steps(completed).note?.attempt, 1);
  assert.equal(steps(completed).time?.attempt, 2);
  const saved = s.adapter.records.TimeEntries.find(row => row.id === steps(completed).time?.native_id)!;
  assert.equal(saved.summaryNotes, time.summary);
  assert.equal(saved.hoursWorked, 0.5);
  assert.equal(saved.resourceID, s.technician.resourceId);
  assert.equal(saved.dateWorked, '2026-09-10T00:00:00Z');
  const final = (await s.journal.get(completed.operation_id, actorKey(s.technician)))!;
  assert.equal(final.encryptedIntent, prior.encryptedIntent);
  const duplicate = await s.workflows.documentWork(s.technician, input);
  assert.equal(duplicate.operation_id, completed.operation_id);
  assert.deepEqual(createdEntities(s), ['TicketNotes', 'TimeEntries']);
});

test('a lost time-create response remains unknown and neither resume nor same-key replay repeats it', async () => {
  const s = setup();
  const create = s.adapter.createTicketTime.bind(s.adapter);
  let attempts = 0;
  s.adapter.createTicketTime = async (...args) => {
    attempts++; await create(...args);
    throw new AppError('unknown_outcome', 'Synthetic response lost after upstream acceptance.');
  };
  const input = request('lost-time-response-01');
  const first = await s.workflows.documentWork(s.technician, input);
  assert.equal(first.status, 'unknown_outcome');
  assert.equal(steps(first).note?.state, 'succeeded_verified');
  assert.equal(steps(first).time?.state, 'unknown_outcome');
  assert.equal(first.can_resume, false);
  assert.equal(first.safe_to_redispatch, false);
  assert.equal(created(s, 'TimeEntries'), 1);
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: first.operation_id }), code('conflict'));
  const duplicate = await s.workflows.documentWork(s.technician, input);
  assert.equal(duplicate.status, 'unknown_outcome');
  assert.equal(duplicate.operation_id, first.operation_id);
  assert.equal(attempts, 1);
  assert.equal(created(s, 'TicketNotes'), 1);
  assert.doesNotMatch(first.receipt, /time.*saved and verified/i);
});

test('mismatched note title, text, audience or selected attribution blocks time and any resume', async () => {
  for (const patch of [{ title: 'Different note title' }, { description: 'Different note text' },
    { publish: 702 }, { creatorResourceID: 999, impersonatorCreatorResourceID: 101 }]) {
    const s = setup();
    const read = s.adapter.getTicketNote.bind(s.adapter);
    s.adapter.getTicketNote = async (...args) => ({ ...await read(...args), ...patch });
    const result = await s.workflows.documentWork(s.technician, request('unverified-note-01'));
    assert.equal(result.status, 'accepted_unverified');
    assert.equal(steps(result).note?.state, 'accepted_unverified');
    assert.equal(created(s, 'TicketNotes'), 1);
    assert.equal(created(s, 'TimeEntries'), 0);
    assert.equal(result.can_resume, false);
    await assert.rejects(s.workflows.resume(s.technician, { operation_id: result.operation_id }), code('conflict'));
  }
});

test('mismatched time summary, duration or resource never becomes verified success', async () => {
  for (const patch of [{ summaryNotes: note.text }, { hoursWorked: 1 }, { resourceID: 999 }]) {
    const s = setup();
    const read = s.adapter.getTicketTime.bind(s.adapter);
    s.adapter.getTicketTime = async (...args) => ({ ...await read(...args), ...patch });
    const result = await s.workflows.timeLog(s.technician, { ticket, time, request_key: 'unverified-time-01' });
    assert.equal(result.status, 'accepted_unverified');
    assert.equal(result.can_resume, false);
    assert.equal(result.safe_to_redispatch, false);
    assert.match(result.receipt, /could not be fully verified/);
    assert.equal(created(s, 'TimeEntries'), 1);
  }
});

test('a saved note changed before resume is not overwritten or treated as a valid prerequisite', async () => {
  for (const field of ['title', 'description']) {
    const s = setup();
    const fault = failFirstTime(s);
    const partial = await s.workflows.documentWork(s.technician, request('changed-note-resume-01'));
    const existingNote = s.adapter.records.TicketNotes.find(row => row.id === steps(partial).note?.native_id)!;
    existingNote[field] = 'Another technician changed this field.';
    const result = await s.workflows.resume(s.technician, { operation_id: partial.operation_id });
    assert.equal(result.status, 'accepted_unverified');
    assert.equal(created(s, 'TicketNotes'), 1);
    assert.equal(created(s, 'TimeEntries'), 0);
    assert.equal(fault.attempts(), 1);
    assert.equal(existingNote[field], 'Another technician changed this field.');
    assert.equal(result.can_resume, false);
  }
});

test('twenty concurrent duplicate documents produce one note and one time entry', async () => {
  const s = setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => s.workflows.documentWork(s.technician, request('twenty-duplicates-01'))));
  assert.equal(new Set(results.map(result => result.operation_id)).size, 1);
  const final = await s.workflows.status(s.technician, { operation_id: results[0]!.operation_id });
  assert.equal(final.status, 'succeeded_verified');
  assert.deepEqual(createdEntities(s), ['TicketNotes', 'TimeEntries']);
});

test('twenty concurrent resumes claim only one remaining time step', async () => {
  const s = setup();
  const fault = failFirstTime(s);
  const partial = await s.workflows.documentWork(s.technician, request('twenty-resumes-01'));
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => s.workflows.resume(s.technician, { operation_id: partial.operation_id })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.ok(code('conflict')(result.reason));
  assert.equal(fault.attempts(), 2);
  assert.deepEqual(createdEntities(s), ['TicketNotes', 'TimeEntries']);
  assert.equal((await s.workflows.status(s.technician, { operation_id: partial.operation_id })).status, 'succeeded_verified');
});

test('expired encrypted inputs or an unavailable encryption key block partial recovery', async () => {
  const expired = setup(); failFirstTime(expired);
  const partial = await expired.workflows.documentWork(expired.technician, request('expired-intent-01'));
  expired.clock.value += 8 * 86_400_000;
  await assert.rejects(expired.workflows.resume(expired.technician, { operation_id: partial.operation_id }), code('conflict'));
  assert.deepEqual(createdEntities(expired), ['TicketNotes']);
  const wrongKey = setup(); failFirstTime(wrongKey);
  const saved = await wrongKey.workflows.documentWork(wrongKey.technician, request('wrong-key-intent-01'));
  const restarted = new TicketWriteWorkflows(wrongKey.core, new IntentCipher(Buffer.alloc(32, 8)));
  await assert.rejects(restarted.resume(wrongKey.technician, { operation_id: saved.operation_id }), code('conflict'));
  assert.deepEqual(createdEntities(wrongKey), ['TicketNotes']);
});

test('revocation, mapping replacement and policy changes cannot transfer saved work to another actor state', async () => {
  for (const patch of [{ active: false }, { resourceId: 109, mappingVersion: 2 }, { policyVersion: 'replacement-policy' },
    { capabilities: ['operational.read', 'tickets.write'] as Principal['capabilities'] }]) {
    const s = setup(); failFirstTime(s);
    const partial = await s.workflows.documentWork(s.technician, request('revoked-resume-01'));
    const changed = { ...s.technician, ...patch };
    s.store.set(changed);
    await assert.rejects(s.workflows.resume(changed, { operation_id: partial.operation_id }));
    assert.deepEqual(createdEntities(s), ['TicketNotes']);
  }
  const s = setup(); failFirstTime(s);
  const partial = await s.workflows.documentWork(s.technician, request('other-actor-resume-01'));
  await assert.rejects(s.workflows.status(s.reader, { operation_id: partial.operation_id }), code('not_found_or_inaccessible'));
  assert.deepEqual(createdEntities(s), ['TicketNotes']);
});

test('metadata/default drift prevents replay instead of substituting a new eligible work type', async () => {
  for (const mode of ['version', 'rule', 'selected-value']) {
    const s = setup(); const fault = failFirstTime(s);
    const partial = await s.workflows.documentWork(s.technician, request('default-drift-01'));
    s.adapter.metadataFactory = (p, id) => {
      const current = fixtureWorkMetadata(p, id);
      if (mode === 'version') current.version = 'different-metadata';
      if (mode === 'rule') current.defaultRuleVersion = 'different-default-rule';
      if (mode === 'selected-value') {
        current.time.workTypes.push({ id: 302, label: 'Onsite support', active: true });
        current.time.defaultWorkTypeId = 302;
      }
      return current;
    };
    await assert.rejects(s.workflows.resume(s.technician, { operation_id: partial.operation_id }), code('precondition_failed'));
    assert.equal(fault.attempts(), 1);
    assert.deepEqual(createdEntities(s), ['TicketNotes']);
  }
});

test('lost final root acknowledgements return the actual committed success or partial state', async () => {
  for (const target of ['succeeded_verified', 'partial'] as const) {
    const s = setup();
    if (target === 'partial') failFirstTime(s);
    const transition = s.journal.transition.bind(s.journal);
    let injected = false;
    s.journal.transition = async (...args) => {
      const before = await s.journal.get(args[0], actorKey(s.technician));
      const committed = await transition(...args);
      if (!injected && before?.operation === 'ticket_document_work' && args[2] === target) {
        injected = true;
        throw new AppError('dependency_unavailable', 'Synthetic lost final root acknowledgement.');
      }
      return committed;
    };
    const result = await s.workflows.documentWork(s.technician, request(`lost-root-ack-${target}`));
    const durable = (await s.journal.get(result.operation_id, actorKey(s.technician)))!;
    assert.equal(injected, true);
    assert.equal(durable.state, target);
    assert.equal(result.status, durable.state);
    assert.deepEqual(result.data.steps, durable.result?.steps);
    assert.equal(created(s, 'TicketNotes'), 1);
    assert.equal(created(s, 'TimeEntries'), target === 'succeeded_verified' ? 1 : 0);
  }
});

test('metadata drift after root reservation records a failed pre-dispatch outcome instead of stranded ready work', async () => {
  const s = setup();
  const reserve = s.journal.reserve.bind(s.journal);
  s.journal.reserve = async input => {
    const result = await reserve(input);
    if (input.operation === 'ticket_document_work' && result.created) {
      s.adapter.metadataFactory = (p, id) => ({ ...fixtureWorkMetadata(p, id), version: 'changed-after-reserve' });
    }
    return result;
  };
  const input = request('drift-after-reserve-01');
  const [outcome] = await Promise.allSettled([s.workflows.documentWork(s.technician, input)]);
  const durable = await s.journal.find(actorKey(s.technician), input.request_key);
  assert.equal(durable?.state, 'failed');
  assert.deepEqual(createdEntities(s), []);
  if (outcome!.status === 'fulfilled') assert.equal(outcome!.value.status, 'failed');
  else assert.ok(code('precondition_failed')(outcome!.reason));
});

test('partial status stops offering resume after encrypted inputs expire', async () => {
  const s = setup(); failFirstTime(s);
  const partial = await s.workflows.documentWork(s.technician, request('expired-resume-status-01'));
  assert.equal(partial.can_resume, true);
  s.clock.value += 8 * 86_400_000;
  const status = await s.workflows.status(s.technician, { operation_id: partial.operation_id });
  assert.equal(status.can_resume, false);
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: partial.operation_id }), code('conflict'));
  assert.deepEqual(createdEntities(s), ['TicketNotes']);
});

test('the bounded tenth attempt exhausts resume availability without replaying the saved note', async () => {
  const s = setup();
  let timeAttempts = 0;
  s.adapter.createTicketTime = async () => {
    timeAttempts++;
    throw new AppError('invalid_input', 'Synthetic repeated definitive rejection.');
  };
  let result = await s.workflows.documentWork(s.technician, request('bounded-attempts-01'));
  for (let attempt = 2; attempt <= 10; attempt++) {
    assert.equal(result.can_resume, true);
    result = await s.workflows.resume(s.technician, { operation_id: result.operation_id });
    assert.equal(steps(result).time?.attempt, attempt);
  }
  assert.equal(result.status, 'partial');
  assert.equal(result.can_resume, false);
  assert.equal(timeAttempts, 10);
  assert.equal(created(s, 'TicketNotes'), 1);
  assert.equal(created(s, 'TimeEntries'), 0);
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: result.operation_id }), code('conflict'));
  assert.equal(timeAttempts, 10);
});

test('every public mutation reserves the wf request-key namespace for internal child steps', async () => {
  const s = setup();
  const request_key = 'wf:reserved-for-child-steps';
  await assert.rejects(s.workflows.noteAdd(s.technician, { ticket, note, request_key }));
  await assert.rejects(s.workflows.timeLog(s.technician, { ticket, time, request_key }));
  await assert.rejects(s.workflows.documentWork(s.technician, request(request_key)));
  await assert.rejects(s.core.update(s.technician, {
    ticket, request_key, changes: { title: 'Forbidden reserved-key update' },
    expected: { title: 'Example printer offline' },
  }));
  assert.deepEqual(createdEntities(s), []);
  assert.equal(s.adapter.calls.filter(call => call.kind === 'patch').length, 0);
});

test('a document request below the HTTP body limit fits encrypted intent without duplicating supplied text', async () => {
  const s = setup();
  const input = {
    ...request('large-accepted-document-01'),
    note: { ...note, text: 'N'.repeat(32_000) },
    time: { ...time, summary: 'T'.repeat(32_000), internal_notes: '' },
  };
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_document_work', arguments: input } };
  const remaining = 65_500 - Buffer.byteLength(JSON.stringify(rpc));
  assert.ok(remaining > 0 && remaining < 32_000);
  input.time.internal_notes = 'I'.repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(rpc)), 65_500);
  const result = await s.workflows.documentWork(s.technician, input);
  assert.equal(result.status, 'succeeded_verified');
  assert.deepEqual(createdEntities(s), ['TicketNotes', 'TimeEntries']);
  const durable = (await s.journal.get(result.operation_id, actorKey(s.technician)))!;
  assert.ok(durable.encryptedIntent?.startsWith('v1.'));
  assert.ok(!JSON.stringify(durable).includes(input.note.text));
  assert.ok(!JSON.stringify(durable).includes(input.time.summary));
});

test('time failure diagnostics survive receipt storage and same-key lookup without redispatch', async () => {
  const s = setup();
  let dispatches = 0;
  s.adapter.createTicketTime = async () => { dispatches++; throw new AppError('unknown_outcome', 'Private exception text', false, { reason: 'http_error', http_status: 500 }); };
  const input = { ticket, time, request_key: 'diagnostic-time-key' };
  const first = await s.workflows.timeLog(s.technician, input);
  assert.equal(first.status, 'unknown_outcome');
  assert.deepEqual(first.data.upstream_failure, { reason: 'http_error', http_status: 500 });
  assert.equal(JSON.stringify(first).includes('Private exception text'), false);
  const again = await s.workflows.timeLog(s.technician, input);
  assert.deepEqual(again.data.upstream_failure, first.data.upstream_failure);
  assert.equal(again.safe_to_redispatch, false);
  assert.equal(dispatches, 1);
});

test('ticket time verifies exact saved timestamps and exposes safe start/stop rejection', async () => {
  const s=setup();
  const result=await s.workflows.timeLog(s.technician,{ticket,time:{...time,start_datetime:'2026-09-10T08:00:00-05:00',end_datetime:'2026-09-10T08:30:00-05:00'},request_key:'explicit-meeting-times'});
  assert.equal(result.status,'succeeded_verified');
  assert.equal(result.data.start_datetime,'2026-09-10T13:00:00.000Z');
  const bad=setup();bad.adapter.createTicketTime=async()=>{throw new AppError('invalid_input','native requirement',false,{reason:'start_stop_required',http_status:500});};
  const rejected=await bad.workflows.timeLog(bad.technician,{ticket,time,request_key:'native-start-stop-rejection'});
  assert.equal(rejected.status,'failed');
  assert.match(rejected.receipt,/requires actual start and stop/);
});

test('derived time receipts disclose interval and assumption and never recalculate on same-key retry',async()=>{
  const s=setup();const input={ticket,time:{...time,end_datetime:'2026-09-10T10:00:00-05:00',timing_source:'current_time'},request_key:'assumed-end-receipt'};
  const first=await s.workflows.timeLog(s.technician,input);
  assert.equal(first.status,'succeeded_verified');assert.match(first.receipt,/9:30 AM/);assert.match(first.receipt,/10:00 AM/);assert.match(first.receipt,/current_time/);
  const again=await s.workflows.timeLog(s.technician,input);
  assert.equal(again.data.start_datetime,first.data.start_datetime);assert.equal(created(s,'TimeEntries'),1);
  await assert.rejects(s.workflows.timeLog(s.technician,{...input,time:{...input.time,end_datetime:'2026-09-10T11:00:00-05:00'}}),code('conflict'));
});
test('closed ticket note writes directly without changing ticket status',async()=>{const s=setup();s.adapter.records.Tickets.find(t=>t.id===1001)!.status=5;const r=await s.workflows.noteAdd(s.technician,{ticket,note:{...note},request_key:'closed-ticket-note-direct'});assert.equal(r.status,'succeeded_verified');assert.equal(s.adapter.records.Tickets.find(t=>t.id===1001)!.status,5);assert.equal(s.adapter.calls.some(c=>c.entity==='Tickets'&&c.kind==='patch'),false);});
