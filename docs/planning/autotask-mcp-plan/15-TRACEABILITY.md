# Requirement and acceptance traceability

Each requirement maps to a concrete work package and test family. Entity-specific work expands this table through the 231-entry capability inventory. Evidence status is planned for every row; no implementation tests are claimed complete.

| ID | Requirement | Implementation | Acceptance |
| --- | --- | --- | --- |
| R-01 | Single Rarity instance, staff-only access | WP-01,07,08 | AUTH-01, POL-01 |
| R-02 | Portable deployment with Entra identity | WP-03–07,30 | AUTH-04, OPS-02/03 |
| R-03 | Every indexed entity/operation accounted for | WP-02,16–24,30 | Registry validation, Gate E |
| R-04 | Supported methods/child routes only | WP-02,09,10 | API-01, API-05, domain cases |
| R-05 | Workflow and generic tools share controls | WP-08,14 | POL-03 |
| R-06 | Identity/resource mapping cannot be overridden | WP-07–09 | AUTH-02, POL-05 |
| R-07 | Record scope includes child/direct-ID paths | WP-08,11,12 | POL-01/02 |
| R-08 | Financial field/filter/export controls | WP-08,21,27 | POL-04 |
| R-09 | Routine edits execute directly | WP-12,13 | EXEC-05 |
| R-10 | Bulk, destructive and billing writes execute directly when authorized; otherwise deny | WP-08,12,13,28 | EXEC-01–04 |
| R-11 | Native and application attribution distinguished | WP-07,12,29 | AUTH-04, domain readback |
| R-12 | Current metadata/picklist/UDF validation | WP-10 | API-03/04/06 |
| R-13 | No silently dropped requested fields | WP-10,12 | API-03, WRITE-04 |
| R-14 | No automatic partial PUT fallback | WP-09,12 | API-05 |
| R-15 | Root and child pagination complete or explicit | WP-11 | API-01 |
| R-16 | Unknown permitted response fields preserved | WP-10,11 | API-07 |
| R-17 | Uncertain writes reconciled before retry | WP-12,15 | WRITE-01/02 |
| R-18 | No false exactly-once/atomicity guarantees | WP-12,15,28 | WRITE-01/03, JOB-01 |
| R-19 | Persisted result verification | WP-12, domain packs | WRITE-04/05 |
| R-20 | Complete ticket context including internal notes | WP-16 | DOM-TICKET, API-01 |
| R-21 | Ticket/task/internal time, existing entries | WP-17 | DOM-TIME |
| R-22 | Scheduling/resources/time-off constraints | WP-19 | DOM-SCHEDULE |
| R-23 | CRM relationships/protected fields | WP-18 | DOM-CRM |
| R-24 | Projects/dependencies/complete context | WP-20 | DOM-PROJECT |
| R-25 | Contracts, adjustments, finance/invoice outputs | WP-21 | DOM-FIN |
| R-26 | Assets/subscriptions/protected UDFs | WP-22 | DOM-ASSET |
| R-27 | Quotes, procurement and stock commands | WP-23 | DOM-SALES, DOM-INVENTORY |
| R-28 | Knowledge/document child routes and visibility | WP-24 | DOM-KNOWLEDGE |
| R-29 | UDF/resource/webhook administration | WP-24,26 | DOM-ADMIN |
| R-30 | Reference catalogs/historical inactive values | WP-10,22 | DOM-REFERENCE |
| R-31 | Attachments authorized through parents | WP-25 | FILE-01/02 |
| R-32 | Safe exported HTML/CSV/binary handling | WP-25,27 | FILE-03 |
| R-33 | Durable cancellable resumable jobs | WP-15 | JOB-01/02 |
| R-34 | Revoked users cannot continue queued work | WP-07,15 | AUTH-03, JOB-03 |
| R-35 | Shared throughput and fair interactive capacity | WP-09,15,29 | API-08, load qualification |
| R-36 | Webhook validation, ordering and gap recovery | WP-26 | SYNC-01–03 |
| R-37 | Reports disclose freshness/completeness | WP-11,27 | API-01, domain reconciliation |
| R-38 | Caches/cursors/artifacts retain scope | WP-08,11,25 | POL-06 |
| R-39 | Prompt-injected content has no authority | WP-08,14,29 | SEC-01 |
| R-40 | Secret redaction and safe support bundles | WP-09,29 | SEC-02 |
| R-41 | Audit/journal outage fails writes safely | WP-06,12,29 | OPS-01 |
| R-42 | Operator console/operation accessibility | WP-28 | Human keyboard/screen-reader scenarios |
| R-43 | Write pause, revoke and recovery controls | WP-07,15,28,29 | OPS-04 |
| R-44 | Backup/restore and upgrade compatibility | WP-05,06,29,30 | OPS-02/03 |
| R-45 | Actual supported clients qualified | WP-03,04,14,30 | AUTH-04, Gate C |
| R-46 | Explicit unsupported/ambiguous capability status | WP-02,10,28 | Registry checks, Gate E |
| R-47 | No unrequested model/provider dependency | WP-03,14 | Dependency/configuration review |
| R-48 | Customer/finance/test decisions tracked | WP-01,30 | Decision log and release gate review |
| R-49 | Required employee impersonation rejects invalid/missing mappings with no integration-identity fallback | WP-07–09,12,15 | AUTH-05,06,08; POL-05 |
| R-50 | Native employee permission enforcement qualified separately from attribution per operation | WP-02,09,16–24,30 | AUTH-07; operation evidence and enablement gate |
| R-51 | Mandatory named technician tools; generic access cannot substitute for daily workflows | WP-14,16,17,19 | BENCH-03; required catalog in 14 |
| R-52 | Natural-language ticket-context workflow resolves references and retrieves internal notes plus existing time without API plumbing | WP-11,14,16,17 | BENCH-04; per-collection completeness and scope |
| R-53 | Focused initial console with later detailed entity/reporting/sync interfaces | WP-28 initial/later slices,26,27 | BENCH-06; no later-UI dependency for technician release |
| R-54 | Thread benchmark demonstrated before first technician production release | WP-04,07,08,12,14–19,28–30 applicable slices | BENCH-01–06 and Gates A–D; Gate E remains full-product requirement |
| R-55 | Shared scoped business references and deterministic ambiguity handling | WP-31 | WF-01–05 |
| R-56 | Reviewed eligible defaults with provenance; no invented work/time/customer text | WP-31 | WF-06–08 |
| R-57 | Four purpose-specific ticket context recipes with evidence and continuation | WP-32 | WF-11–15 |
| R-58 | Documentation/time workflow with prerequisite ordering and honest partial result | WP-33 | WF-16–18 |
| R-59 | Eligible handoff and completion workflows preserve supplied intent | WP-34 | WF-19–24 |
| R-60 | Workday and visit packages join authorized records without writes | WP-32 | WF-25–28 |
| R-61 | Fixed workflow journals/resume retain actor, payload and completed effects | WP-33,34 | WF-09,10,31,32 |
| R-62 | Actionable descriptions/errors and portable versioned playbooks | WP-35 | WF-34,37 |
| R-63 | Concise truthful receipts include defaults, record IDs and incomplete steps | WP-33–35 | WF-33,36 |
| R-64 | Measure technician routing, needless questions/lookups, comprehension and concurrent behavior across clients | WP-36 | WF-35–38 |

**Evidence record for an implemented operation**

Capture entity/operation ID, registry and schema versions, source references, test IDs, test environment, sanitized target IDs, requested fields, native response, independent readback, attribution, execution identity mode, mapping version, separate employee-permission allowed/denied evidence, exceptions and reviewer. For unsupported operations, record the API limitation and source. For unresolved operations, record the remaining question and owner. Never convert “not tested” into “unsupported.”

**Coverage reconciliation before full release**

Compare the current Autotask index and tenant metadata with the planned registry. Count operations by documented support, implemented state, fixture evidence, tenant evidence and enabled state. Include special endpoints and utility routes outside the index. Publish gaps by domain and their disposition. A complete matrix with missing tests still fails the release gate.
