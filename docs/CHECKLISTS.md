# Ticket checklists

The bounded checklist pack exposes `TicketChecklistItems` for one authorized ticket:

| Tool | Behavior |
| --- | --- |
| `checklist_search`, `checklist_get`, `checklist_options` | Read checklist items, one item, or current field metadata. A ticket has one checklist with at most 40 items. |
| `checklist_item_create` | Add an item with an explicit name and optional position, important/completed flags. The parent ticket is fixed by the nested native route. |
| `checklist_item_update` | Change item name, position, important or completed state only after expected-value checks. The ticket parent cannot change. |
| `checklist_item_delete` | Delete one item after expected-value checks and independently verify its absence. |
| `checklist_operation_status` | Reconcile an accepted or unknown mutation receipt without replaying the write. |
| `ticket_checklist_library_options`, `ticket_checklist_library_apply` | Find active ticket checklist libraries, check the current 40-item capacity, and append one library through the native ticket child route. |

The implementation uses the documented child routes under `Tickets/{parentId}/ChecklistItems`: GET for query and item reads, POST/PATCH for create/update, DELETE for removal, and the child `entityInformation/fields` route for current field metadata. The captured entity model defines `itemName` as required text up to 600 characters, `isCompleted` and `isImportant` as booleans, optional `position`, optional `knowledgebaseArticleID`, and read-only `id`, completion audit fields and `ticketID`. Knowledge-base article linking is read-only in this pack until a separate authorized resolver is reviewed.

Every operation resolves the ticket through the existing company scope, rechecks the parent after budget admission, and uses the mapped employee with `tickets.write` for mutations. Mutations reserve encrypted intent under a stable request key. Full supplied-field readback is required for create/update; deletion stays unverified unless an independent GET returns the documented inaccessible/not-found response. Unknown outcomes are never automatically replayed.

Library options are derived from current `ChecklistLibraries.entityType` picklist metadata and return only active ticket libraries. Applying a library rechecks its active/type metadata, source items and current ticket item count immediately before the write; the result is verified by the expected count increase. The operation is journaled and never automatically repeated. Autotask requires application-wide checklist access and ticket checklist permissions; those native permissions remain authoritative.

This pack does not expose task checklist libraries, arbitrary checklist fields, or bulk operations. The new library tools have no tenant qualification or live write result. The native conditions and 40-item limit come from the captured [TicketChecklistItems documentation](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChecklistItemsEntity.htm), [TicketChecklistLibraries documentation](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketChecklistLibrariesEntity.htm), and the locally captured Swagger route inventory (ignored operator evidence under `work/docker/swagger.json`).
