import { AppError, permissionAreas, type AreaPermission, type Capability, type PermissionArea, type Principal } from '../../contracts/src/index.js';

export const AREA_PERMISSIONS = permissionAreas.flatMap(area => [`${area}.read`, `${area}.write`] as AreaPermission[]);
export function validAreaPermissions(value: unknown): value is AreaPermission[] {
  return Array.isArray(value) && value.length <= AREA_PERMISSIONS.length && value.every(v => AREA_PERMISSIONS.includes(v)) && new Set(value).size === value.length && value.every(v => !v.endsWith('.write') || value.includes(v.replace('.write', '.read')));
}
export function assertArea(p: Principal, area: PermissionArea, write = false): void {
  if (!p.active || (p.areaPermissions !== undefined && (!validAreaPermissions(p.areaPermissions) || !p.areaPermissions.includes(`${area}.read`) || (write && !p.areaPermissions.includes(`${area}.write`))))) {
    throw new AppError('forbidden', `${area} ${write ? 'write' : 'read'} permission is required.`);
  }
}
export function canReadFinance(p: Principal): boolean {
  return p.areaPermissions === undefined ? p.capabilities.includes('finance.read') : p.areaPermissions.includes('finance.read');
}
/** Internal compatibility flags do not grant area access. Every public action also checks its area. */
export function compatibilityCapabilities(grants: AreaPermission[], advanced: Capability[]): Capability[] {
  const caps = new Set<Capability>(advanced.filter(c => ['time.team', 'time.approve', 'platform.manage', 'audit.read', 'documentation.read', 'documentation.write', 'rmm.read', 'rmm.execute', 'rmm.write'].includes(c)));
  if (grants.length) caps.add('operational.read');
  if (grants.some(g => /^(sales|finance|projects|purchasing|inventory|configuration)\./.test(g))) caps.add('finance.read');
  if (grants.some(g => /^(sales|finance|projects|purchasing|inventory|configuration)\.write$/.test(g))) caps.add('finance.write');
  for (const [area, cap] of Object.entries({tickets:'tickets.write',sales:'sales.write',projects:'projects.write',purchasing:'procurement.write',inventory:'procurement.write',configuration:'configuration.write',scheduling:'scheduling.write',expenses:'expenses.write'})) {
    if (grants.includes(`${area}.write` as AreaPermission)) caps.add(cap as Capability);
  }
  // Existing ownership checks use these flags for reads as well as mutations.
  if (grants.some(g => /^(time|scheduling)\./.test(g))) caps.add('time.self');
  if (grants.includes('expenses.read')) caps.add('expenses.write');
  return [...caps];
}
/** Preview of equivalent legacy grants for the admin editor; saving makes these explicit. */
export function legacyAreaPermissions(caps: readonly Capability[]): AreaPermission[] {
  const has = (c: Capability) => caps.includes(c), result: AreaPermission[] = [];
  if (!has('operational.read')) return result;
  for (const area of permissionAreas) {
    const business = ['sales','finance','projects','purchasing','inventory','configuration'].includes(area);
    const read = business ? has('finance.read') : area === 'expenses' ? has('expenses.write') : area === 'time' ? has('time.self') || has('time.team') : true;
    if (!read) continue;
    result.push(`${area}.read`);
    const cap = ({tickets:'tickets.write',time:'time.self',scheduling:'scheduling.write',projects:'projects.write',sales:'sales.write',finance:'finance.write',purchasing:'procurement.write',inventory:'procurement.write',configuration:'configuration.write',expenses:'expenses.write'} as const)[area as Exclude<PermissionArea,'clients'>];
    if (cap && has(cap) && (!business || area === 'sales' || has('finance.write'))) result.push(`${area}.write`);
  }
  return result;
}
export function entityArea(entity: string): PermissionArea | undefined {
  if (/^(Ticket|Checklist)/i.test(entity)) return 'tickets';
  if (/^(CompanyToDos|Opportunit|Quote)/i.test(entity) || entity.toLowerCase() === 'companynotes') return 'sales';
  if (/^(Contract|Invoice)/i.test(entity)) return 'finance';
  if (/^(Project|Phase|Task)/i.test(entity)) return 'projects';
  if (/^Purchase/i.test(entity)) return 'purchasing';
  if (/^(Inventory|Product)/i.test(entity)) return 'inventory';
  if (/^(Configuration|Subscription)/i.test(entity)) return 'configuration';
  if (/^(TimeEntries|BillingItemApprovalLevels)/i.test(entity)) return 'time';
  if (/^(ServiceCall|Appointment|ResourceDaily|TimeOff|ResourceTimeOffApprovers)/i.test(entity)) return 'scheduling';
  if (/^Expense/i.test(entity)) return 'expenses';
  if (/^(Companies|Contacts|CompanyLocations)/i.test(entity)) return 'clients';
  return undefined;
}
export function assertEntityArea(p: Principal, entity: string, write = false): void {
  const area = entityArea(entity); if (area) assertArea(p, area, write);
}
const shared = new Set(['at_whoami','at_discover','at_describe','at_read_invoke','at_invoke','at_validate','at_query','at_get','at_related','at_diagnostics','at_operation_status','at_operation_reconcile','at_operation_resume','at_job_start','at_job_list','at_job_status','at_job_cancel','at_artifact_export','at_artifact_list','at_artifact_get','at_artifact_delete','at_playbook_list','at_playbook_get','at_reference_resolve','business_schema','business_operation_status','work_operation_status','work_write_options','sync_status']);
export function operationArea(name: string): PermissionArea | undefined {
  if (/^(opportunity|quote|sales|crm)_/.test(name)) return 'sales';
  if (/^(contract|invoice|billing)_/.test(name)) return 'finance';
  if (/^(project|phase|task)_/.test(name)) return 'projects';
  if (/^(purchase|receiving)_/.test(name)) return 'purchasing';
  if (/^(inventory|product)_/.test(name)) return 'inventory';
  if(['client_health_report_start','read_report_status','read_report_result','read_report_cancel','client_overview','device_investigate'].includes(name))return 'configuration';
  if(name==='client_inventory_compare')return 'configuration';
  if (/^(asset|configuration|subscription)_/.test(name)) return 'configuration';
  if (/^expense_/.test(name)) return 'expenses';
  if (/^(schedule|service_call|appointment|resource_availability|time_off)/.test(name)) return 'scheduling';
  if (/^(time_|my_workday)/.test(name)) return 'time';
  if (/^(ticket|checklist|attachment)_/.test(name) || ['sync_ticket_changes','at_file_stage'].includes(name)) return 'tickets';
  if(name==='at_select_company')return 'clients';
  if (/^(company|contact|resource)_/.test(name)) return 'clients';
  return undefined;
}
function operationRequirements(name: string, write: boolean): AreaPermission[] {
  const area=operationArea(name), grants: AreaPermission[]=[];
  const add=(a:PermissionArea,w=false)=>{grants.push(`${a}.read`);if(w)grants.push(`${a}.write`);};
  if(area)add(area,write||name==='at_file_stage'||name==='opportunity_file_stage');
  if(name==='ticket_environment_context')add('configuration');
  if(name==='ticket_document_work')add('time',write);
  if(name==='time_log_ticket'||name==='time_entry_search')add('tickets');
  if(name==='time_log_task')add('projects');
  if(name==='my_workday'){add('tickets');add('projects');add('scheduling');}
  return [...new Set(grants)];
}
/** Pure local check, reused by discovery and every dispatch reauthorization. */
export function assertOperationArea(p: Principal, name: string, write: boolean): void {
  if (p.areaPermissions === undefined) return;
  if (!operationArea(name) && !shared.has(name) && !name.startsWith('rmm_') && !name.startsWith('itg_')) throw new AppError('forbidden', 'This operation has no reviewed area permission.');
  for(const grant of operationRequirements(name,write)) {
    const [area,mode]=grant.split('.'); assertArea(p,area as PermissionArea,mode==='write');
  }
}

export function assertRecordedOperationArea(p: Principal, operation: string): void {
  if (p.areaPermissions === undefined) return;
  if (operation.startsWith('business_')) {
    const area=entityArea(operation.split('_')[1] ?? '');
    if(!area) throw new AppError('forbidden','The receipt has no reviewed area permission.');
    assertArea(p,area);
  } else assertOperationArea(p,operation,false);
}

export function publicOperationPermissions(p: Principal, name: string, write: boolean, legacy: readonly Capability[]): string[] {
  if(p.areaPermissions===undefined)return [...legacy];
  return [...operationRequirements(name,write),...legacy.filter(c=>['time.team','time.approve','platform.manage','audit.read','documentation.read', 'documentation.write', 'rmm.read','rmm.execute','rmm.write'].includes(c))];
}
