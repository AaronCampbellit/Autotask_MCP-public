import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, actorKey, type Principal } from '../packages/contracts/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../packages/workflows/src/write-workflows.js';

const request = (request_key: string) => ({ ticket: { kind: 'id', id: 1001 }, note: { title: 'Fictitious work', text: 'Synthetic internal detail.', audience: 'internal' }, time: { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 30, summary: 'Synthetic time summary.' }, request_key });
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
function setup() {
  const [technician, reader] = fixturePrincipals() as [Principal, Principal];
  const store = new MemoryPrincipalStore([technician, reader]), journal = new MemoryJournal();
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store)), core = new TicketWorkflows(adapter, store, journal);
  const cipher = new IntentCipher(Buffer.alloc(32, 9)), writes = new TicketWriteWorkflows(core, cipher);
  return { technician, reader, store, journal, adapter, core, cipher, writes };
}
type Setup = ReturnType<typeof setup>;
type Receipt = Awaited<ReturnType<TicketWriteWorkflows['documentWork']>>;
const steps = (receipt: Receipt) => receipt.data.steps as Record<'note' | 'time', { state: string; operation_id: string; attempt: number; native_id?: number }>;
const created = (s: Setup) => s.adapter.calls.filter(row => row.kind === 'create').map(row => row.entity);

test('document work links both planned child journal records before creating the note', async () => {
  const s = setup(), original = s.adapter.createTicketNote.bind(s.adapter);
  s.adapter.createTicketNote = async (...args) => {
    const rows = s.journal.inspectAll(), root = rows.find(row => row.operation === 'ticket_document_work')!;
    assert.equal(rows.length, 3);
    const links = root.result?.steps as Record<'note' | 'time', { operation_id: string }>;
    assert.equal(root.state, 'dispatching');
    assert.equal(rows.find(row => row.id === links.note.operation_id)?.state, 'dispatching');
    assert.equal(rows.find(row => row.id === links.time.operation_id)?.state, 'ready');
    return original(...args);
  };
  assert.equal((await s.writes.documentWork(s.technician, request('document-prelinked'))).status, 'succeeded_verified');
});

test('recorded note readback outage reconciles without metadata and resumes only the ready time child', async () => {
  const s = setup(), read = s.adapter.getTicketNote.bind(s.adapter); let outage = true;
  s.adapter.getTicketNote = async (...args) => { if (outage) throw new AppError('dependency_unavailable', 'Synthetic readback outage.'); return read(...args); };
  const first = await s.writes.documentWork(s.technician, request('document-note-reconcile'));
  assert.equal(first.status, 'accepted_unverified');
  assert.equal(steps(first).note.state, 'accepted_unverified'); assert.equal(steps(first).time.state, 'ready');
  const metadata = s.adapter.ticketWorkMetadata.bind(s.adapter);
  s.adapter.ticketWorkMetadata = async () => { throw new AppError('missing_metadata', 'Current create metadata unavailable.'); };
  outage = false;
  const resolved = await s.writes.reconcile(s.technician, { operation_id: first.operation_id });
  assert.equal(resolved.status, 'partial'); assert.equal(resolved.can_resume, true);
  assert.deepEqual(created(s), ['TicketNotes']);
  s.adapter.ticketWorkMetadata = metadata;
  const resumed = await s.writes.resume(s.technician, { operation_id: first.operation_id });
  assert.equal(resumed.status, 'succeeded_verified');
  assert.equal(steps(resumed).time.operation_id, steps(first).time.operation_id);
  assert.equal(steps(resumed).time.attempt, 1);
  assert.deepEqual(created(s), ['TicketNotes', 'TimeEntries']);
});

test('recorded time readback outage reconciles to success using original summary, duration, date and employee', async () => {
  const s = setup(), read = s.adapter.getTicketTime.bind(s.adapter); let outage = true;
  s.adapter.getTicketTime = async (...args) => { if (outage) throw new AppError('dependency_unavailable', 'Synthetic readback outage.'); return read(...args); };
  const first = await s.writes.documentWork(s.technician, request('document-time-reconcile'));
  assert.equal(first.status, 'accepted_unverified'); outage = false;
  const entry = s.adapter.records.TimeEntries.find(row => row.id === steps(first).time.native_id)!;
  const summary = entry.summaryNotes; entry.summaryNotes = 'Changed after create';
  assert.equal((await s.writes.reconcile(s.technician, { operation_id: first.operation_id })).status, 'accepted_unverified');
  entry.summaryNotes = summary;
  assert.equal((await s.writes.reconcile(s.technician, { operation_id: first.operation_id })).status, 'succeeded_verified');
  assert.deepEqual(created(s), ['TicketNotes', 'TimeEntries']);
});

test('unknown child without returned ID remains uncertain even when another matching record exists', async () => {
  const s = setup(), write = s.adapter.createTicketNote.bind(s.adapter);
  s.adapter.createTicketNote = async (...args) => { await write(...args); throw new AppError('unknown_outcome', 'Synthetic lost response.'); };
  const first = await s.writes.documentWork(s.technician, request('document-no-known-id'));
  assert.equal(first.status, 'unknown_outcome'); assert.equal(steps(first).note.native_id, undefined);
  assert.equal((await s.writes.reconcile(s.technician, { operation_id: first.operation_id })).status, 'unknown_outcome');
  await assert.rejects(s.writes.resume(s.technician, { operation_id: first.operation_id }), code('conflict'));
  assert.deepEqual(created(s), ['TicketNotes']);
});

test('lost final root commit reloads independently verified children and reconciliation never repeats them', async () => {
  const s = setup(), transition = s.journal.transition.bind(s.journal); let fail = true;
  s.journal.transition = async (id, expected, next, result) => {
    if (fail && next === 'succeeded_verified' && s.journal.inspectAll().find(row => row.id === id)?.operation === 'ticket_document_work') { fail = false; throw new Error('Synthetic commit outage.'); }
    return transition(id, expected, next, result);
  };
  const first = await s.writes.documentWork(s.technician, request('document-root-reconcile'));
  assert.equal(first.status, 'unknown_outcome'); assert.match(first.receipt, /note and time entry were saved and verified/i);
  const recreated = new TicketWriteWorkflows(s.core, s.cipher);
  assert.equal((await recreated.reconcile(s.technician, { operation_id: first.operation_id })).status, 'succeeded_verified');
  assert.deepEqual(created(s), ['TicketNotes', 'TimeEntries']);
});

test('lost root admission acknowledgement retains planned links and safely resumes only ready children after reconciliation', async () => {
  const s = setup(), transition = s.journal.transition.bind(s.journal); let fail = true;
  s.journal.transition = async (id, expected, next, result) => {
    const record = await transition(id, expected, next, result);
    if (fail && record.operation === 'ticket_document_work' && expected === 'ready' && next === 'dispatching') { fail = false; throw new Error('Synthetic lost admission acknowledgement.'); }
    return record;
  };
  const first = await s.writes.documentWork(s.technician, request('document-admission-loss'));
  assert.equal(first.status, 'unknown_outcome'); assert.equal(steps(first).note.state, 'ready'); assert.equal(steps(first).time.state, 'ready');
  assert.deepEqual(created(s), []);
  assert.equal((await s.writes.reconcile(s.technician, { operation_id: first.operation_id })).status, 'partial');
  assert.equal((await s.writes.resume(s.technician, { operation_id: first.operation_id })).status, 'succeeded_verified');
  assert.deepEqual(created(s), ['TicketNotes', 'TimeEntries']);
});

test('document reconciliation rejects injected IDs, another actor and a replaced employee mapping', async () => {
  const s = setup(), read = s.adapter.getTicketNote.bind(s.adapter);
  s.adapter.getTicketNote = async () => { throw new AppError('dependency_unavailable', 'Synthetic outage.'); };
  const first = await s.writes.documentWork(s.technician, request('document-scoped-reconcile'));
  s.adapter.getTicketNote = read;
  await assert.rejects(s.writes.reconcile(s.technician, { operation_id: first.operation_id, note_id: 999 }));
  await assert.rejects(s.writes.reconcile(s.reader, { operation_id: first.operation_id }), code('not_found_or_inaccessible'));
  const replacement = { ...s.technician, mappingVersion: 2 }; s.store.set(replacement);
  await assert.rejects(s.writes.reconcile(replacement, { operation_id: first.operation_id }), code('conflict'));
  const record = await s.journal.get(first.operation_id, actorKey(s.technician)); assert.equal(record?.state, 'accepted_unverified');
  assert.deepEqual(created(s), ['TicketNotes']);
});
