# Reports and synchronization

The webhook receiver is optional. It stores bounded receipts and exposes gap hints for a later authorized fetch; it is not a full synchronization or mirror service.

The research/design boundary for a future complete reporting and synchronization engine is recorded in [REPORTING-SYNC-RESEARCH.md](REPORTING-SYNC-RESEARCH.md). That work is not implemented here.

`ticket_workload_report` groups the exact requested ticket search by company, technician, status, queue or priority. `sales_pipeline_report` groups opportunities by company, owner, stage or status. Both use the same public dispatch controls as their source tools, default to one page, permit at most ten pages per invocation, and label partial counts. Repeated IDs are deduplicated and make completeness uncertain. Revenue is not summed across potentially different currencies or recurring periods. Records can change during pagination; a complete traversal is not an atomic snapshot.

`sync_ticket_changes` provides a read-only activity-window scan for tickets. Supply explicit `since` and `through` timestamps, optional company and `technician: self`, and follow source continuations with exactly the same window. Windows must be in the past and at most 31 days. Use overlap and deduplication between scans. This does not detect deletions or records without activity timestamps, store a replica, or schedule itself.

## Webhook receiver

A configured receiver accepts `POST /webhooks/autotask`. It verifies the native `X-Hook-Signature` (Base64 HMAC-SHA1 over exact request bytes), binds the event to a configured tenant/GUID/entity, stores receipt metadata in PostgreSQL, and deduplicates by subscription sequence. Unrecognized subscriptions and invalid signatures are rejected. Raw payload fields and customer text are discarded. Sequence gaps and deactivation hints are available through `sync_status` for platform managers.

This is a receipt inbox, not a complete synchronization engine. It does not modify business records, automatically create subscriptions, process deleted records into a mirror, or claim freshness. Future consumers must fetch current authorized records and implement retention and gap reconciliation for their exact indexed scope.

The optional `AUTOTASK_WEBHOOK_BINDINGS` secret setting is a JSON array of `{tenantId,guid,entityType,secret}` values. Use the exact native subscription GUID and EntityType from its documented configuration. Secrets must be 16–64 characters. Keep this value in the secret environment, not a checked-in file or model-facing tool. An empty configuration leaves the receiver unregistered. A cloud callout cannot reach the current LAN-only deployment directly; no public exposure or cloud subscription was configured by this build.

Sources: [native payload and sequence definitions](https://www.autotask.net/help/developerhelp/Content/APIs/Webhooks/Webhooks_Creating.htm), [signature verification](https://autotask.net/help/developerhelp/Content/APIs/Webhooks/SecretKeyPayloadVerification.htm).
