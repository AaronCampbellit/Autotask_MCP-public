# Autotask entity coverage plan

Each unique index label is accounted for below. Y = the documentation marks support; N = explicit false; — = the old-format table leaves support unmarked; ? = unresolved. An unmarked cell is not permission to use an operation. These are documentation observations, not tested capabilities. All operations require route review, conditional-rule review, and tenant validation before enabling.

232 source index rows → 231 distinct labels. ResourceTimeOffAdditional appears twice in the source index. ConfigurationItemExts has no linked reference. Neither discrepancy is silently discarded.

The JSON inventory retains factual parent/child relationships, API paths, original mapping notes, external source URLs, and separate operation support. Vendor prose, examples and full page copies are excluded; consult each reference for conditions. Broad module coverage is planned in 05-DOMAIN-WORKFLOWS.md; special actions are covered in 04-AUTOTASK-ADAPTER.md.

**Assets**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| ConfigurationItemAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemBillingProductAssociations | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemBillingProductAssociationsEntity.htm) |
| ConfigurationItemCategories | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemCategoriesEntity.htm) |
| ConfigurationItemCategoryUdfAssociations | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemCategoryUdfAssociationsEntity.htm) |
| ConfigurationItemDnsRecords | Y | — | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemDnsRecordsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemExts | ? | ? | ? | ? | ? | Unlinked No captured entity reference maps from this index row; manual documentation/Swagger discovery required. |
| ConfigurationItemNoteAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemNoteAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| ConfigurationItemNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemNotesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemRelatedItems | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemRelatedItemsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemSslSubjectAlternativeName | Y | Y | Y | N | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemsEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| ConfigurationItemTypes | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemTypesEntity.htm) |
| ConfigurationItems | Y | Y | Y | N | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemsEntity.htm) |
| DomainRegistrars | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DomainRegistrarsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| SubscriptionPeriods | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SubscriptionPeriodsEntity.htm) |
| Subscriptions | Y | ? | Y | Y | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SubscriptionsEntity.htm) |

**CRM**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| ActionTypes | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ActionTypesEntity.htm) |
| ClassificationIcons | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ClassificationIconsEntity.htm) |
| ClientPortalUsers | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ClientPortalUsersEntity.htm) |
| ComanagedAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ComanagedAssociationsEntity.htm) |
| Companies | Y | Y | Y | N | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompaniesEntity.htm) |
| CompanyAlerts | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyAlertsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| CompanyAttachments | Y | Y | Y | N | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompaniesEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| CompanyCategories | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyCategoriesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| CompanyLocations | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyLocationsEntity.htm) |
| CompanyNoteAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyNoteAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| CompanyNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyNotesEntity.htm) |
| CompanySiteConfigurations | Y | — | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanySiteConfigurationsEntity.htm) |
| CompanyTeams | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyTeamsEntity.htm) |
| CompanyToDos | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyToDosEntity.htm) |
| ContactBillingProductAssociations | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContactBillingProductAssociationsEntity.htm) |
| ContactGroupContacts | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContactGroupContactsEntity.htm) |
| ContactGroups | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContactGroupsEntity.htm) |
| Contacts | Y | Y | Y | Y | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContactsEntity.htm) |

**Contracts and finance**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| AdditionalInvoiceFieldValues | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/AdditionalInvoiceFieldValuesEntity.htm) |
| BillingCodes | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/BillingCodesEntity.htm) |
| BillingItemApprovalLevels | Y | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/BillingItemApprovalLevelsEntity.htm) |
| BillingItems | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/BillingItemsEntity.htm) |
| ContractBillingRules | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractBillingRulesEntity.htm) |
| ContractBlockHourFactors | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractBlockHourFactorsEntity.htm) |
| ContractBlocks | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractBlocksEntity.htm) |
| ContractCharges | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractChargesEntity.htm) Update requires the documented isBilled flag to be false; verify the effective API rule. Delete requires the documented isBilled flag to be false; verify the effective API rule. |
| ContractExclusionBillingCodes | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractExclusionBillingCodesEntity.htm) |
| ContractExclusionRoles | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractExclusionRolesEntity.htm) |
| ContractExclusionSetExcludedRoles | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractExclusionSetExcludedRolesEntity.htm) |
| ContractExclusionSetExcludedWorkTypes | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractExclusionSetExcludedWorkTypesEntity.htm) |
| ContractExclusionSets | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractExclusionSetsEntity.htm) |
| ContractMilestones | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractMilestonesEntity.htm) |
| ContractNoteAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractNoteAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ContractNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractNotesEntity.htm) |
| ContractRates | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractRatesEntity.htm) |
| ContractRetainers | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractRetainersEntity.htm) |
| ContractRoleCosts | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractRoleCostsEntity.htm) |
| ContractServiceAdjustments | — | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServiceAdjustmentsEntity.htm) |
| ContractServiceBundleAdjustments | — | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServiceBundleAdjustmentsEntity.htm) |
| ContractServiceBundleUnits | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServiceBundleUnitsEntity.htm) |
| ContractServiceBundles | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServiceBundlesEntity.htm) |
| ContractServiceUnits | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServiceUnitsEntity.htm) |
| ContractServices | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServicesEntity.htm) |
| ContractTicketPurchases | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractTicketPurchasesEntity.htm) |
| Contracts | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractsEntity.htm) |
| Currencies | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CurrenciesEntity.htm) |
| InvoiceTemplates | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InvoiceTemplatesEntity.htm) |
| Invoices | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InvoicesEntity.htm) |
| PaymentTerms | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PaymentTermsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| PriceListMaterialCodes | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListMaterialCodesEntity.htm) |
| PriceListProductTiers | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListProductTiersEntity.htm) |
| PriceListProducts | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListProductsEntity.htm) |
| PriceListRoles | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListRolesEntity.htm) |
| PriceListServiceBundles | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListServiceBundlesEntity.htm) |
| PriceListServices | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListServicesEntity.htm) |
| PriceListWorkTypeModifiers | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PriceListWorkTypeModifiersEntity.htm) |
| TaxCategories | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaxCategoriesEntity.htm) |
| TaxRegions | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaxRegionsEntity.htm) |
| Taxes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaxesEntity.htm) |
| WorkTypeModifiers | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/WorkTypeModifiersEntity.htm) |

**Inventory and procurement**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| InventoryItemSerialNumbers | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryItemSerialNumbersEntity.htm) |
| InventoryItems | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryItemsEntity.htm) |
| InventoryLocations | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryLocationsEntity.htm) |
| InventoryProducts | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryProductsEntity.htm) |
| InventoryStockedItems | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryProductsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| InventoryStockedItemsAdd | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryProductsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| InventoryStockedItemsRemove | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryProductsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| InventoryStockedItemsTransfer | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryProductsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| InventoryTransfers | Y | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryTransfersEntity.htm) |
| ProductNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProductNotesEntity.htm) |
| ProductTiers | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProductTiersEntity.htm) |
| ProductVendors | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProductVendorsEntity.htm) |
| Products | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProductsEntity.htm) |
| PurchaseApprovals | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PurchaseApprovalsEntity.htm) |
| PurchaseOrderItemReceiving | Y | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PurchaseOrderItemReceivingEntity.htm) |
| PurchaseOrderItems | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PurchaseOrderItemsEntity.htm) |
| PurchaseOrders | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PurchaseOrdersEntity.htm) |
| SalesOrderAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SalesOrderAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| SalesOrders | Y | — | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SalesOrdersEntity.htm) |
| ShippingTypes | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ShippingTypesEntity.htm) |

**Knowledge**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| ArticleAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleAttachmentsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ArticleConfigurationItemCategoryAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleConfigurationItemCategoryAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ArticleNotes | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleNotesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ArticlePlainTextContent | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticlePlainTextContentEntity.htm) |
| ArticleTagAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleTagAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ArticleTicketAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleTicketAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ArticleToArticleAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleToArticleAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ArticleToDocumentAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ArticleToDocumentAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentAttachmentsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentCategories | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentCategoriesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentChecklistItems | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentChecklistItemsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentChecklistLibraries | — | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentChecklistLibrariesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentConfigurationItemAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentConfigurationItemAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentConfigurationItemCategoryAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentConfigurationItemCategoryAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentNotes | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentNotesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentTagAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentTagAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentTicketAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentTicketAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DocumentToArticleAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentToArticleAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| Documents | Y | Y | Y | Y | N | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DocumentsEntity.htm) |
| KnowledgeBaseArticles | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/KnowledgeBaseArticlesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| KnowledgeBaseCategories | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/KnowledgeBaseCategoriesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |

**Platform administration**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| CompanyWebhookExcludedResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookExcludedResourcesEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| CompanyWebhookField | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| CompanyWebhookUdfFields | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookUdfFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| CompanyWebhooks | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhooksEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemWebhookExcludedResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookExcludedResourcesEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemWebhookFields | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemWebhookUdfFields | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookUdfFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ConfigurationItemWebhooks | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhooksEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ContactWebhook | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhooksEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ContactWebhookExcludedResource | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookExcludedResourcesEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ContactWebhookField | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ContactWebhookUdfField | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookUdfFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| Modules | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ModulesEntity.htm) |
| TicketNoteWebhookExcludedResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookExcludedResourcesEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketNoteWebhookFields | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketNoteWebhooks | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhooksEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketWebhookExcludedResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookExcludedResourcesEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketWebhookFields | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketWebhookUdfFields | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhookUdfFieldsEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketWebhooks | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/REST_WebhooksEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| UserDefinedFieldDefinitions | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/UserDefinedFieldDefinitionsEntity.htm) |
| UserDefinedFieldListItems | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/UserDefinedFieldListItemsEntity.htm) |
| Version | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/VersionEntity.htm) |
| WebhookEventErrorLogs | Y | — | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/WebhookEventErrorLogEntity.htm) Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types. Index label differs from documented entity name; resolve exact runtime spelling and route. |

**Projects**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| ChangeOrderCharges | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ChangeOrderChargesEntity.htm) Update requires the documented Billing flag to be false; verify the effective API rule. Delete requires the documented Billing flag to be false; verify the effective API rule. |
| DeletedTaskActivityLogs | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DeletedTaskActivityLogsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| Phases | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/PhasesEntity.htm) |
| ProjectAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProjectAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| ProjectCharges | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProjectChargesEntity.htm) Update requires the documented Billing flag to be false; verify the effective API rule. Delete requires the documented Billing flag to be false; verify the effective API rule. |
| ProjectNoteAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProjectNoteAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ProjectNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProjectNotesEntity.htm) |
| Projects | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ProjectsEntity.htm) |
| TaskAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| TaskNoteAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskNoteAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TaskNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskNotesEntity.htm) |
| TaskPredecessors | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskPredecessorsEntity.htm) Update is limited to lag days; preserve other relationship attributes. |
| TaskSecondaryResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskSecondaryResourcesEntity.htm) |
| Tasks | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TasksEntity.htm) |

**Reference catalogs**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| Countries | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CountriesEntity.htm) |
| ServiceBundleServices | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceBundleServicesEntity.htm) |
| ServiceBundles | Y | Y | Y | Y | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceBundlesEntity.htm) |
| ServiceLevelAgreementResults | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceLevelAgreementResultsEntity.htm) |
| Services | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServicesEntity.htm) |
| SurveyResults | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SurveyResultsEntity.htm) |
| Surveys | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SurveysEntity.htm) |
| TagAliases | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TagAliasesEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TagGroups | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TagGroupsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| Tags | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TagsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |

**Resources and scheduling**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| Appointments | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/AppointmentsEntity.htm) |
| Departments | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DepartmentsEntity.htm) |
| HolidaySets | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/HolidaySetsEntity.htm) |
| Holidays | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/HolidaysEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| InternalLocationWithBusinessHours | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InternalLocationWithBusinessHoursEntity.htm) |
| InternalLocations | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InternalLocationsEntity.htm) |
| OrganizationalLevel1 | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OrganizationalLevel1Entity.htm) |
| OrganizationalLevel2 | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OrganizationalLevel2Entity.htm) |
| OrganizationalLevelAssociations | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OrganizationalLevelAssociationsEntity.htm) |
| OrganizatonalResources | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OrganizatonalResourcesEntity.htm) |
| ResourceAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ResourceDailyAvailabilities | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceDailyAvailability.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ResourceRoleDepartments | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceRoleDepartmentsEntity.htm) |
| ResourceRoleQueues | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceRoleQueuesEntity.htm) |
| ResourceRoles | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceRolesEntity.htm) |
| ResourceServiceDeskRoles | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceServiceDeskRolesEntity.htm) |
| ResourceSkills | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceSkillsEntity.htm) |
| ResourceTimeOffAdditional | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceTimeOffAdditionalEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ResourceTimeOffApprovers | Y | N | N | N | N | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceTimeOffApproversEntity.htm) |
| ResourceTimeOffBalances | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourceTimeOffBalanceEntity.htm) |
| Resources | Y | N | Y | N | N | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourcesEntity.htm) |
| Roles | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/RolesEntity.htm) |
| ServiceCallTaskResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceCallTaskResourceEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ServiceCallTasks | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceCallTasksEntity.htm) |
| ServiceCallTicketResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceCallTicketResourceEntity.htm) |
| ServiceCallTickets | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceCallTicketsEntity.htm) |
| ServiceCalls | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceCallsEntity.htm) |
| Skills | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SkillsEntity.htm) |
| TimeOffRequests | Y | Y | Y | N | N | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeOffRequestsEntity.htm) |
| TimeOffRequestsApprove | N | Y | N | N | N | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeOffRequestsApproveEntity.htm) |
| TimeOffRequestsReject | N | Y | N | N | N | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeOffRequestsRejectEntity.htm) |

**Sales and quoting**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| Opportunities | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OpportunitiesEntity.htm) |
| OpportunityAttachments | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OpportunitiesEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| OpportunityCategories | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OpportunityCategories.htm) |
| QuoteItems | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuoteItemsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| QuoteLocations | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuoteLocationsEntity.htm) |
| QuoteTemplates | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuoteTemplatesEntity.htm) |
| Quotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuotesEntity.htm) |

**Service desk**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| ChangeRequestLinks | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ChangeRequestLinksEntity.htm) |
| ChecklistLibraries | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ChecklistLibrariesEntity.htm) |
| ChecklistLibraryChecklistItems | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ChecklistLibraryChecklistItemsEntity.htm) |
| DeletedTicketActivityLogs | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DeletedTicketActivityLogsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| DeletedTicketLogs | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/DeletedTicketLogsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| NotificationHistory | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/NotificationHistoryEntity.htm) |
| TicketAdditionalConfigurationItems | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketAdditionalConfigurationItemsEntity.htm) |
| TicketAdditionalContacts | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketAdditionalContactsEntity.htm) |
| TicketAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| TicketCategories | Y | — | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketCategoriesEntity.htm) |
| TicketCategoryFieldDefaults | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketCategoryFieldDefaultsEntity.htm) |
| TicketChangeRequestApprovals | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChangeRequestApprovalsEntity.htm) |
| TicketCharges | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChargesEntity.htm) Update requires the documented isBilled flag to be false; verify the effective API rule. Delete requires the documented isBilled flag to be false; verify the effective API rule. |
| TicketChecklistItems | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChecklistItemsEntity.htm) |
| TicketChecklistLibraries | — | Y | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChecklistLibrariesEntity.htm) |
| TicketHistory | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketHistoryEntity.htm) |
| TicketNoteAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketNoteAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| TicketNotes | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketNotesEntity.htm) |
| TicketRmaCredits | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketRmaCreditsEntity.htm) |
| TicketSecondaryResources | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketSecondaryResourcesEntity.htm) |
| TicketTagAssociations | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketTagAssociationsEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |
| Tickets | Y | Y | Y | — | Y | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketsEntity.htm) |

**Shared attachments**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| AttachmentInfo (REST API) | Y | — | — | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/AttachmentInfoEntity.htm) Index label differs from documented entity name; resolve exact runtime spelling and route. |

**Time and expenses**

| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |
| --- | --- | --- | --- | --- | --- | --- |
| ExpenseItemAttachment | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ExpenseItemAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. |
| ExpenseItems | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ExpenseItemsEntity.htm) |
| ExpenseReportAttachments | Y | Y | — | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ExpenseReportAttachmentsEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |
| ExpenseReports | Y | Y | Y | — | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ExpenseReportsEntity.htm) |
| TimeEntries | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeEntriesEntity.htm) |
| TimeEntryAttachments | Y | Y | Y | Y | — | [Reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeEntriesEntity.htm) Multiple entity references linked from index row; verify primary mapping. Index label differs from documented entity name; resolve exact runtime spelling and route. |

