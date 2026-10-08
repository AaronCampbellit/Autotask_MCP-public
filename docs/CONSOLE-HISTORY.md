# Console history and readable labels

Deployed September 17, 2026. Release: `0.1.0-console-history.20260917.2`.

## Activity and administration history

The Activity page shows all recorded MCP activity in the tenant to platform administrators. Other employees see only their own activity. Administration history retains its existing administrator/audit-reader authorization. Both pages support user, action, outcome, UTC date-range and literal text filters, applied on submission. Results use 50-row pages (API maximum 100) and stable timestamp/ID cursors. Changing filters resets pagination.

Activity is the existing operation journal, not a complete log of every read-only MCP request or every action taken directly in Autotask. Historical rows include action, state, timestamps and user identity. They do not include saved results, request bodies, encrypted inputs, financial data or arbitrary business record contents. Admin visibility does not confer another user's receipt access, retry or reconciliation permissions. Cross-user rows expose summary details only; existing owner and current-access checks remain on result/recovery routes.

Names and email addresses are resolved from the existing Entra connection. A process-local, single-flight cache lasts 60 seconds, with a 15-second negative cache when unavailable. Names represent the current directory, not a historical snapshot. Disabled/deleted accounts absent from the enabled-member directory display an unavailable-name label and retain their identifier under Details. Missing names never grant or remove access to recorded history. Authorization is checked before storage reads and after storage/directory work.

User, Action, Affected item and Outcome replace internal actor/target/state terminology. Sales and business journal action codes are translated to readable actions as well as their UI tool counterparts. Technical IDs and action codes remain available in Details. Background work, permission forms, controls, selected receipt labels and overview text also use readable labels. The sidebar displays the actual server release from the authenticated session response.

## System impact

History is read from the local database; browsing history does not request ticket/quote data from Autotask or call an AI service. Directory lookup is cached across pages and filters. Responses are paginated, and only safe summary columns are selected from the journal. Text search examines summary fields and known action labels, never protected payloads. Date/user/action/outcome indexes support common filters; broad text-only searches across a large history can still scan many entries, so use date/action/user filters for large datasets.

Migration `013_console_history.sql` adds six indexes for tenant history, user pagination, action and outcome filtering. Existing audit ordering is retained. Indexes add storage and a small per-record maintenance cost. Migration index creation can briefly affect writes and must be included in the deployment maintenance procedure. No business or audit records are rewritten or deleted.

## Deployment

Migration 013 and the multi-resource collector configuration were applied on September 17. Server/collector health, MCP release discovery, named directories and tenant history were verified. See `CURRENT-STATUS.md` for backup locations and verification counts.

This release includes the staged Entra onboarding and People/permissions changes. Apply migration 013 before starting the new server, and apply the already prepared multi-resource collector configuration as described in `ENTRA-USER-ONBOARDING.md`. Back up the database and configuration first. Verify the new release, Entra names, two users' activity, admin filters/paging, ordinary-user isolation and audit access after deployment. No new users were activated during deployment. The following procedure remains the checklist for subsequent deployments.
