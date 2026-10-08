# Ticket primary and secondary resources

`ticket_secondary_resource_options` reads the ticket's current primary employee and role, its secondary assignment IDs, and active employee/service-desk-role choices. The result expires after 30 seconds. All write tools recheck current ticket, company, identity, role, and assignment state before native dispatch.

- `ticket_primary_resource_assign` sets both `assignedResourceID` and `assignedResourceRoleID` through the guarded `ticket_update` path. Supply the last-read primary IDs and the exact selected employee and role. Existing secondary assignments for the selected employee must be removed first. The ticket update compares expected values and verifies native readback.
- `ticket_secondary_resource_add` creates one child association through `Tickets/{ticketId}/SecondaryResources`. It rejects the primary employee, duplicates, and the 50-assignment limit.
- `ticket_secondary_resource_remove` deletes the exact child association through `Tickets/{ticketId}/SecondaryResources/{associationId}`. Supply the association, employee, and role IDs from the options response. A second read verifies its absence.

Secondary writes use durable request keys and are never automatically repeated after an unknown outcome. Check `at_operation_status` and the current ticket state before a fresh attempt. A ticket's primary assignment and its secondary associations are separate native writes; changing one does not automatically change the other.

The captured Autotask Swagger contains root `TicketSecondaryResources` query and get routes but **no root POST**. The earlier MCP implementation posted to that missing root route. The nested child route is required for creation, so the previous 404 cannot be attributed solely to an unsupported impersonation header. The route correction and new tools are deployed and discoverable; native tenant write qualification remains pending.
