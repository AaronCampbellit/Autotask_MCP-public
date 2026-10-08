import {providerFetch} from '../../execution/src/index.js';
import { assertArea, assertEntityArea } from '../../policy/src/areas.js';
import { AppError, actorKey, positiveId, type DataRecord, type Principal } from '../../contracts/src/index.js';
import { reauthorize, assertCapability } from '../../policy/src/index.js';
import { requestScheduler } from '../../autotask/src/index.js';
import { impersonationHeader } from '../../autotask/src/impersonation.js';
import type { RequestBudgetPort } from '../../autotask/src/budget.js';
import type { IntentCipher } from '../../storage/src/intent-cipher.js';
import type { Availability, BillingApprovalLevel, ExpenseReport, TimeEntry, TimeOffApprover, TimeOffRequest, WorkManagementPort } from './contracts.js';
import type { WorkManagementOptions } from './index.js';

export type WorkManagementOperation = 'TimeEntries.query'|'TimeEntries.get'|'TimeEntries.create'|'TimeEntries.update'|'TimeEntries.delete'|'BillingItemApprovalLevels.query'|'BillingItemApprovalLevels.get'|'BillingItemApprovalLevels.create'|'Tasks.get'|'Projects.get'|'ExpenseReports.get'|'ExpenseReports.create'|'ExpenseReports.update'|'ExpenseItems.get'|'ExpenseItems.create'|'ResourceDailyAvailabilities.get'|'ResourceDailyAvailabilities.update'|'TimeOffRequests.query'|'TimeOffRequests.get'|'TimeOffRequests.create'|'TimeOffRequests.update'|'ResourceTimeOffApprovers.query'|'TimeOffRequestsApprove.create'|'TimeOffRequestsReject.create';
/** Native operations with fixed routes reviewed against the captured Swagger.
 * Keep this list separate from MCP tool names so application allowlists cannot
 * accidentally authorize an unreviewed wrapper. */
export const WORK_MANAGEMENT_NATIVE_OPERATIONS: readonly WorkManagementOperation[] = Object.freeze([
  'TimeEntries.query', 'TimeEntries.get', 'TimeEntries.create', 'TimeEntries.update', 'TimeEntries.delete',
  'BillingItemApprovalLevels.query', 'BillingItemApprovalLevels.get', 'BillingItemApprovalLevels.create',
  'Tasks.get', 'Projects.get', 'ExpenseReports.get', 'ExpenseReports.create', 'ExpenseReports.update',
  'ExpenseItems.get', 'ExpenseItems.create', 'ResourceDailyAvailabilities.get', 'ResourceDailyAvailabilities.update',
  'TimeOffRequests.query', 'TimeOffRequests.get', 'TimeOffRequests.create', 'TimeOffRequests.update',
  'ResourceTimeOffApprovers.query', 'TimeOffRequestsApprove.create', 'TimeOffRequestsReject.create',
]);
export interface WorkManagementQualification { operation: WorkManagementOperation; evidenceSource: 'live'|'fixture'; headerAccepted: boolean; permissionEnforced: boolean; nativeAttribution?: boolean; tenantId: string; policyVersion: string; resourceIds: number[]; testIds: string[]; qualifiedAt: string; expiresAt: string; evidenceReference: string }
export interface HttpWorkManagementOptions { baseUrl: string; username: string; secret: string; integrationCode: string; requestBudget?: RequestBudgetPort; qualifications?: WorkManagementQualification[]; applicationOperations?: { tenantId: string; operations: readonly WorkManagementOperation[] }; revalidatePrincipal?: (principal: Principal) => Promise<Principal>; fetch?: typeof fetch; now?: () => number; timeoutMs?: number; writesEnabled?: boolean; cursorCipher?: IntentCipher; validateTimeEligibility?: WorkManagementOptions['validateTime']; validateExpensePolicy?: WorkManagementOptions['validateExpense']; validateTimeOffRequest?: WorkManagementOptions['validateTimeOff']; resolveExpenseStatuses?: WorkManagementOptions['resolveExpenseStatuses']; resolveTimeOffStatuses?: WorkManagementOptions['resolveTimeOffStatuses'] }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (code: 'dependency_unavailable'|'unknown_outcome'|'not_found_or_inaccessible'|'invalid_input'|'forbidden'|'throttled' = 'dependency_unavailable', message = 'Autotask work-management response was invalid or unavailable.') => new AppError(code, message);

/** Fixed root/parent routes captured from the official Autotask Swagger and
 * entity documentation. Fixture tests can inject fetch; this adapter never
 * performs a live request without reviewed operation evidence. */
export class HttpWorkManagementPort implements WorkManagementPort {
  readonly source = 'Autotask' as const; private readonly base: URL; private readonly fetcher: typeof fetch; private readonly now: () => number; private readonly timeout: number; private readonly qualifications: WorkManagementQualification[];
  constructor(private readonly options: HttpWorkManagementOptions) { if (!/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(options.baseUrl)) throw new AppError('invalid_input','Invalid Autotask base URL.'); this.base = new URL(options.baseUrl); if ([options.username,options.secret,options.integrationCode].some(v => !v || /[\r\n\0]/.test(v))) throw new AppError('invalid_input','Server-owned work-management credentials are invalid.'); this.fetcher=providerFetch('Autotask',options.fetch??fetch);this.now=options.now??Date.now;this.timeout=options.timeoutMs??15000;if(!Number.isInteger(this.timeout)||this.timeout<1||this.timeout>60000)throw new AppError('invalid_input','Invalid work-management deadline.');this.qualifications=structuredClone(options.qualifications??[]); }
  private async guard(p: Principal, operation: WorkManagementOperation, write = false) {
    if (!p.active || !positiveId(p.resourceId) || !p.tenantId || !p.objectId) throw new AppError('identity_mapping_invalid','An active mapped employee is required.');
    if (!this.options.revalidatePrincipal) throw new AppError('identity_validation_unavailable','Authoritative employee validation is required.');
    let fresh: Principal;
    try { fresh=await this.options.revalidatePrincipal(structuredClone(p)); } catch { throw new AppError('identity_validation_unavailable','Authoritative employee validation is unavailable.'); }
    if (!fresh.active || fresh.tenantId!==p.tenantId || fresh.objectId!==p.objectId || fresh.resourceId!==p.resourceId || fresh.mappingVersion!==p.mappingVersion || fresh.policyVersion!==p.policyVersion) throw new AppError('identity_mapping_invalid','The employee mapping or policy changed.');
    assertCapability(fresh,'operational.read');
    const approval = operation.startsWith('BillingItemApprovalLevels') || operation.startsWith('ResourceTimeOffApprovers') || operation.startsWith('TimeOffRequestsApprove') || operation.startsWith('TimeOffRequestsReject');
    const required = approval ? 'time.approve' : operation.startsWith('Expense') ? 'expenses.write' : operation.startsWith('ResourceDaily') || operation.startsWith('TimeOff') ? 'scheduling.write' : 'time.self';
    assertEntityArea(fresh, operation.split('.')[0]!, write);
    if (approval) assertCapability(fresh,'time.approve');
    if (operation.startsWith('BillingItemApprovalLevels')) { assertArea(fresh,'finance',write); assertCapability(fresh,write?'finance.write':'finance.read'); }
    if (write && (operation.startsWith('TimeOffRequestsApprove') || operation.startsWith('TimeOffRequestsReject'))) assertCapability(fresh,'scheduling.write');
    if(write){assertCapability(fresh,required);if(this.options.writesEnabled!==true)throw new AppError('forbidden','Work-management writes are disabled until explicitly enabled.');}
    const q=this.qualifications.some(x=>x.operation===operation&&x.evidenceSource==='live'&&x.headerAccepted&&x.permissionEnforced&&(!write||x.nativeAttribution===true)&&x.tenantId===p.tenantId&&x.policyVersion===p.policyVersion&&x.resourceIds.includes(p.resourceId)&&x.testIds.length>0&&x.evidenceReference.trim()&&Date.parse(x.expiresAt)>this.now());
    if (!(this.options.applicationOperations?.tenantId===p.tenantId&&this.options.applicationOperations.operations.includes(operation))&&!q) throw new AppError('impersonation_not_qualified','This exact work-management operation has no reviewed live permission evidence.');
    return fresh;
  }
  private async request(p: Principal, operation: WorkManagementOperation, route: string, method: 'GET'|'POST'|'PATCH'|'DELETE', body?: unknown, write = false, beforeDispatch?: () => Promise<void>, requireApproval = false): Promise<unknown> {
    const dispatch = async () => {
      const first = await this.guard(p, operation, write);
      if (requireApproval) assertCapability(first,'time.approve');
      await this.options.requestBudget?.take({ tenantId: p.tenantId, actorKey: actorKey(p) });
      const second = await this.guard(p, operation, write);
      if (requireApproval) assertCapability(second,'time.approve');
      if (beforeDispatch) { await beforeDispatch(); const third=await this.guard(p, operation, write); if (requireApproval) assertCapability(third,'time.approve'); requestScheduler.assertLeaseIdle(actorKey(p)); }
      const url = new URL(route, this.base);
      if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password || url.hash) throw new AppError('invalid_input', 'Unapproved work-management route.');
      let response: Response;
      try {
        response = await this.fetcher(url, { method, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(this.timeout), headers: { UserName: this.options.username, Secret: this.options.secret, ApiIntegrationCode: this.options.integrationCode, ...(operation.startsWith('TimeOffRequestsApprove') || operation.startsWith('TimeOffRequestsReject') ? { ImpersonationResourceId: String(p.resourceId) } : impersonationHeader(operation.split('.')[0]!,p.resourceId)), Accept: 'application/json', 'Content-Type': 'application/json' } });
      } catch { throw fail(write ? 'unknown_outcome' : 'dependency_unavailable', write ? 'The work-management write outcome is unknown; reconcile before another write.' : 'Autotask work-management is unavailable.'); }
      if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) throw fail(write ? 'unknown_outcome' : 'dependency_unavailable', 'Autotask returned an unexpected redirect.');
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) throw fail('forbidden', 'Autotask denied the work-management operation.');
        if (response.status === 404) throw fail('not_found_or_inaccessible', 'The work record was not found or is inaccessible.');
        if (response.status === 429) throw fail('throttled', 'Autotask is throttling work-management requests.');
        throw fail(write ? 'unknown_outcome' : 'dependency_unavailable', `Autotask returned HTTP ${response.status}.`);
      }
      if (method === 'DELETE' || response.status === 204) return {};
      const reader = response.body?.getReader();
      if (!reader) throw fail(write ? 'unknown_outcome' : 'dependency_unavailable', 'Autotask returned an empty response.');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2_000_000) { await reader.cancel(); throw fail(write ? 'unknown_outcome' : 'dependency_unavailable', 'Autotask response exceeded its size budget.'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(write ? 'unknown_outcome' : 'dependency_unavailable', 'Autotask returned invalid JSON.'); }
    };
    if (beforeDispatch) return requestScheduler.runWithLease(actorKey(p), this.timeout, dispatch);
    const release = await requestScheduler.acquire(actorKey(p), this.timeout);
    try { return await dispatch(); } finally { release(); }
  }
  private item<T>(value: unknown,id:number): T { if(!obj(value)||!obj(value.item)||value.item.id!==id)throw fail();return value.item as T; }
  private created(value: unknown) { if(!obj(value)||!positiveId(value.itemId))throw fail('unknown_outcome','Autotask accepted a write without returning a usable ID.');return {id:value.itemId}; }
  private continuation(cursor: string, root: string) { let url: URL; try { url = new URL(cursor); } catch { throw new AppError('invalid_input','The work-management cursor is invalid.'); } const expected = new URL(root,this.base); if(url.origin!==this.base.origin || url.pathname!==`${expected.pathname}/next` || [...url.searchParams.keys()].length!==1 || !url.searchParams.get('paging')) throw new AppError('invalid_input','The work-management cursor is invalid or belongs to another query.'); return url.href; }
  private cursorIdentity(p: Principal) { return { actor: actorKey(p), mappingVersion: p.mappingVersion, resourceId: p.resourceId, policyVersion: p.policyVersion, companyIds: [...p.companyIds].sort((a, b) => a - b), capabilities: [...p.capabilities].sort() }; }
  private cursorBinding(p: Principal, operation: WorkManagementOperation, filter: unknown[], pageSize: number) { return `work-management-cursor:v1|${JSON.stringify({ identity: this.cursorIdentity(p), operation, filter, pageSize })}`; }
  private sealCursor(p: Principal, operation: WorkManagementOperation, root: string, filter: unknown[], pageSize: number, native: string) { const cipher = this.options.cursorCipher; if (!cipher) throw new AppError('missing_metadata','Encrypted work-management pagination is unavailable.'); const binding = this.cursorBinding(p, operation, filter, pageSize); return cipher.seal({ version: 1, ...this.cursorIdentity(p), operation, root, filter, pageSize, native, expires: this.now() + 300_000 }, binding); }
  private openCursor(p: Principal, operation: WorkManagementOperation, root: string, filter: unknown[], pageSize: number, cursor: string) { const cipher = this.options.cursorCipher; if (!cipher) throw new AppError('invalid_input','The work-management cursor is invalid.'); const binding = this.cursorBinding(p, operation, filter, pageSize); let value: unknown; try { value = cipher.open(cursor, binding); } catch { throw new AppError('invalid_input','The work-management cursor is invalid, expired, or belongs to another query.'); } const identity = this.cursorIdentity(p); if (!obj(value) || value.version !== 1 || value.actor !== identity.actor || value.mappingVersion !== identity.mappingVersion || value.resourceId !== identity.resourceId || value.policyVersion !== identity.policyVersion || JSON.stringify(value.companyIds) !== JSON.stringify(identity.companyIds) || JSON.stringify(value.capabilities) !== JSON.stringify(identity.capabilities) || value.operation !== operation || value.root !== root || value.pageSize !== pageSize || value.expires !== undefined && (typeof value.expires !== 'number' || value.expires <= this.now()) || JSON.stringify(value.filter) !== JSON.stringify(filter) || typeof value.native !== 'string') throw new AppError('invalid_input','The work-management cursor is invalid, expired, or belongs to another query.'); return this.continuation(value.native, root); }
  async searchTime(p: Principal, input: { scope: 'ticket'|'task'|'internal'|'all'; parentId?: number; resourceId: number; from?: string; to?: string; pageSize: number; cursor?: string }) { if(input.scope==='all'||input.resourceId!==p.resourceId&&input.resourceId!==0)assertCapability(p,'time.approve'); const filter: unknown[]=[];if(input.scope==='ticket')filter.push({field:'ticketID',op:'eq',value:input.parentId});if(input.scope==='task')filter.push({field:'taskID',op:'eq',value:input.parentId});if(input.scope==='internal'){filter.push({field:'ticketID',op:'eq',value:null},{field:'taskID',op:'eq',value:null});}if(input.resourceId>0)filter.push({field:'resourceID',op:'eq',value:input.resourceId});if(input.from)filter.push({field:'dateWorked',op:'gte',value:`${input.from}T00:00:00Z`});if(input.to)filter.push({field:'dateWorked',op:'lte',value:`${input.to}T23:59:59.999Z`});const continuation=Boolean(input.cursor), route=continuation?this.openCursor(p,'TimeEntries.query','TimeEntries/query',filter,input.pageSize,input.cursor!):'TimeEntries/query',value=await this.request(p,'TimeEntries.query',route,continuation?'GET':'POST',continuation?undefined:{MaxRecords:input.pageSize,filter},false,undefined,input.scope==='all'||input.resourceId!==p.resourceId&&input.resourceId!==0);if(!obj(value)||!Array.isArray(value.items)||!obj(value.pageDetails))throw fail();const rawNext=typeof value.pageDetails.nextPageUrl==='string'?value.pageDetails.nextPageUrl:null;const next=rawNext?this.sealCursor(p,'TimeEntries.query','TimeEntries/query',filter,input.pageSize,this.continuation(rawNext,'TimeEntries/query')):null;return {items:value.items as TimeEntry[],nextCursor:next,complete:!next,fetchedAt:new Date(this.now()).toISOString()}; }
  async searchBillingApprovals(p: Principal,timeEntryId:number){assertCapability(p,'time.approve');const value=await this.request(p,'BillingItemApprovalLevels.query','BillingItemApprovalLevels/query','POST',{MaxRecords:100,filter:[{field:'timeEntryID',op:'eq',value:timeEntryId}]});if(!obj(value)||!Array.isArray(value.items)||!obj(value.pageDetails)||value.pageDetails.nextPageUrl)throw fail('dependency_unavailable','Billing approval history is incomplete.');return value.items as BillingApprovalLevel[];}
  async getBillingApproval(p: Principal,id:number){return this.item<BillingApprovalLevel>(await this.request(p,'BillingItemApprovalLevels.get',`BillingItemApprovalLevels/${id}`,'GET'),id);}
  async createBillingApproval(p: Principal,payload:{timeEntryID:number;approvalLevel:number;approvalResourceID:number;approvalDateTime:string},beforeDispatch?:()=>Promise<void>){return this.created(await this.request(p,'BillingItemApprovalLevels.create','BillingItemApprovalLevels','POST',payload,true,beforeDispatch));}
  async getTime(p: Principal,id:number){return this.item<TimeEntry>(await this.request(p,'TimeEntries.get',`TimeEntries/${id}`,'GET'),id);}
  async createTime(p: Principal,payload: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){return this.created(await this.request(p,'TimeEntries.create','TimeEntries','POST',payload,true,beforeDispatch));}
  async updateTime(p: Principal,id:number,changes: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){await this.request(p,'TimeEntries.update','TimeEntries','PATCH',{id,...changes},true,beforeDispatch);return {id};}
  async deleteTime(p: Principal,id:number,beforeDispatch?:()=>Promise<void>){await this.request(p,'TimeEntries.delete',`TimeEntries/${id}`,'DELETE',undefined,true,beforeDispatch);}
  async getTask(p: Principal,id:number){return this.item<DataRecord>(await this.request(p,'Tasks.get',`Tasks/${id}`,'GET'),id);}
  async getProject(p: Principal,id:number){return this.item<DataRecord>(await this.request(p,'Projects.get',`Projects/${id}`,'GET'),id);}
  async getExpenseReport(p: Principal,id:number){return this.item<ExpenseReport>(await this.request(p,'ExpenseReports.get',`ExpenseReports/${id}`,'GET'),id);}
  async getExpenseItem(p: Principal,id:number){return this.item<import('./contracts.js').ExpenseItem>(await this.request(p,'ExpenseItems.get',`ExpenseItems/${id}`,'GET'),id);}
  async createExpenseReport(p: Principal,payload: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){return this.created(await this.request(p,'ExpenseReports.create','ExpenseReports','POST',payload,true,beforeDispatch));}
  async createExpenseItem(p: Principal,reportId:number,payload: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){return this.created(await this.request(p,'ExpenseItems.create',`Expenses/${reportId}/Items`,'POST',payload,true,beforeDispatch));}
  async updateExpenseReport(p: Principal,id:number,changes: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){await this.request(p,'ExpenseReports.update','ExpenseReports','PATCH',{id,...changes},true,beforeDispatch);return {id};}
  async getAvailability(p: Principal){const value=await this.request(p,'ResourceDailyAvailabilities.get',`Resources/${p.resourceId}/DailyAvailabilities`,'GET');if(!obj(value)||!Array.isArray(value.items)||value.items.length!==1)throw fail('dependency_unavailable','The resource daily-availability record is missing or ambiguous.');return value.items[0] as Availability;}
  async updateAvailability(p: Principal,id:number,changes: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){await this.request(p,'ResourceDailyAvailabilities.update',`Resources/${p.resourceId}/DailyAvailabilities`,'PATCH',{id,...changes},true,beforeDispatch);return {id};}
  async searchTimeOffApprovers(p:Principal,input:{approverId?:number;resourceId?:number;pageSize:number;cursor?:string}){
    assertCapability(p,'time.approve');
    if(input.approverId!==undefined&&input.approverId!==p.resourceId)throw new AppError('forbidden','Only the current approver can be selected.');
    if(input.approverId===undefined&&input.resourceId===undefined)throw new AppError('invalid_input','An approver or resource filter is required.');
    const filter:unknown[]=[];
    if(input.approverId)filter.push({field:'approverResourceID',op:'eq',value:input.approverId});
    if(input.resourceId)filter.push({field:'resourceID',op:'eq',value:input.resourceId});
    const continuation=Boolean(input.cursor),root='ResourceTimeOffApprovers/query';
    const route=continuation?this.openCursor(p,'ResourceTimeOffApprovers.query',root,filter,input.pageSize,input.cursor!):root;
    const value=await this.request(p,'ResourceTimeOffApprovers.query',route,continuation?'GET':'POST',continuation?undefined:{MaxRecords:input.pageSize,filter});
    if(!obj(value)||!Array.isArray(value.items)||!obj(value.pageDetails))throw fail();
    const rawNext=typeof value.pageDetails.nextPageUrl==='string'?value.pageDetails.nextPageUrl:null;
    const next=rawNext?this.sealCursor(p,'ResourceTimeOffApprovers.query',root,filter,input.pageSize,this.continuation(rawNext,root)):null;
    return {items:value.items as TimeOffApprover[],nextCursor:next,complete:!next,fetchedAt:new Date(this.now()).toISOString()};
  }
  async approveTimeOff(p:Principal,id:number,beforeDispatch?:()=>Promise<void>){
    await this.request(p,'TimeOffRequestsApprove.create',`TimeOffRequests/${id}/Approve`,'GET',undefined,true,beforeDispatch);
    return {id};
  }
  async rejectTimeOff(p:Principal,id:number,reason:string,beforeDispatch?:()=>Promise<void>){
    await this.request(p,'TimeOffRequestsReject.create',`TimeOffRequests/${id}/Reject`,'POST',{reason},true,beforeDispatch);
    return {id};
  }
  async searchTimeOff(p: Principal,input: {resourceId:number;from?:string;to?:string;pageSize:number;cursor?:string}){if(input.resourceId!==p.resourceId)assertCapability(p,'time.approve');const filter: unknown[]=[{field:'resourceID',op:'eq',value:input.resourceId}];if(input.from)filter.push({field:'requestDate',op:'gte',value:`${input.from}T00:00:00Z`});if(input.to)filter.push({field:'requestDate',op:'lte',value:`${input.to}T23:59:59.999Z`});const continuation=Boolean(input.cursor), route=continuation?this.openCursor(p,'TimeOffRequests.query','TimeOffRequests/query',filter,input.pageSize,input.cursor!):'TimeOffRequests/query',value=await this.request(p,'TimeOffRequests.query',route,continuation?'GET':'POST',continuation?undefined:{MaxRecords:input.pageSize,filter},false,undefined,input.resourceId!==p.resourceId);if(!obj(value)||!Array.isArray(value.items)||!obj(value.pageDetails))throw fail();const rawNext=typeof value.pageDetails.nextPageUrl==='string'?value.pageDetails.nextPageUrl:null;const next=rawNext?this.sealCursor(p,'TimeOffRequests.query','TimeOffRequests/query',filter,input.pageSize,this.continuation(rawNext,'TimeOffRequests/query')):null;return {items:value.items as TimeOffRequest[],nextCursor:next,complete:!next,fetchedAt:new Date(this.now()).toISOString()};}
  async createTimeOff(p: Principal,payload: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){return this.created(await this.request(p,'TimeOffRequests.create',`Resources/${p.resourceId}/TimeOffRequests`,'POST',payload,true,beforeDispatch));}
  async updateTimeOff(p: Principal,id:number,changes: Record<string,unknown>,beforeDispatch?:()=>Promise<void>){await this.request(p,'TimeOffRequests.update',`Resources/${p.resourceId}/TimeOffRequests`,'PATCH',{id,...changes},true,beforeDispatch);return {id};}
  async getTimeOff(p: Principal,id:number){const row=this.item<TimeOffRequest>(await this.request(p,'TimeOffRequests.get',`TimeOffRequests/${id}`,'GET'),id);if(row.resourceID!==p.resourceId){const fresh=await this.guard(p,'TimeOffRequests.get');assertCapability(fresh,'time.approve');}return row;}
}

export function workManagementOptions(options: HttpWorkManagementOptions): WorkManagementOptions { return { validateTime: options.validateTimeEligibility, validateExpense: options.validateExpensePolicy, validateTimeOff: options.validateTimeOffRequest, resolveExpenseStatuses: options.resolveExpenseStatuses, resolveTimeOffStatuses: options.resolveTimeOffStatuses }; }
