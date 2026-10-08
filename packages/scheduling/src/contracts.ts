import { z } from 'zod';
import { AppError, type DataRecord, type Principal } from '../../contracts/src/index.js';
import { ticketReferenceSchema } from '../../workflows/src/index.js';

export const positiveIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const resourceReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }).strict(),
  z.object({ kind: z.literal('id'), id: positiveIdSchema, name:z.string().trim().min(1).max(100).optional().describe('Intended full employee name; required for numeric resources when creating a service call.') }).strict(),
  z.object({ kind: z.literal('name'), name: z.string().trim().min(1).max(100) }).strict(),
]);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/);
const timezone = z.string().max(100).refine((value) => {
  if (value !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_.+-]+)+$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
});
const intervalFields = { start: timestamp, end: timestamp, timezone };
export const scheduleSearchSchema = z.object({
  ...intervalFields, ticket: ticketReferenceSchema.optional(),
  resources: z.array(resourceReferenceSchema).min(1).max(10).default([{ kind: 'self' }]),
  page_size: z.number().int().min(1).max(100).default(50), cursor: z.string().max(2048).optional(),
}).strict();
export const serviceCallCreateSchema = z.object({
  ...intervalFields, ticket: ticketReferenceSchema,
  resources: z.array(resourceReferenceSchema).min(1).max(10),
  description: z.string().max(2000).optional(), status: z.string().trim().min(1).max(100).optional(),
  overlap: z.enum(['reject', 'allow']).default('reject'),
  request_key: z.string().min(8).max(128).refine((value) => !value.startsWith('sch:') && !value.startsWith('wf:')),
}).strict();
export const serviceCallUpdateSchema = z.object({
  id: positiveIdSchema,
  start: timestamp.optional(), end: timestamp.optional(), timezone: timezone.optional(),
  description: z.string().max(2000).optional(), status: z.number().int().positive().or(z.string().trim().min(1).max(100)).optional(),
  expected: z.object({ start: timestamp.optional(), end: timestamp.optional(), description: z.string().max(2000).optional(), status: z.number().int().positive().optional() }).strict(),
  overlap: z.enum(['reject', 'allow']).default('reject'),
  request_key: z.string().min(8).max(128).refine((value) => !value.startsWith('sch:') && !value.startsWith('wf:')),
}).strict().refine((value) => value.start !== undefined || value.end !== undefined || value.description !== undefined || value.status !== undefined, { message: 'Supply at least one service-call change.' }).refine((value) => (value.start === undefined) === (value.end === undefined), { message: 'Start and end must be supplied together.' });
export const serviceCallCancelSchema = z.object({
  id: positiveIdSchema, expected_status: z.number().int().positive(), cancel_status: z.number().int().positive(), request_key: z.string().min(8).max(128).refine((value) => !value.startsWith('sch:') && !value.startsWith('wf:')),
}).strict();
export const schedulingResumeSchema = z.object({ operation_id: z.string().uuid() }).strict();
export type ResourceReference = z.infer<typeof resourceReferenceSchema>;
export interface SchedulingResource { id: number; label: string; active: boolean; companyIds: number[] }
export interface SchedulingMetadata {
  version: string; source: 'fixture' | 'Autotask'; ticketId: number; companyId: number;
  tenantId: string; resourceId: number; mappingVersion: number; policyVersion: string; validUntil: string;
  ticketResourceIds: number[];
  statuses: { id: number; label: string; active: boolean; bookable: boolean }[];
  defaultStatusId?: number; allowOverlap: boolean;
  attributionField: 'creatorResourceID' | 'impersonatorCreatorResourceID';
}
export interface SchedulingInterval { start: string; end: string; timezone: string }
export interface ServiceCallCreatePayload { companyID: number; startDateTime: string; endDateTime: string; status: number; description?: string }
export interface ServiceCallUpdatePayload { id: number; startDateTime?: string; endDateTime?: string; status?: number; description?: string; expected: { startDateTime?: string; endDateTime?: string; status?: number; description?: string } }
export interface ServiceCallRecord extends DataRecord { companyID: number; startDateTime: string; endDateTime: string; status: number }
export interface ServiceCallTicketRecord extends DataRecord { serviceCallID: number; ticketID: number }
export interface ServiceCallResourceRecord extends DataRecord { serviceCallTicketID: number; resourceID: number }
export interface ScheduleItem { id: number; company_id: number; start: string; end: string; status: number; complete: boolean; ticket_ids: number[]; resource_ids: number[]; description?: string }
export interface ScheduleQuery { start: string; end: string; resourceIds: number[]; ticketId?: number }
export interface SchedulePage { items: ScheduleItem[]; complete: boolean; fetchedAt: string; warnings: string[] }
/** Fixed service-call operations; no arbitrary route, body or actor from clients. */
export interface SchedulingPort {
  readonly source: 'fixture' | 'Autotask';
  resources(principal: Principal): Promise<SchedulingResource[]>;
  metadata(principal: Principal, ticketId: number): Promise<SchedulingMetadata>;
  search(principal: Principal, query: ScheduleQuery): Promise<SchedulePage>;
  createCall(principal: Principal, ticketId: number, payload: ServiceCallCreatePayload): Promise<{ id: number }>;
  updateCall?(principal: Principal, id: number, payload: ServiceCallUpdatePayload): Promise<{ id: number }>;
  cancelCall?(principal: Principal, id: number, expectedStatus: number, cancelStatus: number): Promise<{ id: number }>;
  getCall(principal: Principal, id: number): Promise<ServiceCallRecord>;
  createTicket(principal: Principal, callId: number, ticketId: number): Promise<{ id: number }>;
  getTicket(principal: Principal, callId: number, id: number): Promise<ServiceCallTicketRecord>;
  createResource(principal: Principal, callTicketId: number, resourceId: number): Promise<{ id: number }>;
  getResource(principal: Principal, callTicketId: number, id: number): Promise<ServiceCallResourceRecord>;
}

export function interval(input: SchedulingInterval, maximumDays = 31): SchedulingInterval {
  const parsed = z.object(intervalFields).strict().parse(input);
  const normalize = (value: string): string => {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new AppError('invalid_input', 'Provide valid calendar timestamps with explicit UTC offsets.');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: parsed.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map((part) => [part.type, part.value]));
    const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    if (local !== value.slice(0, 19)) throw new AppError('invalid_input', 'The timestamp offset does not match this timezone and local date. Supply a valid explicit offset; daylight-saving gaps are not inferred.');
    return instant.toISOString();
  };
  const start = normalize(parsed.start), end = normalize(parsed.end), duration = Date.parse(end) - Date.parse(start);
  if (duration <= 0 || duration > maximumDays * 86_400_000) throw new AppError('invalid_input', `The end must follow the start within ${maximumDays} days.`);
  return { start, end, timezone: parsed.timezone };
}

const resourceSchema = z.object({ id: positiveIdSchema, label: z.string().trim().min(1).max(100), active: z.boolean(), companyIds: z.array(z.number().int().nonnegative().safe()).max(100) }).strict();
const metadataSchema = z.object({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/), source: z.enum(['fixture', 'Autotask']),
  ticketId: positiveIdSchema, companyId: z.number().int().nonnegative().safe(), tenantId: z.string().min(1), resourceId: positiveIdSchema,
  mappingVersion: positiveIdSchema, policyVersion: z.string().min(1), validUntil: z.string().datetime({ offset: true }),
  ticketResourceIds: z.array(positiveIdSchema).max(1000),
  statuses: z.array(z.object({ id: positiveIdSchema, label: z.string().trim().min(1).max(100), active: z.boolean(), bookable: z.boolean() }).strict()).max(1000),
  defaultStatusId: positiveIdSchema.optional(), allowOverlap: z.boolean(), attributionField: z.enum(['creatorResourceID', 'impersonatorCreatorResourceID']),
}).strict();
export function reviewedResources(value: unknown, p: Principal): SchedulingResource[] {
  const parsed = z.array(resourceSchema).max(1000).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map((row) => row.id)).size !== parsed.data.length) throw new AppError('missing_metadata', 'The scoped scheduling resource directory is unavailable.');
  return parsed.data.filter((row) => row.companyIds.some((id) => p.companyIds.includes(id)));
}
export function reviewedMetadata(value: unknown, p: Principal, ticketId: number, companyId: number, source: SchedulingPort['source'], now = Date.now()): SchedulingMetadata {
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) throw new AppError('missing_metadata', 'Reviewed service-call metadata is unavailable.');
  const data = parsed.data;
  if (data.source !== source || data.ticketId !== ticketId || data.companyId !== companyId || data.tenantId !== p.tenantId || data.resourceId !== p.resourceId || data.mappingVersion !== p.mappingVersion || data.policyVersion !== p.policyVersion || Date.parse(data.validUntil) <= now || new Set(data.statuses.map((row) => row.id)).size !== data.statuses.length) throw new AppError('missing_metadata', 'Service-call metadata is expired or belongs to another identity or ticket.');
  return data;
}
export function resolveResources(refs: ResourceReference[], resources: SchedulingResource[], p: Principal, eligibleIds?: number[]): SchedulingResource[] {
  const selected = refs.map((ref) => {
    const candidates = resources.filter((row) => ref.kind === 'self' ? row.id === p.resourceId : ref.kind === 'id' ? row.id === ref.id : row.label.trim().toLocaleLowerCase('en-US') === ref.name.trim().toLocaleLowerCase('en-US'));
    if (candidates.length !== 1) throw new AppError(candidates.length ? 'conflict' : 'not_found_or_inaccessible', candidates.length ? 'The resource name is ambiguous within your scope. Supply an eligible resource ID.' : 'The resource was not found or is inaccessible.');
    const resource = candidates[0]!;
    if (eligibleIds && (!resource.active || !eligibleIds.includes(resource.id))) throw new AppError('precondition_failed', 'Every scheduled resource must be active and already a primary or secondary resource on this ticket.');
    return resource;
  });
  if (new Set(selected.map((row) => row.id)).size !== selected.length) throw new AppError('invalid_input', 'List each requested scheduling resource once.');
  return selected;
}
export const sameInstant = (a: unknown, b: string): boolean => typeof a === 'string' && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
export const schedulingWarning = 'Overlap checks cover the authorized schedule scope and are not an atomic reservation against concurrent changes.';
