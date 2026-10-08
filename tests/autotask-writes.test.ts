import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, type Principal, type TicketNoteCreate, type TicketTimeCreate, type TicketWorkMetadata } from '../packages/contracts/src/index.js';
import { HttpAutotaskAdapter, type AutotaskOperation, type HttpAutotaskAdapterOptions, type OperationQualification } from '../packages/autotask/src/index.js';
import { MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals, fixtureWorkMetadata } from '../packages/workflows/src/fixtures.js';

const NOW = Date.parse('2026-09-10T18:00:00.000Z');
const baseUrl = 'https://webservices3.autotask.net/atservicesrest/v1.0/';
const principal: Principal = { tenantId: 'tenant', objectId: 'employee', resourceId: 42, mappingVersion: 1, policyVersion: 'policy-v1', companyIds: [10], capabilities: ['operational.read', 'tickets.write', 'time.self'], active: true, resourceVerifiedAt: new Date(NOW).toISOString() };
const operations: AutotaskOperation[] = ['Tickets.get', 'TicketNotes.create', 'TicketNotes.get', 'TimeEntries.create', 'TimeEntries.get'];
const qualifications: OperationQualification[] = operations.map((operation) => ({ operation, evidenceSource: 'live', headerAccepted: true, permissionEnforced: true, nativeAttribution: true, testIds: ['allow-case', 'deny-case'], resourceIds: [42], tenantId: 'tenant', policyVersion: 'policy-v1', qualifiedAt: new Date(NOW - 1_000).toISOString(), expiresAt: new Date(NOW + 86_400_000).toISOString(), evidenceReference: 'synthetic live-shaped test evidence; never deployment configuration' }));
const note: TicketNoteCreate = { description: 'Fictitious internal observation.', title: 'Example work', noteType: 10, publish: 20 };
const time: TicketTimeCreate = { resourceID: 42, roleID: 30, billingCodeID: 40, hoursWorked: 0.5, dateWorked: '2026-09-10T00:00:00Z', summaryNotes: 'Fictitious customer-safe summary.', internalNotes: 'Fictitious internal diagnostic detail.' };
const metadata = (): TicketWorkMetadata => ({
  version: 'qualified-test-v1', source: 'Autotask', ticketId: 100, resourceId: 42, mappingVersion: 1, policyVersion: 'policy-v1', validUntil: new Date(NOW + 60_000).toISOString(), defaultRuleVersion: 'reviewed-test-v1',
  note: { titleRequired: true, attributionField: 'creatorResourceID', types: [{ id: 10, label: 'Fictitious note type', active: true }], audiences: [{ audience: 'internal', publish: 20, label: 'Fictitious internal audience', active: true }, { audience: 'customer', publish: 21, label: 'Fictitious customer audience', active: true }], defaultTypeId: 10 },
  time: { eligible: true, roles: [{ id: 30, label: 'Fictitious resource role', active: true }], workTypes: [{ id: 40, label: 'Fictitious work type', active: true }], defaultRoleId: 30, defaultWorkTypeId: 40 },
});
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const ticket = () => ({ item: { id: 100, companyID: 10, status: 1 } });
type Seen = { url: URL; init: RequestInit };
function harness(handler: (request: Seen, index: number) => Response | Promise<Response> = (request) => request.url.pathname.endsWith('/Tickets/100') ? json(ticket()) : json({ itemId: 900 }), options: Partial<HttpAutotaskAdapterOptions> = {}) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = { url: new URL(String(input)), init: init ?? {} };
    seen.push(request);
    return handler(request, seen.length - 1);
  };
  const adapter = new HttpAutotaskAdapter({ baseUrl, username: 'server-user', secret: 'server-secret', integrationCode: 'server-integration', cursorSecret: 'cursor-secret-longer-than-thirty-two-bytes', qualifications, fetch: fetcher, now: () => NOW, sleep: async () => {}, revalidatePrincipal: async (p) => p, resolveTicketWorkMetadata: async () => metadata(), validateTicketTimeEligibility: async () => true, ...options });
  return { adapter, seen };
}
const code = (expected: string) => (error: unknown): boolean => error instanceof AppError && error.code === expected;
const creates = (seen: Seen[]) => seen.filter((request) => request.init.method === 'POST');

test('new live operations require their own live permission and native-attribution qualification', async () => {
  for (const evidence of [[], qualifications.map((q) => ({ ...q, evidenceSource: 'fixture' as const })), qualifications.map((q) => ({ ...q, nativeAttribution: false }))]) {
    const { adapter, seen } = harness(undefined, { qualifications: evidence });
    await assert.rejects(adapter.createTicketNote(principal, 100, note), code('impersonation_not_qualified'));
    await assert.rejects(adapter.createTicketTime(principal, 100, time), code('impersonation_not_qualified'));
    assert.equal(seen.length, 0);
  }
});

test('create uses documented note child and time root routes with strict separate bodies and employee headers', async () => {
  const { adapter, seen } = harness();
  assert.deepEqual(await adapter.createTicketNote(principal, 100, note), { id: 900 });
  assert.deepEqual(await adapter.createTicketTime(principal, 100, time), { id: 900 });
  const writes = creates(seen);
  assert.equal(writes[0]?.url.href, `${baseUrl}Tickets/100/Notes`);
  assert.deepEqual(JSON.parse(String(writes[0]?.init.body)), { ticketID: 100, ...note });
  assert.equal(writes[1]?.url.href, `${baseUrl}TimeEntries`);
  assert.deepEqual(JSON.parse(String(writes[1]?.init.body)), { ticketID: 100, ...time });
  for (const request of seen) {
    assert.equal((request.init.headers as Record<string, string>).ImpersonationResourceId, '42');
    assert.equal(request.init.redirect, 'manual');
  }
  assert.equal(Object.hasOwn(JSON.parse(String(writes[1]?.init.body)), 'startDateTime'), false);
});

test('secondary-resource relationship mutations use parent child routes and the API-user identity', async () => {
  const relationship = { id: 901, ticketID: 100, resourceID: 55, roleID: 77 };
  const applicationWrites = { tenantId: 'tenant', operations: ['TicketSecondaryResources.create', 'TicketSecondaryResources.get', 'TicketSecondaryResources.delete'] } as const;
  const requestBudget = { take: async () => {}, status: () => ({ configured: true, mode: 'fixture' as const, blocked: null, queued: 0, admitted: 0, rejected: 0 }) };
  const { adapter, seen } = harness((request) => {
    if (request.init.method === 'POST') return json({ itemId: relationship.id });
    if (request.init.method === 'DELETE') return new Response(null, { status: 204 });
    return json({ item: relationship });
  }, { applicationWrites, requestBudget });
  assert.deepEqual(await adapter.createTicketSecondaryResource(principal, 100, 55, 77, async () => {}), { id: relationship.id });
  assert.deepEqual(await adapter.getTicketSecondaryResource(principal, 100, relationship.id), relationship);
  await adapter.deleteTicketSecondaryResource(principal, 100, relationship.id, async () => {});
  assert.equal(seen[0]?.url.href, `${baseUrl}Tickets/100/SecondaryResources`);
  assert.equal(seen[0]?.init.method, 'POST');
  assert.equal((seen[0]?.init.headers as Record<string, string>).ImpersonationResourceId, undefined);
  assert.equal(seen[1]?.url.href, `${baseUrl}Tickets/100/SecondaryResources/901`);
  assert.equal((seen[1]?.init.headers as Record<string, string>).ImpersonationResourceId, undefined);
  assert.equal(seen[2]?.url.href, `${baseUrl}Tickets/100/SecondaryResources/901`);
  assert.equal(seen[2]?.init.method, 'DELETE');
  assert.equal((seen[2]?.init.headers as Record<string, string>).ImpersonationResourceId, undefined);
});

test('ticket tags and checklist libraries use native child routes without impersonation or replay', async () => {
  const applicationWrites = { tenantId: 'tenant', operations: ['TicketTagAssociations.create', 'TicketTagAssociations.delete', 'TicketChecklistLibraries.create'] } as const;
  const requestBudget = { take: async () => {}, status: () => ({ configured: true, mode: 'fixture' as const, blocked: null, queued: 0, admitted: 0, rejected: 0 }) };
  const { adapter, seen } = harness((request) => request.init.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ itemId: 901 }), { applicationWrites, requestBudget });
  assert.deepEqual(await adapter.createTicketTagAssociation(principal, 100, 71, async () => {}), { id: 901 });
  await adapter.deleteTicketTagAssociation(principal, 100, 901, async () => {});
  assert.deepEqual(await adapter.applyTicketChecklistLibrary(principal, 100, 72, async () => {}), { id: 901 });
  assert.deepEqual(seen.map(request => [request.init.method, request.url.href]), [
    ['POST', `${baseUrl}Tickets/100/TagAssociations`],
    ['DELETE', `${baseUrl}Tickets/100/TagAssociations/901`],
    ['POST', `${baseUrl}Tickets/100/ChecklistLibraries`],
  ]);
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { tagID: 71, ticketID: 100 });
  assert.deepEqual(JSON.parse(String(seen[2]!.init.body)), { checklistLibraryID: 72, ticketID: 100 });
  for (const request of seen) assert.equal((request.init.headers as Record<string, string>).ImpersonationResourceId, undefined);
  const uncertain = harness(() => { throw new Error('connection closed'); }, { applicationWrites, requestBudget });
  await assert.rejects(uncertain.adapter.createTicketTagAssociation(principal, 100, 71, async () => {}), code('unknown_outcome'));
  assert.equal(uncertain.seen.length, 1);
});

test('server-qualified zero publish values and maximum note text are preserved', async () => {
  const value = metadata(); value.note.audiences[0]!.publish = 0;
  const { adapter, seen } = harness(undefined, { resolveTicketWorkMetadata: async () => value });
  const payload = { ...note, publish: 0, description: 'x'.repeat(32_000), title: 'x'.repeat(250) };
  assert.deepEqual(await adapter.createTicketNote(principal, 100, payload), { id: 900 });
  assert.deepEqual(JSON.parse(String(creates(seen)[0]?.init.body)), { ticketID: 100, ...payload });
});

test('POST creates never replay on transport uncertainty, retryable HTTP failure, or timeout', async () => {
  const failures: Array<(request: Seen) => Response | Promise<Response>> = [
    () => { throw new Error('Connection closed after possible commit'); },
    () => json({}, 503),
    () => new Promise<Response>(() => {}),
  ];
  for (const fail of failures) {
    for (const operation of ['note', 'time'] as const) {
      const { adapter, seen } = harness((request) => request.init.method === 'POST' ? fail(request) : json(ticket()), { timeoutMs: 10 });
      await assert.rejects(operation === 'note' ? adapter.createTicketNote(principal, 100, note) : adapter.createTicketTime(principal, 100, time), code('unknown_outcome'));
      assert.equal(creates(seen).length, 1);
    }
  }
});

test('success responses with absent, malformed, or unsafe created IDs remain unknown and never replay', async () => {
  for (const response of [{}, { itemId: null }, { itemId: '900' }, { itemId: 0 }, { itemId: Number.MAX_SAFE_INTEGER + 1 }]) {
    const { adapter, seen } = harness((request) => request.init.method === 'POST' ? json(response) : json(ticket()));
    await assert.rejects(adapter.createTicketNote(principal, 100, note), code('unknown_outcome'));
    assert.equal(creates(seen).length, 1);
  }
});

test('an explicit create rejection is definitive and does not retry', async () => {
  for (const [status, expected] of [[400, 'invalid_input'], [403, 'forbidden'], [409, 'conflict'], [429, 'throttled']] as const) {
    const { adapter, seen } = harness((request) => request.init.method === 'POST' ? json({}, status) : json(ticket()));
    await assert.rejects(adapter.createTicketTime(principal, 100, time), code(expected));
    assert.equal(creates(seen).length, 1);
  }
});

test('metadata is required, server-bound and current before writes', async () => {
  const mutations: Array<(value: TicketWorkMetadata) => void> = [
    (value) => { value.source = 'fixture'; },
    (value) => { value.version = ''; },
    (value) => { value.validUntil = new Date(NOW).toISOString(); },
    (value) => { value.resourceId++; },
    (value) => { value.ticketId++; },
    (value) => { value.mappingVersion++; },
    (value) => { value.policyVersion = 'other'; },
    (value) => { value.note.audiences[1]!.publish = value.note.audiences[0]!.publish; },
    (value) => { value.time.roles[0]!.label = ''; },
    (value) => { value.time.defaultRoleId = 777; },
  ];
  for (const mutate of mutations) {
    const value = metadata(); mutate(value);
    const { adapter, seen } = harness(undefined, { resolveTicketWorkMetadata: async () => value });
    await assert.rejects(adapter.createTicketNote(principal, 100, note), code('missing_metadata'));
    assert.equal(creates(seen).length, 0);
  }
  const { adapter, seen } = harness(undefined, { resolveTicketWorkMetadata: undefined });
  await assert.rejects(adapter.ticketWorkMetadata(principal, 100), code('missing_metadata'));
  await assert.rejects(adapter.createTicketTime(principal, 100, time), code('missing_metadata'));
  assert.equal(seen.length, 0);
});

test('metadata preflight and create both require scoped ticket read authorization', async () => {
  const { adapter, seen } = harness(() => json({ item: { id: 100, companyID: 999 } }));
  await assert.rejects(adapter.ticketWorkMetadata(principal, 100), code('not_found_or_inaccessible'));
  await assert.rejects(adapter.createTicketNote(principal, 100, note), code('not_found_or_inaccessible'));
  assert.equal(creates(seen).length, 0);
  const unqualified = harness(undefined, { qualifications: qualifications.filter((q) => q.operation !== 'Tickets.get') });
  await assert.rejects(unqualified.adapter.ticketWorkMetadata(principal, 100), code('impersonation_not_qualified'));
  assert.equal(unqualified.seen.length, 0);
});

test('unknown note fields and invalid lengths/IDs are rejected before metadata or network calls', async () => {
  const invalid: unknown[] = [
    { ...note, createdByContactID: 33 }, { ...note, ticketID: 999 }, { ...note, description: '' },
    { ...note, description: 'x'.repeat(32_001) }, { ...note, title: 'x'.repeat(251) },
    { ...note, publish: '20' }, { ...note, noteType: -1 },
  ];
  const { adapter, seen } = harness();
  for (const payload of invalid) await assert.rejects(adapter.createTicketNote(principal, 100, payload as TicketNoteCreate), code('invalid_input'));
  assert.equal(seen.length, 0);
});

test('time rejects invalid duration/date, attribution changes, internal/financial overrides and fabricated intervals', async () => {
  const invalid: unknown[] = [
    { ...time, hoursWorked: 0 }, { ...time, hoursWorked: 24.01 }, { ...time, hoursWorked: NaN },
    { ...time, summaryNotes: ' ' }, { ...time, summaryNotes: 'x'.repeat(32_001) },
    { ...time, dateWorked: '2026-02-30T00:00:00Z' }, { ...time, dateWorked: '2026-09-10T12:00:00Z' },
    { ...time, dateWorked: '2026-09-10' }, { ...time, startDateTime: time.dateWorked },
    { ...time, isNonBillable: false }, { ...time, contractID: 123 }, { ...time, hourlyBillingRate: 0 },
    { ...time, internalNotes: null }, { ...time, internalNotes: 30 },
    { ...time, internalNotes: 'x'.repeat(32_001) }, { ...time, internalBillingCodeID: 77 },
  ];
  const { adapter, seen } = harness();
  for (const payload of invalid) await assert.rejects(adapter.createTicketTime(principal, 100, payload as TicketTimeCreate), code('invalid_input'));
  await assert.rejects(adapter.createTicketTime({ ...principal, capabilities: [...principal.capabilities, 'time.team'] }, 100, { ...time, resourceID: 43 }), code('forbidden'));
  assert.equal(seen.length, 0);
});

test('note title, audience/type and time role/work-type eligibility are enforced before creates', async () => {
  const { adapter, seen } = harness();
  await assert.rejects(adapter.createTicketNote(principal, 100, { ...note, title: undefined }), code('precondition_failed'));
  await assert.rejects(adapter.createTicketNote(principal, 100, { ...note, publish: 777 }), code('precondition_failed'));
  await assert.rejects(adapter.createTicketNote(principal, 100, { ...note, noteType: 777 }), code('precondition_failed'));
  await assert.rejects(adapter.createTicketTime(principal, 100, { ...time, roleID: 777 }), code('precondition_failed'));
  await assert.rejects(adapter.createTicketTime(principal, 100, { ...time, billingCodeID: 777 }), code('precondition_failed'));
  assert.equal(creates(seen).length, 0);
  const ineligible = metadata(); ineligible.time.eligible = false;
  const locked = harness(undefined, { resolveTicketWorkMetadata: async () => ineligible });
  await assert.rejects(locked.adapter.createTicketTime(principal, 100, time), code('precondition_failed'));
  assert.equal(creates(locked.seen).length, 0);
});

test('metadata drift under the same version is rechecked after acquiring create capacity', async () => {
  for (const operation of ['note', 'time'] as const) {
    let calls = 0;
    const { adapter, seen } = harness(undefined, { resolveTicketWorkMetadata: async () => {
      const value = metadata();
      if (++calls > 1) value.time.eligible = false;
      return value;
    } });
    await assert.rejects(operation === 'note' ? adapter.createTicketNote(principal, 100, note) : adapter.createTicketTime(principal, 100, time), code('conflict'));
    assert.equal(calls, 2);
    assert.equal(creates(seen).length, 0);
  }
});

test('policy revoked during metadata recheck prevents dispatch', async () => {
  let metadataCalls = 0, revoked = false;
  const { adapter, seen } = harness(undefined, {
    resolveTicketWorkMetadata: async () => { if (++metadataCalls === 2) revoked = true; return metadata(); },
    revalidatePrincipal: async (p) => revoked ? { ...p, capabilities: ['operational.read'] } : p,
  });
  await assert.rejects(adapter.createTicketNote(principal, 100, note), code('identity_mapping_invalid'));
  assert.equal(creates(seen).length, 0);
});

test('metadata expiry while the final identity check waits prevents dispatch', async () => {
  let metadataCalls = 0, now = NOW, advance = false;
  const { adapter, seen } = harness(undefined, {
    now: () => now, identityFreshnessMs: 300_000,
    resolveTicketWorkMetadata: async () => { if (++metadataCalls === 2) advance = true; return metadata(); },
    revalidatePrincipal: async (p) => { if (advance) now = NOW + 60_000; return p; },
  });
  await assert.rejects(adapter.createTicketNote(principal, 100, note), code('conflict'));
  assert.equal(creates(seen).length, 0);
});

test('a date-aware live time validator is required and receives the immutable proposed payload', async () => {
  const absent = harness(undefined, { validateTicketTimeEligibility: undefined });
  await assert.rejects(absent.adapter.createTicketTime(principal, 100, time), code('missing_metadata'));
  assert.equal(creates(absent.seen).length, 0);
  let validated = false;
  const present = harness(undefined, { validateTicketTimeEligibility: async (p, ticketId, payload) => {
    assert.equal(p.resourceId, principal.resourceId);
    assert.equal(ticketId, 100);
    assert.equal(Object.isFrozen(payload), true);
    assert.deepEqual(payload, time);
    assert.notEqual(payload, time);
    validated = true;
    return true;
  } });
  await present.adapter.createTicketTime(principal, 100, time);
  assert.equal(validated, true);
  assert.equal(creates(present.seen).length, 1);
});

test('false or failing time eligibility validation does not create or expose validator error details', async () => {
  const denied = harness(undefined, { validateTicketTimeEligibility: async () => false });
  await assert.rejects(denied.adapter.createTicketTime(principal, 100, time), code('precondition_failed'));
  assert.equal(creates(denied.seen).length, 0);
  const unavailable = harness(undefined, { validateTicketTimeEligibility: async () => { throw new Error('private tenant directory detail and credential'); } });
  await assert.rejects(unavailable.adapter.createTicketTime(principal, 100, time), (error: unknown) => error instanceof AppError
    && error.code === 'dependency_unavailable' && !error.message.includes('private') && !error.message.includes('credential'));
  assert.equal(creates(unavailable.seen).length, 0);
});

test('time eligibility validation starts only after a queued create acquires capacity', async () => {
  let releaseMetadata!: () => void, releaseReads!: () => void;
  const metadataGate = new Promise<void>((resolve) => { releaseMetadata = resolve; });
  const readGate = new Promise<void>((resolve) => { releaseReads = resolve; });
  let metadataCalls = 0, blockedReads = 0, blockReads = false, validations = 0;
  const { adapter, seen } = harness(async (request) => {
    if (request.init.method === 'POST') return json({ itemId: 900 });
    if (blockReads) { blockedReads++; await readGate; }
    return json(ticket());
  }, { resolveTicketWorkMetadata: async () => { if (++metadataCalls === 1) await metadataGate; return metadata(); }, validateTicketTimeEligibility: async () => { validations++; return true; } });
  const until = async (condition: () => boolean) => {
    for (let count = 0; !condition() && count < 100; count++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(condition(), true);
  };
  const creating = adapter.createTicketTime(principal, 100, time);
  await until(() => metadataCalls === 1);
  blockReads = true;
  const readers = [adapter.get(principal, 'Tickets', 100), adapter.get(principal, 'Tickets', 100)];
  try {
    await until(() => blockedReads === 2);
    releaseMetadata();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(validations, 0);
    assert.equal(creates(seen).length, 0);
  } finally { releaseMetadata(); releaseReads(); }
  await Promise.all([...readers, creating]);
  assert.equal(validations, 1);
  assert.equal(creates(seen).length, 1);
});

test('metadata expiry or identity revocation during time validation blocks dispatch', async () => {
  let now = NOW;
  const expired = harness(undefined, { now: () => now, identityFreshnessMs: 300_000, validateTicketTimeEligibility: async () => { now = NOW + 60_000; return true; } });
  await assert.rejects(expired.adapter.createTicketTime(principal, 100, time), code('conflict'));
  assert.equal(creates(expired.seen).length, 0);
  let revoked = false;
  const changed = harness(undefined, { validateTicketTimeEligibility: async () => { revoked = true; return true; }, revalidatePrincipal: async (p) => revoked ? { ...p, active: false } : p });
  await assert.rejects(changed.adapter.createTicketTime(principal, 100, time), code('identity_mapping_invalid'));
  assert.equal(creates(changed.seen).length, 0);
});

test('readback uses parent-scoped note route and root time route without requiring create metadata', async () => {
  const { adapter, seen } = harness((request) => {
    if (request.url.pathname.endsWith('/Tickets/100')) return json(ticket());
    if (request.url.pathname.endsWith('/Notes/901')) return json({ item: { id: 901, ticketID: 100, creatorResourceID: 42, ...note } });
    return json({ item: { id: 902, ticketID: 100, ...time } });
  }, { resolveTicketWorkMetadata: undefined });
  assert.equal((await adapter.getTicketNote(principal, 100, 901)).id, 901);
  assert.equal((await adapter.getTicketTime(principal, 100, 902)).id, 902);
  assert.equal(seen[1]?.url.href, `${baseUrl}Tickets/100/Notes/901`);
  assert.equal(seen[3]?.url.href, `${baseUrl}TimeEntries/902`);
  assert.equal(creates(seen).length, 0);
});

test('readback rejects mismatched created IDs, parents, delegated resources and revoked scope', async () => {
  for (const [item, expected] of [
    [{ id: 999, ticketID: 100, resourceID: 42 }, 'dependency_unavailable'],
    [{ id: 901, ticketID: 999, resourceID: 42 }, 'not_found_or_inaccessible'],
  ] as const) {
    const { adapter } = harness((request) => request.url.pathname.endsWith('/Tickets/100') ? json(ticket()) : json({ item }));
    await assert.rejects(adapter.getTicketNote(principal, 100, 901), code(expected));
    await assert.rejects(adapter.getTicketTime(principal, 100, 901), code(expected));
  }
  const delegated = harness((request) => request.url.pathname.endsWith('/Tickets/100') ? json(ticket()) : json({ item: { id: 901, ticketID: 100, resourceID: 43 } }));
  await assert.rejects(delegated.adapter.getTicketTime(principal, 100, 901), code('not_found_or_inaccessible'));
  const moved = harness(() => json({ item: { id: 100, companyID: 999 } }));
  await assert.rejects(moved.adapter.getTicketNote(principal, 100, 901), code('not_found_or_inaccessible'));
  assert.equal(moved.seen.length, 1);
});

test('create capabilities cannot be supplied through resource or metadata arguments', async () => {
  const { adapter, seen } = harness();
  await assert.rejects(adapter.createTicketNote({ ...principal, capabilities: ['operational.read', 'time.self'] }, 100, note), code('forbidden'));
  await assert.rejects(adapter.createTicketTime({ ...principal, capabilities: ['operational.read', 'time.team'] }, 100, time), code('forbidden'));
  assert.equal(seen.length, 0);
});

test('read-only time preflight validates the exact immutable proposed date and payload without POST', async () => {
  let validations = 0;
  const { adapter, seen } = harness(undefined, { validateTicketTimeEligibility: async (p, ticketId, payload) => {
    validations++;
    assert.equal(p.resourceId, principal.resourceId);
    assert.equal(ticketId, 100);
    assert.equal(Object.isFrozen(payload), true);
    assert.deepEqual(payload, time);
    assert.notEqual(payload, time);
    return true;
  } });
  assert.equal(await adapter.validateTicketTime(principal, 100, time), undefined);
  assert.equal(validations, 1);
  assert.ok(seen.length > 0);
  assert.ok(seen.every(request => request.init.method === 'GET'));
  assert.equal(creates(seen).length, 0);
});

test('optional empty internal time notes survive preflight and POST while absent notes remain omitted', async () => {
  const validated: Readonly<TicketTimeCreate>[] = [];
  const { adapter, seen } = harness(undefined, { validateTicketTimeEligibility: async (_p, _id, payload) => {
    validated.push(payload); return true;
  } });
  const empty = { ...time, internalNotes: '' };
  await adapter.validateTicketTime(principal, 100, empty);
  assert.equal(creates(seen).length, 0);
  await adapter.createTicketTime(principal, 100, empty);
  assert.equal(validated[0]?.internalNotes, '');
  assert.equal(validated[1]?.internalNotes, '');
  assert.equal(JSON.parse(String(creates(seen)[0]?.init.body)).internalNotes, '');
  const omitted = { ...time };
  delete omitted.internalNotes;
  await adapter.validateTicketTime(principal, 100, omitted);
  await adapter.createTicketTime(principal, 100, omitted);
  assert.equal(Object.hasOwn(validated[2]!, 'internalNotes'), false);
  assert.equal(Object.hasOwn(JSON.parse(String(creates(seen)[1]?.init.body)), 'internalNotes'), false);
});

test('missing, false or failed date validators reject read-only preflight without dispatching a create', async () => {
  const missing = harness(undefined, { validateTicketTimeEligibility: undefined });
  await assert.rejects(missing.adapter.validateTicketTime(principal, 100, time), code('missing_metadata'));
  assert.equal(missing.seen.length, 0);
  const closedDate = harness(undefined, { validateTicketTimeEligibility: async (_p, _id, payload) => payload.dateWorked !== time.dateWorked });
  await assert.rejects(closedDate.adapter.validateTicketTime(principal, 100, time), code('precondition_failed'));
  assert.equal(creates(closedDate.seen).length, 0);
  const unavailable = harness(undefined, { validateTicketTimeEligibility: async () => { throw new Error('SECRET-CLOSED-TIMESHEET-CANARY'); } });
  await assert.rejects(unavailable.adapter.validateTicketTime(principal, 100, time), (error: unknown) => error instanceof AppError
    && error.code === 'dependency_unavailable' && !error.message.includes('CANARY'));
  assert.equal(creates(unavailable.seen).length, 0);
});

test('time preflight enforces create qualification, own-resource input, parent scope and reviewed eligibility', async () => {
  const unqualified = harness(undefined, { qualifications: qualifications.filter(q => q.operation !== 'TimeEntries.create') });
  await assert.rejects(unqualified.adapter.validateTicketTime(principal, 100, time), code('impersonation_not_qualified'));
  assert.equal(unqualified.seen.length, 0);
  const invalid = harness();
  for (const payload of [{ ...time, dateWorked: '2026-02-30T00:00:00Z' }, { ...time, hoursWorked: 0 },
    { ...time, isNonBillable: true }, { ...time, startDateTime: time.dateWorked }]) {
    await assert.rejects(invalid.adapter.validateTicketTime(principal, 100, payload as TicketTimeCreate), code('invalid_input'));
  }
  await assert.rejects(invalid.adapter.validateTicketTime(principal, 100, { ...time, resourceID: 999 }), code('forbidden'));
  assert.equal(invalid.seen.length, 0);
  const inaccessible = harness(() => json({ item: { id: 100, companyID: 999 } }));
  await assert.rejects(inaccessible.adapter.validateTicketTime(principal, 100, time), code('not_found_or_inaccessible'));
  assert.equal(creates(inaccessible.seen).length, 0);
  let dateChecks = 0;
  const ineligible = harness(undefined, { validateTicketTimeEligibility: async () => { dateChecks++; return true; } });
  await assert.rejects(ineligible.adapter.validateTicketTime(principal, 100, { ...time, roleID: 777 }), code('precondition_failed'));
  assert.equal(dateChecks, 0);
  assert.equal(creates(ineligible.seen).length, 0);
  const wrongMetadata = harness(undefined, { resolveTicketWorkMetadata: async () => ({ ...metadata(), resourceId: 999 }) });
  await assert.rejects(wrongMetadata.adapter.validateTicketTime(principal, 100, time), code('missing_metadata'));
  assert.equal(creates(wrongMetadata.seen).length, 0);
});

test('a successful preflight does not suppress the current eligibility check immediately before create', async () => {
  let eligible = true, validations = 0;
  const { adapter, seen } = harness(undefined, { validateTicketTimeEligibility: async () => { validations++; return eligible; } });
  await adapter.validateTicketTime(principal, 100, time);
  assert.equal(validations, 1);
  eligible = false;
  await assert.rejects(adapter.createTicketTime(principal, 100, time), code('precondition_failed'));
  assert.equal(validations, 2);
  assert.equal(creates(seen).length, 0);
});

test('read-only time preflight waits for capacity and validates after it acquires a slot', async () => {
  let releaseMetadata!: () => void, releaseReads!: () => void;
  const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
  const readGate = new Promise<void>(resolve => { releaseReads = resolve; });
  let metadataCalls = 0, blockedReads = 0, blockReads = false, validations = 0;
  const { adapter, seen } = harness(async () => {
    if (blockReads) { blockedReads++; await readGate; }
    return json(ticket());
  }, {
    resolveTicketWorkMetadata: async () => { if (++metadataCalls === 1) await metadataGate; return metadata(); },
    validateTicketTimeEligibility: async () => { validations++; return true; },
  });
  const until = async (condition: () => boolean) => {
    for (let count = 0; !condition() && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(condition(), true);
  };
  const preflight = adapter.validateTicketTime(principal, 100, time);
  await until(() => metadataCalls === 1);
  blockReads = true;
  const reads = [adapter.get(principal, 'Tickets', 100), adapter.get(principal, 'Tickets', 100)];
  try {
    await until(() => blockedReads === 2);
    releaseMetadata();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(validations, 0);
    assert.equal(creates(seen).length, 0);
  } finally { releaseMetadata(); releaseReads(); }
  await Promise.all([...reads, preflight]);
  assert.equal(validations, 1);
  assert.equal(creates(seen).length, 0);
});

test('time preflight rejects expiry or mapping revocation while the date validator waits', async () => {
  let now = NOW;
  const expired = harness(undefined, { now: () => now, identityFreshnessMs: 300_000,
    validateTicketTimeEligibility: async () => { now = NOW + 60_000; return true; } });
  await assert.rejects(expired.adapter.validateTicketTime(principal, 100, time), code('conflict'));
  assert.equal(creates(expired.seen).length, 0);
  let revoked = false;
  const changed = harness(undefined, {
    validateTicketTimeEligibility: async () => { revoked = true; return true; },
    revalidatePrincipal: async p => revoked ? { ...p, active: false } : p,
  });
  await assert.rejects(changed.adapter.validateTicketTime(principal, 100, time), code('identity_mapping_invalid'));
  assert.equal(creates(changed.seen).length, 0);
});

test('fixture time preflight is read-only and shares strict metadata/payload enforcement with creation', async () => {
  const actor = fixturePrincipals()[0]!;
  const store = new MemoryPrincipalStore([actor]);
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store));
  const proposed = { ...time, resourceID: actor.resourceId, roleID: 201, billingCodeID: 301 };
  const before = structuredClone(adapter.records);
  await adapter.validateTicketTime(actor, 1001, proposed);
  assert.deepEqual(adapter.records, before);
  assert.equal(adapter.calls.filter(call => call.kind === 'create').length, 0);
  await assert.rejects(adapter.validateTicketTime(actor, 1001, { ...proposed, dateWorked: '2026-02-30T00:00:00Z' }), code('invalid_input'));
  await assert.rejects(adapter.validateTicketTime(actor, 1001, { ...proposed, resourceID: 999 }), code('forbidden'));
  adapter.metadataFactory = (p, id) => { const current = fixtureWorkMetadata(p, id); current.time.eligible = false; return current; };
  await assert.rejects(adapter.validateTicketTime(actor, 1001, proposed), code('precondition_failed'));
  await assert.rejects(adapter.createTicketTime(actor, 1001, proposed), code('precondition_failed'));
  assert.deepEqual(adapter.records, before);
  adapter.metadataFactory = (p, id) => ({ ...fixtureWorkMetadata(p, id), resourceId: 999 });
  await assert.rejects(adapter.validateTicketTime(actor, 1001, proposed), code('precondition_failed'));
});

test('uncertain time writes retain safe failure categories without replay or native text', async () => {
  const cases = [
    { fail: () => { throw new Error('secret transport details'); }, expected: { reason: 'transport_failure' } },
    { fail: () => json({ errors: ['secret native details'] }, 500), expected: { reason: 'http_error', http_status: 500 } },
    { fail: () => new Response('secret invalid body', { status: 200 }), expected: { reason: 'invalid_response', http_status: 200 } },
    { fail: () => json({}), expected: { reason: 'missing_record_id' } },
    { fail: () => new Promise<Response>(() => {}), expected: { reason: 'timeout' } },
  ];
  for (const sample of cases) {
    const { adapter, seen } = harness(request => request.init.method === 'POST' ? sample.fail() : json(ticket()), { timeoutMs: 10 });
    await assert.rejects(adapter.createTicketTime(principal, 100, time), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'unknown_outcome');
      assert.deepEqual(error.upstreamFailure, sample.expected);
      assert.equal(JSON.stringify(error).includes('secret'), false);
      return true;
    });
    assert.equal(creates(seen).length, 1);
  }
});

test('ticket time sends supplied start/stop instants and classifies only the exact native requirement', async () => {
  const payload = {...time,startDateTime:'2026-09-10T13:00:00.000Z',endDateTime:'2026-09-10T13:30:00.000Z'};
  const s=harness(); await s.adapter.createTicketTime(principal,100,payload);
  assert.equal(JSON.parse(String(creates(s.seen)[0]!.init.body)).startDateTime,payload.startDateTime);
  assert.equal(JSON.parse(String(creates(s.seen)[0]!.init.body)).endDateTime,payload.endDateTime);
  const message='TimeEntries for Service tickets require a start and stop time.';
  for (const [body,expected] of [[{errors:[message]},'invalid_input'],[{errors:[message,'Other failure']},'unknown_outcome'],[{errors:['Other failure']},'unknown_outcome'],[{errors:[message+'x'.repeat(17000)]},'unknown_outcome']] as const) {
    const h=harness(r=>r.init.method==='POST'?json(body,500):json(ticket()));
    await assert.rejects(h.adapter.createTicketTime(principal,100,time), code(expected));
    assert.equal(creates(h.seen).length,1);
  }
});
