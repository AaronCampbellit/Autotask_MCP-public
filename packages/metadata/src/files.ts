import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { AppError } from '../../contracts/src/index.js';
import { safeSourceReference, validateSnapshot } from './index.js';
import type { EntityInventory, MetadataSnapshot } from './contracts.js';

export const MAX_SNAPSHOT_BYTES=16*1024*1024;
export async function loadMetadataSnapshot(path:string,options:{inventory?:EntityInventory;now?:number;requireFresh?:boolean}={}):Promise<MetadataSnapshot> {
  try {const info=await stat(path);if(!info.isFile()||info.size>MAX_SNAPSHOT_BYTES)throw new Error();
    return validateSnapshot(JSON.parse(await readFile(path,'utf8')),options);
  } catch(error) {if(error instanceof AppError)throw error;throw new AppError('missing_metadata','The local metadata snapshot could not be loaded.');}
}
/** Hashes captured local files only; never fetches remote references or returns their contents. Symlink escape is rejected. */
export async function verifyLocalSources(snapshot:MetadataSnapshot,workspaceRoot:string):Promise<Record<string,string>> {
  const verified:Record<string,string>={};
  try {
    const root=await realpath(workspaceRoot);
    for(const source of snapshot.content.sources) {
      if(source.reference.startsWith('fixture:')||source.reference.startsWith('https://'))continue;
      if(!safeSourceReference(source.reference,source.kind))throw new Error();
      const file=await realpath(resolve(root,source.reference)),within=relative(root,file);
      if(!within||within.startsWith('..')||isAbsolute(within))throw new Error();
      const info=await stat(file);if(!info.isFile()||info.size>MAX_SNAPSHOT_BYTES)throw new Error();
      const digest=createHash('sha256').update(await readFile(file)).digest('hex');
      if(digest!==source.sha256)throw new Error();verified[source.id]=digest;
    }
    return verified;
  } catch {throw new AppError('missing_metadata','A captured metadata evidence file is missing, changed, oversized or outside the workspace.');}
}
