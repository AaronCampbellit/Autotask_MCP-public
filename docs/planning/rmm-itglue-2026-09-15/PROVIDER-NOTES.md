# Provider behavior, evidence and unresolved gaps

All source files and retrieval hashes are listed in [the manifest](source-manifest.json). Items marked design are our proposals. No API credentials were requested or used for this research.

## Datto RMM

Primary sources: [API guide](https://rmm.datto.com/help/en/Content/2SETUP/APIv2.htm), [live Swagger configuration](https://vidal-api.centrastage.net/api/v3/api-docs/swagger-config), [live OpenAPI](https://vidal-api.centrastage.net/api/v3/api-docs/Datto-RMM-v2).

- Enable API access in RMM Global Settings, then generate a user API key/secret. Record the exact platform API URL from that account. The API uses OAuth 2.0; the guide documents tokens expiring after 100 hours. Preserve the token response expiry when present and single-flight refresh. This is independent of the employee's Entra token.
- The current guide says the user's API security level controls permissions, with device visibility and component-level restrictions on relevant endpoints. Do not use older documentation claiming unrestricted API access. Effective tenant access must be checked separately.
- The guide reports shared account limits of 600 query and 100 write requests per rolling 60 seconds, with throttling and temporary blocking for persistent excess. Our provider budget must account for other integrations and use conservative headroom.
- All request paths in the inventory are relative to `[platform API URL]/api`. Do not double the `/api` prefix. Retain native identifier types: numeric device ID is different from device UID. Store UID as an opaque string.
- Preserve native `PaginationData`, query parameters and the appropriate collection property (`devices`, `sites`, `alerts`, etc.). Do not copy Autotask's POST query continuation logic into this adapter. Allow only approved provider origin/path for continuation URLs and redact query strings in diagnostics.
- Device records include last-seen/audit/reboot timestamps and available status fields. Audit data is observed evidence; last logged-in user is not proof of current ownership. Installed software is not proof of use, cloud consent or meeting-bot attendance.
- `PUT /v2/device/{deviceUid}/quickjob` accepts a job name and existing component/variables. The response UID identifies the job. Query job status, device results and output separately. Never translate request acceptance or generic completed state into successful remediation.
- Component execution has privileged endpoint effects. Define a reviewed component list and allowed variables; do not expose arbitrary code or let documentation text choose a component. Component creation is outside the documented REST surface. Source: [component behavior](https://rmm.datto.com/help/en/Content/3NEWUI/Automation/Components/Scripting.htm).
- Alert resolution is in the live spec. Correction verified September 17: mute/unmute routes are deprecated and their summaries explicitly state these actions are unavailable since 8.9.0; exclude them despite route presence. Closing an alert is not proof that the cause is fixed. Device UDF/warranty changes, site moves, site creation and variables have separate writes. No general patch-install/approval, remote desktop interaction or arbitrary shell endpoint is established by this captured spec. A returned Web Remote link is not a remote-control API.
- Account variables, site variables, settings, stdout and stderr may contain sensitive values. Safe projection applies even when an operation is GET. API-key reset is deliberately excluded from assistant tools.

## IT Glue

Primary sources: [API reference](https://api.itglue.com/developer/), [access guide](https://help.itglue.kaseya.com/help/Content/1-admin/it-glue-api/getting-started-with-the-it-glue-api.html), [pagination](https://help.itglue.kaseya.com/help/Content/1-admin/it-glue-api/pagination-in-the-it-glue-api.html), [filtering](https://help.itglue.kaseya.com/help/Content/1-admin/it-glue-api/sorting-and-filtering-in-the-it-glue-api.html).

- The access guide describes API use for the current Enterprise plan. Verify the actual subscription. API keys authenticate with `x-api-key`; JSON:API payloads use `application/vnd.api+json`. Supported regional bases are `api.itglue.com`, `api.eu.itglue.com`, and `api.au.itglue.com`.
- Password-value access has a separate API-key setting. Do not infer per-user IT Glue restrictions from our Entra identity: a shared API key is an account integration, not delegated user SSO. Enforce our company scope independently and verify key access controls before team expansion.
- The reference reports 3,000 requests per five-minute window and a maximum requested page size of 1,000. Our default should be smaller and bounded. Preserve JSON:API `data`, `included`, `links`, errors and string IDs. Server filter support is endpoint-specific; unsupported search must be explicitly labelled bounded local filtering.
- Invalid keys and native authorization errors must remain access errors, not be presented as missing data. Retain 429 handling and secret-redacted diagnostics. Key inactivity revocation is documented; no API request should be sent merely to prevent expiry without an actual operational need.
- Documents have separate metadata, typed sections, images and publication actions. Use section endpoints for content. Keep edits narrowly scoped and preserve other sections. List behavior is unusual: omitting `filter[document_folder_id]` returns root-level documents; the documented explicit null filter returns all folders. Test the actual URL encoding and never claim all documents from the default list.
- An included related record is not automatically in scope. Validate organization ownership of configurations, documents, contacts, flexible assets, attachments, and related items before projection. Avoid `include` values that expose passwords, exports or access-control relationships by default.
- Configurations and other records can carry PSA/RMM association filters. Use paired `psa_id` + `psa_integration_type=autotask`, or documented RMM identifier/type pairs. Never join on name alone, and do not assume every record has sync identifiers.
- IT Glue warns that an organization PATCH can fail when the organization syncs with the PSA. Source-of-truth rules therefore apply before proposed asset/contact/organization writes. Do not create duplicate records to work around a native write restriction.
- Flexible-asset types and fields define each instance's `traits`. Fetch and validate actual required types and Tag relationship targets; do not treat example templates as tenant schemas.
- The reference lists existing checklist reads/updates/deletes, but no checklist creation route and no separate public checklist-task update route in this snapshot. Limit initial tools accordingly. Reading task relationships is not proof we can toggle individual tasks.
- Password APIs, exports, resource access grants, group/user administration and bulk deletion are inventoried for completeness but deferred. Document image/attachment uploads require approved media handling and scanner checks. Secrets and exported account data must never enter ordinary search indexes or durable plaintext receipts.

## Cross-product source of truth

Kaseya's [three-product integration guidance](https://rmm.datto.com/help/en/Content/3NEWUI/Setup/Integrations/ITGlueIntegration.htm) describes RMM device data flowing into mapped Autotask configuration items, then into IT Glue. Preserve existing sync ownership: read operational observations from RMM, service work from Autotask and authored procedures from IT Glue. Our integration must not become a competing synchronization writer. Existing mappings must be inspected before proposing new associations.

## Source discrepancy and limitation log

| Finding | Evidence | Implementation consequence |
| --- | --- | --- |
| API guide's `/api/v3/api-docs/Datto-RMM` returns HTTP 500 | Same failure observed on all six documented platforms during public retrieval | Do not use the stale path. |
| Official Swagger initializer loads `/api/v3/api-docs/swagger-config`, whose URL list contains `Datto-RMM-v2` | Captured Swagger config and working specification | Use the discovered URL; capture the tenant platform's spec before integration. |
| Guide mentions `/v2/device/{deviceUid}/site/patch-management`; captured spec does not | API guide versus 55 captured paths | Mark policy-detail retrieval as unverified, not an initial tool. Patch data reads are independently present. |
| Guide uses capital `Warranty` and plural `variables/{variableId}` in places; spec uses lowercase `warranty` and singular `variable/{variableId}` | Guide/spec comparison | Build from captured exact spec paths, then verify on the tenant. Never guess case/route fallback for writes. |
| Quick-job guide says component UID is unavailable via API; live schema describes component listing | GET `/v2/account/components` and `JobComponentRequest` in spec | Verify actual returned component IDs before enabling execution; retain operator-selected component mapping if necessary. |
| Some spec operations omit security declarations | Captured OpenAPI compared with authentication guide | Empty security arrays are not anonymous-access permission. Authenticate all integration calls. |
| IT Glue uses multiple route headings in one HTML group | Captured HTML and extracted `documentation_group`/aliases | Shared parameter details apply to aliases; check which parent argument is required on the chosen route. |
| No tenant access tested | Only public references fetched | Permissions, billing/license, field visibility, supported build and live behaviors remain unverified. |
