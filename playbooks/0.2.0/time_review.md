# Workday and time review

**ID:** `rarity.technician.time_review` · **Draft:** `0.2.0` · **Purpose:** show the employee's day, reconcile recorded time and identify questions requiring the employee's factual input.

**Entry conditions:** signed-in mapped employee and one concrete local date. Resolve relative dates using an authorized clock. Timezone comes from explicit input, configured employee preference, then configured workspace preference; ask if none exists. my_workday covers only the signed-in employee, not a delegated/team day. Dates and timezones are exposed in the response, including timezone_source. Date windows honor daylight-saving boundaries.

**Procedure:**

1. Use `my_workday` for assigned tickets, scheduled work, due tasks and recorded time in the requested window. For focused ticket time use `time_entry_search`; for task/internal time use `time_search` when available. Retrieve actual records, with independent completeness and date semantics for each collection. Assigned tickets are current, not their historical assignment on the requested date. Ticket, task and internal time are included only within authorized visibility. Read returned warnings.
2. Present recorded time separately from appointment duration, task estimates, ticket age and apparent calendar gaps. Scheduled work is not proof of performed work. A calendar entry with no visible time match means that no matching entry was found in the authorized retrieved scope, not that the employee failed to log time.
3. Time is selected by the native dateWorked date container, not by splitting durations at local midnight. recorded_hours is only the returned batch. Follow recorded_time.continuation using cursors.time, and likewise cursors.assigned_tickets or cursors.tasks, preserving date/timezone. Merge entries by ID before summing; do not add repeated sections or claim a tail page is a full day. Collections are not an atomic snapshot. Label totals partial if any required page is unavailable. Never infer hours from planned work.
4. Surface potential duplicates, overlaps or unmatched appointments as review findings with source links, not automatic corrections. Do not silently delete, move, shorten or reclassify time. Billing rates/costs and protected team details remain filtered from both records and summaries.
5. When the employee supplies the actual missing work, duration and target, use the relevant named time/documentation tool. Corrections require a specifically supported operation, current entry state and correction permissions. Posted/billed entries are not assumed editable; forbidden or unsupported corrections receive a clear denial/limitation and record link where authorized.
6. If preparing for the next appointment is requested, call `ticket_prepare_visit` using the exact authorized appointment/ticket. Preparation gathers evidence and does not reschedule work or log time.

**Fictitious example:** “What did I log today, and what might need review?” The assistant shows the resolved local date, verified recorded-time total and links, then flags an appointment without a matching retrieved time entry. It asks for the actual work and duration only if the employee asks to add it; it does not log the appointment's scheduled hour automatically.

## Client hours by month

For “hours spent on this client,” include ticket time and project-task time by default, shown separately. Resolve the authorized company once and preserve the exact prior reporting window for “that same period”; ask if the prior window is unavailable. Echo the company, dates and team/self scope. Team totals require time.team and must not silently become self-only totals.

Use actual hoursWorked grouped by the native dateWorked calendar month. Do not use ticket creation/completion dates, ticket counts, project lifetime totals, scheduled duration or billable hours as substitutes. Older/closed tickets and completed projects may contain work in the requested period. Deduplicate entries by ID and sum before rounding. Show ticket hours, project-task hours, combined hours and source coverage. Distinguish partial calendar months from incomplete retrieval; missing project data is unknown, not zero.

The current time tools require an individual ticket or task. No dedicated bulk monthly client-time report is currently implemented. Do not launch an unbounded ticket-by-ticket scan or claim a lower-volume query path exists without confirming it through discovery. Explain this limitation before attempting a large report. If a rate limit occurs, stop further fan-out and disclose the incomplete scope; do not automatically restart the scan through another tool. A complete combined total requires all requested sources and pages. Do not infer zero-hour months from missing or throttled data.

The planned durable bulk workflow and release acceptance gates are recorded in docs/planning/CLIENT-MONTHLY-HOURS-WORKFLOW.md. That plan is not an available tool or authorization to access additional data.

**Acceptance:** all pages contribute to a complete total or the total is explicitly partial; DST/cross-midnight entries follow stated date semantics; no time is inferred from calendar gaps; team/financial restrictions hold in aggregates; reviewing time makes no mutation. Monthly client questions distinguish ticket/project time and never conceal missing-source or rate-limit limitations.

**Local implementation review:** This version documents supported tools and their limitations. It remains proposed guidance pending Rarity business validation; reading it grants no new permissions and does not authorize a write.
