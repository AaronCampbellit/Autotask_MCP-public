# Workday and time review

**ID:** `rarity.technician.time_review` · **Draft:** `0.1.0` · **Purpose:** show the employee's day, reconcile recorded time and identify questions requiring the employee's factual input.

**Entry conditions:** signed-in mapped employee, concrete date/range and timezone. A team/delegated review requires its own capability and exact scope. Dates and timezones are exposed in the response, including daylight-saving offsets where relevant.

**Procedure:**

1. Use `my_workday` for assigned tickets, scheduled work, due tasks and recorded time in the requested window. For a focused time query, use `time_entry_search`. Retrieve actual records, with independent completeness and date semantics for each collection.
2. Present recorded time separately from appointment duration, task estimates, ticket age and apparent calendar gaps. Scheduled work is not proof of performed work. A calendar entry with no visible time match means that no matching entry was found in the authorized retrieved scope, not that the employee failed to log time.
3. Group actual entries by local date and work reference; explain overlap, cross-midnight allocation and rounding rules only when the configured report supports them. Label any total partial when required pages or permitted categories remain unavailable. Do not extrapolate daily totals from a page.
4. Surface potential duplicates, overlaps or unmatched appointments as review findings with source links, not automatic corrections. Do not silently delete, move, shorten or reclassify time. Billing rates/costs and protected team details remain filtered from both records and summaries.
5. When the employee supplies the actual missing work, duration and target, use the relevant named time/documentation tool. Corrections require a specifically supported operation, current entry state and correction permissions. Posted/billed entries are not assumed editable; forbidden or unsupported corrections receive a clear denial/limitation and record link where authorized.
6. If preparing for the next appointment is requested, call `ticket_prepare_visit` using the exact authorized appointment/ticket. Preparation gathers evidence and does not reschedule work or log time.

**Fictitious example:** “What did I log today, and what might need review?” The assistant shows the resolved local date, verified recorded-time total and links, then flags an appointment without a matching retrieved time entry. It asks for the actual work and duration only if the employee asks to add it; it does not log the appointment's scheduled hour automatically.

**Acceptance:** all pages contribute to a complete total or the total is explicitly partial; DST/cross-midnight entries follow stated date semantics; no time is inferred from calendar gaps; team/financial restrictions hold in aggregates; reviewing time makes no mutation.
