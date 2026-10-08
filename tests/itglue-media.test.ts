import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDocumentImage,validateDocumentImage,type DocumentImageContext} from '../packages/itglue/src/media.js';
import {MemoryItGlueStore,emptyConfig,type Row} from '../packages/itglue/src/store.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {AppError} from '../packages/contracts/src/index.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const args={company:10,document_id:'300',artifact_id:'00000000-0000-4000-8000-000000000001',request_key:'image-upload'};
function setup(){
 const p=fixturePrincipals()[0]!,store=new MemoryItGlueStore(),state={company:10,allowed:true,unknown:false,wrongParent:false,changed:false,downloads:0,writes:0},calls:Row[]=[];
 const metadata={filename:'diagram.png',mime:'image/png',bytes:png.length,sha256:sha(png)};
 const image=()=>({id:'400',type:'document-images',attributes:{'document-id':state.wrongParent?301:300,target:{type:'document',id:300},'inline-resource-url':'/100/docs/300/developer/images/400','original-src':'https://untrusted.invalid/object?credential=never-return'}});
 const context:DocumentImageContext={store,config:{...emptyConfig(),version:1,key:'secret',enabled:true,writesEnabled:true},organizationId:'100',guard:async()=>{if(!state.allowed)throw new AppError('forbidden','revoked');},artifacts:{download:async()=>{state.downloads++;return{bytes:png,metadata:{...metadata,...(state.changed&&state.downloads>1?{sha256:'0'.repeat(64)}:{})},headers:{}} as any;},catalog:{get:async()=>({companyId:state.company,kind:'staged_upload'})} as any},port:{request:async(_c,path,_q,body,guard,beforeWrite,method)=>{await guard?.();if(method==='POST'){await beforeWrite?.();state.writes++;calls.push({path,body});if(state.unknown)throw Error('lost');}return{data:image()};}}};return{context,p,state,calls,store,metadata};
}
test('image envelope pins document target, preserves bytes and returns only checked relative path',async()=>{
 const f=setup(),r=await createDocumentImage(f.context,f.p,args);assert.equal(r.state,'verified');assert.equal(f.state.downloads,2);assert.equal(f.state.writes,1);assert.deepEqual(f.calls[0]!.body,{data:{type:'document-images',attributes:{target:{type:'document',id:300},image:{content:png.toString('base64'),'file-name':'diagram.png'}}}});assert.equal(r.steps[0]!.inline_resource_url,'/100/docs/300/developer/images/400');assert.doesNotMatch(JSON.stringify(r),/untrusted|never-return|iVBOR/);
 await createDocumentImage(f.context,f.p,args);assert.equal(f.state.writes,1);assert.equal(f.state.downloads,2);
});
test('unknown uploads reserve the key permanently and mismatched native parents stay unverified',async()=>{
 const f=setup();f.state.unknown=true;assert.equal((await createDocumentImage(f.context,f.p,args)).state,'unknown_outcome');await createDocumentImage(f.context,f.p,args);assert.equal(f.state.writes,1);
 const g=setup();g.state.wrongParent=true;assert.equal((await createDocumentImage(g.context,g.p,args)).state,'unknown_outcome');assert.equal(g.state.writes,1);
});
test('artifact ownership company, changed bytes and revoked dispatch guard prevent uploads',async()=>{
 const f=setup();f.state.company=20;await assert.rejects(()=>createDocumentImage(f.context,f.p,args),{code:'not_found_or_inaccessible'});assert.equal(f.state.writes,0);
 const g=setup();g.state.changed=true;await assert.rejects(()=>createDocumentImage(g.context,g.p,args));assert.equal(g.state.writes,0);
 const h=setup(),original=h.context.port.request;h.context.port.request=async(...a)=>{h.state.allowed=false;return original(...a);};await assert.rejects(()=>createDocumentImage(h.context,h.p,args),{code:'forbidden'});assert.equal(h.state.writes,0);
});
test('image validation rejects HTML/SVG, renamed files, wrong hash, oversize and excessive PNG dimensions',()=>{
 const f=setup();for(const metadata of [{...f.metadata,mime:'image/svg+xml'},{...f.metadata,filename:'diagram.html'},{...f.metadata,sha256:'0'.repeat(64)}])assert.throws(()=>validateDocumentImage(png,metadata));
 const huge=Buffer.alloc(5_000_001);assert.throws(()=>validateDocumentImage(huge,{...f.metadata,bytes:huge.length,sha256:sha(huge)}));
 const wide=Buffer.from(png);wide.writeUInt32BE(20001,16);assert.throws(()=>validateDocumentImage(wide,{...f.metadata,sha256:sha(wide)}));
 assert.throws(()=>validateDocumentImage(Buffer.from('<svg/>'),{...f.metadata,bytes:6,sha256:sha(Buffer.from('<svg/>'))}));
});
test('concurrent requests dispatch once and keys cannot change target or artifact',async()=>{
 const f=setup();const results=await Promise.all([createDocumentImage(f.context,f.p,args),createDocumentImage(f.context,f.p,args)]);assert.equal(results[0]!.id,results[1]!.id);assert.equal(f.state.writes,1);await assert.rejects(()=>createDocumentImage(f.context,f.p,{...args,document_id:'301'}),{code:'conflict'});
});

test('runtime image upload uses an actor-owned staged artifact and native document guards',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js');const f=createFixtureSystem();t.after(()=>f.app.close());const old=f.principals[0]!,p={...old,capabilities:[...old.capabilities,'documentation.read' as const,'documentation.write' as const,'platform.manage' as const],mappingVersion:old.mappingVersion+1};await f.controlStore.saveMember(old,p,old.mappingVersion,new Date().toISOString());
 const glue=f.runtime.options.itglue!;await glue.configure(p,{version:0,region:'us',key:'fixture-key',enabled:false,writes_enabled:false});await glue.mapOrganization(p,{version:1,company:10,organization_id:'100',enabled:true});await glue.configure(p,{version:2,region:'us',enabled:true,writes_enabled:true});
 const staged=await f.artifacts.stageUpload(p,{ticket:{kind:'id',id:1001},filename:'diagram.png',mime:'image/png',content_base64:png.toString('base64')});
 const original=glue.port.request.bind(glue.port);let writes=0;
 glue.port.request=async(c,path,q={},body,guard,beforeWrite,method)=>{if(path.startsWith('/document_images')){await guard?.();if(method==='POST'){await beforeWrite?.();writes++;}return{data:{id:'400',type:'document-images',attributes:{'document-id':300,target:{type:'document',id:300},'inline-resource-url':'/100/docs/300/developer/images/400'}}};}return original(c,path,q,body,guard,beforeWrite,method);};
 const input={company:10,document_id:'300',artifact_id:staged.data.artifact_id,request_key:'runtime-image-upload'};
 const first=await f.runtime.invoke(p,'itg_document_image_create',input) as Row,second=await f.runtime.invoke(p,'itg_document_image_create',input) as Row;assert.equal(first.status,'verified');assert.equal(first.data.operation_id,second.data.operation_id);assert.equal(writes,1);
 await f.artifacts.remove(p,{artifact_id:staged.data.artifact_id});
});
