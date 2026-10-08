import {z} from 'zod';
import {AppError} from '../../contracts/src/index.js';
import {collectorConfigSchema} from '../../collector/src/index.js';
import {requestBudgetSettingsFromEnvironment} from '../../autotask/src/budget.js';
import {APPLICATION_READ_OPERATIONS} from '../../autotask/src/index.js';
import {METADATA_OPERATIONS} from '../../metadata/src/index.js';
const credential=z.string().min(1).max(4096).refine(v=>!!v.trim()&&!/[\r\n\0]/.test(v));
export const flags=['OPERATIONAL_WRITES_ENABLED','SALES_ENABLED','SALES_WRITES_ENABLED','BUSINESS_ENABLED','BUSINESS_WRITES_ENABLED','WORK_MANAGEMENT_ENABLED','WORK_MANAGEMENT_WRITES_ENABLED','ATTACHMENTS_ENABLED','ATTACHMENTS_WRITES_ENABLED'] as const;
export const settingNames=[...flags,'ENABLED_AUTOTASK_OPERATIONS','APPLICATION_SCOPED_READ_OPERATIONS','AUTOTASK_TICKET_HOSTS','AUTOTASK_REQUESTS_PER_WINDOW','AUTOTASK_BUDGET_WINDOW_MS','AUTOTASK_EXTERNAL_HEADROOM','AUTOTASK_THRESHOLD_MAX_AGE_MS','AUTOTASK_BUDGET_MAX_WAIT_MS','AUTOTASK_BUDGET_QUEUE_SIZE','WORKSPACE_TIMEZONE','RESOURCE_TIMEZONES','ATTACHMENT_INTERNAL_PUBLISH_LABEL'] as const;
export const configSchema=z.object({baseUrl:z.string().regex(/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/),username:credential,secret:credential,integrationCode:credential,webhookBindings:z.string().max(16000),settings:z.record(z.enum(settingNames),z.string().max(16000)),collector:collectorConfigSchema.optional()}).strict();
export type Config=z.infer<typeof configSchema>;
export interface Revision {id:string;config:Config;createdAt:string}
export interface State {version:number;active:Revision;previous?:Revision;draft?:Revision;test?:{id:string;revision:string;requestedAt:string};activationError?:boolean;refresh?:string}
export function fromEnvironment(env:NodeJS.ProcessEnv,collector?:unknown):Config{return configSchema.parse({baseUrl:env.AUTOTASK_BASE_URL,username:env.AUTOTASK_USERNAME,secret:env.AUTOTASK_SECRET,integrationCode:env.AUTOTASK_INTEGRATION_CODE,webhookBindings:env.AUTOTASK_WEBHOOK_BINDINGS??'',settings:Object.fromEntries(settingNames.map(k=>[k,env[k]??''])),...(collector?{collector}:{})});}
export function environment(base:NodeJS.ProcessEnv,c:Config):NodeJS.ProcessEnv{return {...base,...c.settings,AUTOTASK_BASE_URL:c.baseUrl,AUTOTASK_USERNAME:c.username,AUTOTASK_SECRET:c.secret,AUTOTASK_INTEGRATION_CODE:c.integrationCode,AUTOTASK_WEBHOOK_BINDINGS:c.webhookBindings};}
export function safe(c:Config){return {baseUrl:c.baseUrl,username:c.username,secretConfigured:!!c.secret,integrationCodeConfigured:!!c.integrationCode,webhookBindingsConfigured:!!c.webhookBindings,settings:c.settings,collector:c.collector};}
export function validate(c:Config,tenant:string){
 configSchema.parse(c);if(Buffer.byteLength(JSON.stringify(c))>24000)throw new AppError('invalid_input','Integration settings exceed the supported size.');const env=environment({},c),budget=requestBudgetSettingsFromEnvironment(env,tenant);
 for(const k of flags)if(c.settings[k]&&!['true','false'].includes(c.settings[k]!))throw new AppError('invalid_input','Feature switches must be true or false.');
 for(const pack of ['SALES','BUSINESS','WORK_MANAGEMENT','ATTACHMENTS'])if(env[`${pack}_WRITES_ENABLED`]==='true'&&env[`${pack}_ENABLED`]!=='true')throw new AppError('invalid_input','Writes require the corresponding feature.');
 for(const pack of ['WORK_MANAGEMENT','ATTACHMENTS'])if(env[`${pack}_ENABLED`]==='true'&&env.OPERATIONAL_WRITES_ENABLED!=='true')throw new AppError('invalid_input','These features require operational access.');
 for(const [key,allowed] of [['ENABLED_AUTOTASK_OPERATIONS',METADATA_OPERATIONS],['APPLICATION_SCOPED_READ_OPERATIONS',APPLICATION_READ_OPERATIONS]] as const){const list=(env[key]??'').split(',').map(v=>v.trim()).filter(Boolean);if(new Set(list).size!==list.length||list.some(v=>!(allowed as readonly string[]).includes(v)))throw new AppError('invalid_input','Choose supported operation identifiers without duplicates.');}
 if(c.webhookBindings){let bindings:unknown;try{bindings=JSON.parse(c.webhookBindings);}catch{throw new AppError('invalid_input','Webhook bindings must be valid JSON.');}if(!Array.isArray(bindings)||bindings.length>10||bindings.some(b=>!b||b.tenantId!==tenant))throw new AppError('invalid_input','Webhook bindings must belong to this tenant.');}
 const timezone=(v:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:v});}catch{throw new AppError('invalid_input','Choose a valid timezone.');}};
 if(env.WORKSPACE_TIMEZONE)timezone(env.WORKSPACE_TIMEZONE);
 if(env.RESOURCE_TIMEZONES){let obj:unknown;try{obj=JSON.parse(env.RESOURCE_TIMEZONES);}catch{throw new AppError('invalid_input','Resource timezones must be a JSON object.');}const parsed=z.record(z.string().regex(/^[1-9]\d*$/),z.string()).parse(obj);Object.values(parsed).forEach(timezone);}
 if(env.AUTOTASK_TICKET_HOSTS){const hosts=env.AUTOTASK_TICKET_HOSTS.split(',').map(v=>v.trim());if(hosts.length>20||new Set(hosts).size!==hosts.length||hosts.some(v=>!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(v)))throw new AppError('invalid_input','Ticket hosts must be unique hostnames without paths or schemes.');}
 // Server and collector headroom are independent admission thresholds, not equal budget partitions.
 if(c.collector&&(c.collector.tenantId!==tenant||c.collector.baseUrl!==c.baseUrl||budget&&c.collector.windowMs!==budget.windowMs))throw new AppError('invalid_input','Collector tenant, URL and budget window must match the server.');
}
