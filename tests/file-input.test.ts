import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {resolveUploadInput} from '../packages/artifacts/src/file-input.js';
import {artifactStageSchema,opportunityArtifactStageSchema} from '../packages/artifacts/src/contracts.js';
import {toolFileMetadata} from '../apps/server/src/publication.js';
const signal=()=>AbortSignal.timeout(1000);
const file={download_url:'https://files.oaiusercontent.com/example?temporary=secret',file_id:'file-example',file_name:'original.png'};
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100_000)]);
test('file references transfer bytes larger than MCP request limit without base64 in arguments',async()=>{
 const input={file};assert(JSON.stringify(input).length<65536);
 const got=await resolveUploadInput(input,6_000_000,signal(),async(url,options)=>{
  assert.equal(String(url),file.download_url);assert.equal(options?.redirect,'error');assert.equal(options?.credentials,'omit');assert.equal(options?.headers,undefined);
  return new Response(png,{headers:{'content-type':'application/octet-stream'}});
 });assert.equal(got.filename,'original.png');assert.equal(got.mime,'image/png');assert.deepEqual(Buffer.from(got.content_base64,'base64'),png);
});
test('reject untrusted destinations before fetch and never reveal signed URL',async()=>{
 for(const url of ['http://files.oaiusercontent.com/a','https://localhost/a','https://169.254.169.254/a','https://files.oaiusercontent.com.evil.test/a','https://user:pass@files.oaiusercontent.com/a','https://files.oaiusercontent.com:444/a']){
  let called=false;await assert.rejects(resolveUploadInput({file:{...file,download_url:url}},100,signal(),async()=>{called=true;return new Response('x');}),/not supported/);assert.equal(called,false);
 }
 await assert.rejects(resolveUploadInput({file},100,signal(),async()=>{throw new Error(file.download_url);}),error=>!String(error).includes('temporary=secret'));
});
test('bounded download handles dishonest lengths, expiration and empty files',async()=>{
 for(const response of [new Response('x',{status:403}),new Response(''),new Response('abc',{headers:{'content-length':'999'}}),new Response('abcdef')])await assert.rejects(resolveUploadInput({file},3,signal(),async()=>response));
 await assert.rejects(resolveUploadInput({file},3,signal(),async()=>new Response('x',{status:302})));
});
test('base64 remains supported and ambiguous/missing sources are rejected',async()=>{
 const legacy={filename:'sample.txt',mime:'text/plain' as const,content_base64:'aGk='};assert.deepEqual(await resolveUploadInput(legacy,100,signal()),legacy);
 for(const input of [{},{file,...legacy},{content_base64:'aGk='}])await assert.rejects(resolveUploadInput(input,100,signal()));
});
test('both staging tools publish the exact ChatGPT file schema requirements',()=>{
 for(const [name,schema] of [['at_file_stage',artifactStageSchema],['opportunity_file_stage',opportunityArtifactStageSchema]] as const){
  assert.deepEqual(toolFileMetadata(name),{'openai/fileParams':['file']});
  const json=z.toJSONSchema(schema,{io:'input'}) as any,fs=json.properties.file;
  assert.deepEqual(fs.required,['download_url','file_id']);assert.deepEqual(Object.keys(fs.properties),['download_url','file_id','mime_type','file_name']);
 }
 assert.equal(toolFileMetadata('ticket_attachment_upload'),undefined);
});

test('unknown file formats use a binary MIME and CSV keeps its original type',async()=>{
 for(const [filename,hint,expected] of [['report.csv','text/plain','text/csv'],['data.constructor',undefined,'application/octet-stream'],['data.custom','application/x-custom','application/x-custom']]){
  const got=await resolveUploadInput({filename,mime:hint,content_base64:'AP8='},100,signal());assert.equal(got.mime,expected);assert.equal(got.content_base64,'AP8=');assert.equal(got.filename,filename);
 }
});
test('staging is discoverable as a local write',async()=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js');
 const s=createFixtureSystem();
 const write:any=await s.runtime.invoke(s.principals[0]!,'at_discover',{query:'at_file_stage',effect:'write'});
 assert(write.operations.some((op:any)=>op.name==='at_file_stage'&&op.effect==='write'));
 const read:any=await s.runtime.invoke(s.principals[0]!,'at_discover',{query:'at_file_stage',effect:'read'});assert.equal(read.operations.length,0);
});
