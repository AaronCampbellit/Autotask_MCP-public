import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, type Principal, type TicketWorkMetadata } from '../packages/contracts/src/index.js';
import { assertWorkMetadata, noteInputSchema, resolveNote, resolveTime, timeInputSchema } from '../packages/resolution/src/index.js';

const principal: Principal = {
  tenantId: 'tenant-a', objectId: 'employee-a', resourceId: 101, mappingVersion: 2,
  policyVersion: 'policy-3', capabilities: ['operational.read', 'tickets.write', 'time.self'],
  companyIds: [10], active: true, resourceVerifiedAt: new Date().toISOString(),
};
const metadata = (): TicketWorkMetadata => ({
  version: 'metadata-5', source: 'fixture', ticketId: 1001, resourceId: 101,
  mappingVersion: 2, policyVersion: 'policy-3', validUntil: new Date(Date.now() + 60_000).toISOString(),
  note: { titleRequired: false, attributionField: 'creatorResourceID', defaultTypeId: 30,
    types: [{ id: 30, label: 'Technical   Update', active: true }, { id: 31, label: 'Retired type', active: false }],
    audiences: [{ audience: 'internal', publish: 0, label: 'Private staff', active: true },
      { audience: 'customer', publish: 73, label: 'Customer publication', active: true }] },
  time: { eligible: true, defaultRoleId: 40, defaultWorkTypeId: 50,
    roles: [{ id: 40, label: 'Support Engineer', active: true }, { id: 41, label: 'Retired role', active: false }],
    workTypes: [{ id: 50, label: 'Remote Support', active: true }, { id: 51, label: 'Retired work', active: false }] },
  defaultRuleVersion: 'reviewed-defaults-7',
});
const note = { text: '  Replaced the cable; link is stable.  ', audience: 'internal' as const };
const time = { work_date: '2026-09-10', timezone: 'America/Chicago', minutes: 30, summary: 'Cable replacement and testing.' };
const code = (expected: string) => (error: unknown): boolean => error instanceof AppError && error.code === expected;

test('note schemas require actual text and audience and reject finance or raw API overrides', () => {
  for (const bad of [
    {}, { audience: 'internal' }, { ...note, text: ' \n ' }, { text: 'Work performed.' },
    { ...note, audience: 'public' }, { ...note, publish: 1 }, { ...note, noteType: 1 },
    { ...note, isNonBillable: true }, { ...note, text: 'a'.repeat(32_001) },
    { ...note, title: 'a'.repeat(251) }, { ...note, note_type: 'a'.repeat(101) },
  ]) assert.equal(noteInputSchema.safeParse(bad).success, false);
  assert.equal(noteInputSchema.safeParse({ ...note, text: 'a'.repeat(32_000), title: 'a'.repeat(250) }).success, true);
});

test('time schemas reject missing facts, delegated resource, start times and finance overrides', () => {
  for (const missing of ['work_date', 'timezone', 'minutes', 'summary']) {
    const input: Record<string, unknown> = { ...time };
    delete input[missing];
    assert.equal(timeInputSchema.safeParse(input).success, false);
  }
  for (const extra of [{ resourceID: 999 }, { resource: 'someone else' }, { startDateTime: '2026-09-10T10:00:00Z' },
    { hourlyBillingRate: 500 }, { isNonBillable: true }, { contractID: 5 }, { showOnInvoice: true }, { billingCodeID: 50 }]) {
    assert.equal(timeInputSchema.safeParse({ ...time, ...extra }).success, false);
  }
  for (const minutes of [0, -1, 1.5, 1441, NaN, Infinity, '30']) {
    assert.equal(timeInputSchema.safeParse({ ...time, minutes }).success, false);
  }
  assert.equal(timeInputSchema.safeParse({ ...time, minutes: 1 }).success, true);
  assert.equal(timeInputSchema.safeParse({ ...time, minutes: 1440 }).success, true);
  assert.equal(timeInputSchema.safeParse({ ...time, summary: ' \n ' }).success, false);
  assert.equal(timeInputSchema.safeParse({ ...time, internal_notes: 'a'.repeat(32_001) }).success, false);
});

test('calendar validation handles leap years and does not normalize impossible dates', () => {
  for (const work_date of ['2024-02-29', '2000-02-29', '2026-12-31']) {
    assert.equal(timeInputSchema.safeParse({ ...time, work_date }).success, true);
  }
  for (const work_date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01',
    '2026-01-00', '2026-1-01', '0000-01-01', '2026-09-10T00:00:00Z', 'today']) {
    assert.equal(timeInputSchema.safeParse({ ...time, work_date }).success, false);
  }
});

test('timezones must be explicit supported IANA regions or UTC, never offsets or abbreviations', () => {
  for (const timezone of ['America/Chicago', 'Pacific/Kiritimati', 'Etc/GMT+12', 'Europe/London', 'UTC']) {
    assert.equal(timeInputSchema.safeParse({ ...time, timezone }).success, true);
  }
  for (const timezone of ['', 'CST', '+05:30', 'America/Imaginary', 'server', ' America/Chicago ']) {
    assert.equal(timeInputSchema.safeParse({ ...time, timezone }).success, false);
  }
});

test('note resolution uses custom reviewed audience IDs and preserves supplied text and source labels', () => {
  const current = metadata();
  assertWorkMetadata(current, principal, 1001, 'fixture');
  const resolved = resolveNote({ ...note, note_type: ' technical update ' }, current);
  assert.deepEqual(resolved.payload, { description: note.text, noteType: 30, publish: 0 });
  assert.equal(resolved.audience, 'internal');
  assert.deepEqual(resolved.defaults, [{ field: 'note_type', source: 'explicit', rule_version: 'reviewed-defaults-7', id: 30, label: 'Technical   Update' }]);
  assert.equal(resolveNote({ ...note, audience: 'customer' }, current).payload.publish, 73);
});

test('note title is required only by reviewed metadata and is never fabricated', () => {
  const current = metadata();
  assert.ok(!Object.hasOwn(resolveNote(note, current).payload, 'title'));
  current.note.titleRequired = true;
  assert.throws(() => resolveNote(note, current), code('invalid_input'));
  assert.equal(resolveNote({ ...note, title: 'Cable replacement' }, current).payload.title, 'Cable replacement');
  assert.throws(() => resolveNote({ ...note, title: '  ' }, current), code('invalid_input'));
});

test('explicit missing or inactive options never fall back to reviewed defaults', () => {
  const current = metadata();
  for (const note_type of ['Retired type', 'Missing type']) {
    assert.throws(() => resolveNote({ ...note, note_type }, current), code('invalid_input'));
  }
  for (const extra of [{ role: 'Retired role' }, { role: 'Unknown role' },
    { work_type: 'Retired work' }, { work_type: 'Unknown work' }]) {
    assert.throws(() => resolveTime({ ...time, ...extra }, current), code('invalid_input'));
  }
});

test('normalized duplicate active labels and duplicate identities are ambiguous', () => {
  const current = metadata();
  current.note.types.push({ id: 32, label: ' technical update ', active: true });
  assert.throws(() => resolveNote({ ...note, note_type: 'TECHNICAL UPDATE' }, current), code('missing_metadata'));
  const duplicateRole = metadata();
  duplicateRole.time.roles.push({ id: 42, label: ' support  engineer ', active: true });
  assert.throws(() => resolveTime({ ...time, role: 'Support Engineer' }, duplicateRole), code('missing_metadata'));
  const duplicateId = metadata();
  duplicateId.time.workTypes.push({ id: 50, label: 'Different label for same ID', active: true });
  assert.throws(() => resolveTime(time, duplicateId), code('missing_metadata'));
  assert.throws(() => resolveTime({ ...time, work_type: 'Remote Support' }, duplicateId), code('missing_metadata'));
});

test('omitted labels require unique active reviewed default IDs and record their provenance', () => {
  const current = metadata();
  const resolved = resolveTime(time, current);
  assert.deepEqual(resolved.defaults, [
    { field: 'role', source: 'reviewed_default', rule_version: 'reviewed-defaults-7', id: 40, label: 'Support Engineer' },
    { field: 'work_type', source: 'reviewed_default', rule_version: 'reviewed-defaults-7', id: 50, label: 'Remote Support' },
  ]);
  assert.equal(resolveNote(note, current).defaults[0]?.source, 'reviewed_default');
  for (const defaultRoleId of [undefined, 999, 41]) {
    const bad = metadata(); bad.time.defaultRoleId = defaultRoleId;
    assert.throws(() => resolveTime(time, bad), code('missing_metadata'));
  }
  for (const defaultTypeId of [undefined, 999, 31]) {
    const bad = metadata(); bad.note.defaultTypeId = defaultTypeId;
    assert.throws(() => resolveNote(note, bad), code('missing_metadata'));
  }
  const noDefaults = metadata();
  delete noDefaults.time.defaultRoleId; delete noDefaults.time.defaultWorkTypeId;
  assert.equal(resolveTime({ ...time, role: 'support engineer', work_type: 'REMOTE SUPPORT' }, noDefaults).defaults[0]?.source, 'explicit');
});

test('time payload preserves actual minutes and local date as a date container without invented start/end', () => {
  const current = metadata();
  const resolved = resolveTime({ ...time, timezone: 'Pacific/Kiritimati', minutes: 1, internal_notes: '' }, current);
  assert.deepEqual(resolved.payload, {
    resourceID: 101, roleID: 40, billingCodeID: 50, hoursWorked: 1 / 60,
    dateWorked: '2026-09-10T00:00:00Z', summaryNotes: time.summary, internalNotes: '',
  });
  assert.equal(resolved.workDate, '2026-09-10');
  assert.equal(resolved.timezone, 'Pacific/Kiritimati');
  assert.equal(resolved.minutes, 1);
  assert.ok(!Object.hasOwn(resolved.payload, 'startDateTime'));
  assert.ok(!Object.hasOwn(resolved.payload, 'endDateTime'));
  assert.ok(!Object.hasOwn(resolveTime(time, current).payload, 'internalNotes'));
  current.time.eligible = false;
  assert.throws(() => resolveTime(time, current), code('precondition_failed'));
});

test('metadata checks bind source, ticket, resource, mapping and policy, and expire at the boundary', () => {
  const current = metadata();
  assertWorkMetadata(current, principal, 1001, 'fixture');
  for (const patch of [{ source: 'Autotask' }, { ticketId: 1002 }, { resourceId: 999 },
    { mappingVersion: 3 }, { policyVersion: 'new-policy' }]) {
    assert.throws(() => assertWorkMetadata({ ...current, ...patch }, principal, 1001, 'fixture'), code('precondition_failed'));
  }
  assert.throws(() => assertWorkMetadata(current, principal, 1001, 'fixture', Date.parse(current.validUntil)), code('precondition_failed'));
  assert.throws(() => assertWorkMetadata(current, { ...principal, active: false }, 1001, 'fixture'), code('identity_mapping_invalid'));
  assert.throws(() => assertWorkMetadata(current, principal, 0, 'fixture'), code('precondition_failed'));
  const expired = { ...current, validUntil: new Date(Date.now() - 1000).toISOString() };
  assert.throws(() => resolveNote(note, expired), code('precondition_failed'));
  assert.throws(() => resolveTime(time, expired), code('precondition_failed'));
});

test('malformed metadata and audience collisions fail with sanitized errors', () => {
  const canary = 'SECRET-METADATA-CANARY';
  for (const candidate of [null, { ...metadata(), source: canary }, { ...metadata(), version: '' },
    { ...metadata(), time: { ...metadata().time, eligible: 'true' } },
    { ...metadata(), note: { ...metadata().note, attributionField: 'anyMatchingResource' } },
    { ...metadata(), note: { ...metadata().note, types: [{ id: NaN, label: canary, active: true }] } }]) {
    assert.throws(() => assertWorkMetadata(candidate, principal, 1001, 'fixture'), (error: unknown) => {
      assert.ok(code('missing_metadata')(error));
      assert.ok(error instanceof Error && !error.message.includes(canary));
      return true;
    });
  }
  const duplicateAudience = metadata();
  duplicateAudience.note.audiences.push({ audience: 'internal', publish: 44, label: canary, active: true });
  assert.throws(() => resolveNote(note, duplicateAudience), code('missing_metadata'));
  const samePublish = metadata(); samePublish.note.audiences[1]!.publish = 0;
  assert.throws(() => resolveNote(note, samePublish), code('missing_metadata'));
  const inactiveAudience = metadata(); inactiveAudience.note.audiences[0]!.active = false;
  assert.throws(() => resolveNote(note, inactiveAudience), code('missing_metadata'));
  assert.throws(() => resolveNote({ ...note, note_type: canary }, metadata()), (error: unknown) => {
    assert.ok(error instanceof Error && !error.message.includes(canary)); return true;
  });
});

test('explicit ticket time interval preserves instants and rejects missing/mismatched facts', () => {
  const input = {...time,start_datetime:'2026-09-10T08:00:00-05:00',end_datetime:'2026-09-10T08:30:00-05:00'};
  const result = resolveTime(input, metadata());
  assert.equal(result.payload.startDateTime,'2026-09-10T13:00:00.000Z');
  assert.equal(result.payload.endDateTime,'2026-09-10T13:30:00.000Z');
  for (const bad of [{...input,minutes:60},{...input,work_date:'2026-09-11'},{...input,end_datetime:'2026-09-10T07:30:00-05:00'}]) assert.throws(()=>resolveTime(bad,metadata()),code('invalid_input'));
  const dst=resolveTime({...input,work_date:'2026-11-01',minutes:60,start_datetime:'2026-11-01T01:30:00-05:00',end_datetime:'2026-11-01T01:30:00-06:00'},metadata());
  assert.equal(dst.payload.hoursWorked,1);
});

test('time anchors derive the missing endpoint and preserve chat/calendar/current-time provenance', () => {
  const start=resolveTime({...time,start_datetime:'2026-09-10T09:00:00-05:00',timing_source:'calendar'},metadata());
  assert.equal(start.payload.endDateTime,'2026-09-10T14:30:00.000Z');
  assert.equal(start.timingBasis,'start_plus_duration'); assert.equal(start.timingSource,'calendar');
  const end=resolveTime({...time,minutes:60,end_datetime:'2026-09-10T10:00:00-05:00',timing_source:'current_time'},metadata());
  assert.equal(end.payload.startDateTime,'2026-09-10T14:00:00.000Z');
  assert.equal(end.timingBasis,'end_minus_duration');assert.equal(end.timingSource,'current_time');
  const midnight=resolveTime({...time,end_datetime:'2026-09-11T00:15:00-05:00',timing_source:'chat'},metadata());
  assert.equal(midnight.payload.startDateTime,'2026-09-11T04:45:00.000Z');
  assert.throws(()=>resolveTime({...time,timing_source:'calendar'},metadata()),code('invalid_input'));
});
