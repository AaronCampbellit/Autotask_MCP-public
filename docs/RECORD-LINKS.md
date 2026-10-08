# Autotask record links

MCP responses include `web_url` on supported records, generated after existing authorization checks without additional API calls. Display it as a Markdown link to the record in search results, record details, and create/update confirmations. If multiple records are created or linked together, link each record separately using its own returned URL. Use its number and title when available; bold labels or plain IDs do not replace clickable links. Before sending the final response, check that each presented record with a returned URL is linked. Never invent missing URLs. Links do not indicate write success; receipt state remains authoritative. Native browser sign-in and permissions still apply.

## Verified command coverage

Command formats reviewed September 15, 2026 against [Using the ExecuteCommand API](https://ww2.autotask.net/help/developerhelp/content/apis/executecommand/UsingExecuteCommandAPI.htm) and the [ExecuteCommand API introduction](https://www.autotask.net/help/developerhelp/Content/APIs/ExecuteCommand/ExecuteCommandAPIIntro.htm) (quote command).

| REST record type | Command | ID parameter | Destination |
| --- | --- | --- | --- |
| Tickets | OpenTicketDetail | TicketID | Detail |
| Companies | OpenAccount | AccountID | Detail |
| Contacts | OpenContact | ContactID | Detail |
| Opportunities | OpenOpportunity | OpportunityID | Detail |
| Quotes | OpenQuote | ID | Edit |
| Projects | OpenProject | ProjectID | Summary |
| Tasks | OpenTaskDetail | TaskID | Detail |
| Contracts | OpenContract | ContractID | Summary |
| ConfigurationItems | EditInstalledProduct | InstalledProductID | Edit |
| TimeEntries | EditTimeEntry | WorkEntryID | Edit |
| Appointments | OpenAppointment | AppointmentID | Detail |
| KnowledgebaseArticles | OpenKBArticle | ID | Article |
| SalesOrders | OpenSalesOrder | SalesOrderID | Detail |
| ServiceCalls | OpenServiceCall | ServiceCallID | Detail |
| CompanyToDos | OpenToDo | ToDoID | Edit |

The builder supports all 15 types. Appointments, knowledgebase articles and sales orders currently have no registered read tools; this change does not add API access or new operations for them. The time-entry command is documented for ticket/task time; internal time navigation requires live verification. The quote command appears in the introductory command catalog but is absent from the detailed command page; browser verification is still required.

## MCP response locations

- Existing ticket search, context, workday and ticket receipts retain their `web_url` fields.
- Opportunity, quote, project, task, contract, asset, CRM to-do and time search/get tools: `data[].web_url` / `data.web_url`.
- Contact tools: `contacts[].web_url` / `contact.web_url`; contact sales references: `data[].web_url`.
- Generic get/query/related: supported `data.entity` records under `data.item` / `data.items`.
- Schedule search: `data.entries[].web_url`; time-entry search: `data.entries[].web_url`.
- Project context: `project.web_url` and `tasks.data[].web_url`; contract context: `contract.web_url`.
- Workday: `data.tasks.items[].web_url` and `data.time.items[].web_url`.
- Ticket context/visit: supported time, asset, contact and schedule collection items; visit preparation also links `data.appointment` to its service call.
- Quote comparisons: `data[].quote.web_url`; quote inspection, preparation and PDF handoff tools: root `web_url`, plus quote/opportunity context records when returned. This is a link to the quote editor, not a PDF, customer acceptance URL or an automatic send/conversion action.
- Sales/business mutation and status receipts: root `web_url` from returned `entity` and `native_id`, except deletes.
- Scheduling/task-time receipts: `data.web_url` when no ticket link already occupies it; explicit `service_call_web_url`, `task_web_url` and `time_entry_web_url` identify each returned record. Existing ticket receipt links retain precedence.
- Wrapped named tools (`at_invoke`) return the same enriched result.

## Configuration and compatibility

The first hostname in `AUTOTASK_TICKET_HOSTS` remains the canonical host for every record type. Remaining entries are accepted ticket-input aliases. Invalid/missing configuration omits links. Only positive safe-integer IDs from authorized result positions are used; missing IDs and projections without IDs remain unlinked. The code does not walk arbitrary nested business text or copy links into journal state.

Generated ticket URLs now use the documented `OpenTicketDetail` command. Both `OpenTicketDetail` and the previous `OpenTicket` command are accepted as ticket URL inputs.

## Entities without a verified standalone link

No route is invented for invoices, invoice PDFs, expenses/reports, resources/availability, products, inventory, purchase orders/receiving, subscriptions, phases, predecessors, notes, attachments, checklists, quote items/templates/locations, or contract service/block/charge/unit/adjustment rows. Those records keep their existing IDs and parent references. They do not receive a misleading link to another record in `web_url`.

Time-off navigation is also omitted: the documented command takes resource and approver IDs (optionally tier) and can return multiple requests; it is not a stable link to a particular request ID. Artifact download URLs remain handled by the artifact/export tools.

## Validation and release

Tests cover exact route parameters, all mapped read shapes, contexts, receipts, wrappers, omitted IDs, unsupported types, untouched business text, completeness and legacy ticket URL compatibility. Fixture/mock tests do not verify browser navigation against a signed-in tenant. Build and deployment are required before connected clients receive changes.

Local verification on September 15, 2026: full fixture/mock suite passed 605 tests with zero failures. After adding visit appointment/contact coverage, all 9 focused link tests passed again, along with strict TypeScript checking, isolated production build (`work/record-links-build`), and whitespace validation. Deployment and live browser verification were not performed.
