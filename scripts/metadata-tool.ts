import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '../packages/contracts/src/index.js';
import { compileInventory, compileSnapshot, coverageReport, diffSnapshots, loadMetadataSnapshot, verifyLocalSources } from '../packages/metadata/src/index.js';
import { MAX_SNAPSHOT_BYTES } from '../packages/metadata/src/files.js';
import { fixtureMetadataSnapshot } from '../packages/metadata/src/fixtures.js';

const usage='Usage: metadata-tool.ts inventory | fixture --out FILE | import --input FILE --out FILE | validate --input FILE | coverage --input FILE | diff --before FILE --after FILE [--inventory registry/coverage.json] [--root .] [--at ISO_DATE]';
async function jsonFile(path:string):Promise<unknown> {
  try {const info=await stat(path);if(!info.isFile()||info.size>MAX_SNAPSHOT_BYTES)throw new Error();return JSON.parse(await readFile(path,'utf8'));}
  catch {throw new AppError('invalid_input','The local input must be a bounded JSON metadata file.');}
}
/** No network access and no raw metadata, record bodies, source paths or secrets in console output. */
export async function runMetadataCli(argv:readonly string[]):Promise<unknown> {
  const [command,...rest]=argv,options:Record<string,string>={};
  if(!command||!['inventory','fixture','import','validate','coverage','diff'].includes(command)||rest.length%2)throw new AppError('invalid_input',usage);
  for(let index=0;index<rest.length;index+=2) {
    const key=rest[index]!,value=rest[index+1]!;
    if(!['--out','--input','--before','--after','--inventory','--root','--at'].includes(key)||!value||options[key]!==undefined)throw new AppError('invalid_input',usage);
    options[key]=value;
  }
  const required=(name:string)=>{const value=options[name];if(!value)throw new AppError('invalid_input',usage);return resolve(value);};
  const now=options['--at']===undefined?Date.now():Date.parse(options['--at']);if(!Number.isFinite(now))throw new AppError('invalid_input','The validation timestamp is invalid.');
  const inventory=compileInventory(await jsonFile(resolve(options['--inventory']??'registry/coverage.json')));
  if(command==='inventory')return{inventoryDigest:inventory.digest,total:inventory.entities.length,liveEnablement:false,entities:inventory.entities.map(row=>({entity:row.entity,documentaryOnly:true}))};
  if(command==='diff')return diffSnapshots(await loadMetadataSnapshot(required('--before'),{inventory,now,requireFresh:false}),await loadMetadataSnapshot(required('--after'),{inventory,now,requireFresh:false}),now);
  if(command==='fixture'||command==='import') {
    const snapshot=command==='fixture'?fixtureMetadataSnapshot(inventory,now):compileSnapshot(await jsonFile(required('--input')),{inventory,now});
    const verified=await verifyLocalSources(snapshot,resolve(options['--root']??'.'));
    const target=required('--out');await mkdir(dirname(target),{recursive:true});
    try {await writeFile(target,`${JSON.stringify(snapshot,null,2)}\n`,{encoding:'utf8',flag:'wx'});}catch {throw new AppError('conflict','The output could not be created. Select a new output filename.');}
    return{valid:true,source:snapshot.content.source,version:snapshot.version,digest:snapshot.digest,entities:snapshot.content.entities.length,bindings:snapshot.content.bindings.length,verifiedLocalSources:Object.keys(verified).length,liveEnablement:false};
  }
  const snapshot=await loadMetadataSnapshot(required('--input'),{inventory,now,requireFresh:command==='validate'});
  if(command==='coverage')return coverageReport(snapshot,inventory,now);
  const verified=await verifyLocalSources(snapshot,resolve(options['--root']??'.'));
  return{valid:true,source:snapshot.content.source,version:snapshot.version,digest:snapshot.digest,entities:snapshot.content.entities.length,bindings:snapshot.content.bindings.length,verifiedLocalSources:Object.keys(verified).length,liveEnablement:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runMetadataCli(process.argv.slice(2)).then(result=>{process.stdout.write(`${JSON.stringify(result,null,2)}\n`);}).catch(error=>{
    process.stderr.write(`${JSON.stringify({error:error instanceof AppError?error.code:'invalid_input',message:error instanceof AppError?error.message:'Metadata validation failed.'})}\n`);process.exitCode=1;
  });
}
