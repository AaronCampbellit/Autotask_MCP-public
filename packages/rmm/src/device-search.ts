import {z} from 'zod';
import type {Row} from './store.js';

// Public search names map only to fields in the reviewed device response contract.
export const deviceSearchFields:Record<string,{path:string;kind:'text'|'exact'|'number'|'boolean'|'date'}>={
 id:{path:'id',kind:'number'},device_uid:{path:'uid',kind:'exact'},site_id:{path:'siteId',kind:'number'},site_name:{path:'siteName',kind:'text'},
 hostname:{path:'hostname',kind:'text'},description:{path:'description',kind:'text'},device_class:{path:'deviceClass',kind:'text'},
 device_category:{path:'deviceType.category',kind:'text'},device_type:{path:'deviceType.type',kind:'text'},
 internal_ip_address:{path:'intIpAddress',kind:'exact'},external_ip_address:{path:'extIpAddress',kind:'exact'},
 domain:{path:'domain',kind:'text'},last_logged_in_user:{path:'lastLoggedInUser',kind:'text'},
 operating_system:{path:'operatingSystem',kind:'text'},a64_bit:{path:'a64Bit',kind:'boolean'},
 cag_version:{path:'cagVersion',kind:'text'},display_version:{path:'displayVersion',kind:'text'},
 online:{path:'online',kind:'boolean'},suspended:{path:'suspended',kind:'boolean'},deleted:{path:'deleted',kind:'boolean'},reboot_required:{path:'rebootRequired',kind:'boolean'},software_status:{path:'softwareStatus',kind:'text'},
 last_seen:{path:'lastSeen',kind:'date'},last_reboot:{path:'lastReboot',kind:'date'},last_audit_date:{path:'lastAuditDate',kind:'date'},creation_date:{path:'creationDate',kind:'date'},warranty_date:{path:'warrantyDate',kind:'date'},
 antivirus_product:{path:'antivirus.antivirusProduct',kind:'text'},antivirus_status:{path:'antivirus.antivirusStatus',kind:'text'},
 patch_status:{path:'patchManagement.patchStatus',kind:'text'},patches_approved_pending:{path:'patchManagement.patchesApprovedPending',kind:'number'},patches_not_approved:{path:'patchManagement.patchesNotApproved',kind:'number'},patches_installed:{path:'patchManagement.patchesInstalled',kind:'number'},
 snmp_enabled:{path:'snmpEnabled',kind:'boolean'},network_probe:{path:'networkProbe',kind:'boolean'},onboarded_via_network_monitor:{path:'onboardedViaNetworkMonitor',kind:'boolean'},
 portal_url:{path:'portalUrl',kind:'exact'},web_remote_url:{path:'webRemoteUrl',kind:'exact'},
};
const text=z.string().trim().min(1).max(500);
const date=z.iso.datetime({offset:true});
export const deviceSearchShape:Record<string,z.ZodType>={query:text.optional().describe('Case-insensitive substring across all exposed device fields. Named filters are combined with AND.')};
for(const [name,{kind,path}] of Object.entries(deviceSearchFields)){
 const schema=kind==='boolean'?z.boolean():kind==='number'?z.number().int().nonnegative():kind==='date'?date:text;
 deviceSearchShape[name]=schema.optional().describe(`${path}: ${kind==='text'?'case-insensitive substring':kind==='date'?'exact timestamp (ISO 8601 with timezone)':'exact match'}.`);
 if(kind==='date')for(const bound of ['after','before'])deviceSearchShape[`${name}_${bound}`]=date.optional().describe(`${path}: inclusive ${bound==='after'?'lower':'upper'} timestamp bound.`);
}
function valueAt(device:Row,path:string):unknown{return path.split('.').reduce((value:any,key)=>value?.[key],device);}
export function matchesDevice(device:Row,filters:Row):boolean{
 if(filters.query!==undefined&&![...Object.values(deviceSearchFields),{path:'siteUid'}].some(({path})=>{const value=valueAt(device,path);return value!==null&&value!==undefined&&String(value).toLowerCase().includes(filters.query.toLowerCase());}))return false;
 for(const [name,{path,kind}] of Object.entries(deviceSearchFields)){
  const value=valueAt(device,path),wanted=filters[name];
  if(wanted!==undefined){
   if(value===null||value===undefined)return false;
   if(kind==='text'){if(!String(value).toLowerCase().includes(wanted.toLowerCase()))return false;}
   else if(kind==='date'){if(Date.parse(String(value))!==Date.parse(wanted))return false;}
   else if(value!==wanted)return false;
  }
  if(kind==='date')for(const bound of ['after','before'])if(filters[`${name}_${bound}`]!==undefined){
   const actual=Date.parse(String(value)),limit=Date.parse(filters[`${name}_${bound}`]);
   if(!Number.isFinite(actual)||(bound==='after'?actual<limit:actual>limit))return false;
  }
 }
 return true;
}
