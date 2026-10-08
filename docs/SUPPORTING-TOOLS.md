# Supporting tools

Release update: deployed September 16, 2026 as `0.1.0-classification-links.20260916.1`; see [current release evidence](CURRENT-STATUS.md). Local-preparation notes below describe the implementation history.

The deployed changes cover `my_workday`, `ticket_prepare_visit`, `at_playbook_list`, `at_playbook_get` and `at_artifact_export`. The validation below records offline fixtures and mocked native HTTP responses, not comprehensive live tenant certification.

## Workday summaries

`my_workday` accepts a concrete `date`, optional IANA `timezone`, `max_pages` (1–10; default 4), and independent `cursors.assigned_tickets`, `cursors.tasks`, and `cursors.time`. Each source page contains up to 100 records. The live adapter follows native query pages for tasks/time and existing scoped ticket cursors, while rechecking current identity, capabilities, resource ownership and ticket/project company scope. Self-owned time without a ticket/task parent is included as general/internal time. Invalid parents, dates, durations and cross-resource results are rejected; financial fields are filtered.

Timezone precedence is explicit tool input → configured resource timezone → configured workspace timezone. The response exposes `timezone_source`. Without a configured default or explicit timezone, the tool asks for one; it never assumes the server timezone.

Optional deployment configuration, left unset in examples:

```dotenv
WORKSPACE_TIMEZONE=America/Chicago
RESOURCE_TIMEZONES={"101":"America/New_York"}
```

The resource IDs above are illustrative. The mapping is application configuration, not a claim that employee preferences were retrieved from Autotask. Invalid IANA zones or resource-map keys fail configuration validation. Compose forwards both variables; no persistent settings were changed during this work.

Each collection exposes its own completion flag and encrypted continuation, valid for five minutes and bound to employee, mapping, policy, company scope, query and date window. Use the same date/timezone when continuing. `recorded_hours` and `recorded_hours_scope: returned_batch` describe only the time entries returned in that response. Merge time entries by ID before summing multiple batches; sections without cursors can repeat. A tail page never claims a complete daily total. These are non-atomic reads, and upstream permissions may restrict visible time.

Assigned tickets reflect current open assignments, not historical assignments on that date. Tasks overlap the local day. Recorded time follows the native `dateWorked` date container; durations are not reallocated across midnight or inferred from appointments. Schedule retrieval retains its existing bounded behavior and can independently make the result partial.

## Visit preparation

`ticket_prepare_visit` uses the same timezone precedence. It requires a ticket and date; a unique accessible ticket appointment is selected, or an error provides the accessible appointment IDs for `appointment_id`. An incomplete appointment search does not guess a match. `max_pages` and `cursors` can continue supported ticket-context collections such as notes.

Site context now reads the exact linked `companylocationID` through `CompanyLocations/{id}`. The adapter and domain verify record ID, company and the ticket's association before returning allowlisted address/phone fields, including a recheck after retrieval. It does not infer a site from a company address. Contact lookup already existed and retains scoped contact/parent-company checks. Missing or inactive site/contact data is exposed for confirmation; the ticket's linked site is not proof of an appointment's physical address.

History remains a bounded, redacted collection with incomplete results labeled. General/task appointments and arbitrary history continuation remain outside this ticket-visit tool. Preparation does not book appointments, send messages or log time.

Native references checked for this implementation:

- [CompanyLocations route and operational address fields](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyLocationsEntity.htm)
- [Tickets and the exact companylocationID field](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketsEntity.htm)
- [TimeEntries, including general/internal activity and API visibility limits](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TimeEntriesEntity.htm)

## Playbooks

The default version is now `0.2.0`; the original `0.1.0` files remain unchanged and can still be requested explicitly. List/get return versioned identifiers, content digests and unavailable tool requirements. The new documents remove unsupported claims about delegated time and automatic knowledge/related-ticket ranking, explain actual time interval requirements, and describe workday pagination and total semantics.

Both versions remain `draft` / `proposed_pending_business_validation`. Implementation review does not manufacture Rarity business approval. Reading guidance neither grants permission nor authorizes its suggested actions. Review the five [version 0.2.0 procedures](../playbooks/0.2.0/) before choosing to adopt them as business policy.

## CSV exports

The existing `at_artifact_export` implementation needed no replacement. It exports one ticket, its notes or the caller's recorded ticket time to encrypted local storage, with row/byte limits, completion status, expiry and a checksum. `at_artifact_get` returns bounded chunks. Current identity, ownership, parent/child scope, expiry and integrity checks apply to retrieval. Formula-like strings are neutralized. Creating an export does not modify Autotask or send a file to a customer.

The new MCP regression exports and downloads all three collections, reconstructs their bytes, validates their checksums and cleans up local artifacts. Existing artifact tests cover projection, formula safety, quotas, expiry, ciphertext tampering, revoked access and PostgreSQL recovery.

## Verification and release boundary

**Validation:** TypeScript check/build, Compose validation with synthetic settings, and all **641 offline tests passed**. Regenerated the tool catalog. No live tenant validation or deployment was performed.

Run `npm run check`, `npm run build`, and `npm test` in Docker-hosted Node 24 using the repository's Linux dependencies. The test container uses no production environment, no production volumes and no external network. Regenerate `docs/TOOL-CATALOG.json` with `scripts/export-tool-catalog.ts` after output-contract changes.

Regression coverage is in `tests/technician-domain.test.ts`, `tests/technician-transport.test.ts`, `tests/fixed-workflows.test.ts`, `tests/playbooks.test.ts`, `tests/artifacts.test.ts`, and `tests/extended-system.test.ts`. Coverage includes independent paging, cursor isolation/expiry, malicious native URLs, subsequent-page ownership/date checks, linked-site drift, timezone precedence/DST, visit ambiguity, partial totals, final permission revocation and actual MCP switch enforcement.

Deployment, enabling these five tools, live tenant validation and business adoption of playbooks remain separate actions. No redeployment has been performed.
