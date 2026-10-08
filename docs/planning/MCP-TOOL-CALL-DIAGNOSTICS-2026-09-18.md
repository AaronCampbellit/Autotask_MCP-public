# MCP tool-call diagnostics implementation plan

Implementation follow-up: [September 20 progress and remaining acceptance gates](IMPLEMENTATION-PROGRESS-2026-09-20.md). Original plan retained below.


**Status: implementation and local validation complete, September 20, 2026.** Built as `0.2.0-integrations-diagnostics.20260920.1`; not deployed. Deployment is deferred at the user’s request. Original plan date: September 18, 2026.

- [x] Work packages 1–4: durable capture, ingress/runtime/provider instrumentation, incident evidence and admin interface.
- [x] Work package 5: storage/key/retention/readiness configuration, local fault tests and capacity benchmark.
- [x] Work package 6: 980-test regression pass, migrations, unique release/image and compiled-image checks.
- [ ] Deployment-host fsync and deliberate process-crash qualification, alerting, PostgreSQL/WAL performance and backup retention.
- [ ] Production migration, live invalid/read capture and deployed identity/client verification — deferred.

Local tests simulate torn frames, abandoned instances and storage failures; they do not replace a deliberate process-kill test between native acceptance and terminal logging on the deployment host. Full operational acceptance is not marked complete.

## Agreed requirements

- Record every MCP tool-call attempt that reaches this server, including reads, writes, invalid arguments, denied/unavailable tools, local preflight failures and upstream failures.
- No daily event limit, sampling, oldest-first eviction inside the retention window, or overflow-based dropping. Pagination and bounded payload summaries do not limit event capture.
- Retain diagnostics for seven days (168 hours), then expire automatically.
- Give platform administrators a searchable cross-user diagnostic view, with sanitized arguments, timing, outcomes, errors and deployment version.
- Preserve existing business-operation receipts, replay protection and recovery behavior.

Complete call coverage does not mean storing every byte of every argument or response. Each call gets a record; sensitive and large content is deliberately summarized, with omissions identified. The server cannot record conversation messages it never receives, calls that never reach it, or client-side planning. Traffic rejected by a proxy before the application needs separate proxy diagnostics.

## Current implementation and integration points

- `apps/server/src/app.ts` authenticates requests, enforces admission limits, parses bounded JSON, registers SDK tools and formats errors. SDK validation and unknown-tool rejection can happen before the registered callback. Logging only inside that callback would miss attempts.
- `apps/server/src/tool-runtime.ts` validates inputs, checks access and dispatches tools. Both direct calls and `at_invoke` need correlation. `invokeJob` executes durable background work.
- `packages/control-plane/src/execution.ts` already uses AsyncLocalStorage for request-local controls; diagnostics should use a separate typed context with compatible propagation.
- `packages/control-plane/src/history.ts`, `postgres.ts` and `apps/console/public/admin.js` implement operation-journal history. The current page intentionally exposes only summaries across users.
- `apps/server/src/live-system.ts` constructs the adapters, database and runtime. Provider transports across Autotask and RMM need a shared instrumentation interface.
- `apps/server/src/app.ts` currently creates new correlation IDs while formatting errors. Replace independent IDs with the diagnostic call's correlation ID wherever one exists.

Use a separate diagnostic store and console view. Do not turn the operation journal into a general request log or widen access to other users' existing encrypted intents/results.

## Reliability contract

Every accepted tool execution must have a durably acknowledged start record before validation/dispatch. Under normal operation, persist start and terminal events to PostgreSQL. Terminal recording must finish before handing a completed tool response back to the transport, without changing whether a business operation succeeded.

Use a persistent, encrypted append-only local spool when PostgreSQL is unavailable. A spool append is acknowledged only after durable filesystem synchronization. A memory queue alone does not satisfy this requirement. Place the spool on a persistent volume outside the container writable layer; use per-process segment ownership and atomic rotation. Validate this behavior on the actual deployment filesystem.

Delivery is at least once; event IDs and unique constraints make database materialization idempotent. The drain worker removes a segment only after its events are durably committed or legitimately expired. Partial writes use framed records and checksums, allowing recovery of complete frames and explicit detection of a torn tail. Replaying diagnostics never replays a business action.

If neither database nor spool can durably accept a start, stop admitting new tool executions and return a diagnostic-storage-unavailable response. This is an availability tradeoff, not a daily quota. No finite system can guarantee unlimited storage or logging after complete storage loss. Expose this condition through readiness and infrastructure alerts; never claim that calls rejected while all storage is unavailable were durably recorded.

Reserve disk headroom for terminal events of already admitted calls, based on enforced maximum event sizes and existing concurrency limits. If storage fails after an upstream write, preserve its operation ID and unknown/verified status; do not replace its result with a retryable pre-dispatch error. A previously durable start remains evidence of the call even if its final event is unavailable. Stop new admission until durability recovers.

On restart, identify abandoned starts by instance identity/lease. Mark them interrupted with outcome unknown unless existing operation receipts provide stronger evidence. Do not infer failure or retry safety from missing terminal records. Record client disconnect separately from execution completion: execution may continue after the client disconnects, and response generation is not proof the client received it.

## Coverage and correlation

1. Allocate a server request ID at MCP ingress. Record HTTP admission/authentication/body failures as transport events, using verified identity only when available. Never save bearer tokens or untrusted identity claims as an authenticated user.
2. After bounded parsing identifies `tools/call`, persist the call start before SDK dispatch, availability lookup or schema validation. Unknown tool names are bounded untrusted strings. Oversized/malformed bodies retain an ingress failure, not an invented tool identity.
3. Instrument SDK protocol errors as terminal call events, including malformed arguments and unavailable tools. Verify hooks against the locally installed SDK; if its interfaces cannot expose these errors, implement the boundary adapter without consuming streaming bodies twice or altering protocol behavior.
4. Carry server-generated trace/call IDs through runtime, workflow and provider dispatch using AsyncLocalStorage. JSON-RPC IDs are diagnostic references, never unique database keys or trusted authorization values.
5. Direct tools get one root call. `at_invoke` gets one root plus a linked logical child; do not double-count the child as a second incoming request. Nested calls share trace ID and have distinct span IDs.
6. Record job submission and later execution separately, linked by job ID and operation ID. Capture rejected job execution and background failures as well as successes. Label non-MCP console executions separately if they share the instrumented runtime.
7. Record each actual provider attempt with provider, reviewed route template, method, duration, HTTP status, retry number and native request ID when available. Do not log authorization headers, raw query strings or arbitrary URLs. Distinguish local failure from upstream rejection using dispatch evidence, not message wording.
8. Instrument tool results that encode failures without throwing, output-contract failures, partial work, unverified acceptance and unknown outcomes. Never label success solely because the HTTP/MCP exchange completed.

For unauthenticated or over-capacity requests where a body has not been safely parsed, promise transport-attempt visibility, not exact tool-call attribution. Keep existing request size/concurrency protections. Initialization and discovery use compact transport events and are not counted as tool calls.

## Data model

Add the next available migration at implementation time; do not assume a migration number remains unclaimed. Proposed tables:

| Table | Purpose and principal fields |
| --- | --- |
| `diagnostic_events` | Immutable events: event ID, trace/call/span/parent IDs, event type, occurred/received timestamps, expiry, tenant/actor IDs when verified, instance ID, schema version, encrypted sanitized details. |
| `diagnostic_calls` | Search projection: call ID, tenant/user/resource IDs, tool and requested inner tool, source, start/end/duration, lifecycle, outcome, error origin/code, record references, operation/job IDs, server release and metadata digest. |
| `diagnostic_provider_attempts` | Linked provider attempt summaries with dispatch evidence, timing, HTTP status, retry and native request reference; no business bodies. |

Suggested lifecycle: started, finished, interrupted. Keep outcome separate: succeeded, failed, rejected, partial, accepted_unverified, unknown_outcome. Error origin: transport, authentication, schema, authorization, local_preflight, upstream, output_validation, diagnostic_storage, internal or unknown. Preserve an explicit unknown instead of guessing.

Record resolution/title/description presence, blankness and lengths independently from their text. Record field names requested for change, expected-state field names, scoped ticket/record IDs and requested status/queue IDs or exact reviewed labels. Add request/response byte counts, result count, completeness/continuation flags, warnings, redaction version and omitted/truncated-field paths. Use monotonic elapsed time and UTC wall-clock timestamps.

Index tenant/start-time/call-ID for keyset pagination; add measured indexes for user, tool, outcome/error and record reference. Default list queries exclude encrypted details and large JSON. Start with ordinary tables and indexed batched expiry; add partitioning only if measurements justify it. No full-text indexing of business content.

## Safe diagnostic contents

Implement a versioned allowlist registry, using tool-family policies and a safe generic fallback so new tools still produce diagnostic records without leaking new fields.

- Keep useful typed selectors, IDs, chosen statuses, pagination counts, field presence and sanitized error codes/messages.
- For user-authored resolution, notes, titles, descriptions and search text, default to type/presence/length instead of full text. This answers whether a cancellation reason was passed without duplicating customer text.
- Summarize successful responses by affected identifiers, count, completeness, verification and operation state; do not persist ticket bodies, notes, large result arrays or attachment bytes.
- Exclude credentials, cookies, tokens, connection strings, signed URLs, base64/file data, password fields and protected UDF values before either database or spool persistence.
- Sanitize native error bodies through provider-specific allowlists. Native errors can echo submitted text and credentials; AppError messages are not automatically safe for storage.
- Bound summary size/depth and string lengths, mark omissions explicitly, and retain a minimal diagnostic event when summarization fails. These are per-event payload controls, never call-count limits.
- Encrypt detail payloads and spool records using a dedicated key domain with rotation support. Keep only required searchable metadata plaintext. Do not reuse workflow intent envelopes without a separate purpose binding.

Do not automatically capture raw payloads in debug mode. A future narrowly scoped opt-in would require its own design, access and retention policy.

## Accepted-write verification diagnostics

Required incident coverage: a historical `ticket_note_add` returned `accepted_unverified` after the upstream accepted the note creation and returned a native identifier. Private ticket, note and journal operation identifiers are withheld from this public plan. The retained receipt established acceptance and a returned identifier, but did not distinguish a failed readback from a completed comparison with mismatched fields. Do not infer the historical verification cause from that receipt or relabel the original live observation as a synthetic fixture.

Instrument verification at the workflow comparison boundary as well as the provider transport. An HTTP 200 readback is not proof that the saved record matches the requested write. Apply the shared diagnostic store, administrator restrictions, sanitization and seven-day retention; do not create a separate raw log.

### Required evidence

- Link the accepted write, returned native record ID, operation ID, verification attempt and readback provider attempt under the same diagnostic trace.
- Record verification outcome explicitly: not attempted, readback failed, readback completed with mismatches, or fully verified. Preserve an unknown/interrupted outcome when execution ends before this can be established.
- For completed comparisons, record reviewed expected, matched, mismatched and missing field names, plus separate record-ID, parent-ticket and author-attribution check outcomes. For ticket notes this includes submitted title/text, note type and visibility. Record only check results and approved field names; do not persist expected/actual note text or raw record bodies.
- For readback failures, retain the sanitized error origin/code, provider HTTP status when available, timing and provider attempt reference. Distinguish a transport/read failure from a comparison mismatch.
- Persist verification evidence even when the business operation remains `accepted_unverified`. Do not rely on a journal state transition to save it: the current note workflow can discard error details when its state is already `accepted_unverified`, and does not retain incomplete comparison results.
- Expose the verification outcome, failed checks and linked readback attempt in the Tool calls detail drawer and sanitized diagnostic JSON. Preserve acceptance separately from verification so administrators can distinguish an accepted create from a fully verified result.

These diagnostics must not change business-operation states, replay protection or retry eligibility. Any diagnostic recording/replay must issue no additional business write. Automatic readback retries or reconciliation improvements are separate behavior changes, not implicitly authorized by this logging plan. Historical missing evidence cannot be reconstructed as fact; a later read only establishes the later observed state.

### Reproduction and acceptance

- Reproduce the ticket-note incident with synthetic fixtures: return a native note ID from creation, then simulate both a readback failure and a successful HTTP read whose record fails comparison. Each case must show `accepted_unverified` with the distinct diagnostic cause and linked operation/native IDs.
- Exercise text/title, note type, visibility, record-ID, parent-ticket and attribution mismatches, including missing fields. Confirm that the exact failed checks are visible without storing note content. Include a fully matching control that reports verified success.
- Inject a readback error after the journal has entered `accepted_unverified`; verify the diagnostic error survives even though there is no further journal state transition.
- Assert exactly one create request in each case, unchanged duplicate protection and no diagnostic-triggered write retry. Use synthetic fixtures rather than creating live notes.
- Include sensitive-text canaries in expected and returned records and errors; verify persisted events, decrypted spool records, UI/export JSON and process logs contain only approved summaries.

## ChatGPT attachment handoff diagnostics

Required incident coverage: a normally attached ChatGPT PDF failed at opportunity_file_stage with “This file download host is not supported.” The client display showed a bare file ID and a materialized local path with no locator. That display does not establish what reached the MCP after client transformation. Capture server-side evidence before changing the host allowlist or request limits.

Instrument both `at_file_stage` and `opportunity_file_stage`, including their pre-SDK validation failures and calls through wrappers. Use the same durable events, tenant/admin restrictions, seven-day retention and no-sampling policy as other diagnostics; do not create a separate raw debug log.

### Required evidence

| Stage | Persisted diagnostic fields |
| --- | --- |
| Received input, before schema validation | Source kind: file object, bare file ID, base64, missing, conflicting sources or other invalid shape. Record types and presence of `download_url`, `file_id`, `file_name` and `mime_type`; no raw IDs, names, paths, base64 or input values. |
| Published tool contract | Tool name, server release, metadata/schema digest, whether `openai/fileParams` includes the top-level `file` field, and declared/required file-property names. This describes the server contract, not proof of the client's cached metadata. |
| URL parsing and validation | Parse success, normalized hostname when safely parseable, scheme category, default/nonstandard port category, boolean embedded-credentials presence, allowlist policy version and exact failed rule. Record all failed rules where safe, plus the rule selected for the user-facing error. |
| Download | Whether fetch was attempted, duration, response HTTP status when received, declared/received byte counts, and timeout, redirect rejection, non-success response, empty body, oversize or interrupted-stream classification. Never infer an expired URL from HTTP status alone. |
| Local staging | Whether staging started/succeeded, staged artifact reference if authorized, and size/schema/storage failure category. Distinguish HTTP request-body rejection from downloaded-file size rejection. |
| Autotask attachment | Whether native upload was attempted, linked operation/provider attempt ID, native HTTP status and sanitized native error category. A staging failure must not be labeled an Autotask rejection. |

Define stable URL failure codes: `url_missing`, `url_wrong_type`, `url_parse_failed`, `scheme_not_https`, `embedded_credentials`, `nonstandard_port`, and `hostname_not_allowed`. File-reference/schema failures need separate codes such as `bare_file_id`, `missing_file_id`, `invalid_file_object` and `conflicting_sources`. Map these to the existing diagnostic error origin without changing business retry semantics.

The hostname is a narrow exception to excluding full signed URLs: extract only the parsed hostname, normalize/bound it, and render it as inert text. Do not persist the URL path, query, fragment, username/password, redirect destination, raw parsing exception or full URL hash. Do not pass URLs through generic error serializers. For malformed URLs, save only the failed rule and input type; do not attempt string-based hostname recovery. Hostname data is restricted to the same authorized diagnostic view and seven-day retention.

Show an attachment section in the call detail drawer with received shape, published contract digest, host/check result, download outcome and native-dispatch status. Make these fields available in sanitized diagnostic JSON. Keep the full URL out of client error messages and console/stdout as well as database/spool records. A support correlation ID must link the user's error to this evidence.

### Reproduction and acceptance

- Test object-shaped and bare-ID inputs, missing/wrong-type properties, wrapped calls and SDK rejection before callbacks. Never conclude that a client display is the actual wire input.
- Test valid approved HTTPS URLs, disallowed hosts, suffix-lookalike hosts, malformed URLs, HTTP, embedded credentials, nonstandard ports and multiple simultaneous violations. Assert hostname/check reporting and that rejected URLs trigger no fetch.
- Test redirect rejection, timeout, non-success HTTP responses, empty files, oversized declared/streamed bodies and stream interruption. Assert exact stage and whether a provider write occurred.
- Use synthetic signed URLs containing distinct secret canaries in path, query, fragment and credentials. Verify those values and raw file IDs/names/bytes never appear in persisted events, decrypted spool records, exports, client errors or process logs; only the approved hostname and summary fields remain.
- Exercise a roughly 208 KB fixture through a small file-reference tool request and separate byte download. Separately verify a base64 request exceeding the current 64 KiB body limit is classified as an ingress size failure. Do not conflate either with the configured attachment-byte limit.
- After deployment, verify the actual discovered file metadata, refresh the ChatGPT connection where applicable, and have the user retry a normal attachment. Record server-received shape and sanitized hostname/check evidence. An isolated staging-only test must stop before a native attachment write unless that write is authorized by the user's request.
- Use this evidence to decide whether the remaining issue is publication/cache, file-reference transformation, host policy, download availability or size validation. Do not expand the host allowlist or increase request limits as part of adding diagnostics; any resulting fix needs evidence and its own validation.

## Seven-day retention

Use expiry equal to each event's occurrence time plus 168 hours. A call's searchable projection expires 168 hours after its start; individual later events retain their own expiry. Linkage must tolerate expiry of a parent. Normal request timeouts keep most spans close together; long-lived jobs receive independent execution records rather than extending the submission's retention indefinitely.

- Apply expiry in every list/detail/export query, including spool-backed diagnostics, so expired data is immediately unavailable even if physical cleanup is delayed.
- Run a resumable cleanup worker every five minutes using bounded batches. Delete expired events/projections/provider rows independently; prevent orphaned expired details.
- Drain deletes expired spool events without importing them as new history; never reset retention on replay. Surface backlog age so an outage approaching seven days is visible.
- Treat retention expiry as intentional deletion, not dropped telemetry. Keep separate counters for capture failures, legitimate expiry and delivery backlog.
- Verify active-store physical cleanup within 15 minutes under healthy conditions; alert on lag. Do not purge unexpired records to relieve disk pressure.
- Apply the same policy to diagnostic files and exports. Existing business journals, audit trails and idempotency receipts keep their existing retention and are not deleted by this job.
- Inspect actual backup/WAL/snapshot settings before release. Dedicated diagnostic data must not silently inherit longer recoverable backup retention. Prefer a separately managed diagnostic store if the main database's backup requirements cannot meet seven days. Document any residual backup exposure, or implement time-bucketed encryption keys whose expired keys are unrecoverable from backups. Restores must apply expiry before exposing diagnostic data.

Seven days is an active-history requirement plus a deployment acceptance check for backups; do not advertise hard deletion from every backup until verified.

## Admin experience and access

Add a **Tool calls** page alongside existing Activity and Administration audit. Restrict cross-user diagnostic summaries and details to current platform administrators in the same tenant; ordinary users retain their existing Activity access. Do not automatically give audit-only readers access to argument/error details.

Default to the last 24 hours with a seven-day maximum range. Provide user, tool, result, error origin/code, record ID, operation/job ID, correlation ID and server-release filters. Use 50-row pages, maximum 100, with stable keyset cursors. Paginated display never limits captured records.

Each row shows user, tool, time, duration, outcome and error source. The detail drawer shows sanitized arguments/result, linked child/provider attempts, validation stage, affected record references, release, correlation ID and explicit omitted-content indicators. Render all record/error text as inert text. Offer copyable sanitized diagnostic JSON and a support reference; no replay action in the diagnostic view.

Link an operation ID to an existing receipt only if its current ownership/access policy permits it. Recheck authorization after awaited data reads. Record administrators' detail/export access in the administration audit without recursively tracing the trace viewer itself.

Show capture health: oldest pending spool event, backlog bytes/events, database delivery lag, durable-store status, cleanup lag, capture failures, interrupted calls and spool disk headroom. Route alerts through the deployment's established operations channel; this plan does not authorize sending messages to external recipients.

## Capacity and performance validation

No per-day cap. Seven-day storage scales with traffic and event detail. Initial planning estimates only:

| Calls/day | At 2–5 KB total diagnostic data/call | Seven-day raw volume |
| --- | --- | --- |
| 10,000 | 20–50 MB/day | 140–350 MB |
| 100,000 | 200–500 MB/day | 1.4–3.5 GB |
| 1,000,000 | 2–5 GB/day | 14–35 GB |

Indexes, WAL, encryption framing, backups and multiple provider spans add overhead; these figures are not a sizing guarantee. Measure actual bytes/call and provider fan-out. Alert on projected seven-day capacity and spool outage runway; grow storage instead of dropping logs.

Normal calls add a durable start write and durable completion write, plus provider event persistence. The earlier best-effort buffered design cannot promise zero silent drops. Group commit/batching is allowed only if each caller awaits its own durability acknowledgment. Bound memory through backpressure and a durable spool, never drop-on-overflow.

Benchmark enabled versus disabled logging with representative read/write fixtures and an instrumented provider simulator, at observed production concurrency and higher bursts. Report p50/p95/p99 added latency, throughput, CPU, memory, WAL bytes, bytes/call and console query time. Initial target: <=20 ms p95 added end-to-end time on the deployment host for ordinary calls, subject to measurement; investigate or revise architecture if missed rather than claiming it is guaranteed. Test database outage, slow disk, spool draining and cleanup concurrently. No live business mutations are needed for load tests.

## Implementation work packages

1. **Contracts and durable store:** define event schemas, error origins, redaction policies, memory/PostgreSQL stores, migration, encrypted spool, replay deduplication, retention worker and health model. Test crashes and torn writes first.
2. **Ingress and runtime coverage:** implement the attachment handoff evidence and rule codes specified above, including the pre-validation input summary; instrument pre-SDK tools/call handling, returned protocol errors, runtime/nested dispatch, background jobs, shared correlation IDs and output failure paths. Add workflow-level accepted-write verification events with the comparison checks and same-state error preservation specified above. Keep compatibility with supported MCP protocol versions and streaming behavior.
3. **Provider instrumentation:** instrument the file-download boundary in `packages/artifacts/src/file-input.ts` with sanitized hostname/check and download-stage evidence; wrap the actual Autotask and RMM transport boundaries, including retries and pre-dispatch guards, without issuing extra provider requests. Inventory every provider adapter to prevent coverage gaps.
4. **Admin routes and UI:** add tenant-scoped list/detail APIs and the Tool calls view; indexes, filtering, redacted JSON copy, authorization and health indicators. Preserve Activity semantics.
5. **Operations:** configure persistent spool storage/permissions, keys, seven-day cleanup, readiness, alerts, backup policy and sizing measurements. Add startup checks and crash recovery.
6. **Release:** run checks and acceptance suite, bump SERVER_RELEASE to a distinct version, select a new image tag, record changes and evidence in CURRENT-STATUS.md, deploy additive migration and verify live discovery/at_diagnostics. Refresh any actual separately versioned plugin metadata as required by AGENTS.md. Coordinate with the pending cancellation candidate; do not overwrite its release record or deploy changed code under its prior version.

Complete all six before describing diagnostics as deployed. A canary may isolate which instance runs the feature, but enabled instances must not sample calls. Historical missing calls cannot be backfilled from screenshots or incomplete journal entries.

## Acceptance tests and release gates

- Every generated incoming tools/call has exactly one root call record; reads, writes, invalid schemas, unknown/unavailable tools, denied access, early metadata/preflight failures and encoded error results all produce terminal or explicit interrupted outcomes.
- Authenticate/body/admission rejection paths produce transport events with honest available identity. Validate failures occurring before tool identification separately from identifiable tool calls.
- SDK versions/protocols and streaming replies preserve behavior. A disconnect does not erase a call or imply the provider action was cancelled.
- Nested at_invoke/workflows and queued execution preserve parentage without duplicate root counts. All errors returned to clients reuse their recorded correlation ID.
- Demonstrate the attachment incident using the attachment handoff reproduction/acceptance matrix above, with a matching support correlation ID and no signed URL leakage.
- Demonstrate the accepted-write note incident using the verification reproduction/acceptance matrix above: distinguish readback errors from HTTP-success comparison mismatches, retain same-state failure evidence, and prove exactly one create with unchanged retry protection.
- Demonstrate the cancellation incident: requested Canceled and absent resolution are visible; a local validation failure is labeled local_preflight with no provider write; a native rejection has the actual provider attempt and upstream classification.
- Fault injection: unavailable database, process crash before/after upstream dispatch, torn spool frame, duplicate replay, slow filesystem, low disk, all durable stores unavailable, and restart with abandoned calls. No unrecorded execution, silent discard or telemetry-triggered business retry.
- Deliberately crash between upstream acceptance and final logging: the call remains visible as interrupted/unknown or linked to a verified receipt, never falsely failed/safe to retry.
- Scan persisted events, spool bytes after decryption, API responses and exports with credential/file/secret canaries; all expected redactions hold, including native errors and malformed argument objects.
- Tenant isolation, administrator revocation during reads, audit-only denial, unchanged receipt ownership, cursor/filter validation and inert UI rendering all pass.
- Seven-day expiry enforced on queries and spool replay; cleanup is resumable; backups/restores meet the approved policy; workflow journals remain untouched.
- Sustained traffic above an arbitrary daily threshold still produces one root per call. Existing ingress concurrency protections continue to work; no sampling or daily cutoff exists.
- Baseline/regression tests, TypeScript, migration checks, capacity benchmarks and production health/discovery verification pass. Verify admin diagnostic capture with harmless live reads and a controlled invalid call; do not modify live tickets to test logging.

## Completion evidence

Deliver code and migration, operational runbook, coverage inventory, benchmark report, fault-injection and retention results, admin screenshots, deployed version/diagnostics verification and remaining limitations. Keep the user-facing statement precise: every admitted server-side tool execution is durably recorded, with seven-day history and no daily capture cap; failures beyond the application's reach and catastrophic storage loss remain outside that guarantee.
