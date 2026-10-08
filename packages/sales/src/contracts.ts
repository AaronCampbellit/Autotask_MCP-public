import {fieldsSchema} from '../../native-fields/src/index.js';
import {personIdentitySchema,ownerIdentitySchema} from '../../contracts/src/person-identity.js';
import {z} from 'zod';
export const salesEntities=['Opportunities','Quotes','QuoteItems','QuoteTemplates','CompanyNotes'] as const;
export type SalesEntity=typeof salesEntities[number];
export const writableEntities=['Opportunities','Quotes','QuoteItems','CompanyNotes','QuoteLocations'] as const;
export type WritableEntity=typeof writableEntities[number];
export const fields:Record<SalesEntity| 'QuoteLocations',readonly string[]>={
 Opportunities:['id','companyID','title','description','ownerResourceID','contactID','stage','status','probability','projectedCloseDate','startDate','closedDate','lostDate','amount','cost','useQuoteTotals','opportunityCategoryID','leadSource','rating','nextStep','onetimeRevenue','onetimeCost','monthlyRevenue','monthlyCost','quarterlyRevenue','quarterlyCost','semiannualRevenue','semiannualCost','yearlyRevenue','yearlyCost','createDate','creatorResourceID','impersonatorCreatorResourceID','lastActivity'],
 Quotes:['id','companyID','opportunityID','name','description','comment','contactID','effectiveDate','expirationDate','approvalStatus','primaryQuote','isActive','quoteTemplateID','externalQuoteNumber','quoteNumber','billToLocationID','shipToLocationID','soldToLocationID','paymentTerm','paymentType','shippingType','taxRegionID','groupByID','purchaseOrderNumber','createDate','creatorResourceID','impersonatorCreatorResourceID','lastModifiedBy','lastActivityDate','extApprovalContactResponse','extApprovalResponseDate','lastPublishedDateTime','lastPublishedByResourceID'],
 QuoteItems:['id','quoteID','quoteItemType','name','description','quantity','unitPrice','unitCost','unitDiscount','percentageDiscount','lineDiscount','periodType','isOptional','productID','chargeID','laborID','expenseID','shippingID','serviceID','serviceBundleID','taxCategoryID','totalEffectiveTax','internalCurrencyUnitPrice','internalCurrencyUnitDiscount','internalCurrencyLineDiscount'],
 QuoteTemplates:['id','name','description','isActive','dateFormat','numberFormat','pageLayout','pageNumberFormat','currencyNegativeFormat','currencyPositiveFormat'],
 CompanyNotes:['id','companyID','opportunityID','name','note','actionType','assignedResourceID','contactID','startDateTime','endDateTime','createDateTime','lastModifiedDate','impersonatorCreatorResourceID','impersonatorUpdaterResourceID'],
 QuoteLocations:['id','address1','address2','city','state','postalCode'],
};
export const writeFields:Record<WritableEntity,readonly string[]>={
 Opportunities:fields.Opportunities.filter(f=>!['id','createDate','creatorResourceID','impersonatorCreatorResourceID','lastActivity'].includes(f)),
 Quotes:fields.Quotes.filter(f=>!['id','quoteNumber','createDate','creatorResourceID','impersonatorCreatorResourceID','lastModifiedBy','lastActivityDate','extApprovalContactResponse','extApprovalResponseDate','lastPublishedDateTime','lastPublishedByResourceID'].includes(f)),
 QuoteItems:fields.QuoteItems.filter(f=>!['id','totalEffectiveTax','internalCurrencyUnitPrice','internalCurrencyUnitDiscount','internalCurrencyLineDiscount'].includes(f)),
 CompanyNotes:fields.CompanyNotes.filter(f=>!['id','createDateTime','lastModifiedDate','impersonatorCreatorResourceID','impersonatorUpdaterResourceID'].includes(f)),
 QuoteLocations:fields.QuoteLocations.filter(f=>f!=='id'),
};
export const id=z.number().int().positive().safe(),company=z.union([z.number().int().nonnegative().safe(),z.string().trim().min(1).max(250)]);
export const searchSchema=z.object({company:company.optional(),opportunity_id:id.optional(),quote_id:id.optional(),text:z.string().min(1).max(250).optional(),status:z.union([z.number().int(),z.string().min(1).max(100)]).optional(),stage:z.union([z.number().int(),z.string().min(1).max(100)]).optional(),owner:z.union([id,z.literal('self')]).optional(),page_size:z.number().int().min(1).max(100).default(25),cursor:z.string().max(16000).optional()}).strict();
export const countSchema=searchSchema.omit({page_size:true,cursor:true});
export function searchSchemaFor(entity: SalesEntity, countOnly=false) {
 const mask: Record<string,true> = {text:true};
 if(!countOnly){mask.page_size=true;mask.cursor=true;}
 if(entity!=='QuoteTemplates')mask.company=true;
 if(entity!=='QuoteTemplates')mask.opportunity_id=true;
 if(entity==='Quotes'||entity==='QuoteItems')mask.quote_id=true;
 if(entity==='Opportunities'||entity==='Quotes')mask.status=true;
 if(entity==='Opportunities'){mask.stage=true;mask.owner=true;}
 const schema=searchSchema.pick(mask as Record<keyof typeof searchSchema.shape,true>);
 return entity==='QuoteItems'?schema.required({quote_id:true}):entity==='CompanyNotes'?schema.required({opportunity_id:true}):schema;
}
export const getSchema=z.object({id}).strict();
export const key=z.string().min(8).max(128).refine(v=>!/^(wf:|sch:|job:)/.test(v));
export const data = fieldsSchema;
export const createSchema=z.object({contact_identity:personIdentitySchema.optional(),owner_identity:ownerIdentitySchema.optional(),company:company.optional(),opportunity_id:id.optional(),quote_id:id.optional(),fields:data,location_source_quote_id:id.optional(),location_tokens:z.array(z.string().max(16000)).max(3).optional(),request_key:key}).strict();
export const updateSchema=z.object({contact_identity:personIdentitySchema.optional(),owner_identity:ownerIdentitySchema.optional(),id,fields:data,expected:data,location_source_quote_id:id.optional(),location_tokens:z.array(z.string().max(16000)).max(3).optional(),request_key:key}).strict();
export const deleteSchema=z.object({id,quote_id:id,expected:data,request_key:key}).strict();
export const schemaSchema=z.object({entity:z.enum([...salesEntities,'QuoteLocations']),include_udfs:z.boolean().optional()}).strict();
export const compareSchema=z.object({quote_ids:z.array(id).min(2).max(5)}).strict();
export const receiptSchema=z.object({operation_id:z.string().uuid()}).strict();
export const quoteOpportunityPdfSearchSchema=z.object({quote_id:id,page_size:z.number().int().min(1).max(100).default(25),cursor:z.string().max(16000).optional()}).strict();
export const quoteOpportunityPdfGetSchema=z.object({quote_id:id,note_id:id,attachment_id:id,offset:z.number().int().min(0).max(7000000).default(0),length:z.number().int().min(1).max(262144).default(262144)}).strict();
export const quoteWorkflowPrepareSchema=z.object({quote_id:id,purpose:z.enum(['send','pdf','acceptance','convert'])}).strict();
export const referenceEntities=['Products','Services','ServiceBundles','Roles','BillingCodes','ShippingTypes','TaxCategories','Contacts','Resources'] as const;
export const referenceSchema=z.object({entity:z.enum(referenceEntities),company:company.optional(),text:z.string().min(1).max(250).optional(),page_size:z.number().int().min(1).max(100).default(25),cursor:z.string().max(16000).optional()}).strict();

export const closedNoteConfirmSchema=z.object({confirmation_token:z.string().min(1).max(180000),approve_reopen_and_restore:z.literal(true)}).strict();
