import {fileEvidence} from '../../diagnostics/src/evidence.js';
import {sanitizeError} from '../../diagnostics/src/sanitize.js';
import { XLSX_MIME } from './xlsx.js';
import { resolveUploadInput } from './file-input.js';
import { assertArea } from '../../policy/src/areas.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, actorKey, positiveId, type DataRecord, type Principal } from '../../contracts/src/index.js';
import { assertCapability, assertCompanyScope, projectRecord, reauthorize } from '../../policy/src/index.js';
import { TicketWorkflows } from '../../workflows/src/index.js';
import { MemoryArtifactCatalog } from './catalog.js';
import { EncryptedArtifactFiles } from './files.js';
import { artifactChunkSchema, artifactExportSchema, artifactIdSchema, artifactListSchema, artifactStageSchema, opportunityArtifactStageSchema, type ArtifactCatalog, type ArtifactQuotas, type ArtifactRecord, type ArtifactSummary } from './contracts.js';
export * from './contracts.js';
export { MemoryArtifactCatalog, PostgresArtifactCatalog } from './catalog.js';

export interface ArtifactServiceOptions {
  projectRoot: string; encryptionKey: Buffer; catalog?: ArtifactCatalog; now?: () => number;
  resolveOpportunity?:(p:Principal,id:number)=>Promise<DataRecord>;
  identityMaxAgeMs?: number;
  limits?: Partial<ArtifactQuotas & { maxBytes: number; maxRows: number; ttlMs: number; deadlineMs: number }>;
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const missing = () => new AppError('not_found_or_inaccessible', 'Artifact not found or inaccessible.');
const unavailable = () => new AppError('dependency_unavailable', 'The artifact could not be completed within its verified scope and limits.');
const columns = {
  ticket: ['id', 'ticketNumber', 'title', 'description', 'companyID', 'status', 'priority', 'queueID', 'assignedResourceID', 'createDate', 'dueDateTime', 'resolution'],
  notes: ['id', 'ticketID', 'title', 'description', 'noteType', 'publish', 'creatorResourceID', 'createDateTime'],
  own_time: ['id', 'ticketID', 'resourceID', 'roleID', 'dateWorked', 'hoursWorked', 'summaryNotes', 'internalNotes'],
} as const;
const extensions: Record<ArtifactRecord['mime'], string> = { 'text/csv': 'csv', 'text/plain': 'txt', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', [XLSX_MIME]: 'xlsx' };
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  if (typeof value === 'string' && /^[\s\p{C}]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function uploadBytes(input: Required<Pick<z.infer<typeof artifactStageSchema>,'content_base64'|'filename'|'mime'>>, maxBytes: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.content_base64) || input.content_base64.length % 4 !== 0) throw new AppError('invalid_input', 'Supply canonical base64 file bytes.');
  const bytes = Buffer.from(input.content_base64, 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== input.content_base64) throw new AppError('invalid_input', 'The decoded file exceeds the configured limit or is not valid base64.');
  if (/[\x00-\x1f\x7f/\\:"<>|?*]/.test(input.filename) || /^[. ]|[. ]$/.test(input.filename) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(input.filename)) throw new AppError('invalid_input', 'Use a simple safe attachment filename.');
  return bytes;
}

export class ArtifactService {
  readonly catalog: ArtifactCatalog;
  private readonly files: EncryptedArtifactFiles;
  private readonly clock: () => number;
  private readonly limits: ArtifactQuotas & { maxBytes: number; maxRows: number; ttlMs: number; deadlineMs: number };
  constructor(private readonly core: TicketWorkflows, private readonly options: ArtifactServiceOptions) {
    this.files = new EncryptedArtifactFiles(options.projectRoot, options.encryptionKey); this.catalog = options.catalog ?? new MemoryArtifactCatalog(); this.clock = options.now ?? Date.now;
    this.limits = { maxBytes: 6_000_000, maxRows: 1000, ttlMs: 86_400_000, deadlineMs: 15_000, maxPerActor: 20, maxBytesPerActor: 40_000_000, maxBytesGlobal: 160_000_000, ...options.limits };
    const x = this.limits;
    if (!Object.values(x).every(value => Number.isSafeInteger(value) && value > 0) || x.maxBytes > 7_000_000 || x.maxRows > 1000 || x.ttlMs > 86_400_000 || x.deadlineMs > 60_000 || x.maxPerActor > 100 || x.maxBytesPerActor > 1_000_000_000 || x.maxBytesGlobal > 1_000_000_000) throw new AppError('invalid_input', 'Invalid artifact limits.');
  }
  private scope(p: Principal) { return sha(JSON.stringify([actorKey(p), p.resourceId, p.mappingVersion, p.policyVersion, [...p.companyIds].sort(), p.areaPermissions, [...p.capabilities].sort()])); }
  private async current(p: Principal) { const current = await reauthorize(p, this.core.principals, { resourceMaxAgeMs: this.options.identityMaxAgeMs ?? 300_000 }); assertCapability(current, 'operational.read'); return current; }
  private async bounded<T>(run: (signal: AbortSignal, check: () => void) => Promise<T>) {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (controller.signal.aborted) throw unavailable(); };
    try { return await Promise.race([run(controller.signal, check), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, this.limits.deadlineMs); })]); }
    catch (error) { if (error instanceof AppError || error instanceof z.ZodError) throw error; throw unavailable(); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  private summary(record: ArtifactRecord): ArtifactSummary {
    return { artifact_id: record.id, kind: record.kind, ...(record.opportunityId!==undefined?{opportunity_id:record.opportunityId}:{ticket_id:record.ticketId!}), filename: record.filename ?? `${record.collection}-${record.opportunityId!==undefined?'opportunity-':''}${record.opportunityId??record.ticketId}-${record.id.slice(0, 8)}.${extensions[record.mime] ?? 'bin'}`, mime: record.mime, bytes: record.bytes, sha256: record.sha256,
      created_at: record.createdAt, expires_at: record.expiresAt, fetched_at: record.fetchedAt ?? null, source: record.source, complete: record.complete, rows: record.rows,
      warnings: [...(!record.complete ? ['This bounded export is incomplete; it is not a complete report.'] : []), ...(record.kind === 'csv' ? ['CSV strings that could execute formulas are prefixed with an apostrophe. The source is not an atomic snapshot.'] : ['Original file bytes are staged locally only; no Autotask attachment was created. File contents have not been malware-scanned or interpreted.']), ...(record.source === 'fixture' ? ['Fictitious development data. No Autotask connection.'] : [])] };
  }
  private async authorize(p: Principal, record: ArtifactRecord, check: () => void) {
    p = await this.current(p); check();
    if (record.actorKey !== actorKey(p) || record.resourceId !== p.resourceId || record.mappingVersion !== p.mappingVersion || record.policyVersion !== p.policyVersion || record.scopeHash !== this.scope(p) || Date.parse(record.expiresAt) <= this.clock()) throw missing();
    assertArea(p, record.opportunityId!==undefined?'sales':'tickets', record.kind==='staged_upload');
    if(record.collection==='own_time') assertArea(p,'time');
    if (record.collection === 'own_time') assertCapability(p, 'time.self');
    if(record.opportunityId!==undefined){
      assertCapability(p,'finance.read');assertCapability(p,'sales.write');const parent=await this.opportunity(p,record.opportunityId);check();if(parent.companyID!==record.companyId||record.references.length!==1||record.references[0]?.entity!=='Opportunities'||record.references[0]?.id!==record.opportunityId)throw missing();await this.current(p);return;
    }
    if (record.kind === 'staged_upload') assertCapability(p, 'tickets.write');
    const parent = await this.core.resolveTicket(p, { kind: 'id', id: record.ticketId! }); check();
    if (parent.companyID !== record.companyId) throw missing();
    for (const ref of record.references) {
      if (ref.entity === 'Tickets') { if (ref.id !== record.ticketId) throw missing(); continue; }
      const row = ref.entity === 'TicketNotes' ? await this.core.adapter.getTicketNote(p, record.ticketId!, ref.id) : await this.core.adapter.getTicketTime(p, record.ticketId!, ref.id);
      check();
      if (row.id !== ref.id || row.ticketID !== record.ticketId || (ref.entity === 'TimeEntries' && row.resourceID !== p.resourceId)) throw missing();
    }
    await this.current(p); check();
  }
  private async store(p: Principal, ticket: DataRecord, content: Buffer, details: Pick<ArtifactRecord, 'kind' | 'collection' | 'mime' | 'complete' | 'rows' | 'references' | 'source' | 'fetchedAt' | 'filename'>, signal: AbortSignal, check: () => void, opportunity=false) {
    if(details.kind!=='staged_upload')return this.persist(p,ticket,content,details,signal,check,opportunity);
    await fileEvidence('staging',{started:true,bytes:content.length});
    try{const result=await this.persist(p,ticket,content,details,signal,check,opportunity);await fileEvidence('staging',{started:true,succeeded:true,artifact_id:result.artifact_id,bytes:content.length});return result;}catch(error){await fileEvidence('staging',{started:true,succeeded:false,error:sanitizeError(error)});throw error;}
  }
  private async persist(p: Principal, ticket: DataRecord, content: Buffer, details: Pick<ArtifactRecord, 'kind' | 'collection' | 'mime' | 'complete' | 'rows' | 'references' | 'source' | 'fetchedAt' | 'filename'>, signal: AbortSignal, check: () => void, opportunity=false) {
    check(); if (content.length > this.limits.maxBytes) throw new AppError('invalid_input', 'The export exceeds the configured artifact size limit.');
    const record: ArtifactRecord = { id: randomUUID(), actorKey: actorKey(p), resourceId: p.resourceId, mappingVersion: p.mappingVersion, policyVersion: p.policyVersion, scopeHash: this.scope(p), ...(opportunity?{opportunityId:ticket.id}:{ticketId:ticket.id}), companyId: ticket.companyID as number, bytes: content.length, sha256: sha(content), createdAt: new Date(this.clock()).toISOString(), expiresAt: new Date(this.clock() + this.limits.ttlMs).toISOString(), state: 'pending', ...details };
    await this.authorize(p, record, check);
    await this.catalog.reserve(record, this.limits);
    try { check(); await this.files.put(record, content, signal); check(); await this.catalog.publish(record.id, record.actorKey); check(); await this.authorize(p, record, check); return this.summary({ ...record, state: 'ready' }); }
    catch (error) { try { await this.files.remove(record); await this.catalog.remove(record.id, record.actorKey, 'failed'); } catch { /* Pending quota/expiry remains visible to the retention worker. */ } throw error; }
  }
  async exportCsv(principal: Principal, input: unknown) {
    const args = artifactExportSchema.parse(input);
    return this.bounded(async (signal, check) => {
      const p = await this.current(principal), ticket = await this.core.resolveTicket(p, args.ticket); check();
      let rows: DataRecord[] = [], complete = true, fetchedAt = new Date(this.clock()).toISOString();
      const entity = args.collection === 'ticket' ? 'Tickets' : args.collection === 'notes' ? 'TicketNotes' : 'TimeEntries';
      if (args.collection === 'ticket') rows = [projectRecord('Tickets', ticket, p)];
      else if (args.collection === 'notes') {
        const context = await this.core.context(p, { ticket: { kind: 'id', id: ticket.id }, purpose: 'custom', collections: ['notes'], max_pages: 10 }); check();
        fetchedAt = context.provenance.fetched_at;
        const notes = (context.data as { collections: { notes: { items: DataRecord[]; complete_within_scope: boolean } } }).collections.notes;
        if (!Array.isArray(notes.items) || typeof notes.complete_within_scope !== 'boolean') throw unavailable();
        rows = notes.items; complete = notes.complete_within_scope;
      } else {
        assertCapability(p, 'time.self'); let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const result = await this.core.timeSearch(p, { ticket: { kind: 'id', id: ticket.id }, resource: 'self', page_size: Math.min(100, this.limits.maxRows), ...(cursor ? { cursor } : {}) }); check();
          fetchedAt = result.provenance.fetched_at;
          const entries = (result.data as { entries: DataRecord[] }).entries; if (!Array.isArray(entries)) throw unavailable(); rows.push(...entries);
          cursor = result.completeness.next_cursor ?? undefined;
          if (!cursor) break; if (rows.length >= this.limits.maxRows) break;
        }
        complete = !cursor;
      }
      if (rows.some(row => !positiveId(row.id) || (args.collection !== 'ticket' && row.ticketID !== ticket.id) || (args.collection === 'own_time' && row.resourceID !== p.resourceId)) || new Set(rows.map(row => row.id)).size !== rows.length) throw unavailable();
      if (rows.length > this.limits.maxRows) { rows = rows.slice(0, this.limits.maxRows); complete = false; }
      const fields = [...columns[args.collection]], projected = rows.map(row => projectRecord(entity, row, p, fields));
      const content = Buffer.from([fields.map(csvCell).join(','), ...projected.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\r\n') + '\r\n', 'utf8');
      const references: ArtifactRecord['references'] = [{ entity: 'Tickets', id: ticket.id }, ...rows.filter(row => entity !== 'Tickets').map(row => ({ entity: entity as ArtifactRecord['references'][number]['entity'], id: row.id }))];
      const metadata = await this.store(p, ticket, content, { kind: 'csv', collection: args.collection, mime: 'text/csv', source: this.core.adapter.source, complete, rows: rows.length, references, fetchedAt }, signal, check);
      return { status: complete ? 'succeeded' : 'partial', data: metadata, preview: projected.slice(0, 5), warnings: metadata.warnings };
    });
  }
  private async opportunity(p:Principal,id:number){
    p=await this.current(p);assertArea(p,'sales');assertCapability(p,'finance.read');if(!this.options.resolveOpportunity)throw new AppError('unsupported_operation','Opportunity staging is not configured.');
    const row=await this.options.resolveOpportunity(p,id);if(row.id!==id)throw missing();assertCompanyScope(p,row.companyID);return row;
  }
  async stageOpportunityUpload(principal:Principal,input:unknown){
    const args=opportunityArtifactStageSchema.parse(input);
    return this.bounded(async(signal,check)=>{const p=await this.current(principal);assertCapability(p,'sales.write');assertArea(p,'sales',true);const parent=await this.opportunity(p,args.opportunity_id);check();const supplied=await resolveUploadInput(args,this.limits.maxBytes,signal),bytes=uploadBytes(supplied,this.limits.maxBytes);check();const metadata=await this.store(p,parent,bytes,{kind:'staged_upload',collection:'upload',mime:supplied.mime,filename:supplied.filename,source:'client_upload',complete:true,rows:0,references:[{entity:'Opportunities',id:parent.id}]},signal,check,true);return{status:'staged',data:metadata,warnings:metadata.warnings};});
  }
  async stageUpload(principal: Principal, input: unknown) {
    const args = artifactStageSchema.parse(input);
    return this.bounded(async (signal, check) => {
      const p = await this.current(principal); assertCapability(p, 'tickets.write'); assertArea(p,'tickets',true); const ticket = await this.core.resolveTicket(p, args.ticket); check();
      const supplied=await resolveUploadInput(args,this.limits.maxBytes,signal),bytes=uploadBytes(supplied,this.limits.maxBytes);check();
      const metadata = await this.store(p, ticket, bytes, { kind: 'staged_upload', collection: 'upload', mime: supplied.mime, filename: supplied.filename, source: 'client_upload', complete: true, rows: 0, references: [{ entity: 'Tickets', id: ticket.id }] }, signal, check);
      return { status: 'staged', data: metadata, warnings: metadata.warnings };
    });
  }
  async list(principal: Principal, input: unknown = {}) {
    artifactListSchema.parse(input);
    return this.bounded(async (_signal, check) => {
      const p = await this.current(principal), records = await this.catalog.list(actorKey(p), this.clock()), artifacts: ArtifactSummary[] = [];
      for (const record of records) {
        try { await this.authorize(p, record, check); artifacts.push(this.summary(record)); }
        catch (error) { if (!(error instanceof AppError) || !['not_found_or_inaccessible', 'forbidden', 'conflict'].includes(error.code)) throw error; }
      }
      await this.current(p); check();
      return { data: { artifacts }, complete: true };
    });
  }
  async download(principal: Principal, input: unknown) {
    const args = artifactIdSchema.parse(input);
    return this.bounded(async (_signal, check) => {
      const p = await this.current(principal), record = await this.catalog.get(args.artifact_id, actorKey(p));
      if (!record || record.state !== 'ready') throw missing();
      await this.authorize(p, record, check); const bytes = await this.files.get(record); check(); await this.catalog.access(record.id, record.actorKey); check(); await this.authorize(p, record, check);
      const metadata = this.summary(record);
      return { metadata, bytes, headers: { 'Content-Type': record.kind === 'csv' ? 'text/csv; charset=utf-8' : record.mime, 'Content-Disposition': `attachment; filename="${metadata.filename.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(metadata.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`, 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
    });
  }
  async downloadChunk(principal: Principal, input: unknown) {
    const args = artifactChunkSchema.parse(input), value = await this.download(principal, { artifact_id: args.artifact_id });
    if (args.offset > value.bytes.length) throw new AppError('invalid_input', 'The chunk offset is beyond this artifact.');
    const end = Math.min(value.bytes.length, args.offset + args.length);
    return { metadata: value.metadata, offset: args.offset, content_base64: value.bytes.subarray(args.offset, end).toString('base64'), next_offset: end < value.bytes.length ? end : null };
  }
  async remove(principal: Principal, input: unknown) {
    const args = artifactIdSchema.parse(input);
    return this.bounded(async (_signal, check) => { const p = await this.current(principal), record = await this.catalog.get(args.artifact_id, actorKey(p)); if (!record || record.state !== 'ready') throw missing(); await this.authorize(p, record, check); await this.files.remove(record); check(); await this.catalog.remove(record.id, record.actorKey, 'deleted'); return { artifact_id: record.id, deleted: true }; });
  }
  /** Server retention work only. This is not an employee-facing global listing. */
  async cleanupExpired() {
    return this.bounded(async (_signal, check) => { let removed = 0; const expired = await this.catalog.expired(this.clock(), 100); for (const record of expired) { check(); await this.files.remove(record); await this.catalog.remove(record.id, record.actorKey, 'expired'); removed++; } return { removed, may_have_more: expired.length === 100 }; });
  }
}
