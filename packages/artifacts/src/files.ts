import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AppError } from '../../contracts/src/index.js';
import type { ArtifactRecord } from './contracts.js';

const unavailable = () => new AppError('dependency_unavailable', 'Encrypted artifact storage is unavailable or failed integrity validation.');
const missing = (error: unknown) => (error as { code?: string })?.code === 'ENOENT';
const magic = Buffer.from('ATF1');
// Keep the legacy scannerVersion slot unchanged: existing ATF1 blobs authenticate it.
const aad = (record: ArtifactRecord) => Buffer.from(JSON.stringify([record.id, record.actorKey, record.resourceId, record.mappingVersion, record.policyVersion, record.scopeHash, record.ticketId, record.companyId, record.mime, record.bytes, record.sha256, record.createdAt, record.expiresAt, record.references, record.kind, record.collection, record.source, record.complete, record.rows, record.scannerVersion, record.fetchedAt, ...(record.opportunityId!==undefined?['Opportunities',record.opportunityId]:[]), ...(record.filename!==undefined?['filename',record.filename]:[])]));

/** Every path is derived from server configuration plus hashes/UUIDs. User file
 * names, Autotask URLs and tool-supplied filesystem paths are never used here. */
export class EncryptedArtifactFiles {
  private readonly key: Buffer;
  private readonly directory: string;
  constructor(private readonly projectRoot: string, key: Buffer) {
    if (!isAbsolute(projectRoot) || !Buffer.isBuffer(key) || key.length !== 32) throw new AppError('invalid_input', 'Artifact storage requires an absolute project root and a 32-byte encryption key.');
    this.directory = resolve(projectRoot, 'work', 'artifacts'); this.key = Buffer.from(key);
  }
  private async folder(actor: string) {
    try {
      const project = await realpath(this.projectRoot);
      let current = project;
      for (const component of ['work', 'artifacts', createHash('sha256').update(actor).digest('hex')]) {
        current = join(current, component);
        try { const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable(); }
        catch (error) { if (!missing(error)) throw error; try { await mkdir(current, { mode: 0o700 }); } catch (createError) { if ((createError as { code?: string })?.code !== 'EEXIST') throw createError; } }
        const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable();
        const actual = await realpath(current), rel = relative(project, actual);
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw unavailable();
      }
      return current;
    } catch { throw unavailable(); }
  }
  private async path(record: ArtifactRecord) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.id)) throw unavailable();
    return join(await this.folder(record.actorKey), `${record.id}.blob`);
  }
  async put(record: ArtifactRecord, bytes: Buffer, signal: AbortSignal) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(aad(record));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    try { await writeFile(await this.path(record), Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted]), { flag: 'wx', mode: 0o600, signal }); }
    catch { throw unavailable(); }
  }
  async get(record: ArtifactRecord) {
    try {
      const filename = await this.path(record), info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes + 32) throw unavailable();
      const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let stored: Buffer;
      try { const actual = await file.stat(); if (!actual.isFile() || actual.size !== record.bytes + 32) throw unavailable(); stored = await file.readFile(); }
      finally { await file.close(); }
      if (!stored.subarray(0, 4).equals(magic)) throw unavailable();
      const decipher = createDecipheriv('aes-256-gcm', this.key, stored.subarray(4, 16)); decipher.setAAD(aad(record)); decipher.setAuthTag(stored.subarray(16, 32));
      const bytes = Buffer.concat([decipher.update(stored.subarray(32)), decipher.final()]);
      if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw unavailable();
      return bytes;
    } catch { throw unavailable(); }
  }
  async remove(record: ArtifactRecord) {
    try { const filename = await this.path(record), info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw unavailable(); await unlink(filename); }
    catch (error) { if (!missing(error)) throw unavailable(); }
  }
  /** Diagnostic server configuration only; never include this path in tool output. */
  storageDirectory(): string { return this.directory; }
}
