import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldsSchema,validateNativeField,validateUdfs,fieldMatches} from '../packages/native-fields/src/index.js';
test('native metadata validates types, parent picklists, nullability and read-only fields',()=>{
 const field={name:'newField',dataType:'integer',isReadOnly:false,isRequired:true};
 assert.equal(validateNativeField(field,3),3);
 for(const v of [null,2.5,'3',true])assert.throws(()=>validateNativeField(field,v));
 assert.throws(()=>validateNativeField({...field,isReadOnly:true},3));assert.throws(()=>validateNativeField(undefined,3));
 const child={...field,isPickList:true,picklistParentValueField:'parent',picklistValues:[{value:'5',label:'Child',isActive:true,parentValue:1}]};
 assert.equal(validateNativeField(child,'Child',{parent:1}),5);assert.throws(()=>validateNativeField(child,5,{parent:2}));
});
test('UDF patches validate names and preserve independent values in partial readback comparisons',()=>{
 const meta=[{name:'Tracking',type:'string',isReadOnly:false},{name:'Locked',dataType:'string',isReadOnly:true}];
 assert.deepEqual(validateUdfs([{name:'Tracking',value:'ABC'}],meta),[{name:'Tracking',value:'ABC'}]);
 assert.throws(()=>validateUdfs([{name:'Locked',value:'ABC'}],meta));assert.throws(()=>validateUdfs([{name:'Unknown',value:'ABC'}],meta));
 assert.equal(fieldsSchema.safeParse({userDefinedFields:[{name:'Tracking',value:'A'},{name:'Tracking',value:'B'}]}).success,false);
 assert.equal(fieldMatches('userDefinedFields',[{name:'Other',value:'keep'},{name:'Tracking',value:'ABC'}],[{name:'Tracking',value:'ABC'}]),true);
 assert.equal(fieldMatches('userDefinedFields',[],[{name:'Tracking',value:null}]),true);
 assert.equal(fieldMatches('userDefinedFields',[{name:'Tracking',value:'new'}],[{name:'Tracking',value:'old'}]),false);
});
