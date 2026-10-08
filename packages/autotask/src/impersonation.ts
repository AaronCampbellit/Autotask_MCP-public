/**
 * Autotask only supports resource impersonation on the REST entities listed in
 * its API security documentation. Sending ImpersonationResourceId to other
 * entities can turn a valid API-user call into a hidden 404 or attribute it in
 * an unsupported way. Those operations run as the API user and must continue
 * to pass the MCP's own identity, capability, tenant and parent-scope checks.
 *
 * Source: https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/_EntitiesOverview.htm
 */
const impersonatedEntities = new Set([
  'AttachmentInfo',
  'Companies',
  'CompanyNotes',
  'CompanyToDos',
  'Contacts',
  'ContractNotes',
  'ConfigurationItems',
  'ConfigurationItemNotes',
  'InventoryItems',
  'InventoryLocations',
  'Opportunities',
  'Products',
  'ProductNotes',
  'Projects',
  'ProjectNotes',
  'PurchaseOrders',
  'Quotes',
  'SalesOrders',
  'ServiceCalls',
  'Subscriptions',
  'TaskNotes',
  'Tickets',
  'TicketNotes',
  'TimeEntries',
]);

const impersonationAliases: Record<string, string> = {
  OpportunityAttachments: 'AttachmentInfo',
  TicketAttachments: 'AttachmentInfo',
};

export function supportsAutotaskResourceImpersonation(entity: string): boolean {
  return impersonatedEntities.has(impersonationAliases[entity] ?? entity);
}

export function impersonationHeader(entity: string, resourceId: number): Record<string, string> {
  return supportsAutotaskResourceImpersonation(entity)
    ? { ImpersonationResourceId: String(resourceId) }
    : {};
}
