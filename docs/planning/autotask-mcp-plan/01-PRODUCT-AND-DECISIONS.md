# Product scope and decisions

**Confirmed by Aaron**

- Build and own our MCP rather than selecting a third-party MCP as the final product.
- Cover all API-accessible Autotask domains for technicians and administrators.
- Serve Rarity employees in one Autotask instance initially.
- Use Microsoft Entra ID for employee sign-in.
- Keep hosting portable.
- Execute requested actions when the user has the required permissions; otherwise deny. Bulk, destructive, and billing operations follow the same rule.
- Test only against explicitly designated records in the production Autotask instance; no separate sandbox is available.
- Restrict financial details to authorized roles.
- Deliver interactive use first; unattended recurring automations come later. User-initiated export/bulk jobs remain in scope.
- There is no MCP approval step, approval queue, or self/second-person approval policy.
- Size for 20 staff, with all 20 potentially active concurrently during office hours.
- Plan for Codex, ChatGPT and Claude. Ask questions when choices affect the outcome.
- Use Thread as the usability and operating benchmark; broader, verified Autotask access is our intended differentiator.
- Make named ticket search/context/update/note, time logging/reading and scheduling tools mandatory for the first technician release.
- Start with a focused admin console: connection setup, member mapping, permission templates, tool switches, activity history and failed-job recovery. Deliver the detailed entity browser, advanced reporting and extensive synchronization screens later.

**Product definition**

The MCP is a deterministic adapter and workflow service. The user's chosen AI client interprets language; our server resolves records, validates requests, enforces access, calls Autotask, and reports evidence. The core product does not require its own LLM subscription, model API key, embeddings, or autonomous agent. Optional future summarization must not become a prerequisite for querying or updating a record.

Support concise everyday workflows and detailed entity-level operations through the same execution path. An admin should be able to discover a rarely used supported endpoint without waiting for a hand-written convenience tool. A technician should not need to understand child routes or numeric picklists to log time correctly.

**Personas and permission sets**

| Persona | Primary work | Proposed access template |
| --- | --- | --- |
| Technician | Ticket context, notes, own time, assigned tasks, assets and knowledge | Operational read scope; routine authorized ticket/task edits; own time; no automatic financial access |
| Dispatcher/service lead | Queue management, scheduling, workload, escalations | Technician baseline plus team assignments/schedules and authorized bulk execution |
| Project manager | Projects, phases, dependencies, estimates and project work | Scoped project management; financial fields separate |
| Account/sales staff | Company/contact data, opportunities, quotes | CRM/sales scopes; quote/billing changes reviewed |
| Finance/billing | Contracts, service quantities, costs, rates, invoice data, reconciliation | Explicit financial read and write scopes |
| Autotask administrator | Supported configuration, UDFs, resource administration and integration settings | Explicit business-admin scopes; not an implicit policy override |
| MCP operator | Connection health, releases, access mappings, jobs and audit | Platform administration; business-record access only through separately assigned capabilities |

These are composable permission templates, not seven mandatory application roles. A person may have several. Entra groups/app roles supply assignments; our policy engine makes the final action and record decision.

**What all aspects means**

Cover the complete published entity index, child collections, attachments, lookups, UDFs, special command endpoints, invoice outputs, webhook management, and diagnostics. Include all supported operation types, not just search and creation. Preserve API limitations and conditional rules. UI-only administration, unsupported native merge, unavailable encrypted values, and unsupported rich-text editing receive explicit explanations/manual handoffs.

No client-facing portal, co-managed customer login, multi-MSP billing, marketplace publishing, or unrelated RMM operations are required for v1. The internal data model still uses a tenant key to prevent accidental mixing of test and production credentials and make future expansion possible. This does not turn v1 into a multi-tenant SaaS project.

**Proposed engineering baseline**

Use TypeScript, a supported Node LTS runtime, a maintained official MCP SDK, PostgreSQL, an HTTP web application for administration, and a worker using the same business packages. Pin exact supported versions at the dependency-selection gate; do not copy a beta SDK dependency from a reference project. Prefer one codebase and one durable database over a distributed collection of microservices. Add an external queue/cache only if qualification shows a need.

TypeScript is proposed because tool schemas, web interfaces and metadata-heavy entity adapters can share types. It is a project choice, not a claim that Go or Python cannot meet the requirements. The acceptance criteria remain independent of the language.

**Confirmed capacity and proposed operating defaults**

- Confirmed planning load: 20 employees and 20 concurrent office-hours users. Daily operation volume and average Autotask calls per MCP operation remain to be measured; there is no assumed 1,000-operation daily ceiling.
- Human-facing responses bounded to a small page; full results available through cursors/jobs. No silent truncation.
- Routine time logging counts as routine work; changing rates, billability rules, posted billing data, or correcting previously billed time counts as billing-sensitive.
- Bulk means a mutation plan targeting multiple primary records. Adding one note with its required relationship records is not automatically bulk.
- Native Autotask data stays authoritative. Search indexes and analytics copies are optional accelerators with freshness labels.
- Financial visibility is restricted, production-only designated test records are required, and recurring automations are deferred by explicit user decision.

**Success measures**

Measure correct persisted outcomes, absence of unauthorized access, completeness of reporting, client compatibility, job recovery, and operator diagnosability. Tool count and percentage of entity names exposed are secondary. Publish a capability report by entity-operation plus named end-to-end workflows and documented exclusions.

The first technician production release must demonstrate simple sign-in in every target client, different permissions for two employees, attributed ticket/time/scheduling outcomes, complete authorized ticket context and recovery without blind duplicate writes. "Connect once" means one setup/sign-in per client with working refresh/reconnect, not a token shared between clients. The full-product release still accounts for all 231 entity entries; the technician release is an earlier usable milestone, not completion of that scope.

Thread is a documented product benchmark, not proof that our planned implementation is equivalent or more reliable. Use its [MCP guide](https://docs.getthread.com/super-magic/thread-mcp-server-developer-guide) and [tool reference](https://docs.getthread.com/super-magic/super-magic-tool-reference) as dated comparison inputs; verify Rarity behavior independently. Permission-only execution remains the chosen policy, without copying an additional confirmation layer.

**Technician workflow layer**

The requested workflow extension is defined in [17](17-TECHNICIAN-WORKFLOW-CONTRACT.md), [18](18-RARITY-TECHNICIAN-PLAYBOOKS.md) and [19](19-TECHNICIAN-WORKFLOW-EVALUATION.md). Shared resolution and defaults, purpose-specific context, ticket_document_work, ticket_handoff, ticket_resolve, my_workday and ticket_prepare_visit are product requirements. First build resolution/context/document-work, then the remaining tools. Preserve the eight mandatory named foundation tools and the focused initial console. Per-field default rules and procedural details are proposed engineering defaults until validated against Rarity's configuration; fabricated work, duration or customer-facing text is never an acceptable fallback.
