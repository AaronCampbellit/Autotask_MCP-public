import type {RmmPort} from './client.js';
import type {RmmConfig,Row} from './store.js';
/** No network access: local review of configuration and approval screens only. */
export class FixtureRmmPort implements RmmPort {
 async request(c:RmmConfig,path:string,query:Row={},body?:unknown,guard?:()=>Promise<void>,beforeWrite?:()=>Promise<void>):Promise<Row>{
  await guard?.();if(body){await beforeWrite?.();return{job:{uid:'example-job'}};}
  if(path==='/v2/account')return{uid:'example-account'};
  if(path==='/v2/account/sites')return{sites:[{uid:'example-site',name:'Example client',autotaskCompanyId:'10'}],pageDetails:{nextPageUrl:null}};
  if(path==='/v2/site/example-site')return{uid:'example-site',name:'Example client',autotaskCompanyId:'10'};
  if(path==='/v2/account/components')return{components:[{uid:'example-diagnostics',name:'Example workstation diagnostics',description:'Fictitious component for local console review.',credentialsRequired:false,variables:[]},{uid:'example-inputs',name:'Example diagnostic with fixed input',description:'Review and set the fixed input before approving.',credentialsRequired:false,variables:[{name:'Mode',type:'string',description:'Diagnostic mode'}]}],pageDetails:{nextPageUrl:null}};
  if(path==='/v2/device/example-device')return{uid:'example-device',siteUid:'example-site',hostname:'EXAMPLE-PC',deviceClass:'device',online:true};
  if(path==='/v2/site/example-site/devices')return{devices:[{uid:'example-device',siteUid:'example-site',hostname:'EXAMPLE-PC',deviceClass:'device',online:true}],pageDetails:{nextPageUrl:null}};
  return{};
 }
}
