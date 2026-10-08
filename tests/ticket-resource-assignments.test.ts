import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryJournal,MemoryPrincipalStore} from '../packages/storage/src/index.js';
import type {AutotaskPort} from '../packages/contracts/src/index.js';
import {FixtureAutotaskAdapter,fixturePrincipals,fixtureRecords} from '../packages/workflows/src/fixtures.js';
import {TicketWorkflows} from '../packages/workflows/src/index.js';
import {TicketSecondaryResourceWorkflows} from '../packages/workflows/src/secondary-resources.js';
import type {TechnicianWorkflows} from '../packages/workflows/src/technician-workflows.js';

function setup(){
 const principal=fixturePrincipals()[0]!,store=new MemoryPrincipalStore([principal]);
 const adapter=new FixtureAutotaskAdapter(async p=>(await store.get(p.tenantId,p.objectId))!,fixtureRecords());
 const core=new TicketWorkflows(adapter,store,new MemoryJournal());
 const secondary=[{id:501,resource_id:202,role_id:5}];
 const options=()=>({ticket_id:1001,company_id:10,primary_resource_id:101,primary_role_id:null,secondary_resources:structuredClone(secondary),eligible_resource_roles:[{resource_id:202,resource_name:'Second Employee',role_id:5,role_name:'Service Desk'},{resource_id:303,resource_name:'Third Employee',role_id:5,role_name:'Service Desk'}],limit:50,remaining:50-secondary.length,valid_until:new Date(Date.now()+30_000).toISOString()});
 let primaryInput:unknown,creates=0,deletes=0;
 const technician={update:async (_:unknown,input:unknown)=>{primaryInput=input;return{status:'succeeded_verified',operation_id:'primary',data:{ticket_id:1001},safe_to_redispatch:false};}} as unknown as TechnicianWorkflows;
 const port=adapter as AutotaskPort;
 port.createTicketSecondaryResource=async (_p,ticketId,resourceId,roleId,before)=>{await before();creates++;secondary.push({id:502,resource_id:resourceId,role_id:roleId});assert.equal(ticketId,1001);return{id:502};};
 port.getTicketSecondaryResource=async (_p,ticketId,id)=>{assert.equal(ticketId,1001);const row=secondary.find(v=>v.id===id)!;return{id:row.id,ticketID:ticketId,resourceID:row.resource_id,roleID:row.role_id};};
 port.deleteTicketSecondaryResource=async (_p,ticketId,id,before)=>{await before();assert.equal(ticketId,1001);deletes++;secondary.splice(secondary.findIndex(v=>v.id===id),1);};
 return{principal,secondary,workflow:new TicketSecondaryResourceWorkflows(core,async()=>options(),technician),calls:()=>({creates,deletes}),primaryInput:()=>primaryInput};
}

const ticket={kind:'id' as const,id:1001};
test('primary assignment forwards exact employee, role and expected previous assignment',async()=>{
 const s=setup();
 await s.workflow.assignPrimary(s.principal,{ticket,resource:{kind:'id',id:303,name:'Third Employee'},role:{kind:'id',id:5,name:'Service Desk'},expected_primary_resource_id:101,expected_primary_role_id:null,request_key:'primary-assign-1'});
 assert.deepEqual(s.primaryInput(),{ticket,changes:{owner:{kind:'id',id:303,name:'Third Employee'},role:{kind:'id',id:5}},expected:{assignedResourceID:101,assignedResourceRoleID:null},request_key:'primary-assign-1'});
 await assert.rejects(s.workflow.assignPrimary(s.principal,{ticket,resource:{kind:'id',id:202,name:'Second Employee'},role:{kind:'id',id:5,name:'Service Desk'},expected_primary_resource_id:101,expected_primary_role_id:null,request_key:'primary-assign-2'}));
});

test('secondary add and remove are scoped, verified, and do not redispatch a repeated key',async()=>{
 const s=setup();const add={ticket,resource:{kind:'id',id:303,name:'Third Employee'},role:{kind:'id',id:5,name:'Service Desk'},request_key:'secondary-add-1'};
 const created=await s.workflow.add(s.principal,add);assert.equal(created.status,'succeeded_verified');
 assert.equal((await s.workflow.add(s.principal,add)).operation_id,created.operation_id);assert.equal(s.calls().creates,1);
 const remove={ticket,secondary_resource_id:502,resource_id:303,role_id:5,request_key:'secondary-remove-1'};
 const removed=await s.workflow.remove(s.principal,remove);assert.equal(removed.status,'succeeded_verified');
 assert.equal((await s.workflow.remove(s.principal,remove)).operation_id,removed.operation_id);assert.equal(s.calls().deletes,1);
 await assert.rejects(s.workflow.remove(s.principal,{...remove,role_id:6,request_key:'secondary-remove-2'}));
});
