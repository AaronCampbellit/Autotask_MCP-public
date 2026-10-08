# Reporting and synchronization research

**Reviewed:** September 23, 2026. **Status:** research only. No synchronization engine, subscription manager, public endpoint, or report-definition system was added in this step.

## Current boundary

The MCP has bounded ticket/pipeline reports, a read-only 31-day ticket activity scan, and an optional webhook receiver that verifies signatures and persists event receipts. The receiver does not fetch records, update a replica, reconcile gaps, detect general deletions, or provision subscriptions. The current hosting/deployment notes say the service is LAN-only, so Autotask cannot call its webhook endpoint directly.

The last paragraph matters for deletion claims: an API query that no longer returns an ID is not enough to mark a row deleted. It can also mean scope, permissions, filtering, temporary unavailability, or incomplete pagination changed.

## What Autotask exposes

| Source | Native behavior | Design consequence |
| --- | --- | --- |
| Webhooks | Current documented support is Companies, Contacts, Assets/Configuration Items, Tickets, and Ticket Notes. Webhook field metadata says which fields can trigger or be included. | Webhooks can reduce latency for these entities. Discover support and supported fields from current entity metadata; do not assume other entities support callouts. |
| Delivery | Callouts include `Action`, `Guid`, `EntityType`, `Id`, `EventTime`, and `SequenceNumber`; the sequence is monotonic but gaps can represent events sent to the error log. Failed delivery is retried up to five times, then recorded for 30 days. Deactivation can follow repeated delivery failures. | Treat events as at-least-once hints. Persist before replying 2xx, deduplicate by tenant/GUID/sequence, alarm on payload-hash conflicts and sequence gaps, and recover from the native error log while it retains events. |
| Webhook setup | Each subscription requires an externally reachable POST URL and a separate deactivation URL, plus configured event/field subscriptions and a secret. There is a 50-active-webhook-per-entity/site cap; event volumes above 1,500 callouts/hour/entity can delay delivery. | Select and qualify public ingress before creating subscriptions. Add health checks, secret rotation, deactivation handling, and API-side configuration readback. Do not enable subscriptions against the current LAN-only service. |
| Change timestamps | Selected entities expose `LastModifiedDate` or `LastActivityDate`; availability and field names differ by entity. | Build an entity capability map from live metadata. Poll changed records only when the timestamp field is available and queryable; use overlapping windows and stable ID deduplication. |
| Deletion evidence | `DeletedTicketLogs` is available for deleted tickets but requires Admin-level Projects & Tasks or Service Desk access. `DeletedTicketActivityLogs` and `DeletedTaskActivityLogs` describe deleted ticket/task time, note, and attachment activity; they are not general deleted-record feeds. | Deletion detection is entity-specific and permission-dependent. There is no documented universal deletion feed for every entity in the API catalog. |
| Query scale | Native queries return up to 500 rows per page; callers must follow `nextPageUrl` without changing the query. Autotask documents a 10,000 external request/hour/database limit and adds latency near the threshold. | Share the MCP's request budget across foreground tools and sync workers. Checkpoint every page and pause/back off on throttling; avoid a full scan on every run. |

## Recommended design

1. **Define the mirror scope first.** Store tenant, API identity, allowed entity set, company/parent filters, field allowlist, and retention policy with each synchronization scope. Do not combine employee-scoped records with an administrator-wide replica.
2. **Build a native capability registry.** For each proposed entity, record query/create/update/delete support, supported webhook callouts and fields, usable modification timestamps, stable IDs, parent/scope relationships, deletion evidence, and required Autotask permissions. Use current `entityInformation` and `entityInformation/fields`; unresolved entries stay unsupported.
3. **Backfill with durable keyset checkpoints.** Query by increasing ID with a fixed field projection and page size. Persist each page and checkpoint in one database transaction. Restart from the last committed ID after interruption; expose run state and partial coverage.
4. **Use webhooks as hints, not as the replica.** Receive and validate the body, persist the minimal event plus hash transactionally, then return 2xx. A worker coalesces duplicate entity IDs and fetches current authorized state. Keep ordered sequence/gap state per tenant and webhook GUID, and process the native error log before its 30-day retention expires.
5. **Poll as a second path.** For entities with supported query timestamps, poll with an inclusive overlap and a `(timestamp, id)` checkpoint, then deduplicate by entity ID and native modification version. For entities without a usable timestamp, schedule bounded keyset sweeps at a lower frequency. Record lag and coverage separately from record freshness.
6. **Reconcile conservatively.** A webhook `Delete` or an authoritative native deletion log may create a tombstone. A record missing from one incremental page may not. For full-sweep absences, first recheck the same scope and source completeness, then verify with a direct read where possible; otherwise mark `deletion_suspected` for later confirmation. Keep prior versions and evidence for tombstones.
7. **Add reporting as a separate read model.** Version report definitions (filters, fields, joins, grouping, date/timezone rules, financial permissions and output limits). Compile only reviewed definitions into bounded source queries, stream pages into durable read jobs or temporary materializations, and return completeness, source timestamps, scope and continuation. Currency conversion and recurring-period normalization need explicit rules before financial totals are reported.
8. **Expose operator controls.** The console should show per-scope entity support, last successful page/checkpoint, webhook readiness/deactivation, error-log backlog, gap count, suspected deletions, reconciliation age, request-budget use, and retention. Pause/resume/rebuild actions need audit records and a preview of affected scope.

## Recommended delivery order

1. Confirm whether the service will receive direct public Autotask callouts and identify the separately hosted deactivation endpoint. This is a hosting decision, not an Autotask MCP write.
2. Produce the per-entity capability/permission matrix for the first requested sync scope, including access to webhook error logs and `DeletedTicketLogs`.
3. Extend webhook handling with durable processing state, error-log recovery and health/deactivation alerts for one supported entity family.
4. Pilot a scoped ticket/company/contact mirror with overlap polling, event-driven refresh, conservative tombstones, and an operator-visible reconciliation report.
5. Expand entity coverage only after each entity's timestamps, parent scope, deletions, field policy, load and tenant permissions are known.
6. Add versioned report definitions and streaming after the sync read model has stable scope, pagination and completeness contracts.

## Open decisions before implementation

- Where should Autotask reach the webhook and deactivation endpoints? The current LAN-only deployment cannot receive either callout directly.
- Which entity families and company/employee scope should the first mirror contain?
- Does the configured Autotask API user have the admin-level permissions needed for deletion logs and access to its own webhook error logs?
- Which fields may be retained, for how long, and who may search/report on them?
- Are reports required to include financial amounts? If so, which currency, exchange-rate date, recurring period, and finance-access rules apply?

## Sources

- [Autotask webhook creation, supported entities, event fields and setup](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/Webhooks_Creating.htm)
- [Webhook error handling, retries and deactivation](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/Webhooks_Error_Handling.htm)
- [Webhook event error logs and 30-day retention](https://autotask.net/help/developerhelp/content/apis/Webhooks/WebhookEventErrorLogEntity.htm)
- [REST best practices and per-entity modification timestamps](https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_BestPractices.htm)
- [DeletedTicketLogs and its permission requirement](https://ww1.autotask.net/help/developerhelp/content/APIs/REST/Entities/DeletedTicketLogsEntity.htm)
- [DeletedTicketActivityLogs](https://ww1.autotask.net/help/developerhelp/content/APIs/REST/Entities/DeletedTicketActivityLogsEntity.htm)
- [DeletedTaskActivityLogs](https://ww13.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/DeletedTaskActivityLogsEntity.htm)
- [REST pagination and the 500-record page limit](https://www.autotask.net/help/developerhelp/content/apis/rest/API_Calls/REST_Advanced_Query_Features.htm)
- [REST request thresholds](https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm)
