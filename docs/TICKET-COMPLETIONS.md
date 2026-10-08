# Ticket completion searches

Release `0.1.0-completions.20260918.2`. See [current status](CURRENT-STATUS.md) for deployment state.

## Choose the evidence that answers the question

| Request | Tool and interpretation |
| --- | --- |
| What did I complete yesterday? | `ticket_completion_search`, `completed_by: {kind: "self"}`, yesterday in the employee's timezone. Includes tickets reopened or completed again afterward. |
| What did a named technician close last week? | The same history tool, with that technician's authorized resolved employee reference and last_week. |
| Which of my tickets closed this week? | History with `technician: {kind: "self"}`. Say that "my" means current assignment; this does not assert the user performed the completion. |
| What completed for EXW this month? | History with company name EXW and this_month. Company aliases are resolved server-side. |
| Which currently completed tickets have their completion date in this range? | Fast `ticket_search` with `completed_window`, appropriate current status, and optional `completed_by` or `technician`. |
| How many did we close? | History without completed_by; use final `total_tickets`. `total_completion_events` is separate. |
| How many August tickets currently have status Canceled? | `ticket_count` with `created_window` covering August and `status: {kind: "name", name: "Canceled"}`. This is one native count, with no ticket pagination. |
| How many tickets created in August entered Canceled in September? | `ticket_status_transition_search` with August `created_window`, September `transition_window`, and `to_status: {kind: "name", name: "Canceled"}`. Follow candidate continuations; only a complete final scan gives an exact total. |

`technician` always means **current assignee**. `completed_by` always means the employee recorded as performing completion. Never substitute one for the other. Omitting either filter means all authorized employees, not implicitly self. Company filters also use current ownership, not historical company ownership.

For August 2026 in America/Chicago, pass `created_window: {"start":"2026-08-01T00:00:00-05:00","end":"2026-09-01T00:00:00-05:00"}` and `status: {"kind":"name","name":"Canceled"}` to `ticket_count`. The start is inclusive and the end exclusive. The status is the ticket's **current** status. This does not identify tickets whose status changed to Canceled during August, regardless of creation date; that historical question requires status history evidence.

## Created in one period, status changed in another

```json
{
  "created_window": {"start":"2026-08-01T00:00:00-05:00","end":"2026-09-01T00:00:00-05:00"},
  "transition_window": {"start":"2026-09-01T00:00:00-05:00","end":"2026-10-01T00:00:00-05:00"},
  "to_status": {"kind":"name","name":"Canceled"},
  "page_size": 25
}
```

`ticket_status_transition_search` first filters native tickets by the creation window and `lastTrackedModificationDateTime >= transition_window.start`. There is deliberately no upper modification bound: a ticket canceled in September may be edited again in October. The tool then checks each candidate's status-change history for an actual transition into Canceled during September. By default it includes tickets later reopened; set `currently_in_status: true` only when the question explicitly asks for tickets still Canceled. Last tracked modification is not the status-change date and never counts by itself.

The result distinguishes tickets from transition events. Candidate pages may have no matching tickets and still need continuation. Final totals remain null until every candidate page is scanned with complete and classified histories. The native TicketHistory API accepts only one ticket ID filter; this workflow requests a bounded 500-row page per ticket. Histories longer than that, or unclassified histories, make the result partial. Reads are live, not an atomic historical snapshot. The workflow exposes no raw history detail.

Local tests cover filtering, later edits, reopening, pagination, incomplete history, and a synthetic ticket with more than 100 September history rows. Private tenant observations and ticket counts are withheld from this public source snapshot. Candidate counts are never presented as transition counts; exact totals require complete history evidence.

## Fast native completion search

```json
{
  "completed_by": {"kind": "self"},
  "completed_window": {
    "start": "2026-09-17T00:00:00-05:00",
    "end": "2026-09-18T00:00:00-05:00"
  },
  "page_size": 100
}
```

The start is inclusive, the end exclusive. Timestamps require explicit offsets and are normalized to UTC. The server filters `completedDate` and `completedByResourceID`; it does not fetch an employee's entire closed-ticket history. These native read-only fields are also exposed in ticket results and permitted in `at_query`, including the exclusive `lt` operator. Native completion metadata is cleared when a ticket reopens and describes only the latest completion. This search is not a historical completion ledger. It does not silently add a current status.

## Historical completion activity

```json
{
  "window": {"period": "yesterday", "timezone": "America/Chicago"},
  "completed_by": {"kind": "self"},
  "page_size": 10
}
```

Periods: today, yesterday, this_week, last_week, this_month, last_month, and custom. Weeks start Monday. A custom window supplies `start_date` and exclusive `end_date`, plus timezone; at most 93 calendar days. Local midnight boundaries account for daylight-saving changes. Relative windows are frozen when the first cursor is created and are reused by subsequent pages.

Optional filters: company, completed_by, technician, exact ticket (ID, number or supported URL), and `current_state` (any by default; completed or reopened). A ticket completed in the window remains included if it was later canceled or marked duplicate, but is labeled `other_terminal`. Cancellation and duplicate transitions themselves do not count as completions.

Each result contains the current linked ticket, its current state, and matching completion events with native history ID, UTC timestamp, employee ID and status transition. One row represents one ticket, even if the employee completed it repeatedly. A transition into Complete or Complete (With CSAT) counts; a transition between those two states does not count again. Null/invalid actors, unrecognized status-change formats and unavailable/truncated histories prevent a complete total. No completing employee is inferred from assignment.

### Pagination and totals

The history API accepts only one ticket ID equality filter, not employee/date filters or usable pagination URLs. The tool therefore searches authorized tickets created before the window ends and active since its start, with no upper activity cutoff and no current-completer filter. It retrieves each candidate's history, applies the time and actor filters locally, and classifies only the observed native status-transition grammar. Raw history detail is never exposed. Two candidates are inspected concurrently through existing shared capacity controls.

`page_size` (1–25; default 10) bounds candidate tickets, not matching tickets. An empty page can still have `next_cursor`. Continue with exactly the same arguments and cursor. Cursors are encrypted and bind the employee, mapping, scope, permissions, query, resolved references and status definitions. Expired or changed bindings require restarting.

Keep all returned pages and deduplicate tickets by ID. `returned_tickets` and `returned_completion_events` describe the current response; `matched_tickets_so_far` and `completion_events_so_far` describe the accumulated scan. Final totals are null until candidate retrieval finishes with complete, classified history evidence. If `incomplete_histories` is nonzero, the results remain partial even with no next cursor. Never turn a lower bound into an exact total or say "all" for a shortened display.

Reads are not an atomic snapshot. Scope and assignment changes detected while reading a ticket stop the operation; current access is rechecked before dispatch and before returning records. There is no new write permission, background synchronization, webhook subscription or database migration. Historical search cost scales with recently active tickets and can require many continuation calls. A persistent history index would be a separate performance enhancement, not assumed evidence in this release.

## Verification boundaries and sources

Regression tests cover native completion field queries, exclusive date filtering, status-history classification, reopening/recompletion, incomplete history and scoped pagination using offline fixtures. Prepublication provider checks informed the implementation, but their private tenant records and observations are withheld. This public snapshot does not certify access or behavior for another tenant; qualify the operations against your authorized provider configuration before use.

Sources: [Tickets API](https://webservices.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketsEntity.htm), [TicketHistory API constraints](https://autotask.net/help/developerhelp/content/apis/rest/Entities/TicketHistoryEntity.htm).
