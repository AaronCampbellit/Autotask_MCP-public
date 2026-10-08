import { assertEntityArea, canReadFinance } from './areas.js';
import { AppError, positiveId, validCompanyId, type Capability, type DataRecord, type Entity, type Principal, type PrincipalStore, type QueryRequest } from '../../contracts/src/index.js';
import { loadVerifiedPrincipal, type MappingValidationOptions } from '../../identity/src/index.js';

/** Explicit scalar projections: unknown fields and nested objects never pass through. */
export const operationalFields: Record<Entity, readonly string[]> = {
  Tickets: ['id', 'billingCodeID', 'opportunityID', 'ticketNumber', 'title', 'description', 'companyID', 'contactID', 'companylocationID', 'status', 'priority', 'queueID', 'assignedResourceID', 'assignedResourceRoleID', 'ticketCategory', 'ticketType', 'issueType', 'subIssueType', 'source', 'createDate', 'lastActivityDate', 'lastTrackedModificationDateTime', 'dueDateTime', 'completedDate', 'completedByResourceID', 'estimatedHours', 'resolution'],
  TicketNotes: ['id', 'ticketID', 'title', 'description', 'noteType', 'publish', 'creatorResourceID', 'createdByContactID', 'createDateTime', 'lastActivityDate'],
  TimeEntries: ['id', 'ticketID', 'taskID', 'resourceID', 'roleID', 'dateWorked', 'startDateTime', 'endDateTime', 'hoursWorked', 'summaryNotes', 'internalNotes', 'type', 'isNonBillable', 'lastModifiedDateTime'],
  Companies: ['id', 'companyName', 'companyNumber', 'companyType', 'isActive', 'phone', 'webAddress', 'address1', 'address2', 'city', 'state', 'postalCode', 'countryID', 'createDate', 'lastActivityDate'],
};
export const financialFields: Record<Entity, readonly string[]> = {
  Tickets: ['contractID', 'purchaseOrderNumber', 'estimatedLaborCost', 'estimatedLaborRevenue'],
  TicketNotes: [],
  TimeEntries: ['billingCodeID', 'contractID', 'billingApprovalDateTime', 'billingApprovalLevelMostRecent', 'billingApprovalResourceID', 'hoursToBill', 'offsetHours', 'hourlyBillingRate', 'internalBillingRate', 'invoiceID'],
  Companies: ['taxID', 'taxRegionID', 'currencyID', 'paymentTerm', 'purchaseOrderNumber', 'invoiceMethod', 'invoiceEmailMessageID'],
};
const entities = new Set<string>(Object.keys(operationalFields));
const stringFields = new Set(['ticketNumber', 'title', 'description', 'summaryNotes', 'internalNotes', 'companyName', 'companyNumber', 'phone', 'webAddress', 'address1', 'address2', 'city', 'state', 'postalCode', 'purchaseOrderNumber', 'taxID']);

function assertActive(principal: Principal): void {
  if (principal.active !== true) throw new AppError('forbidden', 'The employee is not active.');
}

export function assertCapability(principal: Principal, capability: Capability): void {
  assertActive(principal);
  if (!principal.capabilities.includes(capability)) throw new AppError('forbidden', 'The requested capability is not assigned.');
}

/** Call after resolving the actual record or parent; do not trust a caller-supplied company association. */
export function assertCompanyScope(principal: Principal, companyId: unknown): void {
  assertActive(principal);
  if (!validCompanyId(companyId) || !principal.companyIds.includes(companyId)) {
    throw new AppError('not_found_or_inaccessible', 'The record was not found or is inaccessible.');
  }
}

function allowedFields(entity: Entity, principal: Principal): Set<string> {
  if (!entities.has(entity)) throw new AppError('unsupported_operation', 'The requested entity is unsupported.');
  assertActive(principal);
  assertEntityArea(principal, entity);
  return new Set([...operationalFields[entity], ...(canReadFinance(principal) ? financialFields[entity] : [])]);
}

export function validateRequestedFields(entity: Entity, fields: unknown, principal: Principal): asserts fields is string[] {
  const allowed = allowedFields(entity, principal);
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > 40 || fields.some(field => typeof field !== 'string')) {
    throw new AppError('invalid_input', 'Fields must be a nonempty list of at most 40 field names.');
  }
  if (fields.some(field => !allowed.has(field))) throw new AppError('forbidden', 'A requested field is not available.');
}

export function projectRecord(entity: Entity, record: DataRecord, principal: Principal, fields?: string[]): DataRecord {
  if (!(entity === 'Companies' ? validCompanyId(record.id) : positiveId(record.id))) throw new AppError('dependency_unavailable', 'The upstream record is invalid.');
  const allowed = allowedFields(entity, principal);
  if (fields !== undefined) validateRequestedFields(entity, fields, principal);
  const selected = fields === undefined ? allowed : new Set(['id', ...fields]);
  const projected: DataRecord = { id: record.id };
  for (const field of selected) {
    if (!allowed.has(field) || !Object.hasOwn(record, field)) continue;
    const value = record[field];
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      projected[field] = value;
    }
  }
  return projected;
}

/** Validate before dispatch to prevent protected-field inference through filtering. */
export function validateQuery(request: QueryRequest & { fields?: string[] }, principal: Principal): void {
  if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['entity', 'filters', 'pageSize', 'cursor', 'parentId', 'fields'].includes(key))) {
    throw new AppError('invalid_input', 'The query contains unsupported options.');
  }
  const allowed = allowedFields(request.entity, principal);
  if (!Array.isArray(request.filters) || request.filters.length > 12 ||
    !Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > (request.entity === 'Tickets' ? 500 : 100) ||
    (request.cursor !== undefined && (typeof request.cursor !== 'string' || request.cursor.length === 0 || request.cursor.length > 4096)) ||
    (request.parentId !== undefined && !positiveId(request.parentId))) {
    throw new AppError('invalid_input', 'The query exceeds its allowed bounds or contains invalid input.');
  }
  if (request.fields !== undefined) validateRequestedFields(request.entity, request.fields, principal);
  for (const filter of request.filters) {
    if (typeof filter !== 'object' || filter === null || Object.keys(filter).some(key => !['field', 'op', 'value'].includes(key)) || typeof filter.field !== 'string' ||
      !['eq', 'in', 'contains', 'gte', 'lte', 'lt'].includes(filter.op)) {
      throw new AppError('invalid_input', 'The query filter is invalid.');
    }
    if (!allowed.has(filter.field)) throw new AppError('forbidden', 'A query field is not available.');
    const values = filter.op === 'in' ? filter.value : [filter.value];
    if (!Array.isArray(values) || values.length === 0 || values.length > 100 || values.some(value =>
      !((typeof value === 'string' && value.length > 0 && value.length <= 2_000) ||
        (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'))) {
      throw new AppError('invalid_input', 'The query filter value is invalid.');
    }
    if ((filter.field === 'id' || filter.field.endsWith('ID')) &&
      (values.some(value => !(filter.field === 'companyID' || (request.entity === 'Companies' && filter.field === 'id') ? validCompanyId(value) : positiveId(value))) || !['eq', 'in'].includes(filter.op))) {
      throw new AppError('invalid_input', 'Identifier filters require valid numeric IDs and equality or membership.');
    }
    if (filter.op === 'contains' && (!stringFields.has(filter.field) || typeof filter.value !== 'string')) {
      throw new AppError('invalid_input', 'Contains is only available for text fields.');
    }
    if ((filter.op === 'gte' || filter.op === 'lte' || filter.op === 'lt') && typeof filter.value === 'boolean') {
      throw new AppError('invalid_input', 'Range filters require a number or date.');
    }
    if (filter.field === 'companyID' || (request.entity === 'Companies' && filter.field === 'id')) {
      for (const companyId of values) assertCompanyScope(principal, companyId);
    }
  }
}

/** Refresh immediately before dispatch; changed identity or policy cannot inherit queued work. */
export async function reauthorize(principal: Principal, store: PrincipalStore, options: MappingValidationOptions = {}): Promise<Principal> {
  const current = await loadVerifiedPrincipal(principal.tenantId, principal.objectId, store, options);
  if (current.resourceId !== principal.resourceId || current.mappingVersion !== principal.mappingVersion) {
    throw new AppError('identity_mapping_invalid', 'The employee mapping changed. Start a new request.');
  }
  const sameSet = <T>(left: T[], right: T[]) => {
    const a = new Set(left), b = new Set(right);
    return a.size === b.size && [...a].every(value => b.has(value));
  };
  if (current.policyVersion !== principal.policyVersion ||
    (current.areaPermissions===undefined)!==(principal.areaPermissions===undefined) || !sameSet(current.areaPermissions??[],principal.areaPermissions??[]) ||
    Boolean(current.allCompanies)!==Boolean(principal.allCompanies) || !sameSet(current.capabilities, principal.capabilities) || !sameSet(current.companyIds, principal.companyIds)) {
    throw new AppError('forbidden', 'The employee policy changed. Start a new request.');
  }
  return current;
}
