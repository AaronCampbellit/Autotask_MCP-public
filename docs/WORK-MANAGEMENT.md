# Time, expenses, availability and time off

`packages/work-management` adds a bounded work-management pack. It uses the captured Autotask Swagger models and fixed native routes, application company/resource scope, current metadata choices, shared request budgeting, encrypted intent journals and readback receipts. The pack is available only when its runtime and capability switches are enabled; local fixtures and mocks do not qualify a live tenant.

## Tools

| Tool | Scope |
| --- | --- |
| `time_search`, `time_get` | Read authorized ticket, project-task and internal time with safe projections and bounded, actor/filter-bound continuation. |
| `time_log_task`, `time_log_internal` | Create explicitly supplied task or internal time for the signed-in employee. `time_log_ticket` remains in the existing operational catalog. |
| `time_correct`, `time_delete` | Change or delete the employee's mutable time only after expected-value checks. Posted or billed entries are rejected. Delete remains unverified until an independent absence/reconciliation check. |
| `expense_report_create`, `expense_item_add`, `expense_report_submit`, `expense_report_status` | Create and submit the employee's expense report, add items with explicit `receipt` and required `billable` values, and inspect status using live status metadata and linked-parent scope checks. Native report creation supplies the server's default In Progress status; the readonly status field is never sent. Native reimbursement state is derived and has no input field. `receipt: false` is preserved when supplied. |
| `resource_availability`, `resource_availability_update` | Read or update the signed-in employee's daily availability; writes require `scheduling.write` and an `expected` object containing the prior seven daily hour values (plus any prior optional goal/travel values supplied). |
| `time_off_search`, `time_off_request`, `time_off_cancel` | Read and manage the employee's requests. A request is for one `requestDate` and explicit decimal `hours` plus a reviewed `timeOffRequestType`; start/end timestamps are not native inputs. |
| `time_timesheet_review`, `time_billing_approval_review`, `time_billing_approval_record` | Leadership can inspect one employee's paged time entries and one entry's billing approval history, then record only the next reviewed billing approval level. This does not submit, approve, or post a native timesheet. |
| `time_off_approver_resources`, `time_off_review`, `time_off_approve`, `time_off_reject` | Leadership can find their native approver assignments, review one assigned employee's requests, and approve the next level or reject with a reason. The signed-in mapped resource is the impersonated approver. |
| `work_operation_status` | Recover the recorded status of an unverified work-management mutation without replaying it. |

Time duration is never inferred. A time create or correction supplies either explicit minutes or both explicit start and stop values, with date, summary and reviewed role/work-type choices. Team or delegated time mutations are not exposed. Expense and scheduling writes use `expenses.write` and `scheduling.write` respectively; ticket/task/internal time writes use `time.self`.

Leadership workflows require the separate `time.approve` capability. Billing approval review/record additionally require Finance Read/Write respectively; time-off actions require Scheduling Write. Explicit area grants must include Time Read for entry review, Time Write for billing-level creation, Finance Read/Write for billing levels, and Scheduling Read/Write for time off. Entry review still enforces related ticket/project and company scope. Approval writes use stable request keys, fresh expected-state checks, the shared request budget, and readback; an uncertain result is not replayed automatically. Autotask's Approve & Post timesheet operation is not exposed by REST, so it remains a native UI handoff.

The service checks the employee and every relevant company parent immediately before dispatch. A task must resolve through its project; an expense linked to a ticket or task must pass that parent scope check. Expense reimbursement is native-derived and is not client writable. Corrections reject records with native billing evidence (including a billing approval timestamp) and reject posted or otherwise immutable records. Availability updates compare the complete expected prior record after budget admission. Expense submission verifies the exact reviewed `Submitted` or `Awaiting Approval` status label after the native update. Every mutation returns a durable receipt; a timeout or incomplete readback stays `accepted_unverified` or `unknown_outcome` and cannot be silently retried.

## Current boundaries

Ticket checklist CRUD is available through the separate bounded checklist pack using the native `TicketChecklistItems` child routes. Active ticket library discovery and guarded one-shot library append are deployed; native writes have not been tenant-qualified. Contact capability is lookup and ticket linking only; contacts and companies do not have general administration tools. Native attachment upload requires an actor-owned staged artifact with ordinary file validation. Quote send, native quote PDF generation, customer acceptance and the Won Quote workflow are not implemented. The webhook receiver is optional receipt storage with gap hints, not a full synchronization engine or an automatic native subscription manager.

Automated validation uses fixtures and mocked HTTP. Read-only tenant field/status metadata was also checked. No live business-write test was run. See [CURRENT-STATUS.md](CURRENT-STATUS.md), [OPERATIONAL-WRITES.md](OPERATIONAL-WRITES.md), [TICKET-ATTACHMENTS.md](TICKET-ATTACHMENTS.md), [SALES-MCP.md](SALES-MCP.md) and [REPORTS-AND-SYNC.md](REPORTS-AND-SYNC.md) for adjacent boundaries.

Ticket checklist operations are documented separately in [CHECKLISTS.md](CHECKLISTS.md).

`work_write_options` includes active native currency references for expense inputs and does not invent currency IDs or exchange rates. Availability changes to optional goal/travel fields require their corresponding expected prior values.

## Currency access and troubleshooting

The final 2026-09-15 check succeeded: effective currency query access is `All`, USD was returned by `work_write_options`, and `GET Currencies/1` confirmed the active record. No security-level change was made by the build agent. The following earlier failure and recovery guidance remains useful if access changes.

The 2026-09-14 read-only check received an Autotask permission denial for `Currencies/query`. `work_write_options` still returns expense fields with `status: partial` and `currency_lookup: unavailable`. It never invents currency IDs. Expense-item writes require an independently verified active currency and remain blocked when that lookup cannot be authorized. Expense report creation/submission and other work-management operations have their own checks; no currency permission was granted by this release.

Autotask's public REST documentation does not define a separate, named "Currencies read" permission. The integration API-only user's security level must allow read/query access to the `Currencies` entity in the Finance, Companying & Invoicing area. Expense-item access is separate: the same API user also needs the applicable Expenses object-level query/create permissions. Copying the built-in `API User (system)` security level is the documented broad-access baseline; a least-privilege custom API-only level may be used if it grants both of those entity permissions.

An administrator can verify the effective grant with read-only calls (using the tenant's normal REST base URL):

1. `GET /atservicesrest/v1.0/Currencies/entityInformation` should report `canQuery: true` and `userAccessForQuery` as `All` or `Restricted` (the latter is valid when the returned records are appropriately scoped).
2. `POST /atservicesrest/v1.0/Currencies/query` with a bounded `MaxRecords: 1` filter should return a valid result. The captured tenant Swagger exposes the plural `Currencies` route used here.

Whether multi-currency is enabled does not explain a query denial: Autotask documents that the Currencies REST query is available even when that feature is disabled. A 401/403 therefore requires an API-user security-level or tenant authorization change; this service does not attempt to grant or bypass it.

References: [Currencies REST entity](https://ww1.autotask.net/help/developerhelp/content/apis/REST/Entities/CurrenciesEntity.htm), [entityInformation and security levels](https://ww2.autotask.net/help/developerhelp/content/apis/rest/API_Calls/REST_EntityInformationCall.htm), [ExpenseItems permissions](https://ww1.autotask.net/help/developerhelp/content/apis/REST/Entities/ExpenseItemsEntity.htm), and [REST API security and authentication](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_Security_Auth.htm).

The 2026-09-15 read-only recheck confirmed `info.canQuery: true` and `info.userAccessForQuery: None` for Currencies. `work_write_options` now returns the sanitized effective `currency_access` when available and avoids issuing a currency query when access is explicitly None. An administrator must correct the API account’s security level if it reports None again.
