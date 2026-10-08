import {withReconciliation} from '../../execution/src/index.js';
import { assertArea } from '../../policy/src/areas.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, positiveId, type JournalRecord, type Principal } from '../../contracts/src/index.js';
import { assertCapability, reauthorize } from '../../policy/src/index.js';
import { IntentCipher } from '../../storage/src/intent-cipher.js';
import { ticketReferenceSchema, type TicketWorkflows } from '../../workflows/src/index.js';
import type { ArtifactService } from '../../artifacts/src/index.js';
import type { AttachmentByteBudget, TicketAttachment, TicketAttachmentCreate, TicketAttachmentPort } from './contracts.js';
export type * from './contracts.js';
export { FixtureUnlimitedAttachmentByteBudget } from './contracts.js';
export { HttpTicketAttachmentPort } from './http.js';
export { FixtureTicketAttachmentPort } from './fixtures.js';
export { PostgresAttachmentByteBudget } from './byte-budget.js';

const id = z.number().int().positive().safe();
const ticketReference = ticketReferenceSchema;
type TicketReference = z.infer<typeof ticketReference>;
export const attachmentListSchema = z.object({ ticket: ticketReference }).strict();
export const attachmentGetSchema = z.object({ ticket: ticketReference, attachment_id: id }).strict();
export const attachmentDownloadSchema = attachmentGetSchema.extend({ offset: z.number().int().nonnegative().default(0), length: z.number().int().min(1).max(262_144).default(262_144) }).strict();
export const attachmentUploadSchema = z.object({ ticket: ticketReference, artifact_id: z.string().uuid(), title: z.string().trim().min(1).max(255), request_key: z.string().min(8).max(128) }).strict();
export const attachmentCopySchema = z.object({ source_ticket: ticketReference, attachment_id: id, ticket: ticketReference, request_key: z.string().min(8).max(128) }).strict();
export const attachmentDeleteSchema = z.object({ ticket: ticketReference, attachment_id: id, request_key: z.string().min(8).max(128) }).strict();
export const attachmentOperationStatusSchema = z.object({ operation_id: z.string().uuid() }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = () => new AppError('dependency_unavailable', 'The attachment could not be completed within its verified scope.');
const direct = (row: TicketAttachment, ticketId: number) => row.ticketID === ticketId && !positiveId(row.ticketNoteID) && !positiveId(row.timeEntryID) && !positiveId(row.parentAttachmentID);
const projected = (row: TicketAttachment) => ({ id: row.id, ticket_id: row.ticketID, title: row.title, ticket_note_id: row.ticketNoteID ?? null, time_entry_id: row.timeEntryID ?? null, parent_attachment_id: row.parentAttachmentID ?? null, content_type: row.contentType, file_size: row.fileSize, attachment_type: row.attachmentType, attach_date: row.attachDate, publish: row.publish });
const nativeBytes = (value: unknown): Buffer | undefined => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(value, 'base64'); return bytes.length && bytes.toString('base64') === value ? bytes : undefined;
};

export interface TicketAttachmentServiceOptions {
  /** Fixture or pre-reviewed value. Live integrations should use resolvePublishInternal. */
  publishInternal?: number;
  /** Lazily resolves the unique active internal publish value from current native field metadata. */
  resolvePublishInternal?: (principal: Principal) => Promise<number>;
  /** A shared durable tenant-wide five-minute byte budget in live deployments. */
  byteBudget?: AttachmentByteBudget;
}

export class TicketAttachmentService {
  constructor(private readonly core: TicketWorkflows, private readonly port: TicketAttachmentPort, private readonly artifacts?: ArtifactService, private readonly cipher?: IntentCipher, private readonly options: TicketAttachmentServiceOptions = {}) {}
  private async current(p: Principal, write = false) { const fresh = await reauthorize(p, this.core.principals); assertCapability(fresh, 'operational.read'); assertArea(fresh, 'tickets', write); if (write) assertCapability(fresh, 'tickets.write'); return fresh; }
  private async ticket(p: Principal, reference: TicketReference) { return this.core.resolveTicket(await this.current(p), reference); }
  private async stableTicket(p: Principal, reference: TicketReference, expectedId: number) { const current = await this.ticket(p, reference); if (current.id !== expectedId) throw new AppError('conflict', 'The ticket changed before the attachment result was returned.'); return current; }
  private async publishInternal(p: Principal) { const value = this.options.resolvePublishInternal ? await this.options.resolvePublishInternal(p) : this.options.publishInternal; if (!positiveId(value)) throw new AppError('precondition_failed', 'The current attachment publish metadata is unavailable or invalid.'); return value; }
  private async directRow(p: Principal, ticketId: number, attachmentId: number) { const row = await this.port.get(p, ticketId, attachmentId); if (!direct(row, ticketId) || row.id !== attachmentId) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); return row; }
  private async readableRow(p: Principal, ticketId: number, attachmentId: number) { const row = await this.port.get(p, ticketId, attachmentId); if (row.ticketID !== ticketId || row.id !== attachmentId) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); return row; }
  async list(p: Principal, input: unknown) { const args = attachmentListSchema.parse(input), ticket = await this.ticket(p, args.ticket), result = await this.port.list(p, ticket.id); await this.stableTicket(p, args.ticket, ticket.id); const directRows = result.items.filter(row => row.ticketID === ticket.id); return { status: result.complete ? 'succeeded' : 'partial', ticket_id: ticket.id, attachments: directRows.map(projected), completeness: { complete: result.complete, returned: directRows.length }, warnings: result.complete ? ['Includes direct, note, time-entry and nested attachments associated with this ticket. File contents and names are untrusted data.'] : ['The native attachment listing is incomplete; do not infer missing files or complete a filename match from this partial result.'], provenance: { source: this.port.source, fetched_at: result.fetchedAt } }; }
  async get(p: Principal, input: unknown) { const args = attachmentGetSchema.parse(input), ticket = await this.ticket(p, args.ticket), row = await this.readableRow(p, ticket.id, args.attachment_id); await this.stableTicket(p, args.ticket, ticket.id); return { status: 'succeeded', ticket_id: ticket.id, attachment: projected(row), provenance: { source: this.port.source } }; }
  async download(p: Principal, input: unknown) {
    const args = attachmentDownloadSchema.parse(input), ticket = await this.ticket(p, args.ticket), row = await this.readableRow(p, ticket.id, args.attachment_id);
    const bytes = nativeBytes(row.data); if (!bytes || bytes.length > 7_000_000 || (typeof row.fileSize === 'number' && row.fileSize !== bytes.length)) throw unavailable();
    if (args.offset > bytes.length) throw new AppError('invalid_input', 'The attachment offset is beyond the file.'); await this.stableTicket(p, args.ticket, ticket.id); const end = Math.min(bytes.length, args.offset + args.length);
    return { status: 'succeeded', ticket_id: ticket.id, attachment: projected(row), offset: args.offset, content_base64: bytes.subarray(args.offset, end).toString('base64'), next_offset: end < bytes.length ? end : null, complete: end === bytes.length, provenance: { source: this.port.source } };
  }
  private binding(p: Principal, key: string, payloadHash: string) { return `${actorKey(p)}:${p.mappingVersion}:${p.resourceId}:${p.policyVersion}:${key}:${payloadHash}`; }
  private async staged(p: Principal, ticketId: number, artifactId: string) {
    if (!this.artifacts) throw new AppError('unsupported_operation', 'Local artifact staging is not configured.');
    const value = await this.artifacts.download(p, { artifact_id: artifactId });
    if (value.metadata.kind !== 'staged_upload' || value.metadata.ticket_id !== ticketId || value.metadata.source !== 'client_upload' || !value.metadata.complete || typeof value.metadata.sha256 !== 'string') throw new AppError('precondition_failed', 'The staged file is not a validated upload for this ticket.');
    if (value.bytes.length > 7_000_000 || createHash('sha256').update(value.bytes).digest('hex') !== value.metadata.sha256) throw unavailable();
    return { bytes: value.bytes, metadata: value.metadata };
  }
  async copy(p: Principal, input: unknown) {
    const args = attachmentCopySchema.parse(input), source = await this.ticket(p, args.source_ticket);
    const sourceBinding = { ticketId: source.id, attachmentId: args.attachment_id };
    // Native copies use the upload journal/recovery lifecycle, with a distinct source identity.
    return this.performUpload(p, {ticket: args.ticket, artifact_id: `native:${source.id}:${args.attachment_id}`, request_key: args.request_key}, sourceBinding);
  }
  async upload(p: Principal, input: unknown) { return this.performUpload(p, attachmentUploadSchema.parse(input)); }
  private async performUpload(p: Principal, args: {ticket: TicketReference; artifact_id: string; title?: string; request_key: string}, source?: {ticketId: number; attachmentId: number}) {
    const readSource = async (principal: Principal, ticketId: number) => {
      if (!source) return this.staged(principal, ticketId, args.artifact_id);
      await this.ticket(principal, {kind:'id', id:source.ticketId});
      const row = await this.readableRow(principal, source.ticketId, source.attachmentId), bytes = nativeBytes(row.data);
      if (row.attachmentType !== 'FILE_ATTACHMENT' || !bytes || bytes.length > 7_000_000 || typeof row.fileSize === 'number' && row.fileSize !== bytes.length || typeof row.contentType !== 'string' || !row.contentType.trim()) throw unavailable();
      const filename = typeof row.fullPath === 'string' ? row.fullPath.split(/[\\/]/).at(-1)! : row.title;
      if (!filename || filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename) || !row.title || row.title.length > 255) throw unavailable();
      await this.ticket(principal, {kind:'id', id:source.ticketId});
      return {bytes, metadata:{sha256:createHash('sha256').update(bytes).digest('hex'), bytes:bytes.length, mime:row.contentType, filename, title:row.title, association:digest([row.ticketID,row.ticketNoteID??null,row.timeEntryID??null,row.parentAttachmentID??null])}};
    };
    if (!this.port || (!source && !this.artifacts) || !this.cipher || (!positiveId(this.options.publishInternal) && !this.options.resolvePublishInternal) || !this.options.byteBudget) throw new AppError('unsupported_operation', 'Ticket attachment upload requires reviewed publish metadata and a shared byte budget.');
    let principal = await this.current(p, true), ticket = await this.ticket(principal, args.ticket);
    let publishInternal: number;
    const existing = await this.core.journal.find(actorKey(principal), args.request_key);
    if (existing) {
      if (existing.operation !== 'ticket_attachment_upload' || !existing.encryptedIntent || !this.cipher) throw new AppError('conflict', 'Request key belongs to another attachment operation.');
      const intent = this.cipher.open(existing.encryptedIntent, this.binding(principal, existing.requestKey, existing.payloadHash)) as { ticketId?: number; artifactId?: string; title?: string; source?: {ticketId:number; attachmentId:number} };
      if (intent.ticketId !== ticket.id || intent.artifactId !== args.artifact_id || (source ? JSON.stringify(intent.source) !== JSON.stringify(source) : intent.title !== args.title)) throw new AppError('conflict', 'Request key belongs to another attachment operation.');
      return this.uploadStatus(principal, existing.id);
    }
    publishInternal = await this.publishInternal(principal);
    let staged = await readSource(principal, ticket.id);
    const title = args.title ?? ('title' in staged.metadata ? String(staged.metadata.title) : staged.metadata.filename);
    const sourceFingerprint = digest(staged.metadata);
    const payloadHash = digest({ source, ticketId: ticket.id, artifactId: args.artifact_id, title, sha256: staged.metadata.sha256, actor: actorKey(principal), mapping: principal.mappingVersion, policy: principal.policyVersion });
    const reservation = await this.core.journal.reserve({ actorKey: actorKey(principal), requestKey: args.request_key, payloadHash, operation: 'ticket_attachment_upload', mappingVersion: principal.mappingVersion, resourceId: principal.resourceId, policyVersion: principal.policyVersion, encryptedIntent: this.cipher.seal({ ticketId: ticket.id, artifactId: args.artifact_id, title, source, filename: staged.metadata.filename, mime: staged.metadata.mime, sha256: staged.metadata.sha256, publish: publishInternal }, this.binding(principal, args.request_key, payloadHash)), intentExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), result: { ticket_id: ticket.id, artifact_id: args.artifact_id } });
    if (!reservation.created) return this.uploadStatus(principal, reservation.record.id);
    let state: JournalRecord['state'] = 'ready'; let nativeId: number | undefined;
    try {
      await this.core.journal.transition(reservation.record.id, 'ready', 'dispatching', { ticket_id: ticket.id, artifact_id: args.artifact_id }); state = 'dispatching';
      staged = await readSource(principal, ticket.id); const payload: TicketAttachmentCreate = { title, fullPath: staged.metadata.filename, attachmentType: 'FILE_ATTACHMENT', contentType: staged.metadata.mime, publish: publishInternal, data: staged.bytes.toString('base64') };
      const saved = await this.port.create(principal, ticket.id, payload, async () => { principal = await this.current(principal, true); const current = await this.ticket(principal, args.ticket); const latest = await readSource(principal, current.id); const latestPublish = await this.publishInternal(principal); if (current.id !== ticket.id || digest(latest.metadata) !== sourceFingerprint || latest.metadata.sha256 !== staged.metadata.sha256 || latest.metadata.bytes !== staged.metadata.bytes || latestPublish !== publishInternal) throw new AppError('conflict', 'The ticket, publish metadata, or staged file changed before attachment dispatch.'); await this.options.byteBudget!.reserve({ tenantId: principal.tenantId, bytes: latest.bytes.length }); }); nativeId = saved.id;
      await this.core.journal.transition(reservation.record.id, state, 'accepted_unverified', { ticket_id: ticket.id, artifact_id: args.artifact_id, attachment_id: nativeId });
    } catch (error) { const definite = error instanceof AppError && ['invalid_input', 'forbidden', 'not_found_or_inaccessible', 'conflict', 'precondition_failed', 'unsupported_operation', 'throttled'].includes(error.code); try { await this.core.journal.transition(reservation.record.id, state, state === 'dispatching' && !definite ? 'unknown_outcome' : 'failed', { ticket_id: ticket.id, artifact_id: args.artifact_id, ...(nativeId ? { attachment_id: nativeId } : {}), error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); } catch {} }
    return withReconciliation(()=>this.uploadStatus(principal, reservation.record.id));
  }
  async uploadStatus(p: Principal, operationId: string) { p = await this.current(p); const record = await this.core.journal.get(operationId, actorKey(p)); if (!record || record.operation !== 'ticket_attachment_upload') throw new AppError('not_found_or_inaccessible', 'Attachment operation unavailable.'); if (record.mappingVersion !== p.mappingVersion || record.resourceId !== p.resourceId || record.policyVersion !== p.policyVersion) throw new AppError('conflict', 'Employee mapping or policy changed.');
    if (positiveId(record.result?.ticket_id)) await this.stableTicket(p, { kind: 'id', id: record.result.ticket_id }, record.result.ticket_id);
    if (record.encryptedIntent && this.cipher) { const intent = this.cipher.open(record.encryptedIntent, this.binding(p, record.requestKey, record.payloadHash)) as {source?:{ticketId:number}}; if (intent.source) await this.ticket(p,{kind:'id',id:intent.source.ticketId}); }
    const intentExpired = Boolean(record.intentExpiresAt && Date.parse(record.intentExpiresAt) <= Date.now());
    if (!intentExpired && ['accepted_unverified', 'unknown_outcome'].includes(record.state) && positiveId(record.result?.attachment_id) && positiveId(record.result?.ticket_id)) { try { const row = await this.directRow(p, record.result.ticket_id, record.result.attachment_id); const intent = record.encryptedIntent && this.cipher ? this.cipher.open(record.encryptedIntent, this.binding(p, record.requestKey, record.payloadHash)) as { title: string; mime: string; sha256: string; publish: number; filename?:string } : undefined; const bytes = nativeBytes(row.data); const matches = Boolean(intent && row.title === intent.title && (!intent.filename || typeof row.fullPath === 'string' && row.fullPath.split(/[\\/]/).at(-1) === intent.filename) && row.contentType === intent.mime && row.attachmentType === 'FILE_ATTACHMENT' && row.publish === intent.publish && bytes && createHash('sha256').update(bytes).digest('hex') === intent.sha256 && bytes.length <= 7_000_000 && (typeof row.fileSize !== 'number' || row.fileSize === bytes.length)); if (matches) { await this.stableTicket(p, { kind: 'id', id: record.result.ticket_id }, record.result.ticket_id); await this.core.journal.transition(record.id, record.state, 'succeeded_verified', { ...record.result, verified: true }); } } catch {} }
    const latest = await this.core.journal.get(operationId, actorKey(p)) ?? record; if (record.encryptedIntent && this.cipher) { const intent = this.cipher.open(record.encryptedIntent, this.binding(p, record.requestKey, record.payloadHash)) as {source?:{ticketId:number}}; if(intent.source) await this.ticket(p,{kind:'id',id:intent.source.ticketId}); } if (positiveId(latest.result?.ticket_id)) await this.stableTicket(p, { kind: 'id', id: latest.result.ticket_id }, latest.result.ticket_id); else await this.current(p); return { status: latest.state, operation_id: latest.id, data: latest.result ?? {}, safe_to_redispatch: false, receipt: latest.state === 'succeeded_verified' ? 'Ticket attachment created and verified.' : 'Inspect the attachment operation before any retry; uncertain effects are never replayed.' };
  }
  async operationStatus(p: Principal, input: unknown) {
    const args = attachmentOperationStatusSchema.parse(input), current = await this.current(p), record = await this.core.journal.get(args.operation_id, actorKey(current));
    if (!record || !['ticket_attachment_upload', 'ticket_attachment_delete'].includes(record.operation)) throw new AppError('not_found_or_inaccessible', 'Attachment operation unavailable.');
    if (record.operation === 'ticket_attachment_upload') return this.uploadStatus(current, record.id);
    if (record.mappingVersion !== current.mappingVersion || record.resourceId !== current.resourceId || record.policyVersion !== current.policyVersion) throw new AppError('conflict', 'Employee mapping or policy changed.');
    if (positiveId(record.result?.ticket_id)) await this.stableTicket(current, { kind: 'id', id: record.result.ticket_id }, record.result.ticket_id);
    const intentExpired = Boolean(record.intentExpiresAt && Date.parse(record.intentExpiresAt) <= Date.now());
    if (!intentExpired && ['accepted_unverified', 'unknown_outcome'].includes(record.state) && positiveId(record.result?.ticket_id) && positiveId(record.result?.attachment_id)) {
      let absent = false;
      try { await this.port.get(current, record.result.ticket_id, record.result.attachment_id); }
      catch (error) { if (error instanceof AppError && error.code === 'not_found_or_inaccessible') absent = true; }
      await this.stableTicket(current, { kind: 'id', id: record.result.ticket_id }, record.result.ticket_id);
      if (absent) await this.core.journal.transition(record.id, record.state, 'succeeded_verified', { ...record.result, verified: true });
    }
    const latest = await this.core.journal.get(record.id, actorKey(current)) ?? record;
    if (positiveId(latest.result?.ticket_id)) await this.stableTicket(current, { kind: 'id', id: latest.result.ticket_id }, latest.result.ticket_id); else await this.current(current);
    return { status: latest.state, operation_id: latest.id, data: latest.result ?? {}, safe_to_redispatch: false, receipt: latest.state === 'succeeded_verified' ? 'Ticket attachment deletion was verified.' : 'Inspect the attachment operation before any retry; uncertain effects are never replayed.' };
  }
  async delete(p: Principal, input: unknown) { const args = attachmentDeleteSchema.parse(input); if (!this.cipher) throw new AppError('unsupported_operation', 'Ticket attachment deletion is not configured.'); p = await this.current(p, true); const ticket = await this.ticket(p, args.ticket), payloadHash = digest({ ticketId: ticket.id, attachmentId: args.attachment_id, actor: actorKey(p), mapping: p.mappingVersion, policy: p.policyVersion }); const prior = await this.core.journal.find(actorKey(p), args.request_key); if (prior) { if (prior.operation !== 'ticket_attachment_delete' || prior.payloadHash !== payloadHash) throw new AppError('conflict', 'Request key belongs to another attachment operation.'); return this.operationStatus(p, { operation_id: prior.id }); } const row = await this.directRow(p, ticket.id, args.attachment_id);
    const reservation = await this.core.journal.reserve({ actorKey: actorKey(p), requestKey: args.request_key, payloadHash, operation: 'ticket_attachment_delete', mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion, encryptedIntent: this.cipher.seal({ ticketId: ticket.id, attachmentId: row.id }, this.binding(p, args.request_key, payloadHash)), intentExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), result: { ticket_id: ticket.id, attachment_id: row.id } }); let state: JournalRecord['state'] = 'ready';
    try {
      await this.core.journal.transition(reservation.record.id, 'ready', 'dispatching', reservation.record.result); state = 'dispatching';
      await this.port.delete(p, ticket.id, row.id, async () => { p = await this.current(p, true); const current = await this.stableTicket(p, args.ticket, ticket.id); await this.directRow(p, current.id, row.id); });
      await this.core.journal.transition(reservation.record.id, state, 'accepted_unverified', reservation.record.result); state = 'accepted_unverified';
      await withReconciliation(async()=>{
      let absent = false;
      try { await this.port.get(p, ticket.id, row.id); } catch (error) { if (error instanceof AppError && error.code === 'not_found_or_inaccessible') absent = true; }
      // A native absence is evidence only after the ticket and actor are still
      // authorized. Keep accepted_unverified if this final check is unavailable.
      await this.stableTicket(p, { kind: 'id', id: ticket.id }, ticket.id);
      if (absent) { await this.core.journal.transition(reservation.record.id, state, 'succeeded_verified', { ...reservation.record.result, verified: true }); state = 'succeeded_verified'; }
      p = await this.current(p); await this.stableTicket(p, { kind: 'id', id: ticket.id }, ticket.id);
      });
    } catch (error) {
      if (state === 'accepted_unverified') throw error instanceof AppError ? error : new AppError('dependency_unavailable', 'The attachment deletion result could not be authorized.');
      const definite = error instanceof AppError && ['invalid_input', 'forbidden', 'not_found_or_inaccessible', 'conflict', 'precondition_failed'].includes(error.code);
      try { await this.core.journal.transition(reservation.record.id, state, state === 'dispatching' && !definite ? 'unknown_outcome' : 'failed', { ...reservation.record.result, error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); } catch {}
    }
    const result = await this.core.journal.get(reservation.record.id, actorKey(p)); return { status: result?.state ?? 'unknown_outcome', operation_id: reservation.record.id, data: result?.result ?? {}, safe_to_redispatch: false };
  }
}
