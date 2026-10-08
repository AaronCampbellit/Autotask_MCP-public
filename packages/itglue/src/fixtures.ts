import {AppError} from '../../contracts/src/index.js';
import type {ItGluePort} from './client.js';
import type {ItGlueConfig,Row} from './store.js';
export class FixtureItGluePort implements ItGluePort {
 records=new Map<string,Row>([['/organizations/100',{id:'100',type:'organizations',attributes:{name:'Example client','psa-id':'10','psa-integration-type':'autotask'}}],['/configurations/200',{id:'200',type:'configurations',attributes:{name:'Example workstation','organization-id':'100','serial-number':'FIXTURE-001'}}],['/documents/300',{id:'300',type:'documents',attributes:{name:'Example runbook','organization-id':'100'}}]]);
 requests:Row[]=[];nextId=1000;
 async request(c:ItGlueConfig,path:string,q:Row={},body?:any,guard:()=>Promise<void>=async()=>{},beforeWrite?:()=>Promise<void>,method:'GET'|'POST'|'PATCH'=body===undefined?'GET':'PATCH'){
  await guard();this.requests.push({path,q,method});if(method!=='GET'){await beforeWrite?.();const id=method==='POST'?String(this.nextId++):path.split('/').at(-1)!,old=this.records.get(path),data={id,type:body.data.type,attributes:{...old?.attributes,...body.data.attributes}};this.records.set(method==='POST'?`${path}/${id}`:path,data);return{data};}
  if(this.records.has(path))return{data:structuredClone(this.records.get(path))};
  let rows=[...this.records.entries()].filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')).map(([,r])=>structuredClone(r));
  if(q['filter[id]'])rows=rows.filter(r=>r.id===q['filter[id]']);if(q['filter[organization_id]'])rows=rows.filter(r=>r.attributes['organization-id']===q['filter[organization_id]']);if(q['filter[psa_id]'])rows=rows.filter(r=>r.attributes['psa-id']===q['filter[psa_id]']);
  if(/\/\d+$/.test(path))throw new AppError('not_found_or_inaccessible','Fixture record missing.');return{data:rows,meta:{'total-pages':1}};
 }
}
