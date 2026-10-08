# Business pack integration note

The live server constructs one `BusinessService` with the existing `TicketWorkflows`, `IntentCipher`, and request budget, then adds `...businessTools(businessService)` to the `ToolRuntime` catalog. Use `businessOperations` as the operation capability map. Use the current operation map and [area permissions](AREA-PERMISSIONS.md) for authorization. Converted policies use independent domain Read/Write grants; Finance access is required for financial operations/protected fields, not every business read. Legacy capability policies retain their compatibility behavior.

The central capability union includes `finance.write`, `projects.write`, `procurement.write`, and `configuration.write`. The durable journal migration admits the `business_*` operation names emitted by this pack. The journal redactor preserves only bounded `company_id`, `native_id`, entity/action, verified state and attribution for these names; encrypted intents contain the original fields.

Focused verification is in `tests/business.test.ts`. It uses a mocked fetcher only and never calls a live Autotask host. Run the repository typecheck and full test suite for integration verification; the focused business checks cover native field names, reviewed routes, parent scope, create-only readonly exceptions, pagination, and durable write receipts.
