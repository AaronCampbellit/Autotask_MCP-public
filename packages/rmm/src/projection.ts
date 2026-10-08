import specification from './openapi.json' with {type:'json'};
import {AppError} from '../../contracts/src/index.js';
import type {Row} from './store.js';
const spec=specification as any;
export const redact=(s:string)=>s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi,'$1 [redacted]').replace(/((?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
function clean(value:any,schema:any,depth=0):any {
 if(depth>15)return null;
 if(schema?.$ref)schema=spec.components.schemas[schema.$ref.split('/').at(-1)];
 if(!schema)return null;
 if(value===null)return null;
 // Datto device responses use epoch milliseconds even where OpenAPI declares date-time strings.
 // Normalize only this reviewed format; do not coerce IDs, usernames or other typed fields.
 if(schema.type==='string'&&schema.format==='date-time'&&typeof value==='number'){
  if(!Number.isSafeInteger(value)||value<0||!Number.isFinite(new Date(value).getTime()))throw new AppError('dependency_unavailable','RMM response timestamp is invalid.');
  return new Date(value).toISOString();
 }
 if(schema.oneOf){const combined=Object.assign({},...schema.oneOf.map((s:any)=>s.$ref?spec.components.schemas[s.$ref.split('/').at(-1)]?.properties:s.properties));return clean(value,{properties:combined},depth+1);}
 if(schema.type==='array'){if(!Array.isArray(value))throw new AppError('dependency_unavailable','RMM returned an invalid collection.');if(value.length>1000)throw new AppError('dependency_unavailable','RMM nested collection exceeds the allowed size.');return value.map(v=>clean(v,schema.items,depth+1));}
 if(schema.type==='object'&&schema.additionalProperties&&typeof schema.additionalProperties==='object'){if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('dependency_unavailable','RMM returned an invalid map.');return Object.fromEntries(Object.entries(value).filter(([k])=>!/(password|secret|token|credential)/i.test(k)).slice(0,1000).map(([k,v])=>[k,clean(v,schema.additionalProperties,depth+1)]));}
 if(schema.properties){if(typeof value!=='object'||Array.isArray(value))throw new AppError('dependency_unavailable','RMM returned an invalid record.');return Object.fromEntries(Object.entries(schema.properties).filter(([k])=>k in value&&!/(password|secret|token|credential|defaultVal|variables|proxySettings|responseActions)/i.test(k)).map(([k,s])=>{let v=clean(value[k],s,depth+1);if(/url$/i.test(k)&&typeof v==='string'){try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||!/(^|\.)(rmm\.datto\.com|centrastage\.net)$/.test(u.hostname))v=null;}catch{v=null;}}return[k,v];}));}
 if(schema.type==='string'&&typeof value!=='string'||schema.type==='boolean'&&typeof value!=='boolean'||['integer','number'].includes(schema.type)&&typeof value!=='number')throw new AppError('dependency_unavailable','RMM response field has an invalid type.');
 if(typeof value==='string')return redact(value.slice(0,16000))+(value.length>16000?' [truncated]':'');if(typeof value==='boolean'||typeof value==='number')return value;return null;
}
export function project(path:string,value:any){const operation=spec.paths[path]?.get;if(!operation)throw new AppError('unsupported_operation','RMM output contract is unavailable.');const schema=operation.responses['200']?.content?.['application/json']?.schema;return clean(value,schema);}
