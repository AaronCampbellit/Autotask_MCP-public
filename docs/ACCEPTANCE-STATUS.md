# Acceptance status

> Historical acceptance matrix. Scanner requirements, direct-only attachment coverage and earlier tool/migration counts below describe old revisions. Use [current implementation](IMPLEMENTATION.md), [ticket attachments](TICKET-ATTACHMENTS.md) and [current status](CURRENT-STATUS.md) for shipped behavior; original unmet acceptance gates are not silently marked complete.

For the September 16 local workday, linked-site, playbook and export changes, see [Supporting tools](SUPPORTING-TOOLS.md). The original evidence matrix below remains historical where it describes the earlier implementation.


> Current-status note (2026-09-14): this document contains earlier design or test snapshots. For current implementation and deployment distinctions, start with [CURRENT-STATUS.md](CURRENT-STATUS.md). Historical test results remain evidence for their stated revision only.

Snapshot: 2026-09-10. This document maps the implementation to the preserved [tool contract](planning/autotask-mcp-plan/14-TOOL-CONTRACTS.md), [verification gates](planning/autotask-mcp-plan/09-VERIFICATION.md), [workflow evaluation](planning/autotask-mcp-plan/19-TECHNICIAN-WORKFLOW-EVALUATION.md) and [delivery backlog](planning/autotask-mcp-plan/10-DELIVERY-BACKLOG.md). It does not change their requirements or mark their planned evidence as completed.

The local runtime contains the eight mandatory technician tools, five coordinated/read workflows, and 25 supporting tools: 38 names before capability and operator-switch filtering. The production release is **not qualified**. Test references below identify deterministic evidence for the described scope, not a pass certificate for every original scenario, native Autotask behavior, or actual client interaction. Current command results belong in [VERIFICATION.md](VERIFICATION.md).

The [implementation inventory](../registry/coverage.json) accounts for all 231 original entity labels and 232 index rows. It records 25 implemented operation slices, 23 with explicitly scoped fixture evidence, zero tenant-tested operations and zero enabled live operations. These are operation counts, not fully implemented entities. All entity labels and factual API observations remain. Publication cleanup replaces local vendor-cache paths with source URLs and updates the source hash. [PRESERVATION.json](planning/PRESERVATION.json) records historical original planning artifacts; copied vendor pages and indexes have been excluded. Its September checksums describe that earlier preservation operation and are not current-tree validation evidence.

## Current expansion delta (2026-09-14)

The local work-management pack now implements self-only task/internal time creation, eligible unposted/unbilled time correction and deletion, expense report/item workflows, daily availability, and single-day time-off request/cancel. Scheduling also includes service-call update/cancel. These additions use fixture and mocked HTTP validation only; they have no tenant qualification and no live business-write tests. See [WORK-MANAGEMENT.md](WORK-MANAGEMENT.md).

Ticket tag association management and checklist library application are deployed and discoverable, without tenant-qualified native write evidence. Other gaps include general contact/company administration (contact support is lookup and ticket linking only), quote send/native quote PDF/customer acceptance/Won Quote workflows, and full webhook synchronization. The bounded TicketChecklistItems CRUD pack is implemented but has no tenant qualification or live write tests. The webhook receiver remains optional receipt storage with gap hints. Current build, test and deployment status is recorded in [CURRENT-STATUS.md](CURRENT-STATUS.md), separately from the historical counts below.

## Historical named tool coverage — September 10

The following rows retain the September 10 evidence requirements and implementation snapshot. They do not override the current application-controlled access model or the current tool catalog; use CURRENT-STATUS.md for the deployed pilot.

| Required tool | Implemented local scope and evidence | Remaining implementation or qualification |
| --- | --- | --- |
| `ticket_search` | Exact scoped company/queue/status/technician references, ticket number and bounded search; [fixed workflows][FW], [runtime integration][EXT], [core reads][WF]. | Broader search semantics, native labels/links and tenant permissions require qualification. |
| `ticket_context` | Four purposes, authorized notes and existing time, linked evidence, collection completeness and signed continuations; [domain][TD], [core reads][WF]. | Live contact/site/checklist routes are unavailable; history continuation, related-ticket and knowledge evidence remain incomplete or unimplemented. |
| `ticket_update` | Title, owner/derived role, queue, status, category, priority and supplied resolution; expected values, completion prerequisites and readback; [domain][TD], [fixed workflows][FW], [transport][TT]. | Broader ticket fields and conditional rules are unimplemented. Native concurrency is not an atomic compare-and-swap guarantee. |
| `ticket_note_add` | Explicit supplied text/audience, reviewed metadata and employee attribution field, one create plus scoped readback; [write adapter][AW], [write workflows][WW], [MCP writes][MCP]. | Native note type/publication IDs, chosen attribution field and native employee enforcement require tenant evidence. |
| `time_log_ticket` | Own ticket time; supplied date, timezone, minutes and summary; eligible role/work type and period preflight; [write adapter][AW], [preflight][WPF], [resolution][RES]. | Task/internal time and eligible corrections are covered by the current work-management expansion; delegation, finance overrides and native date-container/timesheet behavior still require qualification. |
| `time_entry_search` | Actual permitted ticket time, self/team capability boundary, date filters, pagination and truthful scope; [core reads][WF], [runtime integration][EXT]. | General cross-ticket reporting and internal-time coverage remain outside this slice. |
| `schedule_search` | Explicit timezone/interval and eligible resources; actual ticket/call/resource associations, bounded pagination and overlap evidence; [scheduling][SCH]. | Task/general appointments and atomic reservation remain unimplemented. Daily availability and single-day time-off tools are covered by the current expansion but require tenant qualification. |
| `service_call_create` | Ticket call, explicit zoned times and eligible resources; parent → ticket link → resource links, readback, partial/unknown recovery; [scheduling][SCH]. | Additional scheduling domains and tenant status/duration/overlap/native attribution rules remain unqualified. |
| `ticket_document_work` | Full preflight, verified note before own time, immutable encrypted intent and separate receipts; [write workflows][WW], [document recovery][DR], [preflight][WPF], [runtime integration][EXT]. | Missing-ID uncertain creates require investigation; no invented recovery ID or automatic repeat. Native effects remain unqualified. |
| `ticket_handoff` | Resolve eligible target, save supplied internal note, then update ownership with original preconditions; [fixed workflows][FW], [runtime integration][EXT]. | No implicit scheduling/queue changes; native assignment/role eligibility requires evidence. |
| `ticket_resolve` | Completion prerequisites, supplied documentation, optional requested own time, then completion; [fixed workflows][FW], [domain][TD]. | Live checklist route is unavailable; completion cannot bypass missing required evidence. Native requirements remain unqualified. |
| `my_workday` | Explicit local date/timezone; separate assigned tickets, scheduled work, due-task evidence and actual own time with completeness; [fixed workflows][FW], [domain][TD], [scheduling][SCH]. | Configured employee-timezone/default workspace fallback is unimplemented. Live source pagination is bounded and incomplete results stay labeled. |
| `ticket_prepare_visit` | Unique appointment choice and authorized ticket/site/contact/asset/history evidence in fixtures; read only; [fixed workflows][FW], [domain][TD]. | Live site/contact read adapters and broader appointment/site resolution remain incomplete. |

Supporting tools provide scoped discovery/description, reviewed query/get/related wrappers, invocation/validation, references/requirements, operation status/resume/reconcile, durable jobs, playbooks, diagnostics, and local protected artifacts. Their presence does not implement arbitrary entity operations, arbitrary workflow graphs, the planned full report engine, or native attachment transfer. [Runtime integration][EXT] verifies the configured catalog against the registered names and rechecks capabilities and switches when tools execute.

## WF-01–38 evidence map

“Local evidence” means the listed deterministic fixtures exercise the stated behavior. “Partial” identifies a material remaining implementation, client, or evaluation obligation. Every row still needs its applicable designated-record/native permission evidence before a production release. None is globally marked passed here.

| Case | Local evidence | Remaining acceptance scope |
| --- | --- | --- |
| WF-01 | [TD], [FW], [EXT]: mapped `me`, exact ticket number and scoped resource/company names. | Actual client phrasing and readable tenant labels. |
| WF-02 | [TD], [EXT]: ID, number and exact reviewed-host native URL; public runtime normalizes ticket URLs before legacy write/artifact calls. Invalid hosts do not trigger fetches or writes. | Actual instance links and client traces; public regression directly exercises documentation and wrong-host note input, not every representation/tool combination. |
| WF-03 | Partial [TD]: scoped company/resource/queue ambiguity never guesses or discloses hidden matches. | The specified two-John contact resolver/selection case is unimplemented. |
| WF-04 | [TD], [SCH]: inactive, foreign, stale and ineligible references fail without substitution. | Contact and site resolver parity; tenant parent constraints. |
| WF-05 | Partial [FW], [SCH]: explicit IANA timezone, DST folds/gaps and fractional-offset day boundaries. | Employee timezone settings, workspace fallback and natural “today” default are unimplemented. |
| WF-06 | [RES], [META], [TD]: versioned eligible defaults and provenance. | Reviewed Rarity rules and real effective-date/eligibility metadata. |
| WF-07 | [RES], [TD], [AW], [WPF]: missing/tied/ineligible defaults and drift fail before affected dispatch. | Tenant-specific required fields and live metadata refresh behavior. |
| WF-08 | [RES], [WW], [MCP]: duration/summary/audience remain explicit; strict schemas reject missing business input. | Model/client clarification wording and no-invention prompt evaluation. |
| WF-09 | [ID], [AW], [SCH]: missing/inactive/mismatched mappings, header invariants and no integration fallback. | Each enabled native operation's employee allow/deny evidence. |
| WF-10 | [FW], [CP], [EXT], [REV]: changes after admission/queue or saved effect stop later work under the original actor. | Live identity provider outage/revocation propagation and operator correction exercise. |
| WF-11 | Partial [TD], [WF]: scoped investigate evidence, internal-note policy, actual IDs and freshness. | Full live contact/site/history/related-ticket context and link enrichment. |
| WF-12 | Partial [TD], [WF], [FW]: actual existing time separated from scheduling, checklist evidence and collection scope. | Full live checklist/history continuation and client distinction between attempts and proposed work. |
| WF-13 | [TD], [FW]: handoff/resolve purposes return prerequisites and mark unavailable collections; reads cause no business mutation. | Native completion/ownership metadata and technician assessment of relevance. |
| WF-14 | [TD], [WF], [SCH]: bounded pages, signed continuations and explicit unavailable/partial sections. | Live history/tasks/own-work pagination has no qualified continuation and is labeled incomplete; full collection continuation remains work. |
| WF-15 | Partial [TD], [EXT]: projections and strict tools give retrieved text no execution authority. | Knowledge/similar-ticket retrieval, relevance basis and wrong-fix/malicious-source prompt suite are unimplemented. |
| WF-16 | [WW], [DR], [MCP], [EXT]: supplied internal note and 30-minute own-time effects with IDs, attribution checks and no status change. | Native persisted business outcomes and displayed client receipt. |
| WF-17 | [WW], [WPF], [RES]: invalid time/known prerequisites block the initial note; no default external publication. | Tenant-required fields and reviewed rounding/default rules. |
| WF-18 | [WW], [DR]: first/later failure, lost response/ack, mismatched readback and no duplicate creates. | Bounded designated-record qualification; production fault injection is not required or authorized by these tests. |
| WF-19 | [FW], [EXT]: eligible handoff notes verified before owner change; separate receipts. | Real queue/resource eligibility and native attribution. |
| WF-20 | [TD], [FW], [SCH]: ambiguity/ineligible target stops mutations and cannot select another technician. | Tenant candidate distinctions and client clarification. |
| WF-21 | [FW]: saved note survives owner failure/drift; recovery checks original business state and never repeats the note. | Actual native conflict behavior and operator recovery exercise. |
| WF-22 | [FW], [EXT]: supplied resolution, requested time and terminal status happen in dependency order. | Real completion rules and native persisted readback. |
| WF-23 | [TD], [FW], [WPF]: completion blockers, missing text, invalid role/date/status stop initial effects. | Posted/billed correction is not implemented; tenant checklist/period requirements remain unqualified. |
| WF-24 | [FW], [DR]: closure waits for verified prerequisites; partial effects and uncertain IDs reconcile without duplicate time. | Real readback/native-state variants and client interpretation. |
| WF-25 | Partial [FW], [TD], [SCH]: separate day tickets/tasks/schedule/actual time and noninflated totals. | Default timezone support and full live collection pagination/source-link coverage. |
| WF-26 | [TD], [FW], [REV]: self scope, separate empty/unavailable sections and no coworker/finance leakage. | Broader delegated workday is unimplemented; live source-outage behavior still needs qualification. |
| WF-27 | Partial [FW], [TD]: fixture visit has authorized appointment/site/contact/assets/history and no mutation. | Live site/contact adapters and business review of access-information usefulness. |
| WF-28 | Partial [FW], [TD], [SCH]: ambiguity, canceled/unavailable appointment and prohibited parent/asset evidence. | Full live contact/site ambiguity and relationship cases. |
| WF-29 | Partial [ID], [WF], [TD], [ART], [EXT]: field/filter/projection/export boundaries, including finance-entitled fixture differences. | Financial mutations, native field permissions and broader reporting inference cases are unimplemented/unqualified. |
| WF-30 | Partial [CP], [EXT]: permitted routine writes execute directly; forbidden calls/switches cannot escalate through wrappers/jobs. | The specified bulk/destructive/billing domain actions and their action-specific permission cases are unimplemented. |
| WF-31 | [ST], [WST], [FW], [SCH], [EXT]: immutable actor/request intent, changed-payload conflict and concurrent no-repeat claims. | Native uncertainty and per-operation idempotency qualification; no global exactly-once guarantee. |
| WF-32 | [DR], [FW], [SCH], [CP]: original encrypted payload, current authorization, saved-ID reconciliation and only safe unfinished-step resume. | Operator/client recovery exercise; unknown create without ID intentionally remains manual. |
| WF-33 | [WW], [FW], [SCH], [MCP], [EXT]: receipts distinguish verified/partial/unverified/failed/unknown and preserve saved IDs/remaining steps. | Actual client-rendered text and native attribution evidence. |
| WF-34 | [PB], [EXT]: versioned role-appropriate playbooks and direct named-tool descriptions/schemas. | Measured client tool selection and unnecessary-question rates. |
| WF-35 | Partial [HTTP], [MCP], [EXT], [ADMIN]: local protocol, auth/session and tool traces. | Actual Codex, ChatGPT, Claude and applicable Claude Code versions, sign-in/refresh/reconnect and repeated prompt suite have not been qualified. |
| WF-36 | Partial [FW], [SCH], [EXT]: deterministic receipt data matches observed fixture effects. | Blinded technician comprehension review and its predefined rubric have not run. |
| WF-37 | [ID], [TD], [HTTP], [ART], [CP], [REV]: scoped continuations/artifacts, unknown/financial field exclusion and sanitized dependency errors. | Full knowledge/file/webhook malicious-content suite, telemetry/support export review and model/client behavior. |
| WF-38 | Partial [ST], [TT], [SCH], [CP], [EXT], [BUDGET]: concurrent claims, bounded shared/per-actor dispatch, nested preflight admission, budget fairness and cancellation. | The specified 20-distinct-staff mixed-workflow 60-minute profile, competing integrations, measured p95/p99/amplification and agreed service targets have not been demonstrated. |

## BENCH-01–06 and release gates

| Benchmark | Existing local evidence | Required before claiming acceptance |
| --- | --- | --- |
| BENCH-01 | [HTTP], [ADMIN], [EXT]: protocol/authentication/session isolation and challenge behavior. | Actual supported-client sign-in, token refresh, reconnect and employee continuity. |
| BENCH-02 | [ID], [WF], [EXT], [ART]: two-principal visibility/call-time denial, actual parent scope, field filtering, wrappers and artifact isolation. | Separate header acceptance, native attribution and native allowed/denied enforcement for every enabled operation. |
| BENCH-03 | [MCP], [EXT], [SCH], [FW]: mandatory eight plus coordinated five registered and operational in fixtures, direct execution and saved effect checks. | Real business names/defaults, full designated-record named-tool demonstration and native readback/attribution. |
| BENCH-04 | [WF], [TD], [EXT]: actual synthetic notes beyond ten records, internal-note scope, real time entries, pagination and explicit incompleteness. | Live source links, older/multi-page tenant evidence and completion of any required live collection gaps. |
| BENCH-05 | [DR], [WW], [ST], [WST], [CP]: simulator acceptance/response-loss/crash windows, durable reload, exact saved IDs and no blind replay. | Retained sanitized run evidence and operator recovery demonstration; do not inject destructive faults into production. |
| BENCH-06 | [EXT], [CP], [ADMIN]: focused console sessions/CSRF, mappings, templates, switches, activity, jobs and recovery endpoints. | Real operator setup/recovery, keyboard/screen-reader review and deployed access controls. |

Gate A has local foundation evidence but remains subject to the exact shipped-scope review and fresh full verification. Gate B is unqualified: no enabled operation has tenant evidence in the inventory. Gate C requires actual supported clients. Gate D requires deployment, restore/key recovery, rotation, incident/runbook and operator acceptance; PGlite migration/reconstruction and offline preflight tests do not establish a production restore or RPO/RTO. Gate E remains open for the full 231-label objective. The eight-plus-five catalog does not complete Gate E or the whole product.

## Remaining scope: implementation versus external qualification

**Implemented but externally unqualified:** scoped technician adapters/workflows, shared authenticated transport and budgets, per-operation metadata/evidence gates, durable journals/jobs, focused operator controls, and protected local artifacts. Remaining evidence includes real tenant metadata/effective dates/required fields, designated allowlisted records, employee permission enforcement and attribution, stable approved API origin, production request allowance, TLS/Entra/client configuration, deployment/recovery exercises and business acceptance. Default fixture/bootstrap evidence enables no real tenant operation.

**Historical broader backlog at the original snapshot:** ticket creation and broader history/contact/site/knowledge routes, checklist libraries/templates; delegated/team time and broader finance workflows; task/general scheduling and atomic capacity reservation; full CRM and project/dependency packs; finance/contracts/adjustments/invoices; assets/subscriptions/protected UDFs beyond linked operational assets; quotes/procurement/inventory; knowledge/document/UDF/platform administration; full webhook/gap reconciliation; report definitions/joins/streaming output; and the detailed entity/report/sync console. These are the remaining WP-16–29/domain obligations, not actions that become available merely by deploying or adding credentials. Each applicable entity-operation remains planned in the registry until its implementation and evidence exist.

Local CSV exports cover one authorized ticket, bounded notes, or actual own ticket time with trusted projections, formula neutralization, encryption, current per-record authorization, retention/quota/audit and PostgreSQL catalog parity. Local upload staging requires a verified injected scanner and never publishes an Autotask attachment. The fixed HTTPS scanner gateway is a protocol adapter, not an antivirus engine. Real scanner operation, remote attachment routes, other parent types, invoice rendering and the full report/file-intent workflow remain separate work. See [ARTIFACTS.md](ARTIFACTS.md).

The [original traceability table](planning/autotask-mcp-plan/15-TRACEABILITY.md) remains preserved as the requirement ledger. Its R-01–64 acceptance obligations are not replaced by narrower fixtures. In particular, preserving unknown **permitted** native fields requires reviewed field classification beyond today's explicit projections; restricting unclassified data is not completion of that full schema requirement. No requirement is silently reclassified as unsupported or removed.

[WF]: ../tests/workflows.test.ts
[TD]: ../tests/technician-domain.test.ts
[FW]: ../tests/fixed-workflows.test.ts
[TT]: ../tests/technician-transport.test.ts
[SCH]: ../tests/scheduling.test.ts
[AW]: ../tests/autotask-writes.test.ts
[WW]: ../tests/write-workflows.test.ts
[DR]: ../tests/document-recovery.test.ts
[WPF]: ../tests/write-preflight.test.ts
[RES]: ../tests/resolution.test.ts
[META]: ../tests/metadata.test.ts
[MCP]: ../tests/mcp-writes.test.ts
[EXT]: ../tests/extended-system.test.ts
[ID]: ../tests/identity-policy.test.ts
[CP]: ../tests/control-plane.test.ts
[ST]: ../tests/storage.test.ts
[WST]: ../tests/workflow-storage.test.ts
[HTTP]: ../tests/http.test.ts
[ADMIN]: ../tests/admin-session.test.ts
[PB]: ../tests/playbooks.test.ts
[ART]: ../tests/artifacts.test.ts
[REV]: ../tests/read-revocation.test.ts
[BUDGET]: ../tests/request-budget.test.ts
