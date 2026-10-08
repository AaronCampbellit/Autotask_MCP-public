# Autotask connection configuration

Deployment update: included in `0.1.0-attachments-access.20260917.1` on September 17, 2026. See [current release verification](CURRENT-STATUS.md). Earlier candidate/test statements below describe development checkpoints; live business and client-specific checks remain as noted.

The original local candidate was `0.1.0-integrations.20260917.1`; deployment superseded that checkpoint.

The console now includes **Autotask connection** alongside Datto RMM. It manages the integration configuration; operational actions continue through the MCP.

## Existing connection adoption

Choose **Adopt existing connection** once. The server copies its effective API username, secret, integration code, URL, feature settings, webhook bindings and collector configuration into an encrypted database record. No credentials are displayed or re-entered. The existing employee mappings, company scopes, templates, tool switches, job records, operation receipts and audit history are not modified.

Adoption is idempotent through an optimistic version check. Once a managed record exists, it is authoritative on startup; environment credentials cannot overwrite it or silently replace a failed managed connection. The public MCP URL, Entra registrations and database/encryption keys remain the same, so this migration does not require setting up client connections again.

## Editing and activation

1. Edit and save a draft. Blank credential fields retain the current draft value, or the active value when there is no draft. Existing secrets and webhook bindings never appear in console responses.
2. Choose **Test saved draft**. The collector performs authenticated threshold and resource reads with the draft credentials. Tests use its persisted request allowance and do not write metadata evidence or native business records. Refresh the console to see the result.
3. Activate a successful test within five minutes. The service stops admitting requests, drains current requests and the job worker, publishes the selected revision to the collector, and waits up to 45 seconds for refreshed evidence before building the replacement runtime.
4. Requests resume with the new configuration and its verified collector revision. A reload clears interactive console sessions; sign in again if prompted. Existing client connection registration does not change.

Tests verify authentication, resource access and threshold compatibility; they do not certify every native operation or grant additional Autotask permissions. Runtime metadata qualification and per-operation authorization remain required.

A failed runtime construction or collector acknowledgement restores the previous configuration and retains the failed edit as a draft. Dispatch is blocked until the collector verifies the restored revision. **Stage previous settings for rollback** creates a draft of the previous revision, which must also be tested before activation; revoked credentials are not assumed to remain usable.

A controlled reload carries charged server requests into the replacement budget. Collector attempts remain persisted in the existing accounting file. Configuration edits cannot reset either allowance.

## Supported settings

- API secret and integration code replacement.
- Feature pack and write enablement switches.
- Explicit qualified operations and application-scoped reads.
- Trusted ticket URL hosts, timezones and attachment publication label.
- Request allowance, external headroom, queue size, maximum wait and threshold freshness.
- Collector allowance, headroom and interval, within validated bounds.
- Replacement or removal of webhook bindings; existing binding secrets remain masked.
- Collector metadata/evidence refresh and configuration audit history.

The API username, regional URL, native rate-limit window, resource evidence identity and policy bindings remain fixed during credential rotation. Switching accounts or zones requires a separate reviewed migration because existing native IDs must not acquire a different meaning. Database credentials, encryption root keys, Entra settings, metadata mount paths and hosting remain deployment-managed.

## Collector handoff and deployment review

Migration `015_autotask_connections.sql` creates the encrypted connection and redacted audit tables. Migration 015 was applied in the September 17 combined deployment; new installations must apply the full migration set.

The prepared Compose configuration adds a dedicated `autotask-config` volume at `/app/work/autotask-config`. The server mounts it read/write; the collector mounts it read-only. The server generates a separate 32-byte collector key and writes encrypted manifests atomically, with restrictive file permissions. The collector receives neither application database access nor the workflow encryption root key.

**Treat the entire handoff volume as secret material**: its decryption key and ciphertext are colocated, so volume access conveys access to the provider credentials. The separate key isolates the collector from application workflow and artifact data; it does not protect credentials from someone who can read the whole volume. Include it in the deployment's existing secret-volume access and backup controls.

The collector writes encrypted test results and revision acknowledgements into its existing metadata mount. There are no additional network listeners or public credential endpoints. The metadata mount must continue to be writable only by trusted service/operator identities.

Before adoption, an empty handoff volume permits the existing environment configuration. Once initialized, unreadable or missing managed files fail closed rather than reverting to old environment credentials. Keep original deployment secrets available during reviewed rollout; remove duplicate values only after both processes are verified on the managed source. Compose permits these values to be empty after adoption, and offline preflight can inspect the published managed configuration without printing credentials.

Run exactly one server and one collector. Activation requires the managed collector mount and an existing valid collector configuration. New collector provisioning remains a deployment task.

## Recovery

If normal runtime construction fails because metadata is unavailable or expired, the main process attempts a configuration recovery runtime. Readiness remains unavailable and native operations retain their normal evidence requirements. Existing bootstrap administrators and active local `platform.manage` administrators can access the connection settings using Entra sign-in without requiring fresh native employee evidence. This exception authorizes only integration configuration, not ordinary MCP work or unrelated administration.

The process retries normal construction after collector evidence becomes available. Failed recovery retries are throttled. Database, Entra or encryption-key failures still require deployment-level repair.

## Validation

Automated coverage includes encrypted SQL persistence and optimistic conflicts, exact adoption, startup without old environment credentials, secret-safe responses/audit, account/zone restrictions, test expiry and binding, failed activation rollback, administration revocation, outage recovery access, persisted probe accounting, budget carryover, CSRF/session enforcement and parallel console asset loading. The console adoption and draft-edit flow was also checked in a disposable local fixture browser.

Deployment and readiness are recorded in current status. Live credential rotation remains a separate acceptance check; local implementation tests did not change real API credentials.


## Budget adoption correction

Release `0.1.0-adoption-budget.20260917.1` separates editable numeric budget validation from deployment-owned threshold-path validation. The path stays outside managed settings and is still required at runtime. Server and collector headroom are independent admission thresholds, so the deployed 10,000/hour server allowance with zero server headroom can be adopted without altering collector settings. Shared observations and each process's existing request checks continue to apply.
