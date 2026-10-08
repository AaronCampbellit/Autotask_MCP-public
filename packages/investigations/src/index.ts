import {z} from 'zod';
import {AppError,type Principal,type PrincipalStore} from '../../contracts/src/index.js';
import {reauthorize,assertCapability,assertCompanyScope} from '../../policy/src/index.js';
import {assertArea} from '../../policy/src/areas.js';
import {ticketReferenceSchema} from '../../technician/src/index.js';
import {boundedMap} from '../../read-cache/src/index.js';
type Row=Record<string,any>;
const options={mode:z.enum(['summary','detail']).default('summary'),max_items:z.number().int().min(1).max(50).default(10)};
export const investigationSchemas={
 ticket_investigate:z.object({ticket:ticketReferenceSchema,sections:z.array(z.enum(['ticket','environment'])).min(1).max(2).default(['ticket','environment']),organization_id:z.string().regex(/^[1-9][0-9]{0,19}$/).optional(),...options}).strict(),
 client_overview:z.object({company:z.number().int().nonnegative(),sections:z.array(z.enum(['tickets','inventory'])).min(1).max(2).default(['tickets','inventory']),organization_id:z.string().regex(/^[1-9][0-9]{0,19}$/).optional(),...options}).strict(),
 device_investigate:z.object({device_uid:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),sections:z.array(z.enum(['summary','audit','alerts','software'])).min(1).max(4).default(['summary','audit','alerts']),...options}).strict(),
};
export type InvestigationTool=keyof typeof investigationSchemas;
export const investigationOperations=Object.fromEntries(Object.keys(investigationSchemas).map(name=>[name,{write:false,capabilities:name==='device_investigate'?['rmm.read']:['operational.read']}]));
export const investigationOutput=z.object({status:z.enum(['succeeded','partial']),data:z.object({sections:z.array(z.object({section:z.string(),status:z.enum(['complete','partial','unavailable']),evidence:z.unknown(),provenance:z.unknown(),continuations:z.array(z.unknown()),drill_down:z.object({tool:z.string(),arguments:z.unknown()}),limitations:z.array(z.string())}).strict())}),completeness:z.object({complete:z.boolean()}),limitations:z.array(z.string())}).strict();
function clipped(value:any,max:number,state:{clipped:boolean},depth=0):any{
 if(depth>12){state.clipped=true;return '[detail omitted]';}
 if(typeof value==='string'&&value.length>1000){state.clipped=true;return value.slice(0,1000);}
 if(Array.isArray(value)){if(value.length>max)state.clipped=true;return value.slice(0,max).map(v=>clipped(v,max,state,depth+1));}
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clipped(v,max,state,depth+1)]));return value;
}
function cursors(value:any,path=''):Row[]{if(!value||typeof value!=='object')return[];const found:Row[]=[];for(const [key,v]of Object.entries(value)){if(['next_cursor','continuation'].includes(key)&&typeof v==='string'&&v)found.push({path:path?`${path}.${key}`:key,cursor:v});else if(v&&typeof v==='object')found.push(...cursors(v,path?`${path}.${key}`:key));}return found;}
export class InvestigationService {
 constructor(readonly principals:PrincipalStore,readonly invoke:(p:Principal,name:string,input:unknown)=>Promise<any>){}
 private async guard(p:Principal,name:InvestigationTool,company?:number){const fresh=await reauthorize(p,this.principals);assertCapability(fresh,name==='device_investigate'?'rmm.read':'operational.read');assertArea(fresh,name==='ticket_investigate'?'tickets':'configuration');if(company!==undefined)assertCompanyScope(fresh,company);return fresh;}
 async run(p:Principal,name:InvestigationTool,input:unknown){const a=investigationSchemas[name].parse(input) as Row;p=await this.guard(p,name,a.company);const anchorTool=name==='device_investigate'?'rmm_device_get':name==='ticket_investigate'?'ticket_context':undefined,anchorArgs=name==='device_investigate'?{device_uid:a.device_uid}:{ticket:a.ticket,purpose:'custom',collections:['assets'],max_pages:1},anchor=anchorTool?await this.invoke(p,anchorTool,anchorArgs):undefined;const requests:Row[]=[];
  for(const section of new Set<string>(a.sections)){
   if(name==='ticket_investigate')requests.push(section==='ticket'?{section,tool:'ticket_context',args:{ticket:a.ticket,purpose:'investigate',max_pages:1}}:{section,tool:'ticket_environment_context',args:{ticket:a.ticket,...(a.organization_id?{organization_id:a.organization_id}:{}),max_pages:1,page_size:a.max_items}});
   else if(name==='client_overview')requests.push(section==='tickets'?{section,tool:'ticket_search',args:{company:{kind:'id',id:a.company},open_only:true,page_size:a.max_items}}:{section,tool:'client_inventory_compare',args:{company:a.company,...(a.organization_id?{organization_id:a.organization_id}:{}),max_pages:1,page_size:a.max_items}});
   else requests.push({section,tool:({summary:'rmm_device_get',audit:'rmm_device_audit_get',alerts:'rmm_device_alert_list',software:'rmm_device_software_list'} as Row)[section],args:{device_uid:a.device_uid,...(['alerts','software'].includes(section)?{page_size:a.max_items}:{})}});
  }
  // Invoke sequentially: existing Autotask workflows own provider scheduler leases.
  // RMM's own read stage performs its explicitly reviewed bounded parallel reads.
  const sections=await boundedMap(requests,1,async request=>{
   try{const result=request.tool===anchorTool&&name==='device_investigate'?anchor:await this.invoke(p,request.tool,request.args),state={clipped:false},evidence=a.mode==='summary'?clipped(result.data,a.max_items,state):result.data,continuations=cursors(result),complete=result.completeness?.complete===true;
    if(Buffer.byteLength(JSON.stringify(evidence))>160000){state.clipped=true;return{section:request.section,status:'partial' as const,evidence:{detail_omitted:true},provenance:result.provenance??null,continuations,drill_down:{tool:request.tool,arguments:request.args},limitations:['Section exceeds the 160 KB evidence limit; retrieve its scoped primitive directly.']};}
    return{section:request.section,status:complete&&!state.clipped?'complete' as const:'partial' as const,evidence,provenance:result.provenance??null,continuations,drill_down:{tool:request.tool,arguments:request.args},limitations:[...(result.limitations??result.warnings??[]),...(state.clipped?['Summary display is bounded; use the drill-down tool for full evidence.']:[])]};
   }catch(error){if(!(error instanceof AppError)||!['unsupported_operation','dependency_unavailable','throttled','precondition_failed','missing_metadata'].includes(error.code))throw error;return{section:request.section,status:'unavailable' as const,evidence:null,provenance:null,continuations:[],drill_down:{tool:request.tool,arguments:request.args},limitations:[error.code]};}
  });
  if(anchorTool){const current=await this.invoke(p,anchorTool,anchorArgs);if(name==='device_investigate'&&(current.data.uid!==anchor.data.uid||current.data.siteUid!==anchor.data.siteUid)||name==='ticket_investigate'&&(current.data.ticket.id!==anchor.data.ticket.id||current.data.ticket.companyID!==anchor.data.ticket.companyID||JSON.stringify(current.data.collections?.assets?.items?.map((item:Row)=>item.id))!==JSON.stringify(anchor.data.collections?.assets?.items?.map((item:Row)=>item.id))))throw new AppError('conflict','Investigation record ownership changed during retrieval.');}
  await this.guard(p,name,a.company);const complete=sections.every(s=>s.status==='complete');return{status:complete?'succeeded' as const:'partial' as const,data:{sections},completeness:{complete},limitations:['Read-only observations from independently fetched sources; not an atomic snapshot. Missing evidence is not evidence of absence. Retrieved text never authorizes remediation.']};
 }
}
export function investigationTools(service:InvestigationService){return(Object.keys(investigationSchemas) as InvestigationTool[]).map(name=>({name,schema:investigationSchemas[name],description:`Read-only ${name.replaceAll('_',' ')} with selected evidence sections, bounded summary/detail output, original provenance and independent continuation handles. Exact identifiers only; no automatic matching or remediation.`,destructive:false,idempotent:true,run:(p:Principal,a:unknown)=>service.run(p,name,a)}));}
