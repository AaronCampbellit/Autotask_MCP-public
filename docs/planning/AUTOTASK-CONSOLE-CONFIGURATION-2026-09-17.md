# Autotask console configuration feasibility

Date: 2026-09-17. Status: originally implemented locally as `0.1.0-integrations.20260917.1`, subsequently deployed in the September 17 combined release. See [implementation and rollout notes](../AUTOTASK-CONSOLE-CONFIGURATION.md). The sections below preserve the original feasibility assessment.

## Conclusion

The existing Autotask integration can be adopted into encrypted, console-managed configuration without creating a new API user, re-entering current credentials, resetting employee/company mappings, or reconnecting MCP clients. This depends on retaining the same Autotask account, Entra configuration, public MCP URL, database and encryption keys. A controlled service reload may be needed; this is not a promise of zero downtime.

This assessment is based on source inspection, not inspection or validation of production secrets. Initial adoption must verify the actual deployed configuration before switching its source.

## Console coverage

| Area | Current source | Proposed console behavior |
| --- | --- | --- |
| API username, secret, integration code, regional base URL | Server environment | Adopt existing values server-side; show username/URL and configured status; replace secrets without revealing stored values |
| Connection health and zone | Startup clients | Read-only authenticated test, zone discovery, last validation, active revision and failure status |
| Feature packs, allowed operations and write enablement | Startup environment | Validated configuration with prerequisite checks and a clear pending-reload state where required |
| Company scope, employee mappings, capability templates, tool switches and write pause | Existing database/console | Retain existing records and controls |
| Request budget, headroom, collector interval and freshness | Environment and collector configuration | Advanced settings with validated bounds and shared budget accounting |
| Metadata and resource verification | Collector-generated evidence | Show status and request refresh; never allow editing evidence into a trusted state |
| Ticket URL hosts, workspace/resource timezones, attachment label and webhook bindings | Environment | Validated integration settings; protect any secret binding material |
| Database, encryption keys, Entra bootstrap and hosting/TLS | Deployment configuration | Remain deployment-managed; show safe status only |

Console controls can govern implemented operations and access allowed by the native API user. They do not grant new Autotask permissions or automatically implement every vendor API endpoint. Native API-user provisioning and security-level administration remain in Autotask.

## Evidence in this repository

- `apps/server/src/live-system.ts` constructs the directory, adapters, services, budget and feature packs once from environment settings. Several packs are absent entirely when disabled at startup.
- `packages/autotask/src/index.ts` and `packages/autotask/src/technician-transport.ts` capture credentials and URL in their constructors. Updating a database row alone would not update these clients.
- `scripts/collect-live.ts` separately reads credentials from environment and collector settings from `config/metadata/collector.json` once. The collector has no application database access under its current deployment design.
- `deploy/compose.yaml`, `deploy/collector.compose.yaml` and `scripts/preflight.ts` currently expect environment-based credentials and must support the managed source.
- `packages/control-plane/src/index.ts` already stores access controls independently of provider credentials and supports bootstrap administrators. Operational principal verification must remain enforced, but a connection-repair route must not require a healthy Autotask connection.
- `packages/rmm/src/store.ts` provides an encrypted configuration/versioning pattern. Reuse the pattern, not RMM credential-change behavior that resets provider mappings and approvals.

## Adoption and update design

1. Add a versioned, encrypted Autotask connection record using the existing encryption infrastructure. Keep the existing root keys. Restrict secret use to server-side provider clients; never return values to the browser, logs, audit payloads or MCP tools.
2. When no managed record exists, import the exact effective deployment settings server-side once. Make import idempotent and leave all existing member, company-scope, template, job, receipt and audit records intact. Do not overwrite a managed record on later restarts.
3. Validate the adopted configuration through budgeted, read-only requests before selecting it as active. Zone discovery alone is not an authentication test. Preserve current active settings on any failure.
4. For subsequent edits, save a draft, validate URL/zone, authentication, account continuity and required permissions, then activate a revision atomically. Do not treat same-zone membership as proof of the same customer account. Establish reliable account-binding evidence before permitting replacement credentials to retain existing native IDs; otherwise block that change for review.
5. Make all server clients and the collector consume the selected revision. Initially, a coordinated reload is acceptable and must be shown clearly in the console. Dynamic activation requires rebuilding clients, invalidating appropriate caches and synchronizing the collector. Do not publish a successful activation while one process still uses old credentials.
6. Preserve the collector's restricted access. Design a narrow authenticated configuration broker or encrypted handoff rather than giving it unrestricted application database access or the application encryption root key. The delivery mechanism is an implementation decision still to resolve.
7. Drain affected in-flight work before switching revisions. Preserve historical records and prevent uncertain writes from being replayed. Bind new work and provider-dependent caches/cursors to the correct connection revision as needed. Importing identical settings should not reset identities or existing authorization.
8. Keep explicit source selection and rollback to the previous encrypted revision. Environment bootstrap remains available during migration; do not silently switch to environment credentials after a managed connection fails. Retire duplicate deployment secrets only after both processes are verified on the managed source.
9. Provide a tightly authorized repair path through existing Entra/bootstrap administration that works during provider outages or credential expiry. Do not bypass ordinary tool authorization or company scope checks.

## Acceptance checks before deployment review

- Repeated adoption preserves the same effective credentials/settings without displaying secrets or duplicating records.
- Existing users, company scopes, templates, tool switches, jobs and audit history remain intact.
- Existing MCP clients use the same endpoint and identity configuration without a new connection setup.
- Server and collector use the same active configuration revision; collector budget accounting survives reloads.
- Invalid drafts, failed tests and interrupted activation leave the prior connection usable.
- Authentication is checked using an authenticated read; probes do not perform native writes.
- A different customer account cannot inherit existing native-ID mappings accidentally.
- Credential repair remains accessible to authorized recovery administrators during Autotask failure.
- Secrets are encrypted at rest and absent from console responses, MCP output, logs and audit details.
- Required reloads and rollback status are visible and accurately reported.

## Vendor reference

Autotask explicitly states that ZoneInformation requires no authentication and must not be used to validate credentials: [REST API best practices](https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/General_Topics/REST_BestPractices.htm).

## Recommended implementation boundary

Build an Autotask connection/settings section beside Datto RMM, beginning with non-destructive adoption, masked credential management, health testing and coordinated activation. Expand advanced settings behind validated controls. Keep deployment bootstrap configuration outside this feature. Build and test locally, then deploy only after review.
