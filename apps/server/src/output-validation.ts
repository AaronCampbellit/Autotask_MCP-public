import { z } from 'zod';
import { successSchemaFor } from './output-contracts.js';

/** A contract defect is not evidence that a business write failed. Preserve only
 * a validated recovery reference; never expose response bodies or parser details. */
export class OutputContractError extends Error {
  readonly operationId?: string;
  readonly observedStatus?: string;
  constructor(value:unknown) {
    super('The tool response did not match its output contract. Inspect the recorded operation before any retry; this error does not establish whether a write succeeded.');
    const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
    if(z.string().uuid().safeParse(v.operation_id).success)this.operationId=v.operation_id as string;
    if(typeof v.status==='string'&&['ready','dispatching','accepted_unverified','succeeded_verified','failed','partial','unknown_outcome','succeeded'].includes(v.status))this.observedStatus=v.status;
  }
}
export function validateOutput(name:string,value:unknown):Record<string,unknown> {
  // Validate the wire representation: PostgreSQL timestamps may be Date
  // instances and optional JS properties may be undefined. This is the same
  // JSON serialization previously performed by toolResult/the HTTP transport.
  let wire:unknown;try{wire=JSON.parse(JSON.stringify(value));}catch{throw new OutputContractError(value);}
  if(!successSchemaFor(name).safeParse(wire).success)throw new OutputContractError(value);
  // Never use parsed.data: schema stripping/defaults must not alter evidence.
  return wire as Record<string,unknown>;
}
