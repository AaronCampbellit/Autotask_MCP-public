# Expanded Datto RMM implementation

Deployed in `0.1.0-mcp-expanded.20260917.3` on September 17, 2026, with migration `016_rmm_extended` applied. See [current status](CURRENT-STATUS.md) for build, rollout and read-only connectivity evidence. Live native write acceptance remains separate.

## Coverage

The MCP now registers 55 RMM tools (18 original and 37 additional). API-key reset is explicitly excluded from the tool catalog and blocked in the provider transport. Deprecated alert mute/unmute remain excluded. The pinned API has 59 operations; tools and native operations are not one-to-one.

| Area | Additional tools |
| --- | --- |
| Device lookups | `rmm_device_lookup`, `rmm_device_audit_by_mac` |
| Native filters and account search | `rmm_filter_list`, `rmm_account_device_search`, `rmm_account_alert_list` |
| Site details and settings | `rmm_site_get`, `rmm_site_settings_get` |
| Account administration | `rmm_account_get`, `rmm_account_user_list`, `rmm_network_mapping_list` |
| Provider diagnostics/activity | `rmm_system_get`, `rmm_activity_list` |
| Variables | `rmm_variable_list`, `rmm_variable_create`, `rmm_variable_update`, `rmm_variable_delete` |
| Native external jobs | `rmm_external_job_get`, `rmm_job_component_list`, `rmm_external_job_result_get`, `rmm_external_job_output_get` |
| Alert/device changes | `rmm_alert_resolve`, `rmm_device_warranty_set`, `rmm_device_udf_set`, `rmm_device_move` |
| Site administration | `rmm_site_create`, `rmm_site_update`, `rmm_site_proxy_set`, `rmm_site_proxy_delete` |
| Receipt retrieval | `rmm_operation_get` |
| Fleet software | `rmm_fleet_software_search` |
| Historical observations | `rmm_device_snapshot_save`, `rmm_device_snapshot_list`, `rmm_device_snapshot_compare` |
| Ticket/device workflow | `rmm_ticket_device_link`, `rmm_ticket_context`, `rmm_ticket_diagnostic_run`, `rmm_ticket_diagnostic_attach` |

The existing `rmm_device_search` also supports all reviewed summary fields, free-text `query`, date bounds and optional cross-site scanning. The console supports multiple/all eligible client mappings and component approvals. Existing individual revocation controls remain available.

## Permissions and activation

- Every RMM tool requires the tested, enabled connection and `rmm.read`.
- New native mutations require the separately granted `rmm.write`. Existing `rmm.execute` grants continue to authorize only approved component execution.
- Account users/details/network mappings, system/activity data, variables/proxy settings, site creation/update and external-job tools additionally require `platform.manage`. Account-wide administrator tools are explicitly labeled and can include account-wide data.
- Device and alert results from account searches are intersected with enabled, authorized native company/site mappings. Saved native filters never expand authorization. Account alert pages are capped at 20 (default 10) to leave room for device ownership checks.
- Ticket workflows require existing Autotask ticket/configuration read access; attaching a note also requires ticket write access. Component execution retains the execution switch and approved fixed input values. All writes respect current per-tool switches and the global write pause.
- A new native site is not automatically granted client access. Its native Autotask company association and console mapping must be established separately.

No existing employee is automatically granted `rmm.write` by the migration. No account key-reset operation is exposed.

## Writes and receipts

Each native mutation requires a stable `request_key`. An encrypted durable reservation binds actor, account, operation and exact arguments. Concurrent/repeated calls return the same receipt and never replay a dispatched write. Changes to arguments conflict. Current access is rechecked before dispatch. A timeout or failed post-dispatch verification is recorded as `unknown_outcome`; inspect the native state before any separate corrective action.

`rmm_operation_get` retrieves an employee's extended operation receipt with current permission and scope checks. `succeeded` is used when readback verifies alert closure, the device move or warranty date. Other native settings writes report `accepted` on an acknowledged response; this is not independent readback verification. Component jobs continue to use the original job receipts and result tools.

Variable values and proxy credentials are never echoed. Their values are not retained in response receipts. Variable lists return IDs, names and masking status with redacted values. Native job component variables remain excluded. Approved component inputs and stored snapshots/operation records are encrypted at rest.

## Ticket → asset → device → diagnostic note

1. `rmm_ticket_context` reads the ticket and its current, verified Autotask asset. It uses the asset's native `rmmDeviceUID` or `rmmDeviceID`, then verifies the RMM device and company/site. A conflicting administrator link fails explicitly.
2. When the native association is absent, an administrator can use `rmm_ticket_device_link` to save an explicit company-matched asset/device link. The mapping is local; it does not write back to Autotask or replace its native integration.
3. `rmm_ticket_diagnostic_run` executes a console-approved component on that verified device. It returns an outer diagnostic `operation_id` and an inner `job_operation_id`. The ticket/asset/device association is rechecked before dispatch.
4. Use the inner job receipt with the original job tools to check progress. Once the native job is completed, `rmm_ticket_diagnostic_attach` takes the outer diagnostic `operation_id` and saves the reviewed result envelope plus bounded, redacted stdout/stderr as an **internal ticket note**. It rechecks the current association and never reruns the component. A failed component's output is still evidence; completion does not prove repair.

Missing/inactive/ambiguous assets and missing device links fail explicitly. Context includes one page of open alerts with its own nested continuation; remaining alerts can be fetched with the original alert tool. This workflow does not send a customer email, upload an attachment file or create a background polling schedule.

## Pagination and historical limits

- Native account/device/alert and saved-filter queries disclose pagination even when scope filtering yields an empty page. Follow every cursor before claiming complete coverage.
- Activity-log continuation extracts only reviewed paging parameters and signs them into an actor/filter-bound cursor. It never follows a caller or provider URL.
- MAC audit lookup first resolves accessible device identities, then uses their authorized class-specific audit routes; the unscoped native audit-by-MAC response is not returned directly.
- Fleet software search matches audited software `name` and optional `version`, scanning one software page on one device per call. It has no publisher filter because the native software response does not supply publisher.
- Snapshots are explicit local saves, not an automatic collector. They include current summary, hardware audit and a complete software scan bounded at 100 pages and 400 KB. Exceeding a bound fails instead of saving a supposedly complete inventory. Provider throttling can stop a scan without saving it.
- Snapshot history is employee-owned. Lists search the latest 100 snapshots for the employee; comparison accepts two known IDs for the same currently authorized device and reports up to 100 changed fields. Truncation is marked incomplete. Stored observations do not prove when a change occurred between samples.

## Unsupported API capabilities

The reviewed schema does not establish arbitrary-shell execution, component upload, patch installation/approval, interactive remote-desktop control or device deletion. These have not been invented as API operations. Existing approved components can perform their specifically reviewed actions.

## Validation and rollout

Tests cover route verbs and payloads, scoped reads, typed inputs, pagination/filter binding, native ID associations, changed associations before dispatch, new write permissions, write pause, duplicate/concurrent requests, unknown dispatch, encryption, secret redaction, snapshots, diagnostic-note linking and MCP discovery size. The deployed release has recorded account-read/connectivity evidence, not comprehensive tenant qualification or native write acceptance.

New installations require the full migration set, including `016_rmm_extended`. Future releases require a new image/version, backup, readiness and MCP initialization/discovery/diagnostic verification. Client metadata refresh remains a separate check; see the current release record.

## Plan completion follow-up (source candidate)

Warranty updates now require `expected_warranty_date`, copied exactly from the current device read (use `null` when absent). Site updates require `expected` values for every supplied field. Both recheck current values after queue admission and immediately before dispatch, reject stale input without sending a write, and use native readback to distinguish verified results from accepted responses. These checks are optimistic and are not native atomic compare-and-swap.

The pinned API exposes no UDF readback route or UDF values in the device response, so UDF edits retain accepted/unverified receipts. Deprecated alert mute/unmute and API credential reset remain excluded under the newer API coverage baseline. Existing job receipts and result/output reads supply bounded, caller-driven status tracking; they do not cancel native execution.

Validation: focused RMM fixture tests cover stale warranty/site values, a warranty change during queue admission, required expected fields, single-dispatch replay, and accepted versus verified outcomes. No live provider mutation or deployment was performed for this follow-up. Account qualification and user-selected live action tests remain operational handoff steps.
