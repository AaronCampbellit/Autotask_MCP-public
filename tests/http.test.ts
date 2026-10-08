import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as nodeRequest } from 'node:http';
import { once } from 'node:events';
import { createApplication, MAX_RESPONSE_BYTES } from '../apps/server/src/app.js';
import { createNodeHandler } from '../apps/server/src/ingress.js';
import { AppError } from '../packages/contracts/src/index.js';
import { MemoryJournal, MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { reauthorize } from '../packages/policy/src/index.js';
import { FixtureAutotaskAdapter, fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { TicketWorkflows } from '../packages/workflows/src/index.js';
const base = 'http://127.0.0.1:3030';
function setup(maxConcurrent?: number) {
  const principals = fixturePrincipals(), store = new MemoryPrincipalStore(principals);
  const adapter = new FixtureAutotaskAdapter(p => reauthorize(p, store));
  const workflows = new TicketWorkflows(adapter, store, new MemoryJournal());
  const app = createApplication({ publicUrl: base, maxConcurrent, workflows, authenticate: async token => {
    const p = token === 'technician' ? principals[0] : token === 'reader' ? principals[1] : undefined;
    if (!p) throw new AppError('unauthenticated', 'Invalid token.');
    return reauthorize(p, store);
  }});
  return { app, principals, store, adapter, workflows };
}
function req(body: unknown, token = 'technician', headers: Record<string, string> = {}) {
  return new Request(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers }, body: JSON.stringify(body) });
}
async function jsonRpc(response: Response) {
  const text = await response.text();
  if (text.startsWith('event:') || text.startsWith('data:')) return JSON.parse(text.split('\n').find(line => line.startsWith('data:'))!.slice(5));
  return JSON.parse(text);
}
test('HTTP health, authentication challenge, host/origin, body limit and allowed methods', async () => {
  const { app } = setup();
  assert.equal((await app.fetch(new Request(`${base}/health/live`))).status, 200);
  const denied = await app.fetch(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'bad'));
  assert.equal(denied.status, 401); assert.match(denied.headers.get('www-authenticate')!, /resource_metadata/);
  assert.equal((await app.fetch(req({}, 'technician', { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await app.fetch(new Request('http://evil.example/health/live'))).status, 403);
  assert.equal((await app.fetch(req({ huge: 'x'.repeat(70000) }))).status, 400);
  assert.equal((await app.fetch(new Request(`${base}/mcp`))).status, 405);
  await app.close();
});
test('legacy MCP lists tools per employee and returns structured authorized context', async () => {
  const s = setup();
  const list = await jsonRpc(await s.app.fetch(req({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })));
  assert.ok(list.result.tools.some((tool: any) => tool.name === 'ticket_update'));
  const reader = await jsonRpc(await s.app.fetch(req({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 'reader')));
  assert.ok(!reader.result.tools.some((tool: any) => tool.name === 'ticket_update'));
  const context = await jsonRpc(await s.app.fetch(req({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ticket_context', arguments: { ticket: { kind: 'id', id: 1001 }, purpose: 'custom', collections: ['notes', 'time'] } } })));
  assert.equal(context.result.structuredContent.data.collections.notes.returned, 105);
  const hidden = await jsonRpc(await s.app.fetch(req({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ticket_update', arguments: {} } }, 'reader')));
  assert.ok(hidden.error || hidden.result?.isError); assert.equal(s.adapter.calls.filter(c => c.kind === 'patch').length, 0);
  await s.app.close();
});
test('modern 2026-07-28 envelope succeeds and unsupported revision is rejected', async () => {
  const s = setup();
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'fixture-test', version: '1.0' }, 'io.modelcontextprotocol/clientCapabilities': {} } } };
  const response = await s.app.fetch(req(body, 'technician', { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }));
  const result = await jsonRpc(response);
  assert.ok(result.result?.tools, JSON.stringify(result));
  body.params._meta['io.modelcontextprotocol/protocolVersion'] = '2099-01-01';
  const unsupported = await jsonRpc(await s.app.fetch(req(body, 'technician', { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' })));
  assert.ok(unsupported.error, JSON.stringify(unsupported));
  await s.app.close();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('console sign-in and bootstrap remain available while admin API slots are saturated', async () => {
  const s = setup(), entered = deferred(), release = deferred(); let blocked = 0;
  const admin = { close() {}, async fetch(request: Request) {
    if (new URL(request.url).pathname === '/admin/api/slow') { if (++blocked === 8) entered.resolve(); await release.promise; }
    return new Response('ok');
  }};
  const app = createApplication({ publicUrl: base, workflows: s.workflows, authenticate: async () => s.principals[0]!, admin: admin as any });
  const get = (path: string) => app.fetch(new Request(`${base}${path}`));
  const pending = Array.from({ length: 8 }, () => get('/admin/api/slow'));
  try {
    await entered.promise;
    for (const path of ['/admin/callback', '/admin/', '/admin/auth/config', '/admin/api/session', '/admin/api/snapshot'])
      assert.equal((await get(path)).status, 200, `${path} should have reserved console capacity`);
    assert.equal((await get('/admin/api/slow')).status, 429, 'the ordinary admin API remains bounded');
  } finally { release.resolve(); await Promise.all(pending); await app.close(); await s.app.close(); }
});

test('legacy SSE retains global admission until the tool completes, then releases it', async () => {
  const s = setup(1), entered = deferred(), release = deferred();
  const original = s.workflows.whoami.bind(s.workflows);
  s.workflows.whoami = async p => { entered.resolve(); await release.promise; return original(p); };
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'at_whoami', arguments: {} } };
  const first = s.app.fetch(req(call));
  try {
    await entered.promise;
    assert.equal((await s.app.fetch(req({ ...call, id: 2 }))).status, 429);
    release.resolve();
    assert.equal((await jsonRpc(await first)).result.isError, undefined);
    assert.equal((await s.app.fetch(req({ ...call, id: 3 }))).status, 200);
  } finally { release.resolve(); await first; await s.app.close(); }
});

test('global admission also bounds pending authentication before body ingestion', async () => {
  const s = setup(), entered = deferred(), release = deferred(); let authentications = 0;
  const app = createApplication({ publicUrl: base, maxConcurrent: 1, workflows: s.workflows, authenticate: async () => {
    authentications++; entered.resolve(); await release.promise; return s.principals[0]!;
  } });
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const first = app.fetch(req(call));
  try {
    await entered.promise;
    assert.equal((await app.fetch(req({ ...call, id: 2 }))).status, 429);
    assert.equal(authentications, 1);
    release.resolve(); assert.equal((await first).status, 200);
  } finally { release.resolve(); await first; await app.close(); await s.app.close(); }
});

test('an aborted incomplete body releases admission without waiting for upload completion', async () => {
  const s = setup(1), abort = new AbortController();
  const request = new Request(`${base}/mcp`, { method: 'POST', headers: { authorization: 'Bearer technician', 'content-type': 'application/json' }, body: new ReadableStream<Uint8Array>(), signal: abort.signal, duplex: 'half' } as RequestInit);
  const pending = s.app.fetch(request);
  abort.abort();
  try {
    const response = await pending;
    assert.equal(response.status, 400); assert.match((await response.json()).error.message, /cancelled/);
    assert.equal((await s.app.fetch(req({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }))).status, 200);
  } finally { await s.app.close(); }
});

test('legacy SSE retains the per-employee limit while another employee remains eligible', async () => {
  const s = setup(10), entered = deferred(), release = deferred(); let calls = 0;
  const original = s.workflows.whoami.bind(s.workflows);
  s.workflows.whoami = async p => { if (++calls === 4) entered.resolve(); await release.promise; return original(p); };
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'at_whoami', arguments: {} } };
  const pending = Array.from({ length: 4 }, (_, i) => s.app.fetch(req({ ...call, id: i + 1 })));
  try {
    await entered.promise;
    assert.equal((await s.app.fetch(req({ ...call, id: 5 }))).status, 429);
    const other = s.app.fetch(req({ ...call, id: 6 }, 'reader')); pending.push(other);
    release.resolve();
    assert.equal((await other).status, 200);
  } finally { release.resolve(); await Promise.all(pending); await s.app.close(); }
});

test('oversized streamed SDK output fails the stream instead of completing truncated success', async () => {
  const s = setup();
  const originalWhoami=s.workflows.whoami.bind(s.workflows);
  s.workflows.whoami = async p => ({...await originalWhoami(p),warnings:['x'.repeat(MAX_RESPONSE_BYTES)]});
  try {
    const response = await s.app.fetch(req({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'at_whoami', arguments: {} } }));
    assert.equal(response.status, 200);
    await assert.rejects(()=>response.text(),/bounded stream limit/);
  } finally { await s.app.close(); }
});

test('real Node HTTP ingress rejects oversized chunked uploads before their end', { timeout: 10_000 }, async t => {
  const s = setup(), server = createServer(createNodeHandler(s.app));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const testPort = address.port;
  t.after(async () => { await s.app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function incompleteUpload(extraHeaders: Record<string, string>, bytes: number) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const client = nodeRequest({ hostname: '127.0.0.1', port: testPort, path: '/mcp', method: 'POST', headers: {
        host: '127.0.0.1:3030', authorization: 'Bearer technician', 'content-type': 'application/json', 'transfer-encoding': 'chunked', ...extraHeaders,
      } });
      const timeout = setTimeout(() => { client.destroy(); reject(new Error('Ingress waited for upload completion instead of enforcing its boundary.')); }, 3000);
      client.on('error', error => { clearTimeout(timeout); reject(error); });
      client.on('response', response => {
        let body = '';
        response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
        response.on('end', () => { clearTimeout(timeout); resolve({ status: response.statusCode!, body }); client.destroy(); });
      });
      client.flushHeaders();
      if (bytes) client.write(Buffer.alloc(bytes, ' '));
      // Intentionally no end(): the server must respond before buffering the entire upload.
    });
  }
  const oversized = await incompleteUpload({}, 70_000);
  assert.equal(oversized.status, 400); assert.match(oversized.body, /too large/);
  const unauthenticated = await incompleteUpload({ authorization: 'Bearer invalid' }, 0);
  assert.equal(unauthenticated.status, 401);
  assert.equal(s.adapter.calls.length, 0);
});

test('real Node HTTP ingress rejects oversized Content-Length without reading the declared body', { timeout: 10_000 }, async t => {
  const s = setup(), server = createServer(createNodeHandler(s.app));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await s.app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = nodeRequest({ hostname: '127.0.0.1', port: address.port, path: '/mcp', method: 'POST', headers: {
      host: '127.0.0.1:3030', authorization: 'Bearer technician', 'content-type': 'application/json', 'content-length': '10000000',
    } });
    const timeout = setTimeout(() => { client.destroy(); reject(new Error('Ingress waited for the declared body.')); }, 3000);
    client.on('error', error => { clearTimeout(timeout); reject(error); });
    client.on('response', result => {
      let body = ''; result.setEncoding('utf8'); result.on('data', chunk => { body += chunk; });
      result.on('end', () => { clearTimeout(timeout); resolve({ status: result.statusCode!, body }); client.destroy(); });
    });
    client.flushHeaders();
  });
  assert.equal(response.status, 400); assert.match(response.body, /too large/);
  assert.equal(s.adapter.calls.length, 0);
});
