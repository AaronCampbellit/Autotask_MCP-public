# Rarity Autotask MCP — complete implementation plan

Planning baseline: September 10, 2026. Revised to permission-only execution at Aaron's request. This is a build plan, not a running server or a claim of production validation.

**Build one portable MCP for Rarity's staff to use across all API-accessible parts of its Autotask instance.** Entra ID authenticates employees. Codex, ChatGPT, and Claude share the same policy-controlled tools. Requested actions execute directly when the user has the required permissions; otherwise they are denied. This includes bulk, destructive, and billing changes. The MCP has no per-action approval workflow.

Required employee impersonation rejects missing or invalid identity; the service securely maps Entra employees to Autotask resources and qualifies permission enforcement per operation. It never falls back to the integration identity when required impersonation fails.

**Thread is the usability and operating benchmark; broader, verified Autotask access is the intended differentiator.** The first technician release must include named ticket search/context/update/note, time log/read and scheduling tools. Generic entity discovery supplements these workflows. A technician can request ticket history including internal notes and existing time without understanding entity names, pagination or API relationships.

Start with a focused admin console: connection setup, member mapping, permission templates, tool switches, activity history and failed-job recovery. Detailed entity browsing, advanced reporting and extensive synchronization screens follow later. The initial release retains durable storage, permission enforcement and recovery, with no approval portal.

The [first-release benchmark](09-VERIFICATION.md) requires working sign-in/refresh across target clients, different permissions for two employees, attributed technician workflows, complete authorized context and interrupted-write recovery without blind duplication. The [delivery backlog](10-DELIVERY-BACKLOG.md) separates that technician milestone from the full Autotask coverage release; deferred features remain in scope for the latter.

Financial details are restricted to authorized roles. Integration testing uses explicitly designated production records. The initial release is interactive; unattended recurring automation is planned for later, while user-started export and authorized bulk jobs remain supported.

Capacity baseline: 20 staff, all potentially active concurrently during office hours. The permission-only execution model supersedes the earlier approval and self-approval decisions. All eight planning questions asked in this turn are resolved; remaining deployment details are listed as future implementation inputs.

The [Technician Workflow Contract](17-TECHNICIAN-WORKFLOW-CONTRACT.md) adds shared name/default resolution, four purpose-specific context packages, five coordinated workflows, client-neutral playbooks and measurable technician acceptance. The original eight named tools remain mandatory. All additional workflows remain in scope until qualified; no extra admin-console area is required.

**Read the package in this order**

| Document | What it specifies |
| --- | --- |
| [01 — Product and decisions](01-PRODUCT-AND-DECISIONS.md) | Scope, personas, confirmed choices, defaults, and exclusions |
| [02 — Architecture and clients](02-ARCHITECTURE-AND-CLIENTS.md) | Components, portable stack, protocol versions, client onboarding, authentication compatibility |
| [03 — Identity and permissions](03-IDENTITY-AND-PERMISSIONS.md) | Entra/resource mapping, record and field access, direct authorized writes and explicit denials |
| [04 — Autotask adapter](04-AUTOTASK-ADAPTER.md) | Entity metadata, routes, business rules, pagination, special endpoints, errors |
| [05 — Domain workflows](05-DOMAIN-WORKFLOWS.md) | Every business domain, representative tools, limitations, acceptance cases |
| [06 — Data, jobs, sync, files](06-DATA-JOBS-SYNC-FILES.md) | Persistence, complete reads, reporting, exports, webhooks, background work |
| [07 — Admin and operator experience](07-ADMIN-AND-OPERATOR-EXPERIENCE.md) | Setup, access management, coverage browser, diagnostics and recovery |
| [08 — Security and privacy](08-SECURITY-AND-PRIVACY.md) | Trust boundaries, threat controls, sensitive content, retention, incident response |
| [09 — Verification](09-VERIFICATION.md) | Contract tests, tenant tests, client qualification, failure injection, acceptance gates |
| [10 — Delivery backlog](10-DELIVERY-BACKLOG.md) | Work packages, dependencies, exit criteria and release sequence |
| [11 — Deployment and operations](11-DEPLOYMENT-AND-OPERATIONS.md) | Deployment profiles, release pipeline, observability, recovery and runbooks |
| [12 — Decisions and questions](12-DECISIONS-AND-QUESTIONS.md) | User answers, proposed defaults and unresolved release decisions |
| [13 — Entity coverage](13-ENTITY-COVERAGE.md) | Every unique entry from the Autotask REST entity index |
| [14 — Tool contracts](14-TOOL-CONTRACTS.md) | Shared request/result envelopes, discovery, reads, mutations and workflow schemas |
| [15 — Traceability](15-TRACEABILITY.md) | Requirements mapped to implementation packages and verification cases |
| [16 — Later automation and expansion](16-LATER-AUTOMATION-AND-EXPANSION.md) | Deferred automation and API-gap evaluation without expanding the first release |
| [17 — Technician Workflow Contract](17-TECHNICIAN-WORKFLOW-CONTRACT.md) | Shared resolution/defaults, purpose context, five coordinated tools, partial recovery and receipts |
| [18 — Rarity playbooks](18-RARITY-TECHNICIAN-PLAYBOOKS.md) | Portable triage, documentation, handoff, resolution and time-review guidance |
| [19 — Workflow evaluation](19-TECHNICIAN-WORKFLOW-EVALUATION.md) | 38 technician scenarios, correctness gates and measurable client usability targets |

**Coverage evidence**

The entity inventory contains 231 distinct labels from 232 index rows. The source index repeats ResourceTimeOffAdditional. ConfigurationItemExts has no linked reference. We captured 210 linked entity pages and five additional webhook references. The machine-readable [entity inventory](entity-coverage.json) retains documentary support, root/child relationships and source links. The [extracted details](extracted-reference-details.json) preserve raw capability text, including conditional restrictions.

A documentation checkbox is not a release gate. Each operation must advance through: documented → route and business-rule reviewed → implemented → fixture-tested → tenant-tested → enabled. Unsupported, ambiguous, or untested operations remain visible in the coverage browser with their status but cannot execute. Special actions and file endpoints are tracked in addition to CRUD.

**Deliverable boundary**

This plan covers the MCP product, its admin web application, operator interfaces, persistence, worker jobs, and deployment. It does not implement the server, create Entra registrations, issue credentials, or modify Autotask. The reference-collection scripts are research utilities only. The earlier [Thread research](../thread-research-2026-09-10/RESEARCH.md) and [build specification](../autotask-mcp-design/BUILD-SPEC.md) remain historical inputs; this package is the current expanded plan and supersedes their earlier approval design.

**Source quality**

The Autotask capability table was extracted from two documentation layouts: older checkbox tables and newer explicit boolean tables. Blank cells are shown as unmarked, not assumed executable. Source hashes and retrieval timestamps are in [source-manifest.json](source-manifest.json) and [supplemental-manifest.json](supplemental-manifest.json). Only factual entity names, paths, relationships and capability observations are retained. Copied vendor page bodies, examples and prose are excluded; consult the external URLs for field rules and conditions. The collector processes responses in memory and saves factual observations plus provenance, and the coverage builder/validator work offline from those records. No tenant-specific schema, permissions, performance, or client interoperability has been verified.
