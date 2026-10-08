# Verification and release acceptance

The plan separates documentation evidence, simulated tests, and live tenant evidence. No tests below have been run against an MCP implementation or Autotask tenant. A mock response proves our handling of that response, not that Autotask accepts a real request.

**Test layers**

| Layer | Purpose | Required evidence |
| --- | --- | --- |
| Registry/static validation | Detect bad routes, missing scope resolvers, unsupported methods, schema contradictions | Every enabled entity-operation has complete metadata, policy and verification strategy |
| Unit/property tests | Validate filters, field rules, cursors, monetary/time handling and policy algebra | Boundary values and invalid inputs, not tests that merely repeat implementation |
| API contract fixtures | Exercise real response shapes and errors without network mutations | Sanitized versioned fixtures with source/date and represented limitations |
| Fault-injection integration | Prove journals, workers, authorization and caches across failures | Crash windows, timeouts, retries, duplicates, concurrent edits and dependency outages |
| Protocol/client tests | Verify auth discovery, transport versions, listing/calls, result shapes and reconnect | Actual supported Codex, ChatGPT, Claude and Claude Code versions/settings |
| Tenant integration | Establish supported routes, business rules and persisted outcomes | Approved test records, before/after IDs, native attribution and independent readback |
| Operator acceptance | Prove a human can configure, execute within permissions, investigate and recover | Scripted console/runbook exercises with observable results |

**Core case catalog**

| Case | Scenario | Pass condition |
| --- | --- | --- |
| AUTH-01 | Wrong issuer/audience/tenant, expired token, signature failure | Rejected before record access; correct OAuth challenge where applicable |
| AUTH-02 | Unmapped or inactive Autotask resource | No fallback to integration identity; actionable mapping error |
| AUTH-03 | Entra group/app role change and local revocation | Defined propagation bound, caches invalidated, queued work rechecked |
| AUTH-04 | Three supported clients authenticate and refresh | Correct actor identity; no shared-user credential substitution |
| AUTH-05 | Required impersonation ID missing, malformed, nonexistent, inactive, ambiguous or mapped to the wrong employee/instance | No requested business API call; safe mapping error; no header omission/default-resource fallback |
| AUTH-06 | Identity validation unavailable, upstream rejects impersonation, or retry/pagination path loses the header | Requested business operation blocked or stopped; no retry as integration/elevated identity |
| AUTH-07 | Each employee-required entity/method/action exercised with designated resources having different native permissions | Separate evidence for header acceptance, attribution and allowed/denied read/write enforcement; unsupported/unknown enforcement keeps operation disabled |
| AUTH-08 | Mapping revoked or changed after job submission | Remaining work stops; no reassignment to the new resource; journal retains original mapping version |
| POL-01 | Prohibited company via search and direct ID | No record disclosure, including counts and error text |
| POL-02 | Prohibited child ID through an allowed parent argument | Actual parent resolved and access denied |
| POL-03 | Generic wrapper/discovery/catalog bypass | Same denial as the named workflow |
| POL-04 | Financial filter/sort/count/export without finance.read | Forbidden or safely reduced according to explicit policy; no inference leak |
| POL-05 | Caller supplies headers/URL/resource/tenant override | Input rejected; server mapping unchanged |
| POL-06 | Cache/cursor/artifact used after scope removal | Fresh authorization denies access |
| EXEC-01 | Direct bulk, destructive or billing action with all required capabilities | Executes without a separate MCP confirmation or approval step |
| EXEC-02 | Same actions without a required capability or with mixed authorized/unauthorized targets | Entire request denied before dispatch; no approval escalation path |
| EXEC-03 | Payload or target membership substituted after job creation | Request-key conflict; original job cannot execute substituted work |
| EXEC-04 | Duplicate request, concurrent dispatch or permission revoked while queued | Known duplicates reuse journal outcome; no blind retry of uncertain writes; revoked access stops remaining items |
| EXEC-05 | Routine requested edit and optional dry run | Authorized edit executes directly; dry run makes no business mutation and grants no authority |
| API-01 | Root and child query exceed one page | All requested records retrieved or explicit partial result/cursor |
| API-02 | Cursor URL points outside allowed Autotask origin | Rejected before credentials leave server |
| API-03 | Null/false/zero/empty/omitted fields | Correct distinct semantics; no silent value drop |
| API-04 | Required-on-create/read-only-on-update field | Correct operation-specific validation |
| API-05 | PATCH receives 404 | No automatic PUT or changed-route mutation |
| API-06 | Metadata/picklist changes before dispatch | Stale input rejected or safely revalidated |
| API-07 | Read returns unknown permitted fields | Structured detail preserves them; field policy still applies |
| API-08 | 401/403/404/429/5xx and malformed response | Typed sanitized outcome; no broader-credential fallback |
| WRITE-01 | Create accepted but response lost | Unknown outcome reconciled; no blind duplicate |
| WRITE-02 | Worker crashes before/after dispatch or journal update | Correct recovery state; completed action not assumed undone |
| WRITE-03 | Two users patch same relevant field | Documented conflict/precondition behavior; no false atomicity claim |
| WRITE-04 | API ignores/non-normalizes requested field | Readback reports mismatch, not unqualified success |
| WRITE-05 | Create-only operation cannot be directly read | Accepted-unverified or related-record evidence, clearly labeled |
| JOB-01 | Bulk partial failure/cancel/resume | Completed/failed/remaining items exact; remainder keeps fixed payloads and receives fresh authorization |
| JOB-02 | Lease expires and second worker claims work | Fencing/journal prevents duplicate dispatch where determinable |
| JOB-03 | Requester loses access during a job | Remaining items stop; no stale authorization |
| SYNC-01 | Duplicate, out-of-order and gap events | Dedupe/current-state fetch/reconciliation, freshness not overstated |
| SYNC-02 | Bad webhook secret or modified raw body | Rejected without processing |
| SYNC-03 | Excluded scope re-enabled after missed events | Gap remains until reconciliation completes |
| FILE-01 | Oversized, deceptive MIME, malicious upload | Rejected/quarantined before Autotask publication |
| FILE-02 | Unauthorized parent/file/export download | Denied even with a valid artifact identifier |
| FILE-03 | Malicious HTML invoice and CSV formula | Safe download/rendering and formula neutralization |
| OPS-01 | Database/audit unavailable during mutation | New write fails closed; in-flight uncertainty preserved |
| OPS-02 | Backup restore and key recovery | Data recoverable within approved RPO/RTO; no secret loss |
| OPS-03 | Rollout/migration interrupted | Previous compatible service recoverable; pending operations retained |
| OPS-04 | Global/domain write pause | New affected writes stop; reads and in-flight status described correctly |
| SEC-01 | Prompt injection in ticket, KB, file and webhook text | No policy change or unrequested elevated action from content |
| SEC-02 | Secret canaries in errors/logs/support bundles | No sensitive credential value exposed |

**Domain acceptance scenarios**

| Case family | Minimum tenant scenarios |
| --- | --- |
| DOM-TICKET | Required due/work-type defaults, resource-role-queue constraints, internal/external notes, complete history, checklist closure, cross-company references |
| DOM-TIME | Ticket/task/internal time; role/internal code; timezone/duration; existing entry pagination; posted/billed restriction; duplicate uncertainty |
| DOM-CRM | Company/contact/location relationships, protected UDFs, group/team scope and conditional deletion |
| DOM-FIN | Contract type children, effective-dated service/bundle adjustments, costs/rates/currency, invoice outputs and readback mismatch |
| DOM-PROJECT | Phases/tasks/dependencies, cycle/date handling, secondary resources and full project context |
| DOM-SCHEDULE | Ticket/task service calls, appointments, resource eligibility, timezones, overlaps and partial association recovery |
| DOM-ASSET | Protected/masked UDFs, relationships, current-version limitation, subscriptions and expiry evidence |
| DOM-INVENTORY | Partial receiving, stock adjustment/transfer, serial collisions and financial permission |
| DOM-SALES | Product/service/bundle quote items, required period fields, tax/currency and ignored-field detection |
| DOM-KNOWLEDGE | Article/document category child routes, long content, visibility, links and rich-text limits |
| DOM-ADMIN | UDF creation/list/default order, immutable settings, resource update permissions and webhook ownership |
| DOM-REFERENCE | Inactive picklists/reference records, historical reads, alias resolution and unsupported mutations |

For every enabled entity-operation, generate the applicable standard cases: minimum valid input, missing required input, unauthorized record/field, permitted persistence, unrelated-field preservation, pagination/readback, special conditional restriction and uncertain-write handling. Not every operation supports all cases; record a justified N/A rather than a fake pass.

**Tenant test strategy**

Confirmed: only the production Autotask instance is available, and tests must use explicitly designated records. Before live testing, obtain the exact approved test company, contacts, resources where appropriate, queue, project, contract and records. Build a machine-enforced allowlist of those IDs and required parent relationships, with a production-test credential/policy profile that cannot escape it.

Review notification recipients, workflows, billing/contract effects, stock movement, accounting sync and third-party integrations for every planned mutation case. No test should send a customer message, post a real bill, alter working inventory, or deactivate an actual employee. Do not disable shared production workflows as a testing shortcut. Cases that cannot be isolated remain simulated and explicitly unqualified until a safe approved test path exists. The plan does not authorize creating test records, changing tenant settings or submitting live bills.

Separate fixture/fault-injection environments still run locally or in CI without touching Autotask. If a real sandbox is obtained later, use it for broader destructive scenarios, then verify production metadata/permission parity. A future sandbox is not assumed by this delivery plan.

Fixtures contain no real credentials, customer-identifying text or confidential prices. Retain enough field/state structure to reproduce bugs. Cleanup is planned per entity and must not assume deletion is supported; where records cannot be deleted, label/close/deactivate through approved processes.

**Release gates**

**Thread benchmark for the first technician production release**

These are mandatory Rarity acceptance cases, not claims of tests already completed or exact feature parity with Thread. Run across the actual supported client configurations, with designated production records for live checks and a simulator for fault injection.

| Case | Demonstration | Required evidence |
| --- | --- | --- |
| BENCH-01 | Connect once in each supported client and continue working | Per-client setup/sign-in, refresh and reconnect succeed; correct employee persists without repeatedly entering API credentials; sessions are not shared between clients |
| BENCH-02 | Two employees with different permissions request the same allowed/forbidden operations and data | Correct tool visibility plus call-time denial, financial/record isolation, no generic-wrapper bypass, and separate native impersonation enforcement evidence |
| BENCH-03 | Search a ticket, update it, add a note, log/read time and schedule work through named tools | Every mandatory named tool is discoverable for entitled users; normal business names resolve without raw entity queries; stored results and native/application attribution are verified; permitted writes have no extra MCP approval step |
| BENCH-04 | "Show me what happened on this ticket, including internal notes and time already logged" | Real authorized notes/time across multiple pages, including older records beyond the first ten messages; source links and per-collection completeness; no invented time totals, silent omission or prohibited-record leakage; a budget-limited retrieval is explicitly partial with usable continuation |
| BENCH-05 | Interrupt a note/time write after simulated upstream acceptance but before confirmation | Journal retains uncertainty; reconciliation precedes any retry; confirmed effects are not blindly repeated; ambiguous matches require investigation instead of a false success or duplicate creation |
| BENCH-06 | An operator configures access and investigates failed work using the focused console | Connection, mapping, permission templates, tool switches, activity and failed-job recovery work with accessible controls; switches cannot be bypassed through generic invocation; no dependency on the detailed entity browser/report builder/sync dashboards |

Archive sanitized prompts, actual named-tool calls, client versions, identity/permission evidence, persisted record IDs, readback, completeness and recovery outcomes. BENCH-05 fault injection must not disrupt production. Thread's public behavior is the comparison baseline; a live Thread comparison can be recorded if available but is not assumed. A compact passing demo does not replace the underlying authorization, concurrency, capacity and failure tests.

Gate A: auth, scope, dispatch authorization and journal/fault tests pass before a write pilot. Gate B: each domain's representative workflows and every enabled operation have tenant evidence. Gate C: all supported client configurations pass. Gate D: runbooks, restore, secrets rotation, incident controls and operator acceptance pass. Gate E: the full-product release has every intended API-supported operation implemented and qualified, or an explicitly accepted exclusion with a reason; “generic request tool exists” does not satisfy Gate E.

The first technician production release requires BENCH-01–06 and Gates A–D for its shipped scope, including the confirmed 20-concurrent-user qualification. Broader domain operations and later administration/reporting/sync surfaces do not block this milestone when disabled and clearly tracked. Gate E remains mandatory for the subsequent full-product release and cannot be satisfied by shrinking that original coverage objective.

Performance targets are proposed, to validate under measured load: metadata/cached reference responses p95 under 1 second; ordinary live reads p95 under 10 seconds and routine verified writes under 15 seconds when Autotask is healthy. Long jobs acknowledge promptly and show progress. External API degradation is visible and separately measured, not hidden by excluding failures from all reporting.

**Confirmed load profile**

Qualify 20 staff with 20 simultaneous active office-hours sessions. Test synchronized bursts of ticket-context reads, note/time writes, metadata lookups, authorized billing/bulk writes and report starts, plus sustained mixed traffic. Measure Autotask calls per workflow, queue wait, p95/p99 latency, 429s, fairness and readback completion. Simulate other integrations consuming a substantial part of the database budget. Do not assume 20 sessions permit 20 concurrent calls to the same Autotask endpoint.

Run burst/soak/fault load against the simulator first. Production validation uses bounded designated records and an explicitly agreed request budget; never intentionally exhaust the shared production quota to prove throttling. If the latency targets conflict with actual upstream capacity, show the measured queueing and adjust projections/budgets rather than weakening rate controls.

**Technician workflow qualification**

[19 — Workflow evaluation](19-TECHNICIAN-WORKFLOW-EVALUATION.md) adds WF-01–38 to the existing AUTH/POL/EXEC/API/WRITE/JOB and BENCH cases. Run applicable cases for each shipped workflow; security, identity, audience, truthful time, completeness and recovery are deterministic gates. Cross-client routing, avoidable questions, lookup overhead and comprehension are measured separately. No completion claim for the entire workflow layer until all five added tools and all purpose/default/playbook requirements are qualified.
