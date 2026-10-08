import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {compactJsonSchema,publishedJsonSchema,publishedSchema} from '../apps/server/src/schema-publication.js';
import {operationCatalog} from '../apps/server/src/tool-runtime.js';
import {outputSchemaFor} from '../apps/server/src/output-contracts.js';
const isObject=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
test('every published output contract reconstructs exactly without changing original references or constraints',()=>{
 let total=0;
 for(const name of Object.keys(operationCatalog)){
  const original={type:'object',...z.toJSONSchema(outputSchemaFor(name),{io:'output'})} as Record<string,any>,compact=publishedJsonSchema(outputSchemaFor(name),'output') as Record<string,any>;
  const generated=new Set(Object.keys(compact.$defs??{}).filter(k=>!(k in (original.$defs??{}))));
  const expand=(value:any):any=>{
   if(Array.isArray(value))return value.map(expand);if(!isObject(value))return value;
   const key=typeof value.$ref==='string'?value.$ref.slice('#/$defs/'.length):'';
   if(Object.keys(value).length===1&&value.$ref?.startsWith('#/$defs/')&&generated.has(key))return expand(compact.$defs[key]);
   return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)]));
  };
  const restored=expand(compact);for(const key of generated)delete restored.$defs[key];if(!original.$defs)delete restored.$defs;
  assert.deepEqual(restored,original,name);total+=Buffer.byteLength(JSON.stringify(compact));
 }
 // Include the expanded RMM contracts; full wire discovery retains its independent 1.8 MB bound.
 assert(total<1350000,`Output metadata too large: ${total}`);
});
test('publication preserves validation, literals, scoped identifiers and definition name collisions',async()=>{
 const schema=z.object({value:z.string().min(3)}),wrapped=publishedSchema(schema);
 assert('issues' in await wrapped['~standard'].validate({value:'x'}));assert('value' in await wrapped['~standard'].validate({value:'valid'}));
 const scoped={$id:'https://example.test/schema',type:'object'};assert.equal(compactJsonSchema(scoped),scoped);
 const repeated={type:'string',description:'a'.repeat(150)},source={type:'object',properties:{a:repeated,b:repeated},default:{type:'string',description:'a'.repeat(150)},$defs:{c0:{type:'number'}}};
 const compact=compactJsonSchema(source) as any;assert.deepEqual(compact.default,source.default);assert.deepEqual(compact.$defs.c0,{type:'number'});assert.equal(compact.properties.a.$ref,'#/$defs/c1');
});
