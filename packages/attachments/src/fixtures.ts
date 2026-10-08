import { assertArea } from '../../policy/src/areas.js';
import { AppError, positiveId, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, reauthorize } from '../../policy/src/index.js';
import type { TicketAttachment, TicketAttachmentCreate, TicketAttachmentPort } from './contracts.js';

export class FixtureTicketAttachmentPort implements TicketAttachmentPort {
  readonly source = 'fixture' as const;
  readonly records: TicketAttachment[];
  readonly calls: { method: string; ticketId: number; attachmentId?: number }[] = [];
  constructor(private readonly principals: PrincipalStore, records: TicketAttachment[] = []) { this.records = structuredClone(records); }
  private async actor(p: Principal, write = false) { const fresh = await reauthorize(p, this.principals); assertCapability(fresh, 'operational.read'); assertArea(fresh, 'tickets', write); if (write) assertCapability(fresh, 'tickets.write'); return fresh; }
  async list(p: Principal, ticketId: number) { p = await this.actor(p); const rows = this.records.filter(row => row.ticketID === ticketId); const ticketCompany = ticketId === 1001 ? 10 : ticketId === 2001 ? 20 : undefined; if (ticketCompany === undefined) throw new AppError('not_found_or_inaccessible', 'Ticket not found or inaccessible.'); assertCompanyScope(p, ticketCompany); this.calls.push({ method: 'query', ticketId }); return { items: structuredClone(rows), complete: true, fetchedAt: new Date().toISOString() }; }
  async get(p: Principal, ticketId: number, attachmentId: number) { p = await this.actor(p); const row = this.records.find(value => value.id === attachmentId && value.ticketID === ticketId); if (!row) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); this.calls.push({ method: 'get', ticketId, attachmentId }); return structuredClone(row); }
  async create(p: Principal, ticketId: number, payload: TicketAttachmentCreate, beforeDispatch: () => Promise<void>) { p = await this.actor(p, true); await beforeDispatch(); const id = Math.max(8000, ...this.records.map(row => row.id)) + 1; this.records.push({ id, ticketID: ticketId, fileSize: Buffer.from(payload.data, 'base64').length, ...structuredClone(payload) }); this.calls.push({ method: 'create', ticketId, attachmentId: id }); return { id }; }
  async delete(p: Principal, ticketId: number, attachmentId: number, beforeDispatch: () => Promise<void>) { p = await this.actor(p, true); const index = this.records.findIndex(row => row.id === attachmentId && row.ticketID === ticketId); if (index < 0) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); await beforeDispatch(); this.records.splice(index, 1); this.calls.push({ method: 'delete', ticketId, attachmentId }); }
}
