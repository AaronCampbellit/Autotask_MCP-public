import assert from 'node:assert/strict';
import test from 'node:test';
import {expandedSearchSchema,referenceResolveSchema} from '../packages/workflows/src/technician-workflows.js';
import {resolveScopedReference,referenceCatalogSchema} from '../packages/technician/src/index.js';
import {type Principal} from '../packages/contracts/src/index.js';

test('zero company references and search remain explicit and scoped',()=>{
 const p:Principal={tenantId:'t',objectId:'o',resourceId:1,mappingVersion:1,policyVersion:'p',companyIds:[0,186],capabilities:['operational.read'],active:true,resourceVerifiedAt:new Date().toISOString()};
 const items=[{id:0,label:'Internal',active:true,companyIds:[0]}];
 assert.equal(resolveScopedReference('company',{kind:'id',id:0},items,'v',p).id,0);
 assert.throws(()=>resolveScopedReference('company',{kind:'id',id:0},items,'v',{...p,companyIds:[186]}));
 assert.equal(expandedSearchSchema.parse({company_id:0}).company_id,0);
 assert.equal(expandedSearchSchema.safeParse({company_id:0,company:{kind:'name',name:'Internal'}}).success,false);
 for(const kind of ['company','resource','queue','status','category','priority']){
  assert.equal(referenceResolveSchema.safeParse({kind,reference:{kind:'id',id:0}}).success,kind==='company');
  assert.equal(referenceCatalogSchema.safeParse({tenantId:p.tenantId,objectId:p.objectId,resourceId:p.resourceId,mappingVersion:p.mappingVersion,policyVersion:p.policyVersion,source:'fixture',version:'v',validUntil:new Date(Date.now()+60000).toISOString(),kind,complete:true,items}).success,kind==='company');
 }
});

test('pilot search accepts the observed suffixed ticket number without broadening input syntax',()=>{assert.equal(expandedSearchSchema.safeParse({ticket_number:'T20250903.0041.045',company_id:0}).success,true);for(const ticket_number of ['T20250903.0041.invalid','T20250903.0041/../../','T20250903.0041.' ])assert.equal(expandedSearchSchema.safeParse({ticket_number}).success,false);});
