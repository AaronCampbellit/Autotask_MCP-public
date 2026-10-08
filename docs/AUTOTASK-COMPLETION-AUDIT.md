# Autotask completion audit and delivery order

> Historical audit of revision `0439edb` (September 15). Its counts, A1 gaps and RMM delivery order are superseded by [the current tracker](LOCAL-BUILD-TRACKER.md), [supporting tools](SUPPORTING-TOOLS.md) and [RMM coverage](RMM-EXPANDED.md). The work-package analysis below is retained as evidence for that revision.

Reviewed September 15, 2026 against source revision `0439edb`, the declared catalog, release records and original delivery plan. This is a repository audit, not a fresh deployment or tenant test. **The deployed pilot is not the completed Autotask product. Finish the applicable Autotask backlog before the RMM / IT Glue expansion.**

## What the numbers establish

- The catalog declares 216 MCP operations. The latest release record reports 210 available and 592 passing fixture/mock tests. Tool counts are not entity or acceptance counts.
- The original plan covers 231 distinct entity labels (232 index rows), 36 work packages and 64 requirements.
- `registry/coverage.json` is explicitly dated September 10 and reports 25 implemented operation slices. It is historical and cannot measure the expanded runtime.
- The new [entity evidence index](AUTOTASK-ENTITY-RECONCILIATION.json) retains all 231 labels and their original operation declarations/routes, with candidate current code/test locations. It finds exact-name code references for 68 labels and test references for 58. These are search counts, not implemented or tested entity counts. An entity mentioned in a schema union or test may have no live adapter; aliases/indirection may escape exact-name search.
- Every entity still needs a reviewed per-operation disposition before full-product acceptance. Do not calculate a completion percentage from these mismatched units.

Rebuild the navigation index with `python3 scripts/reconcile-coverage.py`. The script preserves the original planning files and historical registry. A separate current ledger is preferable to rewriting historical evidence.

## Important corrections from code review

| Area | Evidence and conclusion |
| --- | --- |
| Site context | [HttpTechnicianPort.collection](../packages/technician/src/http.ts) explicitly returns unavailable for `site`; naming `CompanyLocations.get` in the operation union/runtime list does not implement its transport route. |
| Contact and checklist context | [Technician transport](../packages/autotask/src/technician-transport.ts) does implement `Contacts.get` and `TicketChecklistItems.query`. Its fallback comment is stale. Contact linking is also wired through [operational metadata](../packages/operational/src/metadata.ts). Historical claims that all these routes are unavailable must not be copied into the current backlog. |
| History and continuation | Ticket history has a reviewed single-ticket query, but [collection](../packages/technician/src/http.ts) rejects continuation input. Broader history/detail classification and usable continuation remain work; history is not wholly absent. |
| Workday completeness | [Own-work reads](../packages/technician/src/http.ts) label bounded task/ticket results partial and omit unsupported internal/other time. [Workday schema](../packages/workflows/src/technician-workflows.ts) requires date/timezone. Dedicated internal-time creation does not complete workday reporting or timezone defaults. |
| Files | [Attachment adapter](../packages/attachments/src/http.ts) supports validated staged uploads; see [scanner removal](SCANNER-REMOVAL.md) for the pending release. Broader parent/note/time attachment workflows remain a separate gap. |
| Reporting/sync | [Reports](../packages/reports/src/index.ts) and [sync](../packages/sync/src/index.ts) implement bounded aggregation/change scans and a receipt inbox. These do not establish a full report engine, mirror or gap-reconciliation worker. |
| Recovery/retention | [Worker](../apps/server/src/job-worker.ts) performs expired-artifact cleanup. This is not journal ciphertext purge, key rotation or a demonstrated production restore. |

## Reconciliation of all original work packages

“Implemented slice” means code exists for a bounded part of the package. None of these rows certifies the original package's complete acceptance criteria. Source links point to current implementation or the recorded evidence, not proof of every possible route.

| Work package | Present evidence | Remaining work / disposition |
| --- | --- | --- |
| WP-01 Decisions | [Current pilot decisions](CURRENT-STATUS.md) | Preserve one-user/application-scope decisions; record full-product release owners and applicable acceptance scope. |
| WP-02 Entity review | Original inventory; current entity evidence index | Review every exact entity-operation, special/child route, metadata rule and support discrepancy; replace stale current-progress assumptions. |
| WP-03 Runtime/client foundation | [Dependencies](DEPENDENCIES.md), server app | Maintain supported revision evidence; complete actual supported-client matrix. |
| WP-04 Client authentication | Codex recorded working; tunnel activation recorded | ChatGPT end-to-end checks remain pending in record; other planned clients lack current qualification. |
| WP-05 Build/deploy | [September 15 build record](VERIFICATION.md) | Retain reproducibility, upgrade/rollback and CI evidence for each release; no fresh build asserted here. |
| WP-06 Storage | Ten migrations, journals/jobs/artifact catalogs | Actual restore/rollback and matching-key recovery exercise. |
| WP-07 Identity | [Identity](../packages/identity/src/index.ts), Entra/member mapping | Validate revocation/client continuity; native permission enforcement is a changed pilot requirement, not silently passed. |
| WP-08 Policy | [Policy](../packages/policy/src/index.ts), per-parent guards | Extend field/scope cases with every new operation; full policy simulator/long-tail coverage review. |
| WP-09 HTTP | [Autotask adapter](../packages/autotask/src/index.ts), shared budget/transport | Review exact routes/error/identity behavior for remaining domains. |
| WP-10 Metadata | [Metadata modules](../packages/metadata/src/index.ts), operational/business metadata | Full UDF classification, permitted unknown fields, long-tail schema/drift review. |
| WP-11 Queries | Scoped queries and signed continuations in implemented packs | Complete missing collection continuations; general root/child semantics across remaining entities. |
| WP-12 Mutations | Durable intents, preconditions and scoped readback | Extend per-operation reconciliation and conditional rules to remaining writes. |
| WP-13 Execution controls | [Execution policy](../packages/control-plane/src/execution.ts) | Complete action-specific coverage for remaining billing/bulk/destructive operations; no generic bypass. |
| WP-14 Catalog | [216 declared operations](TOOL-CATALOG.json) | Add only implemented tools; retain runtime registration/schema/permission parity. |
| WP-15 Jobs | [Worker](../apps/server/src/job-worker.ts), fixed workflow journals | Full planned job/checkpoint coverage and deployed recovery/capacity evidence. |
| WP-16 Tickets | Search/create/update, notes, context, checklists | History continuation/classification, remaining checklist library/template and ticket-context surfaces. |
| WP-17 Time/expenses | [Work management](WORK-MANAGEMENT.md), own ticket time | Complete internal-time read/workday coverage, delegated time, remaining timesheet/approval and native rule coverage. |
| WP-18 CRM | Contact lookup/linking, company references, CRM to-dos | Company/contact administration, protected site/location data and remaining CRM relations. |
| WP-19 Scheduling | [Scheduling](../packages/scheduling/src/index.ts), availability/time off | General/task appointments and remaining scheduling constraints; do not promise atomic reservations without native support. |
| WP-20 Projects | Projects/phases/tasks/dependencies, project/task notes | Full cross-entity context and remaining project child entities/operations. |
| WP-21 Finance | [Business pack](BUSINESS-MCP.md), contracts/adjustments/invoice slices | Remaining billing/finance entities, conditional writes and reconciled reporting; live financial write validation is user-controlled. |
| WP-22 Assets/reference | Configuration items, subscriptions, selected catalogs | Remaining asset children/reference catalogs, protected UDFs and inactive-value handling. |
| WP-23 Sales/inventory | [Sales](SALES-MCP.md), procurement/stock slices | Remaining entity-operation review; quote delivery/acceptance/Won is a deliberate native-UI handoff, not an implemented REST action. |
| WP-24 Knowledge/admin | Metadata/reference support only for bounded surfaces | Knowledge/article/document routes, visibility, UDF and resource/platform administration. |
| WP-25 Files | [Direct ticket attachments](TICKET-ATTACHMENTS.md), validated staged artifacts | Other parent types, nested note/time attachments and their file/security cases. |
| WP-26 Sync | Signed receipt inbox, dedupe/gap hints, ticket change scans | Owned subscriptions, durable reconciliation, deletion/order/gap handling, scoped freshness; current LAN reachability constraint still applies. |
| WP-27 Reports | Bounded workload/pipeline reports, exports | Definitions, joins, streaming outputs and currency/timezone reconciliation. |
| WP-28 Console | Mapping, capabilities, switches, activity/jobs/recovery/files | Detailed entity/report/sync interfaces and human accessibility acceptance. |
| WP-29 Operations | Write pause, audit, bounded requests, encrypted artifacts | Journal purge/key rotation, safe support bundles, restore/incident exercises and measured load targets. |
| WP-30 Release | Dated pilot verification records | Close applicable client/business/operator acceptance; Gate E needs complete per-operation reconciliation. |
| WP-31 References/defaults | Scoped ticket/company/contact/resource resolution | Employee timezone/workspace fallback and remaining reference/default eligibility coverage. |
| WP-32 Evidence workflows | Purpose-specific context, workday/visit | Site evidence, continuation, internal-time completeness, related-ticket/knowledge context and source enrichment. |
| WP-33 Document work | [Fixed workflows](../packages/workflows/src/technician-workflows.ts), durable runner | User live note/time readback and operator/client recovery acceptance. |
| WP-34 Handoff/resolve | Eligible handoff and ordered completion | Remaining native completion cases and user live validation; no closure on missing evidence. |
| WP-35 Playbooks | Five versioned [playbooks](../packages/playbooks/src/index.ts), authoring standard | Keep descriptions current and validate real-client routing/injection behavior. |
| WP-36 Evaluation | Fixture/mock scenarios and recorded regression suites | Real-client prompt/routing/comprehension evaluations, operator usability and measured concurrent workload. |

## Ordered Autotask delivery backlog

### A1 — complete daily technician evidence first

Owning packages: WP-11,16–19,31,32. This is the recommended next implementation batch.

- [ ] Implement the exact scoped company-location/site read route and wire it into ticket context/visit preparation. Check native metadata and parent relationships before enablement.
- [ ] Add supported continuation for history/checklist evidence and paginated workday task/time/ticket collections. Preserve actor, filters and scope; respect native endpoints that cannot paginate.
- [ ] Include eligible internal-time reads in workday totals with explicit source/type distinctions.
- [ ] Add configured employee timezone and documented workspace fallback; retain explicit input override and DST validation.
- [ ] Verify source links and context labels for missing/partial/complete collections.

Exit evidence: meaningful adapter/runtime tests for out-of-scope and moved parents, revocation during waits, multi-page results, unsupported native continuations, internal-time totals and timezone boundaries; read-only designated-record checks; updated docs. No live test writes are needed to validate these reads.

### A2 — CRM and remaining work management

Owning packages: WP-16–20,25. Deliver scoped company/contact/location administration, checklist libraries/templates where supported, general/task scheduling, delegated time and remaining project/file child operations. Split each into exact native operation tasks with required fields, policy, expected values and readback before coding. Business mutations remain user-tested.

### A3 — Autotask knowledge, assets, finance and long-tail coverage

Owning packages: WP-02,10,20–24. Review all 231 entity rows, including commands and routes outside ordinary CRUD. Deliver missing supported operations in domain slices; keep documented unsupported operations and manual alternatives explicit. Do not equate one implemented query with complete entity support. Knowledge retrieval and protected UDFs need visibility/field classification before exposure.

### A4 — reports, synchronization and operator surfaces

Owning packages: WP-26–28. Implement report definitions/joins/streaming and scoped reconciliation, then the matching console views. Resolve webhook reachability within the selected hosting model before configuring subscriptions. No public endpoint is authorized by this roadmap.

### A5 — operational and release acceptance

Owning packages: WP-03–08,15,29,30,35,36. Track client validation and recovery evidence alongside earlier batches; do not wait until the end to record failures. Finish purge/key rotation, backup/restore/incident exercises, accessibility/client evaluation and applicable load targets. User-controlled live business tests stay separate from automated fixture checks.

## Explicit decisions and open acceptance

- **Retained decision:** application-controlled company/capability access replaces the original requirement to prove native employee read-permission enforcement for the pilot. Preserve R-49/R-50 provenance and attribution limitations; do not claim their original native-enforcement gates passed.
- **Retained decision:** one enabled user and the existing company scope. Twenty-user load qualification remains an original-plan evidence gap, not permission to add users.
- **Retained decision:** quote send/PDF/acceptance/Won use native UI workflows. [Investigation](QUOTE-DELIVERY-INVESTIGATION.md) records the boundary. Saving a quote does not send or accept it.
- **Open validation:** record current ChatGPT results if completed elsewhere; tunnel health alone is insufficient. Other planned client qualifications also remain explicit until tested or scope is deliberately changed.
- **Deferred expansion:** [RMM / IT Glue research](planning/rmm-itglue-2026-09-15/README.md) stays preserved for after applicable Autotask completion work; no providers or tools are enabled by this audit.

## Full-product completion gate

For every applicable operation retain exact native support/route/schema, runtime tool mapping, field and parent policy, automated test evidence, native validation appropriate to its effect, error/recovery behavior, enabled version and operator documentation. Supported but unimplemented remains backlog; unknown support needs an evidence-resolution task. Record acceptance exceptions against the original [64 requirements](planning/autotask-mcp-plan/15-TRACEABILITY.md), not by silently editing preserved requirements.

This audit completes work-package reconciliation and prioritization. The entity index is a complete navigation inventory; detailed per-operation implementation/acceptance certification remains A3 work. No full-product completion or fresh test/deployment result is claimed.
