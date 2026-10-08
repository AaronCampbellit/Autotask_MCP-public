# Deployment boundary and operating procedure

> Current-status note (2026-09-14): this document contains earlier design or test snapshots. For current implementation and deployment distinctions, start with [CURRENT-STATUS.md](CURRENT-STATUS.md). Historical test results remain evidence for their stated revision only.

The September 17 release record documents Docker deployment on the iMac, LAN HTTPS readiness, scoped tenant reads and a working Codex connection. See [current status](CURRENT-STATUS.md) and [verification](VERIFICATION.md). Full-product acceptance, user-controlled live business-write validation and remaining client/recovery checks are separate; the deployed pilot does not complete the original 231-entity plan. Setup and qualification steps below include broader release obligations, not claims that the pilot is undeployed.

The original [deployment plan](planning/autotask-mcp-plan/11-DEPLOYMENT-AND-OPERATIONS.md), [technician contract](planning/autotask-mcp-plan/17-TECHNICIAN-WORKFLOW-CONTRACT.md) and [implementation status](IMPLEMENTATION.md) remain the release requirements. This package makes the next deployment steps concrete; it does not enable them automatically.

## Packaged shape

[Dockerfile](../deploy/Dockerfile) uses separate build and production-dependency stages. It pins `node:24.21.0-bookworm-slim`, used by the recorded local builds and deployed release. The package accepts `>=24.16.0 <25`. Resolve, review and record immutable image digests before deployment, including the `postgres:17-bookworm` major-version candidate. These are not claims of latest versions.

The runtime runs as `node`, includes compiled application/packages/scripts, console assets, versioned playbooks, registry data, metadata mount instructions and all SQL migrations. It installs production dependencies through `npm ci --omit=dev`. Secrets, developer credentials, `work/` scratch output and the preserved planning corpus are excluded from the image build context. Tenant snapshots and evidence are supplied as a read-only mount, not embedded as shared production defaults.

[compose.yaml](../deploy/compose.yaml) provides PostgreSQL, a one-shot migration service and **one application instance with its in-process job worker**. It publishes port 3030 only on the host loopback address. A separately managed HTTPS reverse proxy, DNS and certificate renewal are deployment-owner responsibilities. The application filesystem is read-only; temporary files use `/tmp`. Durable encrypted artifacts mount only at `/app/work/artifacts`, preserving `/app/work/build`.

Do not scale this profile to multiple application replicas: admin sessions, queue admission and some runtime coordination remain process-local. PostgreSQL journals/jobs prevent important duplicate claims but do not establish complete multi-instance operation. Set `JOB_WORKER_ENABLED=false` when intentionally disabling the worker during maintenance or restore. That flag does not itself pause interactive writes; use the administrative write-pause control too.

## Configuration and offline checks

Use [runtime.env.example](../deploy/runtime.env.example) as the deployment variable inventory. Inject populated values through the approved secret-management process. A populated file belongs outside version control. Compose requires a PostgreSQL bootstrap password and separate runtime/migration connection URLs; its checks do not verify those credentials. The direct migration entry point prefers `MIGRATION_DATABASE_URL` and falls back to `DATABASE_URL`; Compose supplies the dedicated migration URL as its migrator's `DATABASE_URL`. Do not log unredacted `docker compose config` output because it expands secret values.

| Group | Variables and meaning |
| --- | --- |
| Canonical endpoint | `PUBLIC_URL` is the reviewed HTTPS origin. `PORT` defaults to 3030 inside the server. `MCP_HOST_PORT` changes only the loopback published port. |
| MCP identity | `ENTRA_TENANT_ID`, exact `ENTRA_AUDIENCE`, and `ENTRA_SCOPE` match the registered API and delegated scope. |
| Admin identity | `ADMIN_ENTRA_CLIENT_ID` and `ADMIN_ENTRA_CLIENT_SECRET` form an optional pair. Without them, interactive admin login is unavailable. Register the exact `/admin/callback` URL under `PUBLIC_URL`. |
| Bootstrap access | `ADMIN_BOOTSTRAP_IDENTITIES` contains comma-separated exact `tenant-guid:object-guid` identities. An empty list is valid once existing platform administrators are established; it must not create anonymous access. An admin still needs a separately verified employee/resource mapping to operate on business records. |
| Database | `DATABASE_URL` uses the restricted application role; `MIGRATION_DATABASE_URL` uses the schema migration role. Within this Compose profile the database hostname is `postgres`. Percent-encode credentials correctly in connection URLs. |
| Autotask | `AUTOTASK_BASE_URL`, `AUTOTASK_USERNAME`, `AUTOTASK_SECRET`, `AUTOTASK_INTEGRATION_CODE` identify the reviewed API integration and actual tenant zone. The example zone does not perform discovery. |
| Keys | `CURSOR_SECRET` contains at least 32 random bytes. `OPERATION_PAYLOAD_KEY` and `ARTIFACT_ENCRYPTION_KEY` are distinct, canonical base64 encodings of separate 32-byte random keys. Keep key recovery material separate from database/artifact backups. |
| Metadata | `METADATA_SNAPSHOT_PATH` is an absolute local JSON path. `ENABLED_AUTOTASK_OPERATIONS` is an explicit comma-separated reviewed operation list, empty by default. `AUTOTASK_TICKET_HOSTS` contains hostnames only and trusts no hosts by default. |
| Shared request budget | `AUTOTASK_REQUESTS_PER_WINDOW` (1–1,000,000), `AUTOTASK_BUDGET_WINDOW_MS` (1–86,400,000), `AUTOTASK_EXTERNAL_HEADROOM` (0–1,000,000), and `AUTOTASK_THRESHOLD_MAX_AGE_MS` (1–300,000, no greater than the window) are required together. Values must come from reviewed tenant capacity and other integrations' reserved usage; these bounds are implementation limits, not an Autotask allowance. |
| Threshold evidence and queue | `AUTOTASK_THRESHOLD_PATH` is an absolute local JSON manifest backed by a hash-verified, fresh ThresholdInformation capture. `AUTOTASK_BUDGET_MAX_WAIT_MS` optionally allows 0–60,000 ms of waiting (default 0); `AUTOTASK_BUDGET_QUEUE_SIZE` allows 0–1000 queued requests (default 100). All-empty budget settings leave every live request blocked; partial settings fail startup. |
| Worker | `JOB_WORKER_ENABLED` accepts `true` or `false`, defaulting to `true`; it runs inside the single server process. |

After installing the lockfile, run this from the project root with the intended environment loaded:

```text
node --import tsx scripts/preflight.ts --json
```

For a built image or compiled checkout:

```text
node work/build/scripts/preflight.js --json
```

The offline preflight checks runtime range, configuration names/shapes, HTTPS origins, tenant/admin GUIDs, key sizes and separation, local file paths, the packaged assets and migrations. If a snapshot is configured, it checks the current registry binding, digest, freshness and local evidence hashes. Explicit live operation enablement requires qualified evidence and a shared request budget. The threshold-file check reads and validates local evidence without consuming a request allowance. It prints only check names and fixed explanations, never supplied values or underlying exception messages. It makes no network requests, checks no credential validity, writes no database records and cannot certify tenant permission behavior.

The budget is shared across the base, technician and scheduling HTTP adapters within this one process. Each physical HTTP attempt—including retries, parent reads and verification—requires admission. Admission does not extend evidence freshness. Place the normalized threshold manifest and its source capture under the same read-only configuration mount, with `AUTOTASK_THRESHOLD_PATH=/app/config/metadata/threshold.json` and evidence references relative to `/app`. A separately reviewed collector must refresh truthful captures before they expire; this server does not invent a ThresholdInformation route or renew capture timestamps itself. Missing, stale, changed or malformed evidence closes admission. Refreshing tenant traffic and headroom behavior remains a deployment test.

Focused local tests also apply the role setup and the ordered migrations present in `packages/storage/migrations/` in PGlite, verifying that the runtime role can access data but cannot create tables, alter the journal schema or disable its triggers. That is SQL-engine evidence, not a real PostgreSQL service or container test. The healthcheck JavaScript syntax was checked locally. That paragraph describes earlier SQL-engine checks. The current iMac uses Docker and Compose; the release record in [CURRENT-STATUS.md](CURRENT-STATUS.md) records container, migration and readiness evidence separately.

The optional `--health` switch adds only unauthenticated, bounded GET requests to the configured origin's `/health/live` and `/health/ready` endpoints after offline checks pass. Redirects are rejected, and bodies and secrets are not returned. **Those deployed checks have not been run here.** A ready response confirms the configured process/database readiness check, not Autotask/client release qualification.

## Deployment order — requires the real environment

1. Assign the hosting, identity, backup, incident and release owners. Review the intended public origin, DNS/TLS/reverse-proxy behavior and secret-storage mechanism. Preserve `/mcp`, `/.well-known/oauth-protected-resource/mcp`, `/admin`, `/admin/callback`, and minimal health routes without exposing extra host ports. Verify forwarding preserves the canonical host and supported streaming transport; broad origin or host bypasses are not needed.
2. Register and assign the Entra API/client applications. Confirm tenant, audience, delegated scope, admin redirect, revocation and intended client support. Supply real employee/resource mappings and company/capability policy using the guarded admin/control-plane workflow. Fixture resource IDs and bootstrap identities are not production mappings.
3. Provision PostgreSQL and durable encrypted artifact storage. Establish database TLS when crossing hosts. Start only the database while configuring roles. Review [postgres-roles.sql](../deploy/postgres-roles.sql), run it as the database administrator, and set passwords through interactive `psql \password` or approved secret provisioning. The script has no embedded passwords and grants the runtime role data access rather than schema ownership. Verify pre-existing same-named roles and database CONNECT access before use.
4. Back up the database and separately protect both encryption keys. Apply every ordered SQL migration in `packages/storage/migrations/` through the dedicated migration role, including the current domain-intent, webhook-inbox and attachment-budget migrations. The compiled migration entry point discovers ordered SQL files and skips recorded versions. Run only one migrator; concurrent release migration has not been qualified. Compose waits for migration success before starting the application.
5. Supply a reviewed metadata snapshot and its evidence tree as described in [metadata/README.md](../deploy/metadata/README.md). Source references resolve relative to `/app`; mounted evidence under this directory therefore uses `config/metadata/...` references. Keep the operation list empty until actual tenant tests prove native permission enforcement, resource attribution, positive/negative scope, revocation and exact route behavior. Resource, eligibility, schema and operation evidence have bounded freshness; do not turn a static export into a perpetual authorization proof.
6. On a Docker-capable qualification host, run `docker compose -f deploy/compose.yaml config --quiet`, build the image, inspect/scan its exact dependencies and image digest, and test runtime assets, read-only filesystem and volume ownership. [verify.yml](../.github/workflows/verify.yml) defines CI type/tests/build and a container-candidate check; it publishes nothing. Check the actual workflow run and release evidence before claiming validation for a revision.
7. Bring up one application instance behind HTTPS, check readiness, authenticate approved test identities and perform controlled technician workflow and fault tests. Measure all 20 concurrent staff, upstream rate/Threshold behavior, fairness, actual native attribution and readbacks, console/session behavior and each supported MCP client's real transport/OAuth flow. Qualify only the operation/profile combinations demonstrated by evidence. Contact and checklist read routes exist; site context remains unavailable. A registry label cannot enable an unimplemented route.
8. Establish tested backup/restore, key rotation, expiration cleanup, alerting, audit-retention, incident ownership and release rollback procedures. Only then decide whether the first technician pilot can begin. The deployed attachment tools support ticket and opportunity uploads without a scanner, and ticket attachment copying. Staging alone does not publish an attachment; broader parent mutation support remains separate work.

This runbook is not a fresh execution record. Commands used in prior deployments and their results are recorded in [current status](CURRENT-STATUS.md).

## Recovery and rollback

Pause interactive writes and stop the worker before restoring or rolling back. Preserve journals, job checkpoints, encrypted artifacts, metadata versions and the keys needed to read unexpired original intent. A database restore can lose evidence of an upstream write, so reconcile the affected recovery window before dispatch resumes. An older image must understand the current schema and queued intent versions; do not downgrade the database blindly.

An accepted or unknown Autotask mutation is not rolled back by replacing the image or restoring PostgreSQL. Inspect recorded native IDs and use read-only reconciliation. Resume only a definitively failed or undispatched remainder with the original encrypted payload and fresh authorization. Never turn a missing acknowledgement into a new request key or fuzzy duplicate search. If the recorded native ID was lost, preserve uncertainty and route it to the operator.

Back up PostgreSQL and the encrypted artifact volume consistently enough for the chosen recovery objective, and test restoration with separately recovered keys. The planning retention/RPO/RTO values remain proposed operating decisions, not implemented SLAs. Do not claim that primary-record expiry proves deletion from backups. Logs and metrics must omit ticket text, credentials, customer names and unbounded identity labels.

## Current domain enablement

`BUSINESS_ENABLED`, `WORK_MANAGEMENT_ENABLED` and `ATTACHMENTS_ENABLED` register their tool packs. Their corresponding `_WRITES_ENABLED` flags also require the member capabilities in `TOOL-CATALOG.json`. Work management and attachments require the existing operational pack for ticket-parent checks. Checklist tools follow `OPERATIONAL_WRITES_ENABLED`. All example flags default to false; use the current status record for the actual pilot configuration.

Keep `AUTOTASK_WEBHOOK_BINDINGS` empty for the LAN-only pilot. Native attachment upload requires the exact current internal publish label and the existing upload and byte-budget controls. Invoice PDF export and attachment downloads do not send customer messages.

For private ChatGPT access without public ingress, use the [ChatGPT Secure MCP Tunnel runbook](CHATGPT-CONNECTION.md). A workstation VPN alone does not provide a cloud MCP route.

## MCP metadata release checklist

1. Update `SERVER_RELEASE` in `apps/server/src/publication.ts` for each server release. Regenerate the tool catalog when contracts change. Run type-check, build, contract/registration tests and the applicable suite.
2. Deploy with the existing HTTPS and collector overrides. Verify readiness and record the exact image.
3. Inspect deployed `initialize` / `server/discover`: the version must match the release, and the current stateless server must advertise `tools.listChanged: false`.
4. Verify `tools/list` schemas and annotations for the intended identity. Call `at_diagnostics` and record `server_release`, `metadata_sha256`, and `available_tools`. The fingerprint covers sorted tool names, descriptions, input/output schemas and annotations available to this caller. It can change with permissions or tool controls; compare using the same identity and configuration. It is not a credential or a client-cache invalidation command.
5. **Client delivery is a separate release gate.** For each developer-mode ChatGPT connection in use, select Refresh, confirm the updated tool definitions, and run a representative test in a new conversation. Direct and tunnel registrations need separate checks. A fresh `at_describe` or diagnostics response alone does not prove that the client's cached tool definitions changed.
6. If using a reviewed directory plugin, scan the server, submit a new version and publish the approved metadata snapshot instead. Do not assume the private pilot uses that distribution path.
7. Record client refresh/test evidence or explicitly mark it pending. Do not announce that all users received updated tools while this gate is unverified.

See [OpenAI metadata refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata), [MCP publishing audit](MCP-PUBLISHING-AUDIT.md), and [output contracts](OUTPUT-CONTRACTS.md). Turning on push notifications in the future requires an authenticated persistent subscription lifecycle and invalidation tests; changing a capability flag alone is insufficient.

## Supporting-tool timezone defaults

`WORKSPACE_TIMEZONE` optionally supplies an IANA timezone for workday/visit reads. `RESOURCE_TIMEZONES` optionally supplies a JSON object mapping resource IDs to IANA zones. Explicit tool inputs take precedence, then employee configuration, then workspace configuration; missing values require explicit input. Empty settings preserve existing behavior. See [supporting tools](SUPPORTING-TOOLS.md) for pagination, playbook versioning and the local-only validation boundary.

### Ticket navigation links

Set `AUTOTASK_TICKET_HOSTS` to the verified hostname shown while logged into your Autotask web application, without scheme or path. The first entry generates links; all entries are accepted when resolving ticket URLs. An empty value intentionally omits generated links. Do not infer the web hostname from the REST service hostname. After an authorized deployment, verify a returned ticket link opens the same ticket while signed in. The URL uses the [documented OpenTicketDetail command](https://ww2.autotask.net/help/developerhelp/content/apis/executecommand/UsingExecuteCommandAPI.htm) and the native ticket ID, not its displayed ticket number.
