import {effectMetadata} from './discovery.js';
import {publishedJsonSchema} from './schema-publication.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ToolSpec } from './tool-runtime.js';

// Change this for every published server release. It identifies the deployed
// code; it is not a command for clients to invalidate their metadata caches.
export const SERVER_RELEASE = '0.2.0-ticket-report.20260925.1';
export function toolAnnotations(tool: Pick<ToolSpec,'name'|'write'|'mixed'|'localEffect'|'destructive'|'idempotent'>) {
  const effect=effectMetadata(tool);return {readOnlyHint:effect.readOnly,destructiveHint:effect.destructive,idempotentHint:effect.idempotent,openWorldHint:false};
}
export function toolFileMetadata(name:string){return name==='at_file_stage'||name==='opportunity_file_stage'?{'openai/fileParams':['file']}:undefined;}
const metadataEntries=new WeakMap<ToolSpec,{values:unknown[];json:string;id:number}>();
const metadataDigests=new Map<string,string>();let metadataSequence=0;
export function toolMetadataDigest(tools: readonly ToolSpec[]): string {
  const entries=[...tools].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(tool=>{
    const values=[tool.name,tool.description,tool.schema,tool.outputSchema,tool.write,tool.mixed,tool.localEffect,tool.destructive,tool.idempotent];
    let cached=metadataEntries.get(tool);
    if(!cached||values.some((value,index)=>value!==cached!.values[index])){
      cached={values,id:++metadataSequence,json:JSON.stringify({name:tool.name,description:tool.description,inputSchema:publishedJsonSchema(tool.schema,'input'),outputSchema:publishedJsonSchema(tool.outputSchema,'output'),annotations:toolAnnotations(tool),_meta:toolFileMetadata(tool.name)})};metadataEntries.set(tool,cached);
    }
    return cached;
  });
  const key=entries.map(entry=>entry.id).join(','),cached=metadataDigests.get(key);if(cached)return cached;
  const hash=createHash('sha256');hash.update('[');entries.forEach((entry,index)=>{if(index)hash.update(',');hash.update(entry.json);});hash.update(']');const result=hash.digest('hex');
  if(metadataDigests.size>=128)metadataDigests.delete(metadataDigests.keys().next().value!);metadataDigests.set(key,result);return result;
}

export const ticketPresentationGuidance = 'When referencing a ticket, include its exact title alongside the ticket number and a clickable link when available. Every ticket row needs its title, including grouped Weekly Differential lists; a group heading does not replace individual titles. Reuse titles already retrieved in trusted conversation context. Never invent a missing title; disclose when it is unavailable.';

/** Full presentation policy remains in server instructions. */
export const ticketPresentationReminder = 'Every ticket row needs its title, number and available link, including grouped lists. Reuse verified titles; never invent missing titles. Follow the shared presentation policy.';
