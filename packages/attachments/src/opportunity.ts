import {withReconciliation} from '../../execution/src/index.js';
import { assertArea } from '../../policy/src/areas.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, positiveId, type DataRecord, type JournalRecord, type Principal } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, reauthorize } from '../../policy/src/index.js';
import { IntentCipher } from '../../storage/src/intent-cipher.js';
import { type TicketWorkflows } from '../../workflows/src/index.js';
import type { ArtifactService } from '../../artifacts/src/index.js';
import type {AttachmentByteBudget} from './contracts.js';
import type { OpportunityAttachment, OpportunityAttachmentCreate, OpportunityAttachmentPort } from './opportunity-contracts.js';

const id = z.number().int().positive().safe();
const opportunityReference = id;
type OpportunityReference = z.infer<typeof opportunityReference>;
export const opportunityAttachmentListSchema = z.object({ opportunity_id: opportunityReference }).strict();
export const opportunityAttachmentGetSchema = z.object({ opportunity_id: opportunityReference, attachment_id: id }).strict();
export const opportunityAttachmentDownloadSchema = opportunityAttachmentGetSchema.extend({ offset: z.number().int().nonnegative().default(0), length: z.number().int().min(1).max(262_144).default(262_144) }).strict();
export const opportunityAttachmentUploadSchema = z.object({ opportunity_id: opportunityReference, artifact_id: z.string().uuid(), title: z.string().trim().min(1).max(255), request_key: z.string().min(8).max(128) }).strict();
export const opportunityAttachmentDeleteSchema = z.object({ opportunity_id: opportunityReference, attachment_id: id, request_key: z.string().min(8).max(128) }).strict();
export const opportunityAttachmentOperationStatusSchema = z.object({ operation_id: z.string().uuid() }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = () => new AppError('dependency_unavailable', 'The attachment could not be completed within its verified scope.');
const direct = (row: OpportunityAttachment, opportunityId: number) => row.opportunityID === opportunityId && [row.companyNoteID,row.timeEntryID,row.parentAttachmentID].every(v=>v===undefined||v===null);
const projected = (row: OpportunityAttachment) => ({ id: row.id, opportunity_id: row.opportunityID, title: row.title, content_type: row.contentType, file_size: row.fileSize, attachment_type: row.attachmentType, attach_date: row.attachDate, publish: row.publish });
const nativeBytes = (value: unknown): Buffer | undefined => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(value, 'base64'); return bytes.length && bytes.toString('base64') === value ? bytes : undefined;
};

export interface OpportunityAttachmentServiceOptions {
  /** Read the current, authorized opportunity through the sales boundary. */
  resolveOpportunity:(p:Principal,id:number)=>Promise<DataRecord>;
  /** Fixture or pre-reviewed value. Live integrations should use resolvePublishInternal. */
  publishInternal?: number;
  /** Lazily resolves the unique active internal publish value from current native field metadata. */
  resolvePublishInternal?: (principal: Principal) => Promise<number>;
  /** A shared durable tenant-wide five-minute byte budget in live deployments. */
  byteBudget?: AttachmentByteBudget;
}

export class OpportunityAttachmentService {
  constructor(private readonly core: TicketWorkflows, private readonly port: OpportunityAttachmentPort, private readonly artifacts: ArtifactService | undefined, private readonly cipher: IntentCipher | undefined, private readonly options: OpportunityAttachmentServiceOptions) {}
  private async current(p: Principal, write = false) { const fresh = await reauthorize(p, this.core.principals); assertCapability(fresh, 'operational.read'); assertCapability(fresh,'finance.read');assertArea(fresh,'sales',write); if (write) assertCapability(fresh, 'sales.write'); return fresh; }
  private async opportunity(p: Principal, reference: OpportunityReference) { p=await this.current(p);const row=await this.options.resolveOpportunity(p,reference);if(row.id!==reference)throw unavailable();assertCompanyScope(p,row.companyID);return row; }
  private async stableOpportunity(p: Principal, reference: OpportunityReference, expectedId: number) { const current = await this.opportunity(p, reference); if (current.id !== expectedId) throw new AppError('conflict', 'The opportunity changed before the attachment result was returned.'); return current; }
  private async publishInternal(p: Principal) { const value = this.options.resolvePublishInternal ? await this.options.resolvePublishInternal(p) : this.options.publishInternal; if (!positiveId(value)) throw new AppError('precondition_failed', 'The current attachment publish metadata is unavailable or invalid.'); return value; }
  private async directRow(p: Principal, opportunityId: number, attachmentId: number) { const row = await this.port.get(p, opportunityId, attachmentId); if (!direct(row, opportunityId) || row.id !== attachmentId) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); return row; }
  async list(p: Principal, input: unknown) { const args = opportunityAttachmentListSchema.parse(input), opportunity = await this.opportunity(p, args.opportunity_id), result = await this.port.list(p, opportunity.id); await this.stableOpportunity(p, args.opportunity_id, opportunity.id); const directRows = result.items.filter(row => direct(row, opportunity.id)); return { status: result.complete ? 'succeeded' : 'partial', opportunity_id: opportunity.id, attachments: directRows.map(projected), completeness: { complete: result.complete, returned: directRows.length }, warnings: result.complete ? ['Only direct opportunity attachments are listed; CompanyNotes, TimeEntries and nested attachment descendants are omitted.'] : ['The native attachment listing is incomplete; descendant attachments are omitted.'], provenance: { source: this.port.source, fetched_at: result.fetchedAt } }; }
  async get(p: Principal, input: unknown) { const args = opportunityAttachmentGetSchema.parse(input), opportunity = await this.opportunity(p, args.opportunity_id), row = await this.directRow(p, opportunity.id, args.attachment_id); await this.stableOpportunity(p, args.opportunity_id, opportunity.id); return { status: 'succeeded', opportunity_id: opportunity.id, attachment: projected(row), provenance: { source: this.port.source } }; }
  async download(p: Principal, input: unknown) {
    const args = opportunityAttachmentDownloadSchema.parse(input), opportunity = await this.opportunity(p, args.opportunity_id), row = await this.directRow(p, opportunity.id, args.attachment_id);
    const bytes = nativeBytes(row.data); if (!bytes || bytes.length > 7_000_000 || (typeof row.fileSize === 'number' && row.fileSize !== bytes.length)) throw unavailable();
    if (args.offset > bytes.length) throw new AppError('invalid_input', 'The attachment offset is beyond the file.'); await this.stableOpportunity(p, args.opportunity_id, opportunity.id); const end = Math.min(bytes.length, args.offset + args.length);
    return { status: 'succeeded', opportunity_id: opportunity.id, attachment: projected(row), offset: args.offset, content_base64: bytes.subarray(args.offset, end).toString('base64'), next_offset: end < bytes.length ? end : null, complete: end === bytes.length, provenance: { source: this.port.source } };
  }
  private binding(p: Principal, key: string, payloadHash: string) { return `${actorKey(p)}:${p.mappingVersion}:${p.resourceId}:${p.policyVersion}:${key}:${payloadHash}`; }
  private async staged(p: Principal, opportunityId: number, artifactId: string) {
    if (!this.artifacts) throw new AppError('unsupported_operation', 'Local artifact staging is not configured.');
    const value = await this.artifacts.download(p, { artifact_id: artifactId });
    if (value.metadata.kind !== 'staged_upload' || value.metadata.opportunity_id !== opportunityId || value.metadata.source !== 'client_upload' || !value.metadata.complete || typeof value.metadata.sha256 !== 'string') throw new AppError('precondition_failed', 'The staged file is not a validated upload for this opportunity.');
    if (value.bytes.length > 7_000_000 || createHash('sha256').update(value.bytes).digest('hex') !== value.metadata.sha256) throw unavailable();
    return { bytes: value.bytes, metadata: value.metadata };
  }
  async upload(p: Principal, input: unknown) {
    const args = opportunityAttachmentUploadSchema.parse(input); if (!this.port || !this.artifacts || !this.cipher || (!positiveId(this.options.publishInternal) && !this.options.resolvePublishInternal) || !this.options.byteBudget) throw new AppError('unsupported_operation', 'Opportunity attachment upload requires reviewed publish metadata and a shared byte budget.');
    let principal = await this.current(p, true), opportunity = await this.opportunity(principal, args.opportunity_id);
    let publishInternal: number;
    const existing = await this.core.journal.find(actorKey(principal), args.request_key);
    if (existing) {
      if (existing.operation !== 'opportunity_attachment_upload' || !existing.encryptedIntent || !this.cipher) throw new AppError('conflict', 'Request key belongs to another attachment operation.');
      const intent = this.cipher.open(existing.encryptedIntent, this.binding(principal, existing.requestKey, existing.payloadHash)) as { opportunityId?: number; artifactId?: string; title?: string };
      if (intent.opportunityId !== opportunity.id || intent.artifactId !== args.artifact_id || intent.title !== args.title) throw new AppError('conflict', 'Request key belongs to another attachment operation.');
      return this.uploadStatus(principal, existing.id);
    }
    publishInternal = await this.publishInternal(principal);
    let staged = await this.staged(principal, opportunity.id, args.artifact_id);
    const payloadHash = digest({ opportunityId: opportunity.id, artifactId: args.artifact_id, title: args.title, sha256: staged.metadata.sha256, actor: actorKey(principal), mapping: principal.mappingVersion, policy: principal.policyVersion });
    const reservation = await this.core.journal.reserve({ actorKey: actorKey(principal), requestKey: args.request_key, payloadHash, operation: 'opportunity_attachment_upload', mappingVersion: principal.mappingVersion, resourceId: principal.resourceId, policyVersion: principal.policyVersion, encryptedIntent: this.cipher.seal({ opportunityId: opportunity.id, artifactId: args.artifact_id, title: args.title, filename: staged.metadata.filename, mime: staged.metadata.mime, sha256: staged.metadata.sha256, publish: publishInternal }, this.binding(principal, args.request_key, payloadHash)), intentExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), result: { opportunity_id: opportunity.id, artifact_id: args.artifact_id } });
    if (!reservation.created) return this.uploadStatus(principal, reservation.record.id);
    let state: JournalRecord['state'] = 'ready'; let nativeId: number | undefined;
    try {
      await this.core.journal.transition(reservation.record.id, 'ready', 'dispatching', { opportunity_id: opportunity.id, artifact_id: args.artifact_id }); state = 'dispatching';
      staged = await this.staged(principal, opportunity.id, args.artifact_id); const payload: OpportunityAttachmentCreate = { title: args.title, fullPath: staged.metadata.filename, attachmentType: 'FILE_ATTACHMENT', contentType: staged.metadata.mime, publish: publishInternal, data: staged.bytes.toString('base64') };
      const saved = await this.port.create(principal, opportunity.id, payload, async () => { principal = await this.current(principal, true); const current = await this.opportunity(principal, args.opportunity_id); const latest = await this.staged(principal, current.id, args.artifact_id); const latestPublish = await this.publishInternal(principal); if (current.id !== opportunity.id || latest.metadata.sha256 !== staged.metadata.sha256 || latest.metadata.bytes !== staged.metadata.bytes || latestPublish !== publishInternal) throw new AppError('conflict', 'The opportunity, publish metadata, or staged file changed before attachment dispatch.'); await this.options.byteBudget!.reserve({ tenantId: principal.tenantId, bytes: latest.bytes.length }); }); nativeId = saved.id;
      await this.core.journal.transition(reservation.record.id, state, 'accepted_unverified', { opportunity_id: opportunity.id, artifact_id: args.artifact_id, attachment_id: nativeId });
    } catch (error) { const definite = error instanceof AppError && ['invalid_input', 'forbidden', 'not_found_or_inaccessible', 'conflict', 'precondition_failed', 'unsupported_operation', 'throttled'].includes(error.code); try { await this.core.journal.transition(reservation.record.id, state, state === 'dispatching' && !definite ? 'unknown_outcome' : 'failed', { opportunity_id: opportunity.id, artifact_id: args.artifact_id, ...(nativeId ? { attachment_id: nativeId } : {}), error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); } catch {} }
    return withReconciliation(()=>this.uploadStatus(principal, reservation.record.id));
  }
  async uploadStatus(p: Principal, operationId: string) { p = await this.current(p); const record = await this.core.journal.get(operationId, actorKey(p)); if (!record || record.operation !== 'opportunity_attachment_upload') throw new AppError('not_found_or_inaccessible', 'Attachment operation unavailable.'); if (record.mappingVersion !== p.mappingVersion || record.resourceId !== p.resourceId || record.policyVersion !== p.policyVersion) throw new AppError('conflict', 'Employee mapping or policy changed.');
    if (positiveId(record.result?.opportunity_id)) await this.stableOpportunity(p, record.result.opportunity_id, record.result.opportunity_id);
    const intentExpired = Boolean(record.intentExpiresAt && Date.parse(record.intentExpiresAt) <= Date.now());
    if (!intentExpired && ['accepted_unverified', 'unknown_outcome'].includes(record.state) && positiveId(record.result?.attachment_id) && positiveId(record.result?.opportunity_id)) { try { const row = await this.directRow(p, record.result.opportunity_id, record.result.attachment_id); const intent = record.encryptedIntent && this.cipher ? this.cipher.open(record.encryptedIntent, this.binding(p, record.requestKey, record.payloadHash)) as { title: string; mime: string; sha256: string; publish: number; filename?: string } : undefined; const bytes = nativeBytes(row.data); const matches = Boolean(intent && row.title === intent.title && (!intent.filename || typeof row.fullPath === 'string' && row.fullPath.split(/[\\/]/).at(-1) === intent.filename) && row.contentType === intent.mime && row.attachmentType === 'FILE_ATTACHMENT' && row.publish === intent.publish && bytes && createHash('sha256').update(bytes).digest('hex') === intent.sha256 && bytes.length <= 7_000_000 && (typeof row.fileSize !== 'number' || row.fileSize === bytes.length)); if (matches) { await this.stableOpportunity(p, record.result.opportunity_id, record.result.opportunity_id); await this.core.journal.transition(record.id, record.state, 'succeeded_verified', { ...record.result, verified: true }); } } catch {} }
    const latest = await this.core.journal.get(operationId, actorKey(p)) ?? record; if (positiveId(latest.result?.opportunity_id)) await this.stableOpportunity(p, latest.result.opportunity_id, latest.result.opportunity_id); else await this.current(p); return { status: latest.state, operation_id: latest.id, data: latest.result ?? {}, safe_to_redispatch: false, receipt: latest.state === 'succeeded_verified' ? 'Opportunity attachment created and verified.' : 'Inspect the attachment operation before any retry; uncertain effects are never replayed.' };
  }
  async operationStatus(p: Principal, input: unknown) {
    const args = opportunityAttachmentOperationStatusSchema.parse(input), current = await this.current(p), record = await this.core.journal.get(args.operation_id, actorKey(current));
    if (!record || !['opportunity_attachment_upload', 'opportunity_attachment_delete'].includes(record.operation)) throw new AppError('not_found_or_inaccessible', 'Attachment operation unavailable.');
    if (record.operation === 'opportunity_attachment_upload') return this.uploadStatus(current, record.id);
    if (record.mappingVersion !== current.mappingVersion || record.resourceId !== current.resourceId || record.policyVersion !== current.policyVersion) throw new AppError('conflict', 'Employee mapping or policy changed.');
    if (positiveId(record.result?.opportunity_id)) await this.stableOpportunity(current, record.result.opportunity_id, record.result.opportunity_id);
    const intentExpired = Boolean(record.intentExpiresAt && Date.parse(record.intentExpiresAt) <= Date.now());
    if (!intentExpired && ['accepted_unverified', 'unknown_outcome'].includes(record.state) && positiveId(record.result?.opportunity_id) && positiveId(record.result?.attachment_id)) {
      let absent = false;
      try { await this.port.get(current, record.result.opportunity_id, record.result.attachment_id); }
      catch (error) { if (error instanceof AppError && error.code === 'not_found_or_inaccessible') absent = true; }
      await this.stableOpportunity(current, record.result.opportunity_id, record.result.opportunity_id);
      if (absent) await this.core.journal.transition(record.id, record.state, 'succeeded_verified', { ...record.result, verified: true });
    }
    const latest = await this.core.journal.get(record.id, actorKey(current)) ?? record;
    if (positiveId(latest.result?.opportunity_id)) await this.stableOpportunity(current, latest.result.opportunity_id, latest.result.opportunity_id); else await this.current(current);
    return { status: latest.state, operation_id: latest.id, data: latest.result ?? {}, safe_to_redispatch: false, receipt: latest.state === 'succeeded_verified' ? 'Opportunity attachment deletion was verified.' : 'Inspect the attachment operation before any retry; uncertain effects are never replayed.' };
  }
  async delete(p: Principal, input: unknown) { const args = opportunityAttachmentDeleteSchema.parse(input); if (!this.cipher) throw new AppError('unsupported_operation', 'Opportunity attachment deletion is not configured.'); p = await this.current(p, true); const opportunity = await this.opportunity(p, args.opportunity_id), payloadHash = digest({ opportunityId: opportunity.id, attachmentId: args.attachment_id, actor: actorKey(p), mapping: p.mappingVersion, policy: p.policyVersion }); const prior = await this.core.journal.find(actorKey(p), args.request_key); if (prior) { if (prior.operation !== 'opportunity_attachment_delete' || prior.payloadHash !== payloadHash) throw new AppError('conflict', 'Request key belongs to another attachment operation.'); return this.operationStatus(p, { operation_id: prior.id }); } const row = await this.directRow(p, opportunity.id, args.attachment_id);
    const reservation = await this.core.journal.reserve({ actorKey: actorKey(p), requestKey: args.request_key, payloadHash, operation: 'opportunity_attachment_delete', mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion, encryptedIntent: this.cipher.seal({ opportunityId: opportunity.id, attachmentId: row.id }, this.binding(p, args.request_key, payloadHash)), intentExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), result: { opportunity_id: opportunity.id, attachment_id: row.id } }); let state: JournalRecord['state'] = 'ready';
    try {
      await this.core.journal.transition(reservation.record.id, 'ready', 'dispatching', reservation.record.result); state = 'dispatching';
      await this.port.delete(p, opportunity.id, row.id, async () => { p = await this.current(p, true); const current = await this.stableOpportunity(p, args.opportunity_id, opportunity.id); await this.directRow(p, current.id, row.id); });
      await this.core.journal.transition(reservation.record.id, state, 'accepted_unverified', reservation.record.result); state = 'accepted_unverified';
      await withReconciliation(async()=>{
      let absent = false;
      try { await this.port.get(p, opportunity.id, row.id); } catch (error) { if (error instanceof AppError && error.code === 'not_found_or_inaccessible') absent = true; }
      // A native absence is evidence only after the opportunity and actor are still
      // authorized. Keep accepted_unverified if this final check is unavailable.
      await this.stableOpportunity(p, opportunity.id, opportunity.id);
      if (absent) { await this.core.journal.transition(reservation.record.id, state, 'succeeded_verified', { ...reservation.record.result, verified: true }); state = 'succeeded_verified'; }
      p = await this.current(p); await this.stableOpportunity(p, opportunity.id, opportunity.id);
      });
    } catch (error) {
      if (state === 'accepted_unverified') throw error instanceof AppError ? error : new AppError('dependency_unavailable', 'The attachment deletion result could not be authorized.');
      const definite = error instanceof AppError && ['invalid_input', 'forbidden', 'not_found_or_inaccessible', 'conflict', 'precondition_failed'].includes(error.code);
      try { await this.core.journal.transition(reservation.record.id, state, state === 'dispatching' && !definite ? 'unknown_outcome' : 'failed', { ...reservation.record.result, error_code: error instanceof AppError ? error.code : 'dependency_unavailable' }); } catch {}
    }
    const result = await this.core.journal.get(reservation.record.id, actorKey(p)); return { status: result?.state ?? 'unknown_outcome', operation_id: reservation.record.id, data: result?.result ?? {}, safe_to_redispatch: false };
  }
}
