import type {DurableDiagnostics} from '../../../packages/diagnostics/src/service.js';
import type {AutotaskConfiguration} from '../../../packages/autotask-config/src/service.js';
import {businessToolDefinitions} from '../../../packages/business/src/tools.js';
import {salesToolDefinitions} from '../../../packages/sales/src/tools.js';
import {historyFilterSchema,auditLabels,historyActionLabels} from '../../../packages/control-plane/src/history.js';
import {SERVER_RELEASE} from './publication.js';
import type {EntraDirectory,AutotaskDirectory} from '../../../packages/onboarding/src/index.js';
import { readFile } from 'node:fs/promises';
import { boundedJson } from './app.js';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, type Principal } from '../../../packages/contracts/src/index.js';
import { ControlPlaneService, CONTROL_CAPABILITIES, type ControlActor } from '../../../packages/control-plane/src/index.js';
import { AdminSessions } from '../../../packages/identity/src/admin-session.js';
import type { ToolRuntime } from './tool-runtime.js';
export interface AdminRoutesOptions {
  sessions: AdminSessions; control: ControlPlaneService; publicUrl: string;
  principal(actor: ControlActor): Promise<Principal>;
  recover(p: Principal, action: 'resume' | 'reconcile', operationId: string): Promise<unknown>;
  directory?: string;
  autotaskConfiguration?:AutotaskConfiguration;
  onboarding?:{entra:EntraDirectory;autotask:AutotaskDirectory};
  operations?: Record<string,{write:boolean;capabilities:readonly string[]}>;
  runtime?: ToolRuntime;
}
const assets: Record<string,{file:string;type:string}>={ '/admin/diagnostics.js':{file:'diagnostics.js',type:'text/javascript; charset=utf-8'}, '/admin/itglue.js':{file:'itglue.js',type:'text/javascript; charset=utf-8'}, '/admin/autotask.js':{file:'autotask.js',type:'text/javascript; charset=utf-8'}, '/admin/rmm.js':{file:'rmm.js',type:'text/javascript; charset=utf-8'}, '/admin/console-language.js':{file:'console-language.js',type:'text/javascript; charset=utf-8'}, '/admin/access-model.js':{file:'access-model.js',type:'text/javascript; charset=utf-8'}, '/admin':{file:'index.html',type:'text/html; charset=utf-8'},'/admin/':{file:'index.html',type:'text/html; charset=utf-8'},'/admin/admin.css':{file:'admin.css',type:'text/css; charset=utf-8'},'/admin/admin.js':{file:'admin.js',type:'text/javascript; charset=utf-8'},'/admin/result-dialog.js':{file:'result-dialog.js',type:'text/javascript; charset=utf-8'} };
const headers = { 'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'x-frame-options':'DENY' };
const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{...headers,...extra}});
const body = (request:Request) => boundedJson(request,65_536);
export function createAdminRoutes(options:AdminRoutesOptions){
  const base=new URL(options.publicUrl);
  const journalNames:Record<string,string>=Object.fromEntries([...Object.entries(businessToolDefinitions).filter(([,v])=>['create','update','delete'].includes(v.action)).map(([name,v])=>[name,`business_${v.entity.toLowerCase()}_${v.action}`]),...salesToolDefinitions.filter(([, ,action])=>['create','update','delete'].includes(action)).map(([name,entity,action])=>[name,`sales_${entity.toLowerCase()}_${action}`])]);

  let peopleCache:{items:Awaited<ReturnType<EntraDirectory['list']>>;expires:number;available:boolean}|undefined;
  let peopleLoad:Promise<NonNullable<typeof peopleCache>>|undefined;
  async function people(){
    if(peopleCache&&peopleCache.expires>Date.now())return peopleCache;
    peopleLoad??=(async()=>{try{if(!options.onboarding)throw new Error('not configured');const items=await options.onboarding.entra.list();return peopleCache={items,expires:Date.now()+60000,available:true};}catch{return peopleCache={items:[],expires:Date.now()+15000,available:false};}})().finally(()=>{peopleLoad=undefined;});return peopleLoad;
  }

  return {close:()=>options.sessions.close(),async fetch(request:Request):Promise<Response|null>{
    const url=new URL(request.url);if(!url.pathname.startsWith('/admin'))return null;
    try{
      if(url.origin!==base.origin)throw new AppError('forbidden','Unexpected console origin.');
      if(request.method==='GET'&&assets[url.pathname]){const asset=assets[url.pathname]!;return new Response(await readFile(join(options.directory??'apps/console/public',asset.file)),{headers:{...headers,'content-type':asset.type}});}
      if(request.method==='GET'&&url.pathname==='/admin/auth/config')return json({mode:options.sessions.mode});
      if(request.method==='GET'&&url.pathname==='/admin/login'){const login=options.sessions.beginLogin();return new Response(null,{status:302,headers:{...headers,location:login.location,'set-cookie':login.cookie}});}
      if(request.method==='GET'&&url.pathname==='/admin/callback'){const session=await options.sessions.callback(request);const h=new Headers({...headers,location:'/admin'});h.append('set-cookie',session.cookie);h.append('set-cookie',session.clearLoginCookie);return new Response(null,{status:302,headers:h});}
      if(request.method==='POST'&&url.pathname==='/admin/auth/fixture'){const args=z.object({token:z.string().min(1).max(16384)}).strict().parse(await body(request));const issued=await options.sessions.fixtureLogin(request,args.token);return json({actor:issued.session.actor,csrf:issued.session.csrf},200,{'set-cookie':issued.cookie});}
      const session=options.sessions.session(request,request.method!=='GET');
      if(request.method==='GET'&&url.pathname==='/admin/api/session'){
        let configuration=false;try{if(options.autotaskConfiguration){await options.autotaskConfiguration.access(session.actor);configuration=true;}}catch{/* Does not grant operational access. */}
        let access;try{access=await options.control.consoleAccess(session.actor);}catch(error){if(!configuration)throw error;access={admin:false,audit:false};}
        return json({actor:session.actor,csrf:session.csrf,expires:session.expires,access:{...access,configuration},release:SERVER_RELEASE});
      }
      if(request.method==='POST'&&url.pathname==='/admin/logout')return json({signedOut:true},200,{'set-cookie':options.sessions.logout(request)});
      const actor=session.actor;
      if(url.pathname==='/admin/api/diagnostics'||url.pathname.startsWith('/admin/api/diagnostics/')){
        if(request.method!=='GET')throw new AppError('invalid_input','Diagnostics only supports read requests.');
        const current=async()=>{const p=await options.principal(actor);if(!p.capabilities.includes('platform.manage'))throw new AppError('forbidden','Platform administration is required for tool-call diagnostics.');return p;};
        const p=await current(),diagnostics=(options.runtime?.options as {diagnostics?:DurableDiagnostics}|undefined)?.diagnostics;
        if(!diagnostics)throw new AppError('unsupported_operation','Tool-call diagnostics are unavailable.');
        const route=url.pathname.slice('/admin/api/diagnostics'.length);let result:unknown;
        if(route===''){const allowed=new Set(['from','to','actorId','tool','outcome','errorOrigin','errorCode','recordId','operationId','jobId','traceId','serverRelease','limit','cursor']);for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)throw new AppError('invalid_input','Invalid diagnostic filters.');const filters:Record<string,unknown>=Object.fromEntries(url.searchParams);if(filters.limit!==undefined)filters.limit=Number(filters.limit);result=await diagnostics.list(p,filters);}
        else if(route==='/health'){if(url.search)throw new AppError('invalid_input','Diagnostic health does not accept filters.');result=await diagnostics.health();}
        else{const match=route.match(/^\/([0-9a-f-]{36})(\/export)?$/i);if(!match||url.search)throw new AppError('invalid_input','Invalid diagnostic detail request.');const id=z.string().uuid().parse(match[1]);result=await diagnostics.detail(p,id);await options.control.diagnosticAccess(actor,id,match[2]?'export':'detail');}
        await current();return json(result);
      }
      if(url.pathname.startsWith('/admin/api/autotask/')){
        const configuration=options.autotaskConfiguration;
        if(!configuration)throw new AppError('unsupported_operation','Autotask configuration is unavailable.');
        const action=url.pathname.slice('/admin/api/autotask/'.length);
        if(request.method==='GET'&&action==='status')return json(await configuration.status(actor));
        if(request.method==='POST')return json(await configuration.action(actor,action,await body(request)));
        throw new AppError('invalid_input','Unknown Autotask configuration action.');
      }
      if(url.pathname.startsWith('/admin/api/itglue/')){
        await options.control.snapshot(actor);
        const integration=options.runtime?.options.itglue;if(!integration)throw new AppError('unsupported_operation','IT Glue is unavailable.');
        const p=await options.principal(actor),route=url.pathname.slice('/admin/api/itglue/'.length);
        let result:unknown;
        if(request.method==='GET'&&route==='status')result=await integration.status(p);
        else if(request.method==='POST'&&route==='discover')result=await integration.discoverOrganizations(p,await body(request));
        else if(request.method==='POST'&&route==='connection')result=await integration.configure(p,await body(request));
        else if(request.method==='POST'&&route==='mapping')result=await integration.mapOrganization(p,await body(request));
        else throw new AppError('invalid_input','Unknown IT Glue configuration action.');
        await options.control.snapshot(actor);return json(result);
      }
      if(url.pathname.startsWith('/admin/api/rmm')){
        await options.control.snapshot(actor);
        const rmm=options.runtime?.options.rmm;if(!rmm)throw new AppError('unsupported_operation','RMM configuration is unavailable in this server.');
        const p=await options.principal(actor),route=url.pathname.slice('/admin/api/rmm'.length);
        if(request.method==='GET'&&route==='/status'){const result=await rmm.status(p),directory=await people();await options.control.snapshot(actor);return json({...result,events:result.events.map(e=>({...e,actor_name:directory.items.find(u=>u.id.toLowerCase()===String(e.actor).split(':').at(-1)?.toLowerCase())?.displayName??'Administrator'}))});}
        if(request.method==='POST'){
          const value=await body(request);
          if(route==='/connection')return json(await rmm.configure(p,value));
          if(route==='/disconnect')return json(await rmm.disconnect(p,value));
          if(route==='/test'){z.object({}).strict().parse(value);return json(await rmm.test(p));}
          if(route==='/sites'||route==='/components')return json(await rmm.catalogue(p,route==='/sites'?'sites':'components',value));
          if(route==='/mapping')return json(await rmm.mapSite(p,value));
          if(route==='/approval')return json(await rmm.approve(p,value));
        }
        throw new AppError('invalid_input','Unknown RMM configuration action.');
      }

      const operationMatch=url.pathname.match(/^\/admin\/api\/operations\/([0-9a-f-]{36})$/i);
      if(options.runtime&&request.method==='GET'&&operationMatch){
        if(url.search)throw new AppError('invalid_input','Operation status does not accept query parameters.');
        return json(await options.runtime.invoke(await options.principal(actor),'at_operation_status',{operation_id:operationMatch[1]}));
      }
      if(options.runtime?.options.artifacts&&url.pathname.startsWith('/admin/api/artifacts')){
        const p=await options.principal(actor),runtime=options.runtime;
        if(request.method==='GET'&&url.pathname==='/admin/api/artifacts')return json(await runtime.invoke(p,'at_artifact_list',{}));
        if(request.method==='POST'&&url.pathname==='/admin/api/artifacts/export')return json(await runtime.invoke(p,'at_artifact_export',await body(request)));
        if(request.method==='POST'&&url.pathname==='/admin/api/artifacts/stage-opportunity')return json(await runtime.invoke(p,'opportunity_file_stage',await boundedJson(request,9_400_000)));
        if(request.method==='POST'&&url.pathname==='/admin/api/artifacts/stage')return json(await runtime.invoke(p,'at_file_stage',await boundedJson(request,9_400_000)));
        if(request.method==='POST'&&url.pathname==='/admin/api/artifacts/delete')return json(await runtime.invoke(p,'at_artifact_delete',await body(request)));
        const match=url.pathname.match(/^\/admin\/api\/artifacts\/([0-9a-f-]{36})\/download$/i);
        if(request.method==='GET'&&match){const result=await runtime.options.execution.run(p,['at_artifact_get'],()=>runtime.options.artifacts!.download(p,{artifact_id:match[1]}));return new Response(new Uint8Array(result.bytes),{headers:{...headers,...result.headers}});}
      }
      if(request.method==='GET'&&['/admin/api/directory/users','/admin/api/directory/resources','/admin/api/directory/companies'].includes(url.pathname)){
        await options.control.snapshot(actor);if(!options.onboarding)throw new AppError('unsupported_operation','Directory onboarding is not configured.');
        const items=url.pathname.endsWith('/users')?await options.onboarding.entra.list():url.pathname.endsWith('/companies')?await options.onboarding.autotask.companyChoices(`${actor.tenantId}:${actor.objectId}`):await options.onboarding.autotask.resources(`${actor.tenantId}:${actor.objectId}`);
        await options.control.snapshot(actor);return json({items,complete:true});
      }
      if(request.method==='GET'&&url.pathname==='/admin/api/snapshot')return json({...await options.control.snapshot(actor),capabilities:CONTROL_CAPABILITIES,operations:options.operations??{}});
      if(request.method==='GET'&&url.pathname==='/admin/api/history'){
        const allowed=new Set(['kind','user','action','state','from','to','q','limit','cursor']);
        for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)throw new AppError('invalid_input','The history filter is invalid.');
        const raw:Record<string,unknown>=Object.fromEntries(url.searchParams);if(raw.limit!==undefined)raw.limit=Number(raw.limit);
        if(raw.cursor!==undefined){try{raw.cursor=JSON.parse(String(raw.cursor));}catch{throw new AppError('invalid_input','The history page is invalid.');}}
        const parsed=historyFilterSchema.safeParse(raw);if(!parsed.success)throw new AppError('invalid_input','Choose valid history filters and a start date before the end date.');
        const data=await options.control.history(actor,parsed.data),access=await options.control.consoleAccess(actor),directory=await people();
        // Recheck after directory I/O; cached names never confer access.
        const current=await options.control.consoleAccess(actor);
        if((parsed.data.kind==='activity'&&data.scope==='all'&&!current.admin)||(parsed.data.kind==='audit'&&!current.audit)||access.admin!==current.admin||access.audit!==current.audit)throw new AppError('forbidden','Your access changed. Refresh the page.');
        const find=(id:string)=>directory.items.find(u=>u.id.toLowerCase()===id.toLowerCase());
        const user=(id:string)=>{const u=find(id);return{id,name:u?.displayName??'User name unavailable',email:u?(u.mail||u.userPrincipalName):''};};
        const users=data.scope==='all'?directory.items.map(u=>user(u.id)):[user(actor.objectId)];
        if(parsed.data.user&&!users.some(u=>u.id===parsed.data.user))users.push(user(parsed.data.user));
        for(const item of data.items)if(!users.some(u=>u.id===item.userId))users.push(user(item.userId));
        return json({...data,items:data.items.map(item=>({...item,user:user(item.userId),actionLabel:auditLabels[item.action]??historyActionLabels[item.action],...(item.targetType==='member'?{targetLabel:find(item.targetId??'')?.displayName??'Employee permissions'}:item.targetType==='template'?{targetLabel:`Permission template: ${item.targetId}`} :item.targetType==='controls'?{targetLabel:'Operation controls'}:item.targetType==='job'?{targetLabel:'Background work'}:{})})),users:users.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)),actions:parsed.data.kind==='audit'?Object.keys(auditLabels):[...new Set([...Object.entries(options.operations??{}).filter(([,v])=>v.write).map(([name])=>journalNames[name]??name),...data.items.map(item=>item.action),...(parsed.data.action?[parsed.data.action]:[])])],actionLabels:{...auditLabels,...historyActionLabels},namesAvailable:directory.available});
      }
      if(request.method==='GET'&&url.pathname==='/admin/api/activity')return json(await options.control.activity(actor));
      if(request.method==='GET'&&url.pathname==='/admin/api/audit')return json(await options.control.audit(actor));
      if(request.method==='GET'&&url.pathname==='/admin/api/jobs')return json(await options.control.jobs(actor));
      if(request.method==='POST'&&url.pathname==='/admin/api/members'){const args=z.object({member:z.unknown(),expectedVersion:z.number().int().min(0)}).strict().parse(await body(request));if(options.onboarding){await options.control.snapshot(actor);const member=args.member as {objectId?:unknown;active?:unknown};if(member?.active===true){if(typeof member.objectId!=='string')throw new AppError('invalid_input','Select an Entra user.');await options.onboarding.entra.verify(member.objectId);}}return json(await options.control.saveMember(actor,args.member as Parameters<ControlPlaneService['saveMember']>[1],args.expectedVersion));}
      if(request.method==='POST'&&url.pathname==='/admin/api/templates'){const args=z.object({template:z.unknown(),expectedVersion:z.number().int().min(0)}).strict().parse(await body(request));return json(await options.control.saveTemplate(actor,args.template as Parameters<ControlPlaneService['saveTemplate']>[1],args.expectedVersion));}
      if(request.method==='POST'&&url.pathname==='/admin/api/controls'){const args=z.object({controls:z.unknown(),expectedVersion:z.number().int().min(0)}).strict().parse(await body(request));return json(await options.control.setControls(actor,args.controls as Parameters<ControlPlaneService['setControls']>[1],args.expectedVersion));}
      if(request.method==='POST'&&url.pathname==='/admin/api/recover'){const args=z.object({action:z.enum(['resume','reconcile']),operation_id:z.string().uuid()}).strict().parse(await body(request));return json(await options.recover(await options.principal(actor),args.action,args.operation_id));}
      if(request.method==='POST'&&url.pathname==='/admin/api/cancel'){const args=z.object({job_id:z.string().uuid()}).strict().parse(await body(request));return json(await options.control.cancel(actor,args.job_id));}
      return json({error:{code:'not_found_or_inaccessible',message:'Console route unavailable.'}},404);
    }catch(error){const safe=error instanceof AppError?error:error instanceof z.ZodError?new AppError('invalid_input','The request has missing or invalid fields.'):new AppError('dependency_unavailable','The console request could not be completed.');return json({error:{code:safe.code,message:safe.message}},safe.code==='unauthenticated'?401:safe.code==='forbidden'?403:safe.code==='invalid_input'?400:safe.code==='conflict'?409:503);}
  }};
}
