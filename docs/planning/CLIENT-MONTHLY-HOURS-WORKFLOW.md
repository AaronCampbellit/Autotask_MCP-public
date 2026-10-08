# Client monthly-hours reporting

Status: implementation specification; the proposed bulk reporting tool is not implemented or deployed.

## Agreed default and date semantics

“Hours spent on a client” includes actual Autotask `hoursWorked` on support tickets and project tasks, shown separately with a combined total. Exclude unassociated internal time and disclose that exclusion. Do not substitute billable hours, invoice amounts, project lifetime actualHours, estimates, ticket counts or appointment durations.

Resolve the client once. Reuse the exact established reporting window for “over that same period”; ask when that context is missing. Echo the resolved company and inclusive calendar dates. Select and group by the native `dateWorked` calendar date container, not by ticket creation/completion dates or timestamp timezone conversion. Older/closed tickets and completed projects can have in-window time.

Deduplicate by native time-entry ID. Conflicting copies, malformed dates or missing/non-finite hours invalidate completeness. Sum decimal hours before display rounding. Include zero-hour months only after complete retrieval. Label partial first/last calendar months independently of incomplete retrieval.

## Proposed report interface

`client_time_report_start`: company reference, from_date, through_date, explicit resource_scope (team/self), sources (default tickets and project tasks), and stable request key. Return a durable report ID immediately.

Status/result: resolved scope and dates, monthly ticket/project hours and counts, independent source completeness, observation time, report definition version, pages processed, and retry/checkpoint information. States: queued, running, waiting_for_rate_limit, completed, partial, failed, cancelled.

An incomplete source has an observed subtotal, not a final total. A missing source is unknown, not zero. A combined final total requires complete retrieval of both requested sources. No rates, costs or time-entry note bodies are needed in the result.

## Retrieval and authorization workflow

1. Resolve and authorize the company. Preflight time, ticket and project read access plus `time.team` for team reports. Never silently downgrade a client-wide report to self time.
2. Enumerate client ticket IDs and client project/task IDs with paginated bulk reads. Avoid ticket context, notes and one-time-query-per-ticket loops. Verify task → project → company ownership.
3. Query root TimeEntries in bounded authorized ticketID/taskID batches with the exact dateWorked range. Qualify native field queryability, operators, batch limits and continuation behavior before enabling this path. Do not remove the current single-parent guard from public tools.
4. Validate returned IDs, parent membership, dates and resource scope. Revalidate parent ownership in bulk before exposing data; fail closed on scope mismatch.
5. Persist encrypted actor-bound checkpoints: completed batches, continuations, deduplication evidence and monthly accumulators. On throttling, resume unfinished work instead of rescanning completed tickets or launching another overlapping query path.
6. Use the shared request budget and bounded concurrency. Honor retry guidance with bounded backoff/jitter; release worker leases during long delays. Support cancellation, restart and expired-cursor outcomes without silently combining incompatible snapshots.
7. Bind checkpoints and cached results to tenant, actor, company/source/date scope, mapping/policy versions and report definition. Reauthorize result retrieval. Never expose cached team totals to a self-only caller.
8. Return independent coverage and non-atomic-snapshot warnings. Repeated follow-ups should reuse a report ID rather than collect the same records again.

## Assistant routing

Prefer the dedicated report for monthly client hours once it is actually exposed. Until then, do not claim that an efficient bulk path exists. Explain the single-parent limitation before an expensive scan. At a rate limit, stop fan-out; do not automatically try alternate overlapping searches. Never claim a partial count or hours subtotal is the full answer.

The response table should contain Month, Ticket hours, Project-task hours, Combined hours and Coverage. For June 21–September 21, label June 21–30 and September 1–21 as partial calendar months; July and August are full calendar months. Keep source incompleteness separately visible.

## Acceptance tests before release

- Exact ticket/project/combined totals across multiple pages without per-ticket time requests.
- Old and closed tickets, completed projects and in-window work included; out-of-window entries excluded.
- Month/year boundaries, leap days, date containers and partial calendar months.
- Duplicate IDs, conflicting values, malformed dates and invalid hours.
- Mid-batch 429, checkpoint resume without double counting, worker restart, cancellation and cursor expiry.
- Revoked/team-to-self permissions, unauthorized companies and changed parent ownership fail closed.
- Missing project data never becomes zero project hours or a complete combined total.
- Authorized repeated follow-ups reuse results.
- Native transport tests plus a controlled read-only reconciliation against an Autotask client report.

## Current code gaps

`time_entry_search`/`at_query` require one ticket. `time_search` requires one ticket or task, or internal scope. `client_health_report_start` has no time-report definition and its worker has no resumable time checkpoints or rate-limit waiting state. This needs a reviewed batch transport, durable report state/aggregation, MCP discovery/output contracts, regression tests and a versioned deployment. The existing implementation must not be described as already providing this report.
