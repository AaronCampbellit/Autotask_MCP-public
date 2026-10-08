import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { AdminSessions } from '../packages/identity/src/admin-session.js';
const tenant = '00000000-0000-4000-8000-000000000001', client = '00000000-0000-4000-8000-000000000002', oid = '00000000-0000-4000-8000-000000000003';
const cookie = (value: string) => value.split(';')[0]!;
test('fixture console sessions keep tokens off the client and require same-origin CSRF for every mutation', async () => {
  let now = Date.now();
  const auth = new AdminSessions({ publicUrl:'http://127.0.0.1:3030',now:()=>now,fixtureAuthenticate:async token=>{assert.equal(token,'fixture-token');return{tenantId:tenant,objectId:oid};} });
  await assert.rejects(auth.fixtureLogin(new Request('http://127.0.0.1:3030/admin/auth/fixture',{method:'POST',headers:{origin:'https://evil.invalid'}}),'fixture-token'));
  const login=await auth.fixtureLogin(new Request('http://127.0.0.1:3030/admin/auth/fixture',{method:'POST',headers:{origin:'http://127.0.0.1:3030'}}),'fixture-token');
  assert.match(login.cookie,/HttpOnly; SameSite=Lax/);assert.ok(!JSON.stringify(login).includes('fixture-token'));
  const request=new Request('http://127.0.0.1:3030/admin/api/controls',{method:'POST',headers:{cookie:cookie(login.cookie),origin:'http://127.0.0.1:3030','x-csrf-token':login.session.csrf}});
  assert.equal(auth.session(request,true).actor.objectId,oid);
  assert.throws(()=>auth.session(new Request(request,{headers:{cookie:cookie(login.cookie),origin:'https://evil.invalid','x-csrf-token':login.session.csrf}}),true),{code:'forbidden'});
  assert.throws(()=>auth.session(new Request(request,{headers:{cookie:cookie(login.cookie),origin:'http://127.0.0.1:3030'}}),true),{code:'forbidden'});
  now+=3_600_001;assert.throws(()=>auth.session(request),{code:'unauthenticated'});auth.close();
});
test('Entra console code flow validates PKCE/state/nonce/issuer/audience and consumes each login once', async () => {
  const {privateKey,publicKey}=await generateKeyPair('RS256');let nonce='',verifier='';let requests=0;
  const auth=new AdminSessions({publicUrl:'https://mcp.example.invalid',entra:{tenantId:tenant,clientId:client,clientSecret:'PRIVATE_CLIENT_SECRET',keys:async()=>publicKey},fetch:async (input,init)=>{
    requests++;assert.equal(String(input),`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`);assert.equal(init?.redirect,'error');
    const form=new URLSearchParams(init?.body as URLSearchParams);verifier=form.get('code_verifier')!;assert.equal(form.get('client_secret'),'PRIVATE_CLIENT_SECRET');
    const id_token=await new SignJWT({tid:tenant,oid,nonce}).setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(client).setSubject('employee-subject').setIssuedAt().setExpirationTime('10m').sign(privateKey);
    return Response.json({id_token});
  }});
  const login=auth.beginLogin(),url=new URL(login.location);nonce=url.searchParams.get('nonce')!;
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(login.cookie,/Secure/);assert.ok(!login.location.includes('PRIVATE_CLIENT_SECRET'));
  const callback=new Request(`https://mcp.example.invalid/admin/callback?code=synthetic-code&state=${url.searchParams.get('state')}`,{headers:{cookie:cookie(login.cookie)}});
  await assert.rejects(auth.callback(new Request(callback,{headers:{}})),{code:'unauthenticated'});assert.equal(requests,0);
  const issued=await auth.callback(callback);assert.equal(issued.session.actor.objectId,oid);assert.equal(verifier.length,43);
  assert.ok(!JSON.stringify(issued).includes('PRIVATE_CLIENT_SECRET'));assert.ok(!JSON.stringify(issued).includes('id_token'));
  await assert.rejects(auth.callback(callback),{code:'unauthenticated'});assert.equal(requests,1);auth.close();
});
test('Entra console refuses mismatched nonce and token audience without exposing the token', async () => {
  for(const mode of ['nonce','audience']){
    const {privateKey,publicKey}=await generateKeyPair('RS256');let nonce='';
    const auth=new AdminSessions({publicUrl:'https://mcp.example.invalid',entra:{tenantId:tenant,clientId:client,clientSecret:'PRIVATE',keys:async()=>publicKey},fetch:async()=>Response.json({id_token:await new SignJWT({tid:tenant,oid,nonce:mode==='nonce'?'incorrect':nonce}).setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(mode==='audience'?'wrong-client':client).setSubject('subject').setIssuedAt().setExpirationTime('10m').sign(privateKey)})});
    const login=auth.beginLogin(),url=new URL(login.location);nonce=url.searchParams.get('nonce')!;
    await assert.rejects(auth.callback(new Request(`https://mcp.example.invalid/admin/callback?code=fake&state=${url.searchParams.get('state')}`,{headers:{cookie:cookie(login.cookie)}})),{code:'unauthenticated',message:'Sign in to the operator console.'});auth.close();
  }
});


test('abandoned logins and invalid callbacks cannot exhaust another browser sign-in', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const nonces = new Map<string, string>();
  let requests = 0;
  const auth = new AdminSessions({ publicUrl: 'https://mcp.example.invalid',
    entra: { tenantId: tenant, clientId: client, clientSecret: 'PRIVATE', keys: async () => publicKey },
    fetch: async (_input, init) => {
      requests++;
      const form = new URLSearchParams(init?.body as URLSearchParams);
      if (form.get('code') !== 'valid-code') return new Response('', { status: 400 });
      const challenge = createHash('sha256').update(form.get('code_verifier')!).digest('base64url');
      const nonce = nonces.get(challenge); assert.ok(nonce, 'PKCE must match a started flow');
      return Response.json({ id_token: await new SignJWT({ tid: tenant, oid, nonce })
        .setProtectedHeader({ alg: 'RS256' }).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
        .setAudience(client).setSubject('employee').setIssuedAt().setExpirationTime('10m').sign(privateKey) });
    } });
  const start = () => {
    const login = auth.beginLogin(), url = new URL(login.location);
    nonces.set(url.searchParams.get('code_challenge')!, url.searchParams.get('nonce')!);
    const callback = (code = 'valid-code') => new Request(`https://mcp.example.invalid/admin/callback?code=${code}&state=${url.searchParams.get('state')}`, { headers: { cookie: cookie(login.cookie) } });
    return { login, url, callback };
  };
  const honest = start();
  assert.ok(honest.login.cookie.length < 1024);
  assert.ok(!honest.login.cookie.includes(honest.url.searchParams.get('state')!));
  assert.ok(!honest.login.cookie.includes(honest.url.searchParams.get('nonce')!));
  for (let i = 0; i < 1200; i++) auth.beginLogin();
  for (let i = 0; i < 550; i++) {
    const invalid = start();
    await assert.rejects(auth.callback(invalid.callback('invalid-code')), { code: 'unauthenticated' });
  }
  const before = requests;
  const other = start();
  await assert.rejects(auth.callback(new Request(honest.callback(), { headers: { cookie: cookie(other.login.cookie) } })), { code: 'unauthenticated' });
  const tampered = cookie(honest.login.cookie).slice(0, -8) + 'AAAAAAAA';
  await assert.rejects(auth.callback(new Request(honest.callback(), { headers: { cookie: tampered } })), { code: 'unauthenticated' });
  await assert.rejects(auth.callback(new Request(honest.callback(), { headers: { cookie: '__Host-rarity-login=' + 'x'.repeat(2048) } })), { code: 'unauthenticated' });
  assert.equal(requests, before, 'invalid envelopes must not reach the provider');
  const results = await Promise.allSettled([auth.callback(honest.callback()), auth.callback(honest.callback())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const replayCount = requests;
  await assert.rejects(auth.callback(honest.callback()), { code: 'unauthenticated' });
  assert.equal(requests, replayCount);
  // A failed exchange admits no state globally; provider-validated one-use code
  // authentication may retry this still-valid, sealed browser transaction.
  const retry = start();
  await assert.rejects(auth.callback(retry.callback('invalid-code')), { code: 'unauthenticated' });
  assert.equal((await auth.callback(retry.callback())).session.actor.objectId, oid);
  auth.close();
});

test('login expiry and close invalidate sealed transactions across awaited verification', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  for (const scenario of ['expired-before', 'expired-during', 'closed-before', 'closed-during']) {
    let now = Date.now(), nonce = '', requests = 0;
    const auth = new AdminSessions({ publicUrl: 'https://mcp.example.invalid', now: () => now,
      entra: { tenantId: tenant, clientId: client, clientSecret: 'PRIVATE', keys: async () => publicKey },
      fetch: async () => {
        requests++;
        if (scenario === 'expired-during') now += 600001;
        if (scenario === 'closed-during') auth.close();
        return Response.json({ id_token: await new SignJWT({ tid: tenant, oid, nonce })
          .setProtectedHeader({ alg: 'RS256' }).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
          .setAudience(client).setSubject('employee').setIssuedAt(Math.floor(now / 1000))
          .setExpirationTime(Math.floor(now / 1000) + 600).sign(privateKey) });
      } });
    const login = auth.beginLogin(), url = new URL(login.location); nonce = url.searchParams.get('nonce')!;
    if (scenario === 'expired-before') now += 600001;
    if (scenario === 'closed-before') auth.close();
    const callback = new Request(`https://mcp.example.invalid/admin/callback?code=valid&state=${url.searchParams.get('state')}`, { headers: { cookie: cookie(login.cookie) } });
    await assert.rejects(auth.callback(callback), { code: 'unauthenticated' });
    assert.equal(requests, scenario.endsWith('before') ? 0 : 1);
    auth.close();
    assert.throws(() => auth.beginLogin(), { code: 'unauthenticated' });
  }
});
