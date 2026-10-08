import {z} from 'zod';
import {AppError} from '../../contracts/src/index.js';
export const scalarSchema=z.union([z.string().max(32000),z.number().finite(),z.boolean(),z.null()]);
export const udfSchema=z.array(z.object({name:z.string().min(1).max(128),value:scalarSchema}).strict()).max(100).refine(v=>new Set(v.map(x=>x.name)).size===v.length);
export const valueSchema=z.union([scalarSchema,udfSchema]);
export const fieldsSchema=z.record(z.string().min(1).max(128),valueSchema).refine(v=>Object.keys(v).length>0&&Object.keys(v).length<=100);
export type NativeValue=z.infer<typeof valueSchema>;
export type NativeFields=Record<string,NativeValue>;
export type NativeField={name:string;dataType?:string;type?:string;isReference?:boolean;isReadOnly?:boolean;isRequired?:boolean;length?:number;isPickList?:boolean;picklistParentValueField?:string;picklistValues?:Array<{value:string|number;label:string;isActive?:boolean;parentValue?:string|number}>|null};
const fail=(m:string)=>new AppError('invalid_input',m);
export function validateNativeField(field:NativeField|undefined,value:NativeValue,context:Record<string,unknown>={}):NativeValue {
 if(!field||['id','__proto__','constructor','prototype'].includes(field.name))throw fail('Unknown or immutable native field. Read the current field metadata.');
 if(field.isReadOnly!==false)throw fail(`${field.name} is read-only in current Autotask metadata.`);
 if(value===null){if(field.isRequired)throw fail(`${field.name} cannot be empty.`);return null;}
 if(Array.isArray(value))throw fail(`${field.name} requires a scalar value.`);
 if(field.isPickList){
  const parent=field.picklistParentValueField,choices=field.picklistValues;
  if(!Array.isArray(choices))throw new AppError('missing_metadata',`Picklist metadata is missing for ${field.name}.`);
  const matches=choices.filter(v=>v.isActive===true&&(String(v.value)===String(value)||typeof value==='string'&&v.label.trim().toLowerCase()===value.trim().toLowerCase())&&(!parent||context[parent]!==undefined&&String(v.parentValue)===String(context[parent])));
  if(matches.length!==1)throw fail(`Choose one active ${field.name} value compatible with its parent.`);
  const selected=matches[0]!.value;
  return ['integer','long','short','decimal','double'].includes(field.dataType??'')?Number(selected):selected;
 }
 const type=field.dataType?.toLowerCase();
 if(type==='string'){if(typeof value!=='string'||value.length>(field.length&&field.length>0?field.length:32000))throw fail(`Invalid ${field.name} text.`);}
 else if(type==='boolean'){if(typeof value!=='boolean')throw fail(`Invalid ${field.name} boolean.`);}
 else if(type==='datetime'||type==='date'){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)||!Number.isFinite(Date.parse(value)))throw fail(`Invalid ${field.name} date.`);}
 else if(['integer','long','short','decimal','double','number'].includes(type??'')){if(typeof value!=='number'||!Number.isFinite(value)||(['integer','long','short'].includes(type!)&&!Number.isSafeInteger(value)))throw fail(`Invalid ${field.name} number.`);}
 else throw new AppError('missing_metadata',`Unsupported native datatype for ${field.name}.`);
 return value;
}
export function validateUdfs(value:NativeValue,metadata:NativeField[]):NativeValue {
 const rows=udfSchema.parse(value);
 return rows.map(row=>{const field=metadata.find(f=>f.name===row.name);if(field?.isReference)throw fail('Reference UDFs are not supported by the Autotask REST API.');return {name:row.name,value:validateNativeField(field?{...field,dataType:field.dataType??field.type}:undefined,row.value) as z.infer<typeof scalarSchema>};});
}
export function fieldMatches(field:string,actual:unknown,expected:unknown):boolean {
 if(field==='userDefinedFields'&&Array.isArray(expected))return expected.every(e=>(actual===undefined||actual===null||Array.isArray(actual))&&(actual??[]).filter(a=>a.name===e.name).length<=1&&JSON.stringify((actual??[]).find(a=>a.name===e.name)?.value??null)===JSON.stringify(e.value));
 return JSON.stringify(actual??null)===JSON.stringify(expected);
}
export function nativeProjection(row:Record<string,any>,metadata:NativeField[]):NativeFields {
 return Object.fromEntries(metadata.filter(f=>Object.hasOwn(row,f.name)&&scalarSchema.safeParse(row[f.name]).success).map(f=>[f.name,row[f.name]]));
}
