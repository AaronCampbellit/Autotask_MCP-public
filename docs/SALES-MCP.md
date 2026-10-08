# Opportunities and quotes in MCP

This module adds sales records and bounded quote evidence/retrieval to the existing LAN MCP deployment. It does not implement eQuote delivery, native PDF rendering, customer acceptance, Quick Quotes, or the Won Quote wizard. Saving or approving an internal quote record is not customer acceptance or conversion to a project, contract, order, or invoice.

## Tools

| Tools | Purpose |
| --- | --- |
| `opportunity_search`, `opportunity_get`, `opportunity_count` | Scoped pipeline and details; company aliases, owner/self, stage and status filters |
| `opportunity_create`, `opportunity_update` | Create or revise an opportunity, including sales fields and forecasts |
| `quote_search`, `quote_get`, `quote_count`, `quote_compare` | Quote records and comparisons; item pagination is explicit |
| `quote_create`, `quote_update` | Save quote records linked to an existing opportunity |
| `quote_item_search`, `quote_item_get` | Read a quote's line items |
| `quote_item_create`, `quote_item_update`, `quote_item_delete` | Manage individual lines through `Quotes/{quoteID}/Items` |
| `quote_template_search`, `quote_template_get` | Existing tenant template metadata; no template editing |
| `opportunity_note_search`, `opportunity_note_create` | Opportunity-associated CompanyNotes; create through `Companies/{companyID}/Notes` |
| `quote_location_create` | Save a supplied address and return a company/actor-bound location receipt |
| `sales_schema`, `sales_reference_search` | Current supported fields, active picklists and catalog references |
| `sales_operation_status` | Inspect or verify an existing write without replaying it |
| `quote_workflow_inspect`, `quote_workflow_prepare` | Read quote evidence and prepare a documented native Autotask UI handoff for send, preview/PDF, acceptance or Won conversion |
| `quote_opportunity_pdf_search`, `quote_opportunity_pdf_get` | Discover and retrieve an existing PDF attached to a CompanyNote for the quote's opportunity; association and acceptance limitations remain explicit |

All searches label partial results and return encrypted, expiring continuations bound to the actor, mapping, company scope, filters and page size. Unknown filters are rejected. Company shorthand uses the existing 29-client alias table. Contact searches require a company; catalogs and quote templates are tenant-wide.

## Building a quote

1. Read `sales_schema` for Opportunities and Quotes. Choose actual active picklist values; labels are resolved exactly, never guessed. Create an opportunity first if none exists. The current employee is the default opportunity owner; `useQuoteTotals` defaults to false. Required fields come from current API metadata. `projectedCloseDate` and `closedDate` require YYYY-MM-DD.
2. Supply billing, shipping and sold-to address IDs. Either call `quote_location_create` with the company and supplied address fields, then pass the returned `location_token` in `location_tokens`, or use `location_source_quote_id` to reuse addresses from an existing accessible quote for that same company. The same address can fill all three roles. Location receipt hashes detect changed addresses.
3. Call `quote_create` with `opportunity_id`, `fields`, and a stable `request_key`. Supply `primaryQuote` explicitly. Approval defaults to Not Requested. Effective and expiration dates are validated, as are company/contact/parent relationships. Primary-quote changes may affect another quote in the opportunity; they are explicit inputs.
4. Read `sales_schema` for QuoteItems and use `sales_reference_search` for product, service, bundle, role, billing code, shipping or tax references. Add lines using `quote_id`. A line has at most one item reference and one nonzero discount method. Product periods cannot be semiannual; cost/labor/expense/shipping are one-time. Service/bundle lines need their catalog reference and omit the catalog-controlled name. Setup fees cannot have costs or discounts.
5. Inspect each receipt. `succeeded_verified` means supplied fields matched the saved record, not that a quote was delivered. `accepted_unverified` means the API accepted the operation but saved-field verification did not complete or match. Autotask may recalculate or ignore fields, especially totals and permission-controlled costs. Read the saved record and receipt before proceeding.

Updates require `expected` values for every changed field from a prior read. These checks reduce accidental overwrites but are not an atomic upstream compare-and-swap. Editing descriptions or other rich text through the API replaces formatting with plain text. Quote-item deletion requires the parent quote ID and expected name, quantity, unitPrice and quoteItemType; it has no automatic undo. Opportunities and quotes have no delete tool.

## Authorization and persistence

`SALES_ENABLED=true` configures this module; `SALES_WRITES_ENABLED=true` additionally permits its write paths. Both resource evidence and a shared request budget are mandatory. All tools require `operational.read` and `finance.read`; mutations also require the new `sales.write` capability, an enabled tool switch, and an unpaused write control. Existing ticket permissions are not a substitute for `sales.write`.

Reads use the API account with application-enforced company scope, as selected for this deployment. Writes send the mapped employee in `ImpersonationResourceId`. Receipts report native attribution fields when available; they do not claim that every entity/action honors impersonation. Live write attribution and behavior await operator validation. No native qualification is fabricated.

The transport uses fixed server-built endpoints, a pinned Autotask zone, bounded response sizes/timeouts, the shared request scheduler and budget, and no automatic retries. User tool arguments cannot specify URLs, headers or identities. Sales write inputs are encrypted in the existing operation journal; migration `006_sales_intents.sql` permits only the explicit sales operation names. Text and prices are excluded from plaintext receipts. Request keys and payload hashes prevent duplicate dispatch, including after restart. Unknown creates without a returned ID require manual investigation; they are never guessed or replayed. Known IDs can be read back using `sales_operation_status`.

## Verification scope

Local simulated-API tests cover company/parent isolation, capability denial, filter preservation, unsafe cursors, required fields and picklists, quote location proofs, expected-value conflicts, creation/update/deletion paths, duplicate prevention, unknown outcomes, delayed verification, and SQL intent persistence. The operator requested no live test records or mutations. Live business write validation remains the operator's next step.

## Sources

Reviewed official entity docs and the zone's Swagger route definitions:
- [Opportunities](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/OpportunitiesEntity.htm)
- [Quotes](https://ww2.autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuotesEntity.htm)
- [QuoteItems](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/QuoteItemsEntity.htm)
- [QuoteTemplates](https://ww14.autotask.net/help/developerhelp/content/apis/rest/Entities/QuoteTemplatesEntity.htm)
- [CompanyNotes](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/CompanyNotesEntity.htm)
- [CompanyNoteAttachments](https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyNoteAttachmentsEntity.htm)
- [Swagger](https://webservices5.autotask.net/atservicesrest/swagger/ui/index)

## Publication and customer-response inspection

`quote_workflow_inspect` reads current quote approval, customer-response and publication evidence with native labels when metadata supplies them. `quote_workflow_prepare` returns read-only context and the documented native UI handoff. `quote_opportunity_pdf_search` queries bounded `CompanyNoteAttachments` candidates by opportunity; `quote_opportunity_pdf_get` requires the quote opportunity, CompanyNote and attachment IDs, verifies the PDF envelope, and returns an existing attachment in bounded chunks. Multiple quotes can share an opportunity, so the result is labeled opportunity-note association and does not establish quote-specific acceptance. Internal approval does not establish customer acceptance, and publication does not prove delivery. See [Quote delivery investigation](QUOTE-DELIVERY-INVESTIGATION.md) for the supported UI handoffs and remaining integration research.
