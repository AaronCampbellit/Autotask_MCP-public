import { TicketAttachmentService, FixtureTicketAttachmentPort, FixtureUnlimitedAttachmentByteBudget } from '../packages/attachments/src/index.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { AppError, actorKey, type Principal } from '../packages/contracts/src/index.js';
import { IntentCipher, MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
import { ArtifactService, MemoryArtifactCatalog, PostgresArtifactCatalog, csvCell, type ArtifactCatalog, type ArtifactRecord, type ArtifactServiceOptions } from '../packages/artifacts/src/index.js';

const roots: string[] = [], work = resolve('work');
await mkdir(work, { recursive: true });
after(async () => { for (const root of roots) { const target = await realpath(root), allowed = relative(await realpath(work), target); assert.ok(allowed && !allowed.startsWith('..') && !isAbsolute(allowed)); await rm(target, { recursive: true }); } });
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;
const input = (collection: 'ticket' | 'notes' | 'own_time' = 'notes') => ({ ticket: { kind: 'id', id: 1001 }, collection });
const upload = (bytes = Buffer.from('Fictitious plain attachment.')) => ({ ticket: { kind: 'id', id: 1001 }, filename: 'safe.txt', mime: 'text/plain', content_base64: bytes.toString('base64') });
async function setup(options: Partial<ArtifactServiceOptions> = {}) {
  const root = await mkdtemp(join(work, 'artifact-tests-')); roots.push(root);
  const [technician, reader] = fixturePrincipals() as [Principal, Principal], store = new MemoryPrincipalStore([technician, reader]);
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store)), core = new TicketWorkflows(adapter, store, new MemoryJournal());
  const catalog = options.catalog ?? new MemoryArtifactCatalog(), encryptionKey = randomBytes(32), clock = { value: Date.now() };
  const service = new ArtifactService(core, { projectRoot: root, encryptionKey, catalog, now: () => clock.value, ...options });
  return { root, technician, reader, store, adapter, core, catalog, clock, encryptionKey, service };
}
async function blobs(root: string) {
  const folder = join(root, 'work', 'artifacts'), output: string[] = [];
  try { for (const owner of await readdir(folder)) for (const filename of await readdir(join(folder, owner))) output.push(join(folder, owner, filename)); } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  return output;
}

test('CSV encodes quotes/newlines and neutralizes formulas even behind Unicode/control whitespace', () => {
  for (const value of ['=SUM(A1)', '+cmd', '-cmd', '@cmd', ' \t=cmd', '\r\n+cmd', '\ufeff=cmd', '\u200b=cmd']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('a"b\nc'), '"a""b\nc"'); assert.equal(csvCell(-1.5), '"-1.5"'); assert.equal(csvCell({ hidden: 'secret' }), '""');
});

test('fixed CSV projection, encrypted bytes, authenticated download headers and bounded chunks', async () => {
  const s = await setup();
  s.adapter.records.Tickets[0]!.description = '=HYPERLINK("https://untrusted.invalid")';
  s.adapter.records.Tickets[0]!.internalBillingRate = 987654321;
  const exported = await s.service.exportCsv(s.technician, input('ticket'));
  assert.equal(exported.status, 'succeeded');
  assert.equal(exported.data.mime, 'text/csv'); assert.equal(exported.data.rows, 1);
  const paths = await blobs(s.root); assert.equal(paths.length, 1);
  assert.equal((await readFile(paths[0]!)).includes(Buffer.from('HYPERLINK')), false);
  const file = await s.service.download(s.technician, { artifact_id: exported.data.artifact_id });
  assert.match(file.bytes.toString(), /'\=HYPERLINK/); assert.doesNotMatch(file.bytes.toString(), /987654321|internalBillingRate/);
  assert.match(file.headers['Content-Disposition'], /^attachment; filename="ticket-1001-[a-f0-9]{8}\.csv"; filename\*=UTF-8\'\'ticket-1001-[a-f0-9]{8}\.csv$/);
  assert.equal(file.headers['Cache-Control'], 'no-store'); assert.equal(file.headers['X-Content-Type-Options'], 'nosniff'); assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  const chunk = await s.service.downloadChunk(s.technician, { artifact_id: exported.data.artifact_id, offset: 0, length: 8 });
  assert.equal(Buffer.from(chunk.content_base64, 'base64').length, 8); assert.equal(chunk.next_offset, 8);
  assert.equal((s.catalog as MemoryArtifactCatalog).events.filter(event => event.action === 'downloaded').length, 2);
  assert.equal((await s.service.list(s.technician)).data.artifacts.length, 1);
  await assert.rejects(s.service.exportCsv(s.technician, { ...input(), fields: ['internalBillingRate'] }));
  await assert.rejects(s.service.download(s.technician, { artifact_id: '../../secret' }));
});

test('artifact ownership, mapping, policy and current company scope are rechecked after creation', async () => {
  for (const change of ['actor', 'mapping', 'policy', 'company'] as const) {
    const s = await setup(), artifact = (await s.service.exportCsv(s.technician, input('ticket'))).data;
    let caller = s.technician;
    if (change === 'actor') caller = s.reader;
    if (change === 'mapping') { caller = { ...caller, mappingVersion: 2 }; s.store.set(caller); }
    if (change === 'policy') { caller = { ...caller, policyVersion: 'new-policy' }; s.store.set(caller); }
    if (change === 'company') s.adapter.records.Tickets[0]!.companyID = 20;
    await assert.rejects(s.service.download(caller, { artifact_id: artifact.artifact_id }), code('not_found_or_inaccessible'));
    assert.equal((await s.service.list(caller)).data.artifacts.length, 0);
  }
});

test('every exported note and own-time record is checked again before download', async () => {
  for (const collection of ['notes', 'own_time'] as const) {
    const s = await setup(), artifact = (await s.service.exportCsv(s.technician, input(collection))).data;
    assert.ok(artifact.rows > 0);
    const entity = collection === 'notes' ? 'TicketNotes' : 'TimeEntries';
    const record = s.adapter.records[entity].find(row => row.ticketID === 1001 && (entity !== 'TimeEntries' || row.resourceID === 101))!;
    record.ticketID = 2001;
    await assert.rejects(s.service.download(s.technician, { artifact_id: artifact.artifact_id }), code('not_found_or_inaccessible'));
  }
});

test('actor policy revocation during a later artifact check rejects the whole listing', async () => {
  const s = await setup();
  await s.service.exportCsv(s.technician, input('ticket'));
  await s.service.exportCsv(s.technician, input('ticket'));
  const resolveTicket = s.core.resolveTicket.bind(s.core);
  let checked = 0;
  s.core.resolveTicket = async (...args) => {
    const ticket = await resolveTicket(...args);
    if (++checked === 2) s.store.set({ ...s.technician, policyVersion: 'revoked-during-list' });
    return ticket;
  };
  await assert.rejects(s.service.list(s.technician), code('forbidden'));
  assert.equal(checked, 2);
});

test('download rechecks employee and parent access after the durable access audit', async () => {
  for (const change of ['policy', 'parent'] as const) {
    const s = await setup(), artifact = (await s.service.exportCsv(s.technician, input('ticket'))).data;
    const access = s.catalog.access.bind(s.catalog);
    s.catalog.access = async (...args) => {
      await access(...args);
      if (change === 'policy') s.store.set({ ...s.technician, policyVersion: 'revoked-after-audit' });
      else s.adapter.records.Tickets[0]!.companyID = 20;
    };
    await assert.rejects(s.service.download(s.technician, { artifact_id: artifact.artifact_id }), code(change === 'policy' ? 'forbidden' : 'not_found_or_inaccessible'));
  }
});

test('export publication rechecks access before returning previews and removes inaccessible content', async () => {
  for (const change of ['policy', 'parent'] as const) {
    const s = await setup(), publish = s.catalog.publish.bind(s.catalog);
    s.catalog.publish = async (...args) => {
      await publish(...args);
      if (change === 'policy') s.store.set({ ...s.technician, policyVersion: 'revoked-after-publish' });
      else s.adapter.records.Tickets[0]!.companyID = 20;
    };
    await assert.rejects(s.service.exportCsv(s.technician, input('ticket')), code(change === 'policy' ? 'forbidden' : 'not_found_or_inaccessible'));
    assert.equal((await blobs(s.root)).length, 0);
    assert.equal((await s.catalog.list(actorKey(s.technician), s.clock.value)).length, 0);
  }
});

test('bounded exports explicitly report incompleteness and own-time exports exclude coworkers', async () => {
  const s = await setup({ limits: { maxRows: 1 } });
  s.adapter.records.TicketNotes.push({ id: 9001, ticketID: 1001, title: 'Second note', description: 'Fictitious extra note.', creatorResourceID: 101 });
  const notes = await s.service.exportCsv(s.technician, input());
  assert.equal(notes.status, 'partial'); assert.equal(notes.data.complete, false); assert.equal(notes.data.rows, 1); assert.match(notes.warnings.join(' '), /incomplete/);
  s.adapter.records.TimeEntries.push({ id: 9100, ticketID: 1001, resourceID: 999, hoursWorked: 23, summaryNotes: 'Coworker secret canary.' });
  const own = (await s.service.exportCsv(s.technician, input('own_time'))).data;
  assert.doesNotMatch((await s.service.download(s.technician, { artifact_id: own.artifact_id })).bytes.toString(), /Coworker secret canary/);
});

test('tampered bytes and wrong encryption keys never return plaintext', async () => {
  const s = await setup(), artifact = (await s.service.exportCsv(s.technician, input('ticket'))).data;
  const wrongKey = new ArtifactService(s.core, { projectRoot: s.root, encryptionKey: randomBytes(32), catalog: s.catalog });
  await assert.rejects(wrongKey.download(s.technician, { artifact_id: artifact.artifact_id }), code('dependency_unavailable'));
  const path = (await blobs(s.root))[0]!, bytes = await readFile(path); bytes[bytes.length - 1]! ^= 1; await writeFile(path, bytes);
  await assert.rejects(s.service.download(s.technician, { artifact_id: artifact.artifact_id }), code('dependency_unavailable'));
});

test('uploads validate safe filenames, MIME, canonical bytes and parent before staging', async () => {
  const validated = await setup();
  for (const patch of [{ filename: '../../secret.txt' }, { filename: 'safe.txt\r\nX-Header: attack' }, { filename: 'CON.txt' }, { mime: 'text/plain\r\nInjected: yes' }, { content_base64: '<html>' }, { content_base64: 'YQ===' }, { url: 'http://169.254.169.254/latest/meta-data' }]) await assert.rejects(validated.service.stageUpload(validated.technician, { ...upload(), ...patch }));
  await assert.rejects(validated.service.stageUpload(validated.reader, upload()), code('forbidden'));
  await assert.rejects(validated.service.stageUpload(validated.technician, { ...upload(), ticket: { kind: 'id', id: 2001 } }), code('not_found_or_inaccessible'));
  assert.equal((await blobs(validated.root)).length, 0);
});

test('validated upload stages only local encrypted content, with no Autotask attachment writes', async () => {
  const s = await setup(), result = await s.service.stageUpload(s.technician, upload());
  assert.equal(result.status, 'staged'); assert.equal(result.data.source, 'client_upload'); assert.match(result.warnings.join(' '), /no Autotask attachment was created/);
  assert.equal((await s.service.download(s.technician, { artifact_id: result.data.artifact_id })).bytes.toString(), 'Fictitious plain attachment.');
  assert.equal(s.adapter.calls.some(row => row.kind === 'create'), false);

});

test('artifact size, count quota and expiry cleanup are enforced', async () => {
  const small = await setup({ limits: { maxBytes: 50 } }); await assert.rejects(small.service.exportCsv(small.technician, input('ticket')), code('invalid_input'));
  const s = await setup({ limits: { maxPerActor: 1, ttlMs: 1000 } }), first = (await s.service.exportCsv(s.technician, input('ticket'))).data;
  await assert.rejects(s.service.exportCsv(s.technician, input('ticket')), code('throttled'));
  s.clock.value += 1001;
  await assert.rejects(s.service.download(s.technician, { artifact_id: first.artifact_id }), code('not_found_or_inaccessible'));
  assert.equal((await s.service.list(s.technician)).data.artifacts.length, 0);
  assert.equal((await s.service.cleanupExpired()).removed, 1); assert.equal((await blobs(s.root)).length, 0);
  assert.equal((await s.service.exportCsv(s.technician, input('ticket'))).status, 'succeeded');
});

test('owned deletion removes encrypted content and preserves redacted audit events', async () => {
  const s = await setup(), file = (await s.service.exportCsv(s.technician, input('ticket'))).data;
  await assert.rejects(s.service.remove(s.reader, { artifact_id: file.artifact_id }), code('not_found_or_inaccessible'));
  assert.equal((await s.service.remove(s.technician, { artifact_id: file.artifact_id })).deleted, true);
  assert.equal((await blobs(s.root)).length, 0);
  await assert.rejects(s.service.download(s.technician, { artifact_id: file.artifact_id }), code('not_found_or_inaccessible'));
  assert.ok((s.catalog as MemoryArtifactCatalog).events.some(event => event.action === 'deleted'));
  assert.doesNotMatch(JSON.stringify((s.catalog as MemoryArtifactCatalog).events), /description|title|summaryNotes/);
});

test('catalog reservation and download audit outages fail closed without leaking dependency error text', async () => {
  const catalog = new MemoryArtifactCatalog(), s = await setup({ catalog }), reserve = catalog.reserve.bind(catalog);
  catalog.reserve = async () => { throw new Error('database-secret-canary'); };
  await assert.rejects(s.service.exportCsv(s.technician, input('ticket')), error => error instanceof AppError && error.code === 'dependency_unavailable' && !error.message.includes('canary'));
  assert.equal((await blobs(s.root)).length, 0);
  catalog.reserve = reserve;
  const artifact = (await s.service.exportCsv(s.technician, input('ticket'))).data;
  catalog.access = async () => { throw new Error('audit-secret-canary'); };
  await assert.rejects(s.service.download(s.technician, { artifact_id: artifact.artifact_id }), error => error instanceof AppError && error.code === 'dependency_unavailable' && !error.message.includes('canary'));
});

const foundation = await readFile(new URL('../packages/storage/migrations/001_foundation.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../packages/storage/migrations/005_artifacts.sql', import.meta.url), 'utf8');
function reservation(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord { const now = Date.now(); return { id: randomUUID(), actorKey: 'tenant:employee', resourceId: 101, mappingVersion: 1, policyVersion: 'policy-v1', scopeHash: 'a'.repeat(64), ticketId: 1001, companyId: 10, kind: 'csv', collection: 'ticket', mime: 'text/csv', bytes: 100, sha256: 'b'.repeat(64), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 100_000).toISOString(), state: 'pending', source: 'fixture', complete: true, rows: 1, references: [{ entity: 'Tickets', id: 1001 }], ...overrides }; }
async function parity(catalog: ArtifactCatalog) {
  const quotas = { maxPerActor: 2, maxBytesPerActor: 500, maxBytesGlobal: 1000 }, records = Array.from({ length: 20 }, () => reservation());
  const results = await Promise.allSettled(records.map(row => catalog.reserve(row, quotas)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 2);
  const saved = records.filter((_row, index) => results[index]?.status === 'fulfilled');
  for (const row of saved) await catalog.publish(row.id, row.actorKey);
  assert.equal((await catalog.list('tenant:employee', Date.now())).length, 2);
  assert.equal(await catalog.get(saved[0]!.id, 'tenant:other'), undefined);
  await assert.rejects(catalog.access(saved[0]!.id, 'tenant:other'), code('not_found_or_inaccessible'));
  await catalog.access(saved[0]!.id, saved[0]!.actorKey);
  await catalog.remove(saved[0]!.id, saved[0]!.actorKey, 'deleted');
  assert.equal((await catalog.get(saved[0]!.id, saved[0]!.actorKey))?.state, 'deleted');
  await catalog.reserve(reservation(), quotas);
}
test('memory and PostgreSQL catalogs match owner boundaries and atomic concurrent quota reservation', async () => {
  await parity(new MemoryArtifactCatalog());
  const db = new PGlite();
  try {
    await db.exec(foundation); await db.exec(migration);
    await parity(new PostgresArtifactCatalog(db));
    const count = (await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM artifact_access_events')).rows[0]!.count;
    assert.ok(count >= 6);
    await db.exec(migration);
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM artifact_access_events')).rows[0]!.count, count);
    await assert.rejects(db.query("UPDATE artifact_access_events SET action='failed'"));
    await assert.rejects(db.query('DELETE FROM artifact_access_events'));
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM artifact_catalog')).rows[0]!.count, 3);
  } finally { await db.close(); }
});

test('005 migration rolls back interrupted installation and PostgreSQL artifacts survive a new service instance', async () => {
  const db = new PGlite();
  try {
    await db.exec(foundation);
    await assert.rejects(db.exec(migration.replace('COMMIT;', 'SELECT 1/0;\nCOMMIT;'))); await db.exec('ROLLBACK;');
    assert.equal((await db.query("SELECT table_name FROM information_schema.tables WHERE table_name='artifact_catalog'")).rows.length, 0);
    await db.exec(migration);
    const s = await setup({ catalog: new PostgresArtifactCatalog(db) }), artifact = (await s.service.exportCsv(s.technician, input('ticket'))).data;
    const restarted = new ArtifactService(s.core, { projectRoot: s.root, encryptionKey: s.encryptionKey, catalog: new PostgresArtifactCatalog(db) });
    assert.equal((await restarted.list(s.technician)).data.artifacts[0]?.artifact_id, artifact.artifact_id);
    assert.match((await restarted.download(s.technician, { artifact_id: artifact.artifact_id })).bytes.toString(), /ticketNumber/);
    const rows = await db.query<{ actor_key: string; action: string }>('SELECT actor_key,action FROM artifact_access_events');
    assert.ok(rows.rows.every(row => row.actor_key === actorKey(s.technician))); assert.ok(rows.rows.some(row => row.action === 'downloaded'));
  } finally { await db.close(); }
});



test('legacy staged ciphertext remains downloadable and uploadable without re-staging or scan claims',async()=>{
 const s=await setup(),staged=await s.service.stageUpload(s.technician,upload());
 const record=await s.catalog.get(staged.data.artifact_id,actorKey(s.technician));assert(record);
 const legacy={...record,filename:undefined,scannerVersion:'legacy-engine-v1'};
 // Reproduce the historical ATF1 format independently of today's file writer.
 const aad=Buffer.from(JSON.stringify([legacy.id,legacy.actorKey,legacy.resourceId,legacy.mappingVersion,legacy.policyVersion,legacy.scopeHash,legacy.ticketId,legacy.companyId,legacy.mime,legacy.bytes,legacy.sha256,legacy.createdAt,legacy.expiresAt,legacy.references,legacy.kind,legacy.collection,legacy.source,legacy.complete,legacy.rows,legacy.scannerVersion,legacy.fetchedAt]));
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',s.encryptionKey,nonce);cipher.setAAD(aad);
 const encrypted=Buffer.concat([cipher.update(Buffer.from(upload().content_base64,'base64')),cipher.final()]);
 await writeFile((await blobs(s.root))[0]!,Buffer.concat([Buffer.from('ATF1'),nonce,cipher.getAuthTag(),encrypted]));
 const catalog=new MemoryArtifactCatalog();await catalog.reserve({...legacy,state:'pending'},{maxPerActor:20,maxBytesPerActor:40000000,maxBytesGlobal:160000000});await catalog.publish(legacy.id,legacy.actorKey);
 const restarted=new ArtifactService(s.core,{projectRoot:s.root,encryptionKey:s.encryptionKey,catalog});
 const download=await restarted.download(s.technician,{artifact_id:legacy.id});assert.equal(download.bytes.toString(),'Fictitious plain attachment.');assert.equal('scanner_version' in download.metadata,false);assert(!/scanner_version|legacy-engine-v1/i.test(JSON.stringify(download.metadata)));
 const port=new FixtureTicketAttachmentPort(s.store,[]),attachments=new TicketAttachmentService(s.core,port,restarted,new IntentCipher(Buffer.alloc(32,8)),{publishInternal:1,byteBudget:new FixtureUnlimitedAttachmentByteBudget()});
 const input={ticket:{kind:'id',id:1001},artifact_id:legacy.id,title:'legacy.txt',request_key:'legacy-staged-upload'};
 const saved=await attachments.upload(s.technician,input);assert.equal(saved.status,'succeeded_verified');assert.equal((await attachments.upload(s.technician,input)).operation_id,saved.operation_id);assert.equal(port.calls.filter(c=>c.method==='create').length,1);
});

test('staging deadline still bounds storage work without external dependencies',async()=>{
 const catalog=new MemoryArtifactCatalog();catalog.reserve=async()=>new Promise(()=>{});
 const s=await setup({catalog,limits:{deadlineMs:10}});await assert.rejects(s.service.stageUpload(s.technician,upload()),code('dependency_unavailable'));assert.equal((await blobs(s.root)).length,0);
});

 test('uploads preserve arbitrary file formats, original names and exact bytes', async () => {
 const s=await setup();
 for(const [filename,mime] of [['résumé.csv','text/csv'],['report.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['archive.zip','application/zip'],['data.custom','application/octet-stream']]){
  const bytes=Buffer.from([239,187,191,61,65,49,44,0,255,13,10]);
  const staged=await s.service.stageUpload(s.technician,{ticket:{kind:'id',id:1001},filename,content_base64:bytes.toString('base64')});
  const got=await s.service.download(s.technician,{artifact_id:staged.data.artifact_id});
  assert.equal(got.metadata.filename,filename);assert.equal(got.metadata.mime,mime);assert.deepEqual(got.bytes,bytes);
  assert(got.headers['Content-Disposition'].includes(encodeURIComponent(filename!)));
 }
});
test('changing an authenticated original filename fails integrity validation',async()=>{
 const s=await setup(),staged=await s.service.stageUpload(s.technician,upload());
 const get=s.catalog.get.bind(s.catalog);s.catalog.get=async(...args)=>{const record=await get(...args);return record?{...record,filename:'changed.csv'}:record;};
 await assert.rejects(s.service.download(s.technician,{artifact_id:staged.data.artifact_id}),code('dependency_unavailable'));
});
