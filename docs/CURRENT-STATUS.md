# Current implementation status

This is a public source snapshot prepared for portfolio review. Private customer,
contact, ticket, attachment and deployment receipts have been withheld from the
original release diary. Original live observations are not presented as synthetic
tests, and this source publication does not deploy or certify a live tenant.

## Current source

The runtime declares server release `0.2.0-ticket-report.20260925.1` in
[`apps/server/src/publication.ts`](../apps/server/src/publication.ts). This is a
source identifier, not evidence of a newly deployed public release. The generated
[tool catalog](TOOL-CATALOG.json) declares **338 operations**, including **55 Datto
RMM** and **27 IT Glue** operations. Availability depends on provider configuration,
metadata qualification, employee permissions, company scope and operation switches.
An operation count is not complete native API coverage.

Implemented areas include ticket search and reporting, native ticket changes and
notes, assignments, tags/checklists, time and work-management workflows, sales and
CRM, business domains, validated attachment staging/copy, bounded reports, scoped
RMM reads/actions and IT Glue integration code. See the [implementation overview](IMPLEMENTATION.md)
and [API workflow audit](API-WORKFLOW-AUDIT.md) for boundaries. Provider code and
fixture tests do not establish acceptance in a particular vendor account.

## Security and operation controls

- Entra identities map to local employee state, permissions and company scope.
  Discovery and read grants do not imply write grants.
- Schemas validate native fields and parent relationships. Reads reauthorize after
  awaited work; writes check current context immediately before dispatch.
- Durable request keys and encrypted receipts preserve operation identity and
  distinguish verified, accepted and uncertain outcomes. Unknown writes must not
  be repeated with a new key.
- Browser login transactions use encrypted cookies, PKCE/nonce checks and a bounded
  ledger of completed verified sign-ins. See [console authentication](CONSOLE-AUTH.md).
- Attachment staging is validated, encrypted and actor-bound. The current source
  does not claim malware scanning; staging is separate from native publication.
- RMM component execution needs reviewed component approval, mappings, employee
  grants and an execution switch. Arbitrary shell tools and API-key reset are excluded.

These are implementation descriptions, not complete security certification.

## Reproducible local review

The [README quick start](../README.md#quick-start) starts a loopback fixture console
without vendor credentials. All example companies, contacts and requests in the
public fixtures are fictional. Use a disposable environment when testing writes.

From the repository root after installing the locked dependencies:

```sh
npm run check
node --import tsx --test --test-concurrency=2 tests/*.test.ts
npm run build
```

Publication preparation recorded a baseline pass of **1,007 fixture/mock tests**,
strict TypeScript checking, compilation, offline planning validation, Compose and
container build/notice inspection. That baseline preceded the final public-fixture
and documentation sanitization; final publication checks must be read alongside
the exact published revision. The historical [verification record](VERIFICATION.md)
retains earlier aggregate test results and their limits.

## Acceptance still required

Live provider credentials, metadata, client sign-in and tool use, native attribution,
user-selected business writes, restore/recovery, capacity and accessibility require
qualification in the intended environment. The public snapshot does not enable or
exercise them merely by publishing source. Native employee read-permission
impersonation is not claimed under the application's existing access model.

Native quote delivery, PDF generation, customer acceptance and Won Quote conversion
remain vendor UI workflows. General company/contact administration, delegated time,
full synchronization, broad reporting and operational purge/key-rotation tooling
remain incomplete or separately scoped. Optional Tasks/host features and IT Glue
account qualification retain the limits documented in the implementation plans.

A future MCP deployment must use a new server release and image tag, as required
by [AGENTS.md](../AGENTS.md). Source publication alone is not a deployment.

## Documentation map

- [Documentation index](README.md), [implementation](IMPLEMENTATION.md),
  [build tracker](LOCAL-BUILD-TRACKER.md) and [API workflow audit](API-WORKFLOW-AUDIT.md).
- [Deployment](DEPLOYMENT.md), [employee onboarding](ENTRA-USER-ONBOARDING.md),
  [Autotask configuration](AUTOTASK-CONSOLE-CONFIGURATION.md) and [Datto RMM](DATTO-RMM.md).
- [Work-request authoring](work-request-authoring.md), [ticket completion](TICKET-COMPLETIONS.md),
  [work management](WORK-MANAGEMENT.md) and [CRM to-dos/notes](CRM-TODOS-AND-NOTES.md).
- [Project 2.0 implementation progress](planning/IMPLEMENTATION-PROGRESS-2026-09-20.md)
  and [RMM/IT Glue plan](planning/rmm-itglue-2026-09-15/IMPLEMENTATION-PLAN.md).

Dated plans and verification records describe their original revisions. Private
operational receipts are intentionally absent from this public source snapshot.
