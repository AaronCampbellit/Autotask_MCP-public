import assert from 'node:assert/strict';
import test from 'node:test';
import {WorkManagementMetadata} from '../packages/work-management/src/metadata.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {MemoryPrincipalStore} from '../packages/storage/src/index.js';
import {FixtureUnlimitedRequestBudget} from '../packages/autotask/src/budget.js';
import {expenseItemAddSchema} from '../packages/work-management/src/contracts.js';

function setup(){const p=fixturePrincipals()[0]!,store=new MemoryPrincipalStore([p]),budget=new FixtureUnlimitedRequestBudget(),calls:string[]=[];
 const field=(name:string,type:string,isReadOnly=false)=>({name,dataType:type,isReadOnly});
 const pick=(name:string,values:Record<string,string>,isReadOnly=false)=>({...field(name,'integer',isReadOnly),isPickList:true,picklistValues:Object.entries(values).map(([value,label])=>({value,label,isActive:true}))});
 const data:Record<string,unknown>={
  'TimeEntries/entityInformation/fields':{fields:[field('resourceID','integer'),field('roleID','integer'),field('billingCodeID','integer'),field('hoursWorked','decimal'),field('summaryNotes','string')]},
  'BillingCodes/entityInformation/fields':{fields:[pick('useType',{'42':'Work Type'})]},
  'ExpenseReports/entityInformation/fields':{fields:[pick('status',{'81':'In Progress','85':'Rejected','89':'Awaiting Approval'},true)]},
  'ExpenseItems/entityInformation/fields':{fields:[field('expenseReportID','integer'),field('expenseDate','datetime'),field('description','string'),field('expenseCategory','integer'),field('workType','integer'),field('expenseCurrencyExpenseAmount','decimal'),field('expenseCurrencyID','integer'),field('paymentType','integer'),field('haveReceipt','boolean'),field('isBillableToCompany','boolean'),field('companyID','integer')]},
  'TimeOffRequests/entityInformation/fields':{fields:[pick('status',{'31':'Submitted','37':'Canceled'})]},
  'Roles/501':{item:{id:501,isActive:true}},'BillingCodes/601':{item:{id:601,isActive:true,useType:42}},'Currencies/4':{item:{id:4,isActive:true}},
  'ResourceRoles/query':{items:[{id:1,resourceID:p.resourceId,roleID:501,isActive:true}],pageDetails:{nextPageUrl:null}},
 };
 const metadata=new WorkManagementMetadata({tenantId:p.tenantId,baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'fixture',secret:'fixture',integrationCode:'fixture',principals:store,requestBudget:budget,fetch:async(url,init)=>{const path=new URL(String(url)).pathname.split('/v1.0/')[1]!;calls.push(path);assert(['GET','POST'].includes(init!.method!));return Response.json(data[path]??{});}});return{p,store,budget,metadata,data,calls};}

test('work status metadata resolves labels rather than assuming native numeric IDs',async()=>{const s=setup();assert.deepEqual(await s.metadata.resolveExpenseStatuses(s.p),{inProgress:81,rejected:85,submitted:89});assert.deepEqual(await s.metadata.resolveTimeOffStatuses(s.p),{submitted:31,canceled:37});});
test('expense metadata reflects readonly report status and writable explicit receipt/billable fields',async()=>{const s=setup();assert.equal(expenseItemAddSchema.safeParse({report_id:1,expense_date:'2026-09-14',description:'Lunch',category_id:2,work_type_id:3,amount:10,currency_id:4,payment_type_id:5,receipt:false,billable:false,request_key:'expense-item-1'}).success,true);assert.equal(expenseItemAddSchema.safeParse({report_id:1,expense_date:'2026-09-14',description:'Lunch',category_id:2,work_type_id:3,amount:10,currency_id:4,payment_type_id:5,receipt:false,request_key:'expense-item-2'}).success,false);assert.equal(expenseItemAddSchema.safeParse({report_id:1,expense_date:'2026-09-14',description:'Lunch',category_id:2,work_type_id:3,amount:10,currency_id:4,payment_type_id:5,receipt:false,billable:false,reimbursable:true,request_key:'expense-item-3'}).success,false);assert.equal(await s.metadata.validateExpense(s.p,{expenseReportID:1,expenseDate:'2026-09-14T00:00:00.000Z',description:'Lunch',expenseCategory:2,workType:3,expenseCurrencyExpenseAmount:10,expenseCurrencyID:4,paymentType:5,haveReceipt:false,isBillableToCompany:false}),true);});
test('time eligibility verifies active resource role and work-code classifications',async()=>{const s=setup(),payload={resourceID:s.p.resourceId,roleID:501,billingCodeID:601,hoursWorked:1,summaryNotes:'Verified performed work'};assert.equal(await s.metadata.validateTime(s.p,payload),true);s.data['ResourceRoles/query']={items:[{id:1,resourceID:999,roleID:501,isActive:true}],pageDetails:{nextPageUrl:null}};assert.equal(await s.metadata.validateTime(s.p,payload),false);assert.equal(await s.metadata.validateTime(s.p,{...payload,unknownField:'bad'}),false);});
test('work metadata rechecks revocation after budget admission before native reads',async()=>{const s=setup();s.budget.take=async()=>{s.store.set({...s.p,active:false});};await assert.rejects(s.metadata.resolveExpenseStatuses(s.p));assert.deepEqual(s.calls,[]);});

test('expense currency references must resolve to active native currencies',async()=>{
 const s=setup();s.data['ExpenseItems/entityInformation/fields']={fields:[{name:'expenseCurrencyID',dataType:'integer',isReadOnly:false},{name:'expenseCurrencyExpenseAmount',dataType:'decimal',isReadOnly:false}]};
 s.data['Currencies/12']={item:{id:12,name:'US Dollar',isActive:true}};
 const body={expenseCurrencyID:12,expenseCurrencyExpenseAmount:15};assert.equal(await s.metadata.validateExpense(s.p,body),true);
 s.data['Currencies/12']={item:{id:12,name:'US Dollar',isActive:false}};assert.equal(await s.metadata.validateExpense(s.p,body),false);
});

test('unavailable currency lookup preserves expense field metadata without inventing IDs',async()=>{
 const s=setup();const result=await s.metadata.choices(s.p,'expenses');
 assert.equal(result.status,'partial');assert.equal(result.currency_lookup,'unavailable');assert.equal(result.currencies,undefined);assert.ok(result.fields.ExpenseItems);
 await assert.rejects(s.metadata.validateExpense(s.p,{expenseCurrencyID:99}));
});

test('currency metadata reports effective API permission without querying a denied entity',async()=>{
 const s=setup();s.data['Currencies/entityInformation']={info:{canQuery:true,userAccessForQuery:'None'}};
 const result=await s.metadata.choices(s.p,'expenses');assert.equal(result.status,'partial');assert.deepEqual(result.currency_access,{can_query:true,query_access:'None'});assert.equal(s.calls.includes('Currencies/query'),false);
});
test('currency options return verified active choices after native read access is granted',async()=>{
 const s=setup();s.data['Currencies/entityInformation']={info:{canQuery:true,userAccessForQuery:'All'}};s.data['Currencies/query']={items:[{id:4,name:'USD',isActive:true,isInternalCurrency:true}],pageDetails:{nextPageUrl:null}};
 const result=await s.metadata.choices(s.p,'expenses');assert.equal(result.status,'succeeded');assert.equal(result.currency_lookup,'available');assert.equal(result.currencies?.[0]?.id,4);
});
