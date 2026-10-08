import { z } from 'zod';
import type { Principal } from '../../contracts/src/index.js';
import type { ChecklistService } from './index.js';
import * as c from './index.js';

export interface ChecklistTool { name: string; schema: z.ZodObject<any>; description: string; write: boolean; destructive?: boolean; capabilities: readonly string[]; run: (principal: Principal, input: unknown) => Promise<unknown> }
export function checklistTools(service: ChecklistService): ChecklistTool[] { return [
  { name: 'checklist_search', schema: c.checklistSearchSchema, description: 'Read the bounded checklist for an authorized ticket. TicketChecklistItems has at most 40 items.', write: false, capabilities: ['operational.read'], run: (p, a) => service.search(p, a) },
  { name: 'checklist_get', schema: c.checklistGetSchema, description: 'Read one checklist item after authorized ticket-parent checks.', write: false, capabilities: ['operational.read'], run: (p, a) => service.get(p, a) },
  { name: 'checklist_options', schema: c.checklistOptionsSchema, description: 'Read current TicketChecklistItems field metadata and the documented 40-item limit.', write: false, capabilities: ['operational.read'], run: (p, a) => service.options(p, a) },
  { name: 'checklist_item_create', schema: c.checklistCreateSchema, description: 'Add one explicitly supplied checklist item to an authorized ticket with a durable receipt.', write: true, capabilities: ['operational.read', 'tickets.write'], run: (p, a) => service.create(p, a) },
  { name: 'checklist_item_update', schema: c.checklistUpdateSchema, description: 'Update explicitly supplied checklist fields after expected-value checks. Ticket parent cannot change.', write: true, destructive: true, capabilities: ['operational.read', 'tickets.write'], run: (p, a) => service.update(p, a) },
  { name: 'checklist_item_delete', schema: c.checklistDeleteSchema, description: 'Delete one checklist item after expected-value checks; absence is independently reconciled before verification.', write: true, destructive: true, capabilities: ['operational.read', 'tickets.write'], run: (p, a) => service.delete(p, a) },
  { name: 'checklist_operation_status', schema: c.checklistOperationStatusSchema, description: 'Recover an unverified checklist mutation receipt without replaying the write.', write: false, capabilities: ['operational.read'], run: (p, a) => service.operationStatus(p, a) },
] }
export const checklistOperations: Record<string, { write: boolean; capabilities: string[] }> = Object.freeze({
  checklist_search: { write: false, capabilities: ['operational.read'] }, checklist_get: { write: false, capabilities: ['operational.read'] }, checklist_options: { write: false, capabilities: ['operational.read'] },
  checklist_item_create: { write: true, capabilities: ['operational.read', 'tickets.write'] }, checklist_item_update: { write: true, capabilities: ['operational.read', 'tickets.write'] }, checklist_item_delete: { write: true, capabilities: ['operational.read', 'tickets.write'] }, checklist_operation_status: { write: false, capabilities: ['operational.read'] },
});
export const CHECKLIST_OPERATIONS = Object.freeze(Object.keys(checklistOperations));
