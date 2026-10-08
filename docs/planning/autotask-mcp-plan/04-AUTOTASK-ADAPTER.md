# Autotask adapter and capability registry

**Registry record**

Each entity-operation record must contain: canonical runtime entity name, indexed/documentation aliases, root and child route templates, allowed HTTP methods, parent-ID schema, required capabilities, scope resolver, metadata endpoints, request/response schemas, conditional validators, sensitive fields, impersonation support, pagination strategy, side-effect classification, retry/reconciliation policy, readback strategy, source URL/date, and evidence status. Special actions are records in their own right, not guessed CRUD variations.

The registry is reviewed code/configuration. Documentation extraction seeds it; tenant metadata refines it; neither is loaded directly as executable routing instructions. New entities, changed fields or altered permission data create a drift report. An operator may inspect a new capability before a release enables it.

**Discovery and metadata**

The registry additionally records `execution_identity_mode`, required mapping checks, identity-validation freshness bound, and separate impersonation evidence for header acceptance, native attribution and employee permission enforcement. Evidence is per entity/method/special action, with test IDs, resource/security context, date and observed allowed/denied outcomes. Unknown enforcement blocks employee-required enablement; changing identity mode requires a reviewed registry change.

1. Resolve the configured API user's Autotask zone using the documented discovery path, and validate the resulting hostname and expected HTTPS path. Discovery success is not authentication success.
2. Perform an authenticated low-impact probe. Record API version, credential validity and relevant integration threshold information without exposing credentials.
3. Fetch entityInformation and field/UDF metadata with bounded concurrency and caching. Capture capability flags and userAccessFor values where supplied.
4. Resolve picklist labels, IDs, active states and parent dependencies per tenant. Do not hardcode common status IDs such as Complete=5 or assume every queue shares values.
5. Validate conditional entity rules separately. Metadata cannot fully express contract-type requirements, resource-role eligibility, billing lock states or every tenant setting.
6. Persist a metadata version/hash. Bind write intents and generated schemas to it, and refresh or reject on material drift.

[Entity information](https://www.autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_EntityInformationCall.htm), [Entity overview](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/_EntitiesOverview.htm)

**HTTP execution**

Use structured route construction; never concatenate caller-supplied full URLs. Maintain the server-side username, secret, integration code and mapped impersonation header. Do not forward these to redirected or unapproved origins. Validate nextPageUrl using the same origin/path policy. Retry zone resolution only through a bounded documented path, never by following arbitrary error content.

Set connect/read/overall deadlines and distinguish pre-dispatch failure from post-dispatch uncertainty. Safe read retries may use exponential backoff with jitter. Mutations require operation-journal reconciliation before a retry if they may have reached Autotask. Keep per-database throughput, per-endpoint concurrency, user quotas and attachment-byte budgets separate. Observe ThresholdInformation without treating it as an atomic capacity reservation shared with other integrations.

Return typed, sanitized errors with correlation IDs: invalid_input, forbidden, not_found_or_inaccessible, unsupported_operation, missing_metadata, precondition_failed, conflict, throttled, dependency_unavailable, partial_result, unknown_outcome. Preserve useful upstream validation detail after redaction; do not reduce all failures to “tool error.” Authentication HTTP challenges must remain HTTP challenges for clients that need to refresh OAuth.

**Query contract**

For employee-required operations, validate the server-owned resource mapping before the business request and assert that the constructed request retains the required impersonation header. Apply this invariant to root/child reads, pagination, mutations, retries and worker dispatch. Reject invalid identity with `identity_mapping_invalid`; unavailable validation returns `identity_validation_unavailable`; unqualified enforcement returns `impersonation_not_qualified`. Never retry without impersonation or with broader credentials. Return sanitized errors without leaking employee-directory details. See [identity requirements](03-IDENTITY-AND-PERMISSIONS.md).

Define a validated filter AST with supported operators, field names, value types and bounded nesting/OR conditions. Apply mandatory record and field policy before executing. Do not accept arbitrary SQL or arbitrary Autotask request JSON that bypasses schema checks. Cross-entity joins are application workflows with explicit cost limits.

For root queries, preserve the HTTP method, filters, include-fields and page size while following documented continuation URLs. For each child collection, implement its actual pagination behavior; do not assume every child uses POST/query. A cursor is opaque, signed and bound to actor/scope, entity, filter hash, metadata version and expiry. A cursor is not a permanent authorization grant.

Every response states returned count, requested cap, completeness, continuation availability, warnings and data timestamp. A full sweep that reaches a configured cap is partial. Count-only endpoints need the same filters and access restrictions as list endpoints. Avoid calling count if it doubles expensive API work unnecessarily. There is no guaranteed atomic snapshot across a long export; detect duplicates, record the window and explain changes that occur during traversal.

[Advanced queries](https://www.autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_Advanced_Query_Features.htm)

**Mutation contract**

Separate create, patch, explicit replace, delete and special action types. Omitted properties are unchanged in a patch; null, empty string, zero and false are distinct requested values whose validity depends on the field. Never drop a supplied field silently. Some fields are required on create and read-only afterward. Reference fields must point to permitted records and valid parent relationships.

Prefer PATCH for partial updates. Never fall back to PUT after any generic 404. An entity that requires replacement needs its own complete writable-field contract, loss analysis and explicit required capabilities. Preserve unrelated UDFs according to the entity's actual semantics; do not assume partial UDF arrays merge. Reject attempts to clear protected/masked values by sending the mask back.

After a successful create, capture the returned ID and read the stored record where permitted. After update, compare relevant requested fields to actual persisted values. Classify normalized/calculated differences separately from ignored or rejected changes. For read-inaccessible or create-only entities, return accepted_unverified and reconcile through the related parent/derived records when possible. Delete verification must not confuse loss of permission with proof of deletion.

[PATCH](https://www.autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_Updating_Data_PATCH.htm), [PUT](https://www.autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_Updating_Data_PUT.htm)

**Special surfaces beyond ordinary CRUD**

| Surface | Planned adapter treatment | Evidence to obtain |
| --- | --- | --- |
| InvoiceMarkupXML, InvoiceMarkupHtml, InvoicePDF | Authorized invoice exports with content-type handling and file limits | Exact request method, response FileQueryResultModel, encoding and finance visibility |
| ContractServiceAdjustments and bundle adjustments | Effective-dated quantity commands; related service/unit readback | Create-only behavior, unit-change semantics, dates and duplicate reconciliation |
| InventoryStockedItemsAdd/Remove/Transfer | Explicit stock commands, financial/delete capabilities where applicable | Quantity/serial/location validation and partial failure recovery |
| PurchaseOrderItemReceiving | Receiving workflow rather than a generic quantity patch | Receipt, serial, inventory and accounting side effects |
| TimeOffRequestsApprove/Reject | HR command workflow with valid approver/resource | Approval-level/state rules and native attribution |
| Resource time-off child routes | Explicit per-resource/year routes | Singular/plural route discrepancies and authorization |
| ServiceCallTickets/Tasks and resource associations | Multi-record scheduling workflow | Parent/child routes, overlap policy and cleanup after partial creation |
| BillingItemApprovalLevels and expense submission | State-specific action handling | Supported approval behavior; do not infer general invoice posting |
| TicketHistory, deletion/activity logs, NotificationHistory | Scoped read surfaces with freshness and retention limits | Actual entity availability, pagination and interpretation |
| UDF definitions and list items | Ordered configuration workflow | Protected fields, immutable type, list creation then default assignment |
| Entity webhook families and error logs | Integration administration and recovery | Supported entity types, field selection, callback validation and delivery semantics |

[Invoices](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/InvoicesEntity.htm), [Contract adjustments](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServiceAdjustmentsEntity.htm), [UDF definitions](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/UserDefinedFieldDefinitionsEntity.htm). Remaining source pages are linked per entity in the coverage matrix.

**API limitations ledger**

- No general ticket deletion or native Autotask merge should be invented from a UI capability. A duplicate-handling workflow must name its actual cross-note/status effects and retain separate records.
- Resources document query/update, not create/delete, and updates require relevant HR admin access. User creation/offboarding beyond supported fields remains a manual/integration handoff. [Resources](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ResourcesEntity.htm)
- Configuration items return the current version; history/rollback is not available through the documented API. Protected UDF values may be masked. [Configuration items](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ConfigurationItemsEntity.htm)
- UDF deletion and some multi-select/reference UDF interactions are not supported in the captured reference. Encrypted values cannot be queried. Do not promise a general-purpose credential vault through the MCP. [UDF definitions](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/UserDefinedFieldDefinitionsEntity.htm)
- Invoices are not a generic invoice-create/post tool. Model only their supported fields, related billing data and special exports.
- ContractServices quantity changes need adjustment entities; advertised unitPrice/unitCost are not generally writable update fields. [Contract services](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/ContractServicesEntity.htm)
- Rich-text reads/updates can be lossy. Plain-text equality is not proof that formatting/images survived.

**Documentation discrepancies requiring explicit resolution**

The source index duplicates ResourceTimeOffAdditional and spells one label OrganizatonalResources. Time-off references contain naming/path differences. ConfigurationItemExts is unlinked. Subscriptions lists POST in its URLs but lacks a parsed Can Create flag. The public overview's broad query language has exceptions such as create-only adjustments. Capture these in the registry issue log; resolve against individual text, tenant metadata, approved Swagger discovery and controlled tests. A planning inventory must not silently normalize a path into existence.
