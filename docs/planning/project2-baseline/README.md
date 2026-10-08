# Project 2.0 local baseline harness

Implemented September 20, 2026. This records local fixture evidence; actual ChatGPT/Codex host qualification remains separate.

Run from the repository root with the installed dependencies:

```sh
node_modules/.bin/tsx --test tests/project2-compatibility.test.ts
node_modules/.bin/tsx scripts/project2-benchmark.ts 5 > docs/planning/project2-baseline/after.json
```

The optional argument selects 1–1000 warm samples per scenario. Each protocol/scenario receives a fresh fixture application, with one separately recorded cold request followed by warm requests. Requests traverse a loopback TCP socket, the real Node ingress, application authentication and the pinned SDK. The harness uses randomly generated fixture credentials and never prints them or accesses a live provider.

JSON includes release, Node version, observation time, serialized request/response bytes, fixture Autotask adapter call counts, raw samples and nearest-rank p50/p95/p99. Cold means fresh fixture application, not fresh Node process. Timings include loopback HTTP and body consumption; they are neither isolated CPU time nor production/provider latency. Fixture adapter counts exclude other fixture ports and must not be presented as complete native HTTP call counts. Run baseline/candidate on the same otherwise idle machine with identical samples. Small sample p95/p99 values are smoke measurements only.

Scenarios: authorized discovery, exact-ID ticket context (notes/time), text ticket search, current-user workday, configured RMM ticket context, completed report retrieval, and a fixture-only ticket note write. Discovery reflects this fixture principal's configured providers and permissions; it is not the full deployment catalog. Each write uses a new request key and must return `succeeded_verified`. RMM must return a verified native asset link; report retrieval must return a completed result. RMM configuration and report creation/execution occur before timing. Report retrieval measures encrypted result loading and current authorization, not report generation. RMM uses the standard fixture plus an explicitly empty alert page. All traffic is loopback; no live provider calls occur.

`before.json` preserves the historical five-sample baseline unchanged. `after.json` records five warm samples for each of seven scenarios across both protocol eras. The three new scenarios explicitly have `historical_baseline: false`; there is no manufactured before comparison. Differences between captures include intervening code and catalog changes, so timing differences are observational and not isolated causal speedups.

The expanded run recorded RMM context at six Autotask adapter calls and five RMM port calls, report retrieval at zero provider calls, and a note write at nine Autotask adapter calls. Note sequence: four ticket reads, one note create, two ticket reads, one note readback, one final ticket read. The JSON preserves every adapter operation in order. Separate `tests/rmm-extended.test.ts` evidence compares request-scoped coalescing enabled/disabled (five versus eleven RMM calls) while retaining the scope-change regression. Counts exclude other local fixture ports; they are not network-attempt totals. Small-sample timing percentiles are not production latency claims.

Compatibility tests assert both 2025-11-25 and 2026-07-28 discovery and structured context results, unknown methods/tools, invalid mutation input with zero provider dispatch, modern absent/mismatched method/name headers, and unsupported protocol versions. Observed SDK behavior also permits a modern request without the HTTP version header when the body metadata supplies its version; the test preserves this behavior rather than inventing an application requirement.

| Client / boundary | Evidence |
| --- | --- |
| Local direct HTTP harness, both protocol eras | Automated fixture assertions |
| Reference SDK client | Not measured; harness sends HTTP directly |
| ChatGPT connection | Not measured |
| Codex connection | Not measured |
| Progress, cancellation, Tasks, MRTR, subscriptions, client metadata refresh/cache | Not qualified by this harness |

Initial two-warm-sample smoke run passed all eight protocol/scenario combinations. Exact-ID contexts recorded 10 fixture Autotask adapter calls, text searches 1, workday 5, discovery 0. Authorized discovery was 528,729 legacy bytes and 528,882 modern bytes at the checked release. These counts and sizes describe the baseline only; future changes should compare newly captured JSON, not treat them as fixed performance assertions. The initial run is intentionally not checked in as a production benchmark or claimed speedup.
