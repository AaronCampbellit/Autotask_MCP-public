import {providerFetch} from '../../execution/src/index.js';
import { z } from 'zod';
import { AppError, actorKey, positiveId, validCompanyId, type AutotaskPort, type DataRecord, type Principal } from '../../contracts/src/index.js';
import { assertCompanyScope } from '../../policy/src/index.js';
import { requestScheduler } from '../../autotask/src/index.js';
import { impersonationHeader } from '../../autotask/src/impersonation.js';
import type { RequestBudgetPort } from '../../autotask/src/budget.js';
import { positiveIdSchema, reviewedMetadata, reviewedResources, type SchedulePage, type ScheduleQuery, type SchedulingMetadata, type SchedulingPort, type SchedulingResource, type ServiceCallCreatePayload, type ServiceCallRecord, type ServiceCallResourceRecord, type ServiceCallTicketRecord, type ServiceCallUpdatePayload } from './contracts.js';

export type SchedulingOperation = 'Resources.query' | 'ServiceCalls.metadata' | 'ServiceCalls.query' | 'ServiceCalls.get' | 'ServiceCalls.create' | 'ServiceCalls.update' | 'ServiceCalls.cancel' | 'ServiceCallTickets.query' | 'ServiceCallTickets.get' | 'ServiceCallTickets.create' | 'ServiceCallTicketResources.query' | 'ServiceCallTicketResources.get' | 'ServiceCallTicketResources.create';
export interface SchedulingQualification {
  operation: SchedulingOperation; evidenceSource: 'live' | 'fixture'; headerAccepted: boolean; permissionEnforced: boolean; nativeAttribution?: boolean;
  tenantId: string; policyVersion: string; resourceIds: number[]; testIds: string[]; evidenceReference: string; qualifiedAt: string; expiresAt: string;
}
export interface HttpSchedulingOptions {
  baseUrl: string; username: string; secret: string; integrationCode: string;
  requestBudget?: RequestBudgetPort;
  applicationOperations?:{tenantId:string;operations:readonly SchedulingOperation[]};
  qualifications?: SchedulingQualification[]; revalidatePrincipal?: (principal: Principal) => Promise<Principal>;
  /** Server-owned reviewed providers run again after request admission. They must
   * not recursively dispatch through these adapters while a slot is held. */
  resolveResources?: (principal: Principal) => Promise<SchedulingResource[]>;
  resolveMetadata?: (principal: Principal, ticketId: number) => Promise<SchedulingMetadata>;
  fetch?: typeof fetch; now?: () => number; timeoutMs?: number; identityFreshnessMs?: number;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = () => new AppError('dependency_unavailable', 'Autotask scheduling returned an invalid or incomplete response.');
const callSchema = z.object({ companyID: z.number().int().nonnegative().safe(), startDateTime: z.string().datetime(), endDateTime: z.string().datetime(), status: positiveIdSchema, description: z.string().max(2000).optional() }).strict().refine((value) => Date.parse(value.startDateTime) < Date.parse(value.endDateTime));
const identity = (p: Principal) => JSON.stringify([p.tenantId, p.objectId, p.resourceId, p.mappingVersion, p.policyVersion, [...p.companyIds].sort(), [...p.capabilities].sort()]);
const meaning = (metadata: SchedulingMetadata) => { const { validUntil: _expiry, ...value } = metadata; return JSON.stringify(value); };

/** Dedicated reviewed scheduling routes. Empty evidence/providers fail closed.
 * Source: official https://webservices3.autotask.net/ATServicesRest/swagger/docs/v1,
 * inspected 2026-09-10 without authentication or tenant record calls.
 */
export class HttpSchedulingPort implements SchedulingPort {
  readonly source = 'Autotask' as const;
  private readonly base: URL;
  private readonly headers: Record<string, string>;
  private readonly qualifications: SchedulingQualification[];
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeout: number;
  constructor(private readonly tickets: AutotaskPort, private readonly options: HttpSchedulingOptions) {
    if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl)) throw new AppError('invalid_input', 'Invalid scheduling API base URL.');
    this.base = new URL(options.baseUrl);
    if ([options.username, options.secret, options.integrationCode].some((value) => typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value))) throw new AppError('invalid_input', 'Server-owned scheduling credentials are missing or invalid.');
    this.headers = { UserName: options.username, Secret: options.secret, ApiIntegrationCode: options.integrationCode, Accept: 'application/json', 'Content-Type': 'application/json' };
    this.qualifications = structuredClone(options.qualifications ?? []); this.fetcher = providerFetch('Autotask',options.fetch ?? globalThis.fetch); this.now = options.now ?? Date.now; this.timeout = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 60_000) throw new AppError('invalid_input', 'Invalid scheduling deadline.');
  }
  private async guard(p: Principal, operation: SchedulingOperation) {
    if (!p?.active || !positiveId(p.resourceId) || !positiveId(p.mappingVersion) || !Array.isArray(p.companyIds) || !p.companyIds.every(validCompanyId) || !Array.isArray(p.capabilities) || typeof p.tenantId !== 'string' || typeof p.objectId !== 'string') throw new AppError('identity_mapping_invalid', 'An active mapped employee is required.');
    if (!this.options.revalidatePrincipal) throw new AppError('identity_validation_unavailable', 'Live scheduling requires authoritative employee revalidation.');
    let fresh: Principal;
    try { fresh = await this.options.revalidatePrincipal(structuredClone(p)); } catch { throw new AppError('identity_validation_unavailable', 'Scheduling employee validation is unavailable.'); }
    if (!fresh.active || identity(fresh) !== identity(p)) throw new AppError('identity_mapping_invalid', 'The employee mapping or policy changed.');
    const verified = Date.parse(fresh.resourceVerifiedAt);
    if (!Number.isFinite(verified) || verified > this.now() || this.now() - verified > (this.options.identityFreshnessMs ?? 60_000)) throw new AppError('identity_validation_unavailable', 'Scheduling requires fresh identity evidence.');
    const mutation = ['ServiceCalls.create', 'ServiceCalls.update', 'ServiceCalls.cancel', 'ServiceCallTickets.create', 'ServiceCallTicketResources.create'].includes(operation);
    if (!fresh.capabilities.includes('operational.read') || (mutation && !(fresh.capabilities as string[]).includes('scheduling.write'))) throw new AppError('forbidden', 'This scheduling operation is outside the employee capability policy.');
    if (!(this.options.applicationOperations?.tenantId===p.tenantId&&this.options.applicationOperations.operations.includes(operation)) && !this.qualifications.some((q) => q.operation === operation && q.evidenceSource === 'live' && q.headerAccepted && q.permissionEnforced && (!mutation || q.nativeAttribution === true) && q.tenantId === p.tenantId && q.policyVersion === p.policyVersion && q.resourceIds.includes(p.resourceId) && q.testIds.length > 0 && q.testIds.every((id) => typeof id === 'string' && id.trim()) && q.evidenceReference.trim() && Date.parse(q.qualifiedAt) <= this.now() && Date.parse(q.expiresAt) > this.now())) throw new AppError('impersonation_not_qualified', 'Live scheduling is disabled until this exact operation has reviewed employee permission evidence.');
  }
  private async request(p: Principal, operation: SchedulingOperation, path: string | URL, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', payload?: unknown, beforeDispatch?: () => Promise<() => void>): Promise<unknown> {
    const dispatch = async () => {
    await this.guard(p, operation);
    await this.options.requestBudget?.take({tenantId:p.tenantId,actorKey:actorKey(p)});
    if (beforeDispatch) { const validate = await beforeDispatch(); await this.guard(p, operation); validate(); }
    else if(this.options.requestBudget)await this.guard(p,operation);
    if (beforeDispatch) requestScheduler.assertLeaseIdle(actorKey(p));
    const url = path instanceof URL ? path : new URL(path, this.base), mutation = ['ServiceCalls.create', 'ServiceCalls.update', 'ServiceCalls.cancel', 'ServiceCallTickets.create', 'ServiceCallTicketResources.create'].includes(operation);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password || url.hash) throw new AppError('invalid_input', 'Unapproved scheduling route.');
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.fetcher(url, { method, headers: { ...this.headers, ...impersonationHeader(operation.split('.')[0]!,p.resourceId) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), redirect: 'manual', signal: controller.signal });
          if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) throw unavailable();
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 401 || response.status === 403) throw new AppError('forbidden', 'Autotask denied the scheduling operation.');
            if (response.status === 404) throw new AppError('not_found_or_inaccessible', 'Scheduling record not found or inaccessible.');
            if (response.status === 400 || response.status === 422) throw new AppError('invalid_input', 'Autotask rejected the scheduling fields.');
            if (response.status === 409) throw new AppError('conflict', 'Autotask reported a scheduling conflict.');
            if (response.status === 429) throw new AppError('throttled', 'Autotask is throttling scheduling requests.');
            throw unavailable();
          }
          const reader = response.body?.getReader(); if (!reader) throw unavailable();
          const chunks: Uint8Array[] = []; let bytes = 0;
          try {
            while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw unavailable(); } chunks.push(chunk.value); }
          } finally { reader.releaseLock(); }
          try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw unavailable(); }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, this.timeout); }),
      ]);
    } catch (error) {
      if (error instanceof AppError && error.code !== 'dependency_unavailable') throw error;
      throw new AppError(mutation ? 'unknown_outcome' : 'dependency_unavailable', mutation ? 'The scheduling write may have reached Autotask. Reconcile recorded IDs before another create.' : 'Autotask scheduling is unavailable.');
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
    };
    // A guarded mutation can perform sequential parent reads without acquiring
    // another global slot. Unguarded reads borrow that slot through acquire().
    if (beforeDispatch) return requestScheduler.runWithLease(actorKey(p), this.timeout, dispatch);
    const release = await requestScheduler.acquire(actorKey(p), this.timeout);
    try { return await dispatch(); } finally { release(); }
  }
  private item(data: unknown, id: number): DataRecord { if (!object(data) || !object(data.item) || data.item.id !== id) throw unavailable(); return data.item as DataRecord; }
  private created(data: unknown) { if (!object(data) || !positiveId(data.itemId)) throw new AppError('unknown_outcome', 'The scheduling create returned no usable record ID. Do not repeat it.'); return { id: data.itemId }; }
  private async ticket(p: Principal, id: number) { if (!positiveId(id)) throw new AppError('invalid_input', 'A positive ticket ID is required.'); const row = await this.tickets.get(p, 'Tickets', id); assertCompanyScope(p, row.companyID); return row; }
  async resources(p: Principal) {
    p = structuredClone(p);
    await this.guard(p, 'Resources.query');
    if (!this.options.resolveResources) throw new AppError('missing_metadata', 'A reviewed scoped scheduling resource provider is required.');
    let value: unknown; try { value = await this.options.resolveResources(structuredClone(p)); } catch { throw new AppError('missing_metadata', 'The scoped scheduling directory is unavailable.'); }
    return reviewedResources(value, p);
  }
  async metadata(p: Principal, ticketId: number) {
    p = structuredClone(p);
    await this.guard(p, 'ServiceCalls.metadata'); const ticket = await this.ticket(p, ticketId);
    return this.providedMetadata(p, ticketId, ticket.companyID as number);
  }
  private async providedMetadata(p: Principal, ticketId: number, companyId: number) {
    await this.guard(p, 'ServiceCalls.metadata');
    if (!this.options.resolveMetadata) throw new AppError('missing_metadata', 'Reviewed scheduling metadata is required.');
    let value: unknown; try { value = await this.options.resolveMetadata(structuredClone(p), ticketId); } catch { throw new AppError('missing_metadata', 'Reviewed scheduling metadata is unavailable.'); }
    return reviewedMetadata(value, p, ticketId, companyId, this.source, this.now());
  }
  private async recheckMetadata(p: Principal, prior: SchedulingMetadata, resourceId?: number) {
    const ticket = await this.ticket(p, prior.ticketId);
    if (ticket.companyID !== prior.companyId) throw new AppError('precondition_failed', 'The ticket parent company changed before scheduling dispatch.');
    const current = await this.providedMetadata(p, prior.ticketId, prior.companyId);
    if (meaning(current) !== meaning(prior)) throw new AppError('conflict', 'Scheduling eligibility changed before dispatch. Resolve current requirements before another create.');
    if (resourceId !== undefined && !(await this.resources(p)).some(row => row.id === resourceId && row.active && row.companyIds.includes(prior.companyId))) throw new AppError('precondition_failed', 'The requested resource is no longer eligible for the ticket company.');
    return () => {
      if (Date.parse(prior.validUntil) <= this.now() || Date.parse(current.validUntil) <= this.now()) throw new AppError('conflict', 'Scheduling eligibility expired before dispatch.');
    };
  }
  private async query(p: Principal, entity: 'ServiceCalls' | 'ServiceCallTickets' | 'ServiceCallTicketResources', filter: unknown[], budget: { remaining: number }): Promise<{ items: DataRecord[]; complete: boolean }> {
    const initial = new URL(`${entity}/query`, this.base), items: DataRecord[] = []; let url = initial;
    for (let page = 0; page < 5; page++) {
      if (budget.remaining <= 0) return { items, complete: false };
      budget.remaining--;
      const data = await this.request(p, `${entity}.query`, url, 'POST', { MaxRecords: 100, filter });
      if (!object(data) || !Array.isArray(data.items) || data.items.length > 100 || !object(data.pageDetails) || !Object.hasOwn(data.pageDetails, 'nextPageUrl') || data.items.some((row: unknown) => !object(row) || !positiveId(row.id))) throw unavailable();
      items.push(...data.items as DataRecord[]);
      if (new Set(items.map((row) => row.id)).size !== items.length) throw unavailable();
      if (!data.pageDetails.nextPageUrl) return { items, complete: true };
      if (typeof data.pageDetails.nextPageUrl !== 'string' || !data.items.length) throw unavailable();
      try { url = new URL(data.pageDetails.nextPageUrl); } catch { throw unavailable(); }
      if (url.origin !== initial.origin || url.pathname !== `${initial.pathname}/next` || url.username || url.password || url.hash || [...url.searchParams.keys()].length !== 1 || !url.searchParams.get('paging')) throw unavailable();
    }
    return { items, complete: false };
  }
  async search(p: Principal, query: ScheduleQuery): Promise<SchedulePage> {
    p = structuredClone(p); query = structuredClone(query);
    const visibleResources = await this.resources(p);
    if (!query.resourceIds.length || query.resourceIds.length > 10 || query.resourceIds.some((id) => !visibleResources.some((row) => row.id === id)) || !Number.isFinite(Date.parse(query.start)) || !Number.isFinite(Date.parse(query.end)) || Date.parse(query.start) >= Date.parse(query.end)) throw new AppError('invalid_input', 'Invalid scoped scheduling query.');
    if (query.ticketId) await this.ticket(p, query.ticketId);
    if (!p.companyIds.length) return { items: [], complete: true, fetchedAt: new Date(this.now()).toISOString(), warnings: [] };
    const budget = { remaining: 60 };
    const calls = await this.query(p, 'ServiceCalls', [{ field: 'companyID', op: 'in', value: p.companyIds }, { field: 'startDateTime', op: 'lt', value: query.end }, { field: 'endDateTime', op: 'gt', value: query.start }], budget);
    const items: SchedulePage['items'] = []; let complete = calls.complete;
    // Bounded per-parent joins prevent an association from silently crossing scope.
    for (const call of calls.items) {
      if (budget.remaining <= 0) { complete = false; break; }
      assertCompanyScope(p, call.companyID);
      if (!positiveId(call.status) || typeof call.startDateTime !== 'string' || typeof call.endDateTime !== 'string' || !Number.isFinite(Date.parse(call.startDateTime)) || !Number.isFinite(Date.parse(call.endDateTime)) || Date.parse(call.startDateTime) >= Date.parse(query.end) || Date.parse(call.endDateTime) <= Date.parse(query.start)) throw unavailable();
      const tickets = await this.query(p, 'ServiceCallTickets', [{ field: 'serviceCallID', op: 'eq', value: call.id }], budget); complete &&= tickets.complete;
      if (tickets.items.some((row) => row.serviceCallID !== call.id || !positiveId(row.ticketID))) throw unavailable();
      if (query.ticketId && !tickets.items.some((row) => row.ticketID === query.ticketId)) continue;
      let visible = true; const resourceIds: number[] = [];
      for (const association of tickets.items) {
        if (budget.remaining <= 0) { complete = false; visible = false; break; }
        budget.remaining--;
        try { const ticket = await this.ticket(p, association.ticketID as number); if (ticket.companyID !== call.companyID) visible = false; }
        catch (error) { if (!(error instanceof AppError) || error.code !== 'not_found_or_inaccessible') throw error; visible = false; }
        if (!visible) break;
        const resources = await this.query(p, 'ServiceCallTicketResources', [{ field: 'serviceCallTicketID', op: 'eq', value: association.id }], budget); complete &&= resources.complete;
        if (resources.items.some((row) => row.serviceCallTicketID !== association.id || !positiveId(row.resourceID))) throw unavailable();
        resourceIds.push(...resources.items.map((row) => row.resourceID as number));
      }
      if (!visible || !resourceIds.some((id) => query.resourceIds.includes(id))) continue;
      items.push({ id: call.id, company_id: call.companyID as number, start: call.startDateTime, end: call.endDateTime, status: call.status, complete: call.isComplete === 1 || call.isComplete === true,
        ticket_ids: tickets.items.map((row) => row.ticketID as number), resource_ids: [...new Set(resourceIds)].filter((id) => visibleResources.some((row) => row.id === id)), ...(typeof call.description === 'string' ? { description: call.description.slice(0, 2000) } : {}) });
    }
    return { items, complete, fetchedAt: new Date(this.now()).toISOString(), warnings: complete ? [] : ['The bounded scheduling query did not cover the entire authorized window.'] };
  }
  async createCall(p: Principal, ticketId: number, payload: ServiceCallCreatePayload) {
    p = structuredClone(p);
    payload = callSchema.parse(payload); await this.guard(p, 'ServiceCalls.create');
    const metadata = await this.metadata(p, ticketId);
    if (metadata.companyId !== payload.companyID || !metadata.statuses.some((row) => row.id === payload.status && row.active && row.bookable)) throw new AppError('precondition_failed', 'The service-call company or status is not eligible.');
    return this.created(await this.request(p, 'ServiceCalls.create', 'ServiceCalls', 'POST', payload, () => this.recheckMetadata(p, metadata)));
  }
  async updateCall(p: Principal, id: number, payload: ServiceCallUpdatePayload) {
    p = structuredClone(p);
    if (!positiveId(id) || payload.id !== id) throw new AppError('invalid_input', 'A positive service-call ID is required.');
    const current = await this.getCall(p, id);
    await this.guard(p, 'ServiceCalls.update');
    if (current.status === payload.status && payload.startDateTime === undefined && payload.endDateTime === undefined && payload.description === undefined) throw new AppError('invalid_input', 'Supply a changed service-call field.');
    if (payload.expected.startDateTime !== undefined && payload.expected.startDateTime !== current.startDateTime) throw new AppError('conflict', 'The service-call start changed before update.');
    if (payload.expected.endDateTime !== undefined && payload.expected.endDateTime !== current.endDateTime) throw new AppError('conflict', 'The service-call end changed before update.');
    if (payload.expected.status !== undefined && payload.expected.status !== current.status) throw new AppError('conflict', 'The service-call status changed before update.');
    if (payload.expected.description !== undefined && payload.expected.description !== current.description) throw new AppError('conflict', 'The service-call description changed before update.');
    if ((payload.startDateTime !== undefined || payload.endDateTime !== undefined) && (payload.startDateTime === undefined || payload.endDateTime === undefined)) throw new AppError('invalid_input', 'Start and end must be supplied together.');
    if (payload.startDateTime !== undefined && Date.parse(payload.startDateTime) >= Date.parse(payload.endDateTime!)) throw new AppError('invalid_input', 'The service-call end must follow its start.');
    if (payload.status !== undefined && !positiveId(payload.status)) throw new AppError('invalid_input', 'A valid active service-call status is required.');
    const body = { id, ...(payload.startDateTime === undefined ? {} : { startDateTime: payload.startDateTime, endDateTime: payload.endDateTime }), ...(payload.status === undefined ? {} : { status: payload.status }), ...(payload.description === undefined ? {} : { description: payload.description }) };
    await this.request(p, 'ServiceCalls.update', 'ServiceCalls', 'PATCH', body);
    return { id };
  }
  async cancelCall(p: Principal, id: number, expectedStatus: number, cancelStatus: number) {
    p = structuredClone(p);
    if (!positiveId(id) || !positiveId(expectedStatus) || !positiveId(cancelStatus)) throw new AppError('invalid_input', 'Positive service-call and status IDs are required.');
    const current = await this.getCall(p, id);
    if (current.status !== expectedStatus) throw new AppError('conflict', 'The service-call status changed before cancellation.');
    await this.guard(p, 'ServiceCalls.cancel');
    await this.request(p, 'ServiceCalls.cancel', 'ServiceCalls', 'PATCH', { id, status: cancelStatus });
    return { id };
  }
  async getCall(p: Principal, id: number) {
    p = structuredClone(p);
    if (!positiveId(id)) throw new AppError('invalid_input', 'A positive service-call ID is required.');
    const row = this.item(await this.request(p, 'ServiceCalls.get', `ServiceCalls/${id}`, 'GET'), id); assertCompanyScope(p, row.companyID); return row as ServiceCallRecord;
  }
  async createTicket(p: Principal, callId: number, ticketId: number) {
    p = structuredClone(p);
    await this.guard(p, 'ServiceCallTickets.create'); const call = await this.getCall(p, callId), ticket = await this.ticket(p, ticketId);
    if (ticket.companyID !== call.companyID) throw new AppError('precondition_failed', 'The service call and ticket must belong to the exact same company.');
    return this.created(await this.request(p, 'ServiceCallTickets.create', `ServiceCalls/${callId}/Tickets`, 'POST', { serviceCallID: callId, ticketID: ticketId }, async () => {
      const currentCall = await this.getCall(p, callId), currentTicket = await this.ticket(p, ticketId);
      if (currentCall.companyID !== call.companyID || currentTicket.companyID !== ticket.companyID || currentCall.companyID !== currentTicket.companyID) throw new AppError('precondition_failed', 'The service-call or ticket parent company changed before dispatch.');
      return () => {};
    }));
  }
  async getTicket(p: Principal, callId: number, id: number) {
    p = structuredClone(p);
    if (!positiveId(id)) throw new AppError('invalid_input', 'A positive association ID is required.');
    const call = await this.getCall(p, callId), row = this.item(await this.request(p, 'ServiceCallTickets.get', `ServiceCalls/${callId}/Tickets/${id}`, 'GET'), id);
    if (row.serviceCallID !== callId || !positiveId(row.ticketID)) throw new AppError('not_found_or_inaccessible', 'Service-call ticket association not found or inaccessible.');
    const ticket = await this.ticket(p, row.ticketID); if (ticket.companyID !== call.companyID) throw new AppError('not_found_or_inaccessible', 'Service-call ticket association not found or inaccessible.');
    return row as ServiceCallTicketRecord;
  }
  private async association(p: Principal, id: number, expected?: { serviceCallId: number; ticketId: number; companyId: number }) {
    if (!positiveId(id)) throw new AppError('invalid_input', 'A positive association ID is required.');
    const row = this.item(await this.request(p, 'ServiceCallTickets.get', `ServiceCallTickets/${id}`, 'GET'), id);
    if (!positiveId(row.serviceCallID) || !positiveId(row.ticketID)) throw unavailable();
    if (expected && (row.serviceCallID !== expected.serviceCallId || row.ticketID !== expected.ticketId)) throw new AppError('precondition_failed', 'The service-call ticket association changed before dispatch.');
    const call = await this.getCall(p, row.serviceCallID), ticket = await this.ticket(p, row.ticketID);
    if (call.companyID !== ticket.companyID) throw new AppError('not_found_or_inaccessible', 'Service-call ticket association not found or inaccessible.');
    if (expected && call.companyID !== expected.companyId) throw new AppError('precondition_failed', 'The service-call ticket parent company changed before dispatch.');
    return row as ServiceCallTicketRecord;
  }
  async createResource(p: Principal, callTicketId: number, resourceId: number) {
    p = structuredClone(p);
    if (!positiveId(resourceId)) throw new AppError('invalid_input', 'A positive resource ID is required.');
    await this.guard(p, 'ServiceCallTicketResources.create'); const association = await this.association(p, callTicketId), metadata = await this.metadata(p, association.ticketID);
    if (!metadata.ticketResourceIds.includes(resourceId) || !(await this.resources(p)).some((row) => row.id === resourceId && row.active && row.companyIds.includes(metadata.companyId))) throw new AppError('precondition_failed', 'The resource must be active and assigned to the ticket.');
    return this.created(await this.request(p, 'ServiceCallTicketResources.create', `ServiceCallTickets/${callTicketId}/Resources`, 'POST', { serviceCallTicketID: callTicketId, resourceID: resourceId }, async () => {
      await this.association(p, callTicketId, { serviceCallId: association.serviceCallID as number, ticketId: association.ticketID as number, companyId: metadata.companyId });
      return this.recheckMetadata(p, metadata, resourceId);
    }));
  }
  async getResource(p: Principal, callTicketId: number, id: number) {
    p = structuredClone(p);
    if (!positiveId(id)) throw new AppError('invalid_input', 'A positive resource association ID is required.');
    await this.association(p, callTicketId);
    const row = this.item(await this.request(p, 'ServiceCallTicketResources.get', `ServiceCallTickets/${callTicketId}/Resources/${id}`, 'GET'), id);
    if (row.serviceCallTicketID !== callTicketId || !(await this.resources(p)).some((resource) => resource.id === row.resourceID)) throw new AppError('not_found_or_inaccessible', 'Service-call resource association not found or inaccessible.');
    return row as ServiceCallResourceRecord;
  }
}
