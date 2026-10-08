// Presentation only: server capabilities and write flags remain authoritative.
export const capabilityLabels = {
  'documentation.read': ['IT Glue', 'read', 'Read mapped documentation and configurations'],
  'documentation.write': ['IT Glue', 'write', 'Create and update reviewed documentation'],
  'rmm.read': ['Datto RMM', 'read', 'Read mapped devices, alerts, inventory and jobs'],
  'rmm.write': ['Datto RMM', 'write', 'Resolve alerts and change RMM device or configuration settings'],
  'rmm.execute': ['Datto RMM', 'write', 'Run approved components'],
  'operational.read': ['Shared operational access', 'read', 'Read tickets, clients, contacts, projects and other operational records'],
  'tickets.write': ['Tickets', 'write', 'Create and update tickets'],
  'time.self': ['Time entries', 'write', 'Record and manage own time'],
  'time.team': ['Time entries', 'read', 'View other employees’ time'],
  'time.approve': ['Time approvals', 'write', 'Review and approve time off and billing approval levels'],
  'scheduling.write': ['Scheduling', 'write', 'Manage service calls and schedules'],
  'finance.read': ['Finance & sales', 'read', 'Read financial and sales records'],
  'sales.write': ['Finance & sales', 'write', 'Manage opportunities and quotes'],
  'finance.write': ['Finance & sales', 'write', 'Manage financial records'],
  'projects.write': ['Projects', 'write', 'Manage projects and tasks'],
  'procurement.write': ['Purchasing & inventory', 'write', 'Manage purchasing and inventory'],
  'configuration.write': ['Assets & configuration', 'write', 'Manage assets and configuration'],
  'expenses.write': ['Expenses', 'write', 'Manage expenses'],
  'platform.manage': ['Administration', 'write', 'Manage platform settings and access'],
  'audit.read': ['Administration', 'read', 'Read administration audit history']
};
export function operationArea(name) {
  if (name.startsWith('itg_')) return 'IT Glue';
  if (name.startsWith('rmm_')) return 'Datto RMM';
  if (/^(opportunity|quote|sales|crm)_/.test(name)) return 'Sales';
  if (/^(invoice|billing|contract)_/.test(name)) return 'Finance';
  if (/^(ticket|checklist|attachment)_/.test(name) || name==='sync_ticket_changes') return 'Tickets';
  if (/^(resource_availability|time_off)/.test(name)) return 'Scheduling';
  if (/^(time_|my_workday)/.test(name)) return 'Time entries';
  if (/^(schedule|service_call|appointment)_/.test(name)) return 'Scheduling';
  if (/^(project|task|phase)_/.test(name)) return 'Projects';
  if (/^(purchase|procurement|receiving)_/.test(name)) return 'Purchasing';
  if (/^(inventory|product)_/.test(name)) return 'Inventory & products';
  if (/^(asset|configuration|subscription)_/.test(name)) return 'Assets & configuration';
  if (/^expense_/.test(name)) return 'Expenses';
  if (/^(company|contact|resource)_/.test(name)) return 'Clients & people';
  if (/^at_(artifact|file)_/.test(name)) return 'Files & exports';
  return 'Administration & shared tools';
}
export function permissionGroups(entries) {
  const groups=new Map();
  for(const entry of entries){if(!groups.has(entry.area))groups.set(entry.area,{area:entry.area,read:[],write:[]});groups.get(entry.area)[entry.write?'write':'read'].push(entry);}
  return [...groups.values()].sort((a,b)=>a.area.localeCompare(b.area)).map(g=>({...g,read:g.read.sort((a,b)=>a.label.localeCompare(b.label)),write:g.write.sort((a,b)=>a.label.localeCompare(b.label))}));
}
export function peopleRows(users,members,resources) {
  const rows=new Map(users.map(user=>[user.id.toLowerCase(),{user}]));
  for(const member of members){const key=member.objectId.toLowerCase();rows.set(key,{...rows.get(key),member});}
  return [...rows.values()].map(row=>({...row,resource:row.member?resources.find(r=>r.id===row.member.resourceId):undefined})).sort((a,b)=>(a.user?.displayName??a.member.objectId).localeCompare(b.user?.displayName??b.member.objectId));
}

export function operationWrites(name,definition){return definition.write||['at_artifact_export','at_artifact_delete','at_file_stage','opportunity_file_stage','at_job_cancel','at_invoke'].includes(name);}

export const areaLabels = {tickets:'Tickets',clients:'Clients & contacts',time:'Time entries',scheduling:'Scheduling',projects:'Projects',sales:'Sales',finance:'Finance',purchasing:'Purchasing',inventory:'Inventory & products',configuration:'Assets & configuration',expenses:'Expenses'};

export const areaHelp = {
  sales: 'Includes opportunities, quotes, quote pricing, sales notes and attachments. Sales access does not grant access to Finance invoices or contracts. Looking up contacts requires Clients & contacts Read; product references require Inventory Read.',
  finance: 'Controls invoices, contracts and billing tools, plus protected financial fields in other areas. Turning Finance off does not hide quote pricing in Sales or costs in Purchasing and Inventory. Review those areas separately if the user should not see those amounts.',
  purchasing: 'Includes purchase orders, order items, receiving and their costs. Those costs remain visible with Purchasing Read even when Finance is off. Linked inventory records may also require Inventory Read.',
  inventory: 'Includes products, stock, inventory movements and their costs. Those costs remain visible with Inventory Read even when Finance is off. Purchase orders require separate Purchasing access.',
  projects: 'Includes projects, phases, tasks and project notes. Protected financial fields require Finance Read; changing those fields also requires Finance Write.',
  configuration: 'Includes assets, configuration records and subscriptions. Protected financial fields require Finance Read; changing those fields also requires Finance Write.',
  clients: 'Allows viewing client and contact information within the selected company scope. Client and contact changes are not currently supported.',
  time: 'Write allows supported changes to your own time. Viewing other employees’ time also requires the additional team-time permission below. Time on a ticket or project task requires Read in that related area.',
  expenses: 'Includes your expense reports and their amounts. Expenses Read can show those amounts even when Finance is off.'
};
