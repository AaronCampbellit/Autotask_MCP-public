# Ticket tag associations

The deployed release provides three tools:

| Tool | Behavior |
| --- | --- |
| `ticket_tag_options` | Read current tag associations and active matching tag choices for one scoped ticket. Search text is required. |
| `ticket_tag_add` | Add one active tag after a fresh duplicate and 30-tag-limit check. |
| `ticket_tag_remove` | Remove one exact association after rechecking its association, tag and label. |

Create and delete use Autotask's ticket child route `Tickets/{parentId}/TagAssociations`; reads use the `TicketTagAssociations` entity. Writes include the ticket ID and selected tag ID. The parent is re-resolved, company scope is checked, and the active tag/current assignment state is refreshed immediately before dispatch.

Each write requires a stable request key and is stored in the operation journal. A successful response is read back through the ticket's associations. An unknown result is never retried automatically; use `at_operation_status` and inspect the ticket before creating a new request. The tools do not bypass Autotask permissions: adding requires ticket object access, while removal additionally requires the native tag administration and remove-tag permissions. These relationship writes are authorized upstream as the configured API user; the MCP separately enforces the mapped employee's capability and company policy.

The tools are deployed and discoverable, but have no tenant qualification or live tag mutation evidence. The 30-tag maximum and native permission requirements are documented by [Autotask TicketTagAssociations](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketTagAssociationsEntity.htm); the exact child route comes from the captured Autotask Swagger route inventory.
