# Direct Autotask ticket links

Superseded coverage: see [Record links](RECORD-LINKS.md) for all supported record types and the current command mapping.

Ticket results now include `web_url` for opening the native Autotask ticket UI. This is response enrichment, not an additional tool or Autotask API call. The implementation is deployed; client metadata refresh and signed-in native link checks remain separate acceptance steps.

## Result locations

| Tool/result | Link field |
| --- | --- |
| `ticket_search` | `data[].web_url` |
| `ticket_context`, `ticket_prepare_visit` | `data.ticket.web_url` |
| `my_workday` | `data.assigned_tickets.items[].web_url` |
| `at_get` / `at_query` for Tickets | `data.item.web_url` / `data.items[].web_url` |
| Write and operation-status receipts containing `data.ticket_id` | `data.web_url` |
| `at_invoke` | Same result as the wrapped named tool |

Clients should display the ticket number or an “Open in Autotask” label as a Markdown link to `web_url`. Opening the link uses the user's normal Autotask browser sign-in. It does not grant access or establish that a mutation succeeded; the existing receipt state remains authoritative.

## Configuration and boundaries

The first hostname in existing `AUTOTASK_TICKET_HOSTS` is the canonical link host. Configure a bare hostname, not the MCP server URL, REST API URL, or an entire ticket URL. Remaining hostnames continue to serve as accepted input aliases. An absent/invalid first hostname omits links without breaking the operation. Host configuration is never inferred from customer text or returned URLs.

The link uses the same native `ExecuteCommand.aspx?Code=OpenTicketDetail&TicketID=...` format already accepted by ticket-reference resolution. Only returned positive safe-integer ticket IDs are used. Unknown creates without a returned ticket ID produce no link. Note IDs, operation IDs and caller-supplied IDs are not substituted. Existing scope and authorization checks run before response enrichment; no record text is recursively interpreted as a link instruction. URLs are generated for presentation and are not added to durable journal state.

Company/contact/opportunity/quote/task links are now included through their own documented routes; see RECORD-LINKS.md. Generic queries with projections that omit the ticket ID also omit the link.

## Verification

`tests/ticket-links.test.ts` covers hostname/ID validation, missing-ID and uncertain receipts, preservation of untrusted text, fixture runtime search/context/query/workday/wrapper links, URL round trips, write/status/replay receipts and out-of-scope rejection. No live Autotask writes or browser-navigation validation are performed by these tests.

Local verification on September 15, 2026: strict TypeScript checking passed; full fixture/mock suite passed **597 tests**, zero failures/skips/cancellations; production TypeScript build passed with output isolated under `work/ticket-links-build`. Deployment was not changed by this side-conversation implementation, and native browser navigation remains unverified.
