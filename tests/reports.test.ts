import test from 'node:test';import assert from 'node:assert/strict';
import {runReport,ticketReportSchema} from '../packages/reports/src/index.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {validateOutput} from '../apps/server/src/output-validation.js';
const p=fixturePrincipals()[0]!;
test('report preserves self and exact status on every page, labels partial groups and exposes source continuation',async()=>{
 const calls:any[]=[];const run=async(_p:any,name:string,a:any)=>{calls.push({name,a});return{data:[{id:calls.length,status:7}],completeness:{complete:false,next_cursor:'next-'+calls.length}};};
 const r=await runReport(p,{filters:{technician:{kind:'self'},status:{kind:'name',name:'Customer Note Added'}},max_pages:2},'tickets',run);
 assert.equal(r.completeness.complete,false);assert.equal(r.data[0]!.count,2);assert.equal(r.continuation!.arguments.cursor,'next-2');for(const c of calls){assert.equal(c.a.technician.kind,'self');assert.equal(c.a.status.name,'Customer Note Added');}assert(!ticketReportSchema.safeParse({filters:{},max_pages:11}).success);
});
test('reports stop at complete pages and never count duplicate records as complete totals',async()=>{
 let i=0;const r=await runReport(p,{filters:{},max_pages:2},'tickets',async()=>({data:[{id:1,status:7}],completeness:{complete:++i===2,next_cursor:i===1?'second':null}}));assert.equal(r.completeness.returned,1);assert.equal(r.completeness.complete,false);
});
test('reports reject source errors and malformed continuation instead of showing partial results as success',async()=>{
 await assert.rejects(runReport(p,{filters:{}},'tickets',async()=>({status:'failed'})));
 await assert.rejects(runReport(p,{filters:{}},'pipeline',async()=>({data:[],completeness:{complete:false}})));
});
test('reports reject non-native IDs and malformed complete cursors',async()=>{
 await assert.rejects(runReport(p,{filters:{}},'tickets',async()=>({data:[{id:0}],completeness:{complete:true,next_cursor:null}})));
 await assert.rejects(runReport(p,{filters:{}},'tickets',async()=>({data:[{id:1}],completeness:{complete:true,next_cursor:''}})));
 await assert.rejects(runReport(p,{filters:{}},'tickets',async()=>({data:[{id:1}],completeness:{complete:false,next_cursor:'x'.repeat(16001)}})));
});
test('ticket report excludes titles before grouping and sorts across all retrieved pages',async()=>{
 const pages=[
  {data:[{id:3,title:'Printer',ticketType:2,companyID:10},{id:2,title:'ThreatLocker alert',ticketType:1,companyID:10}],completeness:{complete:false,next_cursor:'second'}},
  {data:[{id:1,title:'Email',ticketType:1,companyID:20},{id:4,title:'Network',ticketType:1,companyID:10}],completeness:{complete:true,next_cursor:null}}
 ];
 const calls:any[]=[];
 const result=await runReport(p,{filters:{page_size:500},exclude_title_contains:'threatlocker',group_by:'ticketType',sort_by:[{field:'ticketType',direction:'asc'},{field:'companyID',direction:'desc'}],max_pages:2},'tickets',async(_p,name,args)=>{calls.push({name,args});return pages[calls.length-1];});
 assert.deepEqual(result.records.map(row=>row.id),[1,4,3]);
 assert.deepEqual(result.data,[{value:2,count:1},{value:1,count:2}]);
 assert.equal(result.completeness.complete,true);
 assert.equal(result.excluded_records,1);
 assert.equal(result.scanned_records,4);
 assert.equal(result.completeness.returned,3);
 assert.equal(calls[0]!.args.page_size,500);
 assert.equal(calls[1]!.args.cursor,'second');
 validateOutput('ticket_workload_report',result);
 assert(!ticketReportSchema.safeParse({sort_by:[{field:'status'},{field:'status'}]}).success);
});
test('partial ticket report sorts only its retrieved subset',async()=>{
 const result=await runReport(p,{sort_by:[{field:'ticketType'}],max_pages:1},'tickets',async()=>({data:[{id:2,ticketType:2},{id:1,ticketType:1}],completeness:{complete:false,next_cursor:'next'}}));
 assert.deepEqual(result.records.map(row=>row.id),[1,2]);
 assert.equal(result.completeness.complete,false);
 assert.match(result.count_scope,/retrieved subset/);
});
