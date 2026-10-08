# Read-only evidence collector

`packages/collector/src/index.ts` and `scripts/collect-live.ts` implement the narrow identity and capacity collector retained by the current pilot. It makes only fixed GET requests: ThresholdInformation, selected entity field definitions, and one bounded Resource query (the configured resource, or up to 500 resources with `verifyAllResources`). It cannot create qualifications or mutate Autotask. It supplies employee and capacity evidence; it does not prove native employee ticket permissions. The current pilot uses the application-controlled access model documented in [Current status](CURRENT-STATUS.md).

The collector reads `config/metadata/collector.json` (tenantId, resourceId, policyVersion, baseUrl, windowMs, requestsPerWindow, externalHeadroom, intervalMs) and three Autotask credential environment variables. The zone must be an HTTPS Autotask webservices host with the exact REST v1.0 path. Redirects, unexpected routes, malformed responses, oversized responses and failures do not renew resource evidence. Logs exclude credentials and native response bodies.

First installation captures a partial field inventory for Resources (id/isActive), Tickets (id/ticketNumber/companyID), and Companies (id/companyName/isActive). Other fields, picklists and UDFs remain uncaptured. Metadata is genuinely recaptured daily, with a seven-day expiry after each successful capture. Renewal requires identical selected field definitions, tenant, policy marker and inventory digest. Changed definitions or corrupt snapshots block renewal; timestamps are never extended without new API reads. An expired snapshot may recover only after the same fresh capture and definition comparison. Existing qualifications or provider bindings are rejected rather than silently overwritten.

Between daily metadata captures, cycles preserve the metadata digest and refresh the employee status and threshold observation every 120 seconds. Observations expire after 240 seconds. Captures are immutable, hashed, and referenced by atomically replaced envelopes. A failed resource capture leaves the previous resource proof to expire. Inactive employees are captured as inactive, never reactivated by the collector. Evidence capture files are retained for operator review; arrange archival/retention for a long-running deployment without removing any source referenced by a current snapshot or threshold envelope.

Run exactly one collector process. Its local request history is persisted before each attempt and survives normal restarts. The history fails closed on corruption, clock regression or exhaustion. The configured maximum is 100 requests per rolling window, with no automatic retries. This is a separate partition from the application process allowance, not a distributed budget: reserve these 100 requests in the application's external headroom. The collector reserves its whole local partition plus the specified external headroom when evaluating the observed shared capacity. A threshold request is the bounded bootstrap observation and is itself charged to the persisted partition. Do not scale this service or run manual collector invocations concurrently with it.

Use `deploy/collector.compose.yaml` together with the base Compose file and your HTTPS override. Mount the same metadata directory read-only in the server and read-write in the collector. There are no collector host ports or database credentials. To initialize, run the collector once before enabling METADATA_SNAPSHOT_PATH on the server. Start the collector service after the one-shot process exits. Use only one application server instance for this pilot.

The documented native ThresholdInformation response reports its timeframe in minutes. The collector normalizes this to milliseconds and rejects any mismatch with the reviewed configuration. Documentation: https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm and https://ww2.autotask.net/help/developerhelp/content/apis/rest/API_Calls/REST_EntityInformationCall.htm.

Validation: `npm run check` and `npx tsx --test tests/collector.test.ts tests/metadata*.test.ts tests/request-budget.test.ts`. The tests cover fixed GET requests, pinned metadata, verified evidence, server budget ingestion, malformed/foreign resource observations, threshold headroom, persistence and failed-capture behavior. They do not constitute live employee permission qualification.

## Explicit application-enforced read mode

`APPLICATION_SCOPED_READ_OPERATIONS` opts into API-account reads for an explicit subset of `Tickets.query,Tickets.get,Companies.query,Companies.get,TicketNotes.query,TicketNotes.get,TimeEntries.query`. It is separate from `ENABLED_AUTOTASK_OPERATIONS` and does not create or claim native impersonation qualification. Requests in this mode omit ImpersonationResourceId; the server's API account defines upstream visibility. Entra authentication, active employee mapping, fresh resource verification, capability checks, company scopes, field projection, cursor binding, current control switches and shared request capacity still apply. Authorization is rechecked before dispatch and after workflow reads. A metadata snapshot and reviewed budget are mandatory.

This mode can read ticket notes and ticket-scoped time, but cannot authorize scheduling, attachments or writes. Those retain their existing native evidence requirements. The original read-only pilot paused writes and restricted discovery to its read pack. Later releases enable separately controlled write/domain packs; see current status for deployment evidence. Do not present API-account read results as filtered by native employee permissions. The admin configuration snapshot exposes `applicationReadOperations` separately from `liveQualified`.


Automatic renewal acceptance is opt-in in `RefreshingMetadataSnapshotProvider` and enabled only when application-scoped reads are configured and native operation enablement is empty. It accepts new capture hashes/dates only when the read-only definition digest is unchanged. Both the original and renewed snapshots must have no provider bindings or native qualifications. Native qualified deployments retain strict digest pinning. Failed/changed metadata collection does not refresh employee proof, so reads stop after the last proof expires. No automatic restart or broadened permission grant is used.

To validate a genuine recapture manually, stop the sole collector service, run its command once with `--once --refresh-metadata`, then restart the collector. Never run a second collector concurrently: they share one persisted request allowance. Daily renewal uses three additional metadata requests within the collector's existing 100-request hourly partition. The narrow inventory remains partial; it is not a full tenant metadata or write-qualification collector.

## Exact status search

Application-scoped ticket search can resolve an exact active status label or ID from a fresh, fixed `Tickets/entityInformation/fields` GET using the existing ticket-read authorization and shared request budget. This lookup is separate from the collector’s partial inventory and grants no write qualification. Missing, inactive, ambiguous or unavailable status definitions stop the search; the status filter is never silently removed. Native qualified deployments retain their existing catalog resolver.

For the Rarity workflow, “customers have responded” means the exact status “Customer Note Added.” When combined with “assigned to me,” tool guidance requires both technician self and that status in the initial query, rather than historical note scanning. This language mapping is assistant guidance; the structured search enforces the filters supplied to it.

## Company and open-ticket search

Application-scoped ticket searches resolve accessible company names through Companies.query/get, without native technician catalogs. Exact names take precedence; otherwise a unique partial match is required. Unknown, ambiguous or incomplete matches stop before ticket search. EXW is a fictional example alias for Example Juniper and Redwood.

The user-approved `open_only` definition excludes Complete, Complete (With CSAT), Canceled and Duplicate. The adapter resolves these labels and queries the remaining active status IDs together with the company filter. Missing terminal status definitions fail closed. Status metadata is cached for 60 seconds per adapter, with authorization rechecked on every lookup; it grants no write permission. Assistant guidance distinguishes unsupported-operation qualification errors from login failures.

## Client shorthand

`packages/workflows/src/company-aliases.ts` contains 29 fictional company examples for offline demos and tests, including channel-name aliases EXSEQ and Spruce PM. Replace these examples with your own authorized tenant configuration before use. Ticket search expands an exact company-name alias before resolving it against current accessible companies. Matching ignores case and repeated whitespace; punctuation is preserved, unknown abbreviations are not guessed, and title text is not rewritten. No company IDs or permissions are granted by the alias table.

## Expanded tools

The business, work-management and attachment modules consume this same fresh employee/capacity evidence and request budget. They obtain their additional field and choice metadata through reviewed fixed routes when needed. The preserved initial coverage inventory is not a complete catalog of current runtime tools; use [TOOL-CATALOG.json](TOOL-CATALOG.json) and authenticated `at_discover` for declared and currently available operations respectively.

## Multiple employees (deployed September 17)

Set `verifyAllResources: true` to verify a complete batch of up to 500 Resources in the existing single resource-query allowance per cycle. The original `resourceId` must still be present. Each resource receives independently hashed evidence, including its actual active/inactive state. Duplicate, truncated or malformed responses do not renew proofs. The default remains the original single-resource mode. The updated Compose health check accepts multiple fresh proofs. See [Entra onboarding](ENTRA-USER-ONBOARDING.md) for rollout and permission setup.
