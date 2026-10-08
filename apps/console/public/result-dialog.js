const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value, limit = 1000) => typeof value === 'string' && value.length <= limit ? value : '';
const labels = {
  succeeded_verified: 'Saved and verified', partial: 'Partially completed', accepted_unverified: 'Accepted, not verified',
  unknown_outcome: 'Outcome unknown', dispatching: 'Dispatch started; outcome not confirmed', ready: 'Not dispatched',
  failed: 'Failed', queued: 'Queued', running: 'Running', cancelled: 'Cancelled'
};
export const outcomeLabel = value => Object.hasOwn(labels, value) ? labels[value] : 'Outcome unavailable';

/** Render only receipt facts. Never render arbitrary record fields, JSON or HTML. */
export function renderOperationResult(document, result) {
  result = object(result) ? result : {};
  const data = object(result.data) ? result.data : {};
  const node = (tag, value, className) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = String(value); if (className) element.className = className; return element; };
  const root = node('div', undefined, 'operation-result');
  const facts = [['Outcome', outcomeLabel(result.status)], ['Operation ID', uuid(result.operation_id) ? result.operation_id : 'Unavailable']];
  for (const [field, label] of [['ticket_id','Ticket ID'],['note_id','Returned note ID'],['time_entry_id','Returned time entry ID'],['service_call_id','Returned service call ID'],['service_call_ticket_id','Returned ticket association ID'],['recorded_resource_id','Autotask employee ID'],['assigned_resource_id','Requested employee ID'],['queue_id','Requested queue ID'],['status_id','Requested status ID']]) if (positive(data[field])) facts.push([label, data[field]]);
  if (data.audience === 'internal' || data.audience === 'customer') facts.push(['Note audience', data.audience === 'internal' ? 'Internal' : 'Customer visible']);
  if (typeof data.hours_worked === 'number' && Number.isFinite(data.hours_worked) && data.hours_worked > 0 && data.hours_worked <= 24) facts.push(['Requested time', `${Math.round(data.hours_worked * 6000) / 100} minutes`]);
  if (typeof data.work_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.work_date)) facts.push(['Work date', data.work_date]);
  if (text(data.timezone, 100)) facts.push(['Timezone', data.timezone]);
  for (const [field, label] of [['start','Scheduled start'],['end','Scheduled end']]) if (text(data[field], 50) && Number.isFinite(Date.parse(data[field]))) facts.push([label, data[field]]);
  if (Array.isArray(data.resource_ids) && data.resource_ids.length <= 10 && data.resource_ids.every(positive)) facts.push(['Requested employee IDs', data.resource_ids.join(', ')]);
  const list = node('dl', undefined, 'receipt-facts');
  for (const [label, value] of facts) { const row = node('div'); row.append(node('dt', label), node('dd', value)); list.append(row); }
  root.append(list);
  if (text(result.receipt, 1500)) root.append(node('p', result.receipt, 'receipt-summary'));
  root.append(node('p', 'A returned record ID alone does not establish success. Only an outcome marked “Saved and verified” confirms the requested effect.', 'hint'));

  const steps = [];
  if (object(data.steps)) for (const [key, label] of [['note','Documentation note'],['time','Time entry'],['update','Ticket change']]) if (object(data.steps[key])) steps.push({ ...data.steps[key], label });
  if (Array.isArray(data.scheduling_steps)) for (const step of data.scheduling_steps.slice(0, 12)) {
    if (!object(step)) continue;
    const label = step.key === 'call' ? 'Service call' : step.key === 'ticket' ? 'Ticket association' : /^resource_[1-9]\d*$/.test(step.key) ? `Employee assignment${positive(step.resource_id) ? ` · employee ${step.resource_id}` : ''}` : '';
    if (label) steps.push({ ...step, label });
  }
  if (steps.length) {
    const wrap = node('div', undefined, 'table-wrap'), table = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
    table.append(node('caption', 'Step outcomes'));
    for (const label of ['Step','Outcome','Returned record ID','Step operation ID']) { const th = node('th', label); th.setAttribute('scope', 'col'); header.append(th); }
    head.append(header);
    for (const step of steps.slice(0, 15)) { const row = node('tr'); for (const value of [step.label, outcomeLabel(step.state), positive(step.native_id) ? step.native_id : 'None recorded', uuid(step.operation_id) ? step.operation_id : 'Unavailable']) row.append(node('td', value)); body.append(row); }
    table.append(head, body); wrap.append(table); root.append(wrap);
  }
  if (Array.isArray(data.defaults)) {
    const defaults = data.defaults.slice(0, 3).filter(item => object(item) && ['note_type','role','work_type'].includes(item.field) && positive(item.id) && ['explicit','reviewed_default'].includes(item.source));
    if (defaults.length) { root.append(node('h3', 'Selected options')); const items = node('ul'); for (const item of defaults) items.append(node('li', `${{note_type:'Note type',role:'Work role',work_type:'Work type'}[item.field]}: ${item.id} · ${item.source === 'explicit' ? 'Explicit choice' : 'Reviewed default'}${text(item.rule_version, 100) ? ` · rule ${item.rule_version}` : ''}`)); root.append(items); }
  }
  const next = result.needs_manual_review === true || ['unknown_outcome','accepted_unverified','dispatching'].includes(result.status)
    ? 'Do not repeat this operation. Reconcile recorded IDs before further writes; a create with no returned ID needs investigation.'
    : result.can_resume === true ? 'Resume can continue eligible unfinished steps after fresh access and prerequisite checks. Saved steps must not be recreated.'
    : result.status === 'succeeded_verified' ? 'No repeat is needed for the verified effects.' : 'Inspect the recorded outcome before further work. Do not recreate any saved step.';
  const action = node('section', undefined, 'callout'); action.append(node('h3', 'Next action'), node('p', next)); root.append(action);
  if (Array.isArray(result.warnings)) { const warnings = result.warnings.slice(0, 6).filter(value => text(value, 600)); if (warnings.length) { root.append(node('h3', 'Notes')); const items = node('ul'); for (const warning of warnings) items.append(node('li', warning)); root.append(items); } }
  return root;
}
