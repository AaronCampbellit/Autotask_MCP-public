import { z } from 'zod';
import { timeEligibilitySchema, type MetadataContent, type MetadataBinding, type ResourceVerification, type TimeEligibilityEvidence } from './contracts.js';
import { metadataError } from './index.js';

export const MAX_OPERATIONAL_EVIDENCE_AGE_MS=300_000;
export function assertEvidenceWindow(capturedAt:string,expiresAt:string,now:number,requireFresh=true):void {
  const captured=Date.parse(capturedAt),expires=Date.parse(expiresAt);
  if(!Number.isFinite(captured)||!Number.isFinite(expires)||captured>now||expires<=captured||expires-captured>MAX_OPERATIONAL_EVIDENCE_AGE_MS||(requireFresh&&expires<=now))throw metadataError();
}
export function reviewedTimeEligibility(binding:MetadataBinding,content:MetadataContent,now:number):TimeEligibilityEvidence {
  const parsed=timeEligibilitySchema.safeParse(binding.value);if(!parsed.success)throw metadataError();const evidence=parsed.data;
  assertEvidenceWindow(evidence.checkedAt,evidence.validUntil,now);
  if(evidence.workDate!==binding.workDate||!binding.ticketId||Date.parse(evidence.validUntil)>Date.parse(binding.validUntil)
    ||evidence.period.startsOn>evidence.workDate||evidence.period.endsOn<evidence.workDate
    ||new Set(evidence.assignments.map(a=>`${a.roleId}:${a.workTypeId}`)).size!==evidence.assignments.length)throw metadataError();
  if(!binding.sourceIds.some(id=>content.sources.some(source=>source.id===id&&source.capturedAt===evidence.checkedAt&&(content.source==='fixture'||source.kind==='operational-capture'))))throw metadataError();
  return evidence;
}
export function validateResourceEvidence(evidence:ResourceVerification,content:MetadataContent,now:number,requireFresh=false):void {
  assertEvidenceWindow(evidence.verifiedAt,evidence.expiresAt,now,requireFresh);
  if(evidence.tenantId!==content.tenantId||Date.parse(evidence.expiresAt)>Date.parse(content.expiresAt)
    ||!content.entities.some(entity=>entity.entity==='Resources'&&['id','isActive'].every(name=>entity.fields.some(field=>field.name===name)))
    ||!evidence.sourceIds.some(id=>content.sources.some(source=>source.id===id&&source.capturedAt===evidence.verifiedAt&&(content.source==='fixture'||source.kind==='operational-capture'))))throw metadataError();
}
/** Contents are validated in memory only. No body text is part of the metadata evidence or its lookup key. */
export const eligibilityPayloadSchema=z.object({
  resourceID:z.number().int().positive().safe(),roleID:z.number().int().positive().safe(),billingCodeID:z.number().int().positive().safe(),
  hoursWorked:z.number().finite().positive().max(24),dateWorked:z.string().regex(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/),
  summaryNotes:z.string().trim().min(1).max(32000),internalNotes:z.string().max(32000).optional(),
}).strict();
