import {checkServiceContracts} from './output-contract-assertions.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {SalesService} from '../packages/sales/src/index.js';
import {salesTools,salesOperations} from '../packages/sales/src/tools.js';
import {fields,writeFields} from '../packages/sales/src/contracts.js';
import {MemoryJournal,MemoryPrincipalStore,IntentCipher,redactJournalResult} from '../packages/storage/src/index.js';
import {FixtureAutotaskAdapter,fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {TicketWorkflows} from '../packages/workflows/src/index.js';
import {FixtureUnlimitedRequestBudget} from '../packages/autotask/src/budget.js';
import {reauthorize} from '../packages/policy/src/index.js';
import type {Principal} from '../packages/contracts/src/index.js';
const code=(code:string)=>(e:any)=>e.code===code;
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function setup(){
 const p={...fixturePrincipals()[0]!,capabilities:['operational.read','finance.read','sales.write'] as Principal['capabilities'],resourceVerifiedAt:new Date().toISOString()};
 const store=new MemoryPrincipalStore([p]),adapter=new FixtureAutotaskAdapter(p=>reauthorize(p,store)),journal=new MemoryJournal(),core=new TicketWorkflows(adapter,store,journal);
 const pdf=Buffer.from('%PDF-1.7\n%%EOF');const rows:Record<string,any[]>={Opportunities:[{id:100,companyID:10,title:'Existing',status:1,stage:7,ownerResourceID:p.resourceId,probability:50,amount:100,cost:50,useQuoteTotals:false}],Quotes:[{id:200,companyID:10,opportunityID:100,name:'Quote',billToLocationID:300,shipToLocationID:300,soldToLocationID:300,effectiveDate:'2026-09-01',expirationDate:'2026-10-01'}],QuoteItems:[{id:400,quoteID:200,quoteItemType:1,name:'PC',quantity:1,unitPrice:100,unitCost:50,unitDiscount:0,lineDiscount:0,percentageDiscount:0,periodType:1,isOptional:false}],QuoteLocations:[{id:300,address1:'123 Main',city:'Houston'}],CompanyNotes:[{id:800,companyID:10,opportunityID:100,name:'Customer response',actionType:3,startDateTime:'2026-09-14T10:00:00Z',endDateTime:'2026-09-14T10:01:00Z'}],CompanyNoteAttachments:[{id:850,companyID:10,companyNoteID:800,opportunityID:100,title:'Accepted Quote.pdf',contentType:'application/pdf',attachmentType:'FILE_ATTACHMENT',publish:1,fileSize:pdf.length,data:pdf.toString('base64')}],QuoteTemplates:[{id:600,name:'Standard'}],Resources:[{id:p.resourceId,isActive:true,resourceType:'Employee'}],Products:[{id:900,name:'PC',isActive:true}],Contacts:[{id:700,companyID:99,isActive:true}]};
 const picklists:Record<string,Array<[number,string]>>={status:[[1,'Active'],[2,'Lost'],[3,'Closed'],[4,'Implemented']],stage:[[7,'Proposal']],approvalStatus:[[1,'Not Requested'],[3,'Approved']],periodType:[[1,'One-Time'],[4,'Semi-Annual']],quoteItemType:[[1,'Product'],[2,'Cost'],[3,'Labor'],[4,'Expense'],[6,'Shipping'],[10,'Discount'],[11,'Service'],[12,'ServiceBundle'],[13,'ContractSetupFee']],actionType:[[0,'Opportunity Update'],[3,'General']]};
 const required:Record<string,string[]>={Opportunities:['companyID','title','amount','cost','ownerResourceID','probability','projectedCloseDate','startDate','stage','status','useQuoteTotals'],Quotes:['name','effectiveDate','expirationDate','billToLocationID','shipToLocationID','soldToLocationID'],QuoteItems:['quoteItemType','quantity','isOptional','unitDiscount','percentageDiscount','lineDiscount'],CompanyNotes:['companyID','actionType','assignedResourceID','startDateTime','endDateTime'],QuoteLocations:[]};
 const metadata=(entity:string)=>({fields:((fields as any)[entity]??['id','name','isActive']).map((name:string)=>({name,isReadOnly:name==='id',isRequired:required[entity]?.includes(name)??false,isQueryable:true,length:32000,dataType:picklists[name]||/ID$/.test(name)||name==='id'?'integer':/Date|DateTime/.test(name)?'datetime':['isActive','useQuoteTotals','primaryQuote','isOptional'].includes(name)?'boolean':['quantity','probability','amount','cost','unitPrice','unitCost','unitDiscount','lineDiscount','percentageDiscount'].includes(name)?'decimal':'string',isPickList:!!picklists[name],picklistValues:picklists[name]?.map(([value,label])=>({value:String(value),label,isActive:true}))}))});
 const requests:Array<{path:string;method:string;body:any;headers:Headers}>=[];let next=1000;let intercept:((request:any)=>Response|undefined|Promise<Response|undefined>)|undefined;
 const fetcher:typeof fetch=async(url,init)=>{const u=new URL(String(url)),path=u.pathname.replace('/atservicesrest/v1.0/',''),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined,request={path,method,body,headers:new Headers(init?.headers)};requests.push(request);const custom=await intercept?.(request);if(custom)return custom;
  const entity=path.split('/')[0]!;if(path.endsWith('/entityInformation/fields'))return json(metadata(entity));
  if(path.endsWith('/query')){const f=body?.filter??[];return json({items:(rows[entity]??[]).filter(row=>f.every((f:any)=>f.op==='eq'?row[f.field]===f.value:f.op==='in'?f.value.includes(row[f.field]):f.op==='contains'?String(row[f.field]).toLowerCase().includes(f.value.toLowerCase()):true)).slice(0,body?.MaxRecords??100),pageDetails:{nextPageUrl:null}});}
  if(method==='GET'){const row=rows[entity]?.find(r=>r.id===Number(path.split('/')[1]));return row?json({item:row}):json({},404);}
  const target=path.includes('/Items')?'QuoteItems':path.includes('/Notes')?'CompanyNotes':entity;
  if(method==='POST'){const item={...body,id:next++};(rows[target]??=[]).push(item);return json({itemId:item.id});}
  if(method==='PATCH'){const row=rows[target]?.find(r=>r.id===body.id);Object.assign(row,body);return json({itemId:body.id});}
  if(method==='DELETE'){const id=Number(path.split('/').at(-1));rows[target]=rows[target]!.filter(r=>r.id!==id);return new Response(null,{status:204});}
  return json({},400);
 };
 const s=new SalesService(core,new IntentCipher(Buffer.alloc(32,8)),{tenantId:p.tenantId,baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'api',secret:'secret',integrationCode:'integration',requestBudget:new FixtureUnlimitedRequestBudget(),writesEnabled:true,fetch:fetcher});
 checkServiceContracts(s,'sales');return{s,p,store,rows,requests,journal,setIntercept:(f:typeof intercept)=>intercept=f};
}
const oppFields={title:'New opportunity',amount:100,cost:25,probability:50,stage:'Proposal',status:'Active',projectedCloseDate:'2026-10-01',startDate:'2026-09-01'};
test('sales tools have distinct permissions and delivery helpers are read-only',()=>{const s=setup();assert.equal(salesTools(s.s).length,29);for(const [name,op]of Object.entries(salesOperations)){assert.ok(op.capabilities.includes('finance.read'));if(op.write)assert.ok(op.capabilities.includes('sales.write'));if(/quote_opportunity_pdf|quote_workflow_prepare/.test(name))assert.equal(op.write,false);}});
test('pipeline queries preserve company, owner and status and omit employee header on reads',async()=>{const s=setup();const r=await s.s.search(s.p,'Opportunities',{company:10,owner:'self',status:'Active'});assert.equal(r.data.length,1);const q=s.requests.find(r=>r.path==='Opportunities/query')!;assert.ok(q.body.filter.some((f:any)=>f.field==='companyID'&&f.value[0]===10));assert.ok(q.body.filter.some((f:any)=>f.field==='ownerResourceID'&&f.value===s.p.resourceId));assert.equal(q.headers.has('ImpersonationResourceId'),false);});
test('sales financial access is required and foreign parents do not expose lines',async()=>{const s=setup();const denied={...s.p,capabilities:['operational.read'] as Principal['capabilities']};s.store.set(denied);await assert.rejects(s.s.get(denied,'Quotes',{id:200}),code('forbidden'));assert.equal(s.requests.length,0);s.store.set(s.p);s.rows.Opportunities![0].companyID=99;await assert.rejects(s.s.search(s.p,'QuoteItems',{quote_id:200}),code('not_found_or_inaccessible'));assert.equal(s.requests.some(r=>r.path==='QuoteItems/query'),false);});
test('no unsupported search filters are silently ignored',async()=>{const s=setup();await assert.rejects(s.s.search(s.p,'QuoteTemplates',{owner:'self'}),code('invalid_input'));await assert.rejects(s.s.search(s.p,'Opportunities',{quote_id:200}),code('invalid_input'));await assert.rejects(s.s.search(s.p,'QuoteItems',{}),code('invalid_input'));});
test('unsafe pagination is rejected and cursors bind filters and identity',async()=>{const s=setup();s.setIntercept(r=>r.path==='Opportunities/query'?json({items:[],pageDetails:{nextPageUrl:'https://evil.example/query'}}):undefined);await assert.rejects(s.s.search(s.p,'Opportunities',{}),code('dependency_unavailable'));s.setIntercept(r=>r.path.startsWith('Opportunities/query')?json({items:[],pageDetails:{nextPageUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/Opportunities/query?next=2'}}):undefined);const r=await s.s.search(s.p,'Opportunities',{});await assert.rejects(s.s.search(s.p,'Opportunities',{text:'different',cursor:r.completeness.next_cursor!}),code('conflict'));});
test('opportunity create verifies persisted data, records company and does not repeat a request key',async()=>{const s=setup(),args={company:10,fields:oppFields,request_key:'opportunity-new-1'};const r:any=await s.s.write(s.p,'Opportunities','create',args);assert.equal(r.status,'succeeded_verified');assert.equal(r.company_id,10);assert.ok(r.native_id);assert.equal((await s.s.write(s.p,'Opportunities','create',args) as any).operation_id,r.operation_id);assert.equal(s.requests.filter(r=>r.method==='POST'&&r.path==='Opportunities').length,1);assert.equal(s.requests.find(r=>r.method==='POST'&&r.path==='Opportunities')!.headers.get('ImpersonationResourceId'),String(s.p.resourceId));await assert.rejects(s.s.write(s.p,'Opportunities','create',{...args,fields:{...oppFields,title:'Changed'}}),code('conflict'));const record=await s.journal.get(r.operation_id,`${s.p.tenantId}:${s.p.objectId}`);assert.ok(record?.encryptedIntent);assert.equal(JSON.stringify(record).includes('New opportunity'),false);});
test('metadata required fields, picklists and company conflict fail before write',async()=>{const s=setup();await assert.rejects(s.s.write(s.p,'Opportunities','create',{company:10,fields:{title:'Incomplete'},request_key:'bad-fields-1'}),code('invalid_input'));await assert.rejects(s.s.write(s.p,'Opportunities','create',{company:10,fields:{...oppFields,status:'Invented'},request_key:'bad-fields-2'}),code('invalid_input'));await assert.rejects(s.s.write(s.p,'Opportunities','create',{company:10,fields:{...oppFields,companyID:99},request_key:'bad-fields-3'}),code('invalid_input'));assert.equal(s.requests.some(r=>r.method==='POST'&&!r.path.endsWith('/query')),false);});
test('update requires expected state and readback reports mismatch honestly',async()=>{const s=setup();await assert.rejects(s.s.write(s.p,'Opportunities','update',{id:100,fields:{title:'Changed'},expected:{title:'Wrong'},request_key:'update-bad-1'}),code('conflict'));s.setIntercept(r=>r.method==='PATCH'?json({itemId:100}):undefined);const r:any=await s.s.write(s.p,'Opportunities','update',{id:100,fields:{title:'Changed'},expected:{title:'Existing'},request_key:'update-good-1'});assert.equal(r.status,'accepted_unverified');assert.equal(s.rows.Opportunities![0].title,'Existing');});
test('unknown creates are never replayed and expose no false native ID',async()=>{const s=setup();s.setIntercept(r=>{if(r.method==='POST'&&r.path==='Opportunities')throw Error('connection lost');});const args={company:10,fields:oppFields,request_key:'unknown-create-1'};const r:any=await s.s.write(s.p,'Opportunities','create',args);assert.equal(r.status,'unknown_outcome');assert.equal(r.native_id,undefined);await s.s.write(s.p,'Opportunities','create',args);await s.s.operationStatus(s.p,{operation_id:r.operation_id});assert.equal(s.requests.filter(r=>r.path==='Opportunities'&&r.method==='POST').length,1);});
test('quote location tokens bind company and permit opportunity-linked quote creation',async()=>{const s=setup();const loc:any=await s.s.write(s.p,'QuoteLocations','create',{company:10,fields:{address1:'123 Test',city:'Houston'},request_key:'location-create-1'});assert.equal(loc.status,'succeeded_verified');assert.ok(loc.location_token);const fields={name:'Draft quote',primaryQuote:true,effectiveDate:'2026-09-01',expirationDate:'2026-10-01',billToLocationID:loc.native_id,shipToLocationID:loc.native_id,soldToLocationID:loc.native_id};await assert.rejects(s.s.write(s.p,'Quotes','create',{opportunity_id:100,fields,request_key:'quote-no-token'}),code('invalid_input'));const r:any=await s.s.write(s.p,'Quotes','create',{opportunity_id:100,fields,location_tokens:[loc.location_token],request_key:'quote-with-token'});assert.equal(r.status,'succeeded_verified');const quote=s.rows.Quotes!.find(q=>q.id===r.native_id);assert.equal(quote.companyID,10);assert.equal(quote.opportunityID,100);});
test('quote-line create uses parent path and validates discounts, then updates and deletes with readback',async()=>{const s=setup();const fields={quoteItemType:'Product',name:'Test PC',quantity:2,unitPrice:100,unitCost:50,unitDiscount:0,percentageDiscount:0,lineDiscount:0,periodType:'One-Time',isOptional:false};await assert.rejects(s.s.write(s.p,'QuoteItems','create',{quote_id:200,fields:{...fields,unitDiscount:1,lineDiscount:1},request_key:'bad-discounts'}),code('invalid_input'));const r:any=await s.s.write(s.p,'QuoteItems','create',{quote_id:200,fields,request_key:'line-create-1'});assert.equal(r.status,'succeeded_verified');assert.ok(s.requests.some(r=>r.path==='Quotes/200/Items'&&r.method==='POST'));const updated:any=await s.s.write(s.p,'QuoteItems','update',{id:r.native_id,fields:{quantity:3},expected:{quantity:2},request_key:'line-update-1'});assert.equal(updated.status,'succeeded_verified');const deleted:any=await s.s.write(s.p,'QuoteItems','delete',{id:r.native_id,quote_id:200,expected:{name:'Test PC',quantity:3,unitPrice:100,quoteItemType:1},request_key:'line-delete-1'});assert.equal(deleted.status,'succeeded_verified');assert.ok(s.requests.some(req=>req.path===`Quotes/200/Items/${r.native_id}`&&req.method==='DELETE'));});
test('opportunity notes use company parent and preserve opportunity association',async()=>{const s=setup();const r:any=await s.s.write(s.p,'CompanyNotes','create',{opportunity_id:100,fields:{actionType:'General',name:'Sales update',note:'Private note',startDateTime:'2026-09-01T12:00:00Z',endDateTime:'2026-09-01T12:05:00Z'},request_key:'opportunity-note-1'});assert.equal(r.status,'succeeded_verified');assert.ok(s.requests.some(r=>r.path==='Companies/10/Notes'&&r.body.opportunityID===100));});
test('quote comparison is scoped and reports item completeness without guessed totals',async()=>{const s=setup();s.rows.Quotes!.push({...s.rows.Quotes![0],id:201,name:'Alternative'});const r=await s.s.compare(s.p,{quote_ids:[200,201]});assert.equal(r.status,'succeeded');assert.equal(r.data.length,2);assert.equal('total'in r,false);});
test('journal receipts retain only bounded sales identifiers and attribution',()=>{const r=redactJournalResult({company_id:0,native_id:100,entity:'Opportunities',action:'create',verified:true,attribution:{creatorResourceID:10,impersonatorCreatorResourceID:20,lastModifiedBy:null,secret:'no'},title:'not stored'});assert.equal(r?.company_id,0);assert.equal(r?.title,undefined);assert.equal((r?.attribution as any).secret,undefined);});
test('quote creation can reuse only same-company source quote locations',async()=>{const s=setup();const r:any=await s.s.write(s.p,'Quotes','create',{opportunity_id:100,location_source_quote_id:200,fields:{name:'Alternative',primaryQuote:true,effectiveDate:'2026-09-01',expirationDate:'2026-10-01',billToLocationID:300,shipToLocationID:300,soldToLocationID:300},request_key:'reuse-location-1'});assert.equal(r.status,'succeeded_verified');});
test('sales write revocation during metadata read prevents dispatch',async()=>{const s=setup();s.setIntercept(r=>{if(r.path.endsWith('entityInformation/fields'))s.store.set({...s.p,active:false});});await assert.rejects(s.s.write(s.p,'Opportunities','create',{company:10,fields:oppFields,request_key:'revoked-write-1'}));assert.equal(s.requests.some(r=>r.path==='Opportunities'&&r.method==='POST'),false);});
test('known-ID verification can complete later without repeating the write',async()=>{const s=setup();let block=true;s.setIntercept(r=>{if(block&&r.method==='GET'&&r.path==='Opportunities/1000')return json({},503);});const r:any=await s.s.write(s.p,'Opportunities','create',{company:10,fields:oppFields,request_key:'verify-later-1'});assert.equal(r.status,'accepted_unverified');block=false;const verified:any=await s.s.operationStatus(s.p,{operation_id:r.operation_id});assert.equal(verified.status,'succeeded_verified');assert.equal(s.requests.filter(r=>r.method==='POST'&&r.path==='Opportunities').length,1);});
test('SQL sales intents survive migration reruns and service reconstruction',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');const {PostgresJournal}=await import('../packages/storage/src/index.js');const {REQUIRED_MIGRATIONS}=await import('../scripts/preflight.js');
 const db=new PGlite();try{for(const file of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));const s=setup(),journal=new PostgresJournal(db),cipher=new IntentCipher(Buffer.alloc(32,1));const input={actorKey:`${s.p.tenantId}:${s.p.objectId}`,requestKey:'sql-sales-intent',payloadHash:'a'.repeat(64),operation:'sales_opportunities_create',mappingVersion:s.p.mappingVersion,resourceId:s.p.resourceId,policyVersion:s.p.policyVersion,encryptedIntent:cipher.seal({title:'Private sales description'},'test-binding'),intentExpiresAt:new Date(Date.now()+86400000).toISOString(),result:{company_id:0,entity:'Opportunities',action:'create'}};
 const r=await journal.reserve(input);await journal.transition(r.record.id,'ready','dispatching');await journal.transition(r.record.id,'dispatching','accepted_unverified',{company_id:0,entity:'Opportunities',action:'create',native_id:123});await db.exec(await readFile('packages/storage/migrations/006_sales_intents.sql','utf8'));const saved=await new PostgresJournal(db).get(r.record.id,input.actorKey);assert.equal(saved?.result?.native_id,123);assert.equal(saved?.result?.company_id,0);assert.equal(saved?.encryptedIntent,input.encryptedIntent);await journal.transition(r.record.id,'accepted_unverified','succeeded_verified',{...saved?.result,verified:true});assert.equal((await journal.reserve(input)).created,false);
 }finally{await db.close();}
});
test('definitive API write rejections are recorded as failed without retries',async()=>{const s=setup();s.setIntercept(r=>r.path==='Opportunities'&&r.method==='POST'?json({errors:['Not exposed']},400):undefined);const r:any=await s.s.write(s.p,'Opportunities','create',{company:10,fields:oppFields,request_key:'rejected-create-1'});assert.equal(r.status,'failed');assert.equal(s.requests.filter(r=>r.path==='Opportunities'&&r.method==='POST').length,1);assert.equal(JSON.stringify(r).includes('Not exposed'),false);});

test('opportunity count sends scoped filters directly without downloading records',async()=>{const s=setup();s.setIntercept(r=>r.path==='Opportunities/query/count'?json({queryCount:12}):undefined);const tool=salesTools(s.s).find(t=>t.name==='opportunity_count')!;const r:any=await tool.run(s.p,{company:10,owner:'self',status:'Active'});assert.equal(r.count,12);const req=s.requests.find(r=>r.path==='Opportunities/query/count')!;assert.ok(req.body.filter.some((f:any)=>f.field==='ownerResourceID'&&f.value===s.p.resourceId));assert.equal(s.requests.some(r=>r.path==='Opportunities/query'),false);assert.equal(tool.schema.safeParse({cursor:'ignored'}).success,false);});

test('quote workflow evidence separates internal approval, customer response and publication without writes',async()=>{
 const s=setup();Object.assign(s.rows.Quotes![0],{approvalStatus:3,extApprovalContactResponse:2,extApprovalResponseDate:'2026-09-14T10:00:00Z',lastPublishedDateTime:'2026-09-13T10:00:00Z',extApprovalResponseSignature:'private signature'});
 const r=await s.s.workflowInspect(s.p,{id:200});assert.equal(r.internal_approval.label,'Approved');assert.equal(r.customer_response.value,2);assert.equal(r.customer_response.label,null);assert.equal(r.read_only,true);assert(!JSON.stringify(r).includes('private signature'));assert(s.requests.every(v=>v.method==='GET'));
 for(const field of ['extApprovalContactResponse','extApprovalResponseDate','lastPublishedDateTime','lastPublishedByResourceID'])assert(!writeFields.Quotes.includes(field));
});
test('quote workflow preparation returns documented UI handoffs without writes',async()=>{
 const s=setup();for(const purpose of ['send','pdf','acceptance','convert'] as const){const r:any=await s.s.quoteWorkflowPrepare(s.p,{quote_id:200,purpose});assert.equal(r.read_only,true);assert.equal(r.quote_id,200);assert.equal(r.opportunity_id,100);assert.equal(r.context.quote.id,200);assert.equal(r.context.opportunity.id,100);assert.equal(r.readiness.automation_available,false);assert.equal(r.readiness.native_workflow_ready,'not_verified');assert.ok(Array.isArray(r.readiness.unknowns));assert.equal(r.handoff.surface==='Autotask UI'||purpose==='acceptance',true);assert.match(r.handoff.path,/CRM|eQuote/);}assert(s.requests.every(v=>v.method==='GET'));
});
test('quote opportunity PDF discovery is bounded and scoped to CompanyNotes',async()=>{
 const s=setup();const r:any=await s.s.quoteOpportunityPdfSearch(s.p,{quote_id:200,page_size:25});assert.equal(r.status,'succeeded');assert.equal(r.association_scope,'opportunity_note');assert.deepEqual(r.candidates.map((v:any)=>v.attachment_id),[850]);const query=s.requests.find(v=>v.path==='CompanyNoteAttachments/query');assert.ok(query);assert.ok(query.body.filter.some((f:any)=>f.field==='opportunityID'&&f.value===100));assert.ok(query.body.filter.some((f:any)=>f.field==='companyNoteID')===false);assert(s.requests.every(v=>v.method!=='PATCH'&&v.method!=='DELETE'));
});
test('quote opportunity PDF retrieval requires discovered attachment and verifies PDF envelope',async()=>{
 const s=setup();const r:any=await s.s.quoteOpportunityPdfGet(s.p,{quote_id:200,note_id:800,attachment_id:850});assert.equal(r.status,'succeeded');assert.equal(r.association_scope,'opportunity_note');assert.equal(r.acceptance_status,'not_established');assert.equal(Buffer.from(r.attachment.chunk_base64,'base64').toString('ascii').slice(0,5),'%PDF-');assert.equal(r.attachment.next_offset,null);assert.equal(r.attachment.whole_sha256.length,64);assert.equal(s.requests.filter(v=>v.path==='CompanyNoteAttachments/850').length,1);await assert.rejects(s.s.quoteOpportunityPdfGet(s.p,{quote_id:200,note_id:800,attachment_id:999}),code('not_found_or_inaccessible'));
});
test('quote opportunity PDF retrieval rejects a note from another opportunity',async()=>{
 const s=setup();s.rows.CompanyNotes!.push({id:801,companyID:10,opportunityID:101,name:'Other opportunity'});s.rows.CompanyNoteAttachments!.push({id:851,companyID:10,companyNoteID:801,opportunityID:101,title:'Other.pdf',contentType:'application/pdf',attachmentType:'FILE_ATTACHMENT',publish:1,fileSize:14,data:Buffer.from('%PDF-1.7\n%%EOF').toString('base64')});await assert.rejects(s.s.quoteOpportunityPdfGet(s.p,{quote_id:200,note_id:801,attachment_id:851}),code('not_found_or_inaccessible'));assert.equal(s.requests.some(v=>v.path==='CompanyNoteAttachments/851'),false);
});
test('quote opportunity PDF discovery rejects an attachment whose CompanyNote is outside the quote opportunity',async()=>{
 const s=setup();s.rows.CompanyNotes!.push({id:802,companyID:10,opportunityID:101,name:'Wrong note'});s.setIntercept(r=>r.path==='CompanyNoteAttachments/query'?json({items:[{id:852,companyID:10,companyNoteID:802,opportunityID:100,title:'Wrong.pdf',contentType:'application/pdf',attachmentType:'FILE_ATTACHMENT',publish:1}],pageDetails:{nextPageUrl:null}}):undefined);await assert.rejects(s.s.quoteOpportunityPdfSearch(s.p,{quote_id:200}),code('not_found_or_inaccessible'));
});
test('quote opportunity PDF retrieval performs final authorization before returning a chunk',async()=>{
 const s=setup();s.setIntercept(r=>{if(r.path==='CompanyNoteAttachments/850')s.store.set({...s.p,active:false});return undefined;});await assert.rejects(s.s.quoteOpportunityPdfGet(s.p,{quote_id:200,note_id:800,attachment_id:850}),(e:any)=>['forbidden','identity_mapping_invalid','identity_validation_unavailable'].includes(e.code));
});

test('PDF candidate note verification is batched and final quote parent drift is rejected',async()=>{
 const s=setup();await s.s.quoteOpportunityPdfSearch(s.p,{quote_id:200});assert.equal(s.requests.filter(r=>r.path==='CompanyNotes/query').length,1);assert.equal(s.requests.some(r=>r.path==='CompanyNotes/800'),false);
 s.rows.Opportunities!.push({...s.rows.Opportunities![0],id:101});s.setIntercept(r=>{if(r.path==='CompanyNotes/query')s.rows.Quotes![0].opportunityID=101;return undefined;});
 await assert.rejects(s.s.quoteOpportunityPdfSearch(s.p,{quote_id:200}),code('not_found_or_inaccessible'));
});

test('sales searches follow the native query/next route with the original scoped cursor',async()=>{
 const s=setup();s.setIntercept(r=>r.path==='Quotes/query'?json({items:[s.rows.Quotes![0]],pageDetails:{nextPageUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/Quotes/query/next?page=2'}}):r.path==='Quotes/query/next'?json({items:[{...s.rows.Quotes![0],id:201}],pageDetails:{nextPageUrl:null}}):undefined);
 const first=await s.s.search(s.p,'Quotes',{page_size:1});assert.equal(first.status,'partial');assert.ok(first.completeness.next_cursor);
 const second=await s.s.search(s.p,'Quotes',{page_size:1,cursor:first.completeness.next_cursor});assert.equal(second.status,'succeeded');assert.equal(second.data[0]?.id,201);assert.ok(s.requests.some(r=>r.path==='Quotes/query/next'&&r.method==='POST'));assert.deepEqual(s.requests.find(r=>r.path==='Quotes/query/next')?.body,s.requests.find(r=>r.path==='Quotes/query')?.body);
});

test('PDF candidate continuation preserves POST and its scoped query body',async()=>{
 const s=setup();s.setIntercept(r=>r.path==='CompanyNoteAttachments/query'?json({items:[],pageDetails:{nextPageUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/CompanyNoteAttachments/query/next?page=2'}}):r.path==='CompanyNoteAttachments/query/next'?json({items:[],pageDetails:{nextPageUrl:null}}):undefined);
 const first:any=await s.s.quoteOpportunityPdfSearch(s.p,{quote_id:200,page_size:1});assert.ok(first.completeness.next_cursor);
 await s.s.quoteOpportunityPdfSearch(s.p,{quote_id:200,page_size:1,cursor:first.completeness.next_cursor});
 const next=s.requests.find(r=>r.path==='CompanyNoteAttachments/query/next');assert.equal(next?.method,'POST');assert.deepEqual(next?.body,s.requests.find(r=>r.path==='CompanyNoteAttachments/query')?.body);
});

const closedNoteInput={company:10,opportunity_id:100,fields:{name:'Follow-up',note:'Approved factual update',actionType:'General',startDateTime:'2026-09-17T10:00:00Z',endDateTime:'2026-09-17T10:01:00Z'},request_key:'closed-note-request-1'};
function closedSetup(){const s=setup();Object.assign(s.rows.Opportunities![0],{status:2,closedDate:'2026-09-10T00:00:00Z',lostDate:'2026-09-10T11:00:00Z'});return s;}
test('closed note prepares a precise approval preview with no native writes',async()=>{const s=closedSetup();const r:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);assert.equal(r.status,'confirmation_required');assert.equal(r.original_status.label,'Lost');assert.equal(r.note.note,closedNoteInput.fields.note);assert.equal(r.restore.lostDate,s.rows.Opportunities![0].lostDate);assert.equal(s.requests.some(r=>r.method!=='GET'&&!r.path.endsWith('/query')),false);await assert.rejects(s.s.confirmClosedNote(s.p,{confirmation_token:r.confirmation_token,approve_reopen_and_restore:false}));});
test('approved closed note reopens once, creates once, restores exact dates and replay does not write',async()=>{const s=closedSetup();const dates={closedDate:s.rows.Opportunities![0].closedDate,lostDate:s.rows.Opportunities![0].lostDate};s.setIntercept(r=>{if(r.method==='PATCH'&&r.body.status===1)s.rows.Opportunities![0].lostDate=null;return undefined;});const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);const args={confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true};const result=await s.s.confirmClosedNote(s.p,args);assert.equal(result.status,'succeeded_verified');assert.equal(s.rows.Opportunities![0].status,2);assert.equal(s.rows.Opportunities![0].lostDate,dates.lostDate);assert.equal(s.rows.Opportunities![0].closedDate,dates.closedDate.slice(0,10));const writes=s.requests.filter(r=>['POST','PATCH'].includes(r.method)&&!r.path.endsWith('/query'));assert.equal(writes.length,3);assert.equal((await s.s.confirmClosedNote(s.p,args)).status,'succeeded_verified');assert.equal(s.requests.filter(r=>['POST','PATCH'].includes(r.method)&&!r.path.endsWith('/query')).length,3);});
test('stale or tampered closed-note approval never reopens',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);s.rows.Opportunities![0].title='Concurrent edit';await assert.rejects(s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true}),code('conflict'));await assert.rejects(s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token+'x',approve_reopen_and_restore:true}),code('conflict'));assert.equal(s.requests.some(r=>r.method==='PATCH'),false);});
test('unknown note result stops before restoration and is never replayed',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);s.setIntercept(r=>{if(r.path.endsWith('/Notes')&&r.method==='POST')throw Error('response lost');return undefined;});const args={confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true};const r:any=await s.s.confirmClosedNote(s.p,args);assert.equal(r.status,'review_required');assert.equal(r.steps.note.status,'unknown_outcome');assert.equal(r.restoration_verified,false);await s.s.confirmClosedNote(s.p,args);assert.equal(s.requests.filter(r=>r.method==='PATCH').length,1);assert.equal(s.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/Notes')).length,1);});
test('definite note rejection restores status and reports the failed note',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);s.setIntercept(r=>r.path.endsWith('/Notes')&&r.method==='POST'?json({},403):undefined);const r:any=await s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true});assert.equal(r.status,'review_required');assert.equal(r.steps.note.error_code,'forbidden');assert.equal(r.restoration_verified,true);assert.equal(r.note_verified,false);});
test('restore failure reports a saved note without claiming completion',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);s.setIntercept(r=>r.method==='PATCH'&&r.body.status===2?json({},403):undefined);const r:any=await s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true});assert.equal(r.status,'review_required');assert.equal(r.note_verified,true);assert.equal(r.restoration_verified,false);assert.equal(s.rows.Opportunities![0].status,1);});
test('active note permission failure produces no reopen offer or status write',async()=>{const s=setup();s.setIntercept(r=>r.path.endsWith('/Notes')&&r.method==='POST'?json({},403):undefined);const r:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);assert.equal(r.status,'failed');assert.equal(r.error_code,'forbidden');assert.equal(s.requests.some(r=>r.method==='PATCH'),false);});
test('closure dates must be present before offering restoration',async()=>{const s=closedSetup();delete s.rows.Opportunities![0].lostDate;await assert.rejects(s.s.write(s.p,'CompanyNotes','create',closedNoteInput),code('missing_metadata'));assert.equal(s.requests.some(r=>r.method==='PATCH'),false);});
test('Closed and Implemented opportunities restore their current metadata status with null lostDate',async()=>{for(const status of [3,4]){const s=closedSetup();Object.assign(s.rows.Opportunities![0],{status,lostDate:null});const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);const r=await s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true});assert.equal(r.status,'succeeded_verified');assert.equal(s.rows.Opportunities![0].status,status);assert.equal(s.rows.Opportunities![0].lostDate,null);}});
test('concurrent opportunity edits prevent restoration without replaying the saved note',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);s.setIntercept(r=>{if(r.method==='POST'&&r.path.endsWith('/Notes'))s.rows.Opportunities![0].title='Changed by another employee';return undefined;});const r:any=await s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true});assert.equal(r.note_verified,true);assert.equal(r.restoration_verified,false);assert.equal(r.error_code,'conflict');assert.equal(s.requests.filter(r=>r.method==='PATCH').length,1);});
test('expired approval prevents reopening',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);(s.s as any).options.now=()=>Date.parse(offer.expires_at)+1;s.store.set({...s.p,resourceVerifiedAt:new Date(Date.parse(offer.expires_at)+1).toISOString()});await assert.rejects(s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true}));assert.equal(s.requests.some(r=>r.method==='PATCH'),false);});
test('revoked sales writes reject an approved workflow before reopening',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);s.store.set({...s.p,capabilities:['operational.read','finance.read']});await assert.rejects(s.s.confirmClosedNote(s.p,{confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true}));assert.equal(s.requests.some(r=>r.method==='PATCH'),false);});
test('concurrent confirmation calls do not duplicate any native step',async()=>{const s=closedSetup();const offer:any=await s.s.write(s.p,'CompanyNotes','create',closedNoteInput);const args={confirmation_token:offer.confirmation_token,approve_reopen_and_restore:true};await Promise.allSettled([s.s.confirmClosedNote(s.p,args),s.s.confirmClosedNote(s.p,args)]);assert.ok(s.requests.filter(r=>r.method==='PATCH'&&r.body.status===1).length<=1);assert.ok(s.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/Notes')).length<=1);assert.ok(s.requests.filter(r=>r.method==='PATCH'&&r.body.status===2).length<=1);});

 test('opportunity search accepts exact native IDs and preserves all other filters',async()=>{
 const s=setup();s.rows.Opportunities!.push({...s.rows.Opportunities![0],id:192,title:'Target'});
 const tool=salesTools(s.s).find(t=>t.name==='opportunity_search')!;
 const r:any=await tool.run(s.p,{opportunity_id:192,company:10,owner:'self',status:'Active'});
 assert.deepEqual(r.data.map((row:any)=>row.id),[192]);
 const filters=s.requests.find(r=>r.path==='Opportunities/query')!.body.filter;
 assert.ok(filters.some((f:any)=>f.field==='id'&&f.op==='eq'&&f.value===192));
 assert.ok(filters.some((f:any)=>f.field==='companyID'&&f.op==='in'));
 assert.equal((await s.s.search(s.p,'Opportunities',{opportunity_id:192,text:'missing'})).data.length,0);
 assert.equal((await s.s.search(s.p,'Opportunities',{text:'192'})).data.length,0);
 assert.equal((await s.s.search(s.p,'Opportunities',{opportunity_id:999})).data.length,0);
 s.rows.Opportunities![1].companyID=99;
 assert.equal((await s.s.search(s.p,'Opportunities',{opportunity_id:192})).data.length,0);
 assert.match(tool.description,/title only, not the ID/);
 });
 test('opportunity count applies an exact ID filter and search rejects mismatched API records',async()=>{
 const s=setup();s.setIntercept(r=>r.path==='Opportunities/query/count'?json({queryCount:1}):undefined);
 await s.s.search(s.p,'Opportunities',{opportunity_id:100},true);
 assert.ok(s.requests.find(r=>r.path==='Opportunities/query/count')!.body.filter.some((f:any)=>f.field==='id'&&f.value===100));
 s.setIntercept(r=>r.path==='Opportunities/query'?json({items:s.rows.Opportunities,pageDetails:{nextPageUrl:null}}):undefined);
 await assert.rejects(s.s.search(s.p,'Opportunities',{opportunity_id:192}),code('dependency_unavailable'));
 });

test('quote ID search and count preserve opportunity and company filters',async()=>{
 const s=setup();s.rows.Quotes!.push({...s.rows.Quotes![0],id:201});
 const result=await s.s.search(s.p,'Quotes',{quote_id:200,opportunity_id:100,company:10});
 assert.deepEqual(result.data.map(row=>row.id),[200]);
 s.setIntercept(r=>r.path==='Quotes/query/count'?json({queryCount:1}):undefined);
 await s.s.search(s.p,'Quotes',{quote_id:200,opportunity_id:100},true);
 assert.ok(s.requests.find(r=>r.path==='Quotes/query/count')!.body.filter.some((f:any)=>f.field==='id'&&f.value===200));
 assert.equal((await s.s.search(s.p,'Quotes',{quote_id:999})).data.length,0);
 s.rows.Quotes![0].companyID=99;
 assert.equal((await s.s.search(s.p,'Quotes',{quote_id:200})).data.length,0);
});
test('sales discovery schemas omit unsupported filters and require parents',()=>{
 const tools=salesTools(setup().s),schema=(name:string)=>tools.find(t=>t.name===name)!.schema;
 assert.equal(schema('quote_search').safeParse({quote_id:200}).success,true);
 assert.equal(schema('quote_search').safeParse({owner:'self'}).success,false);
 assert.equal(schema('opportunity_search').safeParse({quote_id:200}).success,false);
 assert.equal(schema('quote_item_search').safeParse({}).success,false);
 assert.equal(schema('quote_template_search').safeParse({company:10}).success,false);
 assert.equal(schema('opportunity_count').safeParse({page_size:25}).success,false);
});

test('opportunity notes default to the signed-in employee and allow equal timestamps for active and lost opportunities',async()=>{
 for(const closed of [false,true]){
  const s=closed?closedSetup():setup();s.rows.Opportunities![0].ownerResourceID=29682934;s.rows.Resources!.push({id:29682934,isActive:true,resourceType:'Employee'});
  const input={...closedNoteInput,fields:{...closedNoteInput.fields,actionType:0,startDateTime:'2026-09-18T07:35:00-05:00',endDateTime:'2026-09-18T07:35:00-05:00'}};
  const first:any=await s.s.write(s.p,'CompanyNotes','create',input);
  if(closed){assert.equal(first.status,'confirmation_required');assert.equal(s.requests.some(r=>r.method==='PATCH'||r.path.endsWith('/Notes')),false);await s.s.confirmClosedNote(s.p,{confirmation_token:first.confirmation_token,approve_reopen_and_restore:true});}
  else assert.equal(first.status,'succeeded_verified');
  const note=s.requests.find(r=>r.method==='POST'&&r.path.endsWith('/Notes'))!;
  assert.ok(note);assert.equal(note.body.assignedResourceID,s.p.resourceId);assert.equal(note.body.startDateTime,note.body.endDateTime);
 }
});
test('note assignment and timing failures identify the exact local cause before any write',async()=>{
 for(const closed of [false,true])for(const invalid of ['assignment','timing']){
  const s=closed?closedSetup():setup();
  const fields={...closedNoteInput.fields,...(invalid==='assignment'?{assignedResourceID:s.p.resourceId+1}:{endDateTime:'2026-09-17T09:00:00Z'})};
  await assert.rejects(s.s.write(s.p,'CompanyNotes','create',{...closedNoteInput,fields}),(e:any)=>{
   assert.equal(e.code,'invalid_input');assert.match(e.message,/Local validation/);assert.match(e.message,/No note write was sent to Autotask/);
   assert.match(e.message,invalid==='assignment'?/assignedResourceID must match the signed-in employee/:/endDateTime precedes startDateTime/);return true;
  });
  assert.equal(s.requests.some(r=>r.method==='PATCH'||r.path.endsWith('/Notes')),false);
 }
});

test('opportunity creation rejects valid same-company IDs for the wrong intended people before writing',async()=>{
 for(const field of ['contactID','ownerResourceID'] as const)for(const proof of [undefined,{name:'Morgan Lee'}]){
  const s=setup();s.rows.Contacts!.push({id:9002,companyID:10,firstName:'Taylor',lastName:'Park',isActive:true});s.rows.Resources!.push({id:9003,firstName:'Jordan',lastName:'Reed',isActive:true,resourceType:'Employee'});
  const identity=field==='contactID'?'contact_identity':'owner_identity';
  await assert.rejects(s.s.write(s.p,'Opportunities','create',{company:10,fields:{...oppFields,[field]:field==='contactID'?9002:9003},...(proof?{[identity]:proof}:{}),request_key:'wrong-identity-create'}),code(proof?'conflict':'invalid_input'));
  assert.equal(s.requests.some(r=>['POST','PATCH'].includes(r.method)&&!r.path.endsWith('/query')),false);
 }
});
test('opportunity identity matches are normalized, checked again at dispatch, and never sent as native fields',async()=>{
 const s=setup();s.rows.Contacts!.push({id:9001,companyID:10,firstName:'Morgan',lastName:'Lee',emailAddress:'morgan.lee@example.test',isActive:true});
 const input={company:10,fields:{...oppFields,contactID:9001},contact_identity:{name:' morgan  LEE ',email:'morgan.lee@example.test'},request_key:'correct-contact-create'};
 const result:any=await s.s.write(s.p,'Opportunities','create',input);assert.equal(result.status,'succeeded_verified');
 const post=s.requests.find(r=>r.path==='Opportunities'&&r.method==='POST')!;assert.equal(post.body.contactID,9001);assert.equal(post.body.contact_identity,undefined);
 const changed=setup();changed.rows.Contacts!.push({...s.rows.Contacts![1]});let reads=0;
 changed.setIntercept(r=>{if(r.path==='Contacts/9001'&&++reads===3)changed.rows.Contacts![1].firstName='Different';return undefined;});
 const rejected:any=await changed.s.write(changed.p,'Opportunities','create',input);assert.equal(rejected.status,'failed');assert.equal(rejected.error_code,'conflict');assert.equal(changed.requests.some(r=>r.path==='Opportunities'&&r.method==='POST'),false);
});

test('opportunity and quote updates expose and persist additional editable metadata fields',async()=>{
 for(const [entity,id]of [['Opportunities',100],['Quotes',200]] as const){
 const s=setup();s.rows[entity]![0].externalTracking='old';
 s.setIntercept(r=>r.path===`${entity}/entityInformation/fields`?json({fields:[{name:'externalTracking',dataType:'string',isRequired:false,isReadOnly:false}]}):undefined);
 const schema:any=await s.s.schema(s.p,{entity});assert.equal(schema.fields[0].allowed_for_write,true);
 const read:any=await s.s.get(s.p,entity,{id});assert.equal(read.data.externalTracking,'old');
 const result:any=await s.s.write(s.p,entity,'update',{id,fields:{externalTracking:'new'},expected:{externalTracking:'old'},request_key:`native-extra-${entity}`});
 assert.equal(result.status,'succeeded_verified');assert.equal(s.rows[entity]![0].externalTracking,'new');
 }
});
test('opportunity UDF updates compare only named values and verify a partial patch',async()=>{
 const s=setup();s.rows.Opportunities![0].userDefinedFields=[{name:'Tracking',value:'old'},{name:'Untouched',value:'keep'}];
 s.setIntercept(r=>r.path==='Opportunities/entityInformation/userDefinedFields'?json({fields:[{name:'Tracking',dataType:'string',isReadOnly:false}]}):r.path==='Opportunities'&&r.method==='PATCH'?(s.rows.Opportunities![0].userDefinedFields[0].value=r.body.userDefinedFields[0].value,json({itemId:100})):undefined);
 const input={id:100,fields:{userDefinedFields:[{name:'Tracking',value:'new'}]},expected:{userDefinedFields:[{name:'Tracking',value:'old'}]},request_key:'native-udf-opportunity'};
 const result:any=await s.s.write(s.p,'Opportunities','update',input);assert.equal(result.status,'succeeded_verified');assert.equal(s.rows.Opportunities![0].userDefinedFields[1].value,'keep');
 await s.s.write(s.p,'Opportunities','update',input);assert.equal(s.requests.filter(r=>r.method==='PATCH').length,1);
 await assert.rejects(s.s.write(s.p,'Opportunities','update',{...input,expected:{userDefinedFields:[]},request_key:'native-udf-no-expected'}));
});
test('newly exposed quote proposalProjectID retains company scope',async()=>{
 const s=setup();s.rows.Projects=[{id:900,companyID:20}];s.setIntercept(r=>r.path==='Quotes/entityInformation/fields'?json({fields:[{name:'proposalProjectID',dataType:'integer',isReadOnly:false}]}):undefined);
 await assert.rejects(s.s.write(s.p,'Quotes','update',{id:200,fields:{proposalProjectID:900},expected:{proposalProjectID:null},request_key:'foreign-proposal-project'}));assert.equal(s.requests.some(r=>r.method==='PATCH'),false);
});

test('accepted sales writes reconcile after cancellation but later unrelated reads stop',async()=>{
 const {createExecution,withExecution}=await import('../packages/execution/src/index.js');const s=setup(),abort=new AbortController(),context=createExecution(abort.signal);
 s.setIntercept(request=>{if(request.method==='POST'&&request.path==='Opportunities')abort.abort();});
 await withExecution(context,async()=>{const result:any=await s.s.write(s.p,'Opportunities','create',{company:10,fields:oppFields,request_key:'cancel-after-sales-accept'});assert.equal(result.status,'succeeded_verified');const count=s.requests.length;await assert.rejects(()=>s.s.get(s.p,'Opportunities',{id:result.native_id}));assert.equal(s.requests.length,count);});
 assert.equal(s.requests.filter(r=>r.method==='POST'&&r.path==='Opportunities').length,1);
});
