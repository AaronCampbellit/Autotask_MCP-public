import {checkServiceContracts} from './output-contract-assertions.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, actorKey, type Principal } from '../packages/contracts/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { WorkManagementService } from '../packages/work-management/src/index.js';
import { FixtureWorkManagementPort, fixtureWorkManagementRecords } from '../packages/work-management/src/fixtures.js';

function setup(records: ReturnType<typeof fixtureWorkManagementRecords> = fixtureWorkManagementRecords()) {
  const base = fixturePrincipals()[0]!;
  const principal: Principal = { ...base, capabilities: [...base.capabilities, 'expenses.write'] };
  const store = new MemoryPrincipalStore([principal]);
  const journal = new MemoryJournal();
  const adapter = new FixtureAutotaskAdapter(async p => (await store.get(p.tenantId, p.objectId)) ?? principal);
  const core = new TicketWorkflows(adapter, store, journal);
  const port = new FixtureWorkManagementPort(store, records);
  const service = new WorkManagementService(core, port, new IntentCipher(Buffer.alloc(32, 11)));
  checkServiceContracts(service,'work');return { principal, store, journal, adapter, port, service };
}

const timeTask = (request_key: string) => ({ request_key, task_id: 3001, role_id: 501, billing_code_id: 601, work_date: '2026-09-14', timezone: 'UTC', minutes: 30, summary: 'Synthetic task work' });
const timeInternal = (request_key: string) => ({ request_key, internal_billing_code_id: 601, work_date: '2026-09-14', timezone: 'UTC', minutes: 30, summary: 'Synthetic internal work' });

test('task and internal time use caller request keys and replay without duplicate native creates', async () => {
  const s = setup();
  const task = await s.service.logTask(s.principal, timeTask('work-task-key-1'));
  assert.equal(task.status, 'succeeded_verified');
  const internal = await s.service.logInternal(s.principal, timeInternal('work-internal-key-1'));
  assert.equal(internal.status, 'succeeded_verified');
  const before = s.port.records.time.length;
  assert.equal((await s.service.logTask(s.principal, timeTask('work-task-key-1'))).operation_id, task.operation_id);
  assert.equal(s.port.records.time.length, before);
  assert.equal(s.port.calls.filter(c => c.operation === 'TimeEntries.create').length, 2);
  assert.notEqual(task.operation_id, internal.operation_id);
});

test('expense report creation omits readonly status and verifies native In Progress default', async () => {
  const s = setup();
  const result = await s.service.createExpenseReport(s.principal, { name: 'September expenses', week_ending: '2026-09-14', request_key: 'expense-report-key-1' });
  assert.equal(result.status, 'succeeded_verified');
  const report = s.port.records.reports.at(-1)!;
  assert.equal(report.status, 1);
  assert.equal(Object.hasOwn(report, 'status'), true);
  assert.equal(Object.hasOwn(report, 'resourceID'), false);
});

test('expense item preserves false receipt and billable values and rejects mismatched company parent', async () => {
  const records = fixtureWorkManagementRecords();
  records.reports.push({ id: 2100, submitterID: 101, status: 1, name: 'Open report', weekEnding: '2026-09-14T00:00:00.000Z' });
  const s = setup(records);
  const item = await s.service.addExpenseItem(s.principal, { report_id: 2100, expense_date: '2026-09-14', description: 'Synthetic item', category_id: 2, work_type_id: 3, amount: 10, currency_id: 4, payment_type_id: 5, receipt: false, billable: false, request_key: 'expense-item-key-1' });
  assert.equal(item.status, 'succeeded_verified');
  assert.equal(s.port.records.items.at(-1)!.haveReceipt, false);
  assert.equal(s.port.records.items.at(-1)!.isBillableToCompany, false);
  const creates = s.port.calls.filter(c => c.operation === 'ExpenseItems.create').length;
  const broad = { ...s.principal, companyIds: [10, 20] };
  s.store.set(broad);
  await assert.rejects(s.service.addExpenseItem(broad, { report_id: 2100, expense_date: '2026-09-14', description: 'Wrong parent', category_id: 2, work_type_id: 3, amount: 10, currency_id: 4, payment_type_id: 5, receipt: false, billable: false, company_id: 10, ticket_id: 2001, request_key: 'expense-item-key-2' }), (error: unknown) => error instanceof AppError && error.code === 'conflict');
  assert.equal(s.port.calls.filter(c => c.operation === 'ExpenseItems.create').length, creates);
});

test('expense submission remains accepted_unverified when native readback is not Submitted', async () => {
  const records = fixtureWorkManagementRecords();
  records.reports.push({ id: 2200, submitterID: 101, status: 1, name: 'Open report', weekEnding: '2026-09-14T00:00:00.000Z' });
  const s = setup(records);
  const original = s.port.updateExpenseReport.bind(s.port);
  s.port.updateExpenseReport = async (...args) => { const result = await original(...args); s.port.records.reports.find(row => row.id === args[1])!.status = 99; return result; };
  const result = await s.service.submitExpenseReport(s.principal, { report_id: 2200, expected_status: 1, request_key: 'expense-submit-key-1' });
  assert.equal(result.status, 'accepted_unverified');
});

test('time-off cancellation is idempotent for the full input and conflicts on changed target', async () => {
  const records = fixtureWorkManagementRecords();
  records.timeOff.push({ id: 4100, resourceID: 101, requestDate: '2026-09-14T00:00:00.000Z', startTime: '2026-09-14T09:00:00Z', endTime: '2026-09-14T10:00:00Z', hours: 1, status: 1, timeOffRequestType: 7, reason: 'Synthetic' });
  const s = setup(records);
  const input = { id: 4100, expected_status: 1, request_key: 'time-off-cancel-key-1' };
  const first = await s.service.timeOffCancel(s.principal, input);
  assert.equal(first.status, 'succeeded_verified');
  assert.equal((await s.service.timeOffCancel(s.principal, input)).operation_id, first.operation_id);
  await assert.rejects(s.service.timeOffCancel(s.principal, { ...input, id: 4101 }), (error: unknown) => error instanceof AppError && error.code === 'conflict');
  assert.equal(s.port.calls.filter(c => c.operation === 'TimeOffRequests.update').length, 1);
});

test('availability update rejects stale expected fields before dispatch', async () => {
  const s = setup();
  const result = { monday: 7, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0, expected: { monday: 7, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0 }, expected_id: 9001, request_key: 'availability-key-1' };
  await assert.rejects(s.service.updateAvailability(s.principal, result), (error: unknown) => error instanceof AppError && error.code === 'conflict');
  assert.equal(s.port.calls.filter(c => c.operation === 'ResourceDailyAvailabilities.update').length, 0);
});

test('invoiced time cannot be deleted', async () => {
  const records = fixtureWorkManagementRecords();
  records.time.push({ id: 7100, resourceID: 101, hoursWorked: 1, dateWorked: '2026-09-14T00:00:00.000Z', summaryNotes: 'Invoiced', invoiceID: 8000 } as any);
  const s = setup(records);
  await assert.rejects(s.service.deleteTime(s.principal, { id: 7100, expected: { hoursWorked: 1 }, request_key: 'time-delete-key-1' }), (error: unknown) => error instanceof AppError && error.code === 'precondition_failed');
  assert.equal(s.port.calls.filter(c => c.operation === 'TimeEntries.delete').length, 0);
});
