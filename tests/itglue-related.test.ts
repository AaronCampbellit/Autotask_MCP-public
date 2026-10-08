import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSupplement} from '../packages/itglue/src/related.js';
const item=(id:string,type:string,org='100')=>({id,type,attributes:{'organization-id':org}});
test('expiration pages enforce organization and omit linked secrets and signed URLs',async()=>{
 const raw={data:[{...item('1','expirations'),attributes:{'organization-id':'100','expiration-date':'2026-12-01',description:'secret-canary','resource-url':'https://signed/secret-canary'}}],meta:{'total-pages':2}};
 const result=await readSupplement('itg_expiration_search',{page_size:10},'100',1,async path=>{assert.equal(path,'/organizations/100/relationships/expirations');return raw;});
 assert.equal(result.complete,false);assert.equal(JSON.stringify(result.data).includes('secret-canary'),false);
 raw.data[0]!.attributes['organization-id']='999';await assert.rejects(readSupplement('itg_expiration_search',{page_size:10},'100',1,async()=>raw),/outside/);
});
test('reference projection excludes cross-client counts and validates metadata',async()=>{
 const result=await readSupplement('itg_reference_search',{page_size:10,reference_type:'configuration_types'},'100',1,async()=>({data:[{id:'1',type:'configuration-types',attributes:{name:'Switch','configurations-count':500}}],meta:{'total-pages':1}}));
 assert.equal(result.complete,true);assert.equal(JSON.stringify(result.data).includes('500'),false);
 await assert.rejects(readSupplement('itg_reference_search',{page_size:10,reference_type:'passwords'},'100',1,async()=>{throw Error('must not fetch');}),/Unsupported/);
 await assert.rejects(readSupplement('itg_reference_search',{page_size:10,reference_type:'contact_types'},'100',1,async()=>({data:[]})),/metadata/);
});
function related(){return{data:{...item('1','configurations'),relationships:{'related-items':{data:[{id:'9',type:'related-items'},{id:'8',type:'related-items'}]}}},included:[{id:'9',type:'related-items',attributes:{'destination-type':'Contact','destination-id':'2',notes:'secret-canary'}},{id:'8',type:'related-items',attributes:{'destination-type':'Password','destination-id':'3',notes:'secret-canary'}}]};}
test('related evidence reads only linked reviewed targets and never fetches passwords',async()=>{
 const paths:string[]=[];const result=await readSupplement('itg_related_items_get',{page_size:10,resource_type:'configurations',resource_id:'1'},'100',1,async(path,q)=>{paths.push(path);return path==='/contacts/2'?{data:item('2','contacts')}:q?related():{data:item('1','configurations')};});
 assert.deepEqual(paths,['/configurations/1','/contacts/2','/configurations/1']);assert.equal(result.complete,false);assert.equal(JSON.stringify(result.data).includes('secret-canary'),false);
});
test('related evidence rejects cross-organization targets and source moves at final read',async()=>{
 const args={page_size:10,resource_type:'configurations',resource_id:'1'};
 await assert.rejects(readSupplement('itg_related_items_get',args,'100',1,async(path,q)=>path==='/contacts/2'?{data:item('2','contacts','999')}:related()),/outside/);
 await assert.rejects(readSupplement('itg_related_items_get',args,'100',1,async(path,q)=>path==='/contacts/2'?{data:item('2','contacts')}:q?related():{data:item('1','configurations','999')}),/outside/);
});
test('empty related linkage needs no included array and malformed IDs fail closed',async()=>{
 const args={page_size:10,resource_type:'configurations',resource_id:'1'};
 const result=await readSupplement('itg_related_items_get',args,'100',1,async(_path,q)=>({data:{...item('1','configurations'),...(q?{relationships:{related_items:{data:[]}}}:{})}}));assert.deepEqual(result.data,[]);assert.equal(result.complete,false);
 await assert.rejects(readSupplement('itg_related_items_get',args,'100',1,async()=>({data:{...item('wrong','configurations')}})),/outside/);
});
