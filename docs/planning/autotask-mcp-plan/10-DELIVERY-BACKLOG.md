# Delivery backlog and dependency plan

Each work package below has a concrete output and acceptance gate. This is the entire product plan; phased delivery controls risk and does not remove the admin/finance/long-tail API surface from the objective. No calendar promises are made before staffing and a test environment are known.

**Work packages**

| ID | Work package / output | Depends on | Exit evidence |
| --- | --- | --- | --- |
| WP-01 | Resolve product decisions, role templates, test environment and sizing assumptions | User decisions | Published decisions with owners; unresolved release gates explicit |
| WP-02 | Review all entity-operation routes, metadata and conditional rules; resolve index discrepancies | Captured reference | Registry entries plus supported/unsupported/unknown ledger |
| WP-03 | Choose supported runtime/SDK/auth library; minimal protocol compatibility spike | WP-01 | Supported revision matrix; no beta dependency assumed necessary |
| WP-04 | Entra direct-client interoperability; broker fallback decision if needed | WP-03 | Actual Codex/ChatGPT/Claude OAuth flows and callbacks proven |
| WP-05 | Portable repo, build, CI, containers, migrations and dependency policy | WP-03 | Reproducible dev/test build and empty deployment readiness |
| WP-06 | PostgreSQL identity, policy, journal, jobs, artifacts and audit schema | WP-05 | Migration/rollback/restore tests; keys and indexes enforce invariants |
| WP-07 | Secure Entra-to-resource mapping, required impersonation validation, role bindings, session checks and revocation | WP-04, WP-06 | AUTH-01–08; invalid identity blocks dispatch and never falls back |
| WP-08 | Capability, record and field policy engine; policy simulator | WP-02, WP-07 | POL cases including child routes, counts, wrappers and exports |
| WP-09 | Autotask HTTP/zone client, required impersonation headers, deadlines, error taxonomy and credential isolation | WP-02, WP-05 | API errors, destination validation and no identity fallback on retries/pagination |
| WP-10 | Metadata/picklist/UDF registry compiler and drift detection | WP-02, WP-09 | Versioned schemas and reviewed drift behavior |
| WP-11 | Root/child query engine, cursors and complete read envelopes | WP-08, WP-09, WP-10 | Pagination/completeness and scope tests |
| WP-12 | Mutation service, operation journal, idempotency and readback | WP-06, WP-08, WP-09, WP-10 | WRITE cases, no PATCH-to-PUT fallback |
| WP-13 | Direct execution permission matrix and dispatch enforcement across routine, bulk, destructive and billing actions | WP-07, WP-08, WP-12 | EXEC cases; allowed actions execute directly and forbidden actions cannot escalate |
| WP-14 | Mandatory named technician catalog, supporting discovery/invocation and result contracts | WP-03, WP-08, WP-11, WP-12 | BENCH-02/03; all mandatory named tools exposed for entitled users, no wrapper bypass |
| WP-15 | Durable worker, jobs, checkpoints, cancellation and capacity controls | WP-06, WP-12, WP-13 | JOB and crash/recovery cases |
| WP-16 | Mandatory ticket search/context/update/note workflows first; remaining history/checklist pack follows | WP-11, WP-12, WP-14, WP-17 time-read slice for context | DOM-TICKET; BENCH-03/04 with authorized internal notes and actual time entries |
| WP-17 | Mandatory ticket time logging and existing-entry search first; task/internal time and expense pack follows | WP-11, WP-12, WP-14 | DOM-TIME; BENCH-03/05 with readback and duplicate recovery |
| WP-18 | CRM and protected site/contact data pack | WP-11, WP-12, WP-14 | DOM-CRM and field access checks |
| WP-19 | Mandatory schedule search and ticket service-call creation first; remaining availability/time-off pack follows | WP-11, WP-12, WP-14 | DOM-SCHEDULE; BENCH-03 with attribution and partial association recovery |
| WP-20 | Projects/phases/tasks/dependencies pack | WP-11, WP-12, WP-14, WP-17 | DOM-PROJECT and complete cross-entity context |
| WP-21 | Contracts, recurring adjustments, billing and invoice pack | WP-11, WP-12, WP-13, WP-14 | DOM-FIN and financial write permissions/read visibility |
| WP-22 | Assets/subscriptions/reference catalogs pack | WP-11, WP-12, WP-14 | DOM-ASSET and DOM-REFERENCE; unresolved endpoints gated |
| WP-23 | Sales/quotes/procurement/inventory pack | WP-11, WP-12, WP-13, WP-14 | DOM-SALES and DOM-INVENTORY |
| WP-24 | Knowledge/articles/documents/UDF/platform administration pack | WP-11, WP-12, WP-13, WP-14 | DOM-KNOWLEDGE and DOM-ADMIN |
| WP-25 | Shared file upload/download/scanning/artifact service | WP-06, WP-08, WP-09 | FILE cases across domain parent types |
| WP-26 | Webhook receiver, owned subscriptions, dedupe, gaps and reconciliation | WP-06, WP-09, WP-15 | SYNC cases and authentic signature validation |
| WP-27 | Report definitions, joins, streaming exports and completeness accounting | WP-11, WP-15, WP-25, domain packs | Reconciled outputs with currency/timezone/source scope |
| WP-28 | Initial focused console; later detailed capability/reporting/sync surfaces | Initial: WP-07, WP-08, WP-13, WP-15, applicable WP-29; later: WP-10, WP-26, WP-27 | Initial BENCH-06 and accessibility; later full operator acceptance |
| WP-29 | Security/observability/retention/support bundles and incident controls | WP-05 onward | SEC/OPS cases, no sensitive logs, incident exercise |
| WP-30 | Technician release qualification, then full-product qualification and documentation | Technician: shipped foundation, mandatory workflow slices, focused WP-28, applicable WP-29; full product: all applicable packages | Technician BENCH-01–06 plus Gates A–D; full product adds Gate E |
| WP-31 | Shared scoped business-reference resolver, eligibility and reviewed default policy/provenance | WP-07–11 | WF-01–10; no forced numeric-ID plumbing, identity fallback or fabricated defaults |
| WP-32 | Purpose-specific ticket context, workday/visit evidence packs and readable enrichment | WP-11, WP-16–19, WP-31; task/asset/knowledge read slices as exposed | WF-11–15,25–28; scoped evidence and explicit completeness |
| WP-33 | ticket_document_work and shared fixed-step workflow recovery/receipts | WP-12–17, WP-31 | WF-16–18,31–33; verified note/time, deterministic partial recovery |
| WP-34 | ticket_handoff and ticket_resolve with eligibility/completion invariants | WP-16,17,19, WP-31–33 | WF-19–24,29,30,32; no closure on failed prerequisites |
| WP-35 | Tool descriptions/errors and portable Rarity playbook distribution | WP-14, WP-31–34 | WF-34,37; five versioned guidance playbooks with list/get fallbacks |
| WP-36 | Technician scenario fixtures, fault/client evaluations and usability evidence | WP-31–35; applicable WP-29 | WF-01–38; hard correctness gates plus measured client usability |

WP-29 begins with the foundation and continues throughout; security is not a final add-on. WP-25 should start with the first ticket/time attachment workflow. WP-26 is optional for direct-read correctness but required before any indexed/sync-backed surface is advertised as current.

Split packages into milestone slices without dropping their remaining deliverables. WP-02/08/10 require complete review for each shipped operation before enablement; reviewing all 231 entries in implementation depth is not a prerequisite for the technician release. WP-28 initial scope is connection setup, member mapping, permission templates, tool switches, activity history and failed-job recovery; it has no dependency on WP-26 or WP-27. Its detailed entity browser, advanced reporting and extensive synchronization screens follow later. Keep registry evidence and operational runbooks available without those screens. WP-27 advanced reporting is later; basic time reads/context and scoped job outcomes are required initially.

**Per-entity implementation checklist**

Each of the 231 index entries maps to an owning domain pack. For every supported operation: resolve exact name/routes; schema and conditional rules; parent scope; field sensitivity; execution identity mode and separate attribution/permission-enforcement evidence; required action capabilities; retry/reconciliation; readback; fixture cases; tenant case; tool/docs exposure; monitoring; enabled version. Create per-operation backlog items from the registry, not one vague “support entity” task.

Read-only entities need complete query/get semantics and policy checks. Command-only entities need action/result/reconciliation semantics. Unsupported operations need a documented denial and manual alternative where useful. Ambiguous operations remain blocked with a named evidence-resolution task. The whole index is accounted for even when an API limitation prevents implementation.

**Delivery waves**

1. Foundation and evidence: shipped-scope slices of WP-01–15 plus essential security/recovery. Prove identity and one read/one write through the entire path; retain review of remaining entities in the backlog.
2. Technician pilot and first production release: mandatory slices of WP-16,17,19, supporting CRM/reference lookups, initial WP-28, applicable WP-29 and scoped WP-30 qualification. Pass BENCH-01–06 and Gates A–D before production use. Add WP-25 before exposing file workflows; complete remaining WP-16–19 domain work in subsequent slices.
3. Administration/business coverage: WP-20–24. Include finance, inventory and UDF changes only through qualified authorization/verification paths.
4. Reporting and expanded administration: WP-26,27 and later WP-28 screens, with continuing WP-29 qualification. Basic activity and failed-job recovery have already shipped; add detailed entity browsing, advanced reporting and extensive sync interfaces as the corresponding capabilities become useful. Long-tail entity qualification continues until coverage is complete.
5. Full-product release: WP-30. Reconcile coverage and decisions; publish supported versions, known exclusions and ownership.

The pilot is not completion of the full objective. A supported entity left unimplemented remains backlog, not relabeled “unsupported.” A domain can be disabled until qualification without concealing that work.

**Critical path and parallel work**

The critical path is client authentication → identity/policy → adapter/journal → direct execution qualification → domain tenant evidence → release qualification. Documentation/registry review, portal design, fixtures and infrastructure can proceed alongside each other. Implementation can parallelize evidence review, playbook preparation and scenario design around the shared contracts.

**Recommended staffing functions**

Product/Autotask owner, backend/MCP engineer, identity/infra engineer, UI engineer, test/automation engineer and a finance/operations reviewer. Individuals may cover multiple functions. Billing/HR acceptance needs the appropriate business owner, not only a technical developer. Estimate duration only after the registry and test environment expose the actual conditional-rule workload.

**Definition of done for a work package**

Reviewed implementation; meaningful automated checks; required tenant evidence; complete allow/deny authorization behavior; error and recovery handling; operator documentation; observability; capability inventory updated; no unexplained skipped operation. A passing HTTP status or successful demo prompt alone is insufficient.

**Technician workflow delivery slices**

T1: WP-31 plus the ticket-context slice of WP-32 and WP-33. Deliver shared references/defaults, four context purposes and ticket_document_work first. T2: complete WP-32 and WP-34 for workday, visit, handoff and resolution; read slices of projects/assets/knowledge ship only with their required policy and evidence. WP-35 descriptions/playbooks and WP-36 evaluation accompany each slice; the whole workflow layer requires both completed. These are additions to the eight-tool foundation, with no new console area. WP-30 qualifies each shipped slice and cannot declare full-product completion before WP-31–36 are complete.
