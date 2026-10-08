type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Enrich only known, already-authorized result positions; never walk arbitrary record text. */
export function addTicketLinks(name: string, result: unknown, link: (id: unknown) => string | undefined): unknown {
  if (!row(result)) return result;
  const attach = (value: unknown, key = 'id'): unknown => {
    if (!row(value)) return value;
    const web_url = link(value[key]);
    return web_url ? {...value, web_url} : value;
  };
  if (name === 'ticket_search' && Array.isArray(result.data)) return {...result, data: result.data.map(item => attach(item))};
  if (!row(result.data)) return result;
  let data = result.data;
  if((name==='ticket_completion_search'||name==='ticket_status_transition_search')&&Array.isArray(data.items))data={...data,items:data.items.map(item=>row(item)?{...item,ticket:attach(item.ticket)}:item)};
  if (name === 'ticket_context' || name === 'ticket_prepare_visit') data = {...data, ticket: attach(data.ticket)};
  if (name === 'my_workday' && row(data.assigned_tickets) && Array.isArray(data.assigned_tickets.items)) {
    data = {...data, assigned_tickets: {...data.assigned_tickets, items: data.assigned_tickets.items.map(item => attach(item))}};
  }
  if ((name === 'at_query' || name === 'at_get') && data.entity === 'Tickets') {
    data = {...data, ...(Array.isArray(data.items) ? {items: data.items.map(item => attach(item))} : {}),
      ...(row(data.item) ? {item: attach(data.item)} : {})};
  }
  // Only receipt envelopes identify this field as the affected ticket. Missing IDs
  // (including uncertain creates) remain missing; an operation/note ID is never used.
  if (typeof result.operation_id === 'string') data = attach(data, 'ticket_id') as Row;
  return data === result.data ? result : {...result, data};
}
