import {fieldsSchema} from '../../native-fields/src/index.js';
import {personIdentitySchema} from '../../contracts/src/person-identity.js';
import {z} from 'zod';

/** Business entities with a reviewed route and field projection.  This is intentionally finite. */
export const businessEntities = [
  'Contracts','ContractServices','ContractBlocks','ContractCharges','ContractServiceAdjustments','ContractServiceBundleAdjustments','ContractServiceBundleUnits','ContractServiceUnits','Invoices',
  'Projects','Phases','Tasks','TaskPredecessors','ProjectNotes','TaskNotes','CompanyToDos',
  'ConfigurationItems','ConfigurationItemDnsRecords','ConfigurationItemNotes','Subscriptions',
  'Products','InventoryProducts','InventoryItems','InventoryStockedItems','InventoryStockedItemsAdd','InventoryStockedItemsRemove','InventoryStockedItemsTransfer','InventoryTransfers','PurchaseOrders','PurchaseOrderItems','PurchaseOrderItemReceiving',
] as const;
export type BusinessEntity = typeof businessEntities[number];

export const fields: Record<BusinessEntity, readonly string[]> = {
  CompanyToDos:['id','companyID','actionType','activityDescription','assignedToResourceID','completedDate','contactID','contractID','createDateTime','creatorResourceID','endDateTime','impersonatorCreatorResourceID','lastModifiedDate','opportunityID','startDateTime','ticketID'],
  Contracts:['id','billingPreference','billToCompanyContactID','billToCompanyID','companyID','contactID','contactName','contractCategory','contractExclusionSetID','contractName','contractNumber','contractPeriodType','contractType','description','endDate','estimatedCost','estimatedHours','estimatedRevenue','exclusionContractID','internalCurrencyOverageBillingRate','internalCurrencySetupFee','isCompliant','isDefaultContract','lastModifiedDateTime','opportunityID','organizationalLevelAssociationID','overageBillingRate','purchaseOrderNumber','renewedContractID','serviceLevelAgreementID','setupFee','setupFeeBillingCodeID','startDate','status','timeReportingRequiresStartAndStopTimes'],
  ContractServices:['id','contractID','internalCurrencyAdjustedPrice','internalCurrencyUnitPrice','internalDescription','invoiceDescription','quoteItemID','serviceID','unitCost','unitPrice'],
  ContractBlocks:['id','contractID','datePurchased','endDate','hourlyRate','hours','hoursApproved','invoiceNumber','isPaid','paymentNumber','paymentType','startDate','status'],
  ContractCharges:['id','billableAmount','billingCodeID','chargeType','contractID','contractServiceBundleID','contractServiceID','createDate','creatorResourceID','datePurchased','description','extendedCost','internalCurrencyBillableAmount','internalCurrencyUnitPrice','internalPurchaseOrderNumber','isBillableToCompany','isBilled','name','notes','organizationalLevelAssociationID','productID','purchaseOrderNumber','status','statusLastModifiedBy','statusLastModifiedDate','unitCost','unitPrice','unitQuantity'],
  ContractServiceAdjustments:['id','adjustedUnitCost','adjustedUnitPrice','allowRepeatService','contractID','contractServiceID','effectiveDate','quoteItemID','serviceID','unitChange'],
  ContractServiceBundleAdjustments:['id','adjustedUnitPrice','allowRepeatServiceBundle','contractID','contractServiceBundleID','effectiveDate','quoteItemID','serviceBundleID','unitChange'],
  ContractServiceBundleUnits:['id','approveAndPostDate','contractID','contractServiceBundleID','cost','endDate','internalCurrencyPrice','organizationalLevelAssociationID','price','serviceBundleID','startDate','units'],
  ContractServiceUnits:['id','approveAndPostDate','contractID','contractServiceID','cost','endDate','internalCurrencyPrice','organizationalLevelAssociationID','price','serviceID','startDate','units','vendorCompanyID'],
  Invoices:['id','batchID','comments','companyID','createDateTime','creatorResourceID','dueDate','fromDate','invoiceDateTime','invoiceEditorTemplateID','invoiceNumber','invoiceTotal','isVoided','orderNumber','paidDate','paymentTerm','taxGroup','taxRegionName','toDate','totalTaxValue','voidedByResourceID','voidedDate','webServiceDate','invoiceStatus','invoiceTaxMethodExternalCode'],
  Projects:['id','actualBilledHours','actualHours','changeOrdersBudget','changeOrdersRevenue','companyID','companyOwnerResourceID','completedDateTime','completedPercentage','contractID','createDateTime','creatorResourceID','department','description','duration','endDateTime','estimatedSalesCost','estimatedTime','extProjectNumber','extProjectType','impersonatorCreatorResourceID','laborEstimatedCosts','laborEstimatedMarginPercentage','laborEstimatedRevenue','lastActivityDateTime','lastActivityPersonType','lastActivityResourceID','opportunityID','organizationalLevelAssociationID','originalEstimatedRevenue','projectCostEstimatedMarginPercentage','projectCostsBudget','projectCostsRevenue','projectLeadResourceID','projectName','projectNumber','projectType','purchaseOrderNumber','sgda','startDateTime','status','statusDateTime','statusDetail'],
  Phases:['id','createDate','creatorResourceID','description','dueDate','estimatedHours','externalID','isScheduled','lastActivityDateTime','parentPhaseID','phaseNumber','projectID','startDate','title'],
  Tasks:['id','assignedResourceID','assignedResourceRoleID','billingCodeID','canClientPortalUserCompleteTask','companyLocationID','completedByResourceID','completedByType','completedDateTime','createDateTime','creatorResourceID','creatorType','departmentID','description','endDateTime','estimatedHours','externalID','hoursToBeScheduled','isTaskBillable','isVisibleInClientPortal','lastActivityDateTime','lastActivityPersonType','lastActivityResourceID','phaseID','priority','priorityLabel','projectID','purchaseOrderNumber','remainingHours','startDateTime','status','taskCategoryID','taskNumber','taskType','title'],
  TaskPredecessors:['id','lagDays','predecessorTaskID','successorTaskID'],
  ProjectNotes:['id','createDateTime','createdByContactID','creatorResourceID','description','impersonatorCreatorResourceID','impersonatorUpdaterResourceID','isAnnouncement','lastActivityDate','noteType','projectID','publish','title'],
  TaskNotes:['id','createDateTime','creatorResourceID','createdByContactID','description','impersonatorCreatorResourceID','impersonatorUpdaterResourceID','lastActivityDate','noteType','publish','taskID','title'],
  ConfigurationItems:['id','apiVendorID','configurationItemCategoryID','companyID','companyLocationID','configurationItemType','contactID','contractID','contractServiceBundleID','contractServiceID','createDate','createdByPersonID','dailyCost','domain','domainRegistrarID','domainRegistrationDateTime','domainLastUpdatedDateTime','domainExpirationDateTime','hourlyCost','installDate','installedByContactID','installedByID','isActive','location','monthlyCost','notes','numberOfUsers','parentConfigurationItemID','perUseCost','productID','referenceNumber','referenceTitle','serialNumber','serviceBundleID','serviceID','serviceLevelAgreementID','setupFee','sourceChargeID','sourceChargeType','sslSource','sslCommonName','sslValidFromDateTime','sslValidUntilDateTime','sslIssuedBy','sslOrganization','sslOrganizationUnit','sslLocation','sslSerialNumber','sslSignatureAlgorithm','vendorID','warrantyExpirationDate','rmmIsInMaintenanceMode','rmmIsMobileDeviceManagementEnrolled','rmmDeviceUrl'],
  ConfigurationItemDnsRecords:['id','createDateTime','data','installedProductID','timeToLiveSeconds','dnsType'],
  ConfigurationItemNotes:['id','configurationItemID','createDateTime','creatorResourceID','description','impersonatorCreatorResourceID','impersonatorUpdaterResourceID','lastActivityDate','noteType','title'],
  Subscriptions:['id','configurationItemID','description','effectiveDate','expirationDate','impersonatorCreatorResourceID','materialCodeID','organizationalLevelAssociationID','periodCost','periodPrice','periodType','purchaseOrderNumber','status','subscriptionName','totalCost','totalPrice','vendorID'],
  Products:['id','billingType','chargeBillingCodeID','createdByResourceID','createdTime','defaultVendorID','description','doesNotRequireProcurement','externalProductID','impersonatorCreatorResourceID','internalProductID','isActive','isEligibleForRma','isSerialized','link','manufacturerName','manufacturerProductName','markupRate','msrp','name','periodType','priceCostMethod','productBillingCodeID','productCategory','sku','unitCost','unitPrice','vendorProductNumber','defaultInstalledProductCategoryID'],
  InventoryProducts:['id','availableUnits','backOrderQuantity','bin','createDateTime','createdByResourceID','inventoryLocationID','onHandUnits','pickedUnits','productID','quantityMaximum','quantityMinimum','referenceNumber','reservedUnits','unitsOnOrder'],
  InventoryItems:['id','backOrderQuantity','bin','impersonatorCreatorResourceID','inventoryLocationID','productID','quantityMaximum','quantityMinimum','quantityOnHand','quantityOnOrder','quantityPicked','quantityReserved','referenceNumber'],
  InventoryStockedItems:['id','availableUnits','companyID','configurationItemID','createDateTime','createdByResourceID','currentInventoryLocationID','deliveredUnits','inventoryProductID','purchaseOrderItemReceivingID','onHandUnits','parentInventoryStockedItemID','pickedRemovedByResourceID','pickedRemovedDateTime','pickedUnits','purchaseOrderID','purchaseOrderItemID','quoteItemID','removedUnits','reservedUnits','returnPrice','returnTypeID','serialNumber','statusID','transferredUnits','unitCost','vendorID','vendorInvoiceNumber','parentStockedItemReceivedUnits','contractChargeID','projectChargeID','ticketChargeID'],
  InventoryStockedItemsAdd:['id','determineNewPriceUsing','determineCostUsing','inventoryProductID','pricePercentage','quantityBeingAdded','reasonForUpdate','returnPrice','returnTypeID','serialNumber','unitCost','vendorID','vendorInvoiceNumber'],
  InventoryStockedItemsRemove:['id','inventoryProductID','inventoryStockedItemID','quantityBeingRemoved','reasonForUpdate'],
  InventoryStockedItemsTransfer:['id','newInventoryLocationID','inventoryProductID','inventoryStockedItemID','quantityBeingTransferred','reasonForUpdate'],
  InventoryTransfers:['id','fromLocationID','notes','productID','quantityTransferred','serialNumber','toLocationID','transferByResourceID','transferDate','updateNote'],
  PurchaseOrders:['id','cancelDateTime','createDateTime','creatorResourceID','externalPONumber','fax','freight','generalMemo','impersonatorCreatorResourceID','internalCurrencyFreight','latestEstimatedArrivalDate','paymentTerm','phone','purchaseForCompanyID','purchaseOrderNumber','purchaseOrderTemplateID','shippingDate','shippingType','shipToAddress1','shipToAddress2','shipToCity','shipToName','shipToPostalCode','shipToState','showEachTaxInGroup','showTaxCategory','status','submitDateTime','taxRegionID','useItemDescriptionsFrom','vendorID','vendorInvoiceNumber','additionalVendorInvoiceNumbers'],
  PurchaseOrderItems:['id','chargeID','contractID','estimatedArrivalDate','internalCurrencyUnitCost','inventoryLocationID','memo','orderID','productID','projectID','quantity','salesOrderID','ticketID','unitCost'],
  PurchaseOrderItemReceiving:['id','purchaseOrderItemID','quantityBackOrdered','quantityNowReceiving','quantityPreviouslyReceived','receiveDate','receivedByResourceID','serialNumber','vendorInvoiceNumber'],
};

const writableByDocs: Partial<Record<BusinessEntity, readonly string[]>> = {
  CompanyToDos:['companyID','actionType','activityDescription','assignedToResourceID','completedDate','contactID','contractID','endDateTime','opportunityID','startDateTime','ticketID'],
  Contracts:fields.Contracts.filter(x=>!['id','createDate','lastModifiedDate'].includes(x)),
  ContractServices:fields.ContractServices.filter(x=>!['id','serviceName'].includes(x)), ContractBlocks:fields.ContractBlocks.filter(x=>x!=='id'), ContractCharges:fields.ContractCharges.filter(x=>x!=='id'),
  ContractServiceAdjustments:fields.ContractServiceAdjustments.filter(x=>x!=='id'), ContractServiceBundleAdjustments:fields.ContractServiceBundleAdjustments.filter(x=>x!=='id'), ContractServiceBundleUnits:[], ContractServiceUnits:[],
  Invoices:['invoiceNumber','paidDate','webServiceDate'],
  Projects:fields.Projects.filter(x=>!['id','projectNumber','actualHours','actualBilledHours','createDateTime','lastActivityDateTime'].includes(x)), Phases:fields.Phases.filter(x=>x!=='id'), Tasks:fields.Tasks.filter(x=>!['id','actualHours','createDateTime','lastActivityDateTime'].includes(x)), TaskPredecessors:['successorTaskID','predecessorTaskID','lagDays'],
  ProjectNotes:['description','isAnnouncement','noteType','projectID','publish','title'], TaskNotes:['description','noteType','publish','taskID','title'],
  ConfigurationItems:fields.ConfigurationItems.filter(x=>!['id','createDate','lastModifiedDate'].includes(x)), ConfigurationItemDnsRecords:[], ConfigurationItemNotes:fields.ConfigurationItemNotes.filter(x=>!['id','createDate','lastModifiedDate'].includes(x)), Subscriptions:fields.Subscriptions.filter(x=>!['id','companyID'].includes(x)),
  Products:fields.Products.filter(x=>!['id','createdTime'].includes(x)), InventoryProducts:fields.InventoryProducts.filter(x=>x!=='id'), InventoryItems:fields.InventoryItems.filter(x=>x!=='id'), InventoryStockedItems:[], InventoryStockedItemsAdd:fields.InventoryStockedItemsAdd.filter(x=>x!=='id'), InventoryStockedItemsRemove:fields.InventoryStockedItemsRemove.filter(x=>x!=='id'), InventoryStockedItemsTransfer:fields.InventoryStockedItemsTransfer.filter(x=>x!=='id'), InventoryTransfers:fields.InventoryTransfers.filter(x=>x!=='id'), PurchaseOrders:fields.PurchaseOrders.filter(x=>!['id','createDateTime'].includes(x)), PurchaseOrderItems:fields.PurchaseOrderItems.filter(x=>x!=='id'), PurchaseOrderItemReceiving:fields.PurchaseOrderItemReceiving.filter(x=>x!=='id'),
};
export const writeFields = writableByDocs as Record<BusinessEntity, readonly string[]>;

/**
 * Native metadata marks several parent and request fields read-only because
 * they cannot be changed after creation. The REST entity docs still require
 * or explicitly accept those values on Create; the write engine must allow
 * them only for Create and continue rejecting them on Update.
 *
 * Sources: vendor URLs in
 * docs/planning/autotask-mcp-plan/source-manifest.json and the reviewed Swagger
 * snapshot work/docker/business-native-models.json. In particular:
 * ContractServicesEntity (contractID/serviceID/unitCost/unitPrice),
 * ContractsEntity, ProjectsEntity, PhasesEntity, TasksEntity,
 * TaskPredecessorsEntity, ConfigurationItemsEntity,
 * ConfigurationItemNotesEntity, SubscriptionsEntity,
 * InventoryProductsEntity, InventoryItemsEntity, InventoryTransfersEntity,
 * PurchaseOrdersEntity, PurchaseOrderItemsEntity, and
 * PurchaseOrderItemReceivingEntity.
 */
export const documentedCreateOnlyFields: Partial<Record<BusinessEntity, readonly string[]>> = {
  CompanyToDos: ['companyID'],
  Contracts: ['companyID', 'contractPeriodType', 'contractType'],
  ContractServices: ['contractID', 'serviceID', 'unitCost', 'unitPrice'],
  ContractCharges: ['contractID'],
  Projects: ['companyID'],
  Phases: ['projectID'],
  Tasks: ['projectID'],
  TaskPredecessors: ['successorTaskID', 'predecessorTaskID'],
  ProjectNotes: ['projectID'],
  TaskNotes: ['taskID'],
  ConfigurationItems: ['companyID'],
  ConfigurationItemNotes: ['configurationItemID'],
  Subscriptions: ['configurationItemID'],
  InventoryProducts: ['inventoryLocationID', 'productID'],
  InventoryItems: ['inventoryLocationID', 'productID'],
  InventoryTransfers: ['fromLocationID', 'productID', 'quantityTransferred', 'toLocationID', 'notes', 'serialNumber', 'transferDate', 'updateNote'],
  PurchaseOrders: ['vendorID'],
  PurchaseOrderItems: ['orderID'],
  PurchaseOrderItemReceiving: ['purchaseOrderItemID', 'quantityNowReceiving', 'serialNumber', 'vendorInvoiceNumber'],
};

export const documentedWrites: Record<BusinessEntity, readonly ('create'|'update'|'delete')[]> = {
  CompanyToDos:['create','update','delete'],
  Contracts:['create','update'],ContractServices:['create','update'],ContractBlocks:['create','update'],ContractCharges:['create','update'],ContractServiceAdjustments:['create'],ContractServiceBundleAdjustments:['create'],ContractServiceBundleUnits:[],ContractServiceUnits:[],Invoices:['update'],
  Projects:['create','update'],Phases:['create','update'],Tasks:['create','update'],TaskPredecessors:['create','update','delete'],ProjectNotes:['create','update'],TaskNotes:['create','update'],ConfigurationItems:['create','update'],ConfigurationItemDnsRecords:['delete'],ConfigurationItemNotes:['create','update'],Subscriptions:['update','delete'],Products:['create','update'],InventoryProducts:['create','update','delete'],InventoryItems:['create','update'],InventoryStockedItems:[],InventoryStockedItemsAdd:['create'],InventoryStockedItemsRemove:['create'],InventoryStockedItemsTransfer:['create'],InventoryTransfers:['create'],PurchaseOrders:['create','update'],PurchaseOrderItems:['create','update'],PurchaseOrderItemReceiving:['create'],
};
export const id = z.number().int().positive().safe();
export const company = z.union([z.number().int().nonnegative().safe(), z.string().trim().min(1).max(250)]);
export const searchSchema = z.object({company:company.optional(),project_id:id.optional(),phase_id:id.optional(),task_id:id.optional(),contract_id:id.optional(),configuration_item_id:id.optional(),purchase_order_id:id.optional(),purchase_order_item_id:id.optional(),inventory_location_id:id.optional(),text:z.string().trim().min(1).max(250).optional(),status:z.union([z.number().int(),z.string().trim().min(1).max(100)]).optional(),page_size:z.number().int().min(1).max(100).default(25),cursor:z.string().max(16000).optional()}).strict();
export const todoSearchSchema = searchSchema.extend({owner:z.union([z.literal('self'),id]).optional(),completion:z.enum(['all','open','completed']).default('all')});
// One search contract drives both discovery and runtime validation.
export const searchIdAlias: Partial<Record<BusinessEntity, string>> = {Projects:'project_id',Phases:'phase_id',Tasks:'task_id',Contracts:'contract_id',ConfigurationItems:'configuration_item_id',PurchaseOrders:'purchase_order_id',PurchaseOrderItems:'purchase_order_item_id'};
export const searchTextField: Partial<Record<BusinessEntity, string>> = {
 CompanyToDos:'activityDescription',Contracts:'contractName',ContractServices:'invoiceDescription',ContractBlocks:'invoiceNumber',ContractCharges:'description',Invoices:'invoiceNumber',Projects:'projectName',Phases:'description',Tasks:'title',ProjectNotes:'description',TaskNotes:'description',ConfigurationItems:'referenceTitle',ConfigurationItemDnsRecords:'data',ConfigurationItemNotes:'description',Subscriptions:'description',Products:'name',InventoryProducts:'bin',InventoryItems:'bin',InventoryStockedItems:'serialNumber',InventoryTransfers:'notes',PurchaseOrders:'purchaseOrderNumber',PurchaseOrderItems:'memo',PurchaseOrderItemReceiving:'serialNumber'
};
export const searchParentFilters = (entity: BusinessEntity): Record<string, [string, string]> => ({
 project_id:['projectID','Projects'],phase_id:['phaseID','Phases'],task_id:[entity==='TaskNotes'?'taskID':'successorTaskID','Tasks'],contract_id:['contractID','Contracts'],configuration_item_id:[entity==='ConfigurationItemDnsRecords'?'installedProductID':'configurationItemID','ConfigurationItems'],purchase_order_id:[entity==='InventoryStockedItems'?'purchaseOrderID':'orderID','PurchaseOrders'],purchase_order_item_id:['purchaseOrderItemID','PurchaseOrderItems'],inventory_location_id:[entity==='InventoryStockedItems'?'currentInventoryLocationID':'inventoryLocationID','InventoryLocations']
});
export function searchSchemaFor(entity: BusinessEntity) {
 const mask: Record<string, true> = {page_size:true,cursor:true};
 if(!['Products','InventoryProducts','InventoryItems','InventoryTransfers'].includes(entity))mask.company=true;
 if(searchTextField[entity])mask.text=true;
 if(fields[entity].some(f=>['status','invoiceStatus','statusID'].includes(f)))mask.status=true;
 for(const [key,[field]] of Object.entries(searchParentFilters(entity)))if(fields[entity].includes(field)||searchIdAlias[entity]===key)mask[key]=true;
 if(entity==='CompanyToDos'){mask.owner=true;mask.completion=true;}
 const base=entity==='CompanyToDos'?todoSearchSchema:searchSchema;
 const requiredParent: Partial<Record<BusinessEntity,string>> = {ContractServices:'contract_id',ContractBlocks:'contract_id',ContractCharges:'contract_id',ContractServiceBundleUnits:'contract_id',ContractServiceUnits:'contract_id',Phases:'project_id',Tasks:'project_id',TaskPredecessors:'task_id',ProjectNotes:'project_id',TaskNotes:'task_id',ConfigurationItemDnsRecords:'configuration_item_id',ConfigurationItemNotes:'configuration_item_id',Subscriptions:'configuration_item_id',PurchaseOrderItems:'purchase_order_id',PurchaseOrderItemReceiving:'purchase_order_item_id'};
 const schema=base.pick(mask as Record<keyof typeof base.shape,true>);
 const parent=requiredParent[entity];
 return parent?schema.required({[parent]:true} as Record<keyof typeof base.shape,true>):schema;
}
export const getSchema = z.object({id}).strict();
export const data = fieldsSchema;
export const key = z.string().trim().min(8).max(128).refine(v=>!/^(wf:|sch:|job:)/.test(v));
export const createSchema = z.object({person_identities:z.record(z.string(),personIdentitySchema).optional().describe('Required for each explicit person ID in fields. Key by native field name and supply the intended full name/email from the user request, not a name invented to fit the ID.'),company:company.optional(),project_id:id.optional(),phase_id:id.optional(),task_id:id.optional(),contract_id:id.optional(),configuration_item_id:id.optional(),purchase_order_id:id.optional(),purchase_order_item_id:id.optional(),fields:data,request_key:key}).strict();
export const updateSchema = z.object({person_identities:z.record(z.string(),personIdentitySchema).optional().describe('Required for each explicit person ID in fields. Key by native field name and supply the intended full name/email from the user request, not a name invented to fit the ID.'),id,fields:data,expected:data,request_key:key}).strict();
export const deleteSchema = z.object({id,expected:data,request_key:key}).strict();
export const schemaSchema = z.object({entity:z.enum(businessEntities),include_udfs:z.boolean().optional()}).strict();
export const receiptSchema = z.object({operation_id:z.string().uuid()}).strict();
export const invoiceExportSchema = z.object({id,format:z.literal('pdf')}).strict();
