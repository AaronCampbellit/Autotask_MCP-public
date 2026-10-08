# Deployment, releases and operations

**Portable production shape**

Build OCI containers for the server/console and worker, with PostgreSQL as the durable dependency. Ship a small-host compose profile and documented configuration for an existing container platform. Keep public DNS/TLS, Entra, secret storage, database and optional object storage configurable. Do not require an Azure service to host the application merely because Entra authenticates users.

Run non-root, use a read-only application filesystem where practical, and provide dedicated writable volumes only for intentional state. Apply resource limits and graceful shutdown. Never put API credentials or signing keys in the image. Health checks must exercise real readiness, not simply print success.

**Configuration contract**

| Group | Required settings |
| --- | --- |
| Application | Environment, canonical MCP URL, portal URL, allowed origins, trusted proxies, supported protocol profiles |
| Identity | Entra tenant/issuer, intended audience, client-registration mode, bootstrap admin binding, session policy |
| Autotask | Credential secret references, integration code, zone-discovery policy, allowed hosts, enabled credential profiles |
| Policy | Published policy version, default role bindings, enabled domains/operations and financial field classification |
| Persistence | Database connection secret, encryption-key reference, migration version, artifact storage adapter |
| Capacity | Interactive/job concurrency, tenant/principal quotas, request deadlines, export caps, upstream budget allocation |
| Files/sync | Upload scan provider, byte limits, retention, webhook signing-key references, reconciliation windows |
| Operations | Telemetry destinations, redaction policy, alert routing, audit retention, backup targets and write-pause controls |

All required production settings validate at startup. Missing identity or policy configuration must not cause a fallback to unauthenticated/shared unrestricted mode. Development defaults are explicitly segregated and cannot be selected accidentally by an absent environment variable.

**Release pipeline**

Lint/type-check; registry/schema validation; meaningful unit/contract/fault tests; dependency/security checks; container build and scan; software bill of materials; reproducible version metadata; signed image/provenance if available; staging/client tests; approved promotion. Pin dependencies and image digests. Automate update proposals, but require review of protocol/auth/schema changes.

Version the server, public tool contract, capability registry, policy and database schema separately. Breaking tool changes need a migration/deprecation path and client catalog refresh guidance. Maintain fixture compatibility for supported client revisions. A docs-only reference change does not automatically enable a new write.

Use expand/contract database migrations where needed to allow a safe rollback window. A rollback cannot reverse already executed Autotask business changes. Record which service/registry version dispatched each operation. Drain workers or use compatible job payload versions during upgrade; do not strand queued work on an incompatible schema.

**Observability**

Metrics: request counts/latency/errors by logical operation and status class; Autotask call counts/429s/latency; remaining observed budget; queue depth/age; unknown writes; readback mismatches; metadata drift; webhook lag/gaps; artifact bytes; revocation delay; database/worker health. Keep customer names, ticket contents, raw IDs and principal emails out of metric labels.

Trace the client request → policy → registry → upstream call → verification → job/audit correlation. A trace ID must not become a bearer credential. Provide sanitized logs for routine debugging and a separately authorized detailed audit lookup for record-level work.

Alert on unknown mutation outcomes, dispatch-authorization failures, repeated auth/policy failures, sustained 429s, signature failures, stalled jobs, growing sync lag, database readiness loss and backup failure. Thresholds are tuned in pilot; the plan does not assume an unlimited API quota.

**Proposed service objectives**

Capacity baseline is confirmed at 20 employees, all potentially active during office hours. Use per-user fair queues, bounded ticket-context expansion, cached metadata and lower-priority exports to avoid monopolizing the database-wide Autotask budget. Track upstream calls per logical tool invocation; one MCP operation may require several reads plus a write and verification. Daily request volume remains a measurement item.

Application availability target: 99.9% monthly, measured separately from Autotask and identity-provider outages. Proposed initial recovery objectives: configuration backup RPO no more than 24 hours, operation-journal/audit RPO no more than five minutes using continuous database recovery, and RTO within four hours. A restore can still lose evidence of an upstream write, so reconcile the recovery window before dispatch resumes. These are decision inputs, not promised SLAs. Choose targets with Rarity's operating owner before release.

For mutations, correctness takes precedence over latency: a late/unknown result is reported honestly. Keep direct-read service available where safe during write pauses. Report dependency degradation rather than misclassifying it as empty data.

**Runbook catalog**

| Runbook | Required procedure |
| --- | --- |
| Onboard employee | Entra assignment, resource mapping, effective-policy preview, client setup and read probe |
| Offboard employee | Local disable/revoke, queued-work stop, identity-provider action, confirmation of denied access |
| Rotate API/identity/webhook secret | Stage new reference, validate, switch, observe, revoke old credential; safe rollback |
| Autotask throttling | Inspect observed shared usage, reduce jobs, preserve interactive capacity, honor retry timing |
| Unknown write | Freeze duplicate retries, inspect journal/native records, reconcile, document manual resolution |
| Readback mismatch | Preserve requested/actual diff, stop dependent steps, investigate rule/schema drift |
| Webhook gap | Verify delivery/auth, quarantine bad input, reconcile affected window, update freshness only after completion |
| Schema drift | Diff metadata, disable affected write, update validators/fixtures, qualify and re-enable |
| Lost admin access | Use documented break-glass identity/console procedure; no unauthenticated bypass |
| Database failure/restore | Pause writes, restore database and keys, reconcile in-flight operations before worker resume |
| Release rollback | Restore compatible service/config, retain job/journal state, assess already committed business effects |
| Sensitive-data exposure | Revoke affected access/artifacts, preserve audit, determine records and clients, follow Rarity incident process |

**Backup and retention verification**

Encrypt backups, restrict keys separately, test restoration and record retention behavior across live data, replicas, object storage and backups. Deleting an expired artifact from the primary store does not prove it is absent from all backups. Support retention reports and legal-hold exceptions only after policy decisions establish their scope.

**Support bundle**

Export server/SDK/protocol/registry/schema versions, sanitized configuration names, dependency health, recent error classes, trace IDs, queue summary and metadata-drift summary. Exclude tokens, API secrets, webhook secrets, complete notes, attachments and confidential prices. Provide an explicit operator preview of bundle contents.

**Technician workflow measurements**

Record versioned workflow outcome and per-step latency/error classes, resolver/cache overhead, continuation counts and recovery results. Evaluation captures avoidable questions, tool selection and technician comprehension with redacted fixtures; production metrics use low-cardinality operation/status labels, never names or note text. Pin workflow/default/playbook versions and retain versions needed to understand durable in-flight operations. A release cannot silently reinterpret queued payloads or default dates. See [19](19-TECHNICIAN-WORKFLOW-EVALUATION.md).
