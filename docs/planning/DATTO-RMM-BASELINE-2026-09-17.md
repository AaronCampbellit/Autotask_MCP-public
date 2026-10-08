# Datto RMM feature baseline

Research date: September 17, 2026. **Reviewed baseline implementation complete, September 20, 2026.** Existing RMM functionality plus strengthened conflict/ownership checks is covered by the [completion ledger](IMPLEMENTATION-PROGRESS-2026-09-20.md). The evidence below is the historical public-spec review; it does not qualify current live accounts. Deployment of this candidate is deferred at the user’s request.

## Recommendation

Add a Datto RMM provider inside the existing MCP, beginning with company-scoped device, alert, audit and patch reads plus a combined ticket/device context tool. Follow with controlled execution of existing components and verified job-result retrieval. IT Glue is not a dependency for this delivery.

The [September 15 research bundle](rmm-itglue-2026-09-15/README.md) already inventories the API and proposes broader integration contracts. This document narrows that work to an actionable RMM baseline. Tool names below are proposals, not registered tools.

## Evidence checked

Fetched the official [Vidal OpenAPI specification](https://vidal-api.centrastage.net/api/v3/api-docs/Datto-RMM-v2) again today. The September 17 research comparison matched the September 15 reference: 59 operations, 55 paths, 118 schemas. This publication candidate retains the [upstream source URL](https://vidal-api.centrastage.net/api/v3/api-docs/Datto-RMM-v2), method/path observations and historical provenance metadata; the copied specification is excluded. This verifies the public reference, not the customer's platform or permissions. The older URL ending in `Datto-RMM` still returned HTTP 500; the working `Datto-RMM-v2` URL is identified by the official Swagger configuration.

Two details qualify the older plan:

- Alert mute/unmute routes exist in the schema but are deprecated and explicitly unavailable since release 8.9.0. Exclude these actions. Route presence does not establish functional support.
- The prose API guide says completed-job results and stdout/stderr cannot be obtained, but the current specification exposes dedicated results/output routes. Plan against those schemas, with tenant verification required before promising the workflow.

## What this enables

| Use case | Available evidence or operation | Proposed delivery |
| --- | --- | --- |
| “Find this client's workstation and tell me its condition.” | Device hostname, OS, online state, last seen/audit/reboot, reboot requirement, antivirus and patch status | First release |
| “What is happening on the device in this ticket?” | Join authorized Autotask ticket/asset to RMM device, then collect device summary and alerts | First release; verified joins required |
| “Which devices have this application?” | Per-device audited software; bounded scans or a scoped cache needed for fleet questions | First release for device reads; fleet aggregation later |
| “Show missing patches and machines awaiting reboot.” | Device/site patch routes and device reboot status | First release; report actual provider status and collection coverage |
| “What hardware or software changed?” | Current hardware/software audits are available; historical comparisons require our own retained snapshots | Current state first; change tracking later |
| “Run our approved diagnostic and attach the findings to the ticket.” | Existing component quick job, job state, per-device results, stdout/stderr; existing Autotask note workflow | Second release |
| “Close this RMM alert after remediation.” | Alert resolve route with subsequent readback | Second release; closure alone does not prove repair |
| “Update warranty or our approved device fields.” | Device warranty/UDF writes | Later controlled writes |
| “Manage sites and integration variables.” | Site creation/update, device moves, site/account variables and proxy settings | Later administration; variables/settings may contain secrets |
| “Open the device in RMM.” | Provider-returned portal and Web Remote URLs | First release as validated links; no embedded remote-control capability implied |

These capabilities come from the current [official API schema](https://vidal-api.centrastage.net/api/v3/api-docs/Datto-RMM-v2). Missing or stale audit values must remain unknown/stale rather than healthy. Audit observations and last logged-in user do not establish current activity or device ownership.

## First tool set

Native paths below are relative to the platform's `/api` base.

| Proposed tool | Native routes / composition |
| --- | --- |
| `rmm_site_search` | `GET /v2/account/sites`; project only sites mapped to authorized companies |
| `rmm_device_search` | `GET /v2/site/{siteUid}/devices`; optional exact UID/MAC lookup with parent checks |
| `rmm_device_get` | `GET /v2/device/{deviceUid}` |
| `rmm_device_audit_get` | `GET /v2/audit/device/{deviceUid}`, `/v2/audit/esxihost/{deviceUid}`, or `/v2/audit/printer/{deviceUid}`, selected by device class |
| `rmm_device_software_list` | `GET /v2/audit/device/{deviceUid}/software` |
| `rmm_alert_search` | Site/device `/alerts/open` and `/alerts/resolved` |
| `rmm_alert_get` | `GET /v2/alert/{alertUid}`, with verified device/site ownership |
| `rmm_patch_list` | `GET /v2/device/{deviceUid}/patches` or `/v2/site/{siteUid}/patches` |
| `rmm_ticket_context` | Authorized Autotask ticket + asset association + RMM summary/alerts; audit/patch details optional |

Search contracts must support only endpoint-specific native filters. Any local filtering must disclose scan bounds, continuation and incomplete coverage. In the account device endpoint, `filterId` overrides other filters; it must never substitute for company authorization. Do not infer a supported audit route for an unknown/network device class.

Second-release candidates: `rmm_component_list`, `rmm_quickjob_run`, `rmm_job_get`, `rmm_job_result_get`, `rmm_job_output_get`, and `rmm_alert_resolve`. Quick jobs use `PUT /v2/device/{deviceUid}/quickjob`; results/output use `/v2/job/{jobUid}/results/{deviceUid}` and its `/stdout` and `/stderr` children. A completed job is not necessarily successful; use per-device/component results and relevant post-action evidence.

## Fit with the existing MCP

The current repository already provides Entra identity, employee/company scopes, capability switches, field projection, request budgeting, encrypted write intents, readback receipts and output contracts. Reuse those patterns; add a separate provider client rather than adapting RMM into Autotask entity-query semantics.

1. **Provider adapter:** proposed `packages/rmm` with typed requests, schema validation, OAuth token cache, bounded paging, timeouts and a separate account-wide request scheduler. All provider calls, including polling and token refresh, need controlled retry behavior.
2. **Verified mappings:** persist account/platform + Autotask company ID + RMM site UID. Site schemas expose `autotaskCompanyId`, which can provide mapping evidence; allow multiple sites per company. Resolve actual device `siteUid` before returning data or acting. Reject unmapped/conflicting associations. Names alone are not sufficient.
3. **Ticket/device joins:** inspect the tenant's existing native Autotask/RMM asset association and permitted ConfigurationItem fields. Prefer persisted provider identifiers; preserve ambiguous/no-device results. Do not guess a device from ticket text or hostname and then execute on it.
4. **Authorization:** proposed separate `rmm.read`, `rmm.jobs.run`, `rmm.alerts.resolve`, and later `rmm.configuration.write` capabilities. Keep tool switches and write pause. Entra identity is our authorization layer, not proof of native RMM employee impersonation.
5. **Execution receipts:** bind component UID, approved variables, device UID, company/site mapping, actor and request key before dispatch. Recheck scope after queuing. An uncertain dispatch is not automatically retried. Store returned job UID and distinguish accepted/running/succeeded/failed/unknown outcomes.
6. **Output:** include provider IDs, validated links, retrieval time, source observation time, coverage/truncation and warnings. Redact output and project fields before sending them to the model. Treat device descriptions, alerts and script output as untrusted data.

The [API guide](https://rmm.datto.com/help/en/Content/2SETUP/APIv2.htm) documents OAuth access with per-user API credentials and platform URL; token lifetime is 100 hours. It reports shared account limits of 600 reads and 100 writes per rolling minute, a maximum page size of 250, and escalation from 429 throttling to temporary IP blocking for persistent excess. Reserve headroom for existing integrations and honor token expiry. RMM's API security level, device visibility and component level must also permit the operation.

## Explicit limits

- No documented general arbitrary-shell or component-upload endpoint in the captured API. Scripts would run through pre-existing reviewed components with constrained variables.
- No general patch approval/install API, remote desktop interaction API, or device-delete route established by this specification. A component may perform a specific action, but that is a separate execution contract.
- Patch-policy detail retrieval appears in the prose guide but not this schema; exclude until verified.
- Do not include deprecated alert mute/unmute, API-key reset, secret variables or broad account administration in the initial tool set.
- Do not create another device sync writer that competes with the existing Autotask/RMM integration. Existing [vendor integration behavior](https://rmm.datto.com/help/en/Content/2SETUP/Integrations/AutotaskIntegration.htm) must inform mapping ownership.

## Implementation readiness and acceptance

Before live enablement, obtain the actual platform URL and provision credentials through the existing secret-management mechanism; confirm API security permissions and existing company/site/device mappings. No secrets should be pasted into a planning document.

First implementation milestone: a disabled-by-default read provider, verified company/site mapping, the nine proposed read tools, fixtures and focused tests. Verify foreign-company UID rejection, conflicting mappings, revoked access, moved devices, pagination completeness, stale evidence, 401 refresh, 429 backoff and response redaction. Compare the tenant's public schema with this baseline, then perform scoped read-only connectivity checks.

Second milestone: allowlisted components and result/output retrieval, then alert resolution. Test duplicate requests, timeouts after dispatch, mixed component outcomes and secret-bearing output. Live execution and business-write acceptance remain separate from mocked checks. Existing release versioning applies when an implementation is deployed.

The immediate design priority is reliable ticket → asset → device correlation. It provides value to the technician workflow before introducing endpoint actions.
