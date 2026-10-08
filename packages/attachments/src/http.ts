import {providerFetch} from '../../execution/src/index.js';
import { assertArea } from '../../policy/src/areas.js';
import { AppError, actorKey, positiveId, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { requestScheduler } from '../../autotask/src/index.js';
import { impersonationHeader } from '../../autotask/src/impersonation.js';
import { assertCapability, reauthorize } from '../../policy/src/index.js';
import type { RequestBudgetPort } from '../../autotask/src/budget.js';
import type { AttachmentOperation, TicketAttachment, TicketAttachmentCreate, TicketAttachmentPort } from './contracts.js';

export interface AttachmentHttpOptions {
  baseUrl: string; username: string; secret: string; integrationCode: string;
  principals: PrincipalStore; requestBudget: RequestBudgetPort; writesEnabled: boolean;
  /** Exact reviewed active picklist label for the internal publish audience. */
  publishInternalLabel?: string;
  applicationOperations?: { tenantId: string; operations: readonly AttachmentOperation[] };
  fetch?: typeof fetch; timeoutMs?: number;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = () => new AppError('invalid_input', 'The ticket attachment request is invalid.');
const checkId = (v: unknown): v is number => positiveId(v);

export class HttpTicketAttachmentPort implements TicketAttachmentPort {
  readonly source = 'Autotask' as const;
  private readonly base: URL;
  private readonly headers: Record<string, string>;
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private static readonly maxResponseBytes = 9_500_000;
  constructor(private readonly options: AttachmentHttpOptions) {
    if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl)) throw invalid();
    if ([options.username, options.secret, options.integrationCode].some(v => typeof v !== 'string' || !v.trim() || /[\r\n\0]/.test(v))) throw invalid();
    this.base = new URL(options.baseUrl); this.fetcher = providerFetch('Autotask',options.fetch ?? fetch); this.timeout = options.timeoutMs ?? 15_000;
    this.headers = { UserName: options.username, Secret: options.secret, ApiIntegrationCode: options.integrationCode, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 60_000) throw invalid();
  }
  private async actor(p: Principal, write: boolean) { const fresh = await reauthorize(p, this.options.principals); assertCapability(fresh, 'operational.read'); assertArea(fresh, 'tickets', write); if (write) assertCapability(fresh, 'tickets.write'); return fresh; }
  private qualify(p: Principal, operation: AttachmentOperation) { if (this.options.applicationOperations?.tenantId === p.tenantId && this.options.applicationOperations.operations.includes(operation)) return; throw new AppError('impersonation_not_qualified', 'This attachment operation has no reviewed tenant qualification.'); }
  private async request(p: Principal, operation: AttachmentOperation, method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, beforeDispatch?: () => Promise<void>) {
    const write = operation === 'TicketAttachments.create' || operation === 'TicketAttachments.delete'; p = await this.actor(p, write); this.qualify(p, operation); let dispatched = false;
    const dispatch = async () => {
      await this.options.requestBudget.take({ tenantId: p.tenantId, actorKey: actorKey(p) });
      p = await this.actor(p, write); this.qualify(p, operation);
      if (beforeDispatch) { await beforeDispatch(); p = await this.actor(p, write); this.qualify(p, operation); requestScheduler.assertLeaseIdle(actorKey(p)); dispatched = true; }
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const url = new URL(path, this.base), response = await this.fetcher(url, { method, headers: { ...this.headers, ...impersonationHeader(operation.split('.')[0]!,p.resourceId) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: controller.signal });
        if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) throw new AppError('dependency_unavailable', 'Unexpected attachment response.');
        if (!response.ok) { await response.body?.cancel(); const code = response.status === 401 || response.status === 403 ? 'forbidden' : response.status === 404 ? 'not_found_or_inaccessible' : response.status === 409 ? 'conflict' : response.status === 429 ? 'throttled' : write ? 'unknown_outcome' : 'dependency_unavailable'; throw new AppError(code, write && code === 'unknown_outcome' ? 'The attachment write outcome is unknown. Reconcile before retrying.' : 'Autotask rejected the attachment operation.'); }
        const reader = response.body?.getReader(); if (!reader) throw new AppError('dependency_unavailable', 'Missing attachment response.'); const chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > HttpTicketAttachmentPort.maxResponseBytes) throw new AppError('dependency_unavailable', 'Attachment response exceeded its byte budget.'); chunks.push(part.value); } } finally { reader.releaseLock(); }
        if (!chunks.length) { await this.actor(p, write); return {}; }
        try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; await this.actor(p, write); return result; } catch (error) { if (error instanceof AppError) throw error; throw new AppError(write && dispatched ? 'unknown_outcome' : 'dependency_unavailable', 'The attachment response was invalid.'); }
      } catch (error) { if (error instanceof AppError) throw error; throw new AppError(write && dispatched ? 'unknown_outcome' : 'dependency_unavailable', write && dispatched ? 'The attachment write outcome is unknown. Reconcile before retrying.' : 'The attachment operation failed.'); }
      finally { clearTimeout(timer); controller.abort(); }
    };
    if (beforeDispatch) return requestScheduler.runWithLease(actorKey(p), this.timeout, dispatch);
    const release = await requestScheduler.acquire(actorKey(p), this.timeout); try { return await dispatch(); } finally { release(); }
  }
  async resolvePublishInternal(p: Principal): Promise<number> {
    p = await this.actor(p, false);
    const result = await this.request(p, 'TicketAttachments.fields', 'GET', 'TicketAttachments/entityInformation/fields');
    if (!object(result) || !Array.isArray(result.fields)) throw new AppError('missing_metadata', 'Current TicketAttachments fields are unavailable.');
    const fields = result.fields.filter(object), publish = fields.filter(field => field.name === 'publish');
    if (fields.length !== result.fields.length || publish.length !== 1 || publish[0]!.isPickList !== true || !Array.isArray(publish[0]!.picklistValues)) throw new AppError('missing_metadata', 'Current TicketAttachments.publish metadata is invalid.');
    const matches = publish[0]!.picklistValues.filter(object).filter(value => value.isActive === true && typeof value.label === 'string' && value.label.trim() === (this.options.publishInternalLabel??'').trim());
    if (matches.length !== 1 || !Number.isSafeInteger(Number(matches[0]!.value)) || Number(matches[0]!.value) < 1) throw new AppError('missing_metadata', 'The internal attachment publish value is not uniquely available in current metadata.');
    return Number(matches[0]!.value);
  }
  async list(p: Principal, ticketId: number) { if (!checkId(ticketId)) throw invalid(); p = await this.actor(p, false); const result = await this.request(p, 'TicketAttachments.query', 'POST', 'TicketAttachments/query', { filter: [{ op: 'eq', field: 'ticketID', value: ticketId }], MaxRecords: 100 }); if (!object(result) || !Array.isArray(result.items) || !object(result.pageDetails) || (result.pageDetails.nextPageUrl !== null && typeof result.pageDetails.nextPageUrl !== 'string') || result.items.some(item => !object(item) || !checkId(item.id) || item.ticketID !== ticketId)) throw new AppError('dependency_unavailable', 'The attachment listing response is invalid.'); return { items: result.items as TicketAttachment[], complete: result.pageDetails.nextPageUrl === null, fetchedAt: new Date().toISOString() }; }
  async get(p: Principal, ticketId: number, attachmentId: number) { if (!checkId(ticketId) || !checkId(attachmentId)) throw invalid(); p = await this.actor(p, false); const result = await this.request(p, 'TicketAttachments.get', 'GET', `TicketAttachments/${attachmentId}`); if (!object(result) || !object(result.item) || !checkId(result.item.id)) throw new AppError('dependency_unavailable', 'The attachment response is invalid.'); const row = result.item as TicketAttachment; if (row.id !== attachmentId || row.ticketID !== ticketId) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); return row; }
  async create(p: Principal, ticketId: number, payload: TicketAttachmentCreate, beforeDispatch: () => Promise<void>) { if (!this.options.writesEnabled) throw new AppError('unsupported_operation', 'Attachment writes are disabled by reviewed configuration.'); if (!checkId(ticketId) || !payload || typeof payload.title !== 'string' || !payload.title.trim() || typeof payload.fullPath !== 'string' || !payload.fullPath.trim() || payload.attachmentType !== 'FILE_ATTACHMENT' || !Number.isSafeInteger(payload.publish) || payload.publish < 1 || typeof payload.contentType !== 'string' || !payload.contentType.trim() || typeof payload.data !== 'string') throw invalid(); const result = await this.request(p, 'TicketAttachments.create', 'POST', `Tickets/${ticketId}/Attachments`, payload as unknown as Record<string, unknown>, beforeDispatch); if (!object(result) || !checkId(result.itemId)) throw new AppError('unknown_outcome', 'Attachment creation was accepted without a usable ID. Reconcile before retrying.'); return { id: result.itemId }; }
  async delete(p: Principal, ticketId: number, attachmentId: number, beforeDispatch: () => Promise<void>) { if (!this.options.writesEnabled) throw new AppError('unsupported_operation', 'Attachment writes are disabled by reviewed configuration.'); if (!checkId(ticketId) || !checkId(attachmentId)) throw invalid(); await this.request(p, 'TicketAttachments.delete', 'DELETE', `Tickets/${ticketId}/Attachments/${attachmentId}`, undefined, beforeDispatch); }
}
