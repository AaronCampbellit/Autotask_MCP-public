import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {IntentCipher} from '../../storage/src/intent-cipher.js';
import {atomicJson} from '../../collector/src/index.js';
import type {Revision} from './model.js';
export interface Manifest {tenant:string;active:Revision;test?:{id:string;revision:Revision;requestedAt:string};refresh?:string}
export interface Result {id:string;revision:string;ok:boolean;at:string}
export interface Handoff {publish(value:Manifest):Promise<void>;result():Promise<Result|undefined>;applied():Promise<{revision:string;at:string}|undefined>}
export class FileHandoff implements Handoff {
 constructor(readonly directory:string,readonly metadataDirectory:string,private tenant:string){}
 private async cipher(create=false){
  if(create)await mkdir(this.directory,{recursive:true,mode:0o700});
  const file=resolve(this.directory,'collector.key');
  if(create)try{await writeFile(file,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  return new IntentCipher(await readFile(file));
 }
 async initialized(){try{await stat(resolve(this.directory,'collector.key'));return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
 async publish(value:Manifest){const cipher=await this.cipher(true);await atomicJson(resolve(this.directory,'connection.json'),{payload:cipher.seal(value,`autotask-handoff:${this.tenant}`)});}
 async read():Promise<Manifest>{const cipher=await this.cipher(),r=JSON.parse(await readFile(resolve(this.directory,'connection.json'),'utf8'));const value=cipher.open(r.payload,`autotask-handoff:${this.tenant}`) as Manifest;if(value.tenant!==this.tenant)throw new Error('Invalid configuration binding');return value;}
 private async output<T>(name:string):Promise<T|undefined>{try{const cipher=await this.cipher(),r=JSON.parse(await readFile(resolve(this.metadataDirectory,name),'utf8'));return cipher.open(r.payload,`autotask-result:${this.tenant}:${name}`) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}}
 async result(){return this.output<Result>('connection-test.json');}
 async applied(){return this.output<{revision:string;at:string}>('connection-applied.json');}
 async report(name:'connection-test.json'|'connection-applied.json',value:unknown){const cipher=await this.cipher();await atomicJson(resolve(this.metadataDirectory,name),{payload:cipher.seal(value,`autotask-result:${this.tenant}:${name}`)});}
}
export class MemoryHandoff implements Handoff {
 manifest?:Manifest;testResult?:Result;ack?:{revision:string;at:string};
 async publish(m:Manifest){this.manifest=structuredClone(m);}
 async result(){return this.testResult;}
 async applied(){return this.ack;}
}
