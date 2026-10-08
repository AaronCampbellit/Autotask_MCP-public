import {providerFetch} from '../../execution/src/index.js';
import {valueSchema,udfSchema} from '../../native-fields/src/index.js';
import { assertEntityArea } from '../../policy/src/areas.js';
import { AppError, actorKey, positiveId, validCompanyId, type Principal } from '../../contracts/src/index.js';
import type { TechnicianHttpRequest, TechnicianHttpTransport } from '../../technician/src/http.js';
import { requestScheduler } from './index.js';
import type { RequestBudgetPort } from './budget.js';
import { impersonationHeader } from './impersonation.js';

export interface HttpTechnicianTransportOptions {
  baseUrl: string; username: string; secret: string; integrationCode: string;
  requestBudget?: RequestBudgetPort;
  revalidatePrincipal?: (principal: Principal) => Promise<Principal>;
  fetch?: typeof fetch; now?: () => number;
  timeoutMs?: number; queueTimeoutMs?: number; identityFreshnessMs?: number;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const inputError = () => new AppError('invalid_input', 'The technician transport request does not match a reviewed operation.');
const identity = (p: Principal) => JSON.stringify([p.tenantId, p.objectId, p.resourceId, p.mappingVersion, p.policyVersion, [...p.companyIds].sort(), p.areaPermissions, [...p.capabilities].sort()]);
const validPrincipal = (p: Principal) => Boolean(p?.active && positiveId(p.resourceId) && positiveId(p.mappingVersion) && typeof p.tenantId === 'string' && p.tenantId && typeof p.objectId === 'string' && p.objectId && typeof p.policyVersion === 'string' && p.policyVersion && Array.isArray(p.companyIds) && p.companyIds.every(validCompanyId) && Array.isArray(p.capabilities));
const instant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function reviewedRequest(p: Principal, request: TechnicianHttpRequest): { path: string; body?: string; mutation: boolean } {
  if (!object(request) || Object.keys(request).some(key => !['operation', 'method', 'path', 'body', 'beforeDispatch', 'continuation', 'validatedNativeFields'].includes(key)) || typeof request.beforeDispatch !== 'function' || typeof request.path !== 'string') throw inputError();
  const mutation = request.operation === 'Tickets.patch.expanded';
  if (mutation) {
    if (request.method !== 'PATCH' || request.path !== 'Tickets' || !object(request.body) || !positiveId(request.body.id) || Object.keys(request.body).length < 2) throw inputError();
    for (const [field, value] of Object.entries(request.body)) {
      if (field === 'id') continue;
      if(request.validatedNativeFields?.includes(field)){if(!valueSchema.safeParse(value).success||Array.isArray(value)&&!(field==='userDefinedFields'&&udfSchema.safeParse(value).success))throw inputError();continue;}
      if (field === 'title' ? typeof value !== 'string' || !value.trim() || value.length > 255
        : field === 'dueDateTime' ? !instant(value)
        : field === 'resolution' ? typeof value !== 'string' || value.length > 32_000
        : ['assignedResourceID', 'assignedResourceRoleID', 'queueID', 'contactID', 'subIssueType'].includes(field) ? value !== null && !positiveId(value)
        : ['status', 'ticketCategory', 'priority','opportunityID','issueType'].includes(field) ? !positiveId(value) : true) throw inputError();
    }
  } else if (['ConfigurationItems.get', 'Contacts.get', 'CompanyLocations.get', 'Tasks.get', 'Projects.get'].includes(request.operation)) {
    const entity = request.operation.split('.')[0]!;
    if (request.method !== 'GET' || !new RegExp(`^${entity}/[1-9]\\d*$`).test(request.path) || !positiveId(Number(request.path.slice(entity.length + 1))) || request.body !== undefined) throw inputError();
  } else if (['TicketHistory.query','TicketChecklistItems.query'].includes(request.operation)) {
    if (request.method !== 'POST' || request.path !== (request.operation==='TicketHistory.query'?'TicketHistory/query':'TicketChecklistItems/query') || !object(request.body) || Object.keys(request.body).some(key => key !== 'filter' && !(request.operation==='TicketHistory.query'&&key==='MaxRecords')) || (request.body.MaxRecords!==undefined&&request.body.MaxRecords!==500) || !Array.isArray(request.body.filter) || request.body.filter.length !== 1) throw inputError();
    const filter = request.body.filter[0];
    if (!object(filter) || Object.keys(filter).length !== 3 || filter.op !== 'eq' || filter.field !== 'ticketID' || !positiveId(filter.value)) throw inputError();
  } else if (request.operation === 'TimeEntries.query.own') {
    if (!p.capabilities.includes('time.self')) throw new AppError('forbidden','Own-time read permission is required.');
    if (request.method !== 'POST' || request.path !== 'TimeEntries/query' || !object(request.body) || Object.keys(request.body).some(key => !['filter','MaxRecords'].includes(key)) || request.body.MaxRecords !== 100 || !Array.isArray(request.body.filter) || request.body.filter.length !== 3) throw inputError();
    const filters=request.body.filter;
    if(filters.some(f=>!object(f)||Object.keys(f).length!==3))throw inputError();
    const owner=filters.find(f=>f.field==='resourceID'),start=filters.find(f=>f.field==='dateWorked'&&f.op==='gte'),end=filters.find(f=>f.field==='dateWorked'&&f.op==='lt');
    if(!owner||owner.op!=='eq'||owner.value!==p.resourceId||!start||!instant(start.value)||!end||!instant(end.value)||Date.parse(start.value)>=Date.parse(end.value)||Date.parse(end.value)-Date.parse(start.value)>32*86_400_000)throw inputError();
  } else if (request.operation === 'Tasks.query') {
    if (request.method !== 'POST' || request.path !== 'Tasks/query' || !object(request.body) || Object.keys(request.body).some(key => !['filter', 'MaxRecords'].includes(key)) || request.body.MaxRecords !== 100 || !Array.isArray(request.body.filter) || request.body.filter.length !== 3) throw inputError();
    const filters = request.body.filter;
    if (filters.some(filter => !object(filter) || Object.keys(filter).length !== 3)) throw inputError();
    const owner = filters.find(filter => filter.field === 'assignedResourceID'), start = filters.find(filter => filter.field === 'startDateTime'), end = filters.find(filter => filter.field === 'endDateTime');
    if (!owner || owner.op !== 'eq' || owner.value !== p.resourceId || !start || start.op !== 'lt' || !instant(start.value) || !end || end.op !== 'gte' || !instant(end.value) || Date.parse(end.value) >= Date.parse(start.value)) throw inputError();
  } else {
    // Only explicitly reviewed entity routes are accepted.
    throw new AppError('unsupported_operation', 'This technician transport operation has no reviewed route.');
  }
  if(request.continuation!==undefined&&(mutation||request.method!=='POST'||!request.path.endsWith('/query')||typeof request.continuation!=='string'))throw inputError();
  return { path: request.path, mutation, ...(request.body === undefined ? {} : { body: JSON.stringify(structuredClone(request.body)) }) };
}

/** Internal authenticated transport for the fixed HttpTechnicianPort surface.
 * Native qualification and semantic/parent validation remain in that port's
 * required dispatch guard. No generic MCP endpoint exposes this transport.
 */
export class HttpTechnicianTransport implements TechnicianHttpTransport {
  private readonly base: URL;
  private readonly headers: Record<string, string>;
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;
  private readonly timeout: number;
  private readonly queueTimeout: number;
  private readonly freshness: number;
  constructor(private readonly options: HttpTechnicianTransportOptions) {
    if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl)) throw inputError();
    if ([options.username, options.secret, options.integrationCode].some(value => typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value))) throw inputError();
    this.base = new URL(options.baseUrl);
    this.headers = { UserName: options.username, Secret: options.secret, ApiIntegrationCode: options.integrationCode, Accept: 'application/json', 'Content-Type': 'application/json' };
    this.fetcher = providerFetch('Autotask',options.fetch ?? globalThis.fetch); this.clock = options.now ?? Date.now;
    this.timeout = options.timeoutMs ?? 15_000; this.queueTimeout = options.queueTimeoutMs ?? this.timeout; this.freshness = options.identityFreshnessMs ?? 60_000;
    if (![this.timeout, this.queueTimeout].every(value => Number.isInteger(value) && value >= 1 && value <= 60_000) || !Number.isInteger(this.freshness) || this.freshness < 1 || this.freshness > 300_000) throw inputError();
  }
  private async actor(p: Principal, write: boolean) {
    if (!validPrincipal(p)) throw new AppError('identity_mapping_invalid', 'An active mapped employee is required.');
    if (!this.options.revalidatePrincipal) throw new AppError('identity_validation_unavailable', 'Authoritative employee validation is required.');
    let current: Principal;
    try { current = await this.options.revalidatePrincipal(structuredClone(p)); } catch { throw new AppError('identity_validation_unavailable', 'Employee validation is unavailable.'); }
    if (!validPrincipal(current) || identity(current) !== identity(p)) throw new AppError('identity_mapping_invalid', 'The mapped employee or permission policy changed.');
    const verified = Date.parse(current.resourceVerifiedAt);
    if (!Number.isFinite(verified) || verified > this.clock() || this.clock() - verified > this.freshness) throw new AppError('identity_validation_unavailable', 'Current employee validation evidence is required.');
    if (!current.capabilities.includes('operational.read') || (write && !current.capabilities.includes('tickets.write'))) throw new AppError('forbidden', 'The employee cannot perform this technician operation.');
  }
  async request(inputPrincipal: Principal, input: TechnicianHttpRequest): Promise<unknown> {
    const p = structuredClone(inputPrincipal);
    if (!validPrincipal(p)) throw new AppError('identity_mapping_invalid', 'An active mapped employee is required.');
    assertEntityArea(p, input.operation.split('.')[0]!, input.method === 'PATCH');
    const reviewed = reviewedRequest(p, input), method = input.continuation ? 'GET' : input.method, beforeDispatch = input.beforeDispatch;
    let url = new URL(reviewed.path, this.base);
    if(input.continuation){
      let next:URL;try{next=new URL(input.continuation);}catch{throw inputError();}
      if(next.origin!==this.base.origin||next.pathname!==url.pathname+'/next'||next.username||next.password||next.hash||[...next.searchParams.keys()].length!==1||!next.searchParams.get('paging')||input.continuation.length>8000)throw inputError();
      url=next;
    }
    return requestScheduler.runWithLease(actorKey(p), this.queueTimeout, async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined; const controller = new AbortController(); let dispatched = false;
    try {
      return await Promise.race([
        (async () => {
          await this.actor(p, reviewed.mutation);
          await this.options.requestBudget?.take({tenantId:p.tenantId,actorKey:actorKey(p),signal:controller.signal});
          await beforeDispatch();
          await this.actor(p, reviewed.mutation);
          requestScheduler.assertLeaseIdle(actorKey(p));
          if (controller.signal.aborted) throw new AppError('dependency_unavailable', 'The technician dispatch deadline expired before dispatch.');
          dispatched = true;
          const response = await this.fetcher(url, { method, headers: { ...this.headers, ...impersonationHeader(input.operation.split('.')[0]!,p.resourceId) }, body: method==='GET'?undefined:reviewed.body, redirect: 'manual', signal: controller.signal });
          if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) throw new AppError('dependency_unavailable', 'Unexpected technician response.');
          if (!response.ok) {
            await response.body?.cancel();
            const code = response.status === 401 || response.status === 403 ? 'forbidden' : response.status === 404 ? 'not_found_or_inaccessible' : response.status === 400 || response.status === 422 ? 'invalid_input' : response.status === 409 ? 'conflict' : response.status === 429 ? 'throttled' : reviewed.mutation ? 'unknown_outcome' : 'dependency_unavailable';
            throw new AppError(code, code === 'unknown_outcome' ? 'The ticket update outcome is unknown. Reconcile before another write.' : 'Autotask rejected or could not complete this technician operation.');
          }
          const reader = response.body?.getReader(); if (!reader) throw new AppError('dependency_unavailable', 'Missing technician response.');
          const chunks: Uint8Array[] = []; let bytes = 0;
          try {
            while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw new AppError('dependency_unavailable', 'Technician response exceeded its budget.'); } chunks.push(chunk.value); }
          } finally { reader.releaseLock(); }
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('dependency_unavailable', 'Invalid technician response.'); }
        })(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new AppError(dispatched && reviewed.mutation ? 'unknown_outcome' : 'dependency_unavailable', dispatched && reviewed.mutation ? 'The ticket update outcome is unknown. Reconcile before another write.' : 'The technician operation deadline expired.')); }, this.timeout); }),
      ]);
    } catch (error) {
      if (error instanceof AppError && (!dispatched || error.code !== 'dependency_unavailable')) throw error;
      throw new AppError(dispatched && reviewed.mutation ? 'unknown_outcome' : 'dependency_unavailable', dispatched && reviewed.mutation ? 'The ticket update outcome is unknown. Reconcile before another write.' : 'The technician operation is unavailable.');
    } finally { if (timeout) clearTimeout(timeout); controller.abort(); }
    }, !reviewed.mutation);
  }
}
