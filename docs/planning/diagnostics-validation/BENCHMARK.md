# Local diagnostics benchmark

Run `npx tsx scripts/diagnostics-benchmark.ts 30` from the repository root. Results are in `local-benchmark.json`. The script executes 270 measured MCP requests (plus five successful warmups per condition excluded from latency and storage totals) over actual local HTTP sockets: diagnostics disabled, in-memory diagnostic database, and simulated database outage with encrypted spool file/directory fsync, each at concurrency 1, 4 and 20. Each tool performs an actual HTTP request to a local provider simulator with a scheduled 5 ms delay.

The final run used protocol `2025-11-25`, five warmups, and the immutable metadata cache. Root and both other agents paused heavy tests, and no test/TypeScript process was present at start. This replaces the earlier run that overlapped other tests.

The recorded run measured these approximate p95 latencies:

| Concurrent requests | Disabled | Memory database | Fsync fallback |
| --- | ---: | ---: | ---: |
| 1 | 16 ms | 20 ms | 219 ms |
| 4 | 43 ms | 39 ms | 1,421 ms |
| 20 | 100 ms | 88 ms | 2,416 ms |

At concurrency 1 and 4 all 30 requests per condition succeeded. At concurrency 20 the four-per-actor admission limit rejected excess requests: only 9, 9 and 4 requests succeeded respectively. Aggregate percentiles at concurrency 20 mix successful and rejected requests; the JSON separately records successful-call percentiles and throughput. Do not use rejection latency as a successful-tool performance claim.

Observed diagnostic storage was approximately 4.3 KB/request of serialized in-memory events, versus 6.1 KB/request of encrypted fallback spool frames at admitted concurrency. Console query timing ranged from approximately 2–18 ms for memory storage to 137–149 ms for fallback storage at concurrency 1/4. These calls exercise the authorized service, excluding administrator HTTP and browser rendering.

Fsync fallback is measurably expensive on this filesystem; these results do not demonstrate negligible capture overhead. Production database latency, actual storage throughput, sustained outage capacity and alerts still require deployment-specific qualification. No real PostgreSQL server was used, so WAL volume is explicitly unavailable. The memory-database condition is not a PostgreSQL performance claim.

JSON also includes p50/p95/p99, deltas against disabled mode, throughput, CPU time, RSS/heap peaks, spool bytes/events and query time. Conditions run sequentially in one Node process: even after warmup, garbage collection and filesystem variation make these observations unsuitable for precise causal attribution or production capacity guarantees. This is local validation only, not ChatGPT/Codex acceptance or live provider benchmarking.
