# Native field updates

Ticket, opportunity, quote, quote-item, and the existing business-record update tools accept editable fields from current Autotask metadata instead of a fixed local update-field list. Existing company scope, area permissions, person identity checks, expected-value checks, request-key deduplication, and readback verification still apply. This adds no automatic edits to existing records.

## Tickets

Read `ticket_write_options` with `kind: "ticket"`. It returns `fields`, `current_values`, `work_types`, and the existing assignment options. Set `include_udfs: true` for custom-field definitions and values. Work type (`billingCodeID`) is an operational field visible without Finance permission.

Use the named `changes.work_type` input with an exact work-type name or ID and `expected.billingCodeID` from the read. `changes.description` edits the description. Additional native fields use `changes.fields`, for example:

```json
{
  "ticket": {"kind": "id", "id": 123},
  "changes": {"work_type": "Exact work-type label", "fields": {"estimatedHours": 2}},
  "expected": {"billingCodeID": 456, "estimatedHours": 1},
  "request_key": "unique-request-key"
}
```

The numbers above are examples; always read the actual record and current choices. Native assignment/status/category/contact inputs go through the existing semantic checks. Do not supply both a named input and its native equivalent. Supply `changes.person_identities` keyed by native person-field names for explicit native person IDs. Financial fields and ticket/business UDFs require Finance access. Other-record links must remain within authorized company scope and compatible parents.

Already-completed tickets can be edited without rerunning completion prerequisites. Transitioning into completion still checks them. Cancellation does not invent or require a reason; supplied reasons are saved as resolution.

## Opportunities, quotes, and business records

Read `sales_schema` or `business_schema`, then the corresponding record's `*_get` action. Get responses expose current metadata-defined values. Pass native names in `fields` and each last-read value in `expected`. Business schema reports `allowed_for_update` separately from `create_only`; a create-only field is not editable after creation.

This covers the existing update routes for contracts and contract components, invoices, projects, phases, tasks, project/task notes, CRM to-dos, configuration items and notes, subscriptions, products, inventory products/items, purchase orders, and purchase-order items. It does not invent update routes for read-only entities or command-only operations.

## Custom fields

Request schema metadata with `include_udfs: true`. Where the native entity supports UDFs, pass `fields.userDefinedFields` (inside `changes.fields` for tickets) as an array of `{ "name": "Exact name", "value": "New value" }`. `expected.userDefinedFields` must contain the same names and their last-read values; use null for an unpopulated field. Only supplied UDFs are changed. Native UDF metadata uses `type`, unlike standard field metadata's `dataType`; both are handled. Unknown, read-only, or unsupported UDF types are rejected. Native multi-select/reference UDF limitations remain.

## Native limits and verification

Autotask remains authoritative for read-only fields, create-only relationships, required values, allowed picklists, permissions, and record-state restrictions. Editing a quote record does not send it, record customer acceptance, or execute a Won Quote conversion. Specialized time, expense, scheduling, and checklist workflows retain their own contracts.

The server rechecks ticket metadata and expected state before dispatch. Sales/business metadata is cached for at most one minute; expected values and scope are rechecked at dispatch. Read-before-write is not an atomic upstream lock. `accepted_unverified` and `unknown_outcome` are not confirmed success and must not be automatically replayed.

Sources: [Autotask field metadata](https://webservices.autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_EntityInformationCall.htm), [Tickets](https://ww2.autotask.net/help/developerhelp/content/apis/rest/entities/TicketsEntity.htm), [UDF support and native limitations](https://webservices.autotask.net/help/developerhelp/Content/APIs/REST/Entities/UserdefinedFieldsUDFs.htm).
