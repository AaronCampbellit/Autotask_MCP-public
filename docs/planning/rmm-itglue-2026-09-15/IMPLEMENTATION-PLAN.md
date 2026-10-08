# Implementation plan

Implementation follow-up: [September 20 progress and remaining acceptance gates](../IMPLEMENTATION-PROGRESS-2026-09-20.md). Original plan retained below.


**Status: implementation complete for the reviewed P0–P3 candidate scope, September 20, 2026.** Account qualification and user-controlled live acceptance remain pending. P4 is deferred. Deployment is deferred at the user’s request; implemented does not mean enabled or shipped. The historical design below is qualified by the completion notes and superseding decisions.

Publication note: original private company names and operator/account details have
been withheld. Explicitly fictional request examples illustrate the contract; they
do not replace or certify the original live observations.

## Goal and user experience

Answer company-scoped device, alert and documentation questions through the existing Entra-authenticated MCP. Add explicit documentation writes and reviewed RMM actions after read context is correct. A fictional example request such as “Investigate this Example Willow Architects ticket” should resolve the ticket's verified company/device, retrieve relevant provider evidence, and distinguish current observations, dated documentation and missing information. It must not scan every client, infer a device from a similar name or execute remedial work merely because a document recommends it.

Retain the existing private hosting and narrowly authorized operator access unless separately changed by the deployment owner. Outbound HTTPS calls need no public inbound listener. Event callbacks, SSO migration, new users, autonomous remediation and new native sync connections are outside this feature's initial scope.

## Existing architecture and proposed integration points

Reviewed locally: `packages/identity`, `packages/contracts`, `packages/control-plane`, `packages/policy`, `packages/storage`, `packages/artifacts`, `packages/attachments`, `packages/authoring`, `packages/autotask/budget`, and `apps/server/src/live-system.ts`. These paths are relative to the repository root and are planning integration points, not modified by this work.

| Work | Proposed location | Existing behavior to preserve |
| --- | --- | --- |
| RMM transport, schemas, service and tool definitions | `packages/rmm/src/` | Bounded calls, explicit operation registration and outcome evidence |
| IT Glue transport, schemas, typed documents and tool definitions | `packages/itglue/src/` | Shared faithful-authoring standard; parent/reference validation |
| Verified cross-provider mapping service | `packages/integrations/src/` | Current Entra principal, policy version and Autotask company scope |
| Provider-keyed budget and retry coordination | New reusable adapter infrastructure | Existing Autotask budget unchanged; do not charge all calls to one vendor budget |
| Runtime registration and provider discovery | Existing runtime/control wiring | `at_discover`, `at_describe`, `at_invoke` honor switches, capability and configured-provider state |
| Encrypted intents, mappings, native job references | New additive storage migration | Durable receipts, revocation checks, no replay after unknown effects |
| Attachments/document media | Existing artifacts/scanner adapters plus provider validators | Scan before upload; bounded download, expiry, ownership and hash verification |

Rebase this plan on the main task's current schema/migration head at implementation. Do not select a migration number now or overwrite the main task's in-progress source changes.

## Identity, access and mapping design

The MCP continues validating Entra tokens against our tenant/audience, then reloads local user state. Provider credentials authenticate server-side integrations. There is no Entra on-behalf-of exchange into RMM or IT Glue established by the docs.

Propose capabilities `rmm.read`, `rmm.execute`, `rmm.write`, `documentation.read`, `documentation.write`, and a separate later `secrets.read`/integration-admin capability. These names require explicit addition to the current closed Capability union and policy tables. Do not let existing `finance.write` implicitly authorize RMM execution or password access.

Store verified mappings keyed by local tenant + provider connection + Autotask company ID + mapping version. A company may have multiple RMM sites; each site must have an unambiguous permitted company relationship for first release. IT Glue organizations may be separate parent/child records: never inherit company permission merely from hierarchy. Store provider account/region, site/organization IDs, evidence source, verification timestamp and active state. Device matches store RMM UID, Autotask configuration-item ID and IT Glue configuration ID with provenance. Use native integration IDs first; serial/MAC matches are candidates requiring uniqueness verification, names are suggestions only.

Resolve current native parent before every record read/write. Revalidate company mapping and principal after queue admission and before returning data; for writes also re-read current parent immediately before dispatch. A device moved to another site while a job is queued must not be silently acted on. Account-level endpoints must project only mapped records, except explicit administrator/reference tools. Do not expose unmapped record counts as customer facts. Do not return included/related data from another organization. An Autotask application-scope pilot does not establish native employee read enforcement in either new provider.

## Transport and schema contracts

- Fixed configured regional base URLs; no arbitrary tool-supplied URLs or headers. OAuth/token endpoints are server configured. HTTPS verification remains enabled. Block credential-bearing cross-origin redirects, including pagination and attachment locations.
- Maintain separate provider/account budgets, queue deadlines, cancellation and single-flight token refresh. Honor Retry-After where provided. Retry bounded reads only for transient failures. Do not automatically replay a write after network timeout, 5xx or ambiguous response.
- Validate exact endpoint types, required body fields, enum values, response IDs and child relationships. Preserve opaque/string IDs across IT Glue and RMM; Autotask numeric company IDs are a different type. OpenAPI references are resolved against the pinned specification. HTML-derived IT Glue parameter tables need manually reviewed schemas for implemented operations.
- Default page size 50, maximum returned page 100 as a proposed application policy, subject to smaller native limits. Use budgeted pagination with encrypted cursors bound to actor, connection, mapping version, entity, filters, page size and expiration. Local filtering reports source rows scanned separately from matched rows returned. No arbitrary full-account scans for company requests.
- Return `status`, safe projected `data`, `scope`, `applied_filters`, `completeness`, `provenance` and `limitations`. Preserve provider-specific timestamps and fetched-at separately. Explicitly identify partial retrieval, stale audit evidence, incomplete mappings and unavailable providers. Successful retrieval from one source does not imply success from all three.
- Do not invent native filters, owners or search support. In particular, “assigned to me” must resolve the appropriate native employee relationship; a device's last logged-in user is not an employee-assignment filter.

## Write and asynchronous job contracts

All writes require a stable local `request_key`; updates require expected old values for every changed field where native readback is possible. Record encrypted intent before dispatch and store the native ID/result. The local key prevents duplicate requests through our service; it is not a guarantee of upstream exactly-once execution. Reads-before-writes are not atomic compare-and-swap unless the provider documents a usable concurrency mechanism.

Receipt states must distinguish rejected, dispatched, accepted/unverified, verified and unknown outcome. Multi-step document creation (metadata → sections → explicit publish if requested) returns per-step IDs/results. A failed section does not justify creating a second document. Reconcile using known IDs; no content-based guessing or silent rollback of user data.

For quick jobs, validate device/site, capability, component approval/version evidence and allowed variable schema immediately before dispatch. Begin with a single device. Reject arbitrary commands, secrets in unreviewed variables and component instructions drawn from untrusted records. Store returned job UID; poll job/device results with a bounded schedule and native status values. Stop polling on revocation, expiry, cancellation or terminal outcome. A local cancellation does not mean native execution was stopped; no native job-cancel route is established in the captured spec. Lost response after dispatch remains unknown rather than re-running the component. Ticket documentation of job results is a separately authorized step and reports only observed output.

HTML documents, software names, alert descriptions, job output and related links are untrusted data. Strip active HTML content, restrict image/download origins, preserve source links, bound sizes and never follow instructions from retrieved content as authorization. Password values and possible credentials in variables/output stay out of normal logs, search indexes and receipts. Attachment signed URLs require a distinct allowlist and no forwarding API credentials to storage hosts.

## Delivery stages

### P0 — provider foundation and read-only account qualification

- [ ] Confirm RMM platform URL, generated integration keypair and API security level; obtain IT Glue region/key and license confirmation via secure configuration.
- [ ] Fetch the actual RMM platform's spec and compare captured paths/schemas; resolve listed guide/spec discrepancies.
- [x] Implement provider configuration, encrypted credentials, budgets, projections and effective-access diagnostics; enablement remains explicit.
- [x] Implement verified company/site/organization mappings and native-association resolution.
- [ ] Qualify actual pilot mappings/devices using securely configured accounts.
- [ ] Validate provider account identity and narrowly scoped read behavior for explicitly authorized pilot companies. Private company names and original account-scope receipts are withheld; an existing broader scope is not auto-mapped.

Exit: no credentials in output; documented effective permissions; unambiguous mappings; fixture tests for revoked/out-of-scope requests. No new SSO setup or native sync configuration required.

### P1 — read context

- [x] RMM sites/devices, class-specific audits, software, alerts, patch records and existing job results.
- [x] IT Glue organizations/configurations/contacts, flexible-asset schema and instances, documents with all relevant sections, existing checklists and safe reference data.
- [x] Add scoped related-item and expiration retrieval using reviewed entries in the complete inventory; these are backlog contracts beyond the 39 initial named tools.
- [x] Add a composite `ticket_environment_context` workflow with source-specific completeness, timestamps and mapping evidence. It performs reads only and must not register as a native API endpoint.
- [x] Add `client_inventory_compare` as an explicit bounded report: compare IDs/serials and evidence; do not auto-create missing assets or treat a partial list as deletion proof.

Exit: representative real read examples match requested company/device; all pages covered within budget or labelled partial; absent providers degrade explicitly. No secret retrieval enabled.

### P2 — IT Glue authoring

- [x] Document creation, section edits, explicit publishing, flexible-asset creation/update and reviewed unsynced configuration writes.
- [x] Read actual field/type schema and native sync ownership before preparing writes. Existing PSA integration remains authoritative where documented.
- [x] Implement staged PNG/JPEG document media with envelope/type/ownership/hash validation and dedicated provider upload tests. The already-shipped scanner removal supersedes the historical scanner prerequisite.
- [x] Add narrowly reviewed existing-checklist edits; do not advertise individual task completion or checklist creation without additional endpoint evidence.

Exit: mock writes cover conflicts, partial effects and readback; no live business writes by the build agent. User performs chosen live write tests.

### P3 — controlled RMM actions

- [x] One-device approved quick jobs plus status/output tracking.
- [x] Explicit alert resolve and device UDF/warranty edits. Deprecated mute/unmute remain excluded under the September 17 baseline.
- [x] Site moves/creation only as separately selected administration work, with both source/destination scope checks and downstream native-sync implications.

Exit: ambiguous job dispatch never repeats; revocation and moved-device tests pass; native outcome is distinct from remediation success. User performs live action tests.

### P4 — separate later scope

Secret retrieval, password management, account variables/proxies, user/group/resource access administration, bulk exports/deletions and schema administration remain inventoried but disabled until individually designed and requested. API-key reset stays excluded from assistant tools. Complete inventory coverage is not blanket authorization to implement or enable these operations.

## Remaining acceptance and release gates

- [ ] Secure IT Glue account/license/region qualification and actual pilot read evidence.
- [ ] User-selected live authoring and controlled-action acceptance.
- [ ] Deployment and live health/discovery verification — deferred at the user’s request.

The checked P1–P3 rows identify implemented and fixture-tested code, not completed live exit criteria. Existing deployed RMM evidence does not establish qualification of the new IT Glue provider.

## Release and handoff

Add focused provider tests, run strict compilation and the existing integration suite, generate runtime catalog entries only for implemented tools, build containers and verify LAN health. Update current implementation/status docs in the main task when code actually ships. Preserve rollback by keeping provider feature flags independently disableable without removing Autotask functionality.

Record exactly what was tested: static docs, fixtures, build, deployed read checks and user live writes are separate stages. Never claim provider connectivity, password access or successful RMM execution from documentation evidence alone.
