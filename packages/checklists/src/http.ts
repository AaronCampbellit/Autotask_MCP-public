import {providerFetch} from '../../execution/src/index.js';
import { assertArea } from '../../policy/src/areas.js';
import { AppError, actorKey, positiveId, type Principal } from '../../contracts/src/index.js';
import { assertCapability } from '../../policy/src/index.js';
import { requestScheduler } from '../../autotask/src/index.js';
import { impersonationHeader } from '../../autotask/src/impersonation.js';
import type { RequestBudgetPort } from '../../autotask/src/budget.js';
import type { ChecklistField, ChecklistItem, ChecklistPage, ChecklistPort } from './contracts.js';

export type ChecklistOperation = 'TicketChecklistItems.query' | 'TicketChecklistItems.get' | 'TicketChecklistItems.fields' | 'TicketChecklistItems.create' | 'TicketChecklistItems.update' | 'TicketChecklistItems.delete';
export const CHECKLIST_NATIVE_OPERATIONS: readonly ChecklistOperation[] = Object.freeze([
  'TicketChecklistItems.query', 'TicketChecklistItems.get', 'TicketChecklistItems.fields',
  'TicketChecklistItems.create', 'TicketChecklistItems.update', 'TicketChecklistItems.delete',
]);
export interface ChecklistQualification {
  operation: ChecklistOperation; evidenceSource: 'live' | 'fixture'; headerAccepted: boolean; permissionEnforced: boolean; nativeAttribution?: boolean;
  tenantId: string; policyVersion: string; resourceIds: number[]; testIds: string[]; evidenceReference: string; qualifiedAt: string; expiresAt: string;
}
export interface HttpChecklistOptions {
  baseUrl: string; username: string; secret: string; integrationCode: string;
  requestBudget?: RequestBudgetPort; writesEnabled?: boolean;
  applicationOperations?: { tenantId: string; operations: readonly ChecklistOperation[] };
  qualifications?: ChecklistQualification[]; revalidatePrincipal?: (principal: Principal) => Promise<Principal>;
  fetch?: typeof fetch; now?: () => number; timeoutMs?: number;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const unavailable = (message = 'Autotask checklist returned an invalid or incomplete response.') => new AppError('dependency_unavailable', message);
const notFound = () => new AppError('not_found_or_inaccessible', 'Checklist item not found or inaccessible.');
const mutationOperations = new Set<ChecklistOperation>(['TicketChecklistItems.create', 'TicketChecklistItems.update', 'TicketChecklistItems.delete']);
const identity = (p: Principal) => JSON.stringify([p.tenantId, p.objectId, p.resourceId, p.mappingVersion, p.policyVersion]);

/** Fixed child routes from the captured TicketChecklistItems Swagger model and
 * official entity documentation. The entity allows at most 40 items per ticket. */
export class HttpChecklistPort implements ChecklistPort {
  readonly source = 'Autotask' as const;
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeout: number;
  private readonly qualifications: ChecklistQualification[];
  constructor(private readonly options: HttpChecklistOptions) {
    if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl)) throw new AppError('invalid_input', 'Invalid checklist API base URL.');
    if ([options.username, options.secret, options.integrationCode].some(v => typeof v !== 'string' || !v.trim() || /[\r\n\0]/.test(v))) throw new AppError('invalid_input', 'Server-owned checklist credentials are invalid.');
    this.base = new URL(options.baseUrl); this.fetcher = providerFetch('Autotask',options.fetch ?? fetch); this.now = options.now ?? Date.now; this.timeout = options.timeoutMs ?? 15_000; this.qualifications = structuredClone(options.qualifications ?? []);
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 60_000) throw new AppError('invalid_input', 'Invalid checklist deadline.');
  }
  private async guard(p: Principal, operation: ChecklistOperation) {
    if (!p.active || !positiveId(p.resourceId) || !p.tenantId || !p.objectId) throw new AppError('identity_mapping_invalid', 'An active mapped employee is required.');
    if (!this.options.revalidatePrincipal) throw new AppError('identity_validation_unavailable', 'Authoritative employee validation is required.');
    let fresh: Principal; try { fresh = await this.options.revalidatePrincipal(structuredClone(p)); } catch { throw new AppError('identity_validation_unavailable', 'Checklist employee validation is unavailable.'); }
    if (!fresh.active || identity(fresh) !== identity(p)) throw new AppError('identity_mapping_invalid', 'The employee mapping or policy changed.');
    assertCapability(fresh, 'operational.read'); assertArea(fresh, 'tickets', mutationOperations.has(operation));
    if (mutationOperations.has(operation)) { assertCapability(fresh, 'tickets.write'); if (this.options.writesEnabled !== true) throw new AppError('forbidden', 'Checklist writes are disabled until explicitly enabled.'); }
    const qualified = this.qualifications.some(q => q.operation === operation && q.evidenceSource === 'live' && q.headerAccepted && q.permissionEnforced && (!mutationOperations.has(operation) || q.nativeAttribution === true) && q.tenantId === fresh.tenantId && q.policyVersion === fresh.policyVersion && q.resourceIds.includes(fresh.resourceId) && q.testIds.length > 0 && q.evidenceReference.trim() && Date.parse(q.expiresAt) > this.now());
    if (!(this.options.applicationOperations?.tenantId === fresh.tenantId && this.options.applicationOperations.operations.includes(operation)) && !qualified) throw new AppError('impersonation_not_qualified', 'This exact checklist operation has no reviewed live permission evidence.');
    return fresh;
  }
  private async request(p: Principal, operation: ChecklistOperation, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', route: string, body?: unknown, beforeDispatch?: () => Promise<void>): Promise<unknown> {
    const mutation = mutationOperations.has(operation);
    const dispatch = async () => {
      await this.guard(p, operation);
      await this.options.requestBudget?.take({ tenantId: p.tenantId, actorKey: actorKey(p) });
      await this.guard(p, operation);
      if (beforeDispatch) { await beforeDispatch(); await this.guard(p, operation); requestScheduler.assertLeaseIdle(actorKey(p)); }
      const url = new URL(route, this.base);
      if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password || url.hash) throw new AppError('invalid_input', 'Unapproved checklist route.');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        let response: Response;
        try { response = await this.fetcher(url, { method, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: controller.signal, headers: { UserName: this.options.username, Secret: this.options.secret, ApiIntegrationCode: this.options.integrationCode, ...impersonationHeader(operation.split('.')[0]!,p.resourceId), Accept: 'application/json', 'Content-Type': 'application/json' } }); } catch { throw new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', mutation ? 'The checklist write outcome is unknown; reconcile before another write.' : 'Autotask checklist is unavailable.'); }
        if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) throw new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', 'Autotask returned an unexpected redirect.');
        if (!response.ok) { await response.body?.cancel(); if (response.status === 401 || response.status === 403) throw new AppError('forbidden', 'Autotask denied the checklist operation.'); if (response.status === 404) throw notFound(); if (response.status === 409) throw new AppError('conflict', 'Autotask reported a checklist conflict.'); if (response.status === 429) throw new AppError('throttled', 'Autotask is throttling checklist requests.'); throw new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', `Autotask returned HTTP ${response.status}.`); }
        if (method === 'DELETE' || response.status === 204) return {};
        const reader = response.body?.getReader(); if (!reader) throw unavailable('Autotask returned an empty checklist response.');
        const chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw unavailable('Autotask checklist response exceeded its size budget.'); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw unavailable('Autotask returned invalid checklist JSON.'); }
      } finally { clearTimeout(timer); controller.abort(); }
    };
    if (beforeDispatch) return requestScheduler.runWithLease(actorKey(p), this.timeout, dispatch);
    const release = await requestScheduler.acquire(actorKey(p), this.timeout); try { return await dispatch(); } finally { release(); }
  }
  private child(ticketId: number, suffix = '') { if (!positiveId(ticketId)) throw new AppError('invalid_input', 'A positive ticket ID is required.'); return `Tickets/${ticketId}/ChecklistItems${suffix}`; }
  private item(value: unknown, id: number): ChecklistItem { if (!object(value) || !object(value.item) || value.item.id !== id) throw unavailable(); return value.item as ChecklistItem; }
  async fields(p: Principal, ticketId: number) {
    const value = await this.request(p, 'TicketChecklistItems.fields', 'GET', this.child(ticketId, '/entityInformation/fields'));
    if (!object(value) || !Array.isArray(value.fields) || value.fields.length > 64 || value.fields.some(field => !object(field) || typeof field.name !== 'string' || typeof field.dataType !== 'string')) throw unavailable('Autotask checklist field metadata is invalid.');
    const fields = value.fields as ChecklistField[]; if (new Set(fields.map(f => f.name)).size !== fields.length) throw unavailable('Autotask checklist field metadata contains duplicates.'); return fields;
  }
  async list(p: Principal, ticketId: number): Promise<ChecklistPage> {
    const value = await this.request(p, 'TicketChecklistItems.query', 'GET', this.child(ticketId));
    if (!object(value) || !Array.isArray(value.items) || !object(value.pageDetails) || (value.pageDetails.nextPageUrl !== null && typeof value.pageDetails.nextPageUrl !== 'string')) throw unavailable();
    if (value.items.length > 40 || value.pageDetails.nextPageUrl) throw unavailable('The ticket checklist exceeds the documented single-page limit.');
    return { items: value.items as ChecklistItem[], complete: true, fetchedAt: new Date(this.now()).toISOString() };
  }
  async get(p: Principal, ticketId: number, itemId: number) { const value = await this.request(p, 'TicketChecklistItems.get', 'GET', this.child(ticketId, `/${itemId}`)); return this.item(value, itemId); }
  private created(value: unknown) { if (!object(value) || !positiveId(value.itemId)) throw new AppError('unknown_outcome', 'Checklist creation returned no usable ID; reconcile before retrying.'); return { id: value.itemId }; }
  async create(p: Principal, ticketId: number, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>) { return this.created(await this.request(p, 'TicketChecklistItems.create', 'POST', this.child(ticketId), payload, beforeDispatch)); }
  async update(p: Principal, ticketId: number, itemId: number, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>) { await this.request(p, 'TicketChecklistItems.update', 'PATCH', this.child(ticketId), { id: itemId, ...payload }, beforeDispatch); return { id: itemId }; }
  async delete(p: Principal, ticketId: number, itemId: number, beforeDispatch?: () => Promise<void>) { await this.request(p, 'TicketChecklistItems.delete', 'DELETE', this.child(ticketId, `/${itemId}`), undefined, beforeDispatch); }
}
