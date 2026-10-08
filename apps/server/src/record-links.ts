type Row = Record<string, unknown>;
const row = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
type Link = (entity: string, id: unknown) => string | undefined;
const reads: Record<string, string> = {
  opportunity: 'Opportunities', quote: 'Quotes', project: 'Projects', task: 'Tasks',
  contract: 'Contracts', asset: 'ConfigurationItems', crm_todo: 'CompanyToDos', time: 'TimeEntries',
};
/** Only documented result positions are enriched after authorization. Never recurse into business text. */
export function addRecordLinks(name: string, result: unknown, link: Link, input?: unknown): unknown {
  if (!row(result)) return result;
  const attach = (v: unknown, entity: string, key = 'id'): unknown => {
    if (!row(v)) return v;
    const url = link(entity, v[key]); return url ? {...v, web_url: url} : v;
  };
  const list = (v: unknown, entity: string) => Array.isArray(v) ? v.map(r => attach(r, entity)) : v;
  const collection = (v: unknown, entity: string) => row(v) ? {...v, ...(Array.isArray(v.items) ? {items: list(v.items, entity)} : {}), ...(Array.isArray(v.data) ? {data: list(v.data, entity)} : {})} : v;
  let out = {...result};
  if(name.startsWith('opportunity_attachment_')){out=attach(out,'Opportunities','opportunity_id') as Row;if(row(out.data))out.data=attach(out.data,'Opportunities','opportunity_id');}
  for (const [prefix, entity] of Object.entries(reads)) {
    if (name === `${prefix}_get`) out.data = attach(out.data, entity);
    if (name === `${prefix}_search`) out.data = list(out.data, entity);
  }
  if (name === 'contact_search') out.contacts = list(out.contacts, 'Contacts');
  if (name === 'contact_get') out.contact = attach(out.contact, 'Contacts');
  if (name === 'sales_reference_search' && row(input) && input.entity === 'Contacts') out.data = list(out.data, 'Contacts');
  if (name === 'at_reference_resolve' && out.kind === 'company') out = attach(out, 'Companies') as Row;
  if (['at_get','at_query','at_related'].includes(name) && row(out.data) && typeof out.data.entity === 'string') {
    const d = out.data; out.data = {...d, ...(row(d.item) ? {item: attach(d.item, d.entity as string)} : {}), ...(Array.isArray(d.items) ? {items: list(d.items, d.entity as string)} : {})};
  }
  if (name === 'project_context') {out.project = attach(out.project, 'Projects'); out.tasks = collection(out.tasks, 'Tasks');}
  if (name === 'contract_context') out.contract = attach(out.contract, 'Contracts');
  if (name === 'quote_compare' && Array.isArray(out.data)) out.data = out.data.map(v => row(v) ? {...v, quote: attach(v.quote, 'Quotes')} : v);
  if (['quote_workflow_inspect','quote_workflow_prepare','quote_opportunity_pdf_search','quote_opportunity_pdf_get'].includes(name)) {
    out = attach(out, 'Quotes', 'quote_id') as Row;
    if (row(out.context)) out.context = {...out.context, quote: attach(out.context.quote, 'Quotes'), opportunity: attach(out.context.opportunity, 'Opportunities')};
  }
  if (row(out.data)) {
    let d = {...out.data};
    if (name === 'ticket_prepare_visit') d.appointment = attach(d.appointment, 'ServiceCalls');
    if (name === 'schedule_search') d.entries = list(d.entries, 'ServiceCalls');
    if (name === 'my_workday') {d.tasks = collection(d.tasks, 'Tasks'); d.time = collection(d.time, 'TimeEntries');}
    if (['ticket_context','ticket_prepare_visit'].includes(name) && row(d.collections)) {
      const c = {...d.collections};
      for (const [key, entity] of Object.entries({time:'TimeEntries',assets:'ConfigurationItems',contact:'Contacts',schedule:'ServiceCalls'})) if (row(c[key])) c[key] = collection(c[key], entity);
      d.collections = c;
    }
    out.data = d;
  }
  if (name === 'time_entry_search' && row(out.data)) out.data = {...out.data, entries:list(out.data.entries, 'TimeEntries')};
  // Native sales/business receipts carry the entity and returned native ID at the root.
  if (typeof out.operation_id === 'string') {
    if (typeof out.entity === 'string' && out.action !== 'delete') out = attach(out, out.entity, 'native_id') as Row;
    if (row(out.data)) {
      let d = out.data;
      // Keep the existing ticket receipt URL; expose other affected records with explicit labels.
      for (const [key, entity] of Object.entries({service_call_id:'ServiceCalls',task_id:'Tasks',time_entry_id:'TimeEntries'})) {
        const url = link(entity, d[key]);
        if (url && name !== 'time_delete') d = {...d, [`${key.slice(0,-3)}_web_url`]:url, ...(d.web_url ? {} : {web_url:url})};
      }
      out.data = d;
    }
  }
  return out;
}
