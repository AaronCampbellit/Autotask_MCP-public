import {FileHandoff} from '../packages/autotask-config/src/handoff.js';
import {environment as managedEnvironment} from '../packages/autotask-config/src/model.js';
import {APPLICATION_READ_OPERATIONS} from '../packages/autotask/src/index.js';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { METADATA_OPERATIONS, compileInventory, compileQualifications, loadMetadataSnapshot, verifyLocalSources, type MetadataOperation } from '../packages/metadata/src/index.js';
import { LocalThresholdProvider, SharedRequestBudget, requestBudgetOptionsFromEnvironment } from '../packages/autotask/src/budget.js';

export interface PreflightCheck { name:string;status:'pass'|'fail'|'warning';message:string }
export interface PreflightResult { mode:'offline';ok:boolean;checks:PreflightCheck[];network_requests:0 }
export interface PreflightOptions { projectRoot?:string;now?:number;nodeVersion?:string;checkFiles?:boolean }
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guidValue=(value:string)=>guid.test(value)&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const placeholder=(value:string)=>/replace[-_ ]?with|replace_(?:user|password)|changeme|YOUR_[A-Z_]+|<[^>]+>/i.test(value);
const bounded=(value:string,min=1,max=4096)=>Buffer.byteLength(value,'utf8')>=min&&Buffer.byteLength(value,'utf8')<=max&&!/[\0\r\n]/.test(value)&&!placeholder(value);
const key32=(value:string)=>/^[A-Za-z0-9+/]{43}=$/.test(value)&&Buffer.from(value,'base64').length===32&&Buffer.from(value,'base64').toString('base64')===value;
const publicOrigin=(value:string):URL|undefined=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'?url:undefined;}catch{return undefined;}};
const names=new Set(['AUTOTASK_CONFIG_DIRECTORY','WORKSPACE_TIMEZONE','RESOURCE_TIMEZONES','PORT','PUBLIC_URL','DATABASE_URL','MIGRATION_DATABASE_URL','ENTRA_TENANT_ID','ENTRA_AUDIENCE','ENTRA_SCOPE','AUTOTASK_BASE_URL','AUTOTASK_USERNAME','AUTOTASK_SECRET','AUTOTASK_INTEGRATION_CODE','CURSOR_SECRET','OPERATION_PAYLOAD_KEY','ARTIFACT_ENCRYPTION_KEY','ADMIN_ENTRA_CLIENT_ID','ADMIN_ENTRA_CLIENT_SECRET','ADMIN_BOOTSTRAP_IDENTITIES','METADATA_SNAPSHOT_PATH','ENABLED_AUTOTASK_OPERATIONS','SALES_ENABLED','SALES_WRITES_ENABLED','OPERATIONAL_WRITES_ENABLED','APPLICATION_SCOPED_READ_OPERATIONS','AUTOTASK_TICKET_HOSTS','JOB_WORKER_ENABLED','BUSINESS_ENABLED','BUSINESS_WRITES_ENABLED','WORK_MANAGEMENT_ENABLED','WORK_MANAGEMENT_WRITES_ENABLED','ATTACHMENTS_ENABLED','ATTACHMENTS_WRITES_ENABLED','AUTOTASK_WEBHOOK_BINDINGS','ATTACHMENT_INTERNAL_PUBLISH_LABEL']);
for(const name of ['DIAGNOSTICS_ENABLED','DIAGNOSTICS_ENCRYPTION_KEY','DIAGNOSTICS_KEYRING','DIAGNOSTICS_SPOOL_DIRECTORY','MCP_DISCOVERY_PROFILE','MCP_MRTR_ENABLED','AUTOTASK_REQUESTS_PER_WINDOW','AUTOTASK_BUDGET_WINDOW_MS','AUTOTASK_EXTERNAL_HEADROOM','AUTOTASK_THRESHOLD_MAX_AGE_MS','AUTOTASK_BUDGET_MAX_WAIT_MS','AUTOTASK_BUDGET_QUEUE_SIZE','AUTOTASK_THRESHOLD_PATH'])names.add(name);
export const REQUIRED_MIGRATIONS=['001_foundation.sql','002_workflow_intents.sql','003_control_plane.sql','004_fixed_workflows.sql','005_artifacts.sql','006_sales_intents.sql','007_ticket_create_intents.sql','008_domain_intents.sql','009_webhook_inbox.sql','010_attachment_budget.sql','011_ticket_classification_intents.sql','012_opportunity_attachments.sql','013_console_history.sql','014_rmm.sql','015_autotask_connections.sql','016_rmm_extended.sql','017_itglue.sql','018_durable_read_jobs.sql','019_diagnostics.sql'] as const;

/** Offline shape, file and evidence checks only. Values and exception text never enter the report. */
export async function runPreflight(env:Record<string,string|undefined>,options:PreflightOptions={}):Promise<PreflightResult>{
  const checks:PreflightCheck[]=[];const root=resolve(options.projectRoot??process.cwd());
  const add=(name:string,pass:boolean,message:string)=>checks.push({name,status:pass?'pass':'fail',message});
  const warn=(name:string,message:string)=>checks.push({name,status:'warning',message});
  if(env.AUTOTASK_CONFIG_DIRECTORY){
    const handoff=new FileHandoff(env.AUTOTASK_CONFIG_DIRECTORY,resolve(root,'config/metadata'),env.ENTRA_TENANT_ID??'');
    try{const manifest=await handoff.read();env=managedEnvironment(env,manifest.active.config);add('autotask_managed_configuration',true,'Published encrypted Autotask configuration loaded locally; database selection and collector health require runtime verification.');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||await handoff.initialized())add('autotask_managed_configuration',false,'Managed configuration cannot be authenticated.');else warn('autotask_managed_configuration','No managed connection has been published; existing environment configuration is required.');}
  }
  const value=(name:string)=>env[name]??'';
  const required=(name:string,validate:(value:string)=>boolean=bounded)=>{const data=value(name);const pass=data.length>0&&validate(data);add(name,pass,pass?'Configured shape is valid.':'Required configuration is missing, a placeholder, or invalid.');return pass;};
  const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(options.nodeVersion??process.version);add('node',Boolean(match&&Number(match[1])===24&&Number(match[2])>=16),'Runtime must satisfy the tested package range: Node >=24.16.0 <25.');
  add('PORT',!value('PORT')||(/^\d+$/.test(value('PORT'))&&Number(value('PORT'))>=1&&Number(value('PORT'))<=65535),'PORT must be a valid TCP port; the default is 3030.');
  const originOK=required('PUBLIC_URL',v=>bounded(v)&&Boolean(publicOrigin(v)));
  if(originOK&&publicOrigin(value('PUBLIC_URL'))!.hostname.endsWith('.invalid'))add('PUBLIC_URL.deployment_hostname',false,'A real reviewed deployment hostname is required.');
  required('ENTRA_TENANT_ID',guidValue);required('ENTRA_AUDIENCE',v=>bounded(v,1,1024)&&!/[\s]/.test(v));required('ENTRA_SCOPE',v=>bounded(v,1,200)&&/^[A-Za-z0-9._/-]+$/.test(v));
  const database=(v:string)=>{try{const url=new URL(v);return bounded(v)&&['postgres:','postgresql:'].includes(url.protocol)&&Boolean(url.username&&url.password&&url.hostname)&&url.pathname.length>1&&!url.hash;}catch{return false;}};
  const dbOK=required('DATABASE_URL',database);
  if(value('MIGRATION_DATABASE_URL')){const migrationOK=required('MIGRATION_DATABASE_URL',database);if(dbOK&&migrationOK)add('database_roles',new URL(value('DATABASE_URL')).username!==new URL(value('MIGRATION_DATABASE_URL')).username,'Runtime and migration connections must use separate database roles.');}
  else warn('MIGRATION_DATABASE_URL','Provide a separate migration-role connection for deployment; it is not needed by the running server.');
  if(dbOK){const url=new URL(value('DATABASE_URL'));if(!['postgres','localhost','127.0.0.1','::1'].includes(url.hostname)&&!['verify-full','verify-ca'].includes(url.searchParams.get('sslmode')??''))warn('DATABASE_URL.tls','External database TLS identity verification must be established before deployment.');}
  required('AUTOTASK_BASE_URL',v=>{try{const url=new URL(v);return bounded(v)&&url.protocol==='https:'&&/^webservices\d+\.autotask\.net$/i.test(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&url.pathname==='/atservicesrest/v1.0/';}catch{return false;}});
  for(const name of ['AUTOTASK_USERNAME','AUTOTASK_SECRET','AUTOTASK_INTEGRATION_CODE'])required(name,v=>bounded(v));
  required('CURSOR_SECRET',v=>bounded(v,32,1024));required('OPERATION_PAYLOAD_KEY',key32);required('ARTIFACT_ENCRYPTION_KEY',key32);
  if(key32(value('OPERATION_PAYLOAD_KEY'))&&key32(value('ARTIFACT_ENCRYPTION_KEY')))add('encryption_key_separation',value('OPERATION_PAYLOAD_KEY')!==value('ARTIFACT_ENCRYPTION_KEY'),'Workflow and artifact encryption require separate keys.');
  const adminConfigured=Boolean(value('ADMIN_ENTRA_CLIENT_ID')||value('ADMIN_ENTRA_CLIENT_SECRET'));
  if(adminConfigured){required('ADMIN_ENTRA_CLIENT_ID',guidValue);required('ADMIN_ENTRA_CLIENT_SECRET',v=>bounded(v));}
  else warn('admin_console','Admin interactive login is unavailable without the paired Entra client configuration.');
  if(value('ADMIN_BOOTSTRAP_IDENTITIES')){
    const identities=value('ADMIN_BOOTSTRAP_IDENTITIES').split(',').map(v=>v.trim());
    add('ADMIN_BOOTSTRAP_IDENTITIES',identities.length<=20&&new Set(identities.map(v=>v.toLowerCase())).size===identities.length&&identities.every(v=>{const pair=v.split(':');return pair.length===2&&guidValue(pair[0]!)&&guidValue(pair[1]!)&&pair[0]!.toLowerCase()===value('ENTRA_TENANT_ID').toLowerCase();}),'Bootstrap entries must be unique exact tenant:object GUID pairs in the configured tenant.');
  }else warn('ADMIN_BOOTSTRAP_IDENTITIES','No bootstrap identities are configured; an existing platform administrator is required to use administrative routes.');
  add('JOB_WORKER_ENABLED',!value('JOB_WORKER_ENABLED')||['true','false'].includes(value('JOB_WORKER_ENABLED')),'Use true or false; one in-process worker runs by default.');
  warn('single_instance','Use one application replica: interactive admin sessions and dispatch admission are process-local.');
  if(value('AUTOTASK_TICKET_HOSTS')){const hosts=value('AUTOTASK_TICKET_HOSTS').split(',').map(v=>v.trim());add('AUTOTASK_TICKET_HOSTS',hosts.length<=20&&new Set(hosts.map(v=>v.toLowerCase())).size===hosts.length&&hosts.every(v=>/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(v)&&!v.endsWith('.invalid')),'Ticket links require unique reviewed hostnames only, without schemes, ports, paths or credentials.');}
  else warn('AUTOTASK_TICKET_HOSTS','No ticket URL host is trusted; numeric IDs and ticket numbers remain available.');
  for(const name of ['DIAGNOSTICS_ENABLED','MCP_MRTR_ENABLED','SALES_ENABLED','SALES_WRITES_ENABLED','OPERATIONAL_WRITES_ENABLED','BUSINESS_ENABLED','BUSINESS_WRITES_ENABLED','WORK_MANAGEMENT_ENABLED','WORK_MANAGEMENT_WRITES_ENABLED','ATTACHMENTS_ENABLED','ATTACHMENTS_WRITES_ENABLED'])add(name,!value(name)||['true','false'].includes(value(name)),'Enablement flags must be true or false.');
  add('MCP_DISCOVERY_PROFILE',!value('MCP_DISCOVERY_PROFILE')||['full','technician'].includes(value('MCP_DISCOVERY_PROFILE')),'Choose the full or technician discovery profile.');
  if(value('DIAGNOSTICS_ENABLED')==='true'){
    required('DIAGNOSTICS_SPOOL_DIRECTORY',isAbsolute);
    const distinct=(key:unknown)=>typeof key==='string'&&key32(key)&&key!==value('OPERATION_PAYLOAD_KEY')&&key!==value('ARTIFACT_ENCRYPTION_KEY');
    if(value('DIAGNOSTICS_KEYRING')){let valid=false;try{const ring=JSON.parse(value('DIAGNOSTICS_KEYRING'));valid=!value('DIAGNOSTICS_ENCRYPTION_KEY')&&typeof ring.active==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(ring.active)&&ring.keys&&Object.keys(ring.keys).length<=8&&distinct(ring.keys[ring.active])&&Object.values(ring.keys).every(distinct);}catch{}add('DIAGNOSTICS_KEYRING',!!valid,'Diagnostic rotation keys must be valid and separate from workflow/artifact keys.');}
    else required('DIAGNOSTICS_ENCRYPTION_KEY',distinct);
    warn('diagnostic_deployment_acceptance','Verify persistent-volume fsync, capacity alerts, benchmark overhead and seven-day backup retention on the deployment host.');
  }
  if(value('SALES_WRITES_ENABLED')==='true')add('sales_writes_require_sales',value('SALES_ENABLED')==='true','Sales writes require sales tools.');
  for(const pack of ['WORK_MANAGEMENT','ATTACHMENTS'])if(value(`${pack}_ENABLED`)==='true')add(`${pack.toLowerCase()}_requires_operational`,value('OPERATIONAL_WRITES_ENABLED')==='true','Domain tools require operational access to validate ticket parents.');
  for(const pack of ['BUSINESS','WORK_MANAGEMENT','ATTACHMENTS'])if(value(`${pack}_WRITES_ENABLED`)==='true')add(`${pack.toLowerCase()}_writes_require_tools`,value(`${pack}_ENABLED`)==='true','Writes require the corresponding tools to be enabled.');
  const readText=value('APPLICATION_SCOPED_READ_OPERATIONS'),applicationReads=readText?readText.split(',').map(v=>v.trim()):[];
  add('APPLICATION_SCOPED_READ_OPERATIONS',new Set(applicationReads).size===applicationReads.length&&applicationReads.every(op=>APPLICATION_READ_OPERATIONS.includes(op as never)),'Only ticket/company reads may use application-enforced permissions.');
  const operationText=value('ENABLED_AUTOTASK_OPERATIONS');const operations=operationText?operationText.split(',').map(v=>v.trim()):[];
  const operationsOK=operations.every(op=>(METADATA_OPERATIONS as readonly string[]).includes(op))&&new Set(operations).size===operations.length;
  add('ENABLED_AUTOTASK_OPERATIONS',operationsOK,'Only explicit reviewed operation IDs are accepted; wildcards, duplicate IDs and empty list entries are invalid.');
  if(!operations.length&&!applicationReads.length)warn('live_operations','No live Autotask operations are enabled. Offline readiness does not establish live operation qualification.');
  try{
    const configuration=requestBudgetOptionsFromEnvironment(env,value('ENTRA_TENANT_ID'));
    if(configuration){
      const clock=()=>options.now??Date.now();const budget=new SharedRequestBudget({...configuration,clock});
      try{
        add('request_budget',true,'The explicit shared request budget has valid bounds; no default tenant allowance is inferred.');
        const path=value('AUTOTASK_THRESHOLD_PATH');const pathOK=bounded(path,1,4096)&&isAbsolute(path)&&!path.startsWith('\\\\')&&!path.startsWith('//')&&/\.json$/i.test(path);
        add('AUTOTASK_THRESHOLD_PATH',pathOK,'The budget requires an absolute local JSON capture path with its reviewed evidence tree.');
        if(pathOK){await new LocalThresholdProvider(budget,{path,evidenceRoot:root,clock}).validate();add('threshold_observation',true,'The local threshold capture, freshness and evidence hash validate without consuming a request allowance. Actual tenant pressure still requires deployment qualification.');}
      }finally{budget.close();}
    }else if(operations.length||applicationReads.length||['SALES_ENABLED','OPERATIONAL_WRITES_ENABLED','BUSINESS_ENABLED','WORK_MANAGEMENT_ENABLED','ATTACHMENTS_ENABLED'].some(name=>value(name)==='true'))add('request_budget',false,'Live enablement requires an explicit shared budget and fresh reviewed threshold evidence.');
    else warn('request_budget','No live request budget is configured. Every live Autotask request remains blocked.');
  }catch{add('request_budget',false,'The shared budget configuration or threshold evidence is incomplete, invalid, stale or unavailable.');}
  if(value('METADATA_SNAPSHOT_PATH')){
    const path=value('METADATA_SNAPSHOT_PATH');const pathOK=bounded(path,1,4096)&&isAbsolute(path)&&!path.startsWith('\\\\')&&!path.startsWith('//')&&/\.json$/i.test(path);add('METADATA_SNAPSHOT_PATH',pathOK,'Metadata must be a readable absolute local JSON file path; values are never printed.');
    if(pathOK){try{const inventory=compileInventory(JSON.parse(await readFile(resolve(root,'registry/coverage.json'),'utf8')));const snapshot=await loadMetadataSnapshot(path,{now:options.now,inventory});add('metadata_tenant',snapshot.content.tenantId.toLowerCase()===value('ENTRA_TENANT_ID').toLowerCase(),'The snapshot must bind the configured Entra tenant.');add('metadata_source',snapshot.content.source==='Autotask','Live configuration requires real tenant metadata; documentary and fixture evidence cannot initialize live providers.');const sources=await verifyLocalSources(snapshot,root);
      if(operations.length&&operationsOK){compileQualifications(snapshot,{operations:operations as MetadataOperation[],verifiedSources:sources,now:options.now});add('live_qualification_evidence',true,'Requested operation evidence and local source hashes validate offline. Native behavior remains subject to deployment qualification.');}
      else add('metadata_snapshot',true,'The snapshot schema, digest and freshness validate offline.');
    }catch{add('metadata_snapshot',false,'The metadata snapshot or required qualification evidence is missing, invalid, stale or not verified.');}}
  }else if(operations.length||applicationReads.length||['SALES_ENABLED','OPERATIONAL_WRITES_ENABLED','BUSINESS_ENABLED','WORK_MANAGEMENT_ENABLED','ATTACHMENTS_ENABLED'].some(name=>value(name)==='true'))add('METADATA_SNAPSHOT_PATH',false,'Enabled operations require a current reviewed metadata snapshot and verified source evidence.');
  else warn('METADATA_SNAPSHOT_PATH','No reviewed snapshot is configured; metadata-backed live operations remain unavailable.');
  if(options.checkFiles!==false){
    for(const file of [...REQUIRED_MIGRATIONS.map(v=>`packages/storage/migrations/${v}`),'apps/console/public/index.html','apps/console/public/admin.js','apps/console/public/admin.css','apps/console/public/result-dialog.js','apps/console/public/access-model.js','apps/console/public/console-language.js','apps/console/public/rmm.js','apps/console/public/itglue.js','apps/console/public/diagnostics.js','apps/console/public/autotask.js','playbooks/0.1.0/triage.md','playbooks/0.1.0/handoff.md','playbooks/0.1.0/resolution.md','playbooks/0.1.0/documentation.md','playbooks/0.1.0/time_review.md','registry/coverage.json']){try{add(`asset:${file}`,(await stat(resolve(root,file))).isFile(),'Required deployment asset is present.');}catch{add(`asset:${file}`,false,'Required deployment asset is missing.');}}
  }
  for(const name of Object.keys(env)){if(/^(?:AUTOTASK_|ENTRA_|ADMIN_|OPERATION_|ARTIFACT_|CURSOR_|METADATA_|ENABLED_AUTOTASK_|APPLICATION_SCOPED_|SALES_|OPERATIONAL_|BUSINESS_|WORK_MANAGEMENT_|ATTACHMENTS_|ATTACHMENT_|JOB_WORKER_)/.test(name)&&!names.has(name))add('unknown_configuration_name',false,'An unrecognized application configuration name was supplied. Check the documented variable names.');}
  return{mode:'offline',ok:checks.every(c=>c.status!=='fail'),checks,network_requests:0};
}

/** Explicit optional read-only probe. Never called by offline validation. No redirects,
 * authentication headers, response content or server error details are returned. */
export async function checkDeployedHealth(publicUrl:string,fetcher:typeof fetch=globalThis.fetch):Promise<{mode:'deployed-read-only';ok:boolean;checks:PreflightCheck[]}>{
  const origin=publicOrigin(publicUrl);if(!origin) return{mode:'deployed-read-only',ok:false,checks:[{name:'PUBLIC_URL',status:'fail',message:'A reviewed HTTPS origin is required.'}]};
  const checks:PreflightCheck[]=[];
  for(const endpoint of ['live','ready']){let passed=false;try{const response=await fetcher(new URL(`/health/${endpoint}`,origin),{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{accept:'application/json'}});if(response.status===200&&Number(response.headers.get('content-length')??0)<=1024&&response.body){const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1024){await reader.cancel();break;}chunks.push(chunk.value);}if(bytes<=1024)passed=JSON.parse(Buffer.concat(chunks).toString('utf8')).status===endpoint;}finally{reader.releaseLock();}}else await response.body?.cancel();}catch{/* Keep remote details and configured values out of output. */}checks.push({name:`health.${endpoint}`,status:passed?'pass':'fail',message:passed?'Minimal health response is valid.':'Health endpoint failed its bounded read-only check.'});}
  return{mode:'deployed-read-only',ok:checks.every(c=>c.status==='pass'),checks};
}
async function main(){const args=process.argv.slice(2);if(args.some(arg=>!['--health','--json'].includes(arg))) {process.stderr.write('Usage: preflight.ts [--json] [--health]\n');process.exitCode=2;return;}
  const offline=await runPreflight(process.env);const remote=args.includes('--health')&&offline.ok?await checkDeployedHealth(process.env.PUBLIC_URL!):undefined;
  const report={...offline,...(remote?{deployed_health:remote}:{})};
  if(args.includes('--json'))process.stdout.write(`${JSON.stringify(report,null,2)}\n`);else{for(const check of [...offline.checks,...(remote?.checks??[])])process.stdout.write(`${check.status.toUpperCase()} ${check.name}: ${check.message}\n`);process.stdout.write('Offline checks do not deploy, validate credentials, or establish technician-pilot readiness.\n');}
  if(!offline.ok||remote?.ok===false)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(()=>{process.stderr.write('Preflight could not complete. No configuration values were logged.\n');process.exitCode=1;});
