/** Verified native navigation commands. No routes are inferred from entity names.
 * Source: https://ww2.autotask.net/help/developerhelp/content/apis/executecommand/UsingExecuteCommandAPI.htm
 * Quotes: ExecuteCommandAPIIntro.htm documents OpenQuote by ID (edit page).
 */
export const recordLinkRoutes: Readonly<Record<string, readonly [string, string]>> = {
  Tickets: ['OpenTicketDetail', 'TicketID'], Companies: ['OpenAccount', 'AccountID'],
  Contacts: ['OpenContact', 'ContactID'], Opportunities: ['OpenOpportunity', 'OpportunityID'],
  Quotes: ['OpenQuote', 'ID'], Projects: ['OpenProject', 'ProjectID'], Tasks: ['OpenTaskDetail', 'TaskID'],
  Contracts: ['OpenContract', 'ContractID'], ConfigurationItems: ['EditInstalledProduct', 'InstalledProductID'],
  TimeEntries: ['EditTimeEntry', 'WorkEntryID'], Appointments: ['OpenAppointment', 'AppointmentID'],
  KnowledgebaseArticles: ['OpenKBArticle', 'ID'], SalesOrders: ['OpenSalesOrder', 'SalesOrderID'],
  ServiceCalls: ['OpenServiceCall', 'ServiceCallID'], CompanyToDos: ['OpenToDo', 'ToDoID'],
};
export function recordWebUrl(hosts: readonly string[], entity: string, id: unknown): string | undefined {
  const host = hosts[0], route = Object.hasOwn(recordLinkRoutes, entity) ? recordLinkRoutes[entity] : undefined;
  if (!route || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
      !host || host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return undefined;
  const url = new URL(`https://${host}/Autotask/AutotaskExtend/ExecuteCommand.aspx`);
  url.searchParams.set('Code', route[0]); url.searchParams.set(route[1], String(id));
  return url.href;
}
export function ticketWebUrl(hosts: readonly string[], id: unknown): string | undefined {
  return recordWebUrl(hosts, 'Tickets', id);
}
