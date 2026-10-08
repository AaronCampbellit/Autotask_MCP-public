# Local metadata and qualification tooling

> Current-status note (2026-09-14): this document contains earlier design or test snapshots. For current implementation and deployment distinctions, start with [CURRENT-STATUS.md](CURRENT-STATUS.md). Historical test results remain evidence for their stated revision only.

The metadata package turns reviewed local captures into versioned, tenant-bound runtime inputs. It performs no network calls, changes no Autotask records, and enables no operation from documentary coverage. The checked-in fixture contains fictitious values, eight partial entity definitions and zero tenant qualifications. The registry still accounts for all 231 original entity labels, including `AttachmentInfo (REST API)`.

## Run the local tools

From the project root with the configured Node runtime:

```powershell
npx tsx scripts/metadata-tool.ts inventory
npx tsx scripts/metadata-tool.ts fixture --out work/metadata/fixture-current.json
npx tsx scripts/metadata-tool.ts validate --input work/metadata/fixture-current.json
npx tsx scripts/metadata-tool.ts coverage --input packages/metadata/src/fixture.snapshot.json
npx tsx scripts/metadata-tool.ts import --input work/metadata/reviewed-input.json --out work/metadata/reviewed-snapshot.json --root .
npx tsx scripts/metadata-tool.ts diff --before work/metadata/previous.json --after work/metadata/reviewed-snapshot.json
```

`--inventory` selects an alternate checked inventory file. `--at` supplies an explicit validation time for reproducible offline tests; production code uses the server clock. Import and fixture creation require a new output filename. Validation requires a current snapshot; coverage and diff permit an expired snapshot for inspection. Console output contains status, digests, counts, native field paths and documentary entity names. It does not dump metadata values, UDF labels, credentials, record bodies or captured file contents.

The committed fixture uses `2026-09-10T12:00:00.000Z` and intentionally becomes stale. Inspect it at that time with `--at`, or generate a fresh fixture under `work`. It cannot be converted into live qualification merely by running the importer.

## Capture and review format

`packages/metadata/src/contracts.ts` defines the strict input schema. An input contains `content` and `qualifications`; compilation adds `metadataDigest`, `version` and the envelope `digest`. The normalized format is deliberate: the importer does not guess meanings, native field spelling, status semantics, business scope or tenant defaults from an arbitrary response.

1. Collect only the metadata and narrowly scoped operational facts needed for the selected tenant, identity mapping and operations. Keep credentials, authorization headers, ticket descriptions, note bodies, time summaries and unrelated business records out of the captures. Collection is a separate, authorized live step; this CLI cannot collect them.
2. Save reviewed capture files beneath the configured evidence root. Record each file's SHA-256, capture time, relative path and source kind. Use immutable filenames and replace the snapshot only after every referenced file is ready. A source is `metadata-export`, `operational-capture`, `tenant-test`, `documentation` or explicitly fictitious `fixture`.
3. Preserve exact native entity/runtime names, field names and data types. Record required, read-only and queryable flags as observed, or `null` if unknown. Preserve native reference targets, length limits, picklist IDs, labels, activity/default flags and parent dependencies. UDF definitions have their own collection. `complete: true` is a reviewed completeness assertion; a partial capture must remain partial. Unsupported or missing entities remain visible in inventory coverage.
4. Add explicitly reviewed provider bindings. Bindings include tenant, Entra object, Autotask resource, mapping version, policy version, the complete company scope, applicable ticket/company/context, source IDs and expiry. Their required native fields must exist. The compiler also enforces the minimum fields for each implemented provider. A catalog must declare completeness; a status must retain its reviewed completion meaning; technician metadata includes category requirements, permitted transitions and resource/queue/role/category assignments. Missing contexts do not inherit another binding's defaults.
5. Import the input. The importer rejects unknown properties, inconsistent IDs/picklists, ambiguous defaults, missing native requirements, unsafe source references, identity mismatches and expired metadata. It verifies local file hashes before writing the compiled artifact. Review the safe diff before replacing a configured snapshot.

This is a trusted operator import boundary. File hashes detect changed bytes; they do not prove that a claim is true or authenticate a tenant test. Neither the CLI nor the snapshot compiler substitutes for reviewing the actual captured behavior. Tool callers cannot supply snapshots, source verification maps, bindings or approvals.

Native spelling matters. For example, the reviewed technician contract uses `Tickets.assignedResourceRoleID`, with that exact casing. A similarly named field is rejected when the provider requires the native spelling. Refer to the preserved planning capture and the relevant current tenant metadata when assembling the normalized input.

## Operation qualification

```typescript
const snapshot = await loadMetadataSnapshot(snapshotPath, { inventory });
const verifiedSources = await verifyLocalSources(snapshot, workspaceRoot);
const qualifications = compileQualifications(snapshot, {
  operations: ['Tickets.query', 'TicketNotes.create'] as const,
  verifiedSources,
});
```

`compileQualifications<T>(snapshot, options)` returns `CompiledQualification<T>[]`, structurally compatible with adapter operation qualifications. The requested operations must be explicit supported keys; the compiler does not expand a generic enable-all switch. `TimeEntries.query.own` is distinct from ticket-parent `TimeEntries.query`.

Each requested operation needs current live evidence bound to the exact tenant, policy, allowed resources and metadata digest. Evidence includes a reviewer identifier, test identifiers and locally verified tenant-test captures. It must affirm accepted impersonation, enforced permissions, positive scope, negative scope and mapping revocation. Creation and ticket patch operations additionally require native attribution evidence. Missing, false, fixture, stale or unverified evidence fails closed. An empty request returns no qualifications. The broader 231-entity inventory never becomes an allowlist.

Qualifications expire independently. Adding reviewed entity coverage does not qualify its transport operations. Tests of one employee or operation do not authorize another employee or operation. Actual designated-record tenant tests and their evidence remain the next live qualification step.

## Runtime provider callbacks

`MetadataSnapshotProvider(snapshot, { tenantId, source, inventory?, verifiedSources?, clock? })` provides these adapter callbacks:

| Callback | Reviewed scope |
| --- | --- |
| `resolveTicketWork(principal, ticketId)` | Note type/audience, own-time roles/work types and explicit defaults |
| `resolveTechnicianMetadata(principal, ticketId)` | Ticket rules, transitions and eligible assignments |
| `resolveCatalog(principal, kind, context)` | Exact company/resource/queue/status/category/priority lookup context |
| `resolveSchedulingMetadata(principal, ticketId)` | Service-call status, attribution, overlap policy and eligible ticket resources |
| `resolveResources(principal)` | Explicitly scoped scheduling resources |
| `validateTicketTimeEligibility(principal, ticketId, payload)` | Exact work-date and period eligibility |
| `getResourceVerification(tenantId, resourceId)` | Actual active-resource capture, including `verifiedAt` |
| `verifyResource(tenantId, resourceId)` | Boolean compatibility helper; it still requires a fresh exact capture |

Every callback checks freshness and the relevant exact binding. Live callbacks verify all non-documentation evidence used by that binding. Returned objects are clones; no caller can modify the saved snapshot. A stale selected binding is rejected even if the broader metadata snapshot remains current. Field metadata has a maximum 31-day validity window; a shorter reviewed tenant expiry is supported.

Time eligibility is separate from picklist metadata. Each binding names one ticket, actor and calendar work date. Its reviewed facts include a containing timesheet period and status, active resource, ticket and contract permission, local-date container behavior, effective role/work-type combinations and remaining allowable hours. The complete proposed payload is checked in memory; summary/internal-note text is not stored in metadata. The HTTP adapter invokes this read-only validator before related writes and again before time creation. A five-minute capture is a bounded observation, not a reservation of hours or a promise that upstream state cannot change; the upstream write and readback remain authoritative.

Resource evidence is separate from a principal's existing `active` flag. It names the exact tenant/resource and preserves the original capture time. Both employee verification and time eligibility expire within five minutes of that capture. Operational evidence must reference an `operational-capture` source with the matching capture time. Live activation should return `{ verifiedAt: evidence.verifiedAt }` to `ControlPlaneService`; the service rejects invalid, future or five-minute-old evidence and saves the actual timestamp. Boolean `true` exists for fixture compatibility. Auth refresh may project a fresh exact capture onto a clone of the saved mapping without changing mapping/policy versions; it must not derive freshness from an old principal.

## Atomic local refresh

`RefreshingMetadataSnapshotProvider(initialSnapshot, { ...providerOptions, snapshotPath, workspaceRoot, refreshIntervalMs? })` exposes the same callbacks. Its default refresh interval is 30 seconds; the configured interval must be between 1 ms and 30 seconds. It coalesces concurrent refreshes, validates the entire replacement, verifies all local evidence files and atomically replaces the provider. Missing files, invalid data, expired snapshots or changed source bytes fail closed after the refresh deadline, with no stale fallback. A failed refresh remains unavailable until a subsequent scheduled refresh succeeds.

The envelope digest covers all content, including operational captures and qualifications. The metadata digest/version excludes tenant-test sources, operational-capture sources, resource verifications and date-specific time-eligibility bindings. Refreshing those short-lived observations therefore does not change reviewed field/picklist/default metadata. The original metadata digest, qualifications and their evidence-source fingerprint are pinned during refresh. Changing those requires qualification review and a restart with newly compiled adapter qualifications. Removing a qualification cannot silently retain an older approval.

The initial provider is immutable. The refreshing provider reads only the server-configured local path and makes no network request. A deployed pilot still needs an authorized mechanism to produce fresh employee/period captures; expired captures cannot be extended by restarting, rereading or rewriting a principal timestamp. A future deployed collector can replace these local observations while keeping this validation boundary.

## Verification

```powershell
npx tsx --test tests/metadata.test.ts tests/metadata-files.test.ts tests/control-plane.test.ts
npm run check
```

Tests cover documentary inventory preservation, digest integrity, exact scope/default/native-field validation, fixture isolation, explicit operation evidence, stale/foreign resources, date-specific time eligibility, local file hashing, atomic concurrent refresh, failed refresh with no stale fallback, safe reports and actual resource capture timestamps in both memory and PostgreSQL-backed member storage. These tests use synthetic data and perform no live tenant qualification.
