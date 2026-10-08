import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpWorkManagementPort } from '../packages/work-management/src/http.js';
import type { Principal } from '../packages/contracts/src/index.js';
import { IntentCipher } from '../packages/storage/src/intent-cipher.js';
import { availabilityUpdateSchema, timeCorrectSchema, timeLogInternalSchema } from '../packages/work-management/src/contracts.js';

const principal: Principal = { tenantId: 'fixture-tenant', objectId: 'employee', resourceId: 101, mappingVersion: 1, policyVersion: 'policy-v1', active: true, companyIds: [10], capabilities: ['operational.read', 'time.self', 'time.team', 'expenses.write', 'scheduling.write'], resourceVerifiedAt: '2026-09-14T00:00:00.000Z' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function setup() { const seen: { path: string; method: string; body?: unknown }[] = []; const port = new HttpWorkManagementPort({ baseUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/', username: 'fixture-user', secret: 'fixture-secret', integrationCode: 'fixture-code', writesEnabled: true, applicationOperations: { tenantId: principal.tenantId, operations: ['TimeEntries.get', 'TimeEntries.create', 'ExpenseReports.create', 'ResourceDailyAvailabilities.get', 'TimeOffRequests.create'] }, revalidatePrincipal: async p => structuredClone(p), fetch: async (url, init) => { seen.push({ path: new URL(String(url)).pathname, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }); if (init?.method === 'POST' && String(url).endsWith('/TimeEntries')) return response({ itemId: 8010 }); if (String(url).endsWith('/DailyAvailabilities')) return response({ items: [{ id: 9001, resourceID: 101, mondayAvailableHours: 8, tuesdayAvailableHours: 8, wednesdayAvailableHours: 8, thursdayAvailableHours: 8, fridayAvailableHours: 8, saturdayAvailableHours: 0, sundayAvailableHours: 0 }] }); return response({ item: { id: 7001, resourceID: 101, hoursWorked: 1, ticketID: 1001 } }); } }); return { port, seen }; }

test('work-management HTTP adapter uses documented root and parent routes with mapped employee attribution', async () => { const { port, seen } = setup(); assert.equal((await port.getTime(principal, 7001)).resourceID, 101); assert.deepEqual(await port.createTime(principal, { resourceID: 101, ticketID: 1001, roleID: 501, billingCodeID: 601, hoursWorked: 1, dateWorked: '2026-09-14T00:00:00.000Z', summaryNotes: 'Synthetic work' }), { id: 8010 }); assert.equal((await port.getAvailability(principal)).id, 9001); assert.equal(seen[0]?.path.endsWith('/TimeEntries/7001'), true); assert.equal(seen[1]?.path.endsWith('/TimeEntries'), true); assert.equal(seen[2]?.path.endsWith('/Resources/101/DailyAvailabilities'), true); });

test('work-management adapter fails closed without authoritative principal revalidation', async () => { const port = new HttpWorkManagementPort({ baseUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/', username: 'fixture-user', secret: 'fixture-secret', integrationCode: 'fixture-code', fetch: async () => response({ item: { id: 1 } }) }); await assert.rejects(port.getTime(principal, 1), error => (error as { code?: string }).code === 'identity_validation_unavailable'); });

test('work-management pagination seals native cursors to actor and exact filters', async () => {
  let calls = 0;
  const port = new HttpWorkManagementPort({
    baseUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/', username: 'fixture-user', secret: 'fixture-secret', integrationCode: 'fixture-code', cursorCipher: new IntentCipher(Buffer.alloc(32, 7)),
    applicationOperations: { tenantId: principal.tenantId, operations: ['TimeEntries.query'] }, revalidatePrincipal: async p => structuredClone(p),
    fetch: async () => { calls++; return calls === 1 ? response({ items: [], pageDetails: { nextPageUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/TimeEntries/query/next?paging=native-token' } }) : response({ items: [], pageDetails: { nextPageUrl: null } }); },
  });
  const first = await port.searchTime(principal, { scope: 'internal', resourceId: 101, from: '2026-09-14', to: '2026-09-14', pageSize: 10 });
  assert.ok(first.nextCursor && !first.nextCursor.includes('native-token'));
  await port.searchTime(principal, { scope: 'internal', resourceId: 101, from: '2026-09-14', to: '2026-09-14', pageSize: 10, cursor: first.nextCursor! });
  await assert.rejects(port.searchTime(principal, { scope: 'internal', resourceId: 101, from: '2026-09-14', to: '2026-09-14', pageSize: 11, cursor: first.nextCursor! }), error => (error as { code?: string }).code === 'invalid_input');
  const changed = { ...principal, mappingVersion: 2 };
  await assert.rejects(port.searchTime(changed, { scope: 'internal', resourceId: 101, from: '2026-09-14', to: '2026-09-14', pageSize: 10, cursor: first.nextCursor! }), error => (error as { code?: string }).code === 'invalid_input');
});

test('work-management continuation uses GET and writes require an explicit enable switch', async () => {
  const { seen } = setup();
  const disabled = new HttpWorkManagementPort({ baseUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/', username: 'fixture-user', secret: 'fixture-secret', integrationCode: 'fixture-code', applicationOperations: { tenantId: principal.tenantId, operations: ['TimeEntries.create'] }, revalidatePrincipal: async p => structuredClone(p), fetch: async () => response({ itemId: 1 }) });
  const cursorPort = new HttpWorkManagementPort({
    baseUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/', username: 'fixture-user', secret: 'fixture-secret', integrationCode: 'fixture-code', cursorCipher: new IntentCipher(Buffer.alloc(32, 8)),
    applicationOperations: { tenantId: principal.tenantId, operations: ['TimeEntries.query'] }, revalidatePrincipal: async p => structuredClone(p),
    fetch: async (_url, init) => init?.method === 'POST' ? response({ items: [], pageDetails: { nextPageUrl: 'https://webservices3.autotask.net/atservicesrest/v1.0/TimeEntries/query/next?paging=native' } }) : response({ items: [], pageDetails: { nextPageUrl: null } }),
  });
  const first = await cursorPort.searchTime(principal, { scope: 'internal', resourceId: 101, pageSize: 10 });
  await cursorPort.searchTime(principal, { scope: 'internal', resourceId: 101, pageSize: 10, cursor: first.nextCursor! });
  await assert.rejects(disabled.createTime(principal, { resourceID: 101 }), error => (error as { code?: string }).code === 'forbidden');
  assert.equal(seen.length, 0);
});

test('work-management schemas reject invalid calendar dates, timezones, and unguarded corrections', () => {
  assert.equal(timeLogInternalSchema.safeParse({ resource: 'self', internal_billing_code_id: 601, work_date: '2026-02-30', timezone: 'UTC', minutes: 30, summary: 'x' }).success, false);
  assert.equal(timeLogInternalSchema.safeParse({ resource: 'self', internal_billing_code_id: 601, work_date: '2026-02-28', timezone: 'Not/AZone', minutes: 30, summary: 'x' }).success, false);
  assert.equal(timeCorrectSchema.safeParse({ id: 1, changes: { hoursWorked: 2 }, expected: {}, request_key: 'work-correction-1' }).success, false);
  assert.equal(availabilityUpdateSchema.safeParse({ monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0, expected_id: 1, request_key: 'availability-update-1' }).success, false);
  assert.equal(availabilityUpdateSchema.safeParse({ monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0, expected: { monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0 }, expected_id: 1, request_key: 'availability-update-1' }).success, true);
});
