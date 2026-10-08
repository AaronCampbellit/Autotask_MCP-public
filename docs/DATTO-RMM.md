# Datto RMM

Deployed in `0.1.0-mcp-expanded.20260917.3` on September 17, 2026. The current implementation includes 55 RMM tools; see [expanded coverage and permissions](RMM-EXPANDED.md) and [release evidence](CURRENT-STATUS.md). Account connectivity/read access has been checked; full tenant and live native write acceptance are not implied.

## Scope

The console manages the connection, client mappings and component approvals. Device operations run through the MCP. Existing Autotask company scopes are reused; capabilities are `rmm.read`, `rmm.execute` and `rmm.write` (plus `platform.manage` for designated administrative tools). No existing employee receives these capabilities automatically.

The original 18 tools below remain available alongside the 37 additions documented in [expanded coverage](RMM-EXPANDED.md):

| Area | Tools |
| --- | --- |
| Sites and devices | `rmm_site_list`, `rmm_device_search`, `rmm_device_get`, `rmm_site_network_list`, `rmm_site_filter_list` |
| Audit and inventory | `rmm_device_audit_get`, `rmm_device_software_list` |
| Patches | `rmm_device_patch_list`, `rmm_site_patch_list` |
| Alerts | `rmm_device_alert_list`, `rmm_site_alert_list`, `rmm_alert_get` |
| Components | `rmm_component_list`, `rmm_quickjob_run` |
| Recorded jobs | `rmm_job_list`, `rmm_job_get`, `rmm_job_result_get`, `rmm_job_output_get` |

Site patches are aggregated by patch across devices. Hostname search filters one returned site-device page locally; follow cursors for complete coverage. Native pagination URLs are never followed: continuation state is encrypted, expires after 15 minutes, and binds the caller, policy, company scope, configuration version, tool and filters. Reads of job results/output require an actor-owned local receipt; external jobs use the separate administrator-only tools documented in expanded coverage.

## Console setup

1. Open **Datto RMM connection** as a console administrator. Zinfandel is preselected. Its API base is `https://zinfandel-api.centrastage.net`; do not enter the dashboard URL as an API endpoint.
2. Enter both the API key and secret. Save with RMM disabled. Both values are write-only in the console and encrypted at rest with the configured operation-payload encryption key. Neither is published to MCP tools or returned by settings reads.
3. Test the saved connection. The account identity must be returned before enablement. This checks authentication/account access, not every device or component permission.
4. Load the site catalog and enable the desired native Autotask mappings. A site must expose an Autotask company ID in the administrator's current company scope. Unmapped sites are inaccessible. Every device operation checks its actual current site and the site's current native company association.
5. Load all available components, review them and approve the selected components. Supply a fixed value for each component variable. The MCP cannot override those values. Variables are encrypted and not returned in settings reads. Components marked as requiring credentials cannot be approved in this release.
6. Enable RMM tools; grant appropriate employees **Read mapped devices, alerts, inventory and jobs**. Grant **Run approved components** and enable component execution only when needed. Existing per-tool switches and the global write pause also apply.

Replacing credentials or changing platforms clears connection verification, mappings and approvals. Remove connection clears those settings and credentials but retains historical job receipts. Settings saves use version checks; stale forms must be reloaded. Configuration history records the administrator, action and time without secret values.

The component catalog loads pages until complete, capped at 100 pages (10,000 records). Incomplete loading is explicitly labelled. No catalog component is approved automatically. Approval binds the metadata exposed by the API, including its variable definitions; the API does not expose script contents, so an unchanged metadata fingerprint cannot prove unchanged code. Review script changes in Datto and revoke/reapprove accordingly.

## Device search

`rmm_device_search` accepts an optional `site_uid`; omit it to scan enabled sites within the employee's current Autotask company scope. It reads one site page per call, with `page_size` from 1–100 (default 50). Follow `completeness.next_cursor` with the same filters until null, even when a page returns no matches. A cursor binds the employee, company scope, connection version, filters and site/page position, and expires after 15 minutes. A site exceeding 1,000 pages fails explicitly instead of reporting complete coverage.

Examples:

```json
{"last_logged_in_user":"jane.doe"}
{"query":"jane", "operating_system":"Windows", "online":true}
{"internal_ip_address":"10.0.0.42"}
{"site_uid":"client-site-uid", "last_seen_before":"2026-09-01T00:00:00Z"}
```

Named filters combine with AND. `query` is a case-insensitive substring across any exposed device field; text filters also use case-insensitive substrings. IDs, IP addresses, URLs, numbers and booleans match exactly. Missing values do not match, including `false` and zero filters. Date fields accept exact ISO 8601 timestamps with timezone, plus inclusive `_after` and `_before` bounds. Last logged-in user is the account reported by Datto, not proof of the current user; names and email addresses match only if present in the reported value.

Available filters:

- Identity/site: `id`, `device_uid`, `site_id`, `site_name`, `hostname`, `description`, `device_class`, `device_category`, `device_type`.
- Network/user: `internal_ip_address`, `external_ip_address`, `domain`, `last_logged_in_user`.
- OS/agent: `operating_system`, `a64_bit`, `cag_version`, `display_version`.
- Status: `online`, `suspended`, `deleted`, `reboot_required`, `software_status`.
- Dates (each also has `_after`/`_before`): `last_seen`, `last_reboot`, `last_audit_date`, `creation_date`, `warranty_date`.
- Security/patches: `antivirus_product`, `antivirus_status`, `patch_status`, `patches_approved_pending`, `patches_not_approved`, `patches_installed`.
- Other: `snmp_enabled`, `network_probe`, `onboarded_via_network_monitor`, `portal_url`, `web_remote_url`.

Only fields returned by Datto's device listing can match; separate audit/software inventories are not searched. Search uses the existing reviewed response projection and secret redaction, and continues to verify native company/site ownership before and after each page.

## Execution and outcomes

`rmm_quickjob_run` targets one device and an approved component. The caller supplies a stable request key and job name. An encrypted durable receipt is reserved before dispatch. Authorization, connection version, component approval and actual device/site ownership are checked before the write; a moved device is rejected. A repeated request key returns its receipt instead of dispatching again. A different payload with the same key is rejected.

Acceptance returns a local `operation_id` and native `job_uid`; it is not execution success. Use the job-result tool to inspect per-device/component results, then request stdout/stderr if needed. Network ambiguity records `unknown_outcome` and never causes automatic replay. A crash while marked dispatching retains that state; it is not safe to issue a new key. There is no native job cancellation endpoint in this release.

`rmm_job_list` returns at most the latest 100 receipts for the current employee and current account/scope. Individual receipts are accessible by their IDs beyond that list window. Job output is treated as untrusted data, projected using the pinned API schema, size-bounded and redacted (512 KB maximum returned envelope; long strings explicitly mark truncation). Pattern-based redaction cannot guarantee detection of arbitrary secrets printed by components; approve components with appropriate output behavior.

## Implementation and limits

- Provider client: fixed platform hosts, HTTPS, no redirects, form-based OAuth token exchange, in-memory token caching. Read 401s invalidate the token; a subsequent request obtains another token. There is no automatic write replay.
- Local provider budget: 120 requests and 20 writes per minute per server instance, below documented shared vendor limits. 429 pauses requests; 403 triggers a conservative five-minute pause. This is designed for the existing single-server deployment, not a distributed account-wide quota allocator. Other integrations also consume Datto's account quota.
- Storage: additive migration `014_rmm`, containing encrypted connection and job payloads plus configuration audit metadata. Existing runtime database role default grants apply. Migrations 014 and 016 are recorded as applied in current status.
- Discovery: RMM tools remain hidden when unconfigured/disabled and respect employee capabilities, tool switches and write pause. Console configuration remains accessible to administrators before connection setup.
- Audit snapshots are observations, not real-time guarantees. Unsupported device classes fail explicitly. Missing pagination information fails instead of claiming completeness.
- The expanded release adds the previously deferred supported actions and composite workflows; see [expanded coverage](RMM-EXPANDED.md). API-key reset is excluded by request, and deprecated mute/unmute routes remain excluded. No arbitrary shell, component upload, patch installation or interactive remote desktop API is invented.

## Evidence

The public Zinfandel `Datto-RMM-v2` paths and component schemas were compared on September 17, 2026 and match the pinned public Vidal specification. The captured 59-operation inventory is broader than this first delivery.

Focused tests cover credentials and configuration versioning, encrypted PostgreSQL persistence, native site/company checks, changed/revoked capabilities, changed component metadata, fixed inputs, cursor binding, projection/redaction, duplicate dispatch suppression, uncertain outcomes, account replacement, console CSRF/admin checks, write pause, and all first-release read routes. A fixture browser review verified the configuration screen and component import/approval layout. These tests alone do not establish tenant behavior. The later deployed account-read check is recorded in current status.

See [the baseline](planning/DATTO-RMM-BASELINE-2026-09-17.md) and [the current tool catalog](TOOL-CATALOG.json).


## Console setup sequence

1. Save the API credentials. Leave replacement fields blank when retaining an existing connection.
2. Test the saved connection. This verifies account access without enabling tools or running a component.
3. Enable RMM tools and optionally approved component execution, then choose **Save tool settings**. Component execution requires RMM enabled; per-user permissions, verified site mappings and individual component approvals still apply.

Replacing credentials or changing platform disables tools and clears tested account identity, site mappings and approvals. The page explains these consequences before saving. **Settings change log** is a read-only administration audit showing who changed configuration and when; it does not restore settings or display device job output.
