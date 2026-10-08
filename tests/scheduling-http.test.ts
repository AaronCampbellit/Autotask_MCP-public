import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, type AutotaskPort, type Principal } from '../packages/contracts/src/index.js';
import { FixtureUnlimitedRequestBudget, RequestBudgetError, type BudgetRequest, type RequestBudgetPort } from '../packages/autotask/src/budget.js';
import { HttpSchedulingPort, type HttpSchedulingOptions, type SchedulingOperation } from '../packages/scheduling/src/http.js';
import type { SchedulingMetadata } from '../packages/scheduling/src/contracts.js';

const NOW=Date.parse('2026-09-10T18:00:00.000Z'),baseUrl='https://webservices3.autotask.net/atservicesrest/v1.0/';
const principal:Principal={tenantId:'tenant',objectId:'employee',resourceId:101,mappingVersion:1,policyVersion:'policy-v1',active:true,companyIds:[10,20],capabilities:['operational.read','scheduling.write'],resourceVerifiedAt:new Date(NOW).toISOString()};
const callPayload={companyID:10,startDateTime:'2026-09-10T18:00:00.000Z',endDateTime:'2026-09-10T19:00:00.000Z',status:801};
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected;
function deferredBudget(waitAt=1) {
  const calls:BudgetRequest[]=[];let unblock!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{unblock=resolve;});
  const budget:RequestBudgetPort={take:async request=>{calls.push(request);if(calls.length===waitAt){entered();await gate;}},status:()=>new FixtureUnlimitedRequestBudget().status()};
  return{budget,calls,waiting,unblock};
}
function setup(options:Partial<HttpSchedulingOptions>={}) {
  const state={clock:NOW,active:true,ticketCompany:10,callCompany:10,associationTicketId:1001,associationCallId:5001,resourceActive:true,metadataReads:0,ticketReads:0};
  const seen:{path:string;method:string;body:unknown}[]=[];
  const metadata:SchedulingMetadata={version:'synthetic-reviewed-v1',source:'Autotask',ticketId:1001,companyId:10,tenantId:principal.tenantId,resourceId:principal.resourceId,mappingVersion:1,policyVersion:principal.policyVersion,validUntil:new Date(NOW+60000).toISOString(),ticketResourceIds:[101],statuses:[{id:801,label:'Scheduled',active:true,bookable:true}],defaultStatusId:801,allowOverlap:false,attributionField:'creatorResourceID'};
  const unexpected=async():Promise<never>=>{throw new Error('Unexpected synthetic base adapter operation');};
  const tickets:AutotaskPort={source:'Autotask',get:async(_p,entity,id)=>{assert.equal(entity,'Tickets');state.ticketReads++;return{id,companyID:state.ticketCompany};},
    query:unexpected,countTickets:unexpected,patchTicket:unexpected,ticketWorkMetadata:unexpected,createTicketNote:unexpected,getTicketNote:unexpected,validateTicketTime:unexpected,createTicketTime:unexpected,getTicketTime:unexpected};
  const operations:SchedulingOperation[]=['Resources.query','ServiceCalls.metadata','ServiceCalls.query','ServiceCalls.get','ServiceCalls.create','ServiceCallTickets.query','ServiceCallTickets.get','ServiceCallTickets.create','ServiceCallTicketResources.query','ServiceCallTicketResources.get','ServiceCallTicketResources.create'];
  const port=new HttpSchedulingPort(tickets,{baseUrl,username:'synthetic',secret:'synthetic',integrationCode:'synthetic',now:()=>state.clock,revalidatePrincipal:async p=>({...p,active:state.active}),resolveMetadata:async()=>{state.metadataReads++;return structuredClone(metadata);},resolveResources:async()=>[{id:101,label:'Synthetic employee',active:state.resourceActive,companyIds:[10]}],
    qualifications:operations.map(operation=>({operation,evidenceSource:'live',headerAccepted:true,permissionEnforced:true,nativeAttribution:true,tenantId:principal.tenantId,policyVersion:principal.policyVersion,resourceIds:[101],testIds:['synthetic-allow','synthetic-deny'],qualifiedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+120000).toISOString(),evidenceReference:'synthetic-tests-never-tenant-qualification'})),
    fetch:async(url,init)=>{
      const path=new URL(String(url)).pathname.slice('/atservicesrest/v1.0/'.length),method=init?.method??'GET';seen.push({path,method,body:init?.body?JSON.parse(String(init.body)):undefined});
      if(method==='POST')return json({itemId:path==='ServiceCalls'?5001:path.endsWith('/Tickets')?6001:7001});
      if(/^ServiceCalls\/\d+$/.test(path))return json({item:{id:Number(path.split('/')[1]),...callPayload,companyID:state.callCompany}});
      if(path==='ServiceCallTickets/6001'||path==='ServiceCalls/5001/Tickets/6001')return json({item:{id:6001,serviceCallID:state.associationCallId,ticketID:state.associationTicketId}});
      throw new Error('Unexpected synthetic scheduling route');
    },...options});
  return{port,state,seen,metadata};
}

test('scheduling denied budget permits cannot fetch a read or service-call mutation',async()=>{
  for(const operation of ['read','create'] as const){let takes=0;const s=setup({requestBudget:{take:async()=>{takes++;throw new RequestBudgetError('shared_pressure');},status:()=>new FixtureUnlimitedRequestBudget().status()}});
    await assert.rejects(operation==='read'?s.port.getCall(principal,5001):s.port.createCall(principal,1001,callPayload),code('throttled'));assert.equal(takes,1);assert.equal(s.seen.length,0);
  }
});
test('scheduling revalidates identity after budget waiting for both read and mutation requests',async()=>{
  for(const operation of ['read','create'] as const){const gate=deferredBudget(),s=setup({requestBudget:gate.budget});
    const pending=operation==='read'?s.port.getCall(principal,5001):s.port.createCall(principal,1001,callPayload);
    await gate.waiting;s.state.active=false;gate.unblock();await assert.rejects(pending,code('identity_mapping_invalid'));assert.equal(s.seen.length,0);
  }
});
test('scheduling refreshes status eligibility and expiry after a budget wait before service-call creation',async()=>{
  for(const change of ['status','expiry'] as const){const gate=deferredBudget(),s=setup({requestBudget:gate.budget});
    const pending=s.port.createCall(principal,1001,callPayload);await gate.waiting;assert.equal(s.state.metadataReads,1);
    if(change==='status')s.metadata.statuses[0]!.bookable=false;else s.state.clock=Date.parse(s.metadata.validUntil);
    gate.unblock();await assert.rejects(pending,error=>error instanceof AppError&&['conflict','missing_metadata'].includes(error.code));assert.equal(s.seen.length,0);
  }
});
test('scheduling refreshes resource activity after the resource-association budget wait',async()=>{
  const gate=deferredBudget(3),s=setup({requestBudget:gate.budget});const pending=s.port.createResource(principal,6001,101);
  await gate.waiting;s.state.resourceActive=false;gate.unblock();await assert.rejects(pending,code('precondition_failed'));assert.ok(s.seen.every(row=>row.method==='GET'));assert.equal(s.seen.filter(row=>row.method==='POST').length,0);
});
test('service-call creation rechecks the actual ticket company after its budget wait',async()=>{
  const gate=deferredBudget(),s=setup({requestBudget:gate.budget});const pending=s.port.createCall(principal,1001,callPayload);
  await gate.waiting;s.state.ticketCompany=20;gate.unblock();await assert.rejects(pending,code('precondition_failed'));assert.equal(s.seen.length,0);assert.equal(s.state.ticketReads,2);
});
test('ticket-association POST rechecks the actual parent company after a budget wait',async()=>{
  const gate=deferredBudget(2),s=setup({requestBudget:gate.budget});const pending=s.port.createTicket(principal,5001,1001);
  await gate.waiting;s.state.ticketCompany=20;gate.unblock();await assert.rejects(pending,code('precondition_failed'));assert.equal(s.seen.filter(row=>row.method==='POST').length,0);
});
test('resource-association POST rechecks parent company and association identity after a budget wait',async()=>{
  for(const change of ['company','association'] as const){const gate=deferredBudget(3),s=setup({requestBudget:gate.budget});const pending=s.port.createResource(principal,6001,101);
    await gate.waiting;if(change==='company')s.state.ticketCompany=20;else s.state.associationTicketId=1002;
    gate.unblock();await assert.rejects(pending,error=>error instanceof AppError&&['precondition_failed','not_found_or_inaccessible'].includes(error.code));assert.equal(s.seen.filter(row=>row.method==='POST').length,0);
  }
});
test('a denied nested parent-read permit prevents the scheduling association POST and releases its guarded slot',async()=>{
  for(const operation of ['ticket','resource'] as const){let takes=0;
    const s=setup({requestBudget:{take:async()=>{if(++takes===(operation==='ticket'?3:4))throw new RequestBudgetError('shared_pressure');},status:()=>new FixtureUnlimitedRequestBudget().status()}});
    await assert.rejects(operation==='ticket'?s.port.createTicket(principal,5001,1001):s.port.createResource(principal,6001,101),code('throttled'));
    assert.equal(s.seen.filter(row=>row.method==='POST').length,0);assert.equal((await s.port.getCall(principal,5001)).id,5001);
  }
});
test('four concurrent scheduling mutations reread their parents through the shared lease without deadlock or extra HTTP concurrency',async()=>{
  const actors=Array.from({length:4},(_,index)=>({...principal,objectId:`employee-${index}`,resourceId:101+index}));
  let active=0,maximumActive=0,fetches=0,permits=0;
  const operations:SchedulingOperation[]=['Resources.query','ServiceCalls.metadata','ServiceCalls.get','ServiceCallTickets.get','ServiceCallTickets.create','ServiceCallTicketResources.create'];
  const s=setup({timeoutMs:1000,requestBudget:{take:async()=>{permits++;},status:()=>new FixtureUnlimitedRequestBudget().status()},
    qualifications:operations.map(operation=>({operation,evidenceSource:'live',headerAccepted:true,permissionEnforced:true,nativeAttribution:true,tenantId:principal.tenantId,policyVersion:principal.policyVersion,resourceIds:actors.map(p=>p.resourceId),testIds:['synthetic-only'],qualifiedAt:new Date(NOW-1).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),evidenceReference:'synthetic-concurrency-fixture'})),
    resolveMetadata:async p=>({...s.metadata,resourceId:p.resourceId,ticketResourceIds:actors.map(p=>p.resourceId)}),resolveResources:async()=>actors.map(p=>({id:p.resourceId,label:`Synthetic ${p.resourceId}`,active:true,companyIds:[10]})),
    fetch:async(input,init)=>{
      active++;maximumActive=Math.max(maximumActive,active);fetches++;await new Promise<void>(resolve=>setTimeout(resolve,3));active--;
      const path=new URL(String(input)).pathname;
      return json(init?.method==='POST'?{itemId:7000+fetches}:path.endsWith('/ServiceCallTickets/6001')?{item:{id:6001,serviceCallID:5001,ticketID:1001}}:{item:{id:5001,...callPayload}});
    }});
  await Promise.all(actors.map(p=>s.port.createTicket(p,5001,1001)));await Promise.all(actors.map(p=>s.port.createResource(p,6001,p.resourceId)));
  assert.equal(fetches,32);assert.equal(permits,fetches);assert.ok(maximumActive<=4);assert.equal(active,0);
});
