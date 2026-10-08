# Build and deployment tracker

The current work covers tickets and authoring, contact lookup/linking, sales, business domains, work management, checklists, attachments, bounded reports and integration support. See [IMPLEMENTATION.md](IMPLEMENTATION.md), [CURRENT-STATUS.md](CURRENT-STATUS.md), and the generated [TOOL-CATALOG.json](TOOL-CATALOG.json).

The development environment is the iMac with Docker-hosted Node 24. The existing deployment uses PostgreSQL, Entra sign-in, LAN DNS/TLS and a read-only metadata collector. One user and the existing company scope are retained. Current release checks and enabled tools must be read from the release record, not earlier fixture counts.

## Verification stages

1. TypeScript checking and focused native-model/scope/idempotency tests.
2. Full fixture/mock suite and migration tests.
3. Container build, Compose validation and health/readiness.
4. Read-only tenant metadata and capability discovery checks.
5. User-controlled live business-write validation.

Stage 5 is deliberately not performed by the build agent. No opportunity, quote, ticket, expense, inventory or time test record is created in the tenant.

## Open boundaries

Contacts remain lookup and ticket linking only. Native attachment upload uses validated staged files; scanner removal is deployed. Ticket tag add/remove and ticket checklist-library application workflows are deployed, pending tenant qualification. General appointments, delegated time writes, broader history/knowledge operations, advanced reports and operational purge/key-rotation tooling remain on the broader roadmap. Complete webhook synchronization is research-only in [REPORTING-SYNC-RESEARCH.md](REPORTING-SYNC-RESEARCH.md). Quote sending, native quote PDF generation, customer acceptance and Won Quote conversion are covered by the [integration investigation](QUOTE-DELIVERY-INVESTIGATION.md), not advertised as implemented REST actions.

The historical acceptance matrix and preserved registry/corpus remain evidence for their original revisions. They do not grant runtime permissions or establish current deployment state.

CRM to-dos and project/task note tools are documented in [CRM to-dos and notes](CRM-TODOS-AND-NOTES.md).

## Next work

**The Autotask backlog remains incomplete; Datto RMM has since shipped alongside it.** The [completion audit](AUTOTASK-COMPLETION-AUDIT.md) reconciles all 36 original work packages, separates implementation from validation, and records current decisions. The [231-entity evidence index](AUTOTASK-ENTITY-RECONCILIATION.json) provides candidate source/test locations without claiming entity completion.

1. **A1: Daily technician evidence.** Site/location context, collection/workday continuation, internal-time reporting and configured timezone defaults. Workday pagination, internal time, configured timezone defaults and linked-site reads are deployed; see [supporting tools](SUPPORTING-TOOLS.md). Arbitrary history continuation and broader scheduling remain separate.
2. **A2: CRM and work management.** Remaining company/contact administration, checklist templates, general/task scheduling, delegated time and project/file child operations.
3. **A3: Remaining Autotask domains.** Per-operation review of every original entity; knowledge/UDF, asset, finance and long-tail implementation.
4. **A4: Reporting, synchronization and console.** Complete report/reconciliation engines and corresponding operator views.
5. **A5: Operational and release acceptance.** Purge/key rotation, recovery/incident exercises, client/accessibility/load evidence and user-controlled live business validation. Track these throughout the build.
6. **RMM acceptance / later IT Glue.** RMM is deployed with 55 tools; finish applicable tenant/client acceptance using [expanded coverage](RMM-EXPANDED.md). IT Glue remains research-only in the [preserved plan](planning/rmm-itglue-2026-09-15/README.md).

Quote delivery/acceptance/Won remain the selected native-UI workflows. Native employee read-permission enforcement is not claimed under the application-controlled pilot. Neither decision means every other Autotask operation is complete.

### Documentation maintenance

- [x] Reconcile current implementation against all original work packages and correct the delivery order.
- [x] Add a reproducible evidence index retaining all 231 original entity labels.
- [x] Correct stale deployment/scanner statements in current documentation entry points.
- [ ] Complete exact per-operation certification and evidence links as domain slices ship.
- [ ] Record actual ChatGPT end-to-end results when verified.
- [ ] Update current status, tool catalog, configuration guidance and verification evidence with each release.

The September 17 count of 281 operations is historical. The current generated catalog declares 329 operations, including 55 RMM and 27 IT Glue tools; availability is caller/configuration-dependent. The [API workflow audit](API-WORKFLOW-AUDIT.md) identifies specific missing native workflows and explains why this count is not full REST coverage. The latest deployment record and its verification evidence are in [current status](CURRENT-STATUS.md); historical test totals remain tied to their original revisions.
