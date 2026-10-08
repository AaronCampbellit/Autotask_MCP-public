import { z } from 'zod';
import type { DataRecord, Principal } from '../../contracts/src/index.js';

export const idSchema = z.number().int().positive().safe();
export const requestKeySchema = z.string().trim().min(8).max(128).refine(v => !/^(wf:|sch:|job:)/.test(v), 'This request-key prefix is reserved.');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year!, month! - 1, day!)); return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day; }, 'Invalid calendar date.');
export const instantSchema = z.string().datetime({ offset: true });
const timezoneSchema = z.string().trim().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; } }, 'Invalid IANA timezone.');
const expectedTime = z.object({ hoursWorked: z.number().positive().max(24).optional(), dateWorked: z.string().datetime().optional(), summaryNotes: z.string().max(32000).optional(), internalNotes: z.string().max(32000).nullable().optional(), startDateTime: instantSchema.nullable().optional(), endDateTime: instantSchema.nullable().optional() }).strict();

const timeCommon = z.object({
  resource: z.literal('self').default('self'),
  role_id: idSchema,
  billing_code_id: idSchema,
  work_date: dateSchema,
  timezone: timezoneSchema,
  minutes: z.number().positive().max(1440).optional(),
  start: instantSchema.optional(), end: instantSchema.optional(),
  summary: z.string().trim().min(1).max(32000), internal_notes: z.string().max(32000).optional(),
  is_non_billable: z.boolean().optional(), show_on_invoice: z.boolean().optional(), request_key: requestKeySchema,
}).strict().refine(v => (v.minutes !== undefined) !== (v.start !== undefined || v.end !== undefined), { message: 'Supply minutes or both explicit start and end; duration is never inferred.' }).refine(v => (v.start === undefined) === (v.end === undefined), { message: 'Start and end must be supplied together.' }).refine(v => v.start === undefined || Date.parse(v.start!) < Date.parse(v.end!), { message: 'End must follow start.' });

export const timeLogTicketSchema = timeCommon.extend({ ticket_id: idSchema }).strict();
export const timeLogTaskSchema = timeCommon.extend({ task_id: idSchema }).strict();
export const timeLogInternalSchema = z.object({ resource: z.literal('self').default('self'), internal_billing_code_id: idSchema, work_date: dateSchema, timezone: timezoneSchema, minutes: z.number().positive().max(1440).optional(), start: instantSchema.optional(), end: instantSchema.optional(), summary: z.string().trim().min(1).max(32000), internal_notes: z.string().max(32000).optional(), request_key: requestKeySchema }).strict().refine(v => (v.minutes !== undefined) !== (v.start !== undefined || v.end !== undefined), { message: 'Supply minutes or both explicit start and end; duration is never inferred.' }).refine(v => (v.start === undefined) === (v.end === undefined), { message: 'Start and end must be supplied together.' }).refine(v => v.start === undefined || Date.parse(v.start!) < Date.parse(v.end!), { message: 'End must follow start.' });
export const timeGetSchema = z.object({id:idSchema}).strict();
export const timeCorrectSchema = z.object({ id: idSchema, changes: z.object({ hoursWorked: z.number().positive().max(24).optional(), dateWorked: z.string().datetime().optional(), summaryNotes: z.string().trim().min(1).max(32000).optional(), internalNotes: z.string().max(32000).nullable().optional(), startDateTime: instantSchema.nullable().optional(), endDateTime: instantSchema.nullable().optional() }).strict().refine(v => Object.keys(v).length > 0), expected: expectedTime, request_key: requestKeySchema }).strict().refine(v => Object.keys(v.changes).every(key => Object.hasOwn(v.expected, key)), { message: 'Expected values are required for every changed time field.' });
export const timeDeleteSchema = z.object({ id: idSchema, expected: expectedTime.refine(v => Object.keys(v).length > 0, 'At least one expected time field is required.'), request_key: requestKeySchema }).strict();
export const timeSearchSchema = z.object({ scope: z.enum(['ticket', 'task', 'internal']), parent_id: idSchema.optional(), resource: z.enum(['self', 'team']).default('self'), from: dateSchema.optional(), to: dateSchema.optional(), page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(16000).optional() }).strict().refine(v => v.scope === 'internal' ? v.parent_id === undefined : idSchema.safeParse(v.parent_id).success, { message: 'Ticket and task searches require parent_id; internal searches do not accept one.' });

export const expenseReportCreateSchema = z.object({ week_ending: dateSchema, name: z.string().trim().min(1).max(250), request_key: requestKeySchema }).strict();
export const expenseItemAddSchema = z.object({ report_id: idSchema, expense_date: dateSchema, description: z.string().trim().min(1).max(32000), category_id: idSchema, work_type_id: idSchema, amount: z.number().positive().finite(), currency_id: idSchema, payment_type_id: idSchema, receipt: z.boolean(), ticket_id: idSchema.optional(), task_id: idSchema.optional(), company_id: z.number().int().nonnegative().safe().optional(), billable: z.boolean(), request_key: requestKeySchema }).strict().refine(v => !(v.ticket_id !== undefined && v.task_id !== undefined), { message: 'An expense item belongs to a ticket or task, never both.' });
export const expenseReportSubmitSchema = z.object({ report_id: idSchema, expected_status: z.number().int().positive(), request_key: requestKeySchema }).strict();
export const expenseReportStatusSchema = z.object({ report_id: idSchema }).strict();

export const availabilitySearchSchema = z.object({ resource: z.literal('self').default('self') }).strict();
const availabilityHours = { monday: z.number().min(0).max(24), tuesday: z.number().min(0).max(24), wednesday: z.number().min(0).max(24), thursday: z.number().min(0).max(24), friday: z.number().min(0).max(24), saturday: z.number().min(0).max(24), sunday: z.number().min(0).max(24) } as const;
const availabilityExpectedSchema = z.object({ ...availabilityHours, weekly_billable_goal: z.number().min(0).max(168).optional(), travel_availability: z.string().max(100).nullable().optional() }).strict();
export const availabilityUpdateSchema = z.object({ ...availabilityHours, weekly_billable_goal: z.number().min(0).max(168).optional(), travel_availability: z.string().max(100).optional(), expected: availabilityExpectedSchema, expected_id: idSchema, request_key: requestKeySchema }).strict().refine(v => (v.weekly_billable_goal === undefined || Object.hasOwn(v.expected, 'weekly_billable_goal')) && (v.travel_availability === undefined || Object.hasOwn(v.expected, 'travel_availability')), { message: 'Changed optional availability fields require their expected values.' });
export const timeOffSearchSchema = z.object({ resource: z.literal('self').default('self'), from: dateSchema.optional(), to: dateSchema.optional(), page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(16000).optional() }).strict();
// Autotask time-off requests are for one requestDate and an explicit decimal
// hours value. Its start/end fields are ignored by the documented API, and
// rejectionReason belongs to approver/reject workflows, so neither is sent.
export const timeOffRequestSchema = z.object({ request_date: dateSchema, hours: z.number().positive().max(24), type_id: idSchema, request_key: requestKeySchema }).strict();
export const timeOffCancelSchema = z.object({ id: idSchema, expected_status: idSchema, request_key: requestKeySchema }).strict();
export const operationStatusSchema = z.object({ operation_id: z.string().uuid() }).strict();
export const teamTimeReviewSchema = z.object({ resource_id: idSchema, from: dateSchema, to: dateSchema, page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(16000).optional() }).strict().refine(v => v.from <= v.to, 'The review start date must be on or before the end date.');
export const billingApprovalReviewSchema = z.object({ time_entry_id: idSchema }).strict();
export const billingApprovalRecordSchema = z.object({ time_entry_id: idSchema, expected_previous_level: z.number().int().min(0).max(100), approval_level: z.number().int().min(1).max(100), request_key: requestKeySchema }).strict().refine(v => v.approval_level === v.expected_previous_level + 1, 'The approval level must immediately follow the reviewed prior level.');
export const timeOffApproverResourcesSchema = z.object({ page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(16000).optional() }).strict();
export const timeOffReviewSchema = z.object({ resource_id: idSchema, from: dateSchema.optional(), to: dateSchema.optional(), page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(16000).optional() }).strict().refine(v => !v.from || !v.to || v.from <= v.to, 'The review start date must be on or before the end date.');
const timeOffDecision = z.object({ request_id: idSchema, expected_status: idSchema, expected_last_approved_level: z.number().int().min(0).max(3), request_key: requestKeySchema }).strict();
export const timeOffApproveSchema = timeOffDecision;
export const timeOffRejectSchema = timeOffDecision.extend({ reason: z.string().trim().min(1).max(500) }).strict();

export interface TimeEntry extends DataRecord { resourceID: number; roleID?: number; billingCodeID?: number; internalBillingCodeID?: number; ticketID?: number; taskID?: number; hoursWorked: number; dateWorked: string; summaryNotes: string; internalNotes?: string | null; startDateTime?: string | null; endDateTime?: string | null; billingApprovalDateTime?: string | null; billingApprovalLevelMostRecent?: number | null; billingApprovalResourceID?: number | null; hoursToBill?: number; showOnInvoice?: boolean; isNonBillable?: boolean }
export interface ExpenseReport extends DataRecord { status: number; submitterID: number; weekEnding: string; name: string }
export interface ExpenseItem extends DataRecord { expenseReportID: number; expenseDate: string; expenseCurrencyExpenseAmount: number; expenseCurrencyID: number; expenseCategory: number; workType: number; paymentType: number; haveReceipt: boolean; ticketID?: number; taskID?: number }
export interface Availability extends DataRecord { resourceID: number; mondayAvailableHours: number; tuesdayAvailableHours: number; wednesdayAvailableHours: number; thursdayAvailableHours: number; fridayAvailableHours: number; saturdayAvailableHours: number; sundayAvailableHours: number; weeklyBillableHoursGoal?: number; travelAvailability?: string | null }
export interface TimeOffRequest extends DataRecord { resourceID: number; requestDate: string; startTime: string; endTime: string; hours: number; status: number; timeOffRequestType: number; reason: string; lastApprovedLevel?: number | null; rejectReason?: string | null; approveRejectResourceID?: number | null }
export interface TimeOffApprover extends DataRecord { resourceID: number; approverResourceID: number; approvalLevel: number }
export interface BillingApprovalLevel extends DataRecord { timeEntryID: number; approvalLevel: number; approvalResourceID: number; approvalDateTime: string }

export interface WorkManagementPort {
  readonly source: 'fixture' | 'Autotask';
  searchTime(principal: Principal, input: { scope: 'ticket'|'task'|'internal'|'all'; parentId?: number; resourceId: number; from?: string; to?: string; pageSize: number; cursor?: string }): Promise<{ items: TimeEntry[]; nextCursor: string|null; complete: boolean; fetchedAt: string }>;
  searchBillingApprovals(principal: Principal, timeEntryId: number): Promise<BillingApprovalLevel[]>;
  getBillingApproval(principal: Principal, id: number): Promise<BillingApprovalLevel>;
  createBillingApproval(principal: Principal, payload: { timeEntryID: number; approvalLevel: number; approvalResourceID: number; approvalDateTime: string }, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  getTime(principal: Principal, id: number): Promise<TimeEntry>;
  createTime(principal: Principal, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  updateTime(principal: Principal, id: number, changes: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  deleteTime(principal: Principal, id: number, beforeDispatch?: () => Promise<void>): Promise<void>;
  getTask(principal: Principal, id: number): Promise<DataRecord>;
  getProject(principal: Principal, id: number): Promise<DataRecord>;
  getExpenseReport(principal: Principal, id: number): Promise<ExpenseReport>;
  getExpenseItem(principal: Principal, id: number): Promise<ExpenseItem>;
  createExpenseReport(principal: Principal, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  createExpenseItem(principal: Principal, reportId: number, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  updateExpenseReport(principal: Principal, id: number, changes: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  getAvailability(principal: Principal): Promise<Availability>;
  updateAvailability(principal: Principal, id: number, changes: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  searchTimeOff(principal: Principal, input: { resourceId: number; from?: string; to?: string; pageSize: number; cursor?: string }): Promise<{ items: TimeOffRequest[]; nextCursor: string|null; complete: boolean; fetchedAt: string }>;
  searchTimeOffApprovers(principal: Principal, input: { approverId?: number; resourceId?: number; pageSize: number; cursor?: string }): Promise<{ items: TimeOffApprover[]; nextCursor: string|null; complete: boolean; fetchedAt: string }>;
  approveTimeOff(principal: Principal, id: number, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  rejectTimeOff(principal: Principal, id: number, reason: string, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  createTimeOff(principal: Principal, payload: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  updateTimeOff(principal: Principal, id: number, changes: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ id: number }>;
  getTimeOff(principal: Principal, id: number): Promise<TimeOffRequest>;
}
