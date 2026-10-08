# Decisions and open questions

**Confirmed**

| ID | Decision | Source |
| --- | --- | --- |
| D-01 | Build Rarity's own comprehensive Autotask MCP | Aaron's stated product goal |
| D-02 | First deployment serves Rarity staff in one Autotask instance | User answer during planning |
| D-03 | Microsoft Entra ID for employee sign-in | User answer during planning |
| D-04 | Portable hosting; provider not selected | User answer during specification/planning |
| D-05 | Requested actions execute when permitted; otherwise deny, including bulk, destructive and billing changes | Latest user revision; supersedes earlier approval requirement |
| D-06 | Codex, ChatGPT and Claude are target clients | Earlier user requirement |
| D-07 | This turn produces the entire plan; implementation is separate | Current user request |
| D-08 | Production-only integration testing on explicitly designated records | User answer during planning |
| D-09 | Financial details restricted to authorized roles | User answer during planning |
| D-10 | Interactive use first; recurring unattended automations later | User answer during planning |
| D-11 | Remove the MCP approval layer entirely; no self/second-person approval | Latest user revision; replaces earlier self-approval decision |
| D-12 | 20 staff, with all 20 potentially concurrent during office hours | User answer during planning |
| D-13 | Required employee impersonation rejects missing/invalid identity; securely map Entra employees and qualify native permission enforcement per operation | User addition following permission-only revision |
| D-14 | Thread is the usability and operating benchmark; broader verified Autotask coverage is our differentiator | User-approved comparison and plan update |
| D-15 | Named ticket search/context/update/note, time log/read and scheduling tools are mandatory; generic access serves less common work | User-approved plan update |
| D-16 | Initial admin console covers connection, member mapping, permission templates, tool switches, activity and failed-job recovery; detailed entity browsing, advanced reports and extensive sync screens follow later | User-approved plan update |
| D-17 | First technician release must demonstrate client connection, two-user permission differences, attributed workflows, complete authorized context and safe interrupted-write recovery | User-approved plan update; BENCH-01–06 |
| D-18 | Add the six-area Technician Workflow Contract: shared references/defaults, context packages, coordinated jobs, tool guidance, Rarity playbooks and technician testing | Supplied brief and “use this and get this done” request |

**Planning questions resolved**

All eight questions presented during this planning turn have been answered. The decisions above incorporate the responses. Remaining infrastructure, identity-registration, record-isolation and retention details are implementation/release inputs listed below; no user answer is presently pending.

**Proposed choices the engineering plan can carry without blocking**

| ID | Proposed default | Reason / revisit point |
| --- | --- | --- |
| P-01 | TypeScript, supported Node LTS and maintained official MCP SDK | Shared schemas and web tooling; exact stable versions chosen at WP-03 |
| P-02 | PostgreSQL-backed journal and jobs; no mandatory Redis | Small portable deployment with durable invariants |
| P-03 | Direct Entra with preregistered clients first; broker only if needed | Avoid extra auth infrastructure until actual client compatibility requires it |
| P-04 | Entra-authenticated admin console | Manage permissions, coverage, jobs and audit; no approval portal |
| P-05 | Own unposted time logging is routine; financial rule/rate/posting changes are sensitive | Preserve normal technician work while protecting billing effects |
| P-06 | One allow/deny execution path with specific action capabilities | Confirmed policy; valid authorized requests execute directly |
| P-07 | Direct API reads by default; optional index with explicit freshness | Avoid Thread-like completeness limitations |
| P-08 | Qualify 20 concurrent users; measure workflow call amplification and daily volume | User concurrency confirmed; actual operation mix not yet measured |

**Decisions required before production, not before completing this plan**

1. Hosting owner, public hostname, deployment environment and network access for hosted AI clients.
2. Entra administrator, app-role/group mapping, conditional-access requirements and bootstrap/recovery administrators.
3. Specific financial, bulk, delete and access-management role assignments. Financial visibility remains restricted; no per-action approver is needed.
4. Test-record isolation, notification/billing implications and business owners for acceptance.
5. Measured workflow/export volume for the confirmed 20 concurrent users and other integrations' Autotask request consumption.
6. Retention, audit-reader scope, export lifetime, backup RPO/RTO and incident ownership.
7. For the later automation release: scope, owner lifecycle, credentials and maximum allowed scheduled actions. Recurring automations are excluded from the first release.
8. Supported client plans/versions and organizational connector policies.
9. Runtime/SDK/auth component versions, license review and upgrade responsibility.
10. Whether any UI-only or untestable API operation is an accepted exclusion from the full-product release.

The full plan remains actionable with these marked decisions. The affected implementation/release step must resolve them before assuming access, entitlements, infrastructure or permission to mutate production.

**Workflow implementation inputs**

Qualify per-field default sources and hierarchy, employee/workspace timezone settings, category completion rules, note/time publication behavior and resource eligibility using designated records. Proposed procedures in 18 can be reviewed during implementation; this does not add per-action approval. All five additional workflows remain planned deliverables, with T1/T2 slices in 10. No further answer is required to finish this contract package.
