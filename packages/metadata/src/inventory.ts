import { createHash } from 'node:crypto';
import { AppError } from '../../contracts/src/index.js';
import type { EntityInventory } from './contracts.js';

/** Inventory is documentary coverage only. Implementation/enabled flags never become runtime authority. */
export function compileInventory(value:unknown):EntityInventory {
  if(!value||typeof value!=='object'||!Array.isArray((value as {entities?:unknown}).entities))throw new AppError('invalid_input','The checked-in entity inventory is invalid.');
  const entities=(value as {entities:unknown[]}).entities.map(raw=>{
    if(!raw||typeof raw!=='object')throw new AppError('invalid_input','The checked-in entity inventory is invalid.');
    const row=raw as Record<string,any>;
    if(typeof row.entity!=='string'||!/^[A-Za-z_][A-Za-z0-9_ ()-]{0,199}$/.test(row.entity))throw new AppError('invalid_input','The inventory entity name is invalid.');
    return{entity:row.entity,...(typeof row.documentation?.url==='string'?{documentationUrl:row.documentation.url}:{}),
      ...(typeof row.documentation?.documented_name==='string'?{documentedName:row.documentation.documented_name}:{}),
      ...(typeof row.parent==='string'?{parent:row.parent}:{}),documentaryOnly:true as const};
  }).sort((a,b)=>a.entity.localeCompare(b.entity));
  if(!entities.length||new Set(entities.map(row=>row.entity)).size!==entities.length)throw new AppError('invalid_input','The inventory must list each exact entity name once.');
  return{entities,digest:createHash('sha256').update(JSON.stringify(entities)).digest('hex')};
}
