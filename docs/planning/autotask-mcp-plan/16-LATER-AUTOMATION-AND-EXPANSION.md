# Later automation and expansion

Aaron selected interactive use first. This document accounts for deferred surfaces so they do not become unplanned additions to the first release.

**Unattended recurring automation**

Later release prerequisites: the interactive policy/journal system is proven; operator recovery is in place; specific automation use cases and owners are approved. Use a separately scoped workload identity with explicit ownership, expiry/review, capability set, record scope, rate budget and schedule. Do not reuse a departed technician's OAuth session or silently impersonate whichever employee last edited a schedule.

An automation definition contains a versioned operation/report, fixed or bounded selector, schedule/timezone, permissible fields and maximum effects, execution budget, expiry, owner and required capabilities. Scope or payload changes create a new definition version and require fresh authorization. A blanket “run whatever the AI decides” grant is outside this design.

Read-only scheduled reports may run under explicit export/retention rules. Future mutations use the same allow/deny capability model: execute within the workload identity's assigned permissions and bounded definition, otherwise deny. There is no per-run or standing approval subsystem. Defining and enabling unattended use cases remains later work; this plan does not authorize running them now.

Validate missed schedules, overlap, DST, owner disablement, credential expiry, duplicate dispatch, changed matching records and rate-limited backlog. Operators can pause one schedule, all schedules or all writes. Every run preserves the automation identity, owner, definition version, effective permission set and actual Autotask attribution.

Future work packages: AUTO-01 identity/ownership; AUTO-02 schedule definitions and permission scope; AUTO-03 scheduler/worker/recovery; AUTO-04 operator UI/audit; AUTO-05 tenant qualification. These depend on WP-07,08,12,13,15,28,29 and do not block the initial interactive release.

**REST gaps and other Autotask surfaces**

The supplied REST documentation is the primary coverage baseline. If a required workflow is not exposed through REST, record its business requirement and investigate whether another official supported Autotask API provides it. A SOAP adapter, if justified by an identified gap, needs its own authentication, permission, schema, rate-budget and validation review. Do not assume a REST omission means no official interface exists, and do not quietly add browser automation as an API substitute.

Unsupported native UI operations remain explicit handoffs until a supported interface is proven. Third-party RMM, documentation systems, chat delivery, accounting exports and customer portals are not automatically part of our Autotask MCP because Thread integrates with them. Add those only for an approved use case with separate identities, policy and data-handling boundaries.

**Possible expansion beyond Rarity staff**

Co-managed/customer users require a distinct identity, consent and company-isolation design. Multi-MSP tenancy adds per-tenant identity providers, secrets, encryption, limits, billing, ownership and isolation testing. Neither is necessary for the confirmed first deployment. Keeping a tenant key internally is preparation, not evidence that those products are already supported.

**Optional richer client experiences**

Client-specific embedded UI cards, packaged plugins, reusable playbooks and guided forms can improve usability after plain MCP tool compatibility is proven. Keep them optional; no privileged action should depend on a proprietary UI card to enforce authorization. Version playbooks alongside tool contracts and treat source documents as data, not policy.
