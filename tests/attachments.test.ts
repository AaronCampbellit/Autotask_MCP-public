import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppError, type Principal } from '../packages/contracts/src/index.js';
import { MemoryJournal, MemoryPrincipalStore, IntentCipher } from '../packages/storage/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { ArtifactService, MemoryArtifactCatalog } from '../packages/artifacts/src/index.js';
import { FixtureUnlimitedRequestBudget } from '../packages/autotask/src/budget.js';
import { FixtureTicketAttachmentPort, FixtureUnlimitedAttachmentByteBudget, HttpTicketAttachmentPort, TicketAttachmentService } from '../packages/attachments/src/index.js';

const roots: string[] = [];
const work = resolve('work');
const errorCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

after(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(work, 'attachment-tests-')); roots.push(root);
  const [technician] = fixturePrincipals() as [Principal];
  const store = new MemoryPrincipalStore([technician]);
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store));
  const core = new TicketWorkflows(adapter, store, new MemoryJournal());
  const artifacts = new ArtifactService(core, { projectRoot: root, encryptionKey: randomBytes(32), catalog: new MemoryArtifactCatalog() });
  const port = new FixtureTicketAttachmentPort(store, [
    { id: 9001, ticketID: 1001, title: 'direct.txt', contentType: 'text/plain', fileSize: 5, attachmentType: 'FILE_ATTACHMENT', publish: 1, data: Buffer.from('hello').toString('base64') },
    { id: 9002, ticketID: 1001, title: 'note-child.txt', ticketNoteID: 3000, fileSize: 5, attachmentType: 'FILE_ATTACHMENT', publish: 1 },
    { id: 9003, ticketID: 1001, title: 'nested.txt', parentAttachmentID: 9001, fileSize: 5, attachmentType: 'FILE_ATTACHMENT', publish: 1 },
  ]);
  const service = new TicketAttachmentService(core, port, artifacts, new IntentCipher(Buffer.alloc(32, 8)), { publishInternal: 1, byteBudget: new FixtureUnlimitedAttachmentByteBudget() });
  return { technician, store, adapter, core, artifacts, port, service };
}

test('lists and gets ticket attachments including native descendants', async () => {
  const s = await setup();
  const listed = await s.service.list(s.technician, { ticket: { kind: 'id', id: 1001 } });
  assert.equal(listed.status, 'succeeded');
  assert.deepEqual(listed.attachments.map(row => row.id), [9001,9002,9003]);
  assert.match(listed.warnings.join(' '), /note, time-entry and nested/);
  const got = await s.service.get(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001 });
  assert.equal(got.attachment.title, 'direct.txt');
  assert.equal((await s.service.get(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: 9002 })).attachment.ticket_note_id,3000);
  await assert.rejects(s.service.get(s.technician, { ticket: { kind: 'id', id: 2001 }, attachment_id: 9001 }), errorCode('not_found_or_inaccessible'));
});

test('downloads native base64 in bounded chunks and rejects inconsistent bytes', async () => {
  const s = await setup();
  const chunk = await s.service.download(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001, offset: 1, length: 2 });
  assert.equal(Buffer.from(chunk.content_base64, 'base64').toString(), 'el');
  assert.equal(chunk.next_offset, 3);
  s.port.records[0]!.fileSize = 99;
  await assert.rejects(s.service.download(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001 }), errorCode('dependency_unavailable'));
});

test('upload requires validated staged bytes and is durable and idempotent by request key', async () => {
  const s = await setup();
  const staged = await s.artifacts.stageUpload(s.technician, { ticket: { kind: 'id', id: 1001 }, filename: 'hello.txt', mime: 'text/plain', content_base64: Buffer.from('hello').toString('base64') });
  const input = { ticket: { kind: 'id', id: 1001 }, artifact_id: staged.data.artifact_id, title: 'uploaded.txt', request_key: 'attachment-upload-1' };
  const first = await s.service.upload(s.technician, input);
  assert.equal(first.status, 'succeeded_verified');
  assert.equal(s.port.calls.filter(call => call.method === 'create').length, 1);
  const second = await s.service.upload(s.technician, input);
  assert.equal(second.operation_id, first.operation_id);
  assert.equal(s.port.calls.filter(call => call.method === 'create').length, 1);
  const native = s.port.records.find(row => row.id === Number(first.data.attachment_id))!;
  assert.equal(native.title, 'uploaded.txt'); assert.equal(native.fullPath, 'hello.txt');
  assert.equal(native.contentType, 'text/plain'); assert.equal(native.attachmentType, 'FILE_ATTACHMENT'); assert.equal(native.publish, 1);
  assert.equal(native.data, Buffer.from('hello').toString('base64')); assert.equal(native.fileSize, 5);
  assert.equal((await s.service.get(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: Number(first.data.attachment_id) })).attachment.title, 'uploaded.txt');
  await s.artifacts.remove(s.technician, { artifact_id: staged.data.artifact_id });
  const afterExpiry = await s.service.upload(s.technician, input);
  assert.equal(afterExpiry.operation_id, first.operation_id); assert.equal(s.port.calls.filter(call => call.method === 'create').length, 1);
});

test('delete verifies absence and never repeats a completed native delete', async () => {
  const s = await setup();
  const input = { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001, request_key: 'attachment-delete-1' };
  const first = await s.service.delete(s.technician, input);
  assert.equal(first.status, 'succeeded_verified');
  assert.equal(s.port.calls.filter(call => call.method === 'delete').length, 1);
  const second = await s.service.delete(s.technician, input);
  assert.equal(second.operation_id, first.operation_id);
  assert.equal(s.port.calls.filter(call => call.method === 'delete').length, 1);
  await assert.rejects(s.service.get(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001 }), errorCode('not_found_or_inaccessible'));
});

test('HTTP adapter uses exact reviewed attachment routes and qualification', async () => {
  const [principal] = fixturePrincipals() as [Principal];
  const store = new MemoryPrincipalStore([principal]);
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let malformedListing = false;
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname.split('/v1.0/')[1]!;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const item = { id: 9001, ticketID: 1001, title: 'direct.txt', contentType: 'text/plain', fileSize: 5, attachmentType: 'FILE_ATTACHMENT', publish: 1, data: Buffer.from('hello').toString('base64') };
    if (path === 'TicketAttachments/entityInformation/fields') return new Response(JSON.stringify({ fields: [{ name: 'publish', isPickList: true, picklistValues: [{ value: '1', label: 'Internal', isActive: true }] }] }), { status: 200 });
    if (path === 'TicketAttachments/query') return new Response(JSON.stringify({ items: [malformedListing ? { ...item, id: 0 } : item], pageDetails: { nextPageUrl: null } }), { status: 200 });
    if (path === 'TicketAttachments/9001') return new Response(JSON.stringify({ item }), { status: 200 });
    if (path === 'Tickets/1001/Attachments' && method === 'POST') return new Response(JSON.stringify({ itemId: 9002 }), { status: 200 });
    if (path === 'Tickets/1001/Attachments/9001' && method === 'DELETE') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const port = new HttpTicketAttachmentPort({
    baseUrl: 'https://webservices5.autotask.net/atservicesrest/v1.0/', username: 'api-user', secret: 'api-secret', integrationCode: 'integration-code', principals: store,
    requestBudget: new FixtureUnlimitedRequestBudget(), writesEnabled: true, publishInternalLabel: 'Internal', applicationOperations: { tenantId: principal.tenantId, operations: ['TicketAttachments.query', 'TicketAttachments.get', 'TicketAttachments.create', 'TicketAttachments.delete', 'TicketAttachments.fields'] }, fetch: fetcher,
  });
  assert.equal(await port.resolvePublishInternal(principal), 1);
  assert.equal((await port.list(principal, 1001)).items[0]!.id, 9001);
  const query = calls.find(call => call.method === 'POST' && call.path === 'TicketAttachments/query');
  assert.deepEqual(query?.body, { filter: [{ op: 'eq', field: 'ticketID', value: 1001 }], MaxRecords: 100 });
  malformedListing = true;
  await assert.rejects(port.list(principal, 1001), errorCode('dependency_unavailable'));
  malformedListing = false;
  assert.equal((await port.get(principal, 1001, 9001)).title, 'direct.txt');
  assert.equal((await port.create(principal, 1001, { title: 'x.txt', fullPath: 'x.txt', attachmentType: 'FILE_ATTACHMENT', contentType: 'text/plain', publish: 1, data: Buffer.from('x').toString('base64') }, async () => {})).id, 9002);
  await port.delete(principal, 1001, 9001, async () => {});
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['GET TicketAttachments/entityInformation/fields', 'POST TicketAttachments/query', 'POST TicketAttachments/query', 'GET TicketAttachments/9001', 'POST Tickets/1001/Attachments', 'DELETE Tickets/1001/Attachments/9001']);
  const denied = new HttpTicketAttachmentPort({ baseUrl: 'https://webservices5.autotask.net/atservicesrest/v1.0/', username: 'api-user', secret: 'api-secret', integrationCode: 'integration-code', principals: store, requestBudget: new FixtureUnlimitedRequestBudget(), writesEnabled: false, publishInternalLabel: 'Internal', fetch: fetcher });
  await assert.rejects(denied.list(principal, 1001), errorCode('impersonation_not_qualified'));
});

test('delete requires a final ticket authorization check after native absence verification', async () => {
  const s = await setup();
  const originalGet = s.port.get.bind(s.port);
  let getCount = 0;
  s.port.get = async (...args) => {
    try { return await originalGet(...args); }
    finally { if (++getCount === 2) s.store.set({ ...s.technician, policyVersion: 'revoked-after-delete-verification' }); }
  };
  await assert.rejects(s.service.delete(s.technician, { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001, request_key: 'attachment-delete-final-auth' }), errorCode('forbidden'));
  assert.equal((s.core.journal as MemoryJournal).inspectAll()[0]!.state, 'accepted_unverified');
  assert.equal(s.port.calls.filter(call => call.method === 'delete').length, 1);
});

test('upload keeps accepted_unverified when final readback authorization is revoked', async () => {
  const s = await setup();
  const staged = await s.artifacts.stageUpload(s.technician, { ticket: { kind: 'id', id: 1001 }, filename: 'hello.txt', mime: 'text/plain', content_base64: Buffer.from('hello').toString('base64') });
  const originalGet = s.port.get.bind(s.port);
  s.port.get = async (...args) => { const result = await originalGet(...args); s.store.set({ ...s.technician, policyVersion: 'revoked-after-upload-verification' }); return result; };
  await assert.rejects(s.service.upload(s.technician, { ticket: { kind: 'id', id: 1001 }, artifact_id: staged.data.artifact_id, title: 'uploaded.txt', request_key: 'attachment-upload-final-auth' }), errorCode('forbidden'));
  assert.equal((s.core.journal as MemoryJournal).inspectAll()[0]!.state, 'accepted_unverified');
  assert.equal(s.port.calls.filter(call => call.method === 'create').length, 1);
});

test('rechecks parent authorization after a collection response', async () => {
  const s = await setup();
  const list = s.port.list.bind(s.port);
  s.port.list = async (...args) => { const result = await list(...args); s.store.set({ ...s.technician, policyVersion: 'revoked-after-response' }); return result; };
  await assert.rejects(s.service.list(s.technician, { ticket: { kind: 'id', id: 1001 } }), errorCode('forbidden'));
});

test('concurrent delete requests with one key reserve one native operation', async () => {
  const s = await setup();
  const input = { ticket: { kind: 'id', id: 1001 }, attachment_id: 9001, request_key: 'attachment-delete-race' };
  const results = await Promise.all([s.service.delete(s.technician, input), s.service.delete(s.technician, input)]);
  assert.equal(s.port.calls.filter(call => call.method === 'delete').length, 1);
  assert.equal(results[0]!.operation_id, results[1]!.operation_id);
  assert.ok(results.every(result => result.safe_to_redispatch === false));
});
test('closed ticket attachment uploads directly without a ticket status write',async()=>{const s=await setup();s.adapter.records.Tickets.find(t=>t.id===1001)!.status=5;const staged=await s.artifacts.stageUpload(s.technician,{ticket:{kind:'id',id:1001},filename:'closed.txt',mime:'text/plain',content_base64:Buffer.from('closed ticket evidence').toString('base64')});const r=await s.service.upload(s.technician,{ticket:{kind:'id',id:1001},artifact_id:staged.data.artifact_id,title:'Closed ticket file',request_key:'closed-ticket-attachment'});assert.equal(r.status,'succeeded_verified');assert.equal(s.adapter.records.Tickets.find(t=>t.id===1001)!.status,5);assert.equal(s.adapter.calls.some(c=>c.entity==='Tickets'&&c.kind==='patch'),false);});


test('copies a note attachment on the server, preserves filename/bytes, and does not replay',async()=>{
 const s=await setup(); s.adapter.records.Tickets.push({...s.adapter.records.Tickets.find(t=>t.id===1001)!,id:1099,ticketNumber:'T20260917.0099'});
 const original=s.port.records.find(r=>r.id===9002)!;Object.assign(original,{title:'Aysu.xlsx',fullPath:'Aysu.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data:Buffer.from('hello').toString('base64')});
 const args={source_ticket:{kind:'id',id:1001},attachment_id:9002,ticket:{kind:'id',id:1099},request_key:'copy-note-file-1'};
 const result=await s.service.copy(s.technician,args);assert.equal(result.status,'succeeded_verified');
 const copied=s.port.records.find(r=>r.ticketID===1099)!;assert.equal(copied.title,'Aysu.xlsx');assert.equal(copied.fullPath,'Aysu.xlsx');assert.equal(copied.data,original.data);assert.equal(copied.publish,1);assert.equal(copied.ticketNoteID,undefined);
 assert.equal((await s.service.copy(s.technician,args)).operation_id,result.operation_id);assert.equal(s.port.calls.filter(c=>c.method==='create').length,1);
 await assert.rejects(s.service.copy(s.technician,{...args,attachment_id:9001}),errorCode('conflict'));
});

test('copy refuses inaccessible parents and changed source bytes before dispatch',async()=>{
 const s=await setup();const args={source_ticket:{kind:'id',id:1001},attachment_id:9001,ticket:{kind:'id',id:2001},request_key:'copy-scope-test'};
 await assert.rejects(s.service.copy(s.technician,args));assert.equal(s.port.calls.filter(c=>c.method==='create').length,0);
 const create=s.port.create.bind(s.port);s.port.create=async(p,id,payload,guard)=>{s.port.records[0]!.data=Buffer.from('other').toString('base64');return create(p,id,payload,guard);};
 const r=await s.service.copy(s.technician,{...args,ticket:{kind:'id',id:1001}});assert.equal(r.status,'failed');assert.equal(s.port.calls.filter(c=>c.method==='create').length,0);
});

test('copy mismatch stays unverified and lost acknowledgement never causes another upload',async()=>{
 for(const mode of ['mismatch','lost']){const s=await setup();const create=s.port.create.bind(s.port);s.port.create=async(...args)=>{const saved=await create(...args);if(mode==='lost')throw new AppError('unknown_outcome','Lost response');s.port.records.find(r=>r.id===saved.id)!.data=Buffer.from('wrong').toString('base64');return saved;};
 const args={source_ticket:{kind:'id',id:1001},attachment_id:9001,ticket:{kind:'id',id:1001},request_key:'uncertain-copy-file'};
 const r=await s.service.copy(s.technician,args);assert.equal(r.status,mode==='lost'?'unknown_outcome':'accepted_unverified');await s.service.copy(s.technician,args);assert.equal(s.port.calls.filter(c=>c.method==='create').length,1);
 }
});

test('XLSX staging and upload preserve original filename and bytes',async()=>{
 const {readFile}=await import('node:fs/promises');const {isXlsx,XLSX_MIME}=await import('../packages/artifacts/src/xlsx.js');
 const bytes=await readFile('tests/fixtures/minimal.xlsx');assert.equal(isXlsx(bytes),true);
 const s=await setup(),input={ticket:{kind:'id',id:1001},filename:'onboarding.xlsx',mime:XLSX_MIME,content_base64:bytes.toString('base64')};
 const staged=await s.artifacts.stageUpload(s.technician,input);assert.equal(staged.data.mime,XLSX_MIME);
 const saved=await s.service.upload(s.technician,{ticket:input.ticket,artifact_id:staged.data.artifact_id,title:input.filename,request_key:'xlsx-roundtrip-file'});assert.equal(saved.status,'succeeded_verified');
 assert.equal(s.port.records.find(r=>r.id===saved.data.attachment_id)!.data,input.content_base64);
 assert.equal(s.port.records.find(r=>r.id===saved.data.attachment_id)!.fullPath,input.filename);

});

test('copy is published as a write and runtime validates its receipt',async()=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js');const {ToolRuntime}=await import('../apps/server/src/tool-runtime.js');
 const s=await setup(),fixture=createFixtureSystem(),runtime=new ToolRuntime({...fixture.runtime.options,attachments:s.service});
 const tool=runtime.tools.find(t=>t.name==='ticket_attachment_copy')!;assert.equal(tool.write,true);
 const result:any=await runtime.invoke(fixture.principals[0]!,'ticket_attachment_copy',{source_ticket:{kind:'id',id:1001},attachment_id:9001,ticket:{kind:'id',id:1001},request_key:'runtime-native-copy'});
 assert.equal(result.status,'succeeded_verified');assert.equal(result.safe_to_redispatch,false);
});

test('filename mismatch cannot be reported as a verified upload',async()=>{
 const s=await setup(),create=s.port.create.bind(s.port);
 s.port.create=async(...args)=>{const saved=await create(...args);s.port.records.find(r=>r.id===saved.id)!.fullPath='changed.txt';return saved;};
 const staged=await s.artifacts.stageUpload(s.technician,{ticket:{kind:'id',id:1001},filename:'original.csv',content_base64:Buffer.from('a,b').toString('base64')});
 const result=await s.service.upload(s.technician,{ticket:{kind:'id',id:1001},artifact_id:staged.data.artifact_id,title:'CSV',request_key:'filename-mismatch-upload'});
 assert.equal(result.status,'accepted_unverified');
});
