import test from 'node:test';
import assert from 'node:assert/strict';
import {numberRange,assertAlignment,chooseDefault,preferredRole,classificationGuidance} from '../packages/classification/src/index.js';

test('classification uses display-name hundreds, not IDs or arbitrary digits in text',()=>{
  for(const [name,range] of [['300 TAM',300],['303 Design Desk',300],['411 Deploy - PC',400],['410 PS-Deployments',400],['499 Other',400],['400',400],[' 411: Deploy',400]] as const)assert.equal(numberRange(name),range);
  for(const name of ['Support','Helpdesk 411','4110 Deploy','41 Deploy','411Deploy',''])assert.equal(numberRange(name),undefined);
  assert.doesNotThrow(()=>assertAlignment({category:'411 Deploy - PC',queue:'499 Other',work_type:'410 Deploy Computer'}));
  assert.doesNotThrow(()=>assertAlignment({category:'300 TAM',queue:'300 SA-TAM',work_type:'303 Design Desk'}));
  assert.throws(()=>assertAlignment({category:'300 TAM',queue:'410 PS-Deployments',work_type:'303 Design Desk'}),/classification_override/);
  assert.throws(()=>assertAlignment({category:'300 TAM',queue:'Support',work_type:undefined}),/Classification/);
  assert.doesNotThrow(()=>assertAlignment({category:'Standard',queue:'Support',work_type:undefined}));
});
test('numbered defaults require an eligible unique or designated choice; explicit overrides allow exceptions',()=>{
  const choices=[{id:2,label:'411 Deploy PC',active:true},{id:777,label:'412 Deploy Server',active:true},{id:411,label:'300 TAM',active:true,isDefault:true}];
  assert.equal(chooseDefault(choices,400),undefined);assert.equal(chooseDefault(choices,300)?.id,411);
  assert.equal(chooseDefault([choices[0]!],400)?.id,2);
  assert.doesNotThrow(()=>assertAlignment({category:'300 TAM',queue:'410 PS',work_type:'Standard'},'User requested this cross-team routing.'));
  assert.throws(()=>assertAlignment({category:'300 TAM',queue:'410 PS'},'   '));
  assert.match(classificationGuidance,/Tool arguments inferred by the assistant do not themselves establish a user override/);
});
test('role preference uses the matching range before the employee default, without arbitrary ties',()=>{
  const roles=[{id:5,label:'100 Engineer',active:true,isDefault:true},{id:9,label:'400 Deployment Engineer',active:true}];
  assert.equal(preferredRole(roles,400)?.id,9);assert.equal(preferredRole(roles,300)?.id,5);
  assert.equal(preferredRole([...roles,{id:10,label:'410 Project Engineer',active:true}],400),undefined);
  assert.equal(preferredRole([...roles,{id:10,label:'410 Project Engineer',active:true}],400,10)?.id,10);
});
