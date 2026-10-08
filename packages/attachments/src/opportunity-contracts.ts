import type { Principal, DataRecord } from '../../contracts/src/index.js';

export type OpportunityAttachmentOperation = 'OpportunityAttachments.query' | 'OpportunityAttachments.get' | 'OpportunityAttachments.create' | 'OpportunityAttachments.delete' | 'OpportunityAttachments.fields';
export interface OpportunityAttachment extends DataRecord {
  opportunityID: number;
  title: string;
  contentType?: string;
  fileSize?: number;
  attachmentType?: string;
  parentAttachmentID?: number | null;
  companyNoteID?: number | null;
  timeEntryID?: number | null;
  data?: string;
}
export interface OpportunityAttachmentCreate {
  title: string;
  fullPath: string;
  attachmentType: 'FILE_ATTACHMENT';
  contentType: string;
  publish: number;
  data: string;
}
export interface OpportunityAttachmentPort {
  readonly source: 'fixture' | 'Autotask';
  list(principal: Principal, opportunityId: number): Promise<{ items: OpportunityAttachment[]; complete: boolean; fetchedAt: string }>;
  get(principal: Principal, opportunityId: number, attachmentId: number): Promise<OpportunityAttachment>;
  create(principal: Principal, opportunityId: number, payload: OpportunityAttachmentCreate, beforeDispatch: () => Promise<void>): Promise<{ id: number }>;
  delete(principal: Principal, opportunityId: number, attachmentId: number, beforeDispatch: () => Promise<void>): Promise<void>;
}

