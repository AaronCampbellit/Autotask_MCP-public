import { mimeSchema, filenameSchema } from './file-types.js';
import { z } from 'zod';
import type { Principal } from '../../contracts/src/index.js';
import { ticketReferenceSchema } from '../../workflows/src/index.js';

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const artifactIdSchema = z.object({ artifact_id: z.string().uuid() }).strict();
export const artifactListSchema = z.object({}).strict();
export const artifactExportSchema = z.object({ ticket: ticketReferenceSchema, collection: z.enum(['ticket', 'notes', 'own_time']) }).strict();
export const artifactChunkSchema = artifactIdSchema.extend({ offset: z.number().int().nonnegative(), length: z.number().int().min(1).max(262_144).default(262_144) }).strict();
export const chatFileSchema = z.object({ download_url: z.string().url().max(8192), file_id: z.string().min(1).max(1024), mime_type: z.string().max(100).optional(), file_name: z.string().max(200).optional() }).strict();
export const artifactStageSchema = z.object({ ticket: ticketReferenceSchema, filename: filenameSchema.optional(), mime: mimeSchema.optional(), content_base64: z.string().min(1).max(9_333_336).optional(), file: chatFileSchema.optional().describe('Actual platform-provided download_url and file_id object. A bare file ID or /mnt/data path is not a downloadable file reference. Never invent URLs or substitute another file format.') }).strict();
export const opportunityArtifactStageSchema = artifactStageSchema.omit({ticket:true}).extend({opportunity_id:positive}).strict();
export const artifactRecordSchema = z.object({
  id: z.string().uuid(), actorKey: z.string().min(1).max(513), resourceId: positive, mappingVersion: positive, policyVersion: z.string().min(1).max(256), scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  ticketId: positive.optional(), opportunityId:positive.optional(), companyId: z.number().int().nonnegative().safe(), kind: z.enum(['csv', 'staged_upload']), collection: z.enum(['ticket', 'notes', 'own_time', 'upload']),
  filename: filenameSchema.optional(), mime: mimeSchema, bytes: z.number().int().min(0).max(7_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), state: z.enum(['pending', 'ready', 'deleted']), source: z.enum(['fixture', 'Autotask', 'client_upload']),
  complete: z.boolean(), rows: z.number().int().min(0).max(1000), references: z.array(z.object({ entity: z.enum(['Tickets', 'TicketNotes', 'TimeEntries', 'Opportunities']), id: positive }).strict()).min(1).max(1001),
  // Legacy encrypted-record AAD only. Never set on new artifacts or expose as a scan claim.
  scannerVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/).optional(),
  fetchedAt: z.string().datetime().optional(),
}).strict().refine(v=>(v.ticketId!==undefined)!==(v.opportunityId!==undefined),'Exactly one artifact parent is required').refine(v=>v.opportunityId===undefined||(v.kind==='staged_upload'&&v.collection==='upload'&&v.source==='client_upload'&&v.references.length===1&&v.references[0]?.entity==='Opportunities'&&v.references[0]?.id===v.opportunityId),'Opportunity artifacts must be parent-bound uploads');
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type ArtifactAction = 'reserved' | 'ready' | 'downloaded' | 'deleted' | 'expired' | 'failed';
export interface ArtifactEvent { artifactId: string; actorKey: string; action: ArtifactAction; at: string }
export interface ArtifactQuotas { maxPerActor: number; maxBytesPerActor: number; maxBytesGlobal: number }
export interface ArtifactCatalog {
  reserve(record: ArtifactRecord, quotas: ArtifactQuotas): Promise<void>;
  publish(id: string, actorKey: string): Promise<void>;
  get(id: string, actorKey: string): Promise<ArtifactRecord | undefined>;
  list(actorKey: string, now: number): Promise<ArtifactRecord[]>;
  access(id: string, actorKey: string): Promise<void>;
  remove(id: string, actorKey: string, reason: 'deleted' | 'expired' | 'failed'): Promise<void>;
  expired(now: number, limit: number): Promise<ArtifactRecord[]>;
}
export interface ArtifactSummary {
  artifact_id: string; kind: ArtifactRecord['kind']; ticket_id?: number; opportunity_id?:number; filename: string; mime: string; bytes: number; sha256: string;
  created_at: string; expires_at: string; fetched_at: string | null; source: ArtifactRecord['source']; complete: boolean; rows: number; warnings: string[];
}
export type ArtifactAuditContext = Pick<Principal, 'tenantId' | 'objectId' | 'resourceId'>;
