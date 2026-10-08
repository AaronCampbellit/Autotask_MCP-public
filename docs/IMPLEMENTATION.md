# Implementation

This inventory describes the current code. [CURRENT-STATUS.md](CURRENT-STATUS.md) records release verification and deployment state; [TOOL-CATALOG.json](TOOL-CATALOG.json) lists declared operations. [OUTPUT-CONTRACTS.md](OUTPUT-CONTRACTS.md) describes shared response schemas, runtime validation and requirements for adding tools. The preserved 231-entity plan is a broader roadmap, not a claim of complete entity coverage.

| Module | Implemented behavior | Limits |
| --- | --- | --- |
| Identity and control | Entra identity, current employee mapping, capabilities, company scope, tool switches, write pause, audit and encrypted durable jobs | Single-user LAN pilot; no native employee read-permission enforcement claim |
| Tickets and authoring | Ticket creation/update, opportunity/contact/tag links, scoped search/context, notes, handoff, resolution, faithful work-request drafting | Contact/company administration and broader history/knowledge routes remain separate work |
| Checklists and attachments | Ticket checklist CRUD, active checklist-library selection and append, descendant attachment metadata/download, validated uploads, server-side ticket copying and direct deletion | Library append is a one-shot, count-verified write; tag deletion needs native tag-admin permissions; upload requires validated staged bytes; nested/note/time attachment creation and deletion remain unsupported |
| Sales | Opportunity/quote/line writes, templates, notes, comparisons, current publication and customer-response evidence | No eQuote send, native quote PDF generation, acceptance signing or Won Quote wizard execution |
| Business | Contracts, services/blocks/charges/adjustments, invoice reads/limited updates/PDF, projects/phases/tasks/dependencies, assets, products, inventory and purchasing | Finite reviewed fields/routes; command-only endpoints cannot promise readback; true-up evidence does not infer a billable adjustment |
| Work management | Self task/internal time, eligible correction/deletion, expense report/item/submission, daily availability, single-day time off | No delegated time writes; native timesheet, approval and contract rules still apply |
| Scheduling | Ticket service-call creation, association steps, update/cancel and overlap evidence | No general/task appointments or atomic capacity reservation |
| Reports and sync | Bounded ticket/pipeline aggregation, activity-window scans, optional verified webhook receipt inbox | No complete replica, deletion-aware polling, automatic reconciliation or financial totals across currencies/periods |
| Artifacts | Encrypted bounded exports, owned artifacts, chunked retrieval, quotas, expiry, validated staging | journal intent expiry is not ciphertext deletion |
| Datto RMM | 55 tools for mapped device reads, approved component jobs, controlled writes, snapshots and ticket diagnostics | Separate read/write/execute/admin grants; API-key reset excluded; tenant write acceptance remains separate |
| Integration console | Encrypted Autotask adoption/drafts/test/reload/rollback, RMM credentials/mappings/approvals and per-area permissions | One server/collector; configuration tests do not certify every native operation |

## Shared implementation rules

Tools resolve actual parents and compare requested companies before writes. Fresh identity, capabilities, metadata and relevant record expectations are checked again after request-budget admission. Every physical native request uses the shared scheduler and budget. Field validation and readback do not prove semantic fidelity; the calling assistant follows the shared [authoring standard](work-request-authoring.md) without a second AI service.

Mutation intent is encrypted before dispatch and bound to the actor, mapping and request key. Receipts distinguish verified success, accepted but unverified effects, unknown outcomes and definite failures. A missing native ID is never invented. Reads before writes are not an atomic upstream compare-and-swap. Existing multi-step ticket workflows support bounded resume; the new domain mutations never replay an uncertain effect.

Converted policies use per-area Read/Write grants; Finance access governs financial operations and protected financial fields. Legacy capability policies retain compatibility behavior. See [area permissions](AREA-PERMISSIONS.md). Time, expenses, scheduling, checklists and attachments have their own capability requirements. The runtime's generated catalog and current controls determine visibility; generic invocation cannot bypass them.

## Remaining product work

See the [completion audit](AUTOTASK-COMPLETION-AUDIT.md) for the reconciled original work packages and ordered Autotask backlog.

See [ticket tags](TICKET-TAGS.md) and [ticket checklists](CHECKLISTS.md) for the two new local relationship workflows and their current deployment/qualification boundary.

General company/contact CRUD, task secondary-resource workflows, delegated time, generalized appointments, broader ticket history/knowledge integrations, advanced financial reporting, and protected-field/UDF expansion remain separate work. A complete webhook reconciliation engine is research-only; see [REPORTING-SYNC-RESEARCH.md](REPORTING-SYNC-RESEARCH.md). Journal purge/key-rotation tooling and broader attachment parent coverage remain open. Quote customer-facing delivery and conversion follow the paths documented in [QUOTE-DELIVERY-INVESTIGATION.md](QUOTE-DELIVERY-INVESTIGATION.md).

Automated and mocked tests do not establish live business behavior. No live business-write test records are created during this expansion; the user will perform those checks.

CRM to-do and project/task note operations are included in the business pack; see [CRM to-dos and notes](CRM-TODOS-AND-NOTES.md) for native routes, authoring, scope and test boundaries.
