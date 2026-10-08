# Operational write tools

The core technician write workflows have an explicit application-controlled deployment path alongside sales writes. This mode uses the configured API account, current mapped employee, capability switches, authorized companies, shared request budget, and live REST metadata. It requests employee attribution on writes and verifies saved records. It does not claim native employee permission qualification.

| Tool | Effect |
| --- | --- |
| `ticket_update` | Change supplied title, owner, queue, status, category, priority, contact, opportunity link or resolution; expected values are required. |
| `ticket_note_add` | Add an explicitly supplied internal or customer-visible note. |
| `time_log_ticket` | Record explicitly supplied time for the current employee. |
| `ticket_document_work` | Verify a note, then record and verify the separately supplied time. |
| `ticket_handoff` | Verify the handoff note, then change owner and optionally queue. |
| `ticket_resolve` | Verify resolution note and optional time, then complete the ticket. |
| `service_call_create` | Create and verify a service call, ticket link and resource link(s). |
| `service_call_update` / `service_call_cancel` | Change or cancel an existing scoped call using explicit prior values and a durable request key. |
| `time_log_task` / `time_log_internal` | Record explicitly supplied self-only project-task or internal time. |
| `time_correct` / `time_delete` | Correct or delete only mutable, unposted, unbilled time after expected-value checks. |
| `expense_report_create` / `expense_item_add` / `expense_report_submit` | Create, populate and submit the employee's expense report with reviewed status metadata and parent scope checks. |
| `resource_availability_update` / `time_off_request` / `time_off_cancel` | Update daily availability or request/cancel one-day time off under `scheduling.write`. |

Sales opportunity, quote, line-item, location and opportunity-note tools remain available. Ticket creation and opportunity linking are described below. Contact search and native ticket contact linking are implemented; general contact/company administration is not. Additional time correction, expense, availability, and attachment tools are described in [Work management](WORK-MANAGEMENT.md) and [Ticket attachments](TICKET-ATTACHMENTS.md). Arbitrary REST writes are not exposed.

## Classification

See [ticket classification rules and override inputs](TICKET-CLASSIFICATION.md). Creation and ticket time check category/queue/work-type hundreds ranges; supported category/queue edits also check the existing work type. Explicit user exceptions are retained in encrypted intent. Eligible explicit roles override same-range/default role selection. Unrelated edits preserve existing classifications. Category defaults do not prove the complete allowed ticket-type set. Deployed with the September 16 classification release; see [current status](CURRENT-STATUS.md).

## Inputs and behavior

Use `ticket_write_options` with a ticket and `kind` of `note_time`, `ticket`, or `service_call` to retrieve current choices. `at_describe` exposes each input schema. `at_validate` performs read-only preflight for the seven operational workflows; it does not guarantee native API acceptance or reserve records.

- Every mutation needs a stable `request_key`. Repeating the same key retrieves its existing outcome; changing the input requires a new intentional request. Never create a new key just to retry an uncertain write.
- Notes require supplied text, a title and explicit audience. The current Task Notes type (or General where that is the ordinary type) is used only when uniquely identified. Internal Project Team maps to internal; All Autotask Users is never silently treated as internal or as a verified customer audience. If no verified customer audience exists in metadata, customer-visible writes are rejected without preventing internal notes. Customer-visible notes can trigger configured notifications; a successful note does not prove email delivery.
- Time requires minutes, a calendar work date, IANA timezone and separate summary. The current employee's active service-desk role default and ticket work type are used only when eligible and unambiguous. Otherwise supply exact choices. Time summaries can appear on invoices. No work duration or billing decision is inferred.
- Role/queue assignment combines `ResourceRoleQueues` with active `ResourceServiceDeskRoles` and `Roles`. Existing eligible roles are retained; a new owner uses their unique default or sole eligible service-desk role.
- Application completion policy requires a queue, title, resolution and all Important checklist items completed. The four reviewed terminal status labels are Complete, Complete (With CSAT), Canceled and Duplicate. Native category requirements and API validation still apply. Rich-text field updates replace formatting with plain text.
- Time preflight checks current employee, role, work type and date container. Native submitted-timesheet, contract and other tenant rules are checked by Autotask when it receives the request; local preflight does not claim to reproduce them.
- Service calls accept only primary/secondary resources already associated with the ticket. The unique active Scheduled status (or New when Scheduled is absent) is the default when available. Overlap rejection is the default; `overlap: allow` must be explicit. Schedule checks are not atomic reservations.
- Directory/picklist metadata is cached for at most one minute. Ticket state and secondary-resource associations are refreshed. Incomplete directories, unknown labels or ambiguous defaults fail before mutation.
- Every saved record is read back. Note and service-call attribution must match the current employee; a successful API response without matching readback remains unverified. Unknown create outcomes are never replayed automatically.

`at_operation_status`, `at_operation_reconcile` and `at_operation_resume` retain their existing bounded recovery behavior. Resume is limited to explicitly known unfinished steps; it does not repeat verified effects. A standalone unverified note/time write requires manual inspection; it cannot reconstruct a lost native ID.

`at_job_start` queues one of the seven fixed workflows. Job execution requires `JOB_WORKER_ENABLED=true`; cancellation prevents further dispatch where possible and cannot recall an in-flight request. The job worker and direct tools use the same capabilities, switches, scopes and journal.

## Configuration and verification

`OPERATIONAL_WRITES_ENABLED=true` requires application ticket reads, current resource evidence and a shared request budget. Grant only the intended member `tickets.write`, `time.self` and `scheduling.write`, enable the desired tool switches, and release the write pause. Native-qualification mode is unchanged when this option is absent.

Tests use mocked HTTP responses and fixture records. No live Autotask business records were created or changed during this build. The user performs live acceptance testing.

## Reviewed API references

- [Tickets](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/TicketsEntity.htm)
- [TicketNotes](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/TicketNotesEntity.htm)
- [TimeEntries](https://ww3.autotask.net/help/developerhelp/content/apis/rest/entities/TimeEntriesEntity.htm)
- [ResourceServiceDeskRoles](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ResourceServiceDeskRolesEntity.htm)
- [ResourceRoleQueues](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ResourceRoleQueuesEntity.htm)
- [Official REST Swagger](https://webservices5.autotask.net/atservicesrest/swagger/ui/index)

## Ticket creation and opportunity links

`ticket_create` creates one ticket through `POST /Tickets`. It requires company (name, shorthand or ID), title, priority, queue and an offset-qualified `due_datetime`. Additional inputs are description, status, category, ticket_type, issue_type, sub_issue_type, contact_id (requester), owner, role, work_type, opportunity_id and creation_assumptions. `owner: "self"` resolves the mapped employee; no owner is assumed when omitted. New is the default status, resolved from current metadata. Unique active tenant defaults fill omitted category, ticket type, issue type and a sub-issue belonging to the selected issue. Missing or blank description falls back to the title. Other unknown optional fields remain unresolved. `ticket_create_options` exposes supported current field choices and required inputs before creation; tenant-specific requirements can still cause API validation errors.

For “Create a ticket for Example Willow Architects, linked to their office-PC opportunity, and assign it to me,” first find the exact opportunity with `opportunity_search` scoped to Example Willow Architects. Use its ID in `opportunity_id`, set `owner` to `self`, and infer priority, queue and due date from the request, conversation and current valid tenant choices before calling `ticket_create`. Ambiguous opportunities require a choice; do not pick an arbitrary search result.

For an existing ticket, use `ticket_update` with `changes.opportunity_id` and the last-read `expected.opportunityID` (null when unlinked). Ticket reads now include opportunityID. This release supports adding or replacing a link, not clearing it. The opportunity must exist and have the same company as the ticket, including a fresh check immediately before dispatch. No company move is performed.

Creation stores an encrypted, immutable intent and a durable request key. Use `at_operation_status` or `at_operation_reconcile` with the returned operation_id to check its recorded ticket; an unknown create with no native ID cannot be automatically retried. Ticket creation is a direct tool and is not a supported background-job kind in this release.

Neither creating a linked ticket nor changing the link updates the opportunity, converts a quote, generates charges or time, or runs the GUI Won Quote conversion workflow. Verified creation means supplied ticket fields matched the saved record; it does not establish notification delivery.

## Ticket time with start/stop requirements

`time_log_ticket` and the shared ticket documentation/resolution time input accept `start_datetime` and/or `end_datetime` ISO timestamps with explicit UTC offsets. With only one endpoint, the other is calculated from minutes; see [context-aware timing](TIME-ENTRY-TIMING.md). Supply actual observed times, for example `2026-09-15T08:00:00-05:00` and `2026-09-15T08:30:00-05:00`, alongside `work_date: 2026-09-15`, `timezone: America/Chicago` and `minutes: 30`. Never derive an invented work interval from duration alone.

The resolver derives a missing endpoint and checks that elapsed duration matches minutes and the start falls on work_date in the selected timezone. It converts the instants to UTC, passes them to native `startDateTime`/`endDateTime`, and verifies saved timestamps independently of duration. Existing duration-only inputs remain supported for tickets whose native rules allow them.

The tenant returned HTTP 500 with the exact validation message `TimeEntries for Service tickets require a start and stop time.` The adapter now recognizes only that exact single-error response on a time-entry create as `invalid_input`, retaining the safe diagnostic `start_stop_required`. Other HTTP 500 responses remain uncertain and are never automatically repeated. Error bodies are bounded; arbitrary native text is not added to receipts. Older unknown receipts are not automatically reclassified.

## Ticket due-date updates and title presentation

`ticket_update` accepts `changes.due_datetime`, an ISO date/time with explicit UTC offset, and requires the last-read `expected.dueDateTime` (or null if unset). It uses the existing scoped, idempotent update flow and guarded native PATCH. Saved and expected timestamps compare by instant, so equivalent offsets/formats do not produce false conflicts; genuinely different dates still fail verification/preconditions.

For a date-only request, retain the existing local due time when known and resolve the target date in the user's established timezone. If the time cannot be determined, ask instead of inventing a midnight or UTC deadline. Due dates on existing tickets were previously omitted from the update allowlist even though reads and ticket creation supported them. Autotask documents the native field in [Tickets](https://ww22.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/TicketsEntity.htm).

Response instructions require each ticket reference to include its exact title with the ticket number and an available link. Grouped Weekly Differential rows need individual titles too. Reuse known titles; do not fabricate unavailable titles. This is model-facing guidance, not a guarantee that every client will follow it. Refresh client metadata after deployment.

Role resolution is only required when an update changes owner, queue or category. Due-date/title/other unrelated edits preserve the existing assignment and must not select a new role merely because the employee has multiple roles. Scope, expected-state, metadata binding and immediate pre-dispatch checks remain active. A role-ambiguous reassignment is still rejected.

### Creation completeness and follow-up

Address all twelve fields for every creation: **due date, client, queue, priority, requester, role, category, ticket type, title, description, issue type and sub-issue type**. Explicit user facts take precedence; infer omissions from conversation and linked records, then use applicable tenant defaults. Contextual inference belongs to the calling assistant, which has the conversation; the MCP server validates the submitted values and applies documented deterministic defaults. The server does not receive hidden chat history.

Requester is the client contact (`contact_id`), not the employee owner. A role requires an eligible assigned employee. Sub-issues must be active and belong to the selected issue. Never invent identities or native IDs. Unknown optional fields should not delay creation; ask for adjustments after verified creation. An unresolved client or native required field still blocks a valid create and needs the minimum clarification beforehand. There is no arbitrary default client, requester or due date.

Submit contextual inferences in `creation_assumptions`; these are encrypted with the original intent, never written into native ticket fields or plaintext journal data. After verified creation, show title/ID and chosen values plus `creation_review.assumptions`, `defaulted_fields` and `unresolved_fields`. The review concerns the original verified submitted fields, not later ticket state; omitted native defaults are not claimed as verified. Replay retains the original review. Unknown/failed creation does not emit a verified review. Legacy receipts without stored assumptions cannot reconstruct them.

These additive inputs and receipt fields preserve older callers. Refresh client tool metadata after deployment to discover the new inputs and instructions. Deployment history is recorded in [current status](CURRENT-STATUS.md).

Native rules: [Tickets](https://webservices.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketsEntity.htm) and [picklist defaults and parent values](https://webservices.autotask.net/help/developerhelp/Content/APIs/General/Picklists.htm).

### Contact activity and explicit role corrections

Autotask REST documents `Contacts.isActive` as an integer. Contact search and resolution now normalize `1`/`0` and compatible boolean values consistently. Missing, null or malformed values produce an unavailable-status error rather than falsely reporting inactive or authorizing a link. Contacts are read fresh; same-company/authorized parent-company and ambiguity checks remain enforced. See [Contacts field definitions](https://webservices.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContactsEntity.htm).

Existing-ticket `ticket_update` accepts `changes.role: {kind: "id", id: ...}` or `{kind: "name", name: ...}` with the last-read `expected.assignedResourceRoleID`. It uses the current assigned employee, or `changes.owner` if supplied. `ticket_write_options` with `kind: "ticket"` now returns all eligible `assignments`, including role labels and default flags. Role selection is validated against employee, queue and category, then rechecked before dispatch and verified after saving. Unrelated edits still preserve the role; an unassigned ticket cannot receive a role without an owner. Existing callers remain compatible. Local verification did not modify live tickets. These fixes are deployed; the September 17 release additionally corrects native role casing to `assignedResourceRoleID`.

## Existing-ticket issue classification

`ticket_update.changes` accepts `issue_type` and `sub_issue_type` as exact names or native IDs; sub-issue also accepts null to clear it. Supply both `expected.issueType` and `expected.subIssueType` from a fresh ticket read. Current writable metadata and active parent/child choices are validated again before dispatch; saved fields are read back. Changing only the parent preserves the existing child only if compatible. A mismatched child requires an explicit replacement or clear. A sub-issue-only change sends its validated current parent as required by Autotask.

For the reported New Requests (27) / Laptop (292) pair, both IDs can be supplied once current tenant metadata confirms the relationship. The feature is deployed; implementation tests did not change the live ticket.

Autotask may apply contract-exclusion rules when the sub-issue changes, including changing or clearing the ticket contract. Issue-field readback verifies the requested pair; it does not certify that all native side effects were absent. See the [Tickets API requirements](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketsEntity.htm).
