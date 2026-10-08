import { z } from 'zod';
import { AppError, positiveId, type AutotaskPort, type Principal, type PrincipalStore } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, reauthorize } from '../../policy/src/index.js';
import { positiveIdSchema, reviewedMetadata, reviewedResources, type SchedulingMetadata, type SchedulingPort, type SchedulingResource, type ScheduleQuery, type SchedulePage, type ServiceCallCreatePayload, type ServiceCallRecord, type ServiceCallResourceRecord, type ServiceCallTicketRecord, type ServiceCallUpdatePayload } from './contracts.js';

export interface FixtureSchedulingRecords { calls: ServiceCallRecord[]; tickets: ServiceCallTicketRecord[]; resources: ServiceCallResourceRecord[] }
export interface FixtureSchedulingOptions {
  records?: FixtureSchedulingRecords;
  resources?: SchedulingResource[];
  secondaryResources?: Record<number, number[]>;
  resolveResources?: (principal: Principal) => Promise<SchedulingResource[]>;
  resolveMetadata?: (principal: Principal, ticketId: number) => Promise<SchedulingMetadata>;
  identityMaxAgeMs?: number;
}
export const callPayloadSchema = z.object({ companyID: z.number().int().nonnegative().safe(), startDateTime: z.string().datetime(), endDateTime: z.string().datetime(), status: positiveIdSchema, description: z.string().max(2000).optional() }).strict().refine((value) => Date.parse(value.startDateTime) < Date.parse(value.endDateTime));

/** Fictitious scheduling data that shares the application's actual fixture ticket scope. */
export class FixtureSchedulingPort implements SchedulingPort {
  readonly source = 'fixture' as const;
  readonly records: FixtureSchedulingRecords;
  readonly calls: { kind: string; entity: string; resourceId: number }[] = [];
  readonly resourceDirectory: SchedulingResource[];
  constructor(private readonly base: AutotaskPort, private readonly principals: PrincipalStore, private readonly options: FixtureSchedulingOptions = {}) {
    if (base.source !== 'fixture') throw new AppError('invalid_input', 'Fixture scheduling requires the fictitious base adapter.');
    this.records = structuredClone(options.records ?? fixtureSchedulingRecords());
    this.resourceDirectory = structuredClone(options.resources ?? [
      { id: 101, label: 'Example Technician', active: true, companyIds: [10] },
      { id: 102, label: 'Sample Reader', active: true, companyIds: [20] },
    ]);
  }
  private async current(p: Principal, write = false) {
    const fresh = await reauthorize(p, this.principals, { resourceMaxAgeMs: this.options.identityMaxAgeMs ?? 300_000 });
    assertCapability(fresh, 'operational.read');
    if (write && !(fresh.capabilities as string[]).includes('scheduling.write')) throw new AppError('forbidden', 'Scheduling write permission is required.');
    return fresh;
  }
  private record(p: Principal, entity: string, kind: string) { this.calls.push({ kind, entity, resourceId: p.resourceId }); }
  async resources(p: Principal) {
    p = await this.current(p);
    return reviewedResources(this.options.resolveResources ? await this.options.resolveResources(p) : this.resourceDirectory, p);
  }
  async metadata(p: Principal, ticketId: number): Promise<SchedulingMetadata> {
    p = await this.current(p);
    const ticket = await this.base.get(p, 'Tickets', ticketId); assertCompanyScope(p, ticket.companyID);
    const value = this.options.resolveMetadata ? await this.options.resolveMetadata(p, ticketId) : {
      version: 'fixture-scheduling-v1', source: 'fixture', ticketId, companyId: ticket.companyID,
      tenantId: p.tenantId, resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion,
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      ticketResourceIds: [ticket.assignedResourceID, ...(this.options.secondaryResources?.[ticketId] ?? [])].filter(positiveId),
      statuses: [{ id: 801, label: 'Scheduled', active: true, bookable: true }], defaultStatusId: 801, allowOverlap: false, attributionField: 'creatorResourceID',
    };
    return reviewedMetadata(value, p, ticketId, ticket.companyID as number, this.source);
  }
  async search(p: Principal, query: ScheduleQuery): Promise<SchedulePage> {
    p = await this.current(p);
    const resources = await this.resources(p);
    if (!query.resourceIds.length || query.resourceIds.some((id) => !resources.some((row) => row.id === id))) throw new AppError('not_found_or_inaccessible', 'The scheduling resource was not found or is inaccessible.');
    if (query.ticketId) { const ticket = await this.base.get(p, 'Tickets', query.ticketId); assertCompanyScope(p, ticket.companyID); }
    const items: SchedulePage['items'] = [];
    for (const call of this.records.calls) {
      if (!p.companyIds.includes(call.companyID) || Date.parse(call.startDateTime) >= Date.parse(query.end) || Date.parse(call.endDateTime) <= Date.parse(query.start)) continue;
      const tickets = this.records.tickets.filter((row) => row.serviceCallID === call.id);
      if (query.ticketId && !tickets.some((row) => row.ticketID === query.ticketId)) continue;
      const assigned = this.records.resources.filter((row) => tickets.some((ticket) => ticket.id === row.serviceCallTicketID));
      if (!assigned.some((row) => query.resourceIds.includes(row.resourceID))) continue;
      let visible = true;
      for (const association of tickets) {
        try { const ticket = await this.base.get(p, 'Tickets', association.ticketID); assertCompanyScope(p, ticket.companyID); if (ticket.companyID !== call.companyID) visible = false; }
        catch (error) { if (!(error instanceof AppError) || error.code !== 'not_found_or_inaccessible') throw error; visible = false; }
      }
      if (!visible) continue;
      items.push({ id: call.id, company_id: call.companyID, start: call.startDateTime, end: call.endDateTime, status: call.status, complete: call.isComplete === 1 || call.isComplete === true,
        ticket_ids: tickets.map((row) => row.ticketID), resource_ids: [...new Set(assigned.map((row) => row.resourceID))].filter((id) => resources.some((row) => row.id === id)),
        ...(typeof call.description === 'string' ? { description: call.description } : {}) });
    }
    this.record(p, 'ServiceCalls', 'query');
    return { items: structuredClone(items.slice(0, 500)), complete: items.length <= 500, fetchedAt: new Date().toISOString(), warnings: [] };
  }
  async createCall(p: Principal, ticketId: number, payload: ServiceCallCreatePayload) {
    p = await this.current(p, true); payload = callPayloadSchema.parse(payload);
    const metadata = await this.metadata(p, ticketId);
    if (payload.companyID !== metadata.companyId || !metadata.statuses.some((row) => row.id === payload.status && row.active && row.bookable)) throw new AppError('precondition_failed', 'The company or service-call status is not eligible.');
    const id = Math.max(5000, ...this.records.calls.map((row) => row.id)) + 1;
    this.records.calls.push({ ...structuredClone(payload), id, [metadata.attributionField]: p.resourceId, isComplete: 0 });
    this.record(p, 'ServiceCalls', 'create'); return { id };
  }
  async getCall(p: Principal, id: number) {
    p = await this.current(p);
    const call = this.records.calls.find((row) => row.id === id);
    if (!call) throw new AppError('not_found_or_inaccessible', 'Service call not found or inaccessible.');
    assertCompanyScope(p, call.companyID); this.record(p, 'ServiceCalls', 'get'); return structuredClone(call);
  }
  async updateCall(p: Principal, id: number, payload: ServiceCallUpdatePayload) {
    p = await this.current(p, true);
    const call = await this.getCall(p, id);
    if (payload.expected.startDateTime !== undefined && payload.expected.startDateTime !== call.startDateTime) throw new AppError('conflict', 'The service-call start changed before update.');
    if (payload.expected.endDateTime !== undefined && payload.expected.endDateTime !== call.endDateTime) throw new AppError('conflict', 'The service-call end changed before update.');
    if (payload.expected.status !== undefined && payload.expected.status !== call.status) throw new AppError('conflict', 'The service-call status changed before update.');
    if (payload.expected.description !== undefined && payload.expected.description !== call.description) throw new AppError('conflict', 'The service-call description changed before update.');
    if (call.status === payload.status || (payload.startDateTime === undefined && payload.endDateTime === undefined && payload.description === undefined && payload.status === undefined)) throw new AppError('invalid_input', 'Supply a changed service-call field.');
    if ((call.isComplete === 1 || call.isComplete === true) && (payload.startDateTime !== undefined || payload.endDateTime !== undefined)) throw new AppError('precondition_failed', 'Completed or canceled service calls cannot change their interval.');
    if (payload.startDateTime !== undefined && (payload.endDateTime === undefined || Date.parse(payload.startDateTime) >= Date.parse(payload.endDateTime))) throw new AppError('invalid_input', 'The service-call end must follow its start.');
    Object.assign(call, Object.fromEntries(Object.entries(payload).filter(([key]) => ['startDateTime', 'endDateTime', 'status', 'description'].includes(key))));
    this.record(p, 'ServiceCalls', 'update'); return { id };
  }
  async cancelCall(p: Principal, id: number, expectedStatus: number, cancelStatus: number) {
    p = await this.current(p, true);
    const call = await this.getCall(p, id);
    if (call.status !== expectedStatus) throw new AppError('conflict', 'The service-call status changed before cancellation.');
    call.status = cancelStatus; call.isComplete = 1;
    this.record(p, 'ServiceCalls', 'cancel'); return { id };
  }
  async createTicket(p: Principal, callId: number, ticketId: number) {
    p = await this.current(p, true); const call = await this.getCall(p, callId), ticket = await this.base.get(p, 'Tickets', ticketId);
    assertCompanyScope(p, ticket.companyID);
    if (ticket.companyID !== call.companyID) throw new AppError('precondition_failed', 'Every ticket on a service call must belong to the exact same company.');
    if (this.records.tickets.some((row) => row.serviceCallID === callId && row.ticketID === ticketId)) throw new AppError('conflict', 'The ticket is already associated with this service call.');
    const id = Math.max(6000, ...this.records.tickets.map((row) => row.id)) + 1;
    this.records.tickets.push({ id, serviceCallID: callId, ticketID: ticketId }); this.record(p, 'ServiceCallTickets', 'create'); return { id };
  }
  async getTicket(p: Principal, callId: number, id: number) {
    p = await this.current(p); const call = await this.getCall(p, callId), row = this.records.tickets.find((item) => item.id === id);
    if (!row || row.serviceCallID !== callId) throw new AppError('not_found_or_inaccessible', 'Service-call ticket association not found or inaccessible.');
    const ticket = await this.base.get(p, 'Tickets', row.ticketID); assertCompanyScope(p, ticket.companyID);
    if (ticket.companyID !== call.companyID) throw new AppError('not_found_or_inaccessible', 'Service-call ticket association not found or inaccessible.');
    this.record(p, 'ServiceCallTickets', 'get'); return structuredClone(row);
  }
  async createResource(p: Principal, callTicketId: number, resourceId: number) {
    p = await this.current(p, true);
    const candidate = this.records.tickets.find((row) => row.id === callTicketId);
    if (!candidate) throw new AppError('not_found_or_inaccessible', 'Service-call ticket association not found or inaccessible.');
    const association = await this.getTicket(p, candidate.serviceCallID, callTicketId), metadata = await this.metadata(p, association.ticketID);
    if (!metadata.ticketResourceIds.includes(resourceId) || !(await this.resources(p)).some((row) => row.id === resourceId && row.active)) throw new AppError('precondition_failed', 'The resource must be active and remain assigned to this ticket.');
    if (this.records.resources.some((row) => row.serviceCallTicketID === callTicketId && row.resourceID === resourceId)) throw new AppError('conflict', 'This resource is already scheduled on the ticket association.');
    const id = Math.max(7000, ...this.records.resources.map((row) => row.id)) + 1;
    this.records.resources.push({ id, serviceCallTicketID: callTicketId, resourceID: resourceId }); this.record(p, 'ServiceCallTicketResources', 'create'); return { id };
  }
  async getResource(p: Principal, callTicketId: number, id: number) {
    p = await this.current(p);
    const association = this.records.tickets.find((row) => row.id === callTicketId);
    if (!association) throw new AppError('not_found_or_inaccessible', 'Service-call association not found or inaccessible.');
    await this.getTicket(p, association.serviceCallID, callTicketId);
    const row = this.records.resources.find((item) => item.id === id);
    if (!row || row.serviceCallTicketID !== callTicketId || !(await this.resources(p)).some((resource) => resource.id === row.resourceID)) throw new AppError('not_found_or_inaccessible', 'Service-call resource association not found or inaccessible.');
    this.record(p, 'ServiceCallTicketResources', 'get'); return structuredClone(row);
  }
}
export function fixtureSchedulingRecords(): FixtureSchedulingRecords {
  return { calls: [{ id: 5001, companyID: 10, startDateTime: '2026-09-10T14:00:00.000Z', endDateTime: '2026-09-10T15:00:00.000Z', status: 801, isComplete: 0, creatorResourceID: 101, description: 'Fictitious existing visit.' }],
    tickets: [{ id: 6001, serviceCallID: 5001, ticketID: 1001 }], resources: [{ id: 7001, serviceCallTicketID: 6001, resourceID: 101 }] };
}
