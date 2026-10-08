import {documentImageSchema} from './media.js';
import {z} from 'zod';
import type {Capability} from '../../contracts/src/index.js';
export const id=z.string().regex(/^[1-9][0-9]{0,19}$/);
const scope={company:z.number().int().nonnegative(),organization_id:id.optional()};
const page={page_size:z.number().int().min(1).max(100).default(50),cursor:z.string().max(8192).optional()};
const filters=z.object({name:z.string().max(200).optional(),archived:z.boolean().optional()}).strict().default({});
const write={...scope,request_key:z.string().min(8).max(128)};
const text=z.string().max(60000);
const docFields=z.object({name:z.string().min(1).max(255).optional(),archived:z.boolean().optional()}).strict();
const section=z.object({resource_type:z.enum(['Document::Text','Document::Heading','Document::Step']),content:text,sort:z.number().int().nonnegative().optional(),level:z.number().int().min(1).max(6).optional()}).strict();
const configFields=z.object({name:z.string().min(1).max(255).optional(),notes:text.nullable().optional(),hostname:z.string().max(255).nullable().optional(),serial_number:z.string().max(255).nullable().optional(),asset_tag:z.string().max(255).nullable().optional(),archived:z.boolean().optional()}).strict();
const expected=z.record(z.string(),z.unknown());
export const schemas={
 itg_document_image_create:documentImageSchema,
 itg_related_items_get:z.object({...scope,page_size:z.number().int().min(1).max(25).default(10),resource_type:z.enum(['configurations','contacts','flexible_assets']),resource_id:id}).strict(),
 itg_expiration_search:z.object({...scope,...page}).strict(),
 itg_reference_search:z.object({...scope,...page,reference_type:z.enum(['configuration_types','configuration_statuses','contact_types'])}).strict(),
 itg_organization_search:z.object({...scope,...page,filters}).strict(),itg_organization_get:z.object({...scope,id}).strict(),
 itg_configuration_search:z.object({...scope,...page,filters}).strict(),itg_configuration_get:z.object({...scope,id}).strict(),
 itg_contact_search:z.object({...scope,...page,filters}).strict(),itg_contact_get:z.object({...scope,id}).strict(),
 itg_flexible_asset_search:z.object({...scope,...page,flexible_asset_type_id:id,filters}).strict(),itg_flexible_asset_get:z.object({...scope,id}).strict(),
 itg_flexible_asset_schema_get:z.object({...scope,flexible_asset_type_id:id,...page}).strict(),
 itg_document_search:z.object({...scope,...page,folder_id:id.optional(),all_folders:z.boolean().default(true)}).strict(),
 itg_document_get:z.object({...scope,document_id:id,...page}).strict(),
 itg_checklist_search:z.object({...scope,...page,filters}).strict(),itg_checklist_get:z.object({...scope,id}).strict(),
 itg_document_create:z.object({...write,name:z.string().min(1).max(255),sections:z.array(section).min(1).max(20)}).strict(),
 itg_document_update:z.object({...write,document_id:id,fields:docFields,expected}).strict(),
 itg_document_section_update:z.object({...write,document_id:id,section_id:id,fields:section.partial(),expected}).strict(),
 itg_document_publish:z.object({...write,document_id:id,expected}).strict(),
 itg_configuration_create:z.object({...write,name:z.string().min(1).max(255),configuration_type_id:id,fields:configFields}).strict(),
 itg_configuration_update:z.object({...write,id,fields:configFields,expected}).strict(),
 itg_flexible_asset_create:z.object({...write,flexible_asset_type_id:id,traits:z.record(z.string(),z.union([text,z.number(),z.boolean(),z.null()]))}).strict(),
 itg_flexible_asset_update:z.object({...write,id,traits:z.record(z.string(),z.union([text,z.number(),z.boolean(),z.null()])),expected}).strict(),
 itg_checklist_update:z.object({...write,id,fields:z.object({name:z.string().min(1).max(255)}).strict(),expected}).strict(),
 itg_operation_get:z.object({...scope,operation_id:z.string().uuid()}).strict(),
};
export type ItGlueTool=keyof typeof schemas;
export const isWrite=(name:string)=>/_(create|update|publish)$/.test(name);
export const itGlueOperations:Record<string,{write:boolean;capabilities:Capability[]}>=Object.fromEntries(Object.keys(schemas).map(n=>[n,{write:isWrite(n),capabilities:['documentation.read',...(isWrite(n)?['documentation.write']:[])] as Capability[]}]));
export const itGlueOutput=z.object({status:z.string(),data:z.unknown(),scope:z.object({company_id:z.number(),organization_id:z.string()}),applied_filters:z.record(z.string(),z.unknown()),completeness:z.object({complete:z.boolean(),next_cursor:z.string().nullable()}),provenance:z.object({source:z.literal('IT Glue'),fetched_at:z.string()}),limitations:z.array(z.string())}).strict();
