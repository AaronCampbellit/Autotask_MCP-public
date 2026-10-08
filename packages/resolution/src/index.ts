import {assertAlignment,numberRange,preferredRole,classificationOverrideSchema} from '../../classification/src/index.js';
import { validTimeInterval } from './time-interval.js';
import { z } from 'zod';
import {
  AppError, positiveId,
  type NoteAudience, type Principal, type TicketNoteCreate, type TicketTimeCreate,
  type TicketWorkMetadata, type WriteOption,
} from '../../contracts/src/index.js';

const nonblank = (limit: number) => z.string().max(limit).refine(value => value.trim().length > 0);
const labelSchema = nonblank(100);
const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimezone(value: string): boolean {
  // Explicit region/zone names and UTC avoid ambiguous abbreviations or offsets.
  if (value !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_.+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch { return false; }
}

export const noteInputSchema = z.object({
  text: nonblank(32_000),
  audience: z.enum(['internal', 'customer']),
  title: nonblank(250).optional(),
  note_type: labelSchema.optional(),
}).strict();

export const timeInputSchema = z.object({
  classification_override:classificationOverrideSchema.optional(),
  work_date: z.string().refine(validCalendarDate),
  timezone: z.string().max(100).refine(validTimezone),
  minutes: z.number().int().min(1).max(1440),
  start_datetime: z.string().datetime({ offset: true }).optional(),
  end_datetime: z.string().datetime({ offset: true }).optional(),
  timing_source: z.enum(['user','calendar','chat','current_time']).optional(),
  summary: nonblank(32_000),
  internal_notes: z.string().max(32_000).optional(),
  role: labelSchema.optional(),
  work_type: labelSchema.optional(),
}).strict();

export type NoteInput = z.infer<typeof noteInputSchema>;
export type TimeInput = z.infer<typeof timeInputSchema>;
export interface SelectedDefault {
  field: 'note_type' | 'role' | 'work_type';
  source: 'explicit' | 'reviewed_default';
  rule_version: string;
  id: number;
  label: string;
}
export interface ResolvedNote {
  payload: TicketNoteCreate;
  defaults: SelectedDefault[];
  audience: NoteAudience;
}
export interface ResolvedTime {
  payload: TicketTimeCreate;
  defaults: SelectedDefault[];
  workDate: string;
  timezone: string;
  minutes: number;
  timingBasis?: 'start_plus_duration' | 'end_minus_duration' | 'explicit_interval';
  timingSource?: 'user' | 'calendar' | 'chat' | 'current_time';
}

const optionSchema = z.object({ id: safeId, label: labelSchema, active: z.boolean() }).strict();
const metadataSchema = z.object({
  version: nonblank(200),
  source: z.enum(['fixture', 'Autotask']),
  ticketId: safeId,
  resourceId: safeId,
  mappingVersion: safeId,
  policyVersion: nonblank(200),
  validUntil: z.string().datetime({ offset: true }),
  note: z.object({
    titleRequired: z.boolean(),
    attributionField: z.enum(['creatorResourceID', 'impersonatorCreatorResourceID']),
    types: z.array(optionSchema).max(1000),
    audiences: z.array(z.object({
      audience: z.enum(['internal', 'customer']),
      publish: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      label: labelSchema,
      active: z.boolean(),
    }).strict()).max(20),
    defaultTypeId: safeId.optional(),
  }).strict(),
  time: z.object({
    eligible: z.boolean(),
    roles: z.array(optionSchema).max(1000),
    workTypes: z.array(optionSchema).max(1000),
    defaultRoleId: safeId.optional(),
    defaultWorkTypeId: safeId.optional(),
    classification:z.object({category:z.string().optional(),queue:z.string().optional()}).strict().optional(),
  }).strict(),
  defaultRuleVersion: nonblank(200),
}).strict();

function checkedMetadata(value: unknown, now: number): TicketWorkMetadata {
  const result = metadataSchema.safeParse(value);
  if (!result.success || !Number.isFinite(now)) {
    throw new AppError('missing_metadata', 'The reviewed ticket work metadata is missing or invalid.');
  }
  if (Date.parse(result.data.validUntil) <= now) {
    throw new AppError('precondition_failed', 'The reviewed ticket work metadata has expired. Retrieve current metadata before continuing.');
  }
  return result.data;
}

/** Validates server-owned metadata against the actual operation and actor mapping. */
export function assertWorkMetadata(
  metadata: unknown, principal: Principal, ticketId: number,
  expectedSource: 'fixture' | 'Autotask', now = Date.now(),
): asserts metadata is TicketWorkMetadata {
  const checked = checkedMetadata(metadata, now);
  if (!principal || principal.active !== true || !positiveId(principal.resourceId)
      || !positiveId(principal.mappingVersion) || typeof principal.policyVersion !== 'string'
      || !principal.policyVersion.trim()) {
    throw new AppError('identity_mapping_invalid', 'An active employee mapping is required to resolve ticket work.');
  }
  if (!positiveId(ticketId) || checked.ticketId !== ticketId || checked.source !== expectedSource
      || checked.resourceId !== principal.resourceId || checked.mappingVersion !== principal.mappingVersion
      || checked.policyVersion !== principal.policyVersion) {
    throw new AppError('precondition_failed', 'The reviewed ticket work metadata no longer matches this ticket, employee mapping or source.');
  }
}

const normalizeLabel = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const fieldDescription = { note_type: 'note type', role: 'role', work_type: 'work type' } as const;

function selectOption(
  field: SelectedDefault['field'], explicit: string | undefined,
  options: WriteOption[], defaultId: number | undefined, ruleVersion: string,
): { option: WriteOption; selected: SelectedDefault } {
  let option: WriteOption;
  if (explicit !== undefined) {
    const matches = options.filter(candidate => candidate.active
      && normalizeLabel(candidate.label) === normalizeLabel(explicit));
    if (matches.length === 0) {
      throw new AppError('invalid_input', `The requested ${fieldDescription[field]} is unavailable or inactive.`);
    }
    if (matches.length !== 1) {
      throw new AppError('missing_metadata', `The ${fieldDescription[field]} label is ambiguous in the reviewed metadata.`);
    }
    option = matches[0]!;
    if (options.filter(candidate => candidate.id === option.id).length !== 1) {
      throw new AppError('missing_metadata', `The reviewed ${fieldDescription[field]} identity is ambiguous.`);
    }
  } else {
    if (defaultId === undefined) {
      throw new AppError('missing_metadata', `An explicit ${fieldDescription[field]} is required because no reviewed default is available.`);
    }
    const matches = options.filter(candidate => candidate.id === defaultId);
    if (matches.length !== 1 || matches[0]!.active !== true) {
      throw new AppError('missing_metadata', `The reviewed ${fieldDescription[field]} default is missing, ambiguous or inactive.`);
    }
    option = matches[0]!;
  }
  return {
    option,
    selected: { field, source: explicit === undefined ? 'reviewed_default' : 'explicit',
      rule_version: ruleVersion, id: option.id, label: option.label },
  };
}

/** Resolve only caller-supplied text/audience and eligible reviewed metadata. */
export function resolveNote(input: unknown, metadata: TicketWorkMetadata): ResolvedNote {
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('invalid_input', 'Provide nonblank note text, an explicit audience and only supported note fields.');
  }
  const args = parsed.data;
  const current = checkedMetadata(metadata, Date.now());
  if (current.note.titleRequired && args.title === undefined) {
    throw new AppError('invalid_input', 'A note title is required for this ticket.');
  }
  const audiences = current.note.audiences.filter(candidate => candidate.audience === args.audience && candidate.active);
  if (audiences.length !== 1) {
    throw new AppError('missing_metadata', 'The requested note audience has no unique active reviewed publication value.');
  }
  // One publication value cannot represent two different intended audiences.
  if (current.note.audiences.some(candidate => candidate.active && candidate.audience !== args.audience
      && candidate.publish === audiences[0]!.publish)) {
    throw new AppError('missing_metadata', 'The reviewed note audience publication values are ambiguous.');
  }
  const { option, selected } = selectOption('note_type', args.note_type,
    current.note.types, current.note.defaultTypeId, current.defaultRuleVersion);
  return {
    payload: { description: args.text, noteType: option.id, publish: audiences[0]!.publish,
      ...(args.title !== undefined ? { title: args.title } : {}) },
    defaults: [selected], audience: args.audience,
  };
}

/** Minutes/date are explicit work facts; no start/end timestamp or finance override is invented. */
export function resolveTime(input: unknown, metadata: TicketWorkMetadata): ResolvedTime {
  const parsed = timeInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('invalid_input', 'Provide a valid calendar work date, explicit IANA timezone, whole minutes, summary and only supported time fields.');
  }
  const args = parsed.data;
  let start = args.start_datetime === undefined ? undefined : new Date(args.start_datetime).toISOString();
  let end = args.end_datetime === undefined ? undefined : new Date(args.end_datetime).toISOString();
  const timingBasis = start !== undefined && end !== undefined ? 'explicit_interval' : start !== undefined ? 'start_plus_duration' : end !== undefined ? 'end_minus_duration' : undefined;
  if (start !== undefined && end === undefined) end = new Date(Date.parse(start) + args.minutes * 60000).toISOString();
  else if (end !== undefined && start === undefined) start = new Date(Date.parse(end) - args.minutes * 60000).toISOString();
  if (args.timing_source !== undefined && timingBasis === undefined) throw new AppError('invalid_input', 'A timing source requires a start or end timestamp. Use time_entry_clock for the current-time fallback.');
  if (!validTimeInterval(start, end, args.minutes / 60)) throw new AppError('invalid_input', 'Provide both actual start/end timestamps; elapsed time must equal the supplied minutes.');
  if (start !== undefined) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: args.timezone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(start));
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    if (`${part('year')}-${part('month')}-${part('day')}` !== args.work_date) throw new AppError('invalid_input', 'The start time must fall on work_date in the supplied timezone.');
  }
  const current = checkedMetadata(metadata, Date.now());
  if (!current.time.eligible) {
    throw new AppError('precondition_failed', 'Time recording is not eligible for this ticket and employee.');
  }
  const workType = selectOption('work_type', args.work_type,
    current.time.workTypes, current.time.defaultWorkTypeId, current.defaultRuleVersion);
  if(current.time.classification)assertAlignment({...current.time.classification,work_type:workType.option.label},args.classification_override);
  const preferred=preferredRole(current.time.roles.map(v=>({...v,isDefault:v.id===current.time.defaultRoleId})),numberRange(workType.option.label));
  const role = selectOption('role', args.role, current.time.roles, numberRange(workType.option.label)===undefined?current.time.defaultRoleId:preferred?.id, current.defaultRuleVersion);
  return {
    payload: {
      resourceID: current.resourceId, roleID: role.option.id, billingCodeID: workType.option.id,
      hoursWorked: args.minutes / 60,
      // The captured TimeEntries reference says dateWorked is set to midnight on
      // create/update. This is a date container, not a claimed work start time.
      dateWorked: `${args.work_date}T00:00:00Z`, summaryNotes: args.summary,
      ...(start === undefined ? {} : { startDateTime: start, endDateTime: end! }),
      ...(args.internal_notes !== undefined ? { internalNotes: args.internal_notes } : {}),
    },
    defaults: [role.selected, workType.selected],
    workDate: args.work_date, timezone: args.timezone, minutes: args.minutes,
    ...(timingBasis ? { timingBasis, timingSource: args.timing_source ?? 'user' } : {}),
  };
}
