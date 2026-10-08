import { assertArea } from '../../policy/src/areas.js';
import { AppError, positiveId, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { assertCapability, reauthorize } from '../../policy/src/index.js';
import type { ChecklistField, ChecklistItem, ChecklistPage, ChecklistPort } from './contracts.js';

export interface FixtureChecklistRecords { items: ChecklistItem[] }
export const fixtureChecklistFields: ChecklistField[] = [
  { name: 'id', dataType: 'integer', isReadOnly: true, isRequired: true },
  { name: 'completedByResourceID', dataType: 'integer', isReadOnly: true },
  { name: 'completedDateTime', dataType: 'datetime', isReadOnly: true },
  { name: 'isCompleted', dataType: 'boolean', isReadOnly: false }, { name: 'isImportant', dataType: 'boolean', isReadOnly: false },
  { name: 'itemName', dataType: 'string', isReadOnly: false, isRequired: true }, { name: 'knowledgebaseArticleID', dataType: 'integer', isReadOnly: false },
  { name: 'position', dataType: 'integer', isReadOnly: false }, { name: 'ticketID', dataType: 'integer', isReadOnly: true, isRequired: true },
];
export function fixtureChecklistRecords(): FixtureChecklistRecords { return { items: [{ id: 6201, ticketID: 1001, itemName: 'Confirm service restored', isCompleted: true, isImportant: true, position: 1 }] }; }

/** Fictitious checklist records. This adapter never connects to Autotask. */
export class FixtureChecklistPort implements ChecklistPort {
  readonly source = 'fixture' as const; readonly calls: { operation: string; ticketId: number; itemId?: number }[] = []; readonly records: FixtureChecklistRecords;
  constructor(private readonly principals: PrincipalStore, records?: Partial<FixtureChecklistRecords>) { this.records = { ...fixtureChecklistRecords(), ...structuredClone(records) } as FixtureChecklistRecords; }
  private async current(p: Principal, write = false) { const fresh = await reauthorize(p, this.principals); assertCapability(fresh, 'operational.read'); assertArea(fresh, 'tickets', write); if (write) assertCapability(fresh, 'tickets.write'); return fresh; }
  private hit(operation: string, ticketId: number, itemId?: number) { this.calls.push({ operation, ticketId, ...(itemId === undefined ? {} : { itemId }) }); }
  async fields(p: Principal, ticketId: number) { await this.current(p); this.hit('TicketChecklistItems.fields', ticketId); return structuredClone(fixtureChecklistFields); }
  async list(p: Principal, ticketId: number): Promise<ChecklistPage> { await this.current(p); this.hit('TicketChecklistItems.query', ticketId); return { items: structuredClone(this.records.items.filter(row => row.ticketID === ticketId)), complete: true, fetchedAt: new Date().toISOString() }; }
  async get(p: Principal, ticketId: number, itemId: number) { await this.current(p); this.hit('TicketChecklistItems.get', ticketId, itemId); const row = this.records.items.find(item => item.id === itemId && item.ticketID === ticketId); if (!row) throw new AppError('not_found_or_inaccessible', 'Checklist item not found or inaccessible.'); return structuredClone(row); }
  async create(p: Principal, ticketId: number, payload: Record<string, unknown>) { await this.current(p, true); if (this.records.items.filter(item => item.ticketID === ticketId).length >= 40) throw new AppError('precondition_failed', 'A ticket cannot have more than 40 checklist items.'); const id = Math.max(6200, ...this.records.items.map(item => item.id)) + 1; const row = { ...structuredClone(payload), ticketID: ticketId, id } as ChecklistItem; this.records.items.push(row); this.hit('TicketChecklistItems.create', ticketId, id); return { id }; }
  async update(p: Principal, ticketId: number, itemId: number, payload: Record<string, unknown>) { await this.current(p, true); const row = this.records.items.find(item => item.id === itemId && item.ticketID === ticketId); if (!row) throw new AppError('not_found_or_inaccessible', 'Checklist item not found or inaccessible.'); Object.assign(row, structuredClone(payload)); this.hit('TicketChecklistItems.update', ticketId, itemId); return { id: itemId }; }
  async delete(p: Principal, ticketId: number, itemId: number) { await this.current(p, true); const index = this.records.items.findIndex(item => item.id === itemId && item.ticketID === ticketId); if (index < 0) throw new AppError('not_found_or_inaccessible', 'Checklist item not found or inaccessible.'); this.records.items.splice(index, 1); this.hit('TicketChecklistItems.delete', ticketId, itemId); }
}
