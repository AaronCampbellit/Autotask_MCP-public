import {LocalThresholdProvider} from '../../../packages/autotask/src/budget.js';
import { createServer } from 'node:http';
import { mkdir,writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createFixtureSystem } from './fixture-system.js';
import { createLiveSystem } from './live-system.js';
import { createNodeHandler } from './ingress.js';

const fixture=process.argv.includes('--fixture'),port=Number(process.env.PORT??3030);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port.');
const publicUrl=fixture?`http://127.0.0.1:${port}`:process.env.PUBLIC_URL;
if(!publicUrl)throw new Error('PUBLIC_URL is required.');
let pool:Pool|undefined;
let system=fixture?createFixtureSystem(publicUrl):await(async()=>{if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');pool=new Pool({connectionString:process.env.DATABASE_URL,max:10});try{try{return await createLiveSystem(pool,process.env,{reloadAvailable:true});}catch{return await createLiveSystem(pool,process.env,{reloadAvailable:true,recoveryOnly:true});}}catch(error){await pool.end();throw error;}})();
if('tokens'in system){await mkdir('work',{recursive:true});await writeFile('work/demo-credentials.json',JSON.stringify(system.tokens.map(({name,token})=>({name,token})),null,2));process.stdout.write(`Fixture MCP: ${publicUrl}/mcp\nConsole: ${publicUrl}/admin\nTokens: work/demo-credentials.json\nFictitious data; state resets on restart.\n`);}
else process.stdout.write(`Entra MCP and console configured. ${system.qualifications.length} operation qualifications loaded; exact evidence checks apply at dispatch.\n`);
let handler=createNodeHandler(system.app,{publicUrl}),reloading=false,checking=false,inflight=0,stopping=false,nextRecoveryAttempt=0;
const server=createServer((req,res)=>{
  if(reloading){res.writeHead(503,{'content-type':'application/json','retry-after':'5'});res.end(JSON.stringify({error:{code:'dependency_unavailable',message:'Connection settings are being applied. Retry shortly.'}}));return;}
  inflight++;void handler(req,res).finally(()=>{inflight--;});
});
const reloadTimer=fixture?undefined:setInterval(()=>{void reloadConfiguration();},2000);reloadTimer?.unref();
async function reloadConfiguration(){
 if(stopping||reloading||checking||!pool||!('requestBudget'in system))return;
 const prior=system;checking=true;
 try{
  if(prior.recoveryMode&&Date.now()<nextRecoveryAttempt)return;
  if(await prior.autotaskConfiguration.desired()===prior.autotaskConfiguration.loaded.id&&(!prior.recoveryMode||!await prior.autotaskConfiguration.collectorReady()))return;
  reloading=true;nextRecoveryAttempt=Date.now()+30000;await prior.worker.close();
  while(inflight>0&&!stopping)await new Promise(resolve=>setTimeout(resolve,25));
  if(stopping)return;
  await prior.runtime.options.execution.drain();
  await prior.autotaskConfiguration.synchronize();
  const deadline=Date.now()+45000;
  while(!await prior.autotaskConfiguration.collectorReady()){
    if(stopping||Date.now()>deadline)throw new Error('Collector revision verification unavailable.');
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const next=await createLiveSystem(pool,process.env,{reloadAvailable:true});
  try{
    if(prior.requestBudget instanceof LocalThresholdProvider&&next.requestBudget instanceof LocalThresholdProvider)next.requestBudget.budget.importUsage(prior.requestBudget.budget.exportUsage());
    await next.autotaskConfiguration.synchronize();
    if(stopping)throw new Error('Shutdown interrupted reload.');
  }catch(error){await next.app.close();await next.worker.close();if('close'in next.requestBudget)next.requestBudget.close();throw error;}
  system=next;handler=createNodeHandler(next.app,{publicUrl:publicUrl!});
  await prior.app.close();if('close'in prior.requestBudget)prior.requestBudget.close();
  if(process.env.JOB_WORKER_ENABLED!=='false')next.worker.start();
  process.stdout.write('Autotask configuration reloaded; collector verification is required before dispatch.\n');
 }catch{
  prior.runtime.options.execution.resume();
  try{await prior.autotaskConfiguration.rollbackFailedActivation();}catch{/* Preserve failure for operator recovery; never fall back to environment credentials. */}
  if(!stopping&&!prior.recoveryMode&&process.env.JOB_WORKER_ENABLED!=='false')prior.worker.start();
  process.stderr.write('Autotask configuration reload failed; previous runtime retained.\n');
 }finally{reloading=false;checking=false;}
}
if('requestBudget'in system)await system.autotaskConfiguration.synchronize();
server.requestTimeout=30_000;server.headersTimeout=10_000;
server.listen(port,fixture?'127.0.0.1':'0.0.0.0',()=>{if(process.env.JOB_WORKER_ENABLED!=='false'&&(!('recoveryMode'in system)||!system.recoveryMode))system.worker.start();});
async function shutdown(){if(stopping)return;stopping=true;if(reloadTimer)clearInterval(reloadTimer);const closed=new Promise<void>(resolve=>server.close(()=>resolve()));while(checking)await new Promise(resolve=>setTimeout(resolve,25));if('requestBudget'in system&&'close'in system.requestBudget)system.requestBudget.close();await system.worker.close();await system.app.close();server.closeAllConnections();await closed;await pool?.end();process.stdout.write('MCP server and background worker stopped.\n');}
process.on('SIGINT',()=>{void shutdown();});process.on('SIGTERM',()=>{void shutdown();});
