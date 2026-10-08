# Historical verification record

This public summary retains aggregate local validation from the original private
development history. Customer names, personal identities, company scopes, native
record IDs, attachment details, operational readbacks and deployment receipts have
been withheld. Original live provider observations are not relabeled as synthetic
or reproduced as public acceptance evidence. See [current source status](CURRENT-STATUS.md)
for the publication boundary and [documentation verification](DOCUMENTATION-AUDIT.md)
for the earlier reproducible documentation audit.

## Historical local results

| Recorded date | Local fixture/mock result | Other recorded checks |
| --- | --- | --- |
| September 15, 2026 — CRM to-dos and notes | 592 passed, zero failures/skips/cancellations; 35 focused business/note tests passed after review fixes | Strict TypeScript checking and container/Compose build checks |
| September 15, 2026 — native quote workflows | 580 passed, zero failures/skips/cancellations; 30 sales tests passed after pagination correction | Strict TypeScript checking and container build |
| September 14, 2026 — domain expansion | 563 passed, zero failures/skips/cancellations | Strict TypeScript checking, compilation and Compose build/configuration |
| September 10, 2026 — initial integration | 434 passed, zero failures/cancellations/skips | TypeScript build, offline preflight, fixture metadata and HTTP/session smoke checks |

These are dated results for their recorded private revisions. They are not test
counts for the fresh public Git history, complete security clearance, or proof of
current provider connectivity. Earlier scanner and native-currency observations
remain historical; the current implementation and limits take precedence.

## Initial fixture and smoke coverage

The September 10 compiled fixture smoke served 38 tools, exercised console sign-in,
note/time writes and stable request-key replay, and shut down its local listener.
Offline preflight passed 41 checks with zero network calls using fictional
configuration and rejected invalid host placeholders. Fixture metadata generation
produced eight partial entity definitions and 23 bindings without live enablement.
The following table describes that historical automated run, not new public-release
acceptance:

| Area | Exercised locally |
| --- | --- |
| Runtime integration | All 38 tool registrations, mandatory eight plus five workflows, capability-filtered discovery, guarded wrappers, pure-read final access checks, strict schemas, reserved durable-job request keys and read-only preflight without effects. |
| Identity and policy | Synthetic Entra validation; active, fresh employee/resource mapping; mapping/policy/capability revocation; company/actual-parent scope; field projection; distinct self/team time and actor-owned recovery/artifact/job records. |
| HTTP transport | Modern/legacy MCP handling, canonical host/origin, bounded bodies/responses/admission/timeouts, multiple cookies, fixed reviewed upstream routes/headers, no mutation retry, shared nested preflight admission and post-wait guards. |
| Technician work | References, category/status/assignment rules, expected state, completion requirements, notes beyond one page, actual date-scoped time, handoff/resolution, zoned scheduling and separate service-call associations. |
| Workday evidence | Separate task/ticket parents and actual recorded time; invalid IDs/resources/dates fail, protected fields are omitted, unsupported internal time and continuation remain explicitly incomplete. |
| Recovery and jobs | Immutable root/child claims, actor/request-key deduplication, lost acknowledgements, accepted/unknown outcomes, optional-time intent preserved before child creation, exact saved-ID reconciliation, safe resume/attempt/expiry bounds, leases/fences and cancellation before further effects. |
| SQL and encryption | Migrations 001–005 using PGlite; transactional failure/rollback, concurrent claims, persisted reconstruction, receipt redaction, AES-GCM tamper/actor/key binding, distinct workflow/artifact keys, and restricted runtime SQL-role behavior. |
| Console and controls | Static routes, headers, session/CSRF and Entra authorize/callback contracts; shared member/template/control state, CAS, activity/audit/jobs/recovery/files, and authorization changes during awaited reads. |
| Metadata and capacity | 231-label inventory binding; exact native fields and trusted context, hashes/digests/qualifications, freshness and no stale refresh fallback, actual captured verification time, per-date eligibility, shared rolling admission, external pressure/headroom, fairness and cancellation. |
| Artifacts | Fixed-column CSV/formula defense, safe MIME/filename/base64 handling, fail-closed scanning, encrypted storage/quota/expiry/audit, actor/mapping/record access and revocation during listing, publication and download. |
| Deployment factory | Real `createLiveSystem` constructed over PGlite with synthetic environment: startup, assets, readiness, inactive bootstrap mapping, absent/partial settings, key separation, unqualified operation denials, Entra redirect construction and empty worker tick. Network spy confirms zero network calls. |

## Evidence boundaries

PGlite runs a PostgreSQL engine in memory. Migration, SQL-role and reconstruction
tests do not independently qualify PostgreSQL restart, backup restoration,
production TLS or artifact-volume recovery.

Capacity tests used 20 simulated actors. A mixed burst modeled 80 physical attempts,
including readbacks and bounded read retries; a virtual one-minute soak modeled
4,800 attempts. Simulated admission and guard checks are not provider-account
capacity measurements.

The live-system factory's zero-network tests establish local wiring and conservative
startup, not credential validity. Client sign-in, native attribution/date round-trips,
provider writes, intended-environment recovery, manual accessibility and live capacity
require separate acceptance. The September 10 environment did not build/run Docker
or run remote CI; later dated container results above do not retroactively change
that limit.

The original entity inventory, implementation counts and third-party reference corpus
were historical development evidence. The public snapshot removes copied vendor
reference bodies; their earlier byte-count claims do not apply to this source tree.
A retained entity label does not establish complete operation coverage or grant
runtime permissions.

For current fixture commands, use the [README development guide](../README.md#development).
Keep credentials, tenant records and runtime evidence outside public source history.
