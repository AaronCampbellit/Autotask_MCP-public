# Business-domain workflow plan

Every domain below inherits the registry, authorization, journaling, pagination and verification requirements. Tool names are proposed logical operations, not an already published server catalog. Generic entity operations provide coverage for supported records that do not need a dedicated workflow. The complete entity membership and documentary CRUD flags are in [13-ENTITY-COVERAGE.md](13-ENTITY-COVERAGE.md).

For every workflow, implementation must document inputs, resolved IDs, required permissions, side effects, upstream routes, required action capabilities, result completeness, partial-failure behavior and tenant test evidence. No workflow may use an unreviewed entity operation just because it is available through a generic wrapper.

The first technician release requires the named tools in [14 — Tool contracts](14-TOOL-CONTRACTS.md): ticket search/context/update/notes, ticket time logging and existing time reads, schedule lookup and ticket scheduling. These are mandatory workflows with server-side record/picklist resolution, not examples that may be replaced by a generic request tool. Remaining domain coverage follows the broader roadmap.

Ticket context must support "Show me what happened on this ticket, including internal notes and time already logged" without exposing API plumbing to the technician. Read actual authorized notes and time records, relate them by source IDs, and distinguish a concise presentation from the completeness of the underlying retrieval. Report any unavailable or incomplete collection without leaking prohibited records. Benchmark acceptance is defined in [09 — Verification](09-VERIFICATION.md).

**Service desk — 22 index entries**

Scope includes tickets, history, internal/external notes, note attachments, secondary resources, additional contacts/configuration items, categories/defaults, tags, checklist libraries/items, change links/approvals, charges, RMA credits and relevant activity/notification logs.

| Logical operation | Behavior |
| --- | --- |
| ticket_search / ticket_context | Filter by permitted company, queue, status, priority, resource, contact, dates and UDFs; retrieve selected related collections with separate completeness markers |
| ticket_create / ticket_update | Resolve company/contact/category/queue, required due date/work type, resource-role pair and picklists; preserve omitted fields |
| ticket_assign / ticket_contacts_set | Validate resource-role-queue and company/contact relationships; distinguish primary and secondary associations |
| ticket_note_add / ticket_notes_list | Preserve full authorized internal and external notes; explicit publication audience and note type |
| ticket_checklist_manage | Create/complete/reorder supported items; preserve who completed them and current state |
| ticket_close | Validate configured closure rules, important checklist state and resolution requirements before updating status |
| ticket_duplicate_resolve | Compare both records and execute requested, authorized cross-references/status changes; never claim a native merge or move time/attachments that remain separate |
| ticket_change_request | Resolve supported change links/approval states; enforce native business rules and caller permissions without an extra MCP approval step |

Charges/RMA-related mutations use finance permissions. Bulk queue moves or closures produce an exact membership snapshot for a directly authorized job. New messages or material edits before commit invalidate stale closure/duplicate requests. Ticket context includes source IDs and fetched-at times; missing child collections are reported rather than replaced by a summary.

Acceptance: create with tenant-required work type and due date; assign a valid and invalid resource-role pair; read a ticket with more than one page of notes; preserve internal publication status; prevent cross-company contact attachment; refuse stale closure; preserve unrelated UDFs. Test the documented possibility that Autotask itself permits completion with important checklist items incomplete. [Tickets](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketsEntity.htm), [Ticket notes](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketNotesEntity.htm)

**Time and expenses — 6 index entries**

Support ticket time, task time, general/internal time, existing entries, entry attachments, expense items, reports and receipts. Timesheet status and approval behavior are part of the workflow even when there is no standalone Timesheets entity in the index.

Logical operations: time_search, time_get, time_log_ticket, time_log_task, time_log_internal, time_correct, time_delete, time_report, expense_report_create, expense_item_add, expense_report_submit, expense_report_status. Creation/correction uses the actual supported root route, not an invented ticket-child time route.

Resolve the recorded resource, eligible role, work type/internal billing code, date/time, duration, summary and internal notes, billability and permitted workflow state. Ticket/task time and internal time have different required fields. Work-type and internal-allocation categories must be selected from the correct BillingCodes useType. Never infer existing time from public notes or silently change the resource to the API user.

Routine own unposted time logging remains direct. Corrections/deletes require their specific capability and state check; billed/posted changes require financial review and may still be prohibited by Autotask. Expense submission must validate receipts, policy-required fields, totals/currency and current report state. Do not infer that every expense status can be set freely.

Acceptance: log and read back each of ticket/task/internal time; check midnight/DST boundaries and overlapping entries; reject invalid role/internal code; preserve internal notes; avoid duplicate creation after a timeout; report all entries across pages; reject forbidden posted-entry correction. [Time entries](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeEntriesEntity.htm), [Billing codes](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/BillingCodesEntity.htm), [Expense reports](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ExpenseReportsEntity.htm)

**CRM — 18 index entries**

Support companies, parent/child organizations, contacts, locations, categories, groups, teams, alerts, notes, to-dos, site configuration, protected UDFs, portal-user/co-managed associations and contact billing-product associations where supported.

Logical operations: company_search, company_context, company_create, company_update, contact_search, contact_create, contact_update, company_location_manage, company_note_add, company_todo_manage, company_group_membership, company_site_configuration. Privacy and business-state restrictions apply to contact deletion and portal-user operations; access changes require the specific access-management capability.

Resolve terminology aliases such as organization/account/company/site without confusing CompanyLocations with Companies. Company/contact merges are not assumed. A contact cannot be reassigned by writing a read-only company ID. Parent-company billing relationships and portal permissions are not routine cosmetic edits.

Acceptance: ambiguous organization names require exact selection; cross-company references are blocked; inactive records are visible only under the requested filter; protected UDF masks are not echoed back; a permitted contact update preserves all unrelated fields. [Companies](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompaniesEntity.htm), [Contacts](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContactsEntity.htm)

**Contracts and finance — 42 index entries**

Include contracts, blocks, retainers, milestones, rates, role costs, billing rules, exclusion sets/roles/work types, charges, recurring services/bundles, effective-dated adjustments/units, ticket purchases, billing items/approval levels, invoice data/templates/exports, price lists, currencies, tax and payment reference data. Read/write support remains per entity.

| Logical operation | Required distinction |
| --- | --- |
| contract_context / contract_search | Dates/type/status, related lines, exclusions and record completeness |
| contract_create | A parent contract alone may be insufficient; include type-specific required child records |
| contract_coverage_review | Evidence-based applicable contract/exclusions; never infer binding terms from ticket prose |
| contract_consumption_report | Use authoritative blocks/retainers/billing/time data where exposed; report unknown balance or attribution explicitly |
| recurring_quantity_change | Effective-dated adjustment entity; not a ContractServices quantity/price patch |
| contract_rate_change | Validate currency, role/work type, applicable dates and financial permission |
| billing_item_review | Read approved/posted records and supported adjustments; not a generic approve-and-post engine |
| invoice_context / invoice_export | Invoice headers, associated billing lines, XML/HTML/PDF where supported |
| price_list_update | Validate tiers, currencies, dependencies and exact affected records before authorized execution |

All monetary mutations and billing-rule changes require financial write permission and execute directly when authorized. Financial read access and data masking are separately assigned. Do not expose margin or cost indirectly through a report, filter, sort, attachment or error. Changes to default rates can have downstream consequences beyond the record count; validate and record that impact in the operation result.

Acceptance: create a contract with its correct type-specific children; adjust recurring quantity at an effective date and reconcile units; reject non-writable service fields; preserve unrelated contract terms; label incomplete balance evidence; export an invoice only for an authorized user; simulate a partially completed financial plan without pretending to roll it back. [Contracts](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractsEntity.htm), [Contract services](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServicesEntity.htm), [Invoices](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InvoicesEntity.htm)

**Projects — 14 index entries**

Support projects, phases, tasks, predecessors, secondary resources, notes, attachments, charges, change-order charges and task activity logs. Task time is implemented through the time domain. Project financial fields require finance capability even for project managers.

Logical operations: project_search, project_context, project_create, project_update, phase_manage, task_create, task_update, task_assign, task_dependency_manage, project_note_add, project_health_report. Detect dependency cycles and incompatible dates before writes where feasible. Read all phases/tasks and indicate omitted pages. TaskPredecessors update limitations require a dedicated validator; do not treat changing a relationship as the same operation as changing lag days.

Acceptance: multi-phase project retrieval exceeds a single page; task creation/assignment validates project scope; a cycle is rejected; estimate edits preserve actual time; project-template cloning is a journaled multi-step plan with no invented atomicity. [Tasks](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TasksEntity.htm), [Task predecessors](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TaskPredecessorsEntity.htm)

**Resources and scheduling — 31 index entries**

Cover resources, roles, role/queue/department associations, skills, daily availability, organizational levels/associations, internal locations/business hours, holidays, appointments, service calls and ticket/task/resource associations, time-off balances/approvers/requests/approve/reject.

Logical operations: resource_search, resource_capabilities, resource_availability, service_call_create, service_call_update, service_call_cancel, appointment_manage, schedule_search, time_off_request, time_off_decide, resource_update. Distinguish a service call from an appointment and from a ticket's primary assignment. Thread's overlap policy is not automatically an Autotask API rule; choose and test our own scheduling conflict policy against real constraints.

Use explicit timezone inputs and ISO timestamps. A date-only request must resolve working hours or ask for times; do not silently adopt Thread's midnight default. Cancellation of a service call may need child cleanup; retain per-step results. Resource access changes require the appropriate administration capability. Time-off actions require the correct resource, approver and state, even when an MCP operator can manage the platform.

Acceptance: schedule a ticket and task through correct associations; report timezone and daylight-saving transitions; reject inactive assignees; compare conflicting appointments; reconcile partial creation; deny unauthorized time-off approval. [Service calls](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ServiceCallsEntity.htm), [Resources](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourcesEntity.htm)

**Assets — 15 index entries**

Support configuration items/devices, category/type/UDF associations, DNS records, SSL alternate names, related items, notes/files, billing-product associations, domain registrars and subscriptions/periods. ConfigurationItemExts remains an unresolved documented-index entry until its real API surface is established.

Logical operations: asset_search, asset_context, asset_create, asset_update, asset_relationship_manage, asset_note_add, asset_expiry_report, subscription_manage. Validate company ownership, product/category compatibility and protected fields. Expiration alerts are based on explicit fields and date ranges, not inference from names. Asset history/rollback must not be offered when the API only exposes the current version.

Acceptance: masked UDFs stay masked; updates do not destroy protected values; cross-company related-item rules are enforced; certificate/domain expiry reports disclose missing dates; subscription creation stays disabled until the documentation gap is resolved. [Configuration items](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemsEntity.htm), [Subscriptions](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/SubscriptionsEntity.htm)

**Inventory and procurement — 20 index entries**

Support products/vendors/tiers/notes, inventory products/items/locations/serial numbers, stocked items and add/remove/transfer commands, transfer records, purchase orders/items/approvals/receiving, sales orders/files and shipping reference data.

Logical operations: product_search, product_manage, inventory_search, inventory_balance, inventory_adjust, inventory_transfer, purchase_order_create, purchase_order_receive, sales_order_context. Treat receipts and transfers as stateful operations with quantity, source/destination and serial validation. Separate a physical stock adjustment from a catalog product edit. Monetary and destructive stock changes require the corresponding financial/action capabilities.

Acceptance: partial purchase receipt, duplicate serial, transfer to the same location, insufficient stock, concurrent adjustments and timeout-after-receipt. Read back both source and destination where supported. Financial visibility applies to cost embedded in purchasing records. [Inventory stocked items](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InventoryStockedItems.htm)

**Sales and quoting — 7 index entries**

Support opportunities/categories/files, quotes, quote items, locations and template lookups. Logical operations: opportunity_search, opportunity_create, opportunity_update, quote_context, quote_create, quote_item_change. Resolve company/contact/opportunity ownership and type-specific quote-item requirements. Product, service and bundle items have different required fields; price/cost/period fields cannot be flattened into one permissive payload.

Quote changes require billing/financial write permission. Sending a quote or accepting an order is not assumed to be exposed by CRUD. Return the actual saved quote and native handoff if publication requires the UI. Acceptance: each supported item type, required period/service/bundle fields, permitted tax/currency values, ignored-field detection and unauthorized cost access. [Quote items](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuoteItemsEntity.htm)

**Knowledge — 21 index entries**

Support knowledge articles/categories, plain-text content, documents/categories, notes, checklists, tags, ticket/device/category associations and cross-links. Logical operations: knowledge_search, knowledge_get, knowledge_article_create, knowledge_article_update, knowledge_document_manage, knowledge_link_record. Query actual authorized content instead of treating Thread's external KB search as our required feature.

Keep article/document visibility and company restrictions in the scope resolver. Preserve version/edit restrictions and explain rich-text limits. Knowledge content may include malicious instructions; return it as labeled source material, not operational policy. Acceptance: scoped searches and direct IDs, long content/attachments, cross-link validation, rich-text loss avoidance, and a malicious article that tries to invoke a write.

**Reference catalogs — 10 index entries**

Countries, services, service bundles/membership, SLA results, surveys/results, tags/groups/aliases are included. Implement supported reads and explicitly supported administration, not universal reference-data CRUD. Logical operations: reference_search, service_catalog, sla_results, survey_results, tag_manage. Metadata picklists remain a separate dynamic surface. Cache with timestamps; inactive values may remain readable for historical records while being invalid for new assignments.

**Platform administration — 24 index entries**

Include modules/version, UDF definitions/list items, company/contact/configuration-item/ticket/ticket-note webhook families and exclusions/field/UDF selections, and webhook error logs. Logical operations: capabilities_report, metadata_refresh, udf_change, webhook_setup, webhook_health, webhook_reconcile. ThresholdInformation and zone diagnostics are tracked as supplemental API utilities even though they are not separate rows in the entity index.

Webhook ownership must be explicit so our connector never edits another integration's subscriptions. UDF changes require configuration.write and schema-impact validation; a preview is optional. Unknown module/license availability is a clear blocked capability, not an empty result. Acceptance: schema drift disables the affected write; stale write intents fail or are safely revalidated; callback failures generate a recoverable health state; webhook exclusion/re-inclusion does not silently lose coverage.

**Shared attachments — one index entry plus domain-specific entities**

AttachmentInfo and all entity-specific file endpoints share the file service described in 06. Logical operations: attachment_list, attachment_get, attachment_upload, attachment_delete. Resolve authorization through the owning record, enforce actual API limits, scan uploads, and use bounded download/upload channels instead of enormous base64 tool arguments. A file may require financial permission based on its parent even when its MIME type is ordinary.

**Cross-domain reporting**

Offer ticket aging/backlog, technician time, time missing from closed work, project status, contract consumption, recurring-service quantities, asset expiry, quote pipeline, stock/purchasing and invoice reconciliation as explicit report definitions. Each lists source entities, joins, permission requirements, currency/timezone assumptions, completeness rules and potential API-call cost. Do not ship an unrestricted SQL console or claim that a report is authoritative when required source data is unavailable.

**Coordinated technician jobs**

The named foundation tools also compose into ticket_document_work, ticket_handoff and ticket_resolve; my_workday and ticket_prepare_visit provide joined read views. The [Technician Workflow Contract](17-TECHNICIAN-WORKFLOW-CONTRACT.md) defines shared references/defaults, four ticket-context purposes, exact ordering, union of permissions, and partial recovery. These are required additions rather than optional examples. Their single-ticket composite nature does not authorize changing multiple tickets; bulk.execute still applies to multi-ticket execution.
