import {checkServiceContracts} from './output-contract-assertions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessService, businessEntities, fields} from '../packages/business/src/index.js';
import {documentedCreateOnlyFields} from '../packages/business/src/contracts.js';
import {businessTools,businessOperations} from '../packages/business/src/tools.js';
import {IntentCipher,MemoryJournal,MemoryPrincipalStore} from '../packages/storage/src/index.js';
import {FixtureAutotaskAdapter,fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {TicketWorkflows} from '../packages/workflows/src/index.js';
import {FixtureUnlimitedRequestBudget, type RequestBudgetPort} from '../packages/autotask/src/budget.js';
import {reauthorize} from '../packages/policy/src/index.js';
import type {Principal} from '../packages/contracts/src/index.js';

const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
// Independent native model snapshot from work/docker/business-native-models.json.
const capturedNative:{Contracts:string[];Projects:string[];ConfigurationItems:string[];PurchaseOrders:string[];Invoices:string[]}={
  Contracts:['id','billingPreference','billToCompanyContactID','billToCompanyID','companyID','contactID','contactName','contractCategory','contractExclusionSetID','contractName','contractNumber','contractPeriodType','contractType','description','endDate','estimatedCost','estimatedHours','estimatedRevenue','exclusionContractID','internalCurrencyOverageBillingRate','internalCurrencySetupFee','isCompliant','isDefaultContract','lastModifiedDateTime','opportunityID','organizationalLevelAssociationID','overageBillingRate','purchaseOrderNumber','renewedContractID','serviceLevelAgreementID','setupFee','setupFeeBillingCodeID','startDate','status','timeReportingRequiresStartAndStopTimes','userDefinedFields'],
  Projects:['id','actualBilledHours','actualHours','changeOrdersBudget','changeOrdersRevenue','companyID','companyOwnerResourceID','completedDateTime','completedPercentage','contractID','createDateTime','creatorResourceID','department','description','duration','endDateTime','estimatedSalesCost','estimatedTime','extProjectNumber','extProjectType','impersonatorCreatorResourceID','laborEstimatedCosts','laborEstimatedMarginPercentage','laborEstimatedRevenue','lastActivityDateTime','lastActivityPersonType','lastActivityResourceID','opportunityID','organizationalLevelAssociationID','originalEstimatedRevenue','projectCostEstimatedMarginPercentage','projectCostsBudget','projectCostsRevenue','projectLeadResourceID','projectName','projectNumber','projectType','purchaseOrderNumber','sgda','startDateTime','status','statusDateTime','statusDetail','userDefinedFields'],
  ConfigurationItems:['id','apiVendorID','configurationItemCategoryID','companyID','companyLocationID','configurationItemType','contactID','contractID','contractServiceBundleID','contractServiceID','createDate','createdByPersonID','dailyCost','dattoAvailableKilobytes','dattoDeviceMemoryMegabytes','dattoDrivesErrors','dattoHostname','dattoInternalIP','dattoKernelVersionID','dattoLastCheckInDateTime','dattoNICSpeedKilobitsPerSecond','dattoNumberOfAgents','dattoNumberOfDrives','dattoNumberOfVolumes','dattoOffsiteUsedBytes','dattoPercentageUsed','dattoProtectedKilobytes','dattoRemoteIP','dattoSerialNumber','dattoUptimeSeconds','dattoUsedKilobytes','dattoZFSVersionID','deviceNetworkingID','domain','domainRegistrarID','domainRegistrationDateTime','domainLastUpdatedDateTime','domainExpirationDateTime','hourlyCost','impersonatorCreatorResourceID','installDate','installedByContactID','installedByID','isActive','lastActivityPersonID','lastActivityPersonType','lastModifiedTime','location','monthlyCost','notes','numberOfUsers','parentConfigurationItemID','perUseCost','productID','referenceNumber','referenceTitle','serialNumber','serviceBundleID','serviceID','serviceLevelAgreementID','setupFee','sourceChargeID','sourceChargeType','sslSource','sslCommonName','sslValidFromDateTime','sslValidUntilDateTime','sslIssuedBy','sslOrganization','sslOrganizationUnit','sslLocation','sslSerialNumber','sslSignatureAlgorithm','vendorID','warrantyExpirationDate','rmmIsInMaintenanceMode','rmmIsMobileDeviceManagementEnrolled','rmmDeviceUrl','userDefinedFields'],
  PurchaseOrders:['id','cancelDateTime','createDateTime','creatorResourceID','externalPONumber','fax','freight','generalMemo','impersonatorCreatorResourceID','internalCurrencyFreight','latestEstimatedArrivalDate','paymentTerm','phone','purchaseForCompanyID','purchaseOrderNumber','purchaseOrderTemplateID','shippingDate','shippingType','shipToAddress1','shipToAddress2','shipToCity','shipToName','shipToPostalCode','shipToState','showEachTaxInGroup','showTaxCategory','status','submitDateTime','taxRegionID','useItemDescriptionsFrom','vendorID','vendorInvoiceNumber','additionalVendorInvoiceNumbers'],
  Invoices:['id','batchID','comments','companyID','createDateTime','creatorResourceID','dueDate','fromDate','invoiceDateTime','invoiceEditorTemplateID','invoiceNumber','invoiceTotal','isVoided','orderNumber','paidDate','paymentTerm','taxGroup','taxRegionName','toDate','totalTaxValue','voidedByResourceID','voidedDate','webServiceDate','invoiceStatus','invoiceTaxMethodExternalCode'],
};
const capturedCommandNative:{InventoryStockedItemsAdd:string[];InventoryStockedItemsRemove:string[];InventoryStockedItemsTransfer:string[]}={InventoryStockedItemsAdd:['id','determineNewPriceUsing','determineCostUsing','inventoryProductID','pricePercentage','quantityBeingAdded','reasonForUpdate','returnPrice','returnTypeID','serialNumber','unitCost','vendorID','vendorInvoiceNumber'],InventoryStockedItemsRemove:['id','inventoryProductID','inventoryStockedItemID','quantityBeingRemoved','reasonForUpdate'],InventoryStockedItemsTransfer:['id','newInventoryLocationID','inventoryProductID','inventoryStockedItemID','quantityBeingTransferred','reasonForUpdate']};
// Independent native metadata fixture: these fields are readonly in the
// captured entity metadata, while the entity references document them as
// create inputs. It deliberately does not derive from implementation fields.
const capturedCreateReadonly:Record<string,readonly string[]>={
  Contracts:['companyID','contractPeriodType','contractType'],
  ContractServices:['contractID','serviceID','unitCost','unitPrice'],
  ContractCharges:['contractID'], Projects:['companyID'], Phases:['projectID'],
  Tasks:['projectID'], TaskPredecessors:['successorTaskID','predecessorTaskID'],
  ConfigurationItems:['companyID'], ConfigurationItemNotes:['configurationItemID'],
  Subscriptions:['configurationItemID'], InventoryProducts:['inventoryLocationID','productID'],
  InventoryItems:['inventoryLocationID','productID'],
  InventoryTransfers:['fromLocationID','productID','quantityTransferred','toLocationID','notes','serialNumber','transferDate','updateNote'],
  PurchaseOrders:['vendorID'], PurchaseOrderItems:['orderID'],
  PurchaseOrderItemReceiving:['purchaseOrderItemID','quantityNowReceiving','serialNumber','vendorInvoiceNumber'],
};
// The mock keeps the native metadata's readonly bit independent from the
// reviewed create-only policy. A few fields (for example Tasks.projectID and
// ContractCharges.contractID) are writable in metadata but documented as
// immutable after creation, so they intentionally do not appear here.
const capturedReadonlyMetadata:Record<string,readonly string[]>={
  Contracts:['companyID','contractPeriodType','contractType'],
  ContractServices:['contractID','serviceID','unitPrice'],
  ContractCharges:[], Projects:['companyID'], Phases:['projectID'], Tasks:[],
  TaskPredecessors:['successorTaskID','predecessorTaskID'],
  ConfigurationItems:['companyID'], ConfigurationItemNotes:['configurationItemID'],
  Subscriptions:['configurationItemID'], InventoryProducts:['inventoryLocationID','productID'],
  InventoryItems:['inventoryLocationID','productID'],
  InventoryTransfers:['fromLocationID','productID','quantityTransferred','toLocationID','notes','serialNumber','transferByResourceID','transferDate','updateNote'],
  PurchaseOrders:['vendorID'], PurchaseOrderItems:['orderID'],
  PurchaseOrderItemReceiving:['purchaseOrderItemID','quantityBackOrdered','quantityNowReceiving','quantityPreviouslyReceived','receiveDate','receivedByResourceID','serialNumber','vendorInvoiceNumber'],
};
const capturedRequiredMetadata:Record<string,readonly string[]>={
  ProjectNotes:['projectID','title','description','isAnnouncement','noteType','publish'],TaskNotes:['taskID','description','noteType','publish'],
  CompanyToDos:['companyID','actionType','assignedToResourceID','startDateTime','endDateTime'],
  Contracts:['companyID','contractType'], ContractServices:['contractID','serviceID'],
  Projects:['companyID'], Phases:['projectID'],
  TaskPredecessors:['successorTaskID','predecessorTaskID'], ConfigurationItems:['companyID'],
  Subscriptions:['configurationItemID'], InventoryProducts:['inventoryLocationID','productID'],
  InventoryItems:['inventoryLocationID','productID'],
  InventoryTransfers:['fromLocationID','productID','quantityTransferred','toLocationID'],
  PurchaseOrders:['vendorID'], PurchaseOrderItems:['orderID'],
  PurchaseOrderItemReceiving:['purchaseOrderItemID','quantityNowReceiving'],
};
function setup(requestBudget:RequestBudgetPort=new FixtureUnlimitedRequestBudget(),extras:Record<string,any[]>={}){
  const base={...fixturePrincipals()[0]!,capabilities:['operational.read','sales.write','finance.read','finance.write','projects.write','procurement.write','configuration.write'] as Principal['capabilities'],resourceVerifiedAt:new Date().toISOString()};
  const store=new MemoryPrincipalStore([base]),core=new TicketWorkflows(new FixtureAutotaskAdapter(p=>reauthorize(p,store)),store,new MemoryJournal());
  const rows:Record<string,any[]>={CompanyToDos:[],ProjectNotes:[],TaskNotes:[],Resources:[{id:base.resourceId,firstName:'Example',lastName:'Employee',isActive:true}],Contacts:[{id:700,companyID:10,firstName:'Example',lastName:'Contact',isActive:true},{id:701,companyID:20,firstName:'Example',lastName:'Contact',isActive:true},{id:702,companyID:10,firstName:'Example',lastName:'Contact',isActive:false}],Opportunities:[{id:800,companyID:10},{id:801,companyID:20}],Companies:[{id:10,companyName:'Example Engineering'}],Contracts:[{id:100,companyID:10,contractName:'Support',status:1}],ContractServices:[{id:110,contractID:100,serviceID:1,unitCost:5,unitPrice:10}],Projects:[{id:200,companyID:10,projectName:'Migration'}],Phases:[{id:210,projectID:200,title:'Build'}],Tasks:[{id:220,projectID:200,phaseID:210,title:'Configure'}],TaskPredecessors:[{id:230,successorTaskID:220,predecessorTaskID:221,lagDays:0}],ConfigurationItems:[{id:300,companyID:10,referenceTitle:'Router'}],ConfigurationItemNotes:[],ConfigurationItemDnsRecords:[],Subscriptions:[{id:310,configurationItemID:300,subscriptionName:'Support'}],Products:[{id:400,name:'Router',unitCost:5,unitPrice:10}],InventoryProducts:[{id:410,productID:400,inventoryLocationID:1,onHandUnits:4}],PurchaseOrders:[{id:500,purchaseForCompanyID:10,purchaseOrderNumber:'PO-1'}],PurchaseOrderItems:[{id:510,orderID:500,productID:400,quantity:2}],PurchaseOrderItemReceiving:[],Invoices:[{id:600,companyID:10,invoiceNumber:'INV-1',invoiceTotal:100}]};
  const requests:any[]=[];let next=900;
  const fetcher:typeof fetch=async(url,init)=>{const u=new URL(String(url));const path=u.pathname.replace('/atservicesrest/v1.0/','');const method=String(init?.method??'GET');const body=init?.body?JSON.parse(String(init.body)):undefined;requests.push({path,method,body,headers:new Headers(init?.headers)});const entity=path.split('/')[0]!;if(path==='Invoices/600/InvoicePdf')return json({id:600,contentType:'application/pdf',fileName:'INV-1.pdf',fileSize:8,data:[37,80,68,70,45,49,46,52]});if(path.endsWith('/entityInformation/fields')){const readonly=new Set(['id',...(capturedReadonlyMetadata[entity]??[])]),required=new Set(capturedRequiredMetadata[entity]??[]);return json({fields:(fields[entity as keyof typeof fields]??[]).map((name:string)=>({name,dataType:name==='isAnnouncement'?'boolean':name==='publish'?'integer':/ID$|^id$|Type|Status|Category|Preference|Period|Billing/.test(name)?'integer':/Date|Time/.test(name)?'datetime':/Cost|Price|Amount|Hours|Units|Quantity|Rate|Total/.test(name)?'decimal':'string',isRequired:required.has(name),isReadOnly:readonly.has(name),isQueryable:true,isPickList:false})).concat(extras[entity]??[])});}if(path.endsWith('/query')||path.endsWith('/query/next')){const filters=body?.filter??[];const all=(rows[entity]??[]).filter(row=>filters.every((f:any)=>f.op==='eq'?row[f.field]===f.value:f.op==='in'?f.value.includes(row[f.field]):f.op==='contains'?String(row[f.field]??'').toLowerCase().includes(String(f.value).toLowerCase()):f.op==='exist'?row[f.field]!=null:f.op==='notExist'?row[f.field]==null:true));const max=body?.MaxRecords??100,offset=path.endsWith('/query/next')?1:0;return json({items:all.slice(offset,offset+max),pageDetails:{nextPageUrl:offset===0&&all.length>offset+max?`${u.origin}/atservicesrest/v1.0/${entity}/query/next`:null}});}if(method==='GET'){const row=(rows[entity]??[]).find(r=>r.id===Number(path.split('/')[1]));return row?json({item:row}):json({},404);}if(method==='POST'){const target=path.includes('/ToDos')?'CompanyToDos':path.includes('/DnsRecords')?'ConfigurationItemDnsRecords':path.includes('/Notes')?(entity==='Projects'?'ProjectNotes':entity==='Tasks'?'TaskNotes':'ConfigurationItemNotes'):path.includes('/Receiving')?'PurchaseOrderItemReceiving':path.endsWith('/Services')?'ContractServices':path.endsWith('/Blocks')?'ContractBlocks':path.endsWith('/Charges')?'ContractCharges':path.endsWith('/Phases')?'Phases':path.endsWith('/Tasks')?'Tasks':path.endsWith('/Predecessors')?'TaskPredecessors':path.endsWith('/Items')?'PurchaseOrderItems':entity;const row={...body,id:next++};for(const key of ['startDate','endDate','paidDate'])if(typeof row[key]==='string')row[key]=new Date(row[key]).toISOString();(rows[target]??=[]).push(row);return json({itemId:row.id});}if(method==='PATCH'){const target=path.includes('/ToDos')?'CompanyToDos':path.startsWith('Projects/')&&path.endsWith('/Notes')?'ProjectNotes':path.startsWith('Tasks/')&&path.endsWith('/Notes')?'TaskNotes':entity;const row=(rows[target]??[]).find(r=>r.id===body.id);if(row)Object.assign(row,body);return json({itemId:body.id});}if(method==='DELETE'){const target=path.includes('/ToDos')?'CompanyToDos':entity;rows[target]=(rows[target]??[]).filter(r=>r.id!==Number(path.split('/').at(-1)));return new Response(null,{status:204});}return json({},400);};
  const service=new BusinessService(core,new IntentCipher(Buffer.alloc(32,7)),{tenantId:base.tenantId,baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'api',secret:'secret',integrationCode:'integration',requestBudget,writesEnabled:true,fetch:fetcher});checkServiceContracts(service,'business');return{service,principal:base,rows,requests};
}

test('business tools are finite and catalogued; command endpoints have no read wrappers',()=>{const {service}=setup();const tools=businessTools(service);for(const t of tools)assert.ok(t.name in businessOperations,`missing operation catalog: ${t.name}`);assert.equal(tools.some(t=>t.name==='inventory_add_search'),false);assert.equal(tools.some(t=>t.name==='inventory_remove_get'),false);assert.ok(tools.some(t=>t.name==='billing_true_up'));});
test('business operation catalog keeps finance visibility and write caps explicit',()=>{for(const op of Object.values(businessOperations)){assert.ok(op.capabilities.includes('operational.read'));assert.ok(op.capabilities.includes('finance.read'));if(op.write)assert.ok(op.capabilities.includes('finance.write'));}});
test('command entities reject direct reads and invoice export verifies the native envelope',async()=>{const {service,principal}=setup();await assert.rejects(service.search(principal,'InventoryStockedItemsAdd',{}),(e:any)=>e.code==='unsupported_operation');await assert.rejects(service.get(principal,'InventoryStockedItemsTransfer',{id:1}),(e:any)=>e.code==='unsupported_operation');const exported:any=await service.invoiceExport(principal,{id:600,format:'pdf'});const bytes=Buffer.from([37,80,68,70,45,49,46,52]);assert.equal(exported.export.file_name,'INV-1.pdf');assert.equal(exported.export.data_base64,bytes.toString('base64'));});
test('representative allowlists use captured native Swagger names',()=>{for(const [entity,native] of Object.entries(capturedNative)){const projection=fields[entity as keyof typeof fields] as readonly string[];for(const name of projection)assert.ok(native.includes(name),`${entity}.${name} is not in captured native model`);}});
test('stock command fields use captured command request models',()=>{for(const [entity,native] of Object.entries(capturedCommandNative)){for(const name of fields[entity as keyof typeof fields])assert.ok(native.includes(name),`${entity}.${name} is not in captured command model`);}});
test('create-only exceptions match the independent native documentation fixture',()=>{
  for(const [entity,native] of Object.entries(capturedCreateReadonly)){
    assert.deepEqual(documentedCreateOnlyFields[entity as keyof typeof documentedCreateOnlyFields],native,`${entity} create-only map drifted from native review`);
    for(const name of native){
      assert.ok(fields[entity as keyof typeof fields].includes(name),`${entity}.${name} is not a reviewed native field`);
    }
  }
});
test('documented create-only parent fields remain blocked on update',async()=>{
  const {service,principal,requests}=setup();
  await assert.rejects(service.write(principal,'Tasks','update',{id:220,fields:{projectID:200},expected:{projectID:200},request_key:'task-parent-update-1'}),(e:any)=>e.code==='invalid_input');
  assert.equal(requests.some(r=>r.method==='PATCH'&&r.path==='Tasks'),false);
});
test('native required create-only receiving fields fail closed when omitted',async()=>{
  const {service,principal,requests}=setup();
  await assert.rejects(service.write(principal,'PurchaseOrderItemReceiving','create',{purchase_order_item_id:510,fields:{serialNumber:'EXAMPLE'},request_key:'receiving-required-1'}),(e:any)=>e.code==='invalid_input');
  assert.equal(requests.some(r=>r.method==='POST'&&r.path.includes('/Receiving')),false);
});
test('business schema marks create-only fields while retaining readonly metadata',async()=>{
  const {service,principal}=setup();
  const result:any=await service.schema(principal,{entity:'PurchaseOrderItemReceiving'});
  const item=result.fields.find((f:any)=>f.name==='purchaseOrderItemID');
  const quantity=result.fields.find((f:any)=>f.name==='quantityNowReceiving');
  assert.equal(item.isReadOnly,true); assert.equal(item.create_only,true); assert.equal(item.allowed_for_write,true);
  assert.equal(quantity.isReadOnly,true); assert.equal(quantity.create_only,true); assert.equal(quantity.allowed_for_write,true);
});
test('child searches require and enforce the native parent relationship',async()=>{const {service,principal,requests}=setup();await assert.rejects(service.search(principal,'ContractServices',{}),e=>(e as any).code==='invalid_input');const page=await service.search(principal,'ContractServices',{contract_id:100});assert.equal(page.data.length,1);assert.ok(requests.some(r=>r.path==='Contracts/100'));});
test('project and procurement parent scope follows native fields',async()=>{const {service,principal}=setup();const project=await service.get(principal,'Projects',{id:200});assert.equal((project.data as any).projectName,'Migration');const po=await service.get(principal,'PurchaseOrders',{id:500});assert.equal((po.data as any).purchaseForCompanyID,10);const item=await service.search(principal,'PurchaseOrderItems',{purchase_order_id:500});assert.equal(item.data.length,1);});
test('company filters are exact and never widen beyond the principal scope',async()=>{const {service,principal,requests}=setup();await assert.rejects(service.search(principal,'Projects',{company:20}),(e:any)=>e.code==='forbidden'||e.code==='not_found_or_inaccessible');assert.equal(requests.some(r=>r.path==='Projects/query'),false);});
test('native child write routes use the documented parent collections',async()=>{const {service,principal,requests}=setup();const contractService:any=await service.write(principal,'ContractServices','create',{contract_id:100,fields:{serviceID:1,unitPrice:10},request_key:'native-child-contract-1'});const item:any=await service.write(principal,'PurchaseOrderItems','create',{purchase_order_id:500,fields:{productID:400,memo:'item'},request_key:'native-child-po-1'});assert.equal(contractService.status,'succeeded_verified');assert.equal(item.status,'succeeded_verified');assert.ok(requests.some(r=>r.method==='POST'&&r.path==='Contracts/100/Services'));assert.ok(requests.some(r=>r.method==='POST'&&r.path==='PurchaseOrders/500/Items'));assert.equal(requests.some(r=>r.method==='POST'&&r.path==='ContractServices'),false);});
test('configuration item creation retains the injected native companyID',async()=>{const {service,principal,requests}=setup();const created:any=await service.write(principal,'ConfigurationItems','create',{company:10,fields:{referenceTitle:'New router'},request_key:'config-company-1'});assert.equal(created.status,'succeeded_verified');const post=requests.find(r=>r.method==='POST'&&r.path==='ConfigurationItems');assert.equal(post.body.companyID,10);});
test('DNS child search binds the native installedProductID parent',async()=>{const {service,principal,rows,requests}=setup();rows.ConfigurationItemDnsRecords!.push({id:320,installedProductID:300,dnsType:1,data:'router.example'});const page=await service.search(principal,'ConfigurationItemDnsRecords',{configuration_item_id:300});assert.equal(page.data.length,1);const query=requests.find(r=>r.method==='POST'&&r.path==='ConfigurationItemDnsRecords/query');assert.ok(query.body.filter.some((f:any)=>f.field==='installedProductID'&&f.op==='eq'&&f.value===300));});
test('cross-project task phase dependencies are rejected before dispatch',async()=>{const {service,principal,rows,requests}=setup();rows.Projects!.push({id:201,companyID:10,projectName:'Other'});rows.Phases!.push({id:211,projectID:201,title:'Foreign phase'});await assert.rejects(service.write(principal,'Tasks','create',{project_id:200,fields:{phaseID:211,title:'Bad dependency'},request_key:'cross-project-phase-1'}),(e:any)=>e.code==='not_found_or_inaccessible'||e.code==='invalid_input');assert.equal(requests.some(r=>r.method==='POST'&&r.path.includes('/Tasks')),false);});
test('task predecessor dependencies must stay in the same project',async()=>{const {service,principal,rows,requests}=setup();rows.Projects!.push({id:201,companyID:10,projectName:'Other'});rows.Tasks!.push({id:222,projectID:201,title:'Other task'});await assert.rejects(service.write(principal,'TaskPredecessors','create',{task_id:220,fields:{predecessorTaskID:222,lagDays:0},request_key:'cross-project-predecessor-1'}),(e:any)=>e.code==='invalid_input'||e.code==='not_found_or_inaccessible');assert.equal(requests.some(r=>r.method==='POST'&&r.path.includes('/Predecessors')),false);});
test('stock command quantities are native and must be positive',async()=>{const {service,principal,requests}=setup();await assert.rejects(service.write(principal,'InventoryStockedItemsAdd','create',{fields:{inventoryProductID:410,quantityBeingAdded:0},request_key:'bad-stock-quantity'}),(e:any)=>e.code==='invalid_input');assert.equal(requests.some(r=>r.method==='POST'&&r.path.includes('StockedItemsAdd')),false);});
test('nested pagination exposes an encrypted continuation and preserves query binding',async()=>{const {service,principal,rows,requests}=setup();rows.Projects!.push({id:201,companyID:10,projectName:'Second'});const first:any=await service.search(principal,'Projects',{page_size:1});assert.equal(first.status,'partial');assert.equal(first.data.length,1);assert.ok(first.completeness.next_cursor);const second:any=await service.search(principal,'Projects',{page_size:1,cursor:first.completeness.next_cursor});assert.equal(second.status,'succeeded');assert.equal(second.data.length,1);const queries=requests.filter(r=>String(r.path).startsWith('Projects/query'));assert.equal(queries.length,2);assert.equal(queries[0].body.MaxRecords,1);});
test('stale update expectations are rechecked after the request budget',async()=>{let takeCount=0;let mutate:()=>void=()=>{};const budget:RequestBudgetPort={take:async()=>{takeCount++;if(takeCount===2)mutate();},status:()=>({configured:true,mode:'fixture',blocked:null,queued:0,admitted:takeCount,rejected:0})};const result=setup(budget);mutate=()=>{result.rows.Contracts![0]!.contractName='Changed after initial read';};const receipt:any=await result.service.write(result.principal,'Contracts','update',{id:100,fields:{contractName:'Renamed'},expected:{contractName:'Support'},request_key:'stale-contract-update-1'});assert.equal(receipt.status,'failed');assert.equal(receipt.error_code,'conflict');assert.equal(result.requests.some(r=>r.method==='PATCH'),false);});
test('mocked contract create journals before dispatch and reuses request key',async()=>{const {service,principal,rows,requests}=setup();const args={company:10,fields:{contractName:'New',contractType:1,contractPeriodType:1,startDate:'2026-09-01T00:00:00Z',endDate:'2026-10-01T00:00:00Z'},request_key:'contract-create-1'};const first:any=await service.write(principal,'Contracts','create',args);assert.equal(first.status,'succeeded_verified');assert.equal(first.company_id,10);assert.equal((await service.write(principal,'Contracts','create',args) as any).operation_id,first.operation_id);assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='Contracts').length,1);assert.ok(rows.Contracts!.some(r=>r.id===first.native_id));});
test('cross-company child parent is rejected before mocked write',async()=>{const {service,principal,rows,requests}=setup();rows.Contracts!.push({id:101,companyID:20,contractName:'Foreign'});await assert.rejects(service.write(principal,'ContractServices','create',{contract_id:101,fields:{serviceID:1,unitPrice:10},request_key:'foreign-contract-1'}),(e:any)=>e.code==='not_found_or_inaccessible'||e.code==='forbidden');assert.equal(requests.some(r=>r.method==='POST'&&r.path==='ContractServices'),false);});

test('receiving rejects calculated quantities instead of treating every readonly field as a create input',async()=>{
 const {service,principal,requests}=setup();
 await assert.rejects(service.write(principal,'PurchaseOrderItemReceiving','create',{purchase_order_item_id:510,fields:{quantityNowReceiving:1,quantityPreviouslyReceived:99},request_key:'receiving-calculated-1'}),(e:any)=>e.code==='invalid_input');
 assert.equal(requests.some(r=>r.method==='POST'&&r.path.includes('/Receiving')),false);
});

test('CRM to-do create validates native requirements, preserves text and reuses receipt',async()=>{
 const {service,principal,requests}=setup();const args={company:10,fields:{actionType:1,assignedToResourceID:principal.resourceId,startDateTime:'2026-09-20T10:00:00Z',endDateTime:'2026-09-20T11:00:00Z',activityDescription:'Investigate available usage; do not assume a ban.',contactID:700,opportunityID:800},person_identities:{assignedToResourceID:{name:'Example Employee'},contactID:{name:'Example Contact'}},request_key:'todo-create-001'};
 const first:any=await service.write(principal,'CompanyToDos','create',args);assert.equal(first.status,'succeeded_verified');const again:any=await service.write(principal,'CompanyToDos','create',args);assert.equal(first.operation_id,again.operation_id);
 const writes=requests.filter(r=>r.path==='Companies/10/ToDos'&&r.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].body.activityDescription,args.fields.activityDescription);
});
test('CRM to-do rejects mismatched or inactive contacts and foreign opportunity',async()=>{
 for(const link of [{contactID:701},{contactID:702},{opportunityID:801}]){const {service,principal,requests}=setup();await assert.rejects(service.write(principal,'CompanyToDos','create',{company:10,fields:{actionType:1,assignedToResourceID:principal.resourceId,startDateTime:'2026-09-20T10:00:00Z',endDateTime:'2026-09-20T11:00:00Z',...link},person_identities:{assignedToResourceID:{name:'Example Employee'},...('contactID'in link?{contactID:{name:'Example Contact'}}:{})},request_key:'todo-bad-reference'}));assert.equal(requests.some(r=>r.path==='Companies/10/ToDos'&&r.method==='POST'),false);}
});
test('CRM to-do searches preserve self, completion and POST pagination filters',async()=>{
 const {service,principal,rows,requests}=setup();rows.CompanyToDos=[{id:901,companyID:10,assignedToResourceID:principal.resourceId,completedDate:null},{id:902,companyID:10,assignedToResourceID:principal.resourceId,completedDate:null},{id:903,companyID:10,assignedToResourceID:999,completedDate:null},{id:904,companyID:10,assignedToResourceID:principal.resourceId,completedDate:'2026-09-01T00:00:00Z'}];
 const first:any=await service.search(principal,'CompanyToDos',{owner:'self',completion:'open',page_size:1});const second:any=await service.search(principal,'CompanyToDos',{owner:'self',completion:'open',page_size:1,cursor:first.completeness.next_cursor});assert.equal(first.data[0].id,901);assert.equal(second.data[0].id,902);
 const queries=requests.filter(r=>r.path.startsWith('CompanyToDos/query'));assert.equal(queries[1].method,'POST');assert.deepEqual(queries[1].body,queries[0].body);
 await assert.rejects(service.search(principal,'CompanyToDos',{owner:'self',completion:'completed',page_size:1,cursor:first.completeness.next_cursor}),(e:any)=>e.code==='conflict');
});
test('CRM to-do completion update and deletion use native parent routes with expectations',async()=>{
 const {service,principal,rows,requests}=setup();const old={id:901,companyID:10,activityDescription:'Follow up',assignedToResourceID:principal.resourceId,startDateTime:'2026-09-20T10:00:00Z',endDateTime:'2026-09-20T11:00:00Z',completedDate:null};rows.CompanyToDos=[old];
 const updated:any=await service.write(principal,'CompanyToDos','update',{id:901,fields:{completedDate:'2026-09-21T00:00:00Z'},expected:{completedDate:null},request_key:'todo-complete-001'});assert.equal(updated.status,'succeeded_verified');assert.ok(requests.some(r=>r.method==='PATCH'&&r.path==='Companies/10/ToDos'));
 await assert.rejects(service.write(principal,'CompanyToDos','delete',{id:901,expected:{companyID:10},request_key:'todo-delete-bad'}),(e:any)=>e.code==='invalid_input');
 const {id,...expected}=old;const deleted:any=await service.write(principal,'CompanyToDos','delete',{id,expected,request_key:'todo-delete-good'});assert.equal(deleted.status,'succeeded_verified');assert.ok(requests.some(r=>r.method==='DELETE'&&r.path==='Companies/10/ToDos/901'));
});
test('CRM to-do rejects incomplete create, reversed schedule and company moves',async()=>{
 const {service,principal,rows}=setup();await assert.rejects(service.write(principal,'CompanyToDos','create',{company:10,fields:{activityDescription:'Missing schedule'},request_key:'todo-incomplete'}));
 rows.CompanyToDos=[{id:901,companyID:10,startDateTime:'2026-09-20T10:00:00Z',endDateTime:'2026-09-20T11:00:00Z'}];await assert.rejects(service.write(principal,'CompanyToDos','update',{id:901,fields:{startDateTime:'2026-09-20T12:00:00Z'},expected:{startDateTime:'2026-09-20T10:00:00Z'},request_key:'todo-reversed'}));await assert.rejects(service.write(principal,'CompanyToDos','update',{id:901,fields:{companyID:20},expected:{companyID:10},request_key:'todo-company-move'}));
});

test('project/task notes create and update on documented routes with exact saved text',async()=>{
 const {service,principal,requests}=setup();for(const [entity,parent,fields] of [['ProjectNotes',{project_id:200},{title:'Review findings',description:'Unconfirmed usage; investigate.',isAnnouncement:false,noteType:1,publish:1}],['TaskNotes',{task_id:220},{description:'Configuration verified.',noteType:1,publish:1}]] as const){
 const result:any=await service.write(principal,entity,'create',{...parent,fields,request_key:`note-create-${entity}`});assert.equal(result.status,'succeeded_verified');
 const updated:any=await service.write(principal,entity,'update',{id:result.native_id,fields:{description:'Revised documented findings.'},expected:{description:fields.description},request_key:`note-update-${entity}`});assert.equal(updated.status,'succeeded_verified');}
 assert.ok(requests.some(r=>r.method==='POST'&&r.path==='Projects/200/Notes'));assert.ok(requests.some(r=>r.method==='PATCH'&&r.path==='Projects/200/Notes'));assert.ok(requests.some(r=>r.method==='POST'&&r.path==='Tasks/220/Notes'));assert.ok(requests.some(r=>r.method==='PATCH'&&r.path==='Tasks/220/Notes'));
});
test('project/task notes require parents, enforce cross-company scope and reject parent moves',async()=>{
 const {service,principal,rows}=setup();rows.Projects!.push({id:201,companyID:20});rows.Tasks!.push({id:221,projectID:201});rows.ProjectNotes=[{id:910,projectID:200,description:'Existing'}];rows.TaskNotes=[{id:911,taskID:221}];
 await assert.rejects(service.search(principal,'ProjectNotes',{}));await assert.rejects(service.search(principal,'TaskNotes',{}));await assert.rejects(service.get(principal,'TaskNotes',{id:911}));
 await assert.rejects(service.write(principal,'ProjectNotes','update',{id:910,fields:{projectID:201},expected:{projectID:200},request_key:'note-move-parent'}));
 const result:any=await service.search(principal,'ProjectNotes',{project_id:200});assert.equal(result.data[0].id,910);
});
test('project/task notes reject missing audience and forged contact authorship',async()=>{
 const {service,principal,requests}=setup();await assert.rejects(service.write(principal,'TaskNotes','create',{task_id:220,fields:{description:'Missing audience',noteType:1},request_key:'note-missing-audience'}));
 await assert.rejects(service.write(principal,'TaskNotes','create',{task_id:220,fields:{description:'Not contact authored',noteType:1,publish:1,createdByContactID:700},request_key:'note-forged-author'}));assert.equal(requests.some(r=>r.method==='POST'&&r.path==='Tasks/220/Notes'),false);
});

test('CRM to-do search rejects a native response that violates completion filter',async()=>{
 const {service,principal}=setup();const options=(service as any).options,original=options.fetch;options.fetch=async(url:any,init:any)=>String(url).includes('CompanyToDos/query')?json({items:[{id:901,companyID:10,assignedToResourceID:principal.resourceId,completedDate:'2026-09-01T00:00:00Z'}],pageDetails:{nextPageUrl:null}}):original(url,init);
 await assert.rejects(service.search(principal,'CompanyToDos',{owner:'self',completion:'open'}),(e:any)=>e.code==='dependency_unavailable');
});

test('unrelated task parent arguments are rejected instead of silently ignored',async()=>{
 const {service,principal}=setup();await assert.rejects(service.write(principal,'Products','create',{task_id:220,fields:{name:'Unexpected parent'},request_key:'unrelated-task-parent'}),(e:any)=>e.code==='invalid_input');
});

test('native ID search aliases select only the requested record and preserve parent scope',async()=>{
 const cases=[['Projects','project_id',200,{}],['Contracts','contract_id',100,{}],['ConfigurationItems','configuration_item_id',300,{}],['Phases','phase_id',210,{project_id:200}],['Tasks','task_id',220,{project_id:200}],['PurchaseOrders','purchase_order_id',500,{}],['PurchaseOrderItems','purchase_order_item_id',510,{purchase_order_id:500}]] as const;
 for(const [entity,key,id,parent] of cases){
  const {service,principal,rows,requests}=setup();rows[entity]!.push({...rows[entity]![0],id:id+1});
  const result=await service.search(principal,entity,{...parent,[key]:id,company:10});
  assert.deepEqual(result.data.map(row=>row.id),[id],entity);
  assert.ok(requests.find(r=>r.path===`${entity}/query`).body.filter.some((f:any)=>f.field==='id'&&f.op==='eq'&&f.value===id));
  assert.equal((await service.search(principal,entity,{...parent,[key]:9999})).data.length,0);
 }
 const {service,principal,rows}=setup();rows.Projects![0].companyID=20;
 assert.equal((await service.search(principal,'Projects',{project_id:200})).data.length,0);
 await assert.rejects(service.search(principal,'Tasks',{project_id:200,task_id:220}),e=>(e as any).code==='not_found_or_inaccessible');
});
test('business search schemas expose applicable filters and require child parents',()=>{
 const {service}=setup();const tools=businessTools(service);const schema=(name:string)=>tools.find(t=>t.name===name)!.schema;
 assert.equal(schema('project_search').safeParse({project_id:200}).success,true);
 assert.equal(schema('project_search').safeParse({purchase_order_item_id:510}).success,false);
 assert.equal(schema('task_search').safeParse({task_id:220}).success,false);
 assert.equal(schema('task_search').safeParse({project_id:200,task_id:220}).success,true);
 assert.equal(schema('product_search').safeParse({company:10}).success,false);
 assert.equal(schema('contract_service_unit_search').safeParse({contract_id:100,text:'x'}).success,false);
 assert.equal(schema('asset_search').safeParse({status:1}).success,false);
});
test('text searches use explicit native fields instead of nonexistent description fields',async()=>{
 const cases=[['Invoices','invoiceNumber',{}],['ContractServices','invoiceDescription',{contract_id:100}],['InventoryProducts','bin',{}],['PurchaseOrders','purchaseOrderNumber',{}],['PurchaseOrderItems','memo',{purchase_order_id:500}]] as const;
 for(const [entity,field,parent] of cases){const {service,principal,rows,requests}=setup();rows[entity]![0][field]='Find me';
  const result=await service.search(principal,entity,{...parent,text:'Find me'});
  assert.equal(result.data.length,1,entity);
  assert.ok(requests.find(r=>r.path===`${entity}/query`).body.filter.some((f:any)=>f.field===field&&f.op==='contains'));
 }
});
test('stocked inventory searches use native purchase-order relationship fields',async()=>{
 const {service,principal,rows,requests}=setup();rows.InventoryStockedItems=[{id:990,companyID:10,purchaseOrderID:500,purchaseOrderItemID:510,statusID:1}];
 const result=await service.search(principal,'InventoryStockedItems',{purchase_order_id:500,purchase_order_item_id:510,status:1});
 assert.equal(result.data.length,1);
 const filters=requests.find(r=>r.path==='InventoryStockedItems/query').body.filter;
 for(const field of ['purchaseOrderID','purchaseOrderItemID','statusID'])assert.ok(filters.some((f:any)=>f.field===field));
});

test('business assignment IDs require matching person identities before any native write',async()=>{
 for(const entity of ['Tasks','Projects','Contracts'] as const)for(const supplied of [false,true]){
  const {service,principal,requests}=setup();
  const field=entity==='Tasks'?'assignedResourceID':entity==='Projects'?'projectLeadResourceID':'contactID';
  const input={...(entity==='Tasks'?{project_id:200}:{company:10}),fields:{...(entity==='Contracts'?{contractName:'Support',contractType:1}:entity==='Projects'?{projectName:'Project'}:{title:'Task'}),[field]:field==='contactID'?700:principal.resourceId},...(supplied?{person_identities:{[field]:{name:'Wrong Person'}}}:{}),request_key:'identity-rejection-1'};
  await assert.rejects(service.write(principal,entity,'create',input),(e:any)=>e.code===(supplied?'conflict':'invalid_input'));
  assert.equal(requests.some(r=>['POST','PATCH'].includes(r.method)&&!r.path.endsWith('/query')),false);
 }
 const {service,principal,requests}=setup();const result:any=await service.write(principal,'Tasks','create',{project_id:200,fields:{title:'Task',assignedResourceID:principal.resourceId},person_identities:{assignedResourceID:{name:'Example Employee'}},request_key:'identity-task-correct'});
 assert.equal(result.status,'succeeded_verified');assert.equal(requests.find(r=>r.method==='POST'&&r.path.endsWith('/Tasks')).body.person_identities,undefined);
});

test('business writes reject caller-supplied completion attribution instead of treating it as an assignee',async()=>{
 const {service,principal,requests}=setup();
 await assert.rejects(service.write(principal,'Tasks','create',{project_id:200,fields:{title:'Task',completedByResourceID:principal.resourceId},request_key:'attribution-injection'}),(e:any)=>e.code==='invalid_input');
 assert.equal(requests.some(r=>r.method==='POST'&&r.path.endsWith('/Tasks')),false);
});

test('business update discovers and persists an editable field outside the original projection',async()=>{
 const {service,principal,rows,requests}=setup(new FixtureUnlimitedRequestBudget(),{Projects:[{name:'externalTracking',dataType:'string',isReadOnly:false,isRequired:false}]});
 rows.Projects![0].externalTracking='old';
 const schema:any=await service.schema(principal,{entity:'Projects'});assert.equal(schema.fields.find((f:any)=>f.name==='externalTracking').allowed_for_update,true);
 const read:any=await service.get(principal,'Projects',{id:200});assert.equal(read.data.externalTracking,'old');
 const result:any=await service.write(principal,'Projects','update',{id:200,fields:{externalTracking:'new'},expected:{externalTracking:'old'},request_key:'metadata-project-extra'});
 assert.equal(result.status,'succeeded_verified');assert.equal(rows.Projects![0].externalTracking,'new');
 await assert.rejects(service.write(principal,'Projects','update',{id:200,fields:{externalTracking:'again'},expected:{externalTracking:'old'},request_key:'metadata-project-stale'}));assert.equal(requests.filter(r=>r.method==='PATCH').length,1);
});
