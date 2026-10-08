import {readFile} from 'node:fs/promises';
import {ReadOnlyCollector,collectorConfigSchema} from '../packages/collector/src/index.js';
import {FileHandoff} from '../packages/autotask-config/src/handoff.js';
import {configSchema} from '../packages/autotask-config/src/model.js';
const baseline=collectorConfigSchema.parse(JSON.parse(await readFile('config/metadata/collector.json','utf8')));
const handoff=process.env.AUTOTASK_CONFIG_DIRECTORY?new FileHandoff(process.env.AUTOTASK_CONFIG_DIRECTORY,'config/metadata',baseline.tenantId):undefined;
const once=process.argv.includes('--once');let stopping=false,managed=false,nextRun=0,lastRefresh:string|undefined,lastAttemptRevision:string|undefined;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
do{
 try{
  let manifest;
  if(handoff)try{manifest=await handoff.read();managed=true;}catch(e){if(managed||await handoff.initialized()||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const current=manifest?configSchema.parse(manifest.active.config):undefined;
  const config=current?.collector??baseline;
  if(config.tenantId!==baseline.tenantId||config.baseUrl!==baseline.baseUrl||current&&current.baseUrl!==baseline.baseUrl)throw new Error('collector_binding_changed');
  const credentials=current?{username:current.username,secret:current.secret,integrationCode:current.integrationCode}:{username:process.env.AUTOTASK_USERNAME??'',secret:process.env.AUTOTASK_SECRET??'',integrationCode:process.env.AUTOTASK_INTEGRATION_CODE??''};
  const collector=new ReadOnlyCollector(config,{root:process.cwd(),directory:'config/metadata',credentials});
  if(handoff&&manifest?.test){
   const test=manifest.test,result=await handoff.result();
   if(result?.id!==test.id&&Date.now()-Date.parse(test.requestedAt)<300000&&Date.parse(test.requestedAt)<=Date.now()){
    // Claim before dispatch: a crash must not repeatedly spend the probe budget.
    await handoff.report('connection-test.json',{id:test.id,revision:test.revision.id,ok:false,at:new Date().toISOString()});
    const candidate=configSchema.parse(test.revision.config);let ok=false;
    try{
     if(candidate.username!==credentials.username||candidate.baseUrl!==config.baseUrl||!candidate.collector||candidate.collector.tenantId!==config.tenantId||candidate.collector.windowMs!==config.windowMs||candidate.collector.resourceId!==config.resourceId)throw new Error('candidate_binding_changed');
     // Admission uses the active allowance; a draft cannot increase its own testing budget.
     const probe=new ReadOnlyCollector({...candidate.collector,requestsPerWindow:Math.min(config.requestsPerWindow,candidate.collector.requestsPerWindow)},{root:process.cwd(),directory:'config/metadata',credentials:{username:candidate.username,secret:candidate.secret,integrationCode:candidate.integrationCode}});
     await probe.probe();ok=true;
    }catch{/* Only a boolean result crosses into console diagnostics. */}
    await handoff.report('connection-test.json',{id:test.id,revision:test.revision.id,ok,at:new Date().toISOString()});
   }
  }
  const refresh=manifest?.refresh;
  if(once||Date.now()>=nextRun||manifest&&lastAttemptRevision!==manifest.active.id||refresh&&refresh!==lastRefresh){
   const refreshMetadata=once&&process.argv.includes('--refresh-metadata')||!!refresh&&refresh!==lastRefresh;
   lastRefresh=refresh;lastAttemptRevision=manifest?.active.id;nextRun=Date.now()+config.intervalMs;
   console.log(JSON.stringify(await collector.run({refreshMetadata})));
   if(handoff&&manifest)await handoff.report('connection-applied.json',{revision:manifest.active.id,at:new Date().toISOString()});
   lastRefresh=refresh;nextRun=Date.now()+config.intervalMs;
  }
 }catch{console.error(JSON.stringify({status:'collector_failed',message:'Collection failed; evidence is not renewed. Check configuration, API access, capacity and evidence expiry.'}));if(once)process.exitCode=1;}
 if(once||stopping)break;
 await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);process.removeListener('SIGTERM',done);process.removeListener('SIGINT',done);resolve();};const timer=setTimeout(done,handoff?5000:baseline.intervalMs);process.once('SIGTERM',done);process.once('SIGINT',done);});
}while(!stopping);
