import { assertArea } from '../../policy/src/areas.js';
import { AppError, positiveId, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, reauthorize } from '../../policy/src/index.js';
import type { OpportunityAttachment, OpportunityAttachmentCreate, OpportunityAttachmentPort } from './opportunity-contracts.js';

export class FixtureOpportunityAttachmentPort implements OpportunityAttachmentPort {
  readonly source = 'fixture' as const;
  readonly records: OpportunityAttachment[];
  readonly calls: { method: string; opportunityId: number; attachmentId?: number }[] = [];
  constructor(private readonly principals: PrincipalStore, records: OpportunityAttachment[] = []) { this.records = structuredClone(records); }
  private async actor(p: Principal, write = false) { const fresh = await reauthorize(p, this.principals); assertCapability(fresh, 'operational.read');assertCapability(fresh,'finance.read');assertArea(fresh,'sales',write); if (write) assertCapability(fresh, 'sales.write'); return fresh; }
  async list(p: Principal, opportunityId: number) { p = await this.actor(p); const rows = this.records.filter(row => row.opportunityID === opportunityId); this.calls.push({ method: 'query', opportunityId }); return { items: structuredClone(rows), complete: true, fetchedAt: new Date().toISOString() }; }
  async get(p: Principal, opportunityId: number, attachmentId: number) { p = await this.actor(p); const row = this.records.find(value => value.id === attachmentId && value.opportunityID === opportunityId); if (!row) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); this.calls.push({ method: 'get', opportunityId, attachmentId }); return structuredClone(row); }
  async create(p: Principal, opportunityId: number, payload: OpportunityAttachmentCreate, beforeDispatch: () => Promise<void>) { p = await this.actor(p, true); await beforeDispatch(); const id = Math.max(8000, ...this.records.map(row => row.id)) + 1; this.records.push({ id, opportunityID: opportunityId, fileSize: Buffer.from(payload.data, 'base64').length, ...structuredClone(payload) }); this.calls.push({ method: 'create', opportunityId, attachmentId: id }); return { id }; }
  async delete(p: Principal, opportunityId: number, attachmentId: number, beforeDispatch: () => Promise<void>) { p = await this.actor(p, true); const index = this.records.findIndex(row => row.id === attachmentId && row.opportunityID === opportunityId); if (index < 0) throw new AppError('not_found_or_inaccessible', 'Attachment not found or inaccessible.'); await beforeDispatch(); this.records.splice(index, 1); this.calls.push({ method: 'delete', opportunityId, attachmentId }); }
}
