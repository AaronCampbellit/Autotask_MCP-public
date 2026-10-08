import test from 'node:test';
import assert from 'node:assert/strict';
import {EntraDirectory,AutotaskDirectory} from '../packages/onboarding/src/index.js';
import {FixtureUnlimitedRequestBudget} from '../packages/autotask/src/budget.js';
import {fixturePrincipals} from '../packages/workflows/src/fixtures.js';
import {allResourceObservations} from '../packages/collector/src/index.js';
import {reauthorize} from '../packages/policy/src/index.js';
const tenantId='581437a9-8e26-4857-bc56-1d5a04e7f752',clientId='308a0f73-9f9a-4622-8d26-c6c17198a20c';
const user={id:'22222222-2222-4222-8222-222222222222',displayName:'Example Employee',mail:'employee@example.test',userPrincipalName:'employee@example.test',accountEnabled:true,userType:'Member'};
test('Entra directory follows bounded Graph pages, excludes guests/disabled users and verifies exact identity',async()=>{
 let tokens=0,reads=0;
 const directory=new EntraDirectory({tenantId,clientId,clientSecret:'test',fetch:async(input,init)=>{
 const url=new URL(String(input));assert.equal(init?.redirect,'error');if(url.host==='login.microsoftonline.com'){tokens++;return Response.json({access_token:'test-token',expires_in:3600});}reads++;assert.equal(url.host,'graph.microsoft.com');
 if(url.pathname.includes(user.id))return Response.json(user);
 return Response.json({value:[user,{...user,id:'33333333-3333-4333-8333-333333333333',accountEnabled:false},{...user,id:'44444444-4444-4444-8444-444444444444',userType:'Guest'}]});
 }});assert.deepEqual(await directory.list(),[user]);assert.equal((await directory.verify(user.id)).id,user.id);assert.equal(tokens,1);assert.equal(reads,2);await assert.rejects(directory.verify('../users'));
});
test('Entra permission denial and unsafe pagination never return a partial directory or forward credentials',async()=>{
 for(const response of [new Response('{}',{status:403}),Response.json({value:[user],'@odata.nextLink':'https://attacker.example/users'})]){
 let calls=0;const directory=new EntraDirectory({tenantId,clientId,clientSecret:'test',fetch:async input=>{calls++;return String(input).includes('login.microsoftonline.com')?Response.json({access_token:'secret-token',expires_in:3600}):response;}});await assert.rejects(directory.list());assert.equal(calls,2);
 }
});
const native=(fetcher:typeof fetch)=>new AutotaskDirectory({tenantId,baseUrl:'https://webservices5.autotask.net/atservicesrest/v1.0/',username:'test',secret:'test',integrationCode:'test',budget:new FixtureUnlimitedRequestBudget(),fetch:fetcher});
test('all-client scope resolves complete current IDs including zero, while scoped users do not trigger a directory read',async()=>{
 let reads=0;const directory=native(async()=>{reads++;return Response.json({items:[{id:0},{id:10},{id:20}],pageDetails:{nextPageUrl:null}});});const p={...fixturePrincipals()[0]!,tenantId};assert.equal(await directory.scope(p),p);assert.equal(reads,0);
 const expanded=await directory.scope({...p,allCompanies:true,companyIds:[]});assert.deepEqual(expanded.companyIds,[0,10,20]);await directory.scope({...p,allCompanies:true});assert.equal(reads,1);
 await assert.rejects(reauthorize(expanded,{get:async()=>({...expanded,allCompanies:false})}),{code:'forbidden'});
});
test('native directory rejects foreign continuations and exposes only active employee choice fields',async()=>{
 let calls=0;const broken=native(async()=>{calls++;return Response.json({items:[{id:1}],pageDetails:{nextPageUrl:'https://attacker.example/query/nextPage'}});});await assert.rejects(broken.resources(`${tenantId}:admin`));assert.equal(calls,1);
 const directory=native(async()=>Response.json({items:[{id:1,firstName:'Example',lastName:'Employee',email:'employee@example.test',isActive:true,secret:'private'},{id:2,isActive:false}],pageDetails:{nextPageUrl:null}}));assert.deepEqual(await directory.resources(`${tenantId}:admin`),[{id:1,displayName:'Example Employee',email:'employee@example.test'}]);
});
test('multi-resource verification requires a complete unique batch and preserves inactive state',()=>{
 assert.deepEqual(allResourceObservations({items:[{id:17,isActive:true},{id:18,isActive:false}],pageDetails:{nextPageUrl:null}}),[{id:17,isActive:true},{id:18,isActive:false}]);
 for(const value of [{items:[{id:17,isActive:true}],pageDetails:{nextPageUrl:'next'}},{items:[{id:17,isActive:true},{id:17,isActive:true}],pageDetails:{nextPageUrl:null}}])assert.throws(()=>allResourceObservations(value));
});

test('directory routes require administrator access and revalidate Entra identity before activation',async t=>{
 const {createFixtureSystem}=await import('../apps/server/src/fixture-system.js'),{createAdminRoutes}=await import('../apps/server/src/admin.js');const s=createFixtureSystem();t.after(()=>s.app.close());let reads=0,verifications=0;
 const routes=createAdminRoutes({sessions:s.sessions,control:s.control,publicUrl:'http://127.0.0.1:3030',principal:async()=>s.principals[0]!,recover:async()=>({}),onboarding:{entra:{list:async()=>{reads++;return[user];},verify:async()=>{verifications++;throw new Error('disabled');}} as any,autotask:{resources:async()=>[],companyChoices:async()=>{reads++;return[{id:10,name:"Example Architects"}];}} as any}});
 async function login(index:number){const response=await routes.fetch(new Request('http://127.0.0.1:3030/admin/auth/fixture',{method:'POST',headers:{origin:'http://127.0.0.1:3030','content-type':'application/json'},body:JSON.stringify({token:s.tokens[index]!.token})}));const body=await response!.json();return{cookie:response!.headers.getSetCookie()[0]!.split(';')[0]!,csrf:body.csrf};}
 const reader=await login(1);assert.equal((await routes.fetch(new Request('http://127.0.0.1:3030/admin/api/directory/users',{headers:{cookie:reader.cookie}})))!.status,403);assert.equal(reads,0);
 assert.equal((await routes.fetch(new Request('http://127.0.0.1:3030/admin/api/directory/companies',{headers:{cookie:reader.cookie}})))!.status,403);assert.equal(reads,0);
 const admin=await login(0);assert.equal((await routes.fetch(new Request('http://127.0.0.1:3030/admin/api/directory/users',{headers:{cookie:admin.cookie}})))!.status,200);assert.equal(reads,1);
 const companies=await routes.fetch(new Request('http://127.0.0.1:3030/admin/api/directory/companies',{headers:{cookie:admin.cookie}}));assert.equal(companies!.status,200);assert.deepEqual((await companies!.json()).items,[{id:10,name:'Example Architects'}]);
 const response=await routes.fetch(new Request('http://127.0.0.1:3030/admin/api/members',{method:'POST',headers:{cookie:admin.cookie,origin:'http://127.0.0.1:3030','content-type':'application/json','x-csrf-token':admin.csrf},body:JSON.stringify({expectedVersion:0,member:{objectId:user.id,resourceId:103,active:true,allCompanies:true,companyIds:[],capabilities:['operational.read']}})}));assert.equal(response!.status,503);assert.equal(verifications,1);assert.equal(await s.control.store.getMember({tenantId:s.principals[0]!.tenantId,objectId:user.id}),undefined);
});

test('all-client flag persists through SQL without altering legacy explicit scopes',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),{readFile}=await import('node:fs/promises'),{REQUIRED_MIGRATIONS}=await import('../scripts/preflight.js'),{PostgresControlPlaneStore}=await import('../packages/control-plane/src/postgres.js');const db=new PGlite();try{for(const file of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));const store=new PostgresControlPlaneStore(db),p={...fixturePrincipals()[0]!,allCompanies:true,companyIds:[],mappingVersion:1};await store.saveMember(p,p,0,new Date().toISOString());assert.equal((await store.getMember(p))!.allCompanies,true);await store.saveMember(p,{...p,allCompanies:false,companyIds:[10],mappingVersion:2},1,new Date().toISOString());assert.deepEqual((await store.getMember(p))!.companyIds,[10]);assert.equal((await store.getMember(p))!.allCompanies,false);}finally{await db.close();}
});

test('company picker returns only named choices and fails on incomplete or nameless results',async()=>{
 const directory=native(async input=>{const search=JSON.parse(new URL(String(input)).searchParams.get('search')!);assert.deepEqual(search.IncludeFields,['id','companyName']);return Response.json({items:[{id:20,companyName:'Zebra',secret:'hidden'},{id:0,companyName:'Internal'},{id:10,companyName:'Alpha'}],pageDetails:{nextPageUrl:null}});});
 assert.deepEqual(await directory.companyChoices('admin'),[{id:10,name:'Alpha'},{id:0,name:'Internal'},{id:20,name:'Zebra'}]);
 await assert.rejects(native(async()=>Response.json({items:[{id:10}],pageDetails:{nextPageUrl:null}})).companyChoices('admin'));
});

test('permission templates persist all-client scope and can return to explicit companies',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),{readFile}=await import('node:fs/promises'),{REQUIRED_MIGRATIONS}=await import('../scripts/preflight.js'),{PostgresControlPlaneStore}=await import('../packages/control-plane/src/postgres.js');const db=new PGlite();
 try{for(const file of REQUIRED_MIGRATIONS)await db.exec(await readFile(`packages/storage/migrations/${file}`,'utf8'));const store=new PostgresControlPlaneStore(db),actor=fixturePrincipals()[0]!,template={tenantId:actor.tenantId,key:'all-clients',version:1,capabilities:actor.capabilities,companyIds:[],allCompanies:true};await store.saveTemplate(actor,template,0,new Date().toISOString());assert.equal((await store.listTemplates(actor.tenantId))[0]!.allCompanies,true);await store.saveTemplate(actor,{...template,version:2,allCompanies:false,companyIds:[0,10]},1,new Date().toISOString());const saved=(await store.listTemplates(actor.tenantId))[0]!;assert.equal(saved.allCompanies,false);assert.deepEqual(saved.companyIds,[0,10]);}finally{await db.close();}
});
