/** Local fixture measurements through the real Node HTTP ingress. No live provider requests. */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createFixtureSystem } from '../apps/server/src/fixture-system.js';
import { createNodeHandler } from '../apps/server/src/ingress.js';
import { DurableReadWorker } from '../packages/durable-read-jobs/src/index.js';
import { SERVER_RELEASE } from '../apps/server/src/publication.js';
export const protocols = ['2025-11-25', '2026-07-28'] as const;
export async function fixtureHttp() {
  let handler: ReturnType<typeof createNodeHandler>;
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing bound address');
  const base = `http://127.0.0.1:${address.port}`, system = createFixtureSystem(base);
  handler = createNodeHandler(system.app);
  let id = 0;
  return { base, system, async call(protocol: string, method: string, params: Record<string, unknown> = {}, overrides: Record<string, string | null> = {}) {
    const modern = protocol === '2026-07-28';
    const headers = new Headers({ authorization: `Bearer ${system.tokens[0]!.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': protocol });
    if (modern) { headers.set('mcp-method', method); if (typeof params.name === 'string') headers.set('mcp-name', params.name); }
    for (const [key, value] of Object.entries(overrides)) value === null ? headers.delete(key) : headers.set(key, value);
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: { ...params, ...(modern ? { _meta: { 'io.modelcontextprotocol/protocolVersion': protocol, 'io.modelcontextprotocol/clientInfo': { name: 'project2-fixture', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } : {}) } });
    const before = system.adapter.calls.length, started = performance.now();
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers, body });
    const text = await response.text(), elapsed_ms = performance.now() - started;
    const data = text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
    const rpc = data.length ? data.at(-1) : text ? JSON.parse(text) : undefined;
    return { status: response.status, rpc, elapsed_ms, request_bytes: Buffer.byteLength(body), response_bytes: Buffer.byteLength(text), fixture_autotask_calls: system.adapter.calls.length - before, fixture_autotask_sequence: system.adapter.calls.slice(before).map(({entity,kind})=>({entity,kind})) };
  }, async close() { await system.worker.close(); await system.app.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
const scenarios: {name:string;method:string;params:Record<string,unknown>}[] = [
  { name: 'discovery', method: 'tools/list', params: {} },
  { name: 'ticket_context_exact_id', method: 'tools/call', params: { name: 'ticket_context', arguments: { ticket: { kind: 'id', id: 1001 }, purpose: 'custom', collections: ['notes', 'time'] } } },
  { name: 'ticket_lookup_text', method: 'tools/call', params: { name: 'ticket_search', arguments: { text: 'printer' } } },
  { name: 'current_user_workday', method: 'tools/call', params: { name: 'my_workday', arguments: { date: '2026-09-10', timezone: 'America/Chicago' } } }
];
scenarios.push({name:'rmm_ticket_context',method:'tools/call',params:{name:'rmm_ticket_context',arguments:{ticket:{kind:'id',id:1001}}}}, {name:'report_retrieval',method:'tools/call',params:{}}, {name:'fixture_ticket_note_write',method:'tools/call',params:{}});
const percentile = (values: number[], p: number) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*p)-1)]!;
export async function benchmark(iterations = 10) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('Iterations must be an integer from 1 to 1000');
  const results = [];
  for (const protocol of protocols) for (const scenario of scenarios) {
    const fixture = await fixtureHttp();
    try {
      let params=scenario.params; let rmmCalls=0;
      const s=fixture.system;
      if(scenario.name==='rmm_ticket_context'){
        const old=s.principals[0]!,p={...old,capabilities:[...old.capabilities,'rmm.read' as const],mappingVersion:old.mappingVersion+1};
        await s.controlStore.saveMember(old,p,old.mappingVersion,new Date().toISOString());
        const r=s.runtime.options.rmm!;
        await r.configure(p,{version:0,platform:'zinfandel',key:'fixture-key',secret:'fixture-secret',enabled:false,jobs_enabled:false});await r.test(p);await r.configure(p,{version:2,platform:'zinfandel',enabled:true,jobs_enabled:false});await r.mapSite(p,{version:3,site_uid:'example-site',enabled:true});
        s.adapter.records.Tickets.find(v=>v.id===1001)!.configurationItemID=6301;
        s.technicianPort.records.assets.find(v=>v.id===6301)!.rmmDeviceUID='example-device';
        const original=r.port.request.bind(r.port);r.port.request=async(...args)=>{rmmCalls++;if(args[1]==='/v2/device/example-device/alerts/open'){await args[4]?.();return{alerts:[],pageDetails:{nextPageUrl:null}};}return original(...args);};
      }
      if(scenario.name==='report_retrieval'){
        const started=await fixture.call(protocol,'tools/call',{name:'client_health_report_start',arguments:{company_id:10,sections:['tickets'],request_key:'benchmark-report'}});
        const reportId=started.rpc?.result?.structuredContent?.report_id;if(!reportId)throw new Error(JSON.stringify(started.rpc));
        const worker=new DurableReadWorker(s.runtime.options.reports!);await worker.tick();await worker.close();
        params={name:'read_report_result',arguments:{report_id:reportId}};
      }
      const samples = [];
      for (let i = 0; i <= iterations; i++) {
        if(scenario.name==='fixture_ticket_note_write')params={name:'ticket_note_add',arguments:{ticket:{kind:'id',id:1001},note:{title:'Benchmark fixture',text:'Fictitious internal benchmark note.',audience:'internal'},request_key:`benchmark-note-${i}`}};
        const beforeRmm=rmmCalls;
        const result = await fixture.call(protocol, scenario.method, params);
        const output=result.rpc?.result?.structuredContent;
        if(scenario.name==='rmm_ticket_context'&&output?.data?.link_state!=='verified')throw new Error(`Unverified RMM context: ${JSON.stringify(output)}`);
        if(scenario.name==='report_retrieval'&&(output?.state!=='completed'||!output.data))throw new Error(`Incomplete report: ${JSON.stringify(output)}`);
        if(scenario.name==='fixture_ticket_note_write'&&output?.status!=='succeeded_verified')throw new Error(`Unverified note: ${JSON.stringify(output)}`);
        if (result.status !== 200 || result.rpc?.error || result.rpc?.result?.isError) throw new Error(`Scenario ${scenario.name} failed: ${JSON.stringify(result.rpc)}`);
        const { rpc, ...metrics } = result; samples.push({...metrics,fixture_rmm_calls:rmmCalls-beforeRmm});
      }
      const [cold, ...warm] = samples, latency = warm.map(s => s.elapsed_ms);
      results.push({ protocol, scenario: scenario.name, historical_baseline: !['rmm_ticket_context','report_retrieval','fixture_ticket_note_write'].includes(scenario.name), cold, warm: { samples: warm, p50_ms: percentile(latency,.5), p95_ms: percentile(latency,.95), p99_ms: percentile(latency,.99) } });
    } finally { await fixture.close(); }
  }
  return { schema_version: 1, measured_at: new Date().toISOString(), release: SERVER_RELEASE, node: process.version, mode: 'local_fixture_real_http', iterations, limitations: ['Cold means first request on a fresh fixture, not a fresh Node process.', 'Fixture adapter calls are not native HTTP attempts; other fixture ports are not counted.', 'No live provider, model-turn or actual ChatGPT/Codex measurements.', 'Report creation/execution and RMM setup are excluded from timed retrieval; all provider ports are fixtures. RMM port calls are counted for its context scenario.', 'New RMM/report/write scenarios have no historical before baseline. Each note write uses a fresh request key; the adapter sequence records preflight, dispatch and readback.', 'Completeness assertions belong to scenario regression tests; latency alone does not establish correctness.'], host_matrix: [{ host: 'local direct HTTP harness', protocols, tested: ['discovery', 'structured tool output'] }, { host: 'ChatGPT', status: 'not_measured' }, { host: 'Codex', status: 'not_measured' }], results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  benchmark(Number(process.argv[2] ?? 10)).then(result => process.stdout.write(`${JSON.stringify(result,null,2)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode=1; });
}
