import {AppError} from '../../contracts/src/index.js';
import {plain} from './projection.js';
import type {Row} from './store.js';
export type SupplementTool='itg_related_items_get'|'itg_expiration_search'|'itg_reference_search';
export type ScopedRead=(path:string,query?:Row)=>Promise<Row>;
const validId=(value:unknown)=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value);
const denied=()=>new AppError('not_found_or_inaccessible','Related IT Glue evidence is outside the verified organization or malformed.');
function row(value:Row,type:string,organization?:string){if(!value||!validId(value.id)||value.type!==type||!value.attributes||typeof value.attributes!=='object'||Array.isArray(value.attributes))throw denied();if(organization!==undefined&&String(value.attributes['organization-id'])!==organization)throw denied();return value;}
function project(value:Row,keys:string[]){return{id:value.id,type:value.type,attributes:Object.fromEntries(keys.filter(k=>Object.hasOwn(value.attributes,k)).map(k=>[k,typeof value.attributes[k]==='string'?plain(value.attributes[k]).slice(0,2000):typeof value.attributes[k]==='boolean'?value.attributes[k]:null]))};}
function pageData(raw:Row,type:string,organization:string|undefined,size:number){if(!Array.isArray(raw.data)||raw.data.length>size||!Number.isInteger(raw.meta?.['total-pages'])||raw.meta['total-pages']<0)throw new AppError('dependency_unavailable','IT Glue page shape or completeness metadata is invalid.');return raw.data.map((v:Row)=>row(v,type,organization));}
/** Caller supplies an authorization-rechecking GET callback and revalidates the organization after return. */
export async function readSupplement(name:SupplementTool,args:Row,organizationId:string,page:number,call:ScopedRead):Promise<{data:unknown;raw:Row;limitations:string[];complete:boolean}>{
 if(!validId(organizationId)||!Number.isInteger(page)||page<1||page>1000||!Number.isInteger(args.page_size)||args.page_size<1||args.page_size>100)throw new AppError('invalid_input','Invalid bounded IT Glue read.');
 const query={'page[number]':page,'page[size]':args.page_size};
 if(name==='itg_expiration_search'){
  const raw=await call(`/organizations/${organizationId}/relationships/expirations`,query),rows=pageData(raw,'expirations',organizationId,args.page_size);
  return{data:rows.map(v=>project(v,['expiration-date','created-at','updated-at'])),raw,complete:page>=raw.meta['total-pages'],limitations:['Expiration metadata only. Resource names, descriptions, URLs and linked secret-bearing records are omitted.']};
 }
 if(name==='itg_reference_search'){
  if(!['configuration_types','configuration_statuses','contact_types'].includes(args.reference_type))throw new AppError('invalid_input','Unsupported reference dictionary.');
  const raw=await call(`/${args.reference_type}`,query),rows=pageData(raw,args.reference_type.replaceAll('_','-'),undefined,args.page_size);
  return{data:rows.map(v=>project(v,['name','created-at','updated-at'])),raw,complete:page>=raw.meta['total-pages'],limitations:['Account-wide reference names only; no customer counts, records or access grants.']};
 }
 if(name!=='itg_related_items_get'||!['configurations','contacts','flexible_assets'].includes(args.resource_type)||!validId(args.resource_id)||page!==1)throw new AppError('invalid_input','Unsupported related evidence request.');
 const path=`/${args.resource_type}/${args.resource_id}`,raw=await call(path,{include:'related_items'}),source=row(raw.data,args.resource_type.replaceAll('_','-'),organizationId);
 if(source.id!==args.resource_id)throw denied();
 const relation=source.relationships?.['related-items']??source.relationships?.related_items;
 if(!relation||!Array.isArray(relation.data)||(relation.data.length>0&&!Array.isArray(raw.included)))throw new AppError('dependency_unavailable','IT Glue related-item linkage is unavailable.');
 const types:Record<string,string>={Configuration:'configurations',Contact:'contacts','Flexible Asset':'flexible_assets',Document:'documents'};
 const data:Row[]=[];
 // Included evidence has no qualified pagination contract. Bound reads and do not claim exhaustive coverage.
 for(const link of relation.data.slice(0,args.page_size)){
  if(!validId(link?.id)||!['related-items','related_items'].includes(link.type))throw denied();
  const matches=raw.included.filter((v:Row)=>v.id===link.id&&v.type===link.type);if(matches.length!==1)throw denied();
  const a=matches[0].attributes;if(!a||typeof a!=='object')throw denied();
  const destinationType=a['destination-type']??a.destination_type,destinationId=a['destination-id']??a.destination_id;
  if(typeof destinationType!=='string'||!Object.hasOwn(types,destinationType))continue; // Never read passwords or unknown resource families.
  if(!validId(String(destinationId)))throw denied();
  const targetPath=`/${types[destinationType]}/${destinationId}`,target=row((await call(targetPath)).data,types[destinationType]!.replaceAll('_','-'),organizationId);
  if(target.id!==String(destinationId))throw denied();
  // Native ID/type only: relationship notes and included bodies may contain secrets.
  data.push({relationship_id:link.id,id:target.id,type:target.type,organization_id:organizationId});
 }
 const final=row((await call(path)).data,args.resource_type.replaceAll('_','-'),organizationId);if(final.id!==source.id)throw denied();
 return{data,raw:{meta:{'total-pages':1}},complete:false,limitations:['Bounded verified same-organization links only. Secret/unsupported targets and relationship content are omitted. Included relationship pagination is unqualified; this is not an exhaustive related-item listing.']};
}
