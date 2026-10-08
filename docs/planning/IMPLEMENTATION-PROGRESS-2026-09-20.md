# Integration, Project 2.0 and diagnostics implementation

Delivery order: RMM/IT Glue, Project 2.0, then tool-call diagnostics. Base: GitHub main `efae344`; branch `feat/integrations-project2-diagnostics`. Candidate release: `0.2.0-integrations-diagnostics.20260920.1`. This records local implementation and acceptance evidence; it does not represent a deployed release.

Final local checks: **980 tests pass**; TypeScript and production image build pass; both protocol identities and mounted-volume fsync pass in the compiled unprivileged container; real desktop/mobile console checks pass.

## Completion audit

**Implementation complete for all three reviewed candidate workstreams.** A separate read-only audit confirmed the implementation/test mapping and the 980-test pass. Remaining account/host acceptance and deliberately deferred features are listed below, not marked shipped. Deployment is deferred at the user’s request; this delivery is source commit/push only.

## 1. RMM and IT Glue

Implemented the current RMM baseline and the P0–P3 integration code scope. Existing RMM operations remain available; expected-value conflicts and queued-device movement checks were strengthened. IT Glue adds separately granted documentation permissions, regional encrypted configuration, explicitly verified company mappings, scoped reads, authoring, native receipts and staged document media. Related-item, expiration and reference reads have reviewed routes. Cross-provider ticket context and bounded inventory comparison retain independent completeness and matching provenance.

Evidence: [IT Glue behavior and qualification](../ITGLUE-IMPLEMENTATION.md), [media](../ITGLUE-MEDIA.md), [cross-provider workflows](../PROVIDER-COMPOSITES.md), [RMM baseline](DATTO-RMM-BASELINE-2026-09-17.md). Fixture, migration, transport, scope/revocation, conflict, uncertain-write and console tests cover the implemented behavior.

Remaining account acceptance: secure IT Glue region/key and license/API access, actual pilot organization/device associations and native response shapes. User-selected live business writes remain pending under the original plan. No credentials or live provider records were changed by this implementation.

Superseding decisions: deprecated RMM mute/unmute and API-key reset remain excluded. The already-shipped scanner removal supersedes the older media scanner prerequisite; the removed scanner was not restored. P4 secret retrieval, account administration and bulk destructive operations remain explicitly deferred scope.

## 2. Project 2.0

| Work package | Local implementation / acceptance |
| --- | --- |
| W01–W02 | Real HTTP protocol harness, baseline/after measurements, shared trace context and provider-attempt instrumentation |
| W03 | Bounded streaming with backpressure, early progress, read cancellation/deadlines and separately bounded post-write verification |
| W04–W05 | Immutable schema publication cache, deterministic metadata digest, bounded authorized discovery, effect model, safe read dispatcher and opt-in stable technician profile |
| W06–W07 | Scoped stage reuse, bounded caches, cancellation-aware coalescing and fresh ownership checks; RMM context fixture calls reduced from 11 to 5 |
| W08 | Ticket, company and device investigations with evidence/provenance, limitations and independent source continuations |
| W09 | Persisted read reports, encrypted inputs/results, renewable fenced leases, cancellation/restart limits, actor quota and expiry |
| W10 | Tasks status/result adapter implemented and tested; native Tasks routing disabled because the installed SDK does not route its modern methods; ordinary report tools are supported |
| W11 | Scoped company selection with actual SDK MRTR round-trip, replay/expiry binding and explicit selection fallback; opt-in until host qualification |
| W12 | IT Glue provider and cross-provider correlation implemented; account qualification remains above |
| W13 | Optional prompts/resources/subscriptions remain deferred without a concrete qualified host use case, as permitted by the plan |
| W14 | Versioned candidate, migration/packaging checks and release evidence; deployed identity and fresh ChatGPT/Codex acceptance remain external gates |

See [discovery](../PROJECT2-DISCOVERY.md), [read investigations](../READ-INVESTIGATIONS.md), [read selection](../PROJECT2-READ-SELECTION.md), [durable reports](project2-baseline/DURABLE-REPORTS.md) and the [original research bundle](project-2.0-2026-09-17/README.md). The full catalog remains the default. Private protocol metadata TTL caching and host-specific features are not silently enabled. Fixture reductions do not establish production latency or assistant-turn reductions.

## 3. Tool-call diagnostics

Implemented durable start-before-validation and terminal-before-response capture, including SDK validation errors; root/child/background correlation; provider attempts; allowlisted summaries; accepted-write verification comparisons; attachment handoff/URL-policy evidence; encrypted PostgreSQL details and fsynced persistent spool fallback; replay deduplication; abandoned-start recovery; seven-day history/expiry; fail-closed admission and readiness; and tenant-scoped admin list/detail/export with fresh administration permission and access audit.

The console provides filters, keyset pagination, sanitized event/child details and audited JSON copy. It exposes degraded history and capture/backlog health. Logging failure after an accepted write preserves the business receipt and blocks future admission; diagnostics never retries business actions.

See [durability and deployment contract](../DIAGNOSTIC-DURABILITY.md) and [performance evidence](diagnostics-validation/BENCHMARK.md). Local fault tests cover database/spool failure, fsync replay, corrupt tails, stale leases, expiry, tenant/role revocation, pre-SDK attachment rejection and accepted/unverified writes. The historical note incident is not retrospectively diagnosed; fixture reproduction now distinguishes failed readback from mismatched fields.

See [candidate validation](VALIDATION-2026-09-20.md) for reproducible checks and image identity.

## Release gates

1. Supply IT Glue connection details through the secure configuration path and perform reviewed read-only pilot qualification.
2. Provision the distinct diagnostics key and persistent volume; verify fsync/crash recovery, disk alerting, throughput/WAL and backup retention on the deployment host. Diagnostics remains opt-in until configured.
3. Apply migrations 017–019 using the migration role and validate restricted runtime privileges. Preserve the prior image for application rollback; additive tables need not be dropped.
4. Deploy the uniquely tagged candidate, verify live initialization/discovery and `at_diagnostics`, then refresh and qualify actual ChatGPT/Codex clients. No separately versioned plugin package was introduced.

No sampling or daily event cap was added. Capacity limits bound concurrent work and individual event sizes, not history count. Seven-day active-history expiry does not prove deletion from unqualified backups.
