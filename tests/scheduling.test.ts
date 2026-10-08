import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, actorKey, type Principal } from '../packages/contracts/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { interval, serviceCallCreateSchema, type SchedulingMetadata } from '../packages/scheduling/src/contracts.js';
import { FixtureSchedulingPort, type FixtureSchedulingOptions } from '../packages/scheduling/src/fixtures.js';
import { HttpSchedulingPort, type HttpSchedulingOptions, type SchedulingOperation, type SchedulingQualification } from '../packages/scheduling/src/http.js';
import { SchedulingWorkflows } from '../packages/scheduling/src/index.js';
import { requestScheduler } from '../packages/autotask/src/index.js';

const ticket = { kind: 'id', id: 1001 } as const;
const window = { start: '2026-09-10T10:00:00-05:00', end: '2026-09-10T11:00:00-05:00', timezone: 'America/Chicago' };
const request = (request_key: string) => ({ ticket, ...window, resources: [{ kind: 'self' as const }], description: 'Fictitious sensitive appointment facts.', request_key });
const code = (expected: string) => (error: unknown): boolean => error instanceof AppError && error.code === expected;
type Receipt = Awaited<ReturnType<SchedulingWorkflows['create']>>;
const steps = (receipt: Receipt) => receipt.data.scheduling_steps;
function setup(options: FixtureSchedulingOptions = {}) {
  const [technician, reader] = fixturePrincipals() as [Principal, Principal];
  const store = new MemoryPrincipalStore([technician, reader]);
  const base = new FixtureAutotaskAdapter(p => reauthorize(p, store));
  const journal = new MemoryJournal(), core = new TicketWorkflows(base, store, journal), cipher = new IntentCipher(Buffer.alloc(32, 8));
  const port = new FixtureSchedulingPort(base, store, options), clock = { value: Date.now() };
  const workflows = new SchedulingWorkflows(core, port, cipher, () => clock.value);
  return { technician, reader, store, base, journal, core, cipher, port, workflows, clock };
}
type Setup = ReturnType<typeof setup>;
const created = (s: Setup) => s.port.calls.filter(row => row.kind === 'create').map(row => row.entity);

test('explicit local offsets normalize to instants and disambiguate both DST fold occurrences', () => {
  assert.deepEqual(interval(window), { start: '2026-09-10T15:00:00.000Z', end: '2026-09-10T16:00:00.000Z', timezone: window.timezone });
  const fold = interval({ start: '2026-11-01T01:15:00-05:00', end: '2026-11-01T01:15:00-06:00', timezone: 'America/Chicago' });
  assert.equal(Date.parse(fold.end) - Date.parse(fold.start), 3_600_000);
  assert.equal(interval({ start: '2026-09-10T00:00:00Z', end: '2026-09-10T01:00:00Z', timezone: 'UTC' }).start, '2026-09-10T00:00:00.000Z');
});

test('DST gaps, incorrect zone offsets, invalid calendar dates and inverted or unbounded intervals are rejected', () => {
  for (const value of [
    { start: '2026-03-08T02:15:00-06:00', end: '2026-03-08T03:30:00-05:00', timezone: 'America/Chicago' },
    { ...window, start: '2026-09-10T10:00:00-06:00' },
    { start: '2026-02-30T10:00:00Z', end: '2026-03-02T11:00:00Z', timezone: 'UTC' },
    { ...window, end: window.start }, { ...window, end: '2026-10-12T11:00:00-05:00' },
    { ...window, start: '2026-09-10T10:00:00' }, { ...window, timezone: 'Local' },
  ]) assert.throws(() => interval(value));
});

test('scheduling create schema requires explicit interval and resources and rejects actor/raw field injection and reserved keys', () => {
  for (const patch of [
    { start: undefined }, { end: undefined }, { timezone: undefined }, { resources: undefined }, { resources: [] },
    { companyID: 20 }, { creatorResourceID: 102 }, { raw_fields: {} }, { resources: [{ kind: 'self', id: 102 }] },
    { request_key: 'sch:reserved' }, { request_key: 'wf:reserved' }, { description: 'x'.repeat(2001) },
  ]) assert.equal(serviceCallCreateSchema.safeParse({ ...request('schema-schedule-01'), ...patch }).success, false);
});

test('search defaults to the employee and reports only scoped linked schedule entries', async () => {
  const s = setup();
  const result = await s.workflows.search(s.technician, { ...window, start: '2026-09-10T08:00:00-05:00' });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.data.entries.map(row => row.id), [5001]);
  assert.deepEqual(result.data.resources, [{ id: 101, label: 'Example Technician' }]);
  assert.match(result.warnings.join(' '), /not an atomic reservation/);
  assert.equal((await s.workflows.search(s.reader, window)).data.entries.length, 0);
  await assert.rejects(s.workflows.search(s.reader, { ...window, resources: [{ kind: 'id', id: 101 }] }), code('not_found_or_inaccessible'));
  s.port.records.tickets[0]!.ticketID = 2001;
  assert.equal((await s.workflows.search(s.technician, { ...window, start: '2026-09-10T08:00:00-05:00' })).data.entries.length, 0);
});

test('search pagination cursors are signed and bind interval, page size and current identity scope', async () => {
  const s = setup();
  s.port.records.calls.push({ ...s.port.records.calls[0]!, id: 5002 });
  s.port.records.tickets.push({ id: 6002, serviceCallID: 5002, ticketID: 1001 });
  s.port.records.resources.push({ id: 7002, serviceCallTicketID: 6002, resourceID: 101 });
  const query = { ...window, start: '2026-09-10T08:00:00-05:00', page_size: 1 };
  const first = await s.workflows.search(s.technician, query), cursor = first.completeness.next_cursor!;
  assert.equal(first.completeness.complete, false);
  assert.equal((await s.workflows.search(s.technician, { ...query, cursor })).data.entries[0]?.id, 5002);
  for (const patch of [{ cursor: `${cursor}x` }, { cursor, page_size: 2 }, { cursor, end: '2026-09-10T12:00:00-05:00' }]) await assert.rejects(s.workflows.search(s.technician, { ...query, ...patch }), code('invalid_input'));
  s.clock.value += 300_001;
  await assert.rejects(s.workflows.search(s.technician, { ...query, cursor }), code('invalid_input'));
});

test('create verifies parent then ticket then resources, journals opaque intent and replays without duplicating effects', async () => {
  const s = setup(), originalTicket = structuredClone(s.base.records.Tickets[0]), input = request('schedule-success-01');
  const result = await s.workflows.create(s.technician, input);
  assert.equal(result.status, 'succeeded_verified');
  assert.deepEqual(created(s), ['ServiceCalls', 'ServiceCallTickets', 'ServiceCallTicketResources']);
  assert.deepEqual(steps(result).map(step => step.state), ['succeeded_verified', 'succeeded_verified', 'succeeded_verified']);
  assert.equal(result.data.start, '2026-09-10T15:00:00.000Z');
  assert.equal(result.data.end, '2026-09-10T16:00:00.000Z');
  assert.equal(s.port.records.calls.at(-1)?.creatorResourceID, 101);
  assert.equal(s.port.records.calls.at(-1)?.description, input.description);
  assert.deepEqual(s.base.records.Tickets[0], originalTicket);
  const record = await s.journal.get(result.operation_id, actorKey(s.technician));
  assert.ok(record?.encryptedIntent);
  assert.doesNotMatch(JSON.stringify(record), /sensitive appointment facts/);
  assert.doesNotMatch(JSON.stringify(result), /sensitive appointment facts/);
  assert.equal(result.can_resume, false);
  assert.equal((await s.workflows.create(s.technician, input)).operation_id, result.operation_id);
  assert.equal(created(s).length, 3);
  await assert.rejects(s.workflows.create(s.technician, { ...input, end: '2026-09-10T12:00:00-05:00' }), code('conflict'));
});

test('eligible primary and secondary resources resolve by exact scoped name or ID with no assignee changes', async () => {
  const s = setup({ resources: [{ id: 101, label: 'Example Technician', active: true, companyIds: [10] }, { id: 103, label: 'Second Technician', active: true, companyIds: [10] }], secondaryResources: { 1001: [103] } });
  const result = await s.workflows.create(s.technician, { ...request('schedule-multi-01'), resources: [{ kind: 'name', name: 'example technician' }, { kind: 'id', id: 103, name: 'Second Technician' }] });
  assert.equal(result.status, 'succeeded_verified');
  assert.deepEqual(result.data.resource_ids, [101, 103]);
  assert.deepEqual(created(s), ['ServiceCalls', 'ServiceCallTickets', 'ServiceCallTicketResources', 'ServiceCallTicketResources']);
  assert.equal(s.base.calls.some(row => row.kind === 'patch'), false);
});

test('foreign, inactive, unassigned, duplicate and ambiguous resources fail before any scheduling create', async () => {
  const cases = [
    { refs: [{ kind: 'id', id: 102 }], options: {}, expected: 'not_found_or_inaccessible' },
    { refs: [{ kind: 'self' }], options: { resources: [{ id: 101, label: 'Example', active: false, companyIds: [10] }] }, expected: 'precondition_failed' },
    { refs: [{ kind: 'id', id: 103, name: 'Second Technician' }], options: { resources: [{ id: 103, label: 'Example', active: true, companyIds: [10] }] }, expected: 'precondition_failed' },
    { refs: [{ kind: 'self' }, { kind: 'id', id: 101 }], options: {}, expected: 'invalid_input' },
    { refs: [{ kind: 'name', name: 'Same name' }], options: { resources: [{ id: 101, label: 'Same name', active: true, companyIds: [10] }, { id: 103, label: 'Same name', active: true, companyIds: [10] }] }, expected: 'conflict' },
  ];
  for (const value of cases) {
    const s = setup(value.options);
    await assert.rejects(s.workflows.create(s.technician, { ...request('schedule-eligibility'), resources: value.refs }), code(value.expected));
    assert.deepEqual(created(s), []);
  }
});

test('overlaps require both explicit allowance and reviewed policy, while incomplete availability blocks creates', async () => {
  const s = setup(), input = { ...request('schedule-overlap-01'), start: '2026-09-10T09:30:00-05:00' };
  await assert.rejects(s.workflows.create(s.technician, input), code('precondition_failed'));
  await assert.rejects(s.workflows.create(s.technician, { ...input, overlap: 'allow' }), code('precondition_failed'));
  assert.deepEqual(created(s), []);
  const original = s.port.metadata.bind(s.port);
  s.port.metadata = async (...args) => ({ ...await original(...args), allowOverlap: true });
  assert.equal((await s.workflows.create(s.technician, { ...input, overlap: 'allow' })).status, 'succeeded_verified');
  const incomplete = setup(), search = incomplete.port.search.bind(incomplete.port);
  incomplete.port.search = async (...args) => ({ ...await search(...args), complete: false });
  await assert.rejects(incomplete.workflows.create(incomplete.technician, request('schedule-incomplete')), code('dependency_unavailable'));
  assert.deepEqual(created(incomplete), []);
});

test('unreviewed defaults, nonbookable status and stale bound metadata cannot create', async () => {
  for (const mutate of [
    (m: SchedulingMetadata) => { delete m.defaultStatusId; },
    (m: SchedulingMetadata) => { m.statuses[0]!.bookable = false; },
    (m: SchedulingMetadata) => { m.validUntil = new Date(0).toISOString(); },
    (m: SchedulingMetadata) => { m.resourceId = 102; },
  ]) {
    const s = setup(), original = s.port.metadata.bind(s.port);
    s.port.metadata = async (...args) => { const value = await original(...args); mutate(value); return value; };
    await assert.rejects(s.workflows.create(s.technician, request('schedule-metadata-01')), code('missing_metadata'));
    assert.deepEqual(created(s), []);
  }
});

test('all planned child journal rows are reserved and linked before the first upstream create', async () => {
  const s = setup(), original = s.port.createCall.bind(s.port);
  s.port.createCall = async (...args) => {
    const rows = s.journal.inspectAll(), root = rows.find(row => row.operation === 'service_call_create')!;
    assert.equal(root.state, 'dispatching');
    assert.equal((root.result?.scheduling_steps as unknown[]).length, 3);
    assert.equal(rows.length, 4);
    return original(...args);
  };
  assert.equal((await s.workflows.create(s.technician, request('schedule-journal-01'))).status, 'succeeded_verified');
});

test('ticket association rejection leaves a truthful partial receipt and resume never recreates the parent', async () => {
  const s = setup(), original = s.port.createTicket.bind(s.port); let count = 0;
  s.port.createTicket = async (...args) => { if (++count === 1) throw new AppError('invalid_input', 'Synthetic rejected association.'); return original(...args); };
  const first = await s.workflows.create(s.technician, request('schedule-ticket-fail'));
  assert.equal(first.status, 'partial'); assert.equal(first.can_resume, true);
  assert.deepEqual(steps(first).map(step => step.state), ['succeeded_verified', 'failed', 'ready']);
  assert.deepEqual(created(s), ['ServiceCalls']);
  const resumed = await s.workflows.resume(s.technician, { operation_id: first.operation_id });
  assert.equal(resumed.status, 'succeeded_verified');
  assert.equal(resumed.data.service_call_id, first.data.service_call_id);
  assert.equal(steps(resumed)[1]?.attempt, 2);
  assert.deepEqual(created(s), ['ServiceCalls', 'ServiceCallTickets', 'ServiceCallTicketResources']);
});

test('resource association rejection resumes only that association', async () => {
  const s = setup(), original = s.port.createResource.bind(s.port); let count = 0;
  s.port.createResource = async (...args) => { if (++count === 1) throw new AppError('precondition_failed', 'Synthetic unavailable resource.'); return original(...args); };
  const first = await s.workflows.create(s.technician, request('schedule-resource-fail'));
  assert.equal(first.status, 'partial');
  assert.equal((await s.workflows.resume(s.technician, { operation_id: first.operation_id })).status, 'succeeded_verified');
  assert.deepEqual(created(s), ['ServiceCalls', 'ServiceCallTickets', 'ServiceCallTicketResources']);
});

test('uncertain create without returned ID blocks dependent effects, resume and blind reconciliation', async () => {
  const s = setup(), original = s.port.createCall.bind(s.port);
  s.port.createCall = async (...args) => { await original(...args); throw new AppError('unknown_outcome', 'Synthetic lost response.'); };
  const first = await s.workflows.create(s.technician, request('schedule-unknown-01'));
  assert.equal(first.status, 'unknown_outcome'); assert.equal(first.needs_manual_review, true);
  assert.equal(steps(first)[0]?.native_id, undefined);
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: first.operation_id }), code('conflict'));
  assert.equal((await s.workflows.reconcile(s.technician, { operation_id: first.operation_id })).status, 'unknown_outcome');
  assert.deepEqual(created(s), ['ServiceCalls']);
});

test('accepted parent readback failure reconciles its recorded ID then resumes only undispatched associations', async () => {
  const s = setup(), original = s.port.getCall.bind(s.port); let unavailable = true;
  s.port.getCall = async (...args) => { if (unavailable && args[1] !== 5001) throw new AppError('dependency_unavailable', 'Synthetic readback outage.'); return original(...args); };
  const first = await s.workflows.create(s.technician, request('schedule-reconcile-01'));
  assert.equal(first.status, 'accepted_unverified'); assert.ok(steps(first)[0]?.native_id);
  unavailable = false;
  const reconciled = await s.workflows.reconcile(s.technician, { operation_id: first.operation_id });
  assert.equal(reconciled.status, 'partial'); assert.equal(reconciled.can_resume, true);
  assert.deepEqual(created(s), ['ServiceCalls']);
  assert.equal((await s.workflows.resume(s.technician, { operation_id: first.operation_id })).status, 'succeeded_verified');
  assert.deepEqual(created(s), ['ServiceCalls', 'ServiceCallTickets', 'ServiceCallTicketResources']);
});

test('readback attribution and relationship mismatches never prove success or dispatch dependent records', async () => {
  for (const field of ['creatorResourceID', 'companyID', 'status', 'startDateTime']) {
    const s = setup(), original = s.port.getCall.bind(s.port);
    s.port.getCall = async (...args) => ({ ...await original(...args), [field]: field === 'startDateTime' ? '2026-09-10T20:00:00Z' : 999 });
    const result = await s.workflows.create(s.technician, request(`schedule-proof-${field}`));
    assert.equal(result.status, 'accepted_unverified');
    assert.deepEqual(created(s), ['ServiceCalls']);
    assert.equal((await s.workflows.reconcile(s.technician, { operation_id: result.operation_id })).status, 'accepted_unverified');
  }
  const s = setup(), original = s.port.getTicket.bind(s.port);
  s.port.getTicket = async (...args) => ({ ...await original(...args), ticketID: 999 });
  assert.equal((await s.workflows.create(s.technician, request('schedule-ticket-proof'))).status, 'accepted_unverified');
  assert.deepEqual(created(s), ['ServiceCalls', 'ServiceCallTickets']);
});

test('all child effects verified but failed root commit reports saved effects and reconciles without creates', async () => {
  const s = setup(), transition = s.journal.transition.bind(s.journal); let failed = false;
  s.journal.transition = async (id, expected, next, result) => {
    if (!failed && next === 'succeeded_verified' && s.journal.inspectAll().find(row => row.id === id)?.operation === 'service_call_create') { failed = true; throw new Error('Synthetic root commit outage.'); }
    return transition(id, expected, next, result);
  };
  const first = await s.workflows.create(s.technician, request('schedule-root-commit'));
  assert.equal(first.status, 'unknown_outcome');
  assert.match(first.receipt, /All scheduling records were saved and verified/);
  assert.equal((await s.workflows.reconcile(s.technician, { operation_id: first.operation_id })).status, 'succeeded_verified');
  assert.equal(created(s).length, 3);
});

test('current actor, capability, company scope and unchanged intent are required for continuation', async () => {
  const s = setup(); s.port.createTicket = async () => { throw new AppError('invalid_input', 'Synthetic rejected association.'); };
  const first = await s.workflows.create(s.technician, request('schedule-scope-01'));
  await assert.rejects(s.workflows.status(s.reader, { operation_id: first.operation_id }), code('not_found_or_inaccessible'));
  await assert.rejects(s.workflows.create(s.reader, request('schedule-reader-01')), code('forbidden'));
  s.port.resourceDirectory[0]!.active = false;
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: first.operation_id }), code('precondition_failed'));
  s.store.set({ ...s.technician, capabilities: ['operational.read'] });
  await assert.rejects(s.workflows.resume(s.technician, { operation_id: first.operation_id }));
  assert.equal(created(s).length, 1);
});

const NOW = Date.parse('2026-09-10T18:00:00.000Z');
const baseUrl = 'https://webservices3.autotask.net/atservicesrest/v1.0/';
const operations: SchedulingOperation[] = ['Resources.query', 'ServiceCalls.metadata', 'ServiceCalls.query', 'ServiceCalls.get', 'ServiceCalls.create', 'ServiceCallTickets.query', 'ServiceCallTickets.get', 'ServiceCallTickets.create', 'ServiceCallTicketResources.query', 'ServiceCallTicketResources.get', 'ServiceCallTicketResources.create'];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
type Seen = { url: URL; init: RequestInit };
const callPayload = { companyID: 10, startDateTime: '2026-09-10T15:00:00.000Z', endDateTime: '2026-09-10T16:00:00.000Z', status: 801, description: 'Fictitious appointment.' };
function httpSetup(handler?: (request: Seen) => Response | Promise<Response>, overrides: Partial<HttpSchedulingOptions> = {}) {
  const s = setup(), p = { ...s.technician, resourceVerifiedAt: new Date(NOW).toISOString() }, seen: Seen[] = [];
  s.store.set(p);
  const qualifications: SchedulingQualification[] = operations.map(operation => ({ operation, evidenceSource: 'live', headerAccepted: true, permissionEnforced: true, nativeAttribution: true, tenantId: p.tenantId, policyVersion: p.policyVersion, resourceIds: [p.resourceId], testIds: ['allow', 'deny'], qualifiedAt: new Date(NOW - 1_000).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString(), evidenceReference: 'Synthetic unit-test evidence only; never deployment configuration.' }));
  const metadata: SchedulingMetadata = { version: 'test-scheduling-v1', source: 'Autotask', tenantId: p.tenantId, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, ticketId: 1001, companyId: 10, validUntil: new Date(NOW + 60_000).toISOString(), ticketResourceIds: [101], statuses: [{ id: 801, label: 'Scheduled', active: true, bookable: true }], defaultStatusId: 801, allowOverlap: false, attributionField: 'creatorResourceID' };
  // The base ticket read is stubbed locally too; no actual Autotask calls are possible.
  s.base.get = async (_principal, entity, id) => { assert.equal(entity, 'Tickets'); return { id, companyID: id === 1001 ? 10 : 20, assignedResourceID: 101 }; };
  const fetcher: typeof fetch = async (input, init) => {
    const request = { url: new URL(String(input)), init: init ?? {} }; seen.push(request);
    if (handler) return handler(request);
    const path = request.url.pathname;
    if (request.init.method === 'POST') return json({ itemId: path.endsWith('/Resources') ? 7002 : path.endsWith('/Tickets') ? 6002 : 5002 });
    if (path.endsWith('/Resources/7002')) return json({ item: { id: 7002, serviceCallTicketID: 6002, resourceID: 101 } });
    if (path.endsWith('/Tickets/6002') || path.endsWith('/ServiceCallTickets/6002')) return json({ item: { id: 6002, serviceCallID: 5002, ticketID: 1001 } });
    return json({ item: { id: 5002, ...callPayload, creatorResourceID: 101, isComplete: 0 } });
  };
  const port = new HttpSchedulingPort(s.base, { baseUrl, username: 'server-user', secret: 'server-secret', integrationCode: 'server-integration', qualifications, revalidatePrincipal: async value => value, resolveResources: async () => [{ id: 101, label: 'Example Technician', active: true, companyIds: [10] }], resolveMetadata: async () => metadata, fetch: fetcher, now: () => NOW, ...overrides });
  return { ...s, p, http: port, seen, qualifications, metadata };
}
const posts = (seen: Seen[]) => seen.filter(row => row.init.method === 'POST');

test('live scheduling is disabled without exact live permission evidence, native attribution and authoritative providers', async () => {
  for (const overrides of [{ qualifications: [] }, { qualifications: operations.map(operation => ({ operation, evidenceSource: 'fixture' })) as SchedulingQualification[] }, { revalidatePrincipal: undefined }]) {
    const s = httpSetup(undefined, overrides);
    await assert.rejects(s.http.createCall(s.p, 1001, callPayload));
    assert.equal(s.seen.length, 0);
  }
  const s = httpSetup(undefined, { resolveMetadata: undefined });
  await assert.rejects(s.http.createCall(s.p, 1001, callPayload), code('missing_metadata'));
  assert.equal(s.seen.length, 0);
});

test('live create and readback use exact routes and only impersonate supported entities', async () => {
  const s = httpSetup();
  assert.deepEqual(await s.http.createCall(s.p, 1001, callPayload), { id: 5002 });
  assert.deepEqual(await s.http.createTicket(s.p, 5002, 1001), { id: 6002 });
  assert.deepEqual(await s.http.createResource(s.p, 6002, 101), { id: 7002 });
  assert.equal((await s.http.getTicket(s.p, 5002, 6002)).ticketID, 1001);
  assert.equal((await s.http.getResource(s.p, 6002, 7002)).resourceID, 101);
  assert.deepEqual(posts(s.seen).map(row => row.url.href), [`${baseUrl}ServiceCalls`, `${baseUrl}ServiceCalls/5002/Tickets`, `${baseUrl}ServiceCallTickets/6002/Resources`]);
  assert.deepEqual(posts(s.seen).map(row => JSON.parse(String(row.init.body))), [callPayload, { serviceCallID: 5002, ticketID: 1001 }, { serviceCallTicketID: 6002, resourceID: 101 }]);
  for (const row of s.seen) {
    const route = row.url.pathname.slice(new URL(baseUrl).pathname.length);
    const supported = /^ServiceCalls(?:\/\d+)?$/.test(route);
    assert.equal((row.init.headers as Record<string, string>).ImpersonationResourceId, supported ? '101' : undefined, route);
    assert.equal(row.init.redirect, 'manual');
  }
});

test('live scheduling creates never replay transport errors, throttling, HTTP failure, timeout or malformed created IDs', async () => {
  for (const [handler, expected] of [
    [() => { throw new Error('Lost response'); }, 'unknown_outcome'],
    [() => json({}, 503), 'unknown_outcome'], [() => json({}, 429), 'throttled'],
    [() => new Promise<Response>(() => {}), 'unknown_outcome'],
    ...[{}, { itemId: 0 }, { itemId: '5002' }, { itemId: Number.MAX_SAFE_INTEGER + 1 }].map(value => [() => json(value), 'unknown_outcome'] as const),
  ] as const) {
    const s = httpSetup(handler, { timeoutMs: 10 });
    await assert.rejects(s.http.createCall(s.p, 1001, callPayload), code(expected));
    assert.equal(posts(s.seen).length, 1);
  }
});

test('live payload and relationship validation block raw fields, foreign companies and ineligible resources', async () => {
  const s = httpSetup();
  await assert.rejects(s.http.createCall(s.p, 1001, { ...callPayload, creatorResourceID: 102 } as typeof callPayload));
  await assert.rejects(s.http.createCall(s.p, 1001, { ...callPayload, companyID: 20 }), code('precondition_failed'));
  await assert.rejects(s.http.createTicket(s.p, 5002, 2001), code('not_found_or_inaccessible'));
  await assert.rejects(s.http.createResource(s.p, 6002, 102), code('precondition_failed'));
  assert.equal(posts(s.seen).length, 0);
});

test('live child readbacks enforce requested IDs and exact parent relationships', async () => {
  for (const broken of [{ id: 6003, serviceCallID: 5002, ticketID: 1001 }, { id: 6002, serviceCallID: 5999, ticketID: 1001 }, { id: 6002, serviceCallID: 5002, ticketID: 2001 }]) {
    const s = httpSetup(({ url }) => url.pathname.endsWith('/ServiceCalls/5002') ? json({ item: { id: 5002, ...callPayload } }) : json({ item: broken }));
    await assert.rejects(s.http.getTicket(s.p, 5002, 6002));
    assert.equal(posts(s.seen).length, 0);
  }
});

test('live scoped search joins service calls, ticket links and resource links with server filters', async () => {
  const s = httpSetup(({ url }) => json({ items: url.pathname.endsWith('/ServiceCalls/query') ? [{ id: 5002, ...callPayload, isComplete: 0 }] : url.pathname.endsWith('/ServiceCallTickets/query') ? [{ id: 6002, serviceCallID: 5002, ticketID: 1001 }] : [{ id: 7002, serviceCallTicketID: 6002, resourceID: 101 }], pageDetails: { nextPageUrl: null } }));
  const result = await s.http.search(s.p, { start: callPayload.startDateTime, end: callPayload.endDateTime, resourceIds: [101] });
  assert.equal(result.complete, true); assert.deepEqual(result.items.map(row => row.id), [5002]);
  assert.deepEqual(JSON.parse(String(s.seen[0]?.init.body)).filter, [{ field: 'companyID', op: 'in', value: [10] }, { field: 'startDateTime', op: 'lt', value: callPayload.endDateTime }, { field: 'endDateTime', op: 'gt', value: callPayload.startDateTime }]);
});

test('live continuation rejects external URLs and bounds total association fan-out', async () => {
  const bad = httpSetup(() => json({ items: [{ id: 5002, ...callPayload }], pageDetails: { nextPageUrl: 'https://untrusted.invalid/query/next?paging=x' } }));
  await assert.rejects(bad.http.search(bad.p, { start: callPayload.startDateTime, end: callPayload.endDateTime, resourceIds: [101] }), code('dependency_unavailable'));
  assert.equal(bad.seen.length, 1);
  const s = httpSetup(({ url, init }) => {
    if (url.pathname.endsWith('/ServiceCalls/query')) return json({ items: Array.from({ length: 100 }, (_, index) => ({ id: 5000 + index, ...callPayload })), pageDetails: { nextPageUrl: null } });
    const parent = JSON.parse(String(init.body)).filter[0].value;
    return json({ items: url.pathname.endsWith('/ServiceCallTickets/query') ? [{ id: parent + 1000, serviceCallID: parent, ticketID: 1001 }] : [{ id: parent + 1000, serviceCallTicketID: parent, resourceID: 101 }], pageDetails: { nextPageUrl: null } });
  });
  const result = await s.http.search(s.p, { start: callPayload.startDateTime, end: callPayload.endDateTime, resourceIds: [101] });
  assert.equal(result.complete, false); assert.ok(s.seen.length <= 60); assert.ok(result.items.length < 100);
});

test('live scheduling rechecks identity and reviewed metadata after waiting for shared request capacity', async () => {
  for (const change of ['identity', 'metadata'] as const) {
    let revoked = false;
    const s = httpSetup(undefined, { revalidatePrincipal: async p => revoked ? { ...p, active: false } : p });
    const first = await requestScheduler.acquire(actorKey(s.p), 1000), second = await requestScheduler.acquire(actorKey(s.p), 1000);
    try {
      const pending = s.http.createCall(s.p, 1001, callPayload);
      await new Promise<void>(resolve => setImmediate(resolve));
      if (change === 'identity') revoked = true; else s.metadata.version = 'changed-before-dispatch';
      first();
      await assert.rejects(pending, code(change === 'identity' ? 'identity_mapping_invalid' : 'conflict'));
      assert.equal(s.seen.length, 0);
    } finally { first(); second(); }
  }
});

test('scheduling rejects valid employee IDs with missing or wrong intended names before creating anything',async()=>{
 for(const name of [undefined,'Wrong Employee']){
  const s=setup();await assert.rejects(s.workflows.create(s.technician,{...request('schedule-identity-check'),resources:[{kind:'id',id:101,...(name?{name}:{})}]}),code(name?'conflict':'invalid_input'));
  assert.deepEqual(created(s),[]);
 }
});
