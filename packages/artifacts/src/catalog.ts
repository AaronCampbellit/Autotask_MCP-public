import { AppError } from '../../contracts/src/index.js';
import type { SqlClient } from '../../storage/src/index.js';
import { artifactRecordSchema, type ArtifactAction, type ArtifactCatalog, type ArtifactEvent, type ArtifactQuotas, type ArtifactRecord } from './contracts.js';

const missing = () => new AppError('not_found_or_inaccessible', 'Artifact not found or inaccessible.');
const unavailable = () => new AppError('dependency_unavailable', 'The artifact catalog is unavailable.');
function validate(record: ArtifactRecord, quotas: ArtifactQuotas) {
  artifactRecordSchema.parse(record);
  if (record.state !== 'pending' || Date.parse(record.expiresAt) <= Date.parse(record.createdAt) || !Number.isInteger(quotas.maxPerActor) || quotas.maxPerActor < 1 || quotas.maxPerActor > 100 || ![quotas.maxBytesPerActor, quotas.maxBytesGlobal].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000_000)) throw new AppError('invalid_input', 'Invalid artifact reservation or storage quotas.');
}

export class MemoryArtifactCatalog implements ArtifactCatalog {
  private readonly records = new Map<string, ArtifactRecord>();
  readonly events: ArtifactEvent[] = [];
  private event(record: ArtifactRecord, action: ArtifactAction) { this.events.push({ artifactId: record.id, actorKey: record.actorKey, action, at: new Date().toISOString() }); }
  async reserve(record: ArtifactRecord, quotas: ArtifactQuotas) {
    validate(record, quotas);
    if (this.records.has(record.id)) throw new AppError('conflict', 'The artifact identifier is already reserved.');
    const active = [...this.records.values()].filter(row => row.state !== 'deleted'), own = active.filter(row => row.actorKey === record.actorKey);
    if (own.length >= quotas.maxPerActor || own.reduce((sum, row) => sum + row.bytes, 0) + record.bytes > quotas.maxBytesPerActor || active.reduce((sum, row) => sum + row.bytes, 0) + record.bytes > quotas.maxBytesGlobal) throw new AppError('throttled', 'Artifact storage quota reached. Remove expired or unneeded exports.');
    this.records.set(record.id, structuredClone(record)); this.event(record, 'reserved');
  }
  async publish(id: string, actor: string) { const record = this.records.get(id); if (!record || record.actorKey !== actor || record.state !== 'pending') throw missing(); record.state = 'ready'; this.event(record, 'ready'); }
  async get(id: string, actor: string) { const record = this.records.get(id); return record?.actorKey === actor ? structuredClone(record) : undefined; }
  async list(actor: string, now: number) { return [...this.records.values()].filter(row => row.actorKey === actor && row.state === 'ready' && Date.parse(row.expiresAt) > now).slice(0, 100).map(row => structuredClone(row)); }
  async access(id: string, actor: string) { const record = this.records.get(id); if (!record || record.actorKey !== actor || record.state !== 'ready') throw missing(); this.event(record, 'downloaded'); }
  async remove(id: string, actor: string, reason: 'deleted' | 'expired' | 'failed') { const record = this.records.get(id); if (!record || record.actorKey !== actor || record.state === 'deleted') throw missing(); record.state = 'deleted'; this.event(record, reason); }
  async expired(now: number, limit: number) { return [...this.records.values()].filter(row => row.state !== 'deleted' && Date.parse(row.expiresAt) <= now).slice(0, limit).map(row => structuredClone(row)); }
}

/** SQL functions own quota locking and audit/state atomics across service instances. */
export class PostgresArtifactCatalog implements ArtifactCatalog {
  constructor(private readonly sql: SqlClient) {}
  private async query(query: string, values: unknown[]) {
    try { return await this.sql.query(query, values); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('ARTIFACT_QUOTA')) throw new AppError('throttled', 'Artifact storage quota reached. Remove expired or unneeded exports.');
      if ((error as { code?: string })?.code === '23505') throw new AppError('conflict', 'The artifact identifier is already reserved.');
      throw unavailable();
    }
  }
  async reserve(record: ArtifactRecord, quotas: ArtifactQuotas) { validate(record, quotas); await this.query('SELECT artifact_reserve($1::jsonb,$2::integer,$3::bigint,$4::bigint)', [JSON.stringify(record), quotas.maxPerActor, quotas.maxBytesPerActor, quotas.maxBytesGlobal]); }
  async publish(id: string, actor: string) { const result = await this.query("SELECT artifact_transition($1::uuid,$2,'ready') AS changed", [id, actor]); if (!(result.rows[0] as { changed?: boolean })?.changed) throw missing(); }
  async get(id: string, actor: string) { const result = await this.query('SELECT record FROM artifact_catalog WHERE id=$1::uuid AND actor_key=$2', [id, actor]); const row = result.rows[0] as { record?: unknown } | undefined; return row ? artifactRecordSchema.parse(row.record) : undefined; }
  async list(actor: string, now: number) { const result = await this.query("SELECT record FROM artifact_catalog WHERE actor_key=$1 AND state='ready' AND expires_at>$2::timestamptz ORDER BY created_at DESC,id LIMIT 100", [actor, new Date(now).toISOString()]); return result.rows.map(row => artifactRecordSchema.parse((row as { record: unknown }).record)); }
  async access(id: string, actor: string) { const result = await this.query("SELECT artifact_transition($1::uuid,$2,'downloaded') AS changed", [id, actor]); if (!(result.rows[0] as { changed?: boolean })?.changed) throw missing(); }
  async remove(id: string, actor: string, reason: 'deleted' | 'expired' | 'failed') { const result = await this.query('SELECT artifact_transition($1::uuid,$2,$3) AS changed', [id, actor, reason]); if (!(result.rows[0] as { changed?: boolean })?.changed) throw missing(); }
  async expired(now: number, limit: number) { const result = await this.query("SELECT record FROM artifact_catalog WHERE state<>'deleted' AND expires_at<=$1::timestamptz ORDER BY expires_at,id LIMIT $2", [new Date(now).toISOString(), Math.max(1, Math.min(100, limit))]); return result.rows.map(row => artifactRecordSchema.parse((row as { record: unknown }).record)); }
}
