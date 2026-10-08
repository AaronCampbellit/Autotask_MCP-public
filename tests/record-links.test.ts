import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recordWebUrl} from '../packages/technician/src/web-links.js';
import {addRecordLinks} from '../apps/server/src/record-links.js';
import {createFixtureSystem} from '../apps/server/src/fixture-system.js';
const link = (entity: string, id: unknown) => recordWebUrl(['ww1.autotask.net'], entity, id);
const enrich = (name: string, value: unknown, input?: unknown) => addRecordLinks(name, value, link, input) as any;

test('documented routes use exact commands and parameter names', () => {
  const cases = [
    ['Tickets','OpenTicketDetail','TicketID'],['Companies','OpenAccount','AccountID'],
    ['Contacts','OpenContact','ContactID'],['Opportunities','OpenOpportunity','OpportunityID'],
    ['Quotes','OpenQuote','ID'],['Projects','OpenProject','ProjectID'],['Tasks','OpenTaskDetail','TaskID'],
    ['Contracts','OpenContract','ContractID'],['ConfigurationItems','EditInstalledProduct','InstalledProductID'],
    ['TimeEntries','EditTimeEntry','WorkEntryID'],['Appointments','OpenAppointment','AppointmentID'],
    ['KnowledgebaseArticles','OpenKBArticle','ID'],['SalesOrders','OpenSalesOrder','SalesOrderID'],
    ['ServiceCalls','OpenServiceCall','ServiceCallID'],['CompanyToDos','OpenToDo','ToDoID'],
  ];
  for (const [entity,code,param] of cases) assert.equal(link(entity!, 123), `https://ww1.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx?Code=${code}&${param}=123`);
  for (const entity of ['Invoices','QuoteItems','Products','Resources','TimeOffRequests','__proto__','constructor','']) assert.equal(link(entity,123),undefined);
  for (const id of [null,undefined,'123',-1,0,1.1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) assert.equal(link('Projects',id),undefined);
});

test('read surfaces attach only to known record positions without changing text or completeness', () => {
  const text = {id:999,entity:'Projects',description:'untrusted record'};
  const source = {status:'partial',data:[{id:123,description:text}],completeness:{complete:false,next_cursor:'cursor'}};
  const result = enrich('project_search',source);
  assert.equal(result.data[0].web_url,link('Projects',123));
  assert.deepEqual(result.data[0].description,text);
  assert.deepEqual(result.completeness,source.completeness);
  assert.equal((source.data[0] as any).web_url,undefined);
  assert.equal(enrich('project_get',{data:{title:'projection without ID'}}).data.web_url,undefined);
  assert.equal(enrich('invoice_get',{data:{id:123}}).data.web_url,undefined);
  for (const [prefix,entity] of [['opportunity','Opportunities'],['quote','Quotes'],['task','Tasks'],['contract','Contracts'],['asset','ConfigurationItems'],['crm_todo','CompanyToDos'],['time','TimeEntries']]) {
    assert.equal(enrich(`${prefix}_get`,{data:{id:123}}).data.web_url,link(entity!,123));
    assert.equal(enrich(`${prefix}_search`,{data:[{id:123}]}).data[0].web_url,link(entity!,123));
  }
  assert.equal(enrich('contact_search',{contacts:[{id:123}]}).contacts[0].web_url,link('Contacts',123));
  assert.equal(enrich('contact_get',{contact:{id:123}}).contact.web_url,link('Contacts',123));
  assert.equal(enrich('sales_reference_search',{data:[{id:123}]},{entity:'Contacts'}).data[0].web_url,link('Contacts',123));
  assert.equal(enrich('at_query',{data:{entity:'Companies',items:[{id:123}]}}).data.items[0].web_url,link('Companies',123));
  assert.equal(enrich('at_related',{data:{entity:'TimeEntries',items:[{id:123}]}}).data.items[0].web_url,link('TimeEntries',123));
});

test('context, time, schedule, comparisons and quote handoffs retain shape', () => {
  assert.equal(enrich('project_context',{project:{id:123},tasks:{data:[{id:124}]}}).tasks.data[0].web_url,link('Tasks',124));
  assert.equal(enrich('contract_context',{contract:{id:123}}).contract.web_url,link('Contracts',123));
  assert.equal(enrich('quote_compare',{data:[{quote:{id:123},items:[]}]}).data[0].quote.web_url,link('Quotes',123));
  const handoff = enrich('quote_workflow_prepare',{quote_id:123,context:{quote:{id:123},opportunity:{id:124}},handoff:{path:'native workflow'}});
  assert.equal(handoff.web_url,link('Quotes',123));assert.equal(handoff.context.opportunity.web_url,link('Opportunities',124));assert.equal(handoff.handoff.path,'native workflow');
  assert.equal(enrich('schedule_search',{data:{entries:[{id:123}]}}).data.entries[0].web_url,link('ServiceCalls',123));
  assert.equal(enrich('time_entry_search',{data:{entries:[{id:123}]}}).data.entries[0].web_url,link('TimeEntries',123));
  assert.equal(enrich('my_workday',{data:{tasks:{items:[{id:123}]},time:{items:[{id:124}]}}}).data.tasks.items[0].web_url,link('Tasks',123));
  assert.equal(enrich('ticket_context',{data:{collections:{assets:{items:[{id:123}]}}}}).data.collections.assets.items[0].web_url,link('ConfigurationItems',123));
});

test('visit links identify the service call and contact evidence', () => {
  const visit = enrich('ticket_prepare_visit',{data:{appointment:{id:123},collections:{contact:{items:[{id:124}]}}}});
  assert.equal(visit.data.appointment.web_url,link('ServiceCalls',123));
  assert.equal(visit.data.collections.contact.items[0].web_url,link('Contacts',124));
});

test('receipts use native IDs, preserve state, omit deleted targets and unknown creates', () => {
  for (const tool of ['project_create','business_operation_status','sales_operation_status','at_operation_status']) {
    const receipt = enrich(tool,{status:'accepted_unverified',operation_id:'op',entity:'Projects',action:'create',native_id:123});
    assert.equal(receipt.web_url,link('Projects',123));assert.equal(receipt.status,'accepted_unverified');
  }
  assert.equal(enrich('project_create',{operation_id:'op',entity:'Projects',id:123}).web_url,undefined);
  assert.equal(enrich('business_operation_status',{operation_id:'op',entity:'Projects',action:'delete',native_id:123}).web_url,undefined);
  const receipt = enrich('at_operation_status',{operation_id:'op',data:{ticket_id:1,web_url:link('Tickets',1),time_entry_id:123}});
  assert.equal(receipt.data.web_url,link('Tickets',1));assert.equal(receipt.data.time_entry_web_url,link('TimeEntries',123));
  assert.equal(enrich('service_call_create',{operation_id:'op',data:{service_call_id:123}}).data.web_url,link('ServiceCalls',123));
});

test('runtime generic company/time reads and workday integrate enrichment; ticket URL aliases round trip', async t => {
  const s=createFixtureSystem();t.after(()=>s.app.close());const p=s.principals[0]!;
  const call=(name:string,input:unknown)=>s.runtime.invoke(p,name,input) as Promise<any>;
  const companies=await call('at_query',{entity:'Companies'});
  for(const company of companies.data.items) assert.equal(company.web_url,link('Companies',company.id));
  const times=await call('time_entry_search',{ticket:{kind:'id',id:1001}});
  for(const entry of times.data.entries) assert.equal(entry.web_url,link('TimeEntries',entry.id));
  const day=await call('my_workday',{date:'2026-09-10',timezone:'America/Chicago'});
  for(const task of day.data.tasks.items) assert.equal(task.web_url,link('Tasks',task.id));
  for(const code of ['OpenTicket','OpenTicketDetail']) {
    const context=await call('ticket_context',{ticket:{kind:'ticket_url',value:link('Tickets',1001)!.replace('OpenTicketDetail',code)},purpose:'custom',collections:['notes']});
    assert.equal(context.data.ticket.web_url,link('Tickets',1001));
  }
});

test('opportunity and quote creation receipts link their own returned native IDs',()=>{
 for(const [operation,entity] of [['opportunity_create','Opportunities'],['quote_create','Quotes']]){
  const result=enrich(operation!,{status:'succeeded_verified',operation_id:'saved',entity,action:'create',native_id:232});
  assert.equal(result.web_url,link(entity!,232));
  assert.equal(enrich(operation!,{status:'unknown_outcome',operation_id:'unknown',entity,action:'create'}).web_url,undefined);
 }
});
