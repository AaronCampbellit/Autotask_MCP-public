# Autotask API workflow audit

**Review date:** September 23, 2026. **Scope:** the generated MCP runtime catalog, the checked-in 231-entity Autotask REST reference index, and every shared Autotask HTTP impersonation-header call site.

## What this review establishes

The generated runtime catalog declares **336 MCP operations** with **178 distinct output contracts**. That includes Autotask workflows plus Datto RMM, IT Glue, reports, files, and local administration. A declared tool is not necessarily enabled or available to every employee; tenant configuration, feature switches, area grants, capabilities, company scope, and upstream permissions still apply. The seven leadership time tools are currently local additions; the live deployment counts below describe the previous release.

The deployed release was checked through `at_diagnostics` and targeted `at_discover`: **328 tools are configured and 315 are currently available** to the connected identity. All five ticket tag/checklist-library operations and both new ticket-resource tools appear in live discovery. The 14 catalog entries unavailable to this identity/configuration are the 13 RMM administration/write tools and conditional `sync_status` (the webhook inbox is not registered). The remaining 55 RMM tools and 27 IT Glue tools are declared inventory counts; only 42 RMM and 27 IT Glue tools are currently discoverable.

The Autotask reference index records **231 native entities**. Its exact-name scan finds candidate source references for 68 entities and candidate test references for 58. Those are navigation hints, not verified route coverage. All 231 entries still have per-operation review pending in the index. The index describes a broader API surface than the MCP should expose: many routes are administrative, read-only, conditionally licensed, or lack a suitable employee-scoped workflow.

The new ticket tag association and checklist-library application workflows are deployed and discoverable. Their native writes still need tenant qualification.

| Native API domain | Entities | Candidate source refs | Candidate test refs |
| --- | ---: | ---: | ---: |
| Assets | 15 | 4 | 4 |
| CRM | 18 | 6 | 5 |
| Contracts and finance | 42 | 13 | 7 |
| Inventory and procurement | 20 | 13 | 10 |
| Knowledge | 21 | 0 | 0 |
| Platform administration | 24 | 0 | 0 |
| Projects | 14 | 6 | 6 |
| Reference catalogs | 10 | 2 | 1 |
| Resources and scheduling | 31 | 10 | 10 |
| Sales and quoting | 7 | 5 | 5 |
| Service desk | 22 | 6 | 6 |
| Shared attachments | 1 | 0 | 1 |
| Time and expenses | 6 | 3 | 3 |
| **Total** | **231** | **68** | **58** |

Candidate reference counts come from the checked-in reconciliation index. An exact-name hit can point at a generic adapter or an incidental mention; it does not prove a working workflow. Conversely, a missing hit can miss aliases or indirect routes.

This release review checks workflow wiring, route construction, identity headers, guards, request scheduling, and known missing relationship operations. It does not certify all 231 entities, all native CRUD verbs, each tenant's security level, or every live workflow.

## Cross-cutting defect fixed

The shared Autotask adapters attached `ImpersonationResourceId` to every employee-context request. Autotask documents impersonation only for a specific allowlist of entities. `TicketSecondaryResources` is not on that list. A later route review found a more direct defect: the deployed secondary-resource create calls the nonexistent root POST `TicketSecondaryResources`. The captured Swagger defines POST only at `Tickets/{parentId}/SecondaryResources`. The deployed correction now uses the child route; it has not yet been tested with a live tenant write. The unsupported header was separately corrected in the previous release.

The adapters now add the header only for entities Autotask documents as impersonatable. Attachment aliases map to `AttachmentInfo`. Unsupported routes, including `TicketSecondaryResources`, run as the configured API user. The MCP continues to enforce its own current employee mapping, tenant, capability, company/parent scope, request budget, and fresh pre-dispatch validation. This identity policy is an application guard; it does not claim Autotask native employee-level authorization for unsupported entities. Autotask's REST security guide says writes without impersonation are attributed to the API User.

The same shared rule also covers every other adapter family found in the source scan: technician, base operational, business, sales, scheduling, work-management, checklist, and attachment requests. Diagnostics now preserve relationship entity names such as `TicketSecondaryResources` while still redacting record IDs, so another failure on that route is easier to locate.

The secondary-resource flow also removes duplicate ticket reads: the already-checked parent is passed into option resolution, and a fresh parent is reused at the guarded pre-dispatch check. The remaining pre-dispatch reads are sequential because the shared request scheduler rejects parallel nested reads. They recheck current assignments and eligible active employee/role pairs before the one-shot POST; the result is read back and verified. Unknown outcomes remain unsafe to redispatch automatically.

## Registered workflows and important omissions

| Native workflow | Current MCP handling | Audit result |
| --- | --- | --- |
| Ticket primary and secondary resources | `ticket_secondary_resource_options`, `ticket_primary_resource_assign`, `ticket_secondary_resource_add`, and `ticket_secondary_resource_remove` | **Deployed; native assignment write unqualified.** Explicit primary employee/role assignment reuses guarded `ticket_update`. Secondary create/get/delete now use `Tickets/{parentId}/SecondaryResources` child routes. Both secondary writes use exact current choices, company scope, fresh preflight, durable receipts, native readback, and no automatic replay. See [ticket resources](TICKET-RESOURCES.md). |
| Task secondary resources | No dedicated registered workflow | **Gap.** The native sibling route is documented for create/query/delete, with a 50-item limit, no primary-resource duplicate, a required existing resource/role pair, restricted-project-access conditions, and Baseline-project read-only behavior. A safe workflow must resolve the task's project and company, reject Baseline projects, recheck assignments and role pairs, and respect those access conditions before create/delete. |
| Ticket tag associations | `ticket_tag_options`, `ticket_tag_add`, and `ticket_tag_remove` | **Deployed; native write unqualified.** Uses `Tickets/{parentId}/TagAssociations` for create/delete and the read-only `TicketTagAssociations` entity for association queries. Fresh checks enforce active choices, duplicates and the 30-tag cap. Native deletion still requires tag-administration and remove-tag permissions. |
| Ticket checklist libraries | Individual ticket checklist item workflows plus `ticket_checklist_library_options` and `ticket_checklist_library_apply` | **Deployed; native write unqualified.** Lists only active ticket libraries using current `entityType` picklist metadata. Appends through `Tickets/{parentId}/ChecklistLibraries`, checks the existing 40-item capacity, journals the write and verifies the resulting item count. Native shared-feature and ticket-checklist permissions remain required. |
| Leadership time review and approval | Seven tools for bounded employee time review, billing approval-level history/create, assigned time-off request review, and approve/reject | **Implemented locally; not deployed or native-qualified.** Requires a separate leadership capability, native approver mapping for time off, expected prior state, one-shot writes and readback. The REST API does not expose Approve & Post for timesheets. See [time approval research](TIME-APPROVAL-RESEARCH.md). |
| Knowledge base | No dedicated knowledge article workflow was found in the catalog/source scan | **Major coverage gap.** The reference index contains 21 Knowledge entities with no candidate code or test references. Article discovery/read should be scoped and reviewed before mutation tools are considered. |

Other candidate gaps remain in the other native domains; the 231-entity index is intentionally retained as a per-operation follow-up queue rather than represented as completed coverage. Prioritize relationship routes, child collections, identity-specific routes, shared checklist/knowledge workflows, and parent-level mutation rules when extending the MCP.

## Workflow efficiency and guardrails observed

- Tools are explicitly registered and capability-gated. The generated catalog is a declared-operation inventory, not a generic proxy to arbitrary Autotask routes.
- Search/read workflows use allowlisted fields, bounded page sizes, parent filters, company scope, and encrypted continuations where applicable. Composite ticket/context workflows avoid asking callers to reconstruct every parent lookup themselves.
- Write workflows validate native metadata and parent state, revalidate immediately before dispatch, journal request keys, and distinguish verified, failed, and uncertain outcomes. The audited secondary-resource path never blindly retries a write.
- A shared request budget and scheduler cover the Autotask adapters. Nested guarded reads are sequential; making them parallel causes a local throttle before the native mutation. Directory caching is used only in code paths that do not explicitly request fresh metadata.
- `at_describe` exposes the exact schema, capabilities, and limits for an operation currently available to the caller. `TOOL-CATALOG.json` is generated from the runtime registry so newly registered tools appear in the declared catalog.

The secondary-resource request still needs multiple native reads because Autotask stores assignments, resources, roles, and service-desk role links separately. This audit removes duplicate parent reads and documents the serialized preflight; it does not claim that those separate native reads can be collapsed into one REST call.

## Verification boundary and sources

Static route review and mocked tests verify the identity-header policy and sanitized route display. No live ticket or task assignment, tag, checklist, or knowledge record was created for this audit. The generic `not_found_or_inaccessible` response intentionally does not distinguish an absent record from one outside the accessible scope.

Official references:

- [Autotask REST entities overview and impersonation support](https://autotask.net/help/developerhelp/content/apis/rest/Entities/_EntitiesOverview.htm)
- [Autotask REST security and authentication](https://autotask.net/help/developerhelp/Content/APIs/REST/General_Topics/REST_Security_Auth.htm)
- [TaskSecondaryResources](https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskSecondaryResourcesEntity.htm)
- [TicketTagAssociations](https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketTagAssociationsEntity.htm)
- [TicketChecklistLibraries](https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChecklistLibrariesEntity.htm)
- [231-entity reference index](AUTOTASK-ENTITY-RECONCILIATION.json)
- [Generated runtime tool catalog](TOOL-CATALOG.json)
- [Reporting and synchronization engine research](REPORTING-SYNC-RESEARCH.md)
