import test from 'node:test';
import {FixtureUnlimitedRequestBudget} from '../packages/autotask/src/budget.js';
import assert from 'node:assert/strict';
import { AppError, type Principal, type QueryRequest } from '../packages/contracts/src/index.js';
import { HttpAutotaskAdapter, type AutotaskOperation, type HttpAutotaskAdapterOptions, type OperationQualification } from '../packages/autotask/src/index.js';

const NOW = Date.parse('2026-09-10T18:00:00.000Z');
const baseUrl = 'https://webservices3.autotask.net/atservicesrest/v1.0/';
const principal: Principal = { tenantId: 'tenant', objectId: 'employee', resourceId: 42, mappingVersion: 1, policyVersion: 'policy-v1', companyIds: [10], capabilities: ['operational.read', 'tickets.write', 'time.self'], active: true, resourceVerifiedAt: new Date(NOW).toISOString() };
const operations: AutotaskOperation[] = ['Tickets.query', 'Tickets.get', 'TicketNotes.query', 'TimeEntries.query', 'Companies.query', 'Companies.get', 'Tickets.patch'];
const qualifications: OperationQualification[] = operations.map((operation) => ({ operation, evidenceSource: 'live', headerAccepted: true, permissionEnforced: true, nativeAttribution: true, testIds: ['allow-case', 'deny-case'], resourceIds: [42, 43], tenantId: 'tenant', policyVersion: 'policy-v1', qualifiedAt: new Date(NOW - 1_000).toISOString(), expiresAt: new Date(NOW + 86_400_000).toISOString(), evidenceReference: 'synthetic live-shaped test evidence; never deployment configuration' }));
const ticketQuery: QueryRequest = { entity: 'Tickets', filters: [], pageSize: 2 };
const json = (data: unknown, status = 200, headers?: Record<string, string>): Response => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const ticket = (id = 100) => ({ id, companyID: 10, title: 'Original title', status: 1 });
const page = (items: unknown[], nextPageUrl: string | null = null) => ({ items, pageDetails: { nextPageUrl } });
type Seen = { url: URL; init: RequestInit };
function harness(handler: (request: Seen, index: number) => Response | Promise<Response>, options: Partial<HttpAutotaskAdapterOptions> = {}) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = { url: new URL(String(input)), init: init ?? {} };
    seen.push(request);
    return handler(request, seen.length - 1);
  };
  const adapter = new HttpAutotaskAdapter({ baseUrl, username: 'server-user', secret: 'server-secret', integrationCode: 'server-integration', cursorSecret: 'cursor-secret-longer-than-thirty-two-bytes', qualifications, fetch: fetcher, now: () => NOW, sleep: async () => {}, revalidatePrincipal: async (p) => p, ...options });
  return { adapter, seen };
}
const code = (expected: string) => (error: unknown): boolean => error instanceof AppError && error.code === expected;

test('live operations are disabled by default and cannot be enabled with fixture evidence', async () => {
  for (const evidence of [[], qualifications.map((q) => ({ ...q, evidenceSource: 'fixture' as const })), qualifications.map((q) => ({ ...q, permissionEnforced: false })), qualifications.map((q) => ({ ...q, testIds: [] })), qualifications.map((q) => ({ ...q, expiresAt: new Date(NOW).toISOString() }))]) {
    const { adapter, seen } = harness(() => json({}), { qualifications: evidence });
    await assert.rejects(adapter.query(principal, ticketQuery), code('impersonation_not_qualified'));
    assert.equal(seen.length, 0);
  }
});

test('qualification is bound to operation, tenant, resource, policy, and native write attribution', async () => {
  for (const change of [{ operation: 'Companies.query' }, { tenantId: 'other' }, { resourceIds: [9] }, { policyVersion: 'other' }]) {
    const evidence = [{ ...qualifications[0]!, ...change }] as OperationQualification[];
    const { adapter, seen } = harness(() => json({}), { qualifications: evidence });
    await assert.rejects(adapter.query(principal, ticketQuery), code('impersonation_not_qualified'));
    assert.equal(seen.length, 0);
  }
  const { adapter, seen } = harness(() => json({}), { qualifications: qualifications.map((q) => ({ ...q, nativeAttribution: false })) });
  await assert.rejects(adapter.patchTicket(principal, 100, { title: 'Changed' }), code('impersonation_not_qualified'));
  assert.equal(seen.length, 0);
});

test('rejects credential injection and unapproved base URLs before dispatch', () => {
  for (const base of ['http://webservices3.autotask.net/atservicesrest/v1.0/', 'https://webservices3.autotask.net.evil.test/atservicesrest/v1.0/', 'https://webservices3.autotask.net:443/atservicesrest/v1.0/', 'https://user:pass@webservices3.autotask.net/atservicesrest/v1.0/', 'https://webservices3.autotask.net/atservicesrest/v1.0/Tickets/', 'https://webservices3.autotask.net/atservicesrest/v1.0/../v1.0/']) {
    assert.throws(() => harness(() => json({}), { baseUrl: base }), code('invalid_input'));
  }
  assert.throws(() => harness(() => json({}), { secret: 'test\r\nImpersonationResourceId: 99' }), code('invalid_input'));
});

test('validates filters, IDs and reviewed entity names without dispatch', async () => {
  const { adapter, seen } = harness(() => json({}));
  for (const request of [
    { ...ticketQuery, entity: '../Companies' },
    { ...ticketQuery, filters: [{ field: '__proto__', op: 'eq', value: 1 }] },
    { ...ticketQuery, filters: [{ field: 'id', op: 'eq', value: '1 OR 1=1' }] },
    { ...ticketQuery, filters: [{ field: 'id', op: 'contains', value: 1 }] },
    { ...ticketQuery, filters: [{ field: 'id', op: 'eq', value: 1, items: [] }] },
    { ...ticketQuery, pageSize: 501 },
    { ...ticketQuery, parentId: 10 },
  ]) await assert.rejects(adapter.query(principal, request as QueryRequest), code('invalid_input'));
  await assert.rejects(adapter.get(principal, 'Tickets', -1), code('invalid_input'));
  await assert.rejects(adapter.get(principal, 'TicketNotes', 1), code('invalid_input'));
  await assert.rejects(adapter.patchTicket(principal, 1, { status: 5 }), code('invalid_input'));
  await assert.rejects(adapter.patchTicket(principal, 1, { id: 2, title: 'Changed' }), code('invalid_input'));
  await assert.rejects(adapter.patchTicket(principal, 1, { title: 'x'.repeat(256) }), code('invalid_input'));
  assert.equal(seen.length, 0);
});

test('ticket queries accept 500 records per page while other entities remain capped at 100', async () => {
  const { adapter, seen } = harness(() => json(page([ticket()])));
  await adapter.query(principal, { ...ticketQuery, pageSize: 500 });
  assert.equal(JSON.parse(String(seen[0]!.init.body)).MaxRecords, 500);
  await assert.rejects(adapter.query(principal, { entity: 'Companies', filters: [], pageSize: 101 }), code('invalid_input'));
  assert.equal(seen.length, 1);
});

test('fresh active mapping and capabilities are mandatory, with no API-user fallback', async () => {
  for (const change of [{ active: false }, { resourceId: 0 }, { mappingVersion: 0 }]) {
    const { adapter, seen } = harness(() => json({}));
    await assert.rejects(adapter.query({ ...principal, ...change }, ticketQuery), code('identity_mapping_invalid'));
    assert.equal(seen.length, 0);
  }
  for (const date of [new Date(NOW - 60_001).toISOString(), new Date(NOW + 1).toISOString(), 'invalid']) {
    const { adapter, seen } = harness(() => json({}));
    await assert.rejects(adapter.query({ ...principal, resourceVerifiedAt: date }, ticketQuery), code('identity_validation_unavailable'));
    assert.equal(seen.length, 0);
  }
  const { adapter, seen } = harness(() => json({}));
  await assert.rejects(adapter.query({ ...principal, capabilities: [] }, ticketQuery), code('forbidden'));
  assert.equal(seen.length, 0);
});

test('POST query encodes filters, forces company scope, retains impersonation, and refuses redirects', async () => {
  const { adapter, seen } = harness(() => json(page([ticket()])));
  const result = await adapter.query(principal, ticketQuery);
  assert.equal(result.items[0]?.id, 100);
  const first = seen[0]!;
  assert.equal(first.url.href, `${baseUrl}Tickets/query`);
  assert.equal(first.init.method, 'POST');
  assert.equal(first.init.redirect, 'manual');
  const headers = new Headers(first.init.headers);
  assert.equal(headers.get('ImpersonationResourceId'), '42');
  assert.equal(headers.get('UserName'), 'server-user');
  assert.equal(headers.get('Secret'), 'server-secret');
  assert.deepEqual(JSON.parse(first.init.body as string), { MaxRecords: 2, filter: [{ field: 'companyID', op: 'in', value: [10] }] });
  const redirected = harness(() => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }));
  await assert.rejects(redirected.adapter.query(principal, ticketQuery), code('dependency_unavailable'));
  assert.equal(redirected.seen.length, 1);
});

test('ticket count uses the scoped native count route and rejects malformed totals', async () => {
  const filters:QueryRequest['filters']=[{field:'status',op:'eq',value:49},{field:'createDate',op:'gte',value:'2026-08-01T05:00:00.000Z'},{field:'createDate',op:'lt',value:'2026-09-01T05:00:00.000Z'}];
  const {adapter,seen}=harness(()=>json({queryCount:237}));
  assert.equal(await adapter.countTickets(principal,filters),237);
  assert.equal(seen.length,1);
  assert.equal(seen[0]!.url.href,`${baseUrl}Tickets/query/count`);
  assert.deepEqual(JSON.parse(seen[0]!.init.body as string),{filter:[...filters,{field:'companyID',op:'in',value:[10]}]});
  assert.equal(new Headers(seen[0]!.init.headers).get('ImpersonationResourceId'),'42');
  for(const response of [{queryCount:-1},{queryCount:1.5},{queryCount:'237'},{}]){
    const bad=harness(()=>json(response));
    await assert.rejects(bad.adapter.countTickets(principal,filters),code('dependency_unavailable'));
  }
});

test('root continuation keeps method, query body and header, using opaque authenticated cursors', async () => {
  const nextUrl = `${baseUrl}Tickets/query/next?paging=opaque-upstream-token`;
  const { adapter, seen } = harness((_, index) => json(index === 0 ? page([ticket()], nextUrl) : page([ticket(101)])));
  const first = await adapter.query(principal, ticketQuery);
  assert.ok(first.nextCursor);
  assert.ok(!first.nextCursor.includes('https'));
  assert.ok(!Buffer.from(first.nextCursor.split('.')[0]!, 'base64url').toString('utf8').includes('employee'));
  const second = await adapter.query(principal, { ...ticketQuery, cursor: first.nextCursor });
  assert.equal(second.items[0]?.id, 101);
  assert.equal(seen[1]?.url.href, nextUrl);
  assert.equal(seen[1]?.init.method, 'POST');
  assert.equal(seen[1]?.init.body, seen[0]?.init.body);
  assert.equal(new Headers(seen[1]?.init.headers).get('ImpersonationResourceId'), '42');
});

test('cursors cannot cross actor, mapping, policy, scope, resource, query or expiry', async () => {
  let now = NOW;
  const { adapter, seen } = harness(() => json(page([ticket()], `${baseUrl}Tickets/query/next?paging=opaque`)), { now: () => now, cursorTtlMs: 1_000 });
  const first = await adapter.query(principal, ticketQuery);
  for (const change of [{ objectId: 'other' }, { mappingVersion: 2 }, { policyVersion: 'changed' }, { companyIds: [10, 11] }, { resourceId: 43 }, { capabilities: ['operational.read'] as Principal['capabilities'] }]) {
    await assert.rejects(adapter.query({ ...principal, ...change }, { ...ticketQuery, cursor: first.nextCursor! }), code('invalid_input'));
  }
  await assert.rejects(adapter.query(principal, { ...ticketQuery, pageSize: 1, cursor: first.nextCursor! }), code('invalid_input'));
  await assert.rejects(adapter.query(principal, { ...ticketQuery, cursor: `${first.nextCursor!.slice(0, -2)}XX` }), code('invalid_input'));
  now += 1_001;
  await assert.rejects(adapter.query(principal, { ...ticketQuery, cursor: first.nextCursor! }), code('invalid_input'));
  assert.equal(seen.length, 1);
});

test('upstream continuation cannot change origin, path, query contract, or parent', async () => {
  for (const nextUrl of [
    'https://evil.test/atservicesrest/v1.0/Tickets/query/next?paging=token',
    `${baseUrl}Companies/query/next?paging=token`,
    `${baseUrl}Tickets/query/next?paging=token&search=altered`,
    `${baseUrl}Tickets/query/next?paging=first&paging=second`,
    `${baseUrl}Tickets/query/next?paging=token#fragment`,
    `${baseUrl}Tickets/query/../query/next?paging=token`,
    `${baseUrl}Tickets/query/next`,
    '/atservicesrest/v1.0/Tickets/query/next?paging=token',
  ]) {
    const { adapter, seen } = harness(() => json(page([ticket()], nextUrl)));
    await assert.rejects(adapter.query(principal, ticketQuery), code('dependency_unavailable'));
    assert.equal(seen.length, 1);
  }
});

test('read retries are bounded and revalidate employee identity before each attempt', async () => {
  let validations = 0;
  const { adapter, seen } = harness((_, index) => index < 2 ? json({}, 503) : json(page([ticket()])), { revalidatePrincipal: async (p) => { validations++; return p; } });
  await adapter.query(principal, ticketQuery);
  assert.equal(seen.length, 3);
  assert.equal(validations, 4); // One operation guard plus each HTTP dispatch.
  assert.ok(seen.every((entry) => new Headers(entry.init.headers).get('ImpersonationResourceId') === '42'));
  const persistent = harness(() => json({}, 503));
  await assert.rejects(persistent.adapter.query(principal, ticketQuery), code('dependency_unavailable'));
  assert.equal(persistent.seen.length, 3);
  const tooLong = harness(() => json({}, 429, { 'retry-after': '600' }));
  await assert.rejects(tooLong.adapter.query(principal, ticketQuery), code('throttled'));
  assert.equal(tooLong.seen.length, 1);
});

test('mapping changes during retry abort instead of switching employee identity', async () => {
  let validations = 0;
  const { adapter, seen } = harness(() => json({}, 503), { revalidatePrincipal: async (p) => (++validations === 3 ? { ...p, resourceId: 43 } : p) });
  await assert.rejects(adapter.query(principal, ticketQuery), code('identity_mapping_invalid'));
  assert.equal(seen.length, 1);
  const unavailable = harness(() => json({}), { revalidatePrincipal: async () => { throw new Error('private directory details'); } });
  await assert.rejects(unavailable.adapter.query(principal, ticketQuery), (error) => code('identity_validation_unavailable')(error) && !(error as Error).message.includes('private'));
  assert.equal(unavailable.seen.length, 0);
});

test('PATCH uses root route with id, never retries, and reports uncertain transport outcomes', async () => {
  for (const failure of ['network', 'server', 'malformed'] as const) {
    const { adapter, seen } = harness((request) => {
      if (request.init.method === 'GET') return json({ item: ticket() });
      if (failure === 'network') throw new Error('network failed, potentially after dispatch');
      if (failure === 'malformed') return new Response('not-json');
      return json({}, 503);
    });
    await assert.rejects(adapter.patchTicket(principal, 100, { title: 'Changed title' }), code('unknown_outcome'));
    const writes = seen.filter((entry) => entry.init.method === 'PATCH');
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.url.href, `${baseUrl}Tickets`);
    assert.deepEqual(JSON.parse(writes[0]?.init.body as string), { id: 100, title: 'Changed title' });
    assert.ok(seen.every((entry) => new Headers(entry.init.headers).get('ImpersonationResourceId') === '42'));
  }
});

test('deadline covers HTTP response and body reads and aborts the request', async () => {
  let signal: AbortSignal | undefined;
  const { adapter, seen } = harness((request) => { signal = request.init.signal!; return new Promise<Response>(() => {}); }, { timeoutMs: 10 });
  await assert.rejects(adapter.query(principal, ticketQuery), code('dependency_unavailable'));
  assert.equal(signal?.aborted, true);
  assert.equal(seen.length, 1);
  const stalledBody = harness(() => new Response(new ReadableStream({ start() {} })), { timeoutMs: 10 });
  await assert.rejects(stalledBody.adapter.query(principal, ticketQuery), code('dependency_unavailable'));
});

test('child notes use actual GET route and page bounded records locally by ID', async () => {
  const notes = [{ id: 3, ticketID: 100, description: 'third' }, { id: 1, ticketID: 100, description: 'first' }, { id: 2, ticketID: 100, description: 'second' }];
  const { adapter, seen } = harness((request) => request.url.pathname.endsWith('/Notes') ? json(page(notes)) : json({ item: ticket() }));
  const query: QueryRequest = { entity: 'TicketNotes', parentId: 100, filters: [{ field: 'ticketID', op: 'eq', value: 100 }], pageSize: 2 };
  const first = await adapter.query(principal, query);
  assert.deepEqual(first.items.map((item) => item.id), [1, 2]);
  const second = await adapter.query(principal, { ...query, cursor: first.nextCursor! });
  assert.deepEqual(second.items.map((item) => item.id), [3]);
  assert.equal(second.nextCursor, null);
  assert.equal(seen.length, 4);
  assert.ok(seen.every((entry) => entry.init.method === 'GET'));
  assert.equal(seen[1]?.url.href, `${baseUrl}Tickets/100/Notes`);
  assert.equal(seen[3]?.url.href, seen[1]?.url.href);
});

test('notes reject missing parent, unreviewed continuation and oversized child collections', async () => {
  const query: QueryRequest = { entity: 'TicketNotes', parentId: 100, filters: [], pageSize: 50 };
  const missing = harness(() => json({}));
  await assert.rejects(missing.adapter.query(principal, { ...query, parentId: undefined }), code('invalid_input'));
  assert.equal(missing.seen.length, 0);
  for (const data of [page([{ id: 1, ticketID: 100 }], `${baseUrl}Tickets/100/Notes/next?paging=x`), page(Array.from({ length: 500 }, (_, i) => ({ id: i + 1, ticketID: 100 })))]) {
    const { adapter } = harness((request) => request.url.pathname.endsWith('/Notes') ? json(data) : json({ item: ticket() }));
    await assert.rejects(adapter.query(principal, query), code('unsupported_operation'));
  }
});

test('time entry reads require authorized ticket and enforce self resource scope', async () => {
  const { adapter, seen } = harness((request) => request.init.method === 'GET' ? json({ item: ticket() }) : json(page([{ id: 1, ticketID: 100, resourceID: 42 }])));
  await adapter.query(principal, { entity: 'TimeEntries', filters: [{ field: 'ticketID', op: 'eq', value: 100 }], pageSize: 50 });
  assert.equal(seen[1]?.url.href, `${baseUrl}TimeEntries/query`);
  const body = JSON.parse(seen[1]?.init.body as string);
  assert.ok(body.filter.some((filter: { field: string; value: number }) => filter.field === 'resourceID' && filter.value === 42));
  assert.ok(body.filter.some((filter: { field: string; value: number }) => filter.field === 'ticketID' && filter.value === 100));
  await assert.rejects(adapter.query(principal, { entity: 'TimeEntries', filters: [], pageSize: 50 }), code('invalid_input'));
});

test('response scope and schema checks reject leaked records or unexpected IDs', async () => {
  const wrongCompany = harness(() => json({ item: { ...ticket(), companyID: 99 } }));
  await assert.rejects(wrongCompany.adapter.get(principal, 'Tickets', 100), code('not_found_or_inaccessible'));
  await assert.rejects(wrongCompany.adapter.patchTicket(principal, 100, { title: 'Changed' }), code('not_found_or_inaccessible'));
  assert.equal(wrongCompany.seen.filter((entry) => entry.init.method === 'PATCH').length, 0);
  for (const data of [page([{ ...ticket(), companyID: 99 }]), page([{ title: 'missing id' }]), page([ticket(), ticket()]), { items: 'not array' }]) {
    const { adapter } = harness(() => json(data));
    await assert.rejects(adapter.query(principal, ticketQuery), code('dependency_unavailable'));
  }
  const wrongId = harness(() => json({ item: ticket(101) }));
  await assert.rejects(wrongId.adapter.get(principal, 'Tickets', 100), code('dependency_unavailable'));
});

test('HTTP errors are sanitized and do not expose upstream secrets or directory data', async () => {
  for (const [status, expected] of [[401, 'forbidden'], [403, 'forbidden'], [404, 'not_found_or_inaccessible'], [409, 'conflict'], [422, 'invalid_input']] as const) {
    const { adapter, seen } = harness(() => json({ message: 'server-secret private employee directory' }, status));
    await assert.rejects(adapter.query(principal, ticketQuery), (error) => code(expected)(error) && !(error as Error).message.includes('server-secret') && !(error as Error).message.includes('private'));
    assert.equal(seen.length, 1);
  }
});

test('live dispatch requires authoritative revalidation even with qualification evidence', async () => {
  const { adapter, seen } = harness(() => json({}), { revalidatePrincipal: undefined });
  await assert.rejects(adapter.get(principal, 'Tickets', 100), code('identity_validation_unavailable'));
  assert.equal(seen.length, 0);
});

test('20 principals share at most four requests globally and two per actor across adapters', async () => {
  let active = 0;
  let peak = 0;
  const activeByActor = new Map<string, number>();
  const peakByActor = new Map<string, number>();
  const mappedHeaders: string[] = [];
  const employees = Array.from({ length: 20 }, (_, index) => ({ ...principal, objectId: `employee-${index}`, resourceId: 42 + index }));
  const evidence = qualifications.map((q) => ({ ...q, resourceIds: employees.map((p) => p.resourceId) }));
  const handler = async (request: Seen): Promise<Response> => {
    const resource = new Headers(request.init.headers).get('ImpersonationResourceId')!;
    assert.ok(employees.some((employee) => String(employee.resourceId) === resource));
    mappedHeaders.push(resource);
    active++;
    activeByActor.set(resource, (activeByActor.get(resource) ?? 0) + 1);
    peak = Math.max(peak, active);
    peakByActor.set(resource, Math.max(peakByActor.get(resource) ?? 0, activeByActor.get(resource)!));
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    activeByActor.set(resource, activeByActor.get(resource)! - 1);
    return json({ item: ticket() });
  };
  const first = harness(handler, { qualifications: evidence });
  const second = harness(handler, { qualifications: evidence });
  await Promise.all(employees.flatMap((employee, index) => Array.from({ length: 3 }, () => (index % 2 === 0 ? first.adapter : second.adapter).get(employee, 'Tickets', 100))));
  assert.equal(peak, 4);
  assert.ok([...peakByActor.values()].every((count) => count <= 2));
  assert.ok([...peakByActor.values()].some((count) => count === 2));
  assert.equal(mappedHeaders.length, 60);
  for (const employee of employees) assert.equal(mappedHeaders.filter((id) => id === String(employee.resourceId)).length, 3);
});

test('queue deadlines bound waiting and do not dispatch timed-out requests', async () => {
  const gates: Array<() => void> = [];
  let bothStarted!: () => void;
  const ready = new Promise<void>((resolve) => { bothStarted = resolve; });
  const { adapter, seen } = harness(async () => {
    await new Promise<void>((resolve) => { gates.push(resolve); if (gates.length === 2) bothStarted(); });
    return json({ item: ticket() });
  }, { queueTimeoutMs: 10, timeoutMs: 1_000 });
  const running = [adapter.get(principal, 'Tickets', 100), adapter.get(principal, 'Tickets', 100)];
  await ready;
  await assert.rejects(adapter.get(principal, 'Tickets', 100), code('throttled'));
  assert.equal(seen.length, 2);
  gates.forEach((release) => release());
  await Promise.all(running);
});

test('mapping is revalidated after acquiring a queued slot before actual dispatch', async () => {
  const gates: Array<() => void> = [];
  let revoked = false;
  let bothStarted!: () => void;
  const ready = new Promise<void>((resolve) => { bothStarted = resolve; });
  const { adapter, seen } = harness(async () => {
    await new Promise<void>((resolve) => { gates.push(resolve); if (gates.length === 2) bothStarted(); });
    return json({ item: ticket() });
  }, { revalidatePrincipal: async (p) => ({ ...p, active: !revoked }) });
  const running = [adapter.get(principal, 'Tickets', 100), adapter.get(principal, 'Tickets', 100)];
  await ready;
  const queued = assert.rejects(adapter.get(principal, 'Tickets', 100), code('identity_mapping_invalid'));
  revoked = true;
  gates.forEach((release) => release());
  await Promise.all(running);
  await queued;
  assert.equal(seen.length, 2);
});

test('shared request queue rejects overflow beyond 100 waiting requests', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { adapter, seen } = harness(async () => { await gate; return json({ item: ticket() }); });
  // Two slots can be active for this principal; the following 100 are waiting.
  const running = Array.from({ length: 102 }, () => adapter.get(principal, 'Tickets', 100));
  const completed = Promise.all(running);
  await assert.rejects(adapter.get(principal, 'Tickets', 100), code('throttled'));
  assert.ok(seen.length <= 2);
  release();
  await completed;
  assert.equal(seen.length, 102);
});

test('company zero works for scoped HTTP reads while other zero record IDs fail', async () => {
 const p={...principal,companyIds:[0,186]};
 const {adapter}=harness(({url})=>json(url.pathname.endsWith('/query')?page([{id:0,companyName:'Internal'}]):{item:{id:0,companyName:'Internal'}}));
 assert.equal((await adapter.get(p,'Companies',0)).id,0);
 assert.equal((await adapter.query(p,{entity:'Companies',filters:[{field:'id',op:'eq',value:0}],pageSize:10})).items[0]?.id,0);
 await assert.rejects(adapter.get(p,'Tickets',0),code('invalid_input'));
 await assert.rejects(adapter.get(principal,'Companies',0),code('not_found_or_inaccessible'));
});


test('application read mode uses API identity, enforces scope and cannot authorize writes',async()=>{
 const options={qualifications:[],applicationReads:{tenantId:'tenant',operations:['Tickets.get','Tickets.query','Companies.get','Companies.query']},requestBudget:new FixtureUnlimitedRequestBudget()};
 const {adapter,seen}=harness(({url,init})=>{assert.equal(new Headers(init.headers).has('ImpersonationResourceId'),false);return json(url.pathname.endsWith('/query')?page([ticket()]):{item:ticket()});},options);
 assert.equal((await adapter.get(principal,'Tickets',100)).id,100);
 await adapter.query(principal,ticketQuery);
 assert.ok(String(seen[1]!.init.body).includes('companyID'));
 const count=seen.length;
 await assert.rejects(adapter.patchTicket(principal,100,{title:'never sent'}),code('impersonation_not_qualified'));
 await assert.rejects(adapter.get({...principal,capabilities:[]},'Tickets',100),code('forbidden'));
 await assert.rejects(adapter.get({...principal,active:false},'Tickets',100));
 await assert.rejects(adapter.get({...principal,tenantId:'foreign'},'Tickets',100),code('impersonation_not_qualified'));
 await assert.rejects(adapter.get(principal,'Companies',0),code('not_found_or_inaccessible'));
 assert.equal(seen.length,count);
 const foreign=harness(()=>json({item:{...ticket(),companyID:186}}),options);await assert.rejects(foreign.adapter.get(principal,'Tickets',100),code('not_found_or_inaccessible'));
 const revoked=harness(()=>{assert.fail('revoked mapping reached HTTP');}, {...options,revalidatePrincipal:async()=>({...principal,active:false})});await assert.rejects(revoked.adapter.get(principal,'Tickets',100));
 assert.throws(()=>harness(()=>json({}),{...options,applicationReads:{tenantId:'tenant',operations:['Tickets.patch']}}),code('invalid_input'));
});


test('application-mode related reads require authorized parent and preserve own-time filtering',async()=>{
 const opts={qualifications:[],applicationReads:{tenantId:'tenant',operations:['Tickets.get','TicketNotes.query','TicketNotes.get','TimeEntries.query']},requestBudget:new FixtureUnlimitedRequestBudget()};
 const {adapter,seen}=harness(({url,init})=>{
  assert.equal(new Headers(init.headers).has('ImpersonationResourceId'),false);
  if(url.pathname.endsWith('/Tickets/100'))return json({item:ticket()});
  if(url.pathname.endsWith('/Notes'))return json({items:[{id:8,ticketID:100,title:'Note'}]});
  if(url.pathname.endsWith('/Notes/8'))return json({item:{id:8,ticketID:100,title:'Note'}});
  const body=JSON.parse(String(init.body));assert.ok(body.filter.some((f:any)=>f.field==='ticketID'&&f.value===100));assert.ok(body.filter.some((f:any)=>f.field==='resourceID'&&f.value===42));
  return json(page([{id:9,ticketID:100,resourceID:42,hoursWorked:1}]));
 },opts);
 assert.equal((await adapter.query(principal,{entity:'TicketNotes',parentId:100,filters:[],pageSize:10})).items.length,1);
 assert.equal((await adapter.getTicketNote(principal,100,8)).id,8);
 assert.equal((await adapter.query(principal,{entity:'TimeEntries',filters:[{field:'ticketID',op:'eq',value:100}],pageSize:10})).items.length,1);
 const denied=harness(()=>json({item:{...ticket(),companyID:186}}),opts);
 await assert.rejects(denied.adapter.query(principal,{entity:'TicketNotes',parentId:100,filters:[],pageSize:10}),code('not_found_or_inaccessible'));assert.equal(denied.seen.length,1);
 const deniedTime=harness(()=>json({item:{...ticket(),companyID:186}}),opts);
 await assert.rejects(deniedTime.adapter.query(principal,{entity:'TimeEntries',filters:[{field:'ticketID',op:'eq',value:100}],pageSize:10}),code('not_found_or_inaccessible'));assert.equal(deniedTime.seen.length,1);
 const count=seen.length;await assert.rejects(adapter.query({...principal,capabilities:['operational.read']},{entity:'TimeEntries',filters:[{field:'ticketID',op:'eq',value:100}],pageSize:10}),code('forbidden'));assert.equal(seen.length,count);
});

 test('application status lookup resolves exact active labels and never guesses',async()=>{
 const opts={qualifications:[],applicationReads:{tenantId:'tenant',operations:['Tickets.query']},requestBudget:new FixtureUnlimitedRequestBudget()};
 const h=harness(({url,init})=>{assert.ok(url.pathname.endsWith('/Tickets/entityInformation/fields'));assert.equal(init.method,'GET');assert.equal(new Headers(init.headers).has('ImpersonationResourceId'),false);return json({fields:[{name:'status',picklistValues:[{value:'7',label:'Customer Note Added',isActive:true},{value:'8',label:'Old',isActive:false}]}]});},opts);
 assert.equal(await h.adapter.resolveTicketStatus(principal,{kind:'name',name:'Customer Note Added'}),7);
 await assert.rejects(h.adapter.resolveTicketStatus(principal,{kind:'name',name:'Customer'}),code('missing_metadata'));
 await assert.rejects(h.adapter.resolveTicketStatus(principal,{kind:'id',id:8}),code('missing_metadata'));
 const duplicate=harness(()=>json({fields:[{name:'status',picklistValues:[{value:'7',label:'Same',isActive:true},{value:'8',label:'Same',isActive:true}]}]}),opts);
 await assert.rejects(duplicate.adapter.resolveTicketStatus(principal,{kind:'name',name:'Same'}),code('missing_metadata'));
 });

test('open status set excludes all four reviewed terminal statuses and reuses bounded metadata cache',async()=>{
 const opts={qualifications:[],applicationReads:{tenantId:'tenant',operations:['Tickets.query']},requestBudget:new FixtureUnlimitedRequestBudget()};
 const h=harness(()=>json({fields:[{name:'status',picklistValues:['New','Complete','Complete (With CSAT)','Canceled','Duplicate','Customer Note Added'].map((label,i)=>({label,value:String(i+1),isActive:true}))}]}),opts);
 assert.deepEqual(await h.adapter.resolveOpenTicketStatuses(principal),[1,6]);assert.equal(h.seen.length,1);
});

test('native ticket completion filters preserve exclusive end and reject out-of-window upstream rows',async()=>{
 const filters:QueryRequest['filters']=[{field:'completedByResourceID',op:'eq',value:42},{field:'completedDate',op:'gte',value:'2026-09-09T05:00:00Z'},{field:'completedDate',op:'lt',value:'2026-09-10T05:00:00Z'}];
 const record={id:100,companyID:10,completedByResourceID:42,completedDate:'2026-09-09T05:00:00Z'};
 const s=harness(()=>json(page([record])));const r=await s.adapter.query(principal,{entity:'Tickets',filters,pageSize:10});assert.equal(r.items.length,1);assert.deepEqual(JSON.parse(String(s.seen[0]!.init.body)).filter.slice(0,3),filters);
 for(const changes of [{completedDate:'2026-09-10T05:00:00Z'},{completedDate:null},{completedByResourceID:99}]){
  const bad=harness(()=>json(page([{...record,...changes}])));await assert.rejects(bad.adapter.query(principal,{entity:'Tickets',filters,pageSize:10}),code('dependency_unavailable'));
 }
});
