import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../contracts/src/index.js';
import type {ControlActor} from '../../control-plane/src/index.js';
import {configSchema,safe,validate,type Config,type Revision,type State} from './model.js';
import type {Store} from './store.js';
import type {Handoff} from './handoff.js';
const versionSchema=z.object({version:z.number().int().nonnegative()}).strict();
export class AutotaskConfiguration {
 private busy=false;
 constructor(readonly store:Store,readonly tenant:string,readonly loaded:Revision,private options:{authorize:(actor:ControlActor)=>Promise<void>;handoff?:Handoff;validateRuntime?:(c:Config)=>Promise<void>;now?:()=>number;reloadAvailable?:boolean;recoveryMode?:boolean}){}
 private now(){return this.options.now?.()??Date.now();}
 private async auth(a:ControlActor){if(a.tenantId!==this.tenant)throw new AppError('forbidden','Wrong integration tenant.');await this.options.authorize(a);}
 async access(a:ControlActor){await this.auth(a);}
 private async record(){const s=await this.store.load(this.tenant);if(!s)throw new AppError('precondition_failed','Adopt the current connection first.');return s;}
 private check(s:State,v:number){if(s.version!==v)throw new AppError('conflict','Autotask settings changed. Refresh before continuing.');}
 private async publish(s:State){if(this.options.handoff)await this.options.handoff.publish({tenant:this.tenant,active:s.active,...(s.refresh?{refresh:s.refresh}:{}),...(s.test&&s.draft&&s.test.revision===s.draft.id?{test:{id:s.test.id,revision:s.draft,requestedAt:s.test.requestedAt}}:{})});}
 private async save(a:ControlActor,s:State,action:string){await this.auth(a);const expected=s.version;s.version++;await this.store.save(this.tenant,`${a.tenantId}:${a.objectId}`,s,expected,action);if(action!=='connection.activation_requested')await this.publish(s);}
 private async exclusive<T>(fn:()=>Promise<T>){if(this.busy)throw new AppError('conflict','Another configuration action is in progress.');this.busy=true;try{return await fn();}finally{this.busy=false;}}
 async status(a:ControlActor){await this.auth(a);const s=await this.store.load(this.tenant);const result=await this.options.handoff?.result(),applied=await this.options.handoff?.applied(),events=await this.store.events(this.tenant);await this.auth(a);return {recoveryMode:!!this.options.recoveryMode,managed:!!s,version:s?.version??0,active:{id:s?.active.id??this.loaded.id,...safe(s?.active.config??this.loaded.config)},draft:s?.draft?{id:s.draft.id,...safe(s.draft.config)}:null,loadedRevision:this.loaded.id,reloadPending:!!s&&s.active.id!==this.loaded.id,activationFailed:!!s?.activationError,canRollback:!!s?.previous,collectorConfigured:!!this.options.handoff&&!!this.loaded.config.collector,canActivate:!!this.options.reloadAvailable,collector:applied??null,collectorFresh:!!applied&&Date.parse(applied.at)<=this.now()&&this.now()-Date.parse(applied.at)<240000,test:s?.test?{requestedAt:s.test.requestedAt,...(result&&result.id===s.test.id&&result.revision===s.draft?.id?{ok:result.ok,at:result.at}:{pending:true})}:null,events};}
 async action(a:ControlActor,action:string,input:unknown){return this.exclusive(async()=>{
 await this.auth(a);
 if(action==='save'){
 const args=z.object({version:z.number().int().positive(),config:configSchema.partial().omit({settings:true}).extend({settings:configSchema.shape.settings.optional()})}).strict().parse(input);
 const s=await this.record();this.check(s,args.version);this.assertSettled(s);
 const source=s.draft?.config??s.active.config;const config=configSchema.parse({...source,...args.config,settings:{...source.settings,...args.config.settings}});
 // Native IDs remain valid only inside the existing API account. This release
 // deliberately permits credential rotation, not switching accounts or zones.
 if(config.username!==s.active.config.username||config.baseUrl!==s.active.config.baseUrl)throw new AppError('invalid_input','Changing the API username or zone requires a separately reviewed account migration.');
 if(config.settings.AUTOTASK_BUDGET_WINDOW_MS!==s.active.config.settings.AUTOTASK_BUDGET_WINDOW_MS||config.collector?.windowMs!==s.active.config.collector?.windowMs||config.collector?.resourceId!==s.active.config.collector?.resourceId||config.collector?.policyVersion!==s.active.config.collector?.policyVersion||config.collector?.verifyAllResources!==s.active.config.collector?.verifyAllResources)throw new AppError('invalid_input','Account evidence bindings and the native budget window cannot change in a connection edit.');
 validate(config,this.tenant);s.draft={id:randomUUID(),config,createdAt:new Date(this.now()).toISOString()};delete s.test;await this.save(a,s,'draft.saved');
 }else{
 const {version}=versionSchema.parse(input);
 if(action==='adopt'){
 if(version!==0||await this.store.load(this.tenant))throw new AppError('conflict','The connection has already been adopted.');
 const s:State={version:0,active:this.loaded};validate(s.active.config,this.tenant);await this.save(a,s,'connection.adopted');
 }else{
 const s=await this.record();this.check(s,version);this.assertSettled(s);
 if(action==='discard'){delete s.draft;delete s.test;await this.save(a,s,'draft.discarded');}
 else if(action==='rollback'){if(!s.previous)throw new AppError('precondition_failed','No prior configuration is available.');s.draft={...s.previous,id:randomUUID()};delete s.test;await this.save(a,s,'rollback.staged');}
 else if(action==='test'){
 if(!this.options.handoff||!s.draft?.config.collector)throw new AppError('precondition_failed','The managed collector is required to test settings.');
 if(s.test&&this.now()-Date.parse(s.test.requestedAt)<60000)throw new AppError('precondition_failed','Wait one minute before requesting another test.');
 await this.options.validateRuntime?.(s.draft.config);s.test={id:randomUUID(),revision:s.draft.id,requestedAt:new Date(this.now()).toISOString()};await this.save(a,s,'connection.test_requested');
 }else if(action==='activate'){
 if(!this.options.reloadAvailable)throw new AppError('precondition_failed','Controlled reload is unavailable in this host.');
 const result=await this.options.handoff?.result();if(!s.draft||!s.test||!result?.ok||result.id!==s.test.id||result.revision!==s.draft.id||!Number.isFinite(Date.parse(result.at))||Date.parse(result.at)>this.now()||this.now()-Date.parse(result.at)>300000)throw new AppError('precondition_failed','A successful test of this draft within five minutes is required.');
 await this.options.validateRuntime?.(s.draft.config);s.previous=s.active;s.active=s.draft;delete s.draft;delete s.test;delete s.activationError;await this.save(a,s,'connection.activation_requested');
 }else if(action==='refresh'){
 if(!this.options.handoff)throw new AppError('precondition_failed','The managed collector is unavailable.');s.refresh=randomUUID();await this.save(a,s,'metadata.refresh_requested');
 }else throw new AppError('invalid_input','Unknown Autotask settings action.');
 }
 }
 return this.status(a);
 });}
 private assertSettled(s:State){if(s.active.id!==this.loaded.id)throw new AppError('precondition_failed','Wait for the requested configuration reload.');}
 async synchronize(){const s=await this.store.load(this.tenant);if(s)await this.publish(s);}
 async collectorReady(){const s=await this.store.load(this.tenant);if(!s)return false;const ack=await this.options.handoff?.applied();return !!ack&&ack.revision===s.active.id&&Date.parse(ack.at)<=this.now()&&this.now()-Date.parse(ack.at)<240000;}
 async desired(){return (await this.store.load(this.tenant))?.active.id??this.loaded.id;}
 async rollbackFailedActivation(){const s=await this.record();if(s.active.id===this.loaded.id)return;if(s.previous?.id!==this.loaded.id)throw new AppError('conflict','Cannot restore an unrelated configuration.');s.draft=s.active;s.active=s.previous;delete s.previous;delete s.test;s.activationError=true;const expected=s.version;s.version++;await this.store.save(this.tenant,'system',s,expected,'connection.activation_failed');await this.publish(s);}
}
