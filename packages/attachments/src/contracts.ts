import type { Principal, DataRecord } from '../../contracts/src/index.js';

export type AttachmentOperation = 'TicketAttachments.query' | 'TicketAttachments.get' | 'TicketAttachments.create' | 'TicketAttachments.delete' | 'TicketAttachments.fields';
export interface TicketAttachment extends DataRecord {
  ticketID: number;
  title: string;
  contentType?: string;
  fileSize?: number;
  attachmentType?: string;
  parentAttachmentID?: number | null;
  ticketNoteID?: number | null;
  timeEntryID?: number | null;
  data?: string;
}
export interface TicketAttachmentCreate {
  title: string;
  fullPath: string;
  attachmentType: 'FILE_ATTACHMENT';
  contentType: string;
  publish: number;
  data: string;
}
export interface TicketAttachmentPort {
  readonly source: 'fixture' | 'Autotask';
  list(principal: Principal, ticketId: number): Promise<{ items: TicketAttachment[]; complete: boolean; fetchedAt: string }>;
  get(principal: Principal, ticketId: number, attachmentId: number): Promise<TicketAttachment>;
  create(principal: Principal, ticketId: number, payload: TicketAttachmentCreate, beforeDispatch: () => Promise<void>): Promise<{ id: number }>;
  delete(principal: Principal, ticketId: number, attachmentId: number, beforeDispatch: () => Promise<void>): Promise<void>;
}

/** Tenant-wide rolling native creation allowance. Live implementations must persist reservations. */
export interface AttachmentByteBudget {
  reserve(input: { tenantId: string; bytes: number }): Promise<void>;
}

/** Fixture-only budget; production must inject a shared durable implementation. */
export class FixtureUnlimitedAttachmentByteBudget implements AttachmentByteBudget {
  readonly reservations: { tenantId: string; bytes: number }[] = [];
  async reserve(input: { tenantId: string; bytes: number }): Promise<void> { this.reservations.push({ ...input }); }
}
