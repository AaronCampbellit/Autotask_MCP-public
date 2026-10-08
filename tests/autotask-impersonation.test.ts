import test from 'node:test';
import assert from 'node:assert/strict';
import { impersonationHeader, supportsAutotaskResourceImpersonation } from '../packages/autotask/src/impersonation.js';
import { providerRoute } from '../packages/execution/src/index.js';

test('resource impersonation follows the documented Autotask REST entity list', () => {
  for (const entity of ['Tickets', 'TicketNotes', 'TimeEntries', 'Companies', 'CompanyToDos', 'Projects', 'TicketAttachments', 'OpportunityAttachments']) {
    assert.equal(supportsAutotaskResourceImpersonation(entity), true, entity);
    assert.deepEqual(impersonationHeader(entity, 42), { ImpersonationResourceId: '42' });
  }
  for (const entity of ['TicketSecondaryResources', 'TaskSecondaryResources', 'TicketChecklistItems', 'TicketTagAssociations', 'ServiceCallTickets', 'ServiceCallTicketResources', 'ExpenseReports', 'ExpenseItems', 'TimeOffRequests', 'ResourceDailyAvailabilities']) {
    assert.equal(supportsAutotaskResourceImpersonation(entity), false, entity);
    assert.deepEqual(impersonationHeader(entity, 42), {});
  }
});

test('diagnostic route sanitization preserves secondary-resource endpoint names, not IDs', () => {
  assert.equal(providerRoute(new URL('https://webservices3.autotask.net/atservicesrest/v1.0/TicketSecondaryResources/9003')), '/atservicesrest/v1.0/TicketSecondaryResources/:id');
});
