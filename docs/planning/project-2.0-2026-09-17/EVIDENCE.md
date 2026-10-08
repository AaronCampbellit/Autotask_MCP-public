# Project 2.0 evidence register

Publication note: this historical assessment names revisions, file line numbers,
and CI records from the original private development repository. The public
source snapshot starts with fresh history; those records are retained as
provenance and are not publicly accessible validation links.

Research date: September 17, 2026. All repository links below identify the reviewed commit, not a moving branch. Recommendations and performance targets in [PLAN.md](PLAN.md) are proposed engineering decisions, not measured production results.

## Verified baseline

| Item | Evidence |
| --- | --- |
| Reviewed source | `c9175fac35e9e0ce0130f3f33a192618848df261` (private development commit) |
| SDK packages | `package.json` and `package-lock.json`: server/core 2.0.0 |
| CI | GitHub Actions run `35271662839` (private development history): successful; 782 tests, 782 passes, zero failures; test duration 137,888 ms |
| Discovery measurement | Same CI log: legacy 1,739,552 bytes; modern 1,739,729 bytes, full configured fixture catalog |
| Static catalog | `docs/TOOL-CATALOG.json`: 281 operations, 55 RMM, 191 unique output contracts |
| Inventory | 67 `tests/*.test.ts` files; 120 TypeScript files recursively under `apps/server` and `packages` |
| Recorded release | `docs/CURRENT-STATUS.md`: `0.1.0-mcp-expanded.20260917.3`; this document was read, production was not probed |

The generated catalog labels 106 operations write and 175 read. Those labels are not a complete side-effect classification; see F14.

## Finding-to-code map

| Finding | Primary code/test evidence | Confidence and limitation |
| --- | --- | --- |
| F01 modern boundary | `apps/server/src/app.ts:199`, `tests/http.test.ts:55` | Confirmed modern serving path and representative tests; not exhaustive conformance certification |
| F02 zero cache hints | `apps/server/src/app.ts:40`, exact locked SDK encode defaults | High: no configured hints plus verified SDK defaults; host cache behavior not measured |
| F03 discovery size/cost | `apps/server/src/app.ts:43`, `apps/server/src/schema-publication.ts`, `tests/output-contracts.test.ts:28` | Size measured by CI; CPU cost is a profiling hypothesis |
| F04 progressive discovery | `apps/server/src/tool-runtime.ts:103` | Helpers exist; unbounded match list and mixed dispatcher confirmed; host approval impact needs evaluation |
| F05 buffering | `apps/server/src/app.ts:125`, `apps/server/src/ingress.ts` | High: wrapper reads through stream completion before returning |
| F06 execution cancellation | `apps/server/src/app.ts:45`, `apps/server/src/tool-runtime.ts:85`, `packages/control-plane/src/execution.ts` | Application context not propagated; local provider timeouts and ingress cancellation do exist |
| F07 telemetry | `apps/server/src/tool-runtime.ts:110`, `packages/autotask/src/budget.ts`, repository symbol/dependency search | No project tracing setup found; audit/capacity diagnostics and historical measurements present |
| F08 orchestration | `packages/technician/src/index.ts:179`, `packages/rmm/src/composites.ts:65`, `packages/autotask/src/index.ts:184` | Sequential/repeated paths confirmed; safe reduction and speedup require tests and measurement |
| F09 cache lifecycle | `packages/operational/src/metadata.ts:25`, `packages/work-management/src/metadata.ts:48`, `packages/metadata/src/refreshing-provider.ts` | Existing caches confirmed; growth concern is structural, not observed production memory exhaustion |
| F10 jobs/Tasks | `apps/server/src/tool-runtime.ts:87`, `apps/server/src/job-worker.ts`, `packages/control-plane/src/index.ts:187` | Seven write kinds and fixed lease confirmed; no application extension registration found |
| F11 MRTR | `apps/server/src/app.ts`, `packages/sales/src/index.ts`, `tests/sales.test.ts` | No application MRTR usage found; custom closed-note confirmations exist |
| F12 notifications | `apps/server/src/app.ts:202`, `apps/server/src/publication.ts` | Deliberately disabled, not falsely advertised |
| F13 output volume | `apps/server/src/app.ts:30`, `packages/reports/src/index.ts`, `docs/OUTPUT-CONTRACTS.md` | Structured/text duplication and report details confirmed; keep compatibility until measured |
| F14 effects | `apps/server/src/tool-runtime.ts:45`, `apps/server/src/publication.ts:9` | Multiple effect representations confirmed; not a claim that current authorization is bypassed |
| F15 IT Glue | `docs/planning/rmm-itglue-2026-09-15/README.md`, `docs/LOCAL-BUILD-TRACKER.md` | Research-only status corroborated by code inventory |
| F16 scale | `packages/rmm/src/client.ts`, `packages/autotask/src/budget.ts` | Process-local accounting confirmed; scaling recommendation is conditional |
| F17 release/client proof | `.github/workflows/verify.yml`, `AGENTS.md`, `docs/MCP-PUBLISHING-AUDIT.md` | Server/fixture evidence is strong; no fresh host acceptance performed here |

## SDK inspection notes

The exact locked npm archives were inspected locally under ignored `work/research/sdk-source/`; they are research material, not installed runtime dependencies. Package source evidence:

- `server/dist/src-CX2iR2pK.mjs`: `DEFAULT_CACHE_TTL_MS = 0`, `DEFAULT_CACHE_SCOPE = "private"`, modern wire projection and required cache-field filling.
- `server/dist/mcp-DXXb3Vv3.mjs`: `ServerOptions.cacheHints` use; tool-list handler preserves registration order and emits the registered list. Existing application registration order is stable for fixed configuration; this review does not claim random ordering. Explicit sorting/tests are resilience improvements.
- `server/dist/index.mjs`: `createMcpHandler` calls standard-header validation, supports supplied parsed bodies, and exports MRTR helpers and a request-state codec.
- Legacy Tasks vocabulary exists in the distribution. Its presence does not establish an implemented application Tasks extension or a supported adapter package.

Archive hashes, measurements, and source-file hashes are recorded in [research-manifest.json](research-manifest.json).

## Official research sources

All were retrieved on September 17, 2026. The released Tasks page is used instead of relying on the mutable draft page cited earlier in the conversation.

| Source | What it establishes for this plan |
| --- | --- |
| [MCP 2026-07-28 changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | Protocol changes and deprecated features |
| [Base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic) | Stateless request model, optional features, schema and trace conventions |
| [HTTP binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) | HTTP metadata/header behavior and transport rules |
| [Tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | Authorized discovery, deterministic ordering, pagination, schemas, optional routing fields |
| [SDK HTTP serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html) | Request-specific server factory and handler lifecycle |
| [SDK caching](https://ts.sdk.modelcontextprotocol.io/v2/clients/caching.html) | Cache hints, defaults, private scope and client cache partitioning |
| [SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions) | Modern/legacy behavior and negotiation |
| [SDK modern migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28) | SDK ownership of wire projection and modern behavior |
| [SDK progress/cancellation](https://ts.sdk.modelcontextprotocol.io/v2/servers/logging-progress-cancellation.html) | Callback request context and progress/cancellation hooks |
| [SDK input-required guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required.html) | MRTR callbacks, input responses and continuation state |
| [Released Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks) | Capability requirement, durable task lifecycle, polling, input and cancellation |
| [SDK notifications](https://ts.sdk.modelcontextprotocol.io/v2/servers/notifications.html) | Notification capabilities and delivery |
| [SDK resources](https://ts.sdk.modelcontextprotocol.io/v2/servers/resources.html) | Optional resource publication/retrieval patterns |
| [SDK testing](https://ts.sdk.modelcontextprotocol.io/v2/testing.html) | Reference-client testing approach |
| [Official OpenAI metadata refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) | Developer-mode refresh and separate published-plugin process |
| [Official OpenAI MCP API guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) | Tool filtering and context reuse; not proof of all ChatGPT/Codex extension capabilities |
| [Datto RMM API](https://rmm.datto.com/help/en/Content/2SETUP/APIv2.htm) | Account-wide upstream request limits |
| [IT Glue API](https://api.itglue.com/developer/) | Integration reference and upstream throttle |

## Reproducing the baseline checks

```sh
git rev-parse HEAD
gh run view 35271662839 --repo AaronCampbellit/Autotask_MCP --log
rg -n 'input_required|inputRequired|requestState|tasks/get|tasks/update|cacheHints|cacheScope|traceparent|opentelemetry|registerResource|registerPrompt' apps/server packages tests --glob '*.ts'
rg -n 'Promise.all|AbortSignal|cache|Cache' apps/server packages --glob '*.ts'
```

Read search matches in their surrounding execution paths. A missing application symbol can be implemented by the SDK, and a match in an old plan is not current runtime behavior.

Validation of this planning bundle checks local links, immutable evidence references, manifest consistency, and whitespace. Application CI results are linked historical evidence from this exact commit. After authorization to install dependencies, the same baseline passed a fresh local suite and build; see [local validation](VALIDATION.md). These results do not validate the archived exploratory prototypes or future implementation.
