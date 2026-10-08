import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module is exercised with the small DOM adapter below.
import {renderRmm} from '../apps/console/public/rmm.js';
class Element {
 children:Element[]=[];textContent='';type='';checked=false;disabled=false;hidden=false;value='';indeterminate=false;open=false;
 listeners:Record<string,Function[]>={};
 constructor(public tag:string,text?:unknown){this.textContent=String(text??'');}
 append(...items:Element[]){this.children.push(...items);} prepend(...items:Element[]){this.children.unshift(...items);} replaceChildren(){this.children=[];}
 setAttribute(){} addEventListener(name:string,fn:Function){(this.listeners[name]??=[]).push(fn);}
 dispatchEvent(event:Event){for(const fn of this.listeners[event.type]??[])fn(event);}
 querySelectorAll(selector:string):Element[]{return this.children.flatMap(c=>[...(selector.split(',').includes(c.tag)?[c]:[]),...c.querySelectorAll(selector)]);}
 async click(){for(const fn of this.listeners.click??[])await fn();}
}
async function fixture(failAt=0){
 const content=new Element('main'),calls:any[]=[],notices:any[]=[];let version=1,refreshes=0;
 const state={version,sites:{},approvals:{},events:[],configured:true,account_uid:'account',platform:'merlot'};
 const api=async(path:string,input?:any)=>{
  if(path.endsWith('/status'))return {...state};
  if(path.endsWith('/sites'))return {items:input.page===0?[{uid:'s1',name:'One',company_id:'1'},{uid:'s2',name:'Two',company_id:'2'}]:[{uid:'s3',name:'Three',company_id:'3'},{uid:'unlinked',name:'Unlinked',company_id:null}],next_page:input.page===0?1:null};
  if(path.endsWith('/components'))return {items:[{uid:'c1',name:'First',variables:[{name:'Mode'}]},{uid:'c2',name:'Second',variables:[]},{uid:'secret',name:'Secret',variables:[],credentials_required:true},{uid:'approved',name:'Approved',variables:[],approved:true}],next_page:null};
  assert.equal(input.version,version);calls.push({path,...input});if(calls.length===failAt)throw Error('Save failed');version++;return {...state,version};
 };
 const node=(tag:string,text?:unknown)=>new Element(tag,text);
 const button=(text:string,fn:Function)=>{const e=node('button',text);e.addEventListener('click',fn);return e;};
 const panel=(title:string)=>node('section',title);
 const table=(_headers:unknown,rows:any[],render:Function)=>{const e=node('table');for(const row of rows)for(const value of render(row))e.append(value instanceof Element?value:node('td',value));return e;};
 await renderRmm(content,{api,node,button,panel,table,notice:(...args:any[])=>notices.push(args),refresh:async()=>{refreshes++;}});
 const getButton=(name:string)=>{const b=content.querySelectorAll('button').find(e=>e.textContent===name);assert(b,name);return b;};
 const section=(name:string)=>content.children.find(e=>e.textContent===name)!;
 const boxes=(name:string)=>section(name).querySelectorAll('input').filter(e=>e.type==='checkbox');
 return {content,calls,notices,getButton,boxes,section,get refreshes(){return refreshes;}};
}
test('client select all includes every loaded page and excludes unlinked sites',async()=>{
 const f=await fixture();await f.getButton('Load site catalog').click();const all=f.boxes('Client access')[0]!;all.checked=true;all.dispatchEvent(new Event('change'));
 assert.equal(f.boxes('Client access').filter(e=>e.checked).length,4);
 await f.getButton('Enable selected clients').click();assert.deepEqual(f.calls.map(c=>c.site_uid),['s1','s2','s3']);assert.deepEqual(f.calls.map(c=>c.version),[1,2,3]);assert.equal(f.refreshes,1);
});
test('component bulk approval preserves fixed inputs and excludes credential and approved components',async()=>{
 const f=await fixture();assert.equal(f.getButton('Refresh component catalog').textContent,'Refresh component catalog');assert(f.section('RMM components').querySelectorAll('p').some(e=>/All 4 available components loaded/.test(e.textContent)));assert.equal(f.content.querySelectorAll('button').some(e=>e.textContent==='Load all components'),false);const inputs=f.section('RMM components').querySelectorAll('input');inputs.find(e=>e.type==='password')!.value='reviewed';
 const all=f.boxes('RMM components')[0]!;all.checked=true;all.dispatchEvent(new Event('change'));
 await f.getButton('Approve selected components').click();assert.deepEqual(f.calls.map(c=>c.component_uid),['c1','c2']);assert.deepEqual(f.calls[0].variables,{Mode:'reviewed'});assert.equal(f.refreshes,1);
});
test('partial failure retains remaining selections and resumes using the last saved version',async()=>{
 const f=await fixture(2);await f.getButton('Load site catalog').click();const all=f.boxes('Client access')[0]!;all.checked=true;all.dispatchEvent(new Event('change'));await f.getButton('Enable selected clients').click();
 assert.equal(f.refreshes,0);assert.match(f.notices[0][0],/1 of 3 items saved/);assert.equal(f.boxes('Client access').slice(1).filter(e=>e.checked&&!e.disabled).length,2);
 await f.getButton('Enable selected clients').click();assert.deepEqual(f.calls.map(c=>c.site_uid),['s1','s2','s2','s3']);assert.equal(f.refreshes,1);
});
