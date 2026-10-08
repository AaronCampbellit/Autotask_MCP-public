# MCP tool and result contracts

Names and payloads below are proposed product contracts. Final JSON Schemas will be generated and reviewed against the capability registry and tenant metadata during implementation. They are not instructions to call an existing server.

**Discovery strategy**

Expose mandatory, permission-filtered named technician tools alongside a small stable discovery/status entry set. The first technician release must expose the named workflows below directly through tools/list for authorized users; generic discovery/invocation alone does not satisfy this requirement. Mandatory means required product implementation, not access for every user. Each call independently enforces the same policy as at_invoke.

**Mandatory technician tool surface**

| Named tool | Technician purpose | Required behavior |
| --- | --- | --- |
| ticket_search | Find tickets using familiar business terms | Resolve permitted company, queue, status and technician references; bounded results with native ticket numbers/links |
| ticket_context | Understand what happened on a ticket | Retrieve requested authorized history, internal/external notes and existing time entries; explicit per-collection completeness and freshness |
| ticket_update | Change a ticket | Resolve human-readable field choices; validate exact changes, execute when permitted and verify persistence |
| ticket_note_add | Add an internal note or customer-facing response | Explicit audience, valid parent, recorded note ID and honest native attribution |
| time_log_ticket | Record work on a ticket | Resolve employee, eligible role/work type and required fields; journal and read back the saved entry |
| time_entry_search | Read time already logged | Retrieve actual permitted time records by ticket, resource and date; paginate and disclose scope/completeness |
| schedule_search | Check existing scheduled work | Return authorized schedule entries with explicit timezone and relevant conflicts |
| service_call_create | Schedule ticket work | Resolve ticket/resource references and times; validate associations, persist and reconcile partial outcomes |

These are proposed public names to freeze at WP-14; renaming during contract review must retain a direct named equivalent for every row. Additional task/internal-time and broader domain workflows remain in the full roadmap. The discover/describe path serves less common operations without advertising hundreds of large schemas at connection time. Generic entity tools supplement, rather than replace, these everyday workflows. Named workflows cannot require the technician or assistant to construct raw entity filters, navigate child routes, or manually join API records for a routine task.

Reference resolution remains deterministic: accept ticket numbers and authorized unambiguous names, resolve picklist IDs server-side, and ask a focused clarification for ambiguous targets or missing business information. The AI client interprets natural language; the MCP does not need its own LLM. Complete requested collections across API pages within execution budgets, or return a resumable job/continuation with an explicit partial result. Bounded presentation is not permission to omit history silently. Do not reveal the existence or counts of prohibited content.

Acceptance example: "Show me what happened on this ticket, including internal notes and time already logged." The client uses ticket_context; the server retrieves and relates the authorized records, and the client explains them with source links and any limitations. The technician never needs to supply entity names, pagination instructions or API relationships. See the benchmark cases in [09 — Verification](09-VERIFICATION.md).

**Required coordinated technician tools**

The original eight named tools remain mandatory. The completed technician workflow layer additionally exposes the following permission-filtered tools directly; details and implementation order are in [17](17-TECHNICIAN-WORKFLOW-CONTRACT.md).

| Tool | Purpose | Required behavior |
| --- | --- | --- |
| ticket_document_work | Save requested documentation and time together | Preflight both; verify note before time; return per-step receipt and safe remainder |
| ticket_handoff | Document and change ownership | Validate eligible target; save supplied handoff before reassignment |
| ticket_resolve | Document resolution, optionally log requested time, and close | Validate completion; persist documentation and requested time before closure |
| my_workday | Assemble a technician's work for a local date | Join authorized assigned tickets, schedule, due tasks and recorded time with section coverage |
| ticket_prepare_visit | Gather visit evidence | Resolve unique appointment/ticket and gather permitted contacts/site/assets/history; no booking |

**Supporting discovery and operations**

| Tool | Input | Output / behavior |
| --- | --- | --- |
| at_whoami | None | Current mapped identity, effective capability summary, active policy version; no secrets |
| at_discover | Domain, query, effect, cursor | Authorized operation names, descriptions, availability and short schemas |
| at_describe | Operation or entity, metadata version optional | Full schema, fields, picklists, required capabilities, action permissions and limitations |
| at_query | Entity, filter AST, selected fields, page limit/cursor | Scoped structured records and completeness envelope |
| at_get | Entity, ID, selected fields | Scoped record, metadata version, native link where supported |
| at_related | Parent entity/ID, relation, filter/page | Validated child collection with independent completeness |
| at_invoke | Registered operation, arguments, request key | Validate and execute an authorized action or return a permission/input error; large work returns a job ID |
| at_validate | Registered operation, arguments | Optional validation/dry run without a business mutation; never required before at_invoke and grants no execution authority |
| at_operation_status | Operation ID | State, completed effects, verification and any failure reason |
| at_operation_cancel | Operation ID | Cancel only authorized undispatched work; report any in-flight uncertainty |
| at_operation_resume | Operation ID | Resume eligible failed/undispatched steps with original payload and actor mapping; fresh permissions, no blind repeat of unknown effects |
| at_playbook_list | Optional workflow/topic filter | Available versioned procedural guidance; no customer data or permission grants |
| at_playbook_get | Playbook ID and optional version | Portable guidance with related named tools, effects and recovery rules |
| at_report | Registered report, filters, output format | Bounded inline result or durable export job |
| at_job_status | Job ID, item cursor | Scope-checked progress, failures, continuation and artifact references |
| at_job_cancel | Job ID | Stops remaining work; completed items stay recorded |
| at_file_intent | Purpose, parent, name/MIME/size | Authenticated portal upload/download flow compatible with client capabilities |
| at_diagnostics | Authorized diagnostic category | Sanitized connection/metadata/coverage/health information |

There is no MCP approval tool, proposal object or approval endpoint. Arbitrary URL requests and caller-supplied credential/impersonation overrides are not exposed. Tool listing is a convenience filter; every call is independently authorized. A tool hidden by policy remains forbidden through at_invoke.

**Public contract rules**

- Use JSON Schema with required fields, bounded arrays/strings, enums where stable, and explicit additionalProperties handling. Flexible entity fields are validated against the selected registry/schema, not accepted blindly.
- IDs returned by discovery are authoritative only after the server rechecks them. A model cannot assert that a contact/resource belongs to a company.
- Accept explicit null only where the field supports clearing. Unknown properties produce a validation error, not silent removal.
- Include operation/schema versions in descriptions and results. Do not require a model to paste entire metadata snapshots back as proof.
- Tool annotations are accurate and conservative. A mixed dispatcher cannot advertise universal read-only, non-destructive or idempotent behavior. Creating a local job/artifact has local side effects even when the Autotask action is a read; policy distinguishes that from a PSA mutation.
- Keep plain-language descriptions clear about public notes, billable effects, destructive actions and required permissions. Examples use fictitious records only.

**Query shape**

```json
{
  "entity": "Tickets",
  "filter": {
    "op": "and",
    "conditions": [
      {"field": "companyID", "op": "eq", "value": 123},
      {"field": "status", "op": "in", "value": [1, 2]}
    ]
  },
  "fields": ["id", "title", "status", "assignedResourceID"],
  "page_size": 50
}
```

The example IDs are placeholders, not recommended tenant picklists. The server adds mandatory scope constraints, validates queryable fields/operators, and refuses a supplied cursor whose filter/identity scope differs. Sorting is offered only where the endpoint supports it or a bounded, explicitly labeled application sort is possible.

**Mutation shape**

```json
{
  "operation": "ticket_update",
  "request_key": "client-generated-unique-request-id",
  "arguments": {
    "ticket_id": 12345,
    "changes": {"title": "Printer unavailable"},
    "expected": {"title": "Printer offline"}
  }
}
```

The expected-value check reduces stale changes but is not an upstream atomic compare-and-swap guarantee. If the entity offers a real concurrency primitive, use it. Otherwise report the residual race and re-read at commit. Reuse of request_key with a different canonical payload is rejected.

**Result envelope**

```json
{
  "status": "succeeded_verified",
  "operation_id": "opaque-operation-id",
  "correlation_id": "opaque-trace-id",
  "data": {"entity": "Tickets", "id": 12345},
  "verification": {"performed": true, "matched_fields": ["title"]},
  "completeness": {"complete": true, "returned": 1, "next_cursor": null},
  "provenance": {
    "source": "Autotask",
    "fetched_at": "ISO-8601 UTC timestamp",
    "metadata_version": "opaque-version"
  },
  "warnings": []
}
```

Use structuredContent plus an understandable text summary where supported. Do not repeat large payloads unnecessarily. Reads can use succeeded, partial or failed; mutations distinguish queued, running, succeeded_verified, accepted_unverified, partial, failed, cancelled and unknown_outcome. Permission denial returns forbidden; there is no awaiting-approval result or confirmation token.

Errors include a stable code, safe message, relevant field/constraint, retryability, operation ID if one exists, and a recommended next action. Do not mark a timeout retryable for a mutation merely because the network error was transient. Authentication failures that require OAuth refresh use the appropriate HTTP challenge rather than only a successful JSON-RPC response containing text.

**Workflow argument design**

| Workflow family | Required semantic inputs | Outputs and validations |
| --- | --- | --- |
| ticket_context | Ticket reference; purpose investigate/continue_work/handoff/resolve/custom; optional collections/window/detail | Relevant authorized context, explicit scope/window, per-collection completeness and source IDs |
| ticket_create/update | Company/category/queue and required fields, changes/expected values | Resolved picklists, due/work-type/resource-role rules, persisted record |
| ticket_note_add | Ticket ID, text, publication audience, note type/title as required | Stored note ID/audience, native attribution and verification |
| time_log_ticket/task | Parent ID, resource resolved from caller or authorized delegate, date/time or duration, summary/internal notes, role/work type | Required fields, duration, state/billability policy and stored entry |
| time_log_internal | Resource, date/duration, internal billing code, notes | General-time constraints, valid internal code and readback |
| service_call_create | Ticket/task, eligible resources, explicit start/end/timezone | Parent/association records, conflicts and per-step outcomes |
| contract_create | Company, contract type, dates, type-specific terms and child lines | Exact parent/child plan, financial write permission, completeness/readback |
| recurring_quantity_change | Contract service/bundle reference, effective date, unit change | Adjustment command, authorized financial effect and reconciled units |
| quote_item_change | Quote, item kind/reference, quantity, period and permitted monetary fields | Type-specific fields, currency/tax policy and financial write permission |
| inventory_transfer | Item/serials, quantity, source and destination | Stock/state validation, action permissions and both-side reconciliation |
| knowledge_article_create | Category, title/content, visibility and associations | Child-route validation, content-format limits and stored references |
| udf_change | Entity/field definition, type/list/default/protection intent | Immutable-field rules, staged list creation and schema-impact validation and configuration permission |
| report | Registered report ID, authorized filters/window, format | Source/join definitions, completeness, currency/timezone and job/artifact |
| generic entity mutation | Registered entity-operation, parent IDs if required, validated fields | Same policy, direct execution and verification as a named workflow |

All other logical workflows in 05 inherit these patterns and receive a specific schema at the registry gate. Tenant-required fields are surfaced as actionable missing inputs. Resolve exact IDs internally when an unambiguous authorized match exists; ask for a choice when multiple records genuinely match.

**Optional MCP resources and prompts**

Expose capability documentation, a record snapshot or report artifact as a resource only when the client supports it and fresh authorization is enforced at read time. Resource URIs are identifiers, not bearer grants. Provide tool fallbacks for clients without resource support.

Versioned prompts/playbooks can explain ticket triage, time logging, contract review and report interpretation. They are convenience guidance, not security policy. Do not require Thread saved skills or a specific AI model. Do not use deprecated sampling/roots features as a prerequisite for the core server. Client-native prompts or optional UI cards can be added after the plain tool contract is qualified.

**Client output budgeting**

Default search responses to bounded pages and explicit field projections. Full text is available via detail calls/chunks, not silently destroyed. Large binary content goes through authenticated file delivery. The server returns a job ID before exceeding supported client timeouts; progress and cancellation use the negotiated protocol where available, with status/cancel tools as the durable fallback.

**Technician description and receipt extension**

All named tools inherit [17](17-TECHNICIAN-WORKFLOW-CONTRACT.md): shared typed references, reviewed default provenance, when-to-use/alternative guidance, audience/billing/schedule effects and step-aware recovery. Writes return readable receipts alongside stable IDs, native links, observed state, selected defaults and incomplete steps. Optional validation never gates an otherwise authorized execution. The [machine-readable workflow catalog](technician-workflows.json) describes fixed implementation definitions and is not an executable chain accepted from clients.
