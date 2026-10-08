import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, actorKey, type Principal } from '../packages/contracts/src/index.js';
import { HttpAutotaskAdapter, requestScheduler, type OperationQualification } from '../packages/autotask/src/index.js';
import { HttpTechnicianTransport, type HttpTechnicianTransportOptions } from '../packages/autotask/src/technician-transport.js';
import type { TechnicianHttpRequest } from '../packages/technician/src/http.js';
import { FixtureUnlimitedRequestBudget, RequestBudgetError, type BudgetRequest, type RequestBudgetPort } from '../packages/autotask/src/budget.js';

const NOW = Date.parse('2026-09-10T18:00:00.000Z');
const baseUrl = 'https://webservices3.autotask.net/atservicesrest/v1.0/';
const principal: Principal = { tenantId: 'tenant', objectId: 'employee', resourceId: 101, mappingVersion: 1, policyVersion: 'policy-v1', active: true, companyIds: [10], capabilities: ['operational.read', 'tickets.write'], resourceVerifiedAt: new Date(NOW).toISOString() };
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const patch = (beforeDispatch: () => Promise<void> = async () => {}): TechnicianHttpRequest => ({ operation: 'Tickets.patch.expanded', method: 'PATCH', path: 'Tickets', body: { id: 1001, status: 5 }, beforeDispatch });
const history = (beforeDispatch: () => Promise<void> = async () => {}): TechnicianHttpRequest => ({ operation: 'TicketHistory.query', method: 'POST', path: 'TicketHistory/query', body: { filter: [{ op: 'eq', field: 'ticketID', value: 1001 }] }, beforeDispatch });
type Seen = { url: URL; init: RequestInit };
function setup(handler: (request: Seen) => Response | Promise<Response> = () => json({ itemId: 1001 }), options: Partial<HttpTechnicianTransportOptions> = {}) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init) => { const request = { url: new URL(String(input)), init: init ?? {} }; seen.push(request); return handler(request); };
  return { seen, transport: new HttpTechnicianTransport({ baseUrl, username: 'server-user', secret: 'server-secret', integrationCode: 'server-integration', revalidatePrincipal: async p => p, fetch: fetcher, now: () => NOW, ...options }) };
}

test('technician transport accepts only fixed reviewed operation/method/route/body combinations', async () => {
  const s = setup();
  for (const request of [
    { ...patch(), path: `${baseUrl}Tickets` }, { ...patch(), path: '../Tickets' }, { ...patch(), path: 'Tickets?x=y' },
    { ...patch(), method: 'POST' }, { ...patch(), operation: 'Tasks.get' }, { ...patch(), body: { id: 1001, companyID: 20 } },
    { ...patch(), body: { id: 1001, impersonationResourceID: 102 } }, { ...patch(), body: { id: 1001, assignedResourceroleID: 30 } },
    { ...patch(), body: { id: 1001, status: 0 } }, { ...patch(), beforeDispatch: undefined },
    { ...history(), body: { filter: [{ op: 'in', field: 'ticketID', value: [1001, 2001] }] } },
    { ...history(), body: { filter: [{ op: 'eq', field: 'ticketID', value: 1001 }], MaxRecords: 501 } },
    { operation: 'Tasks.get', method: 'GET', path: 'Tasks/1/Notes', beforeDispatch: async () => {} },
  ]) await assert.rejects(s.transport.request(principal, request as TechnicianHttpRequest));
  assert.equal(s.seen.length, 0);
});

test('history may request a reviewed 500-row native page for long transition histories',async()=>{
  const s=setup();await s.transport.request(principal,{...history(),body:{filter:[{op:'eq',field:'ticketID',value:1001}],MaxRecords:500}});
  assert.equal(JSON.parse(String(s.seen[0]?.init.body)).MaxRecords,500);
});

test('expanded patch preserves native field spelling, server headers and its guarded frozen body', async () => {
  let request!: TechnicianHttpRequest;
  const s = setup();
  request = { ...patch(async () => { (request.body as Record<string, unknown>).status = 99; }), body: { id: 1001, status: 5, assignedResourceID: 101, assignedResourceRoleID: 201, queueID: null, resolution: 'Fictitious work.' } };
  await s.transport.request(principal, request);
  assert.deepEqual(JSON.parse(String(s.seen[0]?.init.body)), { id: 1001, status: 5, assignedResourceID: 101, assignedResourceRoleID: 201, queueID: null, resolution: 'Fictitious work.' });
  assert.equal(s.seen[0]?.url.href, `${baseUrl}Tickets`);
  assert.equal((s.seen[0]?.init.headers as Record<string, string>).ImpersonationResourceId, '101');
  assert.equal(s.seen[0]?.init.redirect, 'manual');
});

test('task queries bind assigned employee and date fields, and GET methods do not accept query bodies', async () => {
  const s = setup(), query: TechnicianHttpRequest = { operation: 'Tasks.query', method: 'POST', path: 'Tasks/query', beforeDispatch: async () => {}, body: { filter: [{ field: 'assignedResourceID', op: 'eq', value: 101 }, { field: 'startDateTime', op: 'lt', value: '2026-09-11T00:00:00Z' }, { field: 'endDateTime', op: 'gte', value: '2026-09-10T00:00:00Z' }], MaxRecords: 100 } };
  await s.transport.request(principal, query);
  for (const operation of ['ConfigurationItems.get', 'Contacts.get', 'Tasks.get', 'Projects.get'] as const) await s.transport.request(principal, { operation, method: 'GET', path: `${operation.split('.')[0]}/123`, beforeDispatch: async () => {} });
  const other = structuredClone(query.body) as { filter: { field: string; op: string; value: unknown }[]; MaxRecords: number }; other.filter[0]!.value = 102;
  await assert.rejects(s.transport.request(principal, { ...query, body: other }), code('invalid_input'));
  await assert.rejects(s.transport.request(principal, { operation: 'Tasks.get', method: 'GET', path: 'Tasks/123', body: {}, beforeDispatch: async () => {} }), code('invalid_input'));
  assert.equal(s.seen.length, 5);
});

test('missing, stale, changed or incapable employee identity fails before any network request', async () => {
  for (const [options, p] of [
    [{ revalidatePrincipal: undefined }, principal],
    [{ revalidatePrincipal: async () => ({ ...principal, active: false }) }, principal],
    [{ revalidatePrincipal: async () => ({ ...principal, companyIds: [20] }) }, principal],
    [{ revalidatePrincipal: async () => ({ ...principal, resourceVerifiedAt: new Date(0).toISOString() }) }, principal],
    [{}, { ...principal, capabilities: ['operational.read'] }],
    [{}, { ...principal, resourceId: 0 }],
  ] as [Partial<HttpTechnicianTransportOptions>, Principal][]) {
    const s = setup(undefined, options);
    await assert.rejects(s.transport.request(p, patch())); assert.equal(s.seen.length, 0);
  }
});

test('guard exceptions, guard timeouts and post-guard identity changes have no mutation dispatch', async () => {
  for (const guard of [async () => { throw new AppError('precondition_failed', 'Synthetic stale plan.'); }, async () => { throw new Error('secret-canary'); }, () => new Promise<void>(() => {})]) {
    const s = setup(undefined, { timeoutMs: 10 });
    await assert.rejects(s.transport.request(principal, patch(guard)), error => error instanceof AppError && error.code !== 'unknown_outcome' && !error.message.includes('secret-canary'));
    assert.equal(s.seen.length, 0);
  }
  let changed = false;
  const s = setup(undefined, { revalidatePrincipal: async p => changed ? { ...p, active: false } : p });
  await assert.rejects(s.transport.request(principal, patch(async () => { changed = true; })), code('identity_mapping_invalid'));
  assert.equal(s.seen.length, 0);
});

test('PATCH transport uncertainty and malformed/oversized bodies are never replayed', async () => {
  for (const handler of [
    () => { throw new Error('Connection lost after possible commit, server-secret'); }, () => json({}, 503),
    () => new Response('invalid JSON'), () => new Response('x'.repeat(2_000_001)),
    () => new Response(null, { status: 302, headers: { location: 'https://untrusted.invalid' } }),
    () => new Promise<Response>(() => {}),
  ]) {
    const s = setup(handler, { timeoutMs: 10 });
    await assert.rejects(s.transport.request(principal, patch()), error => error instanceof AppError && error.code === 'unknown_outcome' && !error.message.includes('server-secret'));
    assert.equal(s.seen.length, 1);
  }
});

test('definitive upstream rejections stay definitive and POST query failures stay read failures', async () => {
  for (const [status, expected] of [[400, 'invalid_input'], [403, 'forbidden'], [404, 'not_found_or_inaccessible'], [409, 'conflict'], [422, 'invalid_input'], [429, 'throttled']] as const) {
    const s = setup(() => json({}, status));
    await assert.rejects(s.transport.request(principal, patch()), code(expected)); assert.equal(s.seen.length, 1);
  }
  const s = setup(() => { throw new Error('Read failed'); });
  await assert.rejects(s.transport.request(principal, history()), code('dependency_unavailable')); assert.equal(s.seen.length, 1);
});

test('identity and dispatch guard are rechecked only after shared capacity becomes available', async () => {
  let revoked = false, guards = 0;
  const s = setup(undefined, { revalidatePrincipal: async p => revoked ? { ...p, active: false } : p });
  const first = await requestScheduler.acquire(actorKey(principal), 1000), second = await requestScheduler.acquire(actorKey(principal), 1000);
  try {
    const pending = s.transport.request(principal, patch(async () => { guards++; }));
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(guards, 0);
    revoked = true; first();
    await assert.rejects(pending, code('identity_mapping_invalid')); assert.equal(s.seen.length, 0);
  } finally { first(); second(); }
});

function qualification(p: Principal): OperationQualification {
  return { operation: 'Tickets.get', evidenceSource: 'live', headerAccepted: true, permissionEnforced: true, tenantId: p.tenantId, policyVersion: p.policyVersion, resourceIds: [p.resourceId], testIds: ['allow', 'deny'], evidenceReference: 'Synthetic test evidence, never live configuration.', qualifiedAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString() };
}
test('two same-actor and four cross-actor guarded patches can perform nested reads without deadlock or exceeding shared capacity', async () => {
  const actors = [principal, { ...principal, objectId: 'employee-2', resourceId: 102 }, { ...principal, objectId: 'employee-3', resourceId: 103 }, { ...principal, objectId: 'employee-4', resourceId: 104 }];
  let active = 0, maxActive = 0, count = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    active++; maxActive = Math.max(maxActive, active); count++;
    await new Promise<void>(resolve => setTimeout(resolve, 3)); active--;
    return init?.method === 'PATCH' ? json({ itemId: 1001 }) : json({ item: { id: 1001, companyID: 10 } });
  };
  const base = new HttpAutotaskAdapter({ baseUrl, username: 'server-user', secret: 'server-secret', integrationCode: 'server-integration', cursorSecret: 'test-cursor-secret-at-least-thirty-two-bytes', qualifications: actors.map(qualification), revalidatePrincipal: async p => p, fetch: fetcher, now: () => NOW, timeoutMs: 500, queueTimeoutMs: 500 });
  const transport = new HttpTechnicianTransport({ baseUrl, username: 'server-user', secret: 'server-secret', integrationCode: 'server-integration', revalidatePrincipal: async p => p, fetch: fetcher, now: () => NOW, timeoutMs: 500, queueTimeoutMs: 500 });
  for (const group of [[principal, principal], actors]) await Promise.all(group.map(p => transport.request(p, patch(async () => { await base.get(p, 'Tickets', 1001); await base.get(p, 'Tickets', 1001); }))));
  assert.equal(count, 18); assert.ok(maxActive <= 4); assert.equal(active, 0);
});

test('parallel nested admission is rejected and a live borrowed read prevents outer dispatch', async () => {
  const s = setup(); let releaseBorrow: (() => void) | undefined;
  try {
    await assert.rejects(s.transport.request(principal, patch(async () => {
      releaseBorrow = await requestScheduler.acquire(actorKey(principal), 100);
      await assert.rejects(requestScheduler.acquire(actorKey(principal), 100), code('throttled'));
    })), code('throttled'));
    assert.equal(s.seen.length, 0);
    // The failed outer request still owns its single permit until the existing
    // borrow exits; it cannot admit a third same-actor network operation.
    const another = await requestScheduler.acquire(actorKey(principal), 100);
    try { await assert.rejects(requestScheduler.acquire(actorKey(principal), 5), code('throttled')); }
    finally { another(); }
  } finally { releaseBorrow?.(); }
});

test('late asynchronous work cannot borrow an expired lease and must reenter normal admission', async () => {
  let wake!: () => void, late!: Promise<void>;
  const signal = new Promise<void>(resolve => { wake = resolve; });
  await requestScheduler.runWithLease(actorKey(principal), 100, async () => {
    late = (async () => { await signal; await assert.rejects(requestScheduler.acquire(actorKey(principal), 5), code('throttled')); })();
  });
  const first = await requestScheduler.acquire(actorKey(principal), 100), second = await requestScheduler.acquire(actorKey(principal), 100);
  try { wake(); await late; } finally { first(); second(); }
});

function deferredBudget() {
  let release!:()=>void,entered!:()=>void;
  const enteredWait=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;}),calls:BudgetRequest[]=[];
  const budget:RequestBudgetPort={take:async request=>{calls.push(request);entered();await wait;},status:()=>new FixtureUnlimitedRequestBudget().status()};
  return{budget,calls,enteredWait,release};
}
test('technician denied budget permits stop before the native fetch and before dispatch preflight',async()=>{
  for(const operation of [patch,history]){let guards=0,takes=0;const s=setup(undefined,{requestBudget:{take:async()=>{takes++;throw new RequestBudgetError('shared_pressure');},status:()=>new FixtureUnlimitedRequestBudget().status()}});
    await assert.rejects(s.transport.request(principal,operation(async()=>{guards++;})),code('throttled'));assert.equal(s.seen.length,0);assert.equal(guards,0);assert.equal(takes,1);
  }
});
test('technician revalidates identity and operation eligibility after a budget wait before read or PATCH fetch',async()=>{
  for(const operation of [patch,history])for(const change of ['identity','eligibility'] as const){
    const gate=deferredBudget();let active=true,eligible=true,guards=0;
    const s=setup(undefined,{requestBudget:gate.budget,revalidatePrincipal:async p=>({...p,active})});
    const pending=s.transport.request(principal,operation(async()=>{guards++;if(!eligible)throw new AppError('precondition_failed','Synthetic eligibility changed while waiting.');}));
    await gate.enteredWait;assert.equal(guards,0);if(change==='identity')active=false;else eligible=false;gate.release();
    await assert.rejects(pending,code(change==='identity'?'identity_mapping_invalid':'precondition_failed'));assert.equal(s.seen.length,0);assert.equal(gate.calls[0]?.actorKey,actorKey(principal));
  }
});
test('technician identity verification that expires while waiting for budget cannot reach fetch',async()=>{
  const gate=deferredBudget();let clock=NOW;
  const s=setup(undefined,{requestBudget:gate.budget,now:()=>clock});const pending=s.transport.request(principal,patch());
  await gate.enteredWait;clock+=60001;gate.release();await assert.rejects(pending,code('identity_validation_unavailable'));assert.equal(s.seen.length,0);
});
test('technician budget timeout aborts waiting admission and late completion cannot send a PATCH',async()=>{
  const gate=deferredBudget(),s=setup(undefined,{requestBudget:gate.budget,timeoutMs:10});const pending=s.transport.request(principal,patch());
  await gate.enteredWait;await assert.rejects(pending,code('dependency_unavailable'));assert.equal(gate.calls[0]?.signal?.aborted,true);gate.release();
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(s.seen.length,0);
  const first=await requestScheduler.acquire(actorKey(principal),100),second=await requestScheduler.acquire(actorKey(principal),100);first();second();
});

test('ticket due-date transport permits only offset-qualified native timestamps',async()=>{
 const s=setup();await s.transport.request(principal,{...patch(),body:{id:1001,dueDateTime:'2026-09-25T22:00:00.000Z'}});
 assert.deepEqual(JSON.parse(String(s.seen[0]!.init.body)),{id:1001,dueDateTime:'2026-09-25T22:00:00.000Z'});
 for(const dueDateTime of [null,'2026-09-25','2026-09-25T17:00:00',42])await assert.rejects(s.transport.request(principal,{...patch(),body:{id:1001,dueDateTime}}),code('invalid_input'));
 assert.equal(s.seen.length,1);
});

test('location GET and native query continuation stay on exact reviewed routes',async()=>{
  const s=setup(()=>json({items:[],pageDetails:{nextPageUrl:null}}));
  await s.transport.request(principal,{operation:'CompanyLocations.get',method:'GET',path:'CompanyLocations/6501',beforeDispatch:async()=>{}});
  const query:TechnicianHttpRequest={operation:'Tasks.query',method:'POST',path:'Tasks/query',body:{filter:[{field:'assignedResourceID',op:'eq',value:101},{field:'startDateTime',op:'lt',value:'2026-09-11T00:00:00Z'},{field:'endDateTime',op:'gte',value:'2026-09-10T00:00:00Z'}],MaxRecords:100},beforeDispatch:async()=>{},continuation:baseUrl+'Tasks/query/next?paging=page2'};
  await s.transport.request(principal,query);assert.equal(s.seen[1]!.init.method,'GET');assert.equal(s.seen[1]!.init.body,undefined);
  for(const continuation of ['https://attacker.invalid/Tasks/query/next?paging=x',baseUrl+'Contacts/query/next?paging=x',baseUrl+'Tasks/query/next?paging=x&paging=y',baseUrl+'Tasks/query/next?paging=x#secret',baseUrl.replace('https://','https://user:pass@')+'Tasks/query/next?paging=x'])await assert.rejects(s.transport.request(principal,{...query,continuation}),code('invalid_input'));
  await assert.rejects(s.transport.request(principal,{...patch(),continuation:query.continuation}),code('invalid_input'));assert.equal(s.seen.length,2);
});
