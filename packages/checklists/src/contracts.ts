import type { DataRecord, Principal } from '../../contracts/src/index.js';

export interface ChecklistItem extends DataRecord {
  ticketID: number;
  itemName: string;
  isCompleted: boolean;
  isImportant: boolean;
  position?: number;
  knowledgebaseArticleID?: number | null;
  completedByResourceID?: number | null;
  completedDateTime?: string | null;
}

export interface ChecklistField { name: string; dataType: string; isReadOnly?: boolean; isRequired?: boolean }
export interface ChecklistPage { items: ChecklistItem[]; complete: boolean; fetchedAt: string }
export interface ChecklistPort {
  readonly source: 'fixture' | 'Autotask';
  fields(principal: Principal, ticketId: number): Promise<ChecklistField[]>;
  list(principal: Principal, ticketId: number): Promise<ChecklistPage>;
  get(principal: Principal, ticketId: number, itemId: number): Promise<ChecklistItem>;
  create(principal: Principal, ticketId: number, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  update(principal: Principal, ticketId: number, itemId: number, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  delete(principal: Principal, ticketId: number, itemId: number, beforeDispatch?: () => Promise<void>): Promise<void>;
}
