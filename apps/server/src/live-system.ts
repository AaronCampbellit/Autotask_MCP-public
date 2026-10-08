import {DiagnosticCipher} from '../../../packages/diagnostics/src/contracts.js';
import {PostgresDiagnosticStore} from '../../../packages/diagnostics/src/store.js';
import {DiagnosticSpool} from '../../../packages/diagnostics/src/spool.js';
import {DurableDiagnostics} from '../../../packages/diagnostics/src/service.js';
import {SERVER_RELEASE} from './publication.js';
import {isAbsolute} from 'node:path';
import {CompanySelection} from '../../../packages/read-selection/src/index.js';
import {ReadSelectionContinuation,PostgresSelectionReplayStore} from '../../../packages/durable-read-jobs/src/interactive.js';
import {PostgresReadJobStore} from '../../../packages/durable-read-jobs/src/store.js';
import {createReadReports} from './read-reports.js';
import {ItGlueService} from '../../../packages/itglue/src/service.js';
import {ItGlueClient} from '../../../packages/itglue/src/client.js';
import {PostgresItGlueStore} from '../../../packages/itglue/src/store.js';
import {randomUUID} from 'node:crypto';
import {AutotaskConfiguration} from '../../../packages/autotask-config/src/service.js';
import {PostgresStore as AutotaskConfigStore} from '../../../packages/autotask-config/src/store.js';
import {FileHandoff} from '../../../packages/autotask-config/src/handoff.js';
import {environment as configurationEnvironment,fromEnvironment,type Config} from '../../../packages/autotask-config/src/model.js';
import {RmmService} from '../../../packages/rmm/src/service.js';
import {RmmClient} from '../../../packages/rmm/src/client.js';
import {PostgresRmmStore} from '../../../packages/rmm/src/store.js';
import {EntraDirectory,AutotaskDirectory} from '../../../packages/onboarding/src/index.js';
import {OpportunityAttachmentService} from '../../../packages/attachments/src/opportunity.js';
import {HttpOpportunityAttachmentPort} from '../../../packages/attachments/src/opportunity-http.js';
import {ChecklistService,HttpChecklistPort,CHECKLIST_NATIVE_OPERATIONS} from '../../../packages/checklists/src/index.js';
import {WorkManagementService,HttpWorkManagementPort,WORK_MANAGEMENT_NATIVE_OPERATIONS} from '../../../packages/work-management/src/index.js';
import {WorkManagementMetadata} from '../../../packages/work-management/src/metadata.js';
import {TicketAttachmentService,HttpTicketAttachmentPort} from '../../../packages/attachments/src/index.js';
import {PostgresAttachmentByteBudget} from '../../../packages/attachments/src/byte-budget.js';
import {BusinessService} from '../../../packages/business/src/index.js';
import {WebhookInbox} from '../../../packages/sync/src/index.js';
import {TicketCreation} from '../../../packages/operational/src/ticket-create.js';
import { OperationalMetadata } from '../../../packages/operational/src/metadata.js';
import {SalesService} from '../../../packages/sales/src/index.js';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { AppError, type PrincipalStore } from '../../../packages/contracts/src/index.js';
import { authenticateToken } from '../../../packages/identity/src/index.js';
import { AdminSessions } from '../../../packages/identity/src/admin-session.js';
import { reauthorize } from '../../../packages/policy/src/index.js';
import { HttpAutotaskAdapter, APPLICATION_READ_OPERATIONS, type AutotaskOperation } from '../../../packages/autotask/src/index.js';
import { HttpTechnicianTransport } from '../../../packages/autotask/src/technician-transport.js';
import { IntentCipher, PostgresJournal } from '../../../packages/storage/src/index.js';
import { ControlPlaneService, type ControlPlaneStore } from '../../../packages/control-plane/src/index.js';
import { PostgresControlPlaneStore } from '../../../packages/control-plane/src/postgres.js';
import { ExecutionControls } from '../../../packages/control-plane/src/execution.js';
import { TicketWorkflows } from '../../../packages/workflows/src/index.js';
import { TicketWriteWorkflows } from '../../../packages/workflows/src/write-workflows.js';
import { TicketSecondaryResourceWorkflows } from '../../../packages/workflows/src/secondary-resources.js';
import { TicketTagWorkflows } from '../../../packages/workflows/src/ticket-tags.js';
import { TicketChecklistLibraryWorkflows } from '../../../packages/workflows/src/ticket-checklist-libraries.js';
import { TechnicianWorkflows } from '../../../packages/workflows/src/technician-workflows.js';
import { TechnicianDomain } from '../../../packages/technician/src/index.js';
import { HttpTechnicianPort, type TechnicianOperation } from '../../../packages/technician/src/http.js';
import { SchedulingWorkflows } from '../../../packages/scheduling/src/index.js';
import { HttpSchedulingPort, type SchedulingOperation } from '../../../packages/scheduling/src/http.js';
import { PlaybookService } from '../../../packages/playbooks/src/index.js';
import { compileInventory, compileQualifications, loadMetadataSnapshot, RefreshingMetadataSnapshotProvider, METADATA_OPERATIONS, verifyLocalSources, type MetadataOperation } from '../../../packages/metadata/src/index.js';
import { createApplication } from './app.js';
import { createAdminRoutes } from './admin.js';
import { ToolRuntime, operationCatalog } from './tool-runtime.js';
import { JobWorker } from './job-worker.js';
import { ArtifactService, PostgresArtifactCatalog } from '../../../packages/artifacts/src/index.js';
import { ClosedRequestBudget, SharedRequestBudget, LocalThresholdProvider, requestBudgetOptionsFromEnvironment } from '../../../packages/autotask/src/budget.js';

const coreOperations:AutotaskOperation[]=['Tickets.query','Tickets.get','TicketNotes.query','TicketNotes.create','TicketNotes.get','TimeEntries.query','TimeEntries.create','TimeEntries.get','Companies.query','Companies.get','Tickets.patch'];
const technicianOperations:TechnicianOperation[]=['references.resolve','metadata.resolve','Tickets.patch.expanded','TicketHistory.query','TicketChecklistItems.query','ConfigurationItems.get','Contacts.get','CompanyLocations.get','Tasks.query','Tasks.get','Projects.get','TimeEntries.query.own'];
const schedulingOperations:SchedulingOperation[]=['Resources.query','ServiceCalls.metadata','ServiceCalls.query','ServiceCalls.get','ServiceCalls.create','ServiceCalls.update','ServiceCalls.cancel','ServiceCallTickets.query','ServiceCallTickets.get','ServiceCallTickets.create','ServiceCallTicketResources.query','ServiceCallTicketResources.get','ServiceCallTicketResources.create'];
export async function createLiveSystem(pool:Pool,env:NodeJS.ProcessEnv=process.env,configurationOptions:{override?:Config;reloadAvailable?:boolean;recoveryOnly?:boolean}={}){
  const required=(name:string)=>{const value=env[name];if(!value)throw new Error(`Required environment variable missing: ${name}`);return value;};
  const publicUrl=required('PUBLIC_URL');if(new URL(publicUrl).protocol!=='https:')throw new Error('PUBLIC_URL must use HTTPS for Entra mode.');
  const tenantId=required('ENTRA_TENANT_ID'),audience=required('ENTRA_AUDIENCE'),scope=required('ENTRA_SCOPE'),payloadKey=required('OPERATION_PAYLOAD_KEY');
  if(!/^[A-Za-z0-9+/]{43}=$/.test(payloadKey))throw new Error('OPERATION_PAYLOAD_KEY must be a base64-encoded 32-byte key.');
  const cipher=new IntentCipher(Buffer.from(payloadKey,'base64'));
  const bootstrap=(env.ADMIN_BOOTSTRAP_IDENTITIES??'').split(',').map(v=>v.trim()).filter(Boolean);
  if(bootstrap.some(v=>!v.startsWith(`${tenantId}:`)||!/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(v)))throw new Error('ADMIN_BOOTSTRAP_IDENTITIES must contain exact tenant:object GUID pairs in this tenant.');
  const configurationStore=new AutotaskConfigStore(pool,cipher);
  const configurationTable=await pool.query<{name:string|null}>("SELECT to_regclass('public.autotask_connections')::text AS name");
  const savedConfiguration=configurationOptions.override?undefined:configurationTable.rows[0]?.name?await configurationStore.load(tenantId):undefined;
  if(configurationOptions.override)env=configurationEnvironment(env,configurationOptions.override);
  else if(savedConfiguration)env=configurationEnvironment(env,savedConfiguration.active.config);
  let collectorConfiguration:unknown;
  try{collectorConfiguration=JSON.parse(await readFile('config/metadata/collector.json','utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Collector configuration is invalid.');}
  const loadedConfiguration=savedConfiguration?.active??{id:randomUUID(),createdAt:new Date().toISOString(),config:fromEnvironment(env,collectorConfiguration)};
  const configurationHandoff=env.AUTOTASK_CONFIG_DIRECTORY?new FileHandoff(env.AUTOTASK_CONFIG_DIRECTORY,'config/metadata',tenantId):undefined;
  if(configurationOptions.recoveryOnly){
    env={...env,METADATA_SNAPSHOT_PATH:'',ENABLED_AUTOTASK_OPERATIONS:'',APPLICATION_SCOPED_READ_OPERATIONS:'',OPERATIONAL_WRITES_ENABLED:'false',SALES_ENABLED:'false',SALES_WRITES_ENABLED:'false',BUSINESS_ENABLED:'false',BUSINESS_WRITES_ENABLED:'false',WORK_MANAGEMENT_ENABLED:'false',WORK_MANAGEMENT_WRITES_ENABLED:'false',ATTACHMENTS_ENABLED:'false',ATTACHMENTS_WRITES_ENABLED:'false',AUTOTASK_WEBHOOK_BINDINGS:''};
  }
  const requested=(env.ENABLED_AUTOTASK_OPERATIONS??'').split(',').map(v=>v.trim()).filter(Boolean);
  if(new Set(requested).size!==requested.length||requested.some(v=>!METADATA_OPERATIONS.includes(v as MetadataOperation)))throw new Error('ENABLED_AUTOTASK_OPERATIONS contains duplicate or unknown operation names.');
  if(requested.length&&!env.METADATA_SNAPSHOT_PATH)throw new Error('Explicit operation enablement requires a reviewed metadata snapshot.');
  const applicationReads=(env.APPLICATION_SCOPED_READ_OPERATIONS??'').split(',').map(v=>v.trim()).filter(Boolean);
  if(new Set(applicationReads).size!==applicationReads.length||applicationReads.some(op=>!APPLICATION_READ_OPERATIONS.includes(op as never)))throw new Error('Application-scoped reads accept only explicit ticket/company read operations.');
  if(applicationReads.length&&!env.METADATA_SNAPSHOT_PATH)throw new Error('Application-scoped reads require fresh resource evidence.');
  const budgetOptions=requestBudgetOptionsFromEnvironment(env,tenantId);
  if(Boolean(budgetOptions)!==Boolean(env.AUTOTASK_THRESHOLD_PATH))throw new Error('Configure both a reviewed request budget and AUTOTASK_THRESHOLD_PATH.');
  if((requested.length||applicationReads.length)&&!budgetOptions)throw new Error('Enabled Autotask operations require a reviewed shared request budget.');
  const underlyingBudget=budgetOptions?new LocalThresholdProvider(new SharedRequestBudget(budgetOptions),{path:env.AUTOTASK_THRESHOLD_PATH!,evidenceRoot:process.cwd()}):new ClosedRequestBudget();
  const requestBudget=underlyingBudget;
  const providerBudget={status:()=>requestBudget.status(),take:async(request:import('../../../packages/autotask/src/budget.js').BudgetRequest)=>{
    if(configurationHandoff&&configurationTable.rows[0]?.name&&await configurationStore.load(tenantId)){const applied=await configurationHandoff.applied();if(applied?.revision!==loadedConfiguration.id||!Number.isFinite(Date.parse(applied.at))||Date.parse(applied.at)>Date.now()||Date.now()-Date.parse(applied.at)>240000)throw new AppError('dependency_unavailable','The collector has not verified the active connection revision.');}
    await requestBudget.take(request);
  }};
  let provider:RefreshingMetadataSnapshotProvider|undefined;
  let qualifications:ReturnType<typeof compileQualifications>=[];
  if(env.METADATA_SNAPSHOT_PATH){const inventory=compileInventory(JSON.parse(await readFile('registry/coverage.json','utf8'))),snapshot=await loadMetadataSnapshot(env.METADATA_SNAPSHOT_PATH,{inventory}),verifiedSources=await verifyLocalSources(snapshot,process.cwd());provider=new RefreshingMetadataSnapshotProvider(snapshot,{tenantId,source:'Autotask',inventory,verifiedSources,snapshotPath:env.METADATA_SNAPSHOT_PATH,workspaceRoot:process.cwd(),allowReadOnlyRenewal:applicationReads.length>0&&requested.length===0});qualifications=compileQualifications(snapshot,{operations:requested as MetadataOperation[],verifiedSources});}
  const directoryAutotask=new AutotaskDirectory({tenantId,baseUrl:required('AUTOTASK_BASE_URL'),username:required('AUTOTASK_USERNAME'),secret:required('AUTOTASK_SECRET'),integrationCode:required('AUTOTASK_INTEGRATION_CODE'),budget:providerBudget});
  const directoryEntra=env.ADMIN_ENTRA_CLIENT_ID&&env.ADMIN_ENTRA_CLIENT_SECRET?new EntraDirectory({tenantId,clientId:env.ADMIN_ENTRA_CLIENT_ID,clientSecret:env.ADMIN_ENTRA_CLIENT_SECRET}):undefined;
  const rawControlStore=new PostgresControlPlaneStore(pool);
  // Preserve the original evidence timestamp; reading never renews identity proof.
  const controlStore:ControlPlaneStore=new Proxy(rawControlStore,{get(target,key){if(key==='getMember')return async(actor:{tenantId:string;objectId:string})=>{const p=await target.getMember(actor);if(p&&provider){const evidence=await provider.getResourceVerification(p.tenantId,p.resourceId);return directoryAutotask.scope({...p,resourceVerifiedAt:evidence?.verifiedAt??'1970-01-01T00:00:00.000Z'});}return p?.allCompanies?directoryAutotask.scope(p):p;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const control=new ControlPlaneService(controlStore,{bootstrapIdentityKeys:bootstrap,cipher,operations:operationCatalog,
    ...(provider?{verifyResource:async(tid:string,id:number)=>{const proof=await provider!.getResourceVerification(tid,id);return proof?{verifiedAt:proof.verifiedAt}:false;}}:{}),
    safeConfig:{applicationReadOperations:applicationReads,mode:'live',liveQualified:qualifications.length>0,databaseConfigured:true,intentKeyConfigured:true,secretReferences:{autotask_secret:savedConfiguration?'vault:autotask/active':'env:AUTOTASK_SECRET',database:'env:DATABASE_URL',intent_key:'env:OPERATION_PAYLOAD_KEY'}}});
  const autotaskConfiguration=new AutotaskConfiguration(configurationStore,tenantId,loadedConfiguration,{
    handoff:configurationHandoff,recoveryMode:configurationOptions.recoveryOnly,reloadAvailable:configurationOptions.reloadAvailable,
    authorize:async actor=>{
      if(bootstrap.includes(`${actor.tenantId}:${actor.objectId}`))return;
      const member=await rawControlStore.getMember(actor);
      if(!member?.active||!member.capabilities.includes('platform.manage'))throw new AppError('forbidden','Platform administration is required.');
    },

  });
  const execution=new ExecutionControls(control),baseStore:PrincipalStore={get:(tid,oid)=>controlStore.getMember({tenantId:tid,objectId:oid})},store=execution.principalStore(baseStore),revalidatePrincipal=(p:Parameters<typeof reauthorize>[0])=>reauthorize(p,store);
  const http={baseUrl:required('AUTOTASK_BASE_URL'),username:required('AUTOTASK_USERNAME'),secret:required('AUTOTASK_SECRET'),integrationCode:required('AUTOTASK_INTEGRATION_CODE'),revalidatePrincipal,requestBudget:providerBudget};
  if(env.OPERATIONAL_WRITES_ENABLED&&!['true','false'].includes(env.OPERATIONAL_WRITES_ENABLED))throw new Error('Invalid operational enablement flag.');
  const operationalEnabled=env.OPERATIONAL_WRITES_ENABLED==='true';
  if(operationalEnabled&&(!provider||!budgetOptions||!applicationReads.includes('Tickets.get')))throw new Error('Operational writes require resource evidence, application reads and a request budget.');
  const operational=operationalEnabled?new OperationalMetadata({...http,tenantId,principals:store}):undefined;
  const adapter=new HttpAutotaskAdapter({...http,identityFreshnessMs:240000,...(applicationReads.length?{applicationReads:{tenantId,operations:applicationReads}}:{}),...(operational?{applicationWrites:{tenantId,operations:['Tickets.create','Tickets.patch','TicketNotes.create','TimeEntries.create','TimeEntries.get','TicketSecondaryResources.create','TicketSecondaryResources.get','TicketSecondaryResources.delete','TicketTagAssociations.create','TicketTagAssociations.delete','TicketChecklistLibraries.create']}}:{}),cursorSecret:required('CURSOR_SECRET'),qualifications:qualifications.filter((q):q is typeof q&{operation:AutotaskOperation}=>coreOperations.includes(q.operation as AutotaskOperation)),resolveTicketWorkMetadata:operational?.resolveTicketWork??provider?.resolveTicketWork,validateTicketTimeEligibility:operational?.validateTicketTimeEligibility??provider?.validateTicketTimeEligibility});
  const core=new TicketWorkflows(adapter,store,new PostgresJournal(pool)),writes=new TicketWriteWorkflows(core,cipher);
  const domain=new TechnicianDomain(new HttpTechnicianPort(adapter,store,{baseUrl:http.baseUrl,cursorCipher:cipher,transport:new HttpTechnicianTransport({...http,identityFreshnessMs:240000}),...(operational?{applicationOperations:{tenantId,operations:technicianOperations}}:{}),qualifications:qualifications.filter((q):q is typeof q&{operation:TechnicianOperation}=>technicianOperations.includes(q.operation as TechnicianOperation)),resolveTicketFields:operational?.resolveTicketFields,resolveWorkType:operational?.resolveWorkType,resolveIssuePair:operational?.resolveIssuePair,validateClassification:operational?.validateClassification,assertOpportunity:operational?.assertOpportunity,resolveContact:operational?.resolveContact,resolveMetadata:operational?.resolveTechnicianMetadata??provider?.resolveTechnicianMetadata,resolveCatalog:operational?.resolveCatalog??provider?.resolveCatalog}),store,{ticketHosts:(env.AUTOTASK_TICKET_HOSTS??'').split(',').map(v=>v.trim()).filter(Boolean)});
  const scheduling=new SchedulingWorkflows(core,new HttpSchedulingPort(adapter,{...http,identityFreshnessMs:240000,...(operational?{applicationOperations:{tenantId,operations:schedulingOperations}}:{}),qualifications:qualifications.filter((q):q is typeof q&{operation:SchedulingOperation}=>schedulingOperations.includes(q.operation as SchedulingOperation)).map(q=>({...q,resourceIds:[...q.resourceIds],testIds:[...q.testIds]})),resolveMetadata:operational?.resolveSchedulingMetadata??provider?.resolveSchedulingMetadata,resolveResources:operational?.resolveResources??provider?.resolveResources}),cipher);
  const artifactKey=required('ARTIFACT_ENCRYPTION_KEY');if(!/^[A-Za-z0-9+/]{43}=$/.test(artifactKey)||artifactKey===payloadKey)throw new Error('ARTIFACT_ENCRYPTION_KEY requires a separate base64-encoded 32-byte key.');
  const artifacts=new ArtifactService(core,{projectRoot:process.cwd(),encryptionKey:Buffer.from(artifactKey,'base64'),catalog:new PostgresArtifactCatalog(pool),resolveOpportunity:async(p,id)=>{if(!sales)throw new AppError('unsupported_operation','Sales tools are not configured.');return (await sales.get(p,'Opportunities',{id})).data as import('../../../packages/contracts/src/index.js').DataRecord;}});
  if(env.SALES_ENABLED&&!['true','false'].includes(env.SALES_ENABLED)||env.SALES_WRITES_ENABLED&&!['true','false'].includes(env.SALES_WRITES_ENABLED))throw new Error('Invalid sales enablement flag.');
  if(env.SALES_WRITES_ENABLED==='true'&&env.SALES_ENABLED!=='true')throw new Error('Sales writes require sales tools.');
  if(env.SALES_ENABLED==='true'&&(!provider||!budgetOptions))throw new Error('Sales requires resource evidence and a request budget.');
  const sales=env.SALES_ENABLED==='true'?new SalesService(core,cipher,{...http,tenantId,writesEnabled:env.SALES_WRITES_ENABLED==='true'}):undefined;
  for(const flag of ['BUSINESS_ENABLED','BUSINESS_WRITES_ENABLED'])if(env[flag]&&!['true','false'].includes(env[flag]!))throw new Error('Invalid business enablement flag.');
  if(env.BUSINESS_WRITES_ENABLED==='true'&&env.BUSINESS_ENABLED!=='true')throw new Error('Business writes require business tools.');
  if(env.BUSINESS_ENABLED==='true'&&(!provider||!budgetOptions))throw new Error('Business tools require resource evidence and request budget.');
  const business=env.BUSINESS_ENABLED==='true'?new BusinessService(core,cipher,{...http,tenantId,writesEnabled:env.BUSINESS_WRITES_ENABLED==='true'}):undefined;
  for(const pack of ['WORK_MANAGEMENT','ATTACHMENTS']){
    for(const suffix of ['_ENABLED','_WRITES_ENABLED'])if(env[pack+suffix]&&!['true','false'].includes(env[pack+suffix]!))throw new Error('Invalid domain enablement flag.');
    if(env[pack+'_WRITES_ENABLED']==='true'&&env[pack+'_ENABLED']!=='true')throw new Error('Domain writes require corresponding tools.');
    if(env[pack+'_ENABLED']==='true'&&(!provider||!budgetOptions||!operational))throw new Error('Domain tools require operational access, resource evidence and request budget.');
  }
  const workMetadata=env.WORK_MANAGEMENT_ENABLED==='true'?new WorkManagementMetadata({...http,tenantId,principals:store}):undefined;
  const workManagement=workMetadata?new WorkManagementService(core,new HttpWorkManagementPort({...http,cursorCipher:cipher,writesEnabled:env.WORK_MANAGEMENT_WRITES_ENABLED==='true',applicationOperations:{tenantId,operations:WORK_MANAGEMENT_NATIVE_OPERATIONS}}),cipher,workMetadata.callbacks()):undefined;
  const checklists=operational?new ChecklistService(core,new HttpChecklistPort({...http,writesEnabled:operationalEnabled,applicationOperations:{tenantId,operations:CHECKLIST_NATIVE_OPERATIONS}}),cipher):undefined;
  const attachmentPort=env.ATTACHMENTS_ENABLED==='true'?new HttpTicketAttachmentPort({...http,principals:store,writesEnabled:env.ATTACHMENTS_WRITES_ENABLED==='true',publishInternalLabel:env.ATTACHMENT_INTERNAL_PUBLISH_LABEL,applicationOperations:{tenantId,operations:['TicketAttachments.query','TicketAttachments.get','TicketAttachments.create','TicketAttachments.delete','TicketAttachments.fields']}}):undefined;
  const opportunityPort=attachmentPort&&sales?new HttpOpportunityAttachmentPort({...http,principals:store,writesEnabled:env.ATTACHMENTS_WRITES_ENABLED==='true'&&env.SALES_WRITES_ENABLED==='true',publishInternalLabel:env.ATTACHMENT_INTERNAL_PUBLISH_LABEL,applicationOperations:{tenantId,operations:['OpportunityAttachments.query','OpportunityAttachments.get','OpportunityAttachments.create','OpportunityAttachments.delete','OpportunityAttachments.fields']}}):undefined;
  const opportunityAttachments=opportunityPort&&sales?new OpportunityAttachmentService(core,opportunityPort,artifacts,cipher,{resolveOpportunity:async(p,id)=>(await sales.get(p,'Opportunities',{id})).data as import('../../../packages/contracts/src/index.js').DataRecord,resolvePublishInternal:p=>opportunityPort.resolvePublishInternal(p),byteBudget:new PostgresAttachmentByteBudget(pool)}):undefined;
  const attachments=attachmentPort?new TicketAttachmentService(core,attachmentPort,artifacts,cipher,{resolvePublishInternal:p=>attachmentPort.resolvePublishInternal(p),byteBudget:new PostgresAttachmentByteBudget(pool)}):undefined;
  // Explicit operator configuration only. The LAN deployment does not create cloud subscriptions.
  let webhookInbox:WebhookInbox|undefined;
  if(env.AUTOTASK_WEBHOOK_BINDINGS){let bindings:any;try{bindings=JSON.parse(env.AUTOTASK_WEBHOOK_BINDINGS);}catch{throw new Error('Invalid webhook bindings configuration.');}if(!Array.isArray(bindings)||bindings.length>10||bindings.some(b=>b.tenantId!==tenantId))throw new Error('Invalid webhook tenant bindings.');webhookInbox=new WebhookInbox(pool,bindings);}
  if(env.DIAGNOSTICS_ENABLED&&!['true','false'].includes(env.DIAGNOSTICS_ENABLED))throw new Error('Invalid DIAGNOSTICS_ENABLED.');
  let diagnostics:DurableDiagnostics|undefined,diagnosticsPool:Pool|undefined;
  if(env.DIAGNOSTICS_ENABLED==='true'){
    const directory=required('DIAGNOSTICS_SPOOL_DIRECTORY');
    if(!isAbsolute(directory))throw new Error('DIAGNOSTICS_SPOOL_DIRECTORY must be an absolute persistent-volume path.');
    let diagnosticCipher:DiagnosticCipher;
    const validKey=(key:unknown):key is string=>typeof key==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(key)&&key!==payloadKey&&key!==artifactKey;
    if(env.DIAGNOSTICS_KEYRING){
      if(env.DIAGNOSTICS_ENCRYPTION_KEY)throw new Error('Configure DIAGNOSTICS_KEYRING or DIAGNOSTICS_ENCRYPTION_KEY, not both.');
      try{const ring=JSON.parse(env.DIAGNOSTICS_KEYRING);if(typeof ring.active!=='string'||!ring.keys||typeof ring.keys!=='object'||Object.keys(ring.keys).length>8||!Object.values(ring.keys).every(validKey))throw Error();diagnosticCipher=new DiagnosticCipher({active:ring.active,keys:Object.fromEntries(Object.entries(ring.keys).map(([id,key])=>[id,Buffer.from(key as string,'base64')]))});}catch{throw new Error('DIAGNOSTICS_KEYRING requires an active key ID and up to eight distinct-purpose base64 32-byte keys.');}
    }else{const key=required('DIAGNOSTICS_ENCRYPTION_KEY');if(!validKey(key))throw new Error('DIAGNOSTICS_ENCRYPTION_KEY requires a distinct base64-encoded 32-byte key.');diagnosticCipher=new DiagnosticCipher(Buffer.from(key,'base64'));}
    diagnosticsPool=new Pool({connectionString:required('DATABASE_URL'),max:4,connectionTimeoutMillis:2000,query_timeout:2000,statement_timeout:2000});
    diagnostics=new DurableDiagnostics(new PostgresDiagnosticStore(diagnosticsPool,diagnosticCipher),new DiagnosticSpool(directory,diagnosticCipher),{instanceId:randomUUID(),serverRelease:SERVER_RELEASE,principals:baseStore,cipher:diagnosticCipher});
    try{await diagnostics.initialize();}catch(error){await diagnosticsPool.end();throw error;}
  }
  const itglue=new ItGlueService(new PostgresItGlueStore(pool,cipher),new ItGlueClient(),store,cipher);
  itglue.artifacts=artifacts;
  const rmm=new RmmService(new PostgresRmmStore(pool,cipher),new RmmClient(),store,cipher,async p=>{await control.snapshot(p);});
  const selection=new CompanySelection(new ReadSelectionContinuation(cipher,new PostgresSelectionReplayStore(pool)),baseStore,(p,name,args)=>runtime.invoke(p,name,args),{mrtrEnabled:env.MCP_MRTR_ENABLED==="true"});
  const {reports,readWorker}=createReadReports(new PostgresReadJobStore(pool),cipher,baseStore,()=>runtime);
  const technician=new TechnicianWorkflows(core,writes,domain,scheduling,cipher,Date.now,{defaultTimezone:env.WORKSPACE_TIMEZONE||undefined,resourceTimezones:env.RESOURCE_TIMEZONES?JSON.parse(env.RESOURCE_TIMEZONES):{}}),secondaryResources=operational?new TicketSecondaryResourceWorkflows(core,operational.resolveTicketSecondaryResourceOptions,technician):undefined,ticketTags=operational?new TicketTagWorkflows(core,operational.resolveTicketTagOptions):undefined,ticketChecklistLibraries=operational?new TicketChecklistLibraryWorkflows(core,operational.resolveTicketChecklistLibraryOptions):undefined,runtime=new ToolRuntime({diagnostics,discoveryProfile:env.MCP_DISCOVERY_PROFILE as 'full'|'technician'|undefined,selection,reports,discoveryCipher:cipher,itglue,rmm,core,writes,technician,scheduling,control,execution,playbooks:new PlaybookService(store),artifacts,sales,business,workManagement,workMetadata,attachments,opportunityAttachments,checklists,webhookInbox,operational,secondaryResources,ticketTags,ticketChecklistLibraries,ticketCreation:operational?new TicketCreation(core,adapter,operational,cipher):undefined});
  if(Boolean(env.ADMIN_ENTRA_CLIENT_ID)!==Boolean(env.ADMIN_ENTRA_CLIENT_SECRET))throw new Error('Both console Entra client settings must be configured together.');
  const sessions=new AdminSessions({publicUrl,...(env.ADMIN_ENTRA_CLIENT_ID?{entra:{tenantId,clientId:env.ADMIN_ENTRA_CLIENT_ID,clientSecret:required('ADMIN_ENTRA_CLIENT_SECRET')}}:{})});
  const admin=createAdminRoutes({autotaskConfiguration,publicUrl,sessions,control,...(directoryEntra?{onboarding:{entra:directoryEntra,autotask:directoryAutotask}}:{}),operations:operationCatalog,runtime,principal:async actor=>{const p=await baseStore.get(actor.tenantId,actor.objectId);if(!p)throw new AppError('identity_mapping_invalid','Employee mapping unavailable.');return revalidatePrincipal(p);},recover:(p,action,id)=>execution.run(p,[action==='resume'?'at_operation_resume':'at_operation_reconcile'],()=>runtime.recover(p,action,id))});
  if(env.MCP_DISCOVERY_PROFILE&&!['full','technician'].includes(env.MCP_DISCOVERY_PROFILE))throw new Error('Invalid MCP_DISCOVERY_PROFILE.');
  const app=createApplication({diagnostics,onClose:async()=>{await diagnosticsPool?.end();},mrtrEnabled:env.MCP_MRTR_ENABLED==='true',discoveryProfile:env.MCP_DISCOVERY_PROFILE as 'full'|'technician'|undefined,...(webhookInbox?{webhookReceiver:(request:Request)=>webhookInbox!.receive(request)}:{}),publicUrl,entraTenantId:tenantId,audienceScope:`${new URL('/mcp',publicUrl).href}/${scope}`,authenticate:token=>{if(configurationOptions.recoveryOnly)throw new AppError('dependency_unavailable','Autotask configuration recovery is in progress.');return authenticateToken(token,{tenantId,audience,requiredScopes:[scope]},store);},workflows:core,writes,runtime,admin,
    ready:async()=>{if(configurationOptions.recoveryOnly)return false;const result=await pool.query<{version:string}>('SELECT version FROM schema_migrations');return['001_foundation','002_workflow_intents','003_control_plane','004_fixed_workflows','005_artifacts','006_sales_intents','007_ticket_create_intents','008_domain_intents','009_webhook_inbox','010_attachment_budget','011_ticket_classification_intents','012_opportunity_attachments','013_console_history','014_rmm','015_autotask_connections','016_rmm_extended','017_itglue','018_durable_read_jobs','019_diagnostics'].every(v=>result.rows.some(row=>row.version===v));}});
  diagnostics?.startWorker();
  return{app,worker:new JobWorker(runtime,Date.now,readWorker),runtime,control,qualifications,requestBudget,autotaskConfiguration,recoveryMode:!!configurationOptions.recoveryOnly};
}
