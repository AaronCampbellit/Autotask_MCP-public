import {z} from 'zod';
import type {StandardSchemaWithJSON} from '@modelcontextprotocol/server';

type Schema=Record<string,unknown>;
const object=(v:unknown):v is Schema=>!!v&&typeof v==='object'&&!Array.isArray(v);
const maps=new Set(['properties','patternProperties','$defs','definitions','dependentSchemas']);
const arrays=new Set(['allOf','anyOf','oneOf','prefixItems']);
const singles=new Set(['items','additionalProperties','unevaluatedProperties','unevaluatedItems','contains','not','if','then','else','propertyNames','additionalItems','contentSchema']);
/** Visit schema positions only: property maps, examples and defaults are not schemas. */
function children(schema:Schema,visit:(v:Schema)=>Schema):Schema {
 return Object.fromEntries(Object.entries(schema).map(([key,value])=>[key,maps.has(key)&&object(value)?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,object(v)?visit(v):v])):arrays.has(key)&&Array.isArray(value)?value.map(v=>object(v)?visit(v):v):singles.has(key)&&object(value)?visit(value):value]));
}
/** Local references preserve the exact schema while avoiding repeated inline copies. */
export function compactJsonSchema(schema:Schema):Schema {
 // Moving schemas across scoped identifiers/anchors can change reference resolution.
 if(/"\$(?:id|anchor|dynamicAnchor|dynamicRef)"\s*:/.test(JSON.stringify(schema)))return schema;
 const counts=new Map<string,number>();
 const count=(node:Schema):Schema=>{const key=JSON.stringify(node);counts.set(key,(counts.get(key)??0)+1);children(node,count);return node;};count(schema);
 const definitions:Schema={},names=new Map<string,string>();const existing=object(schema.$defs)?schema.$defs:{};
 let next=0;
 const rewrite=(node:Schema,root=false):Schema=>{
  const key=JSON.stringify(node);
  if(!root&&(counts.get(key)??0)>1&&key.length>=45){
   let name=names.get(key);if(!name){do{name=`c${next++}`;}while(name in existing);names.set(key,name);definitions[name]=children(node,v=>rewrite(v));}
   return{$ref:`#/$defs/${name}`};
  }
  return children(node,v=>rewrite(v));
 };
 const result=rewrite(schema,true);return Object.keys(definitions).length?{...result,$defs:{...(object(result.$defs)?result.$defs:{}),...definitions}}:result;
}
const jsonCache=new WeakMap<z.ZodType,Partial<Record<'input'|'output',Schema>>>();
const wrapperCache=new WeakMap<z.ZodType,StandardSchemaWithJSON>();
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function publishedJsonSchema(schema:z.ZodType,io:'input'|'output'):Schema {
 const cached=jsonCache.get(schema)??{};if(cached[io])return cached[io]!;
 const result=freeze(compactJsonSchema({type:'object',...z.toJSONSchema(schema,{io})}));cached[io]=result;jsonCache.set(schema,cached);return result;
}
/** Keep Zod's original runtime validator; only the published representation changes. */
export function publishedSchema(schema:z.ZodType):StandardSchemaWithJSON {
 const existing=wrapperCache.get(schema);if(existing)return existing;
 const wrapped={'~standard':{...schema['~standard'],jsonSchema:{input:()=>publishedJsonSchema(schema,'input'),output:()=>publishedJsonSchema(schema,'output')}}};wrapperCache.set(schema,wrapped);return wrapped;
}
