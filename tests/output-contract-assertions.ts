import assert from 'node:assert/strict';
import { successSchemaFor } from '../apps/server/src/output-contracts.js';
import { businessToolDefinitions } from '../packages/business/src/tools.js';
import { salesToolDefinitions } from '../packages/sales/src/tools.js';
/** Applies contracts to real service responses in existing native-shaped fixtures.
 * No result transformation, mocked schema, production hook or network access. */
export function checkServiceContracts(service:object,family:'business'|'sales'|'work') {
 const named:Record<string,string> = family==='business'?{schema:'business_schema',operationStatus:'business_operation_status',contractContext:'contract_context',projectContext:'project_context',invoiceContext:'invoice_context',invoiceExport:'invoice_export',trueUp:'billing_true_up'}:family==='sales'?{confirmClosedNote:'opportunity_note_confirm_reopen',schema:'sales_schema',operationStatus:'sales_operation_status',compare:'quote_compare',referenceSearch:'sales_reference_search',workflowInspect:'quote_workflow_inspect',quoteWorkflowPrepare:'quote_workflow_prepare',quoteOpportunityPdfSearch:'quote_opportunity_pdf_search',quoteOpportunityPdfGet:'quote_opportunity_pdf_get'}:{searchTime:'time_search',getTime:'time_get',logTask:'time_log_task',logInternal:'time_log_internal',correctTime:'time_correct',deleteTime:'time_delete',createExpenseReport:'expense_report_create',addExpenseItem:'expense_item_add',submitExpenseReport:'expense_report_submit',expenseReportStatus:'expense_report_status',availability:'resource_availability',updateAvailability:'resource_availability_update',timeOffSearch:'time_off_search',timeOffRequest:'time_off_request',timeOffCancel:'time_off_cancel',operationStatus:'work_operation_status'};
 const instance=service as Record<string,any>;
 for(const method of [...Object.keys(named),...(family==='work'?[]:['search','get','write'])]){
  if(typeof instance[method]!=='function')continue;
  const original=instance[method].bind(service);
  instance[method]=async(...args:any[])=>{
   const result=await original(...args);
   const action=method==='write'?args[2]:method;
   const name=named[method]??(family==='business'?Object.entries(businessToolDefinitions).find(([,v])=>v.entity===args[1]&&v.action===action)?.[0]:salesToolDefinitions.find(([,entity,a])=>entity===args[1]&&a===action)?.[0]);
   // Some service-internal calls inspect entities with no exposed get/search tool.
   if(name){const checked=successSchemaFor(name).safeParse(result);assert(checked.success,`${name}: ${checked.success?'':checked.error.message}`);}
   return result;
  };
 }
}
