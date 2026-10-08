import { validTimeInterval } from '../../resolution/src/time-interval.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, actorKey, positiveId, type AutotaskPort, type DataRecord, type Entity, type Filter, type Principal, type QueryRequest, type TicketNoteCreate, type TicketTimeCreate, type TicketWorkMetadata } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope } from '../../policy/src/index.js';
import { assertWorkMetadata } from '../../resolution/src/index.js';

/** Fictitious records only. This adapter never opens a network connection. */
export class FixtureAutotaskAdapter implements AutotaskPort {
  readonly source = 'fixture' as const;
  readonly records: Record<Entity, DataRecord[]>;
  readonly calls: { resourceId: number; entity: Entity; kind: string }[] = [];
  private readonly secret = randomBytes(32);
  metadataFactory: (p: Principal, ticketId: number) => TicketWorkMetadata = fixtureWorkMetadata;
  constructor(private readonly recheck: (p: Principal) => Promise<Principal>, records?: Record<Entity, DataRecord[]>) {
    this.records = structuredClone(records ?? fixtureRecords());
  }
  private async check(p: Principal) { await this.recheck(p); }
  private binding(p: Principal, r: QueryRequest) {
    return JSON.stringify([actorKey(p), p.mappingVersion, p.policyVersion, p.companyIds, r.entity, r.filters, r.pageSize, r.parentId]);
  }
  private matches(row: DataRecord, filters: Filter[]) {
    return filters.every(f => {
      if (f.op === 'eq') return row[f.field] === f.value;
      if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(row[f.field]);
      if (f.op === 'contains') return String(row[f.field] ?? '').toLowerCase().includes(String(f.value).toLowerCase());
      if (row[f.field] === null || row[f.field] === undefined) return false;
      const left = typeof row[f.field] === 'number' ? row[f.field] as number : Date.parse(String(row[f.field]));
      const right = typeof f.value === 'number' ? f.value : Date.parse(String(f.value));
      return f.op === 'gte' ? left >= right : f.op === 'lt' ? left < right : left <= right;
    });
  }
  async countTickets(p: Principal, filters: Filter[]) {
    await this.check(p);
    this.calls.push({ resourceId: p.resourceId, entity: 'Tickets', kind: 'count' });
    return this.records.Tickets.filter(row => p.companyIds.includes(row.companyID as number) && this.matches(row, filters)).length;
  }
  async query(p: Principal, r: QueryRequest) {
    await this.check(p);
    this.calls.push({ resourceId: p.resourceId, entity: r.entity, kind: 'query' });
    const binding = this.binding(p, r);
    let offset = 0;
    if (r.cursor) {
      try {
        const [body, sig] = r.cursor.split('.');
        const expected = createHmac('sha256', this.secret).update(body!).digest();
        const actual = Buffer.from(sig!, 'base64url');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
        const parsed = JSON.parse(Buffer.from(body!, 'base64url').toString());
        if (parsed.binding !== binding || parsed.expires < Date.now() || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error();
        offset = parsed.offset;
      } catch { throw new AppError('invalid_input', 'Continuation is invalid, expired, or belongs to another request.'); }
    }
    const rows = this.records[r.entity].filter(row => this.matches(row, r.filters)).filter(row => r.entity !== 'TicketNotes' || row.ticketID === r.parentId);
    const items = structuredClone(rows.slice(offset, offset + r.pageSize));
    let nextCursor: string | null = null;
    if (offset + items.length < rows.length) {
      const body = Buffer.from(JSON.stringify({ binding, offset: offset + items.length, expires: Date.now() + 900_000 })).toString('base64url');
      nextCursor = `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
    }
    return { items, nextCursor, fetchedAt: new Date().toISOString() };
  }
  async get(p: Principal, entity: Entity, id: number) {
    await this.check(p);
    this.calls.push({ resourceId: p.resourceId, entity, kind: 'get' });
    const record = this.records[entity].find(row => row.id === id);
    if (!record) throw new AppError('not_found_or_inaccessible', 'Record not found or inaccessible.');
    return structuredClone(record);
  }
  async patchTicket(p: Principal, id: number, changes: Record<string, unknown>) {
    await this.check(p);
    this.calls.push({ resourceId: p.resourceId, entity: 'Tickets', kind: 'patch' });
    const record = this.records.Tickets.find(row => row.id === id);
    if (!record) throw new AppError('not_found_or_inaccessible', 'Record not found or inaccessible.');
    Object.assign(record, changes);
  }
  async ticketWorkMetadata(p: Principal, ticketId: number) {
    await this.check(p); assertCapability(p, 'operational.read');
    const ticket = await this.get(p, 'Tickets', ticketId); assertCompanyScope(p, ticket.companyID);
    return structuredClone(this.metadataFactory(p, ticketId));
  }
  async createTicketNote(p: Principal, ticketId: number, payload: TicketNoteCreate) {
    await this.check(p); assertCapability(p, 'tickets.write');
    const metadata = await this.ticketWorkMetadata(p, ticketId);
    if (!payload || Object.keys(payload).some(k => !['title','description','noteType','publish'].includes(k)) || typeof payload.description !== 'string' || !payload.description.trim() || payload.description.length > 32000 || (payload.title !== undefined && (typeof payload.title !== 'string' || payload.title.length > 250)) || (metadata.note.titleRequired && !payload.title?.trim()) || !metadata.note.types.some(o => o.active && o.id === payload.noteType) || !metadata.note.audiences.some(o => o.active && o.publish === payload.publish)) throw new AppError('invalid_input', 'Invalid note payload.');
    const id = Math.max(3000, ...this.records.TicketNotes.map(row => row.id)) + 1;
    this.records.TicketNotes.push({ id, ticketID: ticketId, ...structuredClone(payload), creatorResourceID: p.resourceId, createDateTime: new Date().toISOString() });
    this.calls.push({ resourceId: p.resourceId, entity: 'TicketNotes', kind: 'create' });
    return { id };
  }
  async getTicketNote(p: Principal, ticketId: number, id: number) {
    await this.check(p); assertCapability(p, 'operational.read');
    const ticket = await this.get(p, 'Tickets', ticketId); assertCompanyScope(p, ticket.companyID);
    const note = await this.get(p, 'TicketNotes', id);
    if (note.ticketID !== ticketId) throw new AppError('not_found_or_inaccessible', 'Note not found or inaccessible.');
    return note;
  }
  async validateTicketTime(inputPrincipal: Principal, ticketId: number, inputPayload: TicketTimeCreate): Promise<void> {
    const p = structuredClone(inputPrincipal), payload = structuredClone(inputPayload);
    await this.check(p); assertCapability(p, 'time.self');
    if (!positiveId(ticketId) || !payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(k => !['resourceID','roleID','billingCodeID','hoursWorked','dateWorked','summaryNotes','internalNotes','startDateTime','endDateTime'].includes(k))
      || !positiveId(payload.resourceID) || !positiveId(payload.roleID) || !positiveId(payload.billingCodeID)
      || !Number.isFinite(payload.hoursWorked) || payload.hoursWorked <= 0 || payload.hoursWorked > 24
      || typeof payload.summaryNotes !== 'string' || !payload.summaryNotes.trim() || payload.summaryNotes.length > 32000
      || (payload.internalNotes !== undefined && (typeof payload.internalNotes !== 'string' || payload.internalNotes.length > 32000))
      || typeof payload.dateWorked !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(payload.dateWorked)
      || !Number.isFinite(Date.parse(payload.dateWorked))
      || new Date(payload.dateWorked).toISOString() !== payload.dateWorked.replace('Z', '.000Z')) {
      throw new AppError('invalid_input', 'Invalid time payload.');
    }
    if (!validTimeInterval(payload.startDateTime, payload.endDateTime, payload.hoursWorked)) throw new AppError('invalid_input','Invalid time interval.');
    if (payload.resourceID !== p.resourceId) throw new AppError('forbidden', 'Time can be recorded only for the signed-in employee.');
    const metadata = await this.ticketWorkMetadata(p, ticketId);
    assertWorkMetadata(metadata, p, ticketId, 'fixture');
    if (!metadata.time.eligible || !metadata.time.roles.some(o => o.active && o.id === payload.roleID)
      || !metadata.time.workTypes.some(o => o.active && o.id === payload.billingCodeID)) {
      throw new AppError('precondition_failed', 'Time entry, role or work type is not eligible for this employee and ticket.');
    }
  }
  async createTicketTime(inputPrincipal: Principal, ticketId: number, inputPayload: TicketTimeCreate) {
    const p = structuredClone(inputPrincipal), payload = structuredClone(inputPayload);
    await this.validateTicketTime(p, ticketId, payload);
    const id = Math.max(4000, ...this.records.TimeEntries.map(row => row.id)) + 1;
    this.records.TimeEntries.push({ id, ticketID: ticketId, ...structuredClone(payload) });
    this.calls.push({ resourceId: p.resourceId, entity: 'TimeEntries', kind: 'create' });
    return { id };
  }
  async getTicketTime(p: Principal, ticketId: number, id: number) {
    await this.check(p); assertCapability(p, 'time.self');
    const ticket = await this.get(p, 'Tickets', ticketId); assertCompanyScope(p, ticket.companyID);
    const entry = await this.get(p, 'TimeEntries', id);
    if (entry.ticketID !== ticketId || entry.resourceID !== p.resourceId) throw new AppError('not_found_or_inaccessible', 'Time entry not found or inaccessible.');
    return entry;
  }
}
export function fixtureWorkMetadata(p: Principal, ticketId: number): TicketWorkMetadata {
  if (!positiveId(ticketId)) throw new AppError('invalid_input', 'Invalid ticket.');
  return { version: 'fixture-work-v1', source: 'fixture', ticketId, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, validUntil: new Date(Date.now() + 3_600_000).toISOString(), defaultRuleVersion: 'fixture-defaults-v1',
    note: { titleRequired: true, attributionField: 'creatorResourceID', types: [{ id: 11, label: 'Work note', active: true }], audiences: [{ audience: 'internal', publish: 701, label: 'Internal', active: true }, { audience: 'customer', publish: 702, label: 'Customer visible', active: true }], defaultTypeId: 11 },
    time: { eligible: true, roles: [{ id: 201, label: 'Technician', active: true }], workTypes: [{ id: 301, label: 'Remote support', active: true }], defaultRoleId: 201, defaultWorkTypeId: 301 }
  };
}
export function fixturePrincipals(): Principal[] {
  return [1, 2].map(i => ({
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: `00000000-0000-4000-8000-00000000000${i}`,
    resourceId: 100 + i, mappingVersion: 1, policyVersion: 'fixture-v1',
    capabilities: i === 1 ? ['operational.read', 'tickets.write', 'time.self', 'time.team', 'scheduling.write'] : ['operational.read'],
    companyIds: [i === 1 ? 10 : 20], active: true, resourceVerifiedAt: new Date().toISOString()
  }));
}
export function fixtureRecords(): Record<Entity, DataRecord[]> {
  return {
    Companies: [{ id: 10, companyName: 'Example Engineering' }, { id: 20, companyName: 'Sample Studio' }],
    Tickets: [
      { id: 1001, ticketNumber: 'T20260910.0001', title: 'Example printer offline', description: 'Fictitious demonstration ticket.', companyID: 10, assignedResourceID: 101, status: 1, estimatedCost: 999, secretCanary: 'NEVER-RETURN' },
      { id: 2001, ticketNumber: 'T20260910.0002', title: 'Sample docking station', companyID: 20, assignedResourceID: 102, status: 1 }
    ],
    TicketNotes: Array.from({ length: 105 }, (_, i) => ({ id: 3000 + i, ticketID: 1001, title: `Example note ${i + 1}`, description: `Fictitious observation ${i + 1}.`, publish: i % 2 === 0 ? 1 : 2, createDateTime: '2026-09-10T15:00:00Z' })),
    TimeEntries: [
      { id: 4001, ticketID: 1001, resourceID: 101, hoursWorked: 0.5, summaryNotes: 'Example troubleshooting.', dateWorked: '2026-09-10T00:00:00Z', hourlyBillingRate: 200 },
      { id: 4002, ticketID: 1001, resourceID: 102, hoursWorked: 0.25, summaryNotes: 'Example follow-up.', dateWorked: '2026-09-10T00:00:00Z' }
    ]
  };
}
