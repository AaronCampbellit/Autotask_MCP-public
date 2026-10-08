# Admin and operator experience

The console is part of the MCP product. It gives humans a trusted place to configure access, inspect execution and understand failures. It is not a replacement Autotask UI. Its backend uses the same application services and policy rules as MCP tools.

**Initial console boundary**

The first technician release requires six focused functions: connection setup, employee-to-Autotask mapping, permission templates, tool switches, activity history and failed-job recovery. Permission details can sit within Members; activity and recovery can share one screen. Do not require ten separate navigation areas before releasing useful technician workflows.

Tool switches enable or disable qualified operations and cannot grant access beyond assigned permissions. Changes affect named and generic invocation identically, are audited, and are rechecked before queued dispatch. Activity shows requester, native attribution, outcome and readback; recovery distinguishes definitive failures from unknown outcomes. Include accessible write pause/revocation controls and essential health/status information within these screens.

The detailed entity browser, advanced report builder/dashboards and extensive synchronization screens are later deliverables. Keep their underlying registry, authorization, completeness and operational evidence requirements; a deferred UI is not permission to enable unqualified operations. Initial capability evidence may be a generated operator report, and direct API reads do not depend on a webhook UI. Any enabled sync/index feature still needs validation and an operable recovery runbook before use.

**Full-product navigation (phased)**

| Area | Main jobs | Access |
| --- | --- | --- |
| Overview | Health, recent changes, usage, blocked jobs, expiring configuration | Operator summary; business details scoped |
| Connection | Autotask zone/credential status, Entra settings, public URLs and client tests | Connection administrator |
| Members | Entra identities, Autotask mappings, roles, scope, deactivate/revoke | Access administrator |
| Policies | Capabilities, financial visibility, action permissions, test a proposed decision | Policy administrator |
| Capabilities | Entity/operation coverage, metadata, fields, rules, known gaps, enabled versions | Authorized readers; enablement restricted |
| Jobs | Progress, item outcomes, cancellation, resume/reconcile | Owner or permitted operator |
| Audit | Who requested/executed, native attribution, result and verification | Audit capability plus business scope |
| Sync | Owned webhooks, lag, gaps, errors, reconciliation and index state | Integration administrator |
| Files | Recent artifacts, scope, expiry and downloads | Owner/scope-checked |
| Releases | Build/registry/schema versions, migration health, maintenance and diagnostics | Operator |

**First-time setup flow**

1. Operator opens the configured console URL and signs in through Rarity's Entra tenant. Bootstrap ownership comes from deployment configuration and an allowlisted identity/group, not the first arbitrary person to visit.
2. Configure canonical MCP/portal URLs and tenant binding. Validate HTTPS and host consistency. Display whether the endpoint is reachable from the supported hosted clients.
3. Enter/reference Autotask credentials through an authenticated secret field. Show validity, zone and capabilities without redisplaying the secret. Do not put secrets in chat or an exported support bundle.
4. Discover metadata and show a concise connection/capability status with discrepancies; retain the detailed report for operators. The full entity browser comes later. No write capability becomes enabled merely because metadata exists.
5. Map a small pilot group to Autotask resources. Show ambiguous names/emails and require an operator selection.
6. Apply technician/admin/finance policy templates. Preview effective access for example records before publication.
7. Connect each AI client and run read probes. Publish the tested configuration and server/tool versions.
8. Enable qualified writes for the assigned role capabilities. Use designated validation records only, under the chosen test strategy.

Each step has saved, validation-failed and incomplete states. A failed connection test must say which boundary failed—DNS/TLS, OAuth discovery, identity, mapping, Autotask auth, permission or metadata—without dumping sensitive responses.

**Member management**

Show Entra object ID and Autotask resource ID alongside names. Operators can propose/change a mapping, view effective capabilities, test record access, deactivate a user and revoke application sessions/jobs. Role changes show a diff of gained/lost permissions. An operator cannot grant themselves a business permission they lack authority to administer. Keep a recovery procedure for accidentally removing all platform administrators.

Scope selection supports companies and, where implementable, project/team/queue restrictions. Display the effective union/intersection clearly. A queue scope alone must not be presented as a company data-isolation guarantee. Mapping and permission changes are audited and invalidate affected cached decisions; queued work rechecks permissions before dispatch.

**Operation detail**

Show requester, action, exact records, native identifiers/links, sanitized before/after values, financial/destructive effects, counts, policy version and verification outcome. Operations are allowed or denied by permissions; there is no approval inbox, approve/reject action or pending-confirmation state.

For a large batch, show progress and make every target inspectable/downloadable under the caller's scope. Membership and per-item payloads are fixed at submission. A user may request an optional dry run, but execution does not require it. New execution requests are authorized independently.

**Capability browser**

Later console phase; not a dependency of the first technician release. Initial enablement still requires the same registry and test evidence, available through generated reports or operator commands.

For each entity show documentary support, route review, schema/conditional rules, impersonation mode, mapping validity and separate evidence for attribution versus employee permission enforcement, field classification, tenant test evidence, tool exposure and current policy gate. Provide a safe explanation of why an operation is unavailable. Metadata refresh and schema drift show a diff; enabling a new write requires a reviewed release/capability action.

Offer searchable names and aliases for Autotask terminology. Show where a function is UI-only or partially supported instead of hiding the gap. Never allow the browser's “try request” feature to become a raw HTTP bypass.

**Job and incident experience**

An operator should answer: what was intended, which items completed, whether a call is uncertain, what is waiting, who can resume it, and whether any data is partial. Provide safe retry only for definitive failures; uncertain writes get reconcile/manual-review controls. A repair action is itself an authorized audited operation.

Support global write pause, domain/operation pause, principal suspension, export cancellation and webhook quarantine. Pausing writes need not stop safe reads. The UI must state whether a currently in-flight request can still finish.

**Accessibility and usability acceptance**

Keyboard-complete navigation, labeled forms, focus handling after dialogs, non-color-only status indicators, readable diff formatting, screen-reader status announcements and useful empty/error states. Use familiar business labels and native record links. Keep implementation details in diagnostics, not routine action results. Preserve unsaved form state only where it cannot expose secrets.

**Operator API and CLI**

Provide documented health, migration status, capability report, metadata-diff export and sanitized support-bundle commands. Destructive repair/policy commands require the same permissions and validation rules as the console. CLI machine credentials, if supported, are separate from employee login and cannot masquerade as a technician. No unauthenticated maintenance backdoor.
