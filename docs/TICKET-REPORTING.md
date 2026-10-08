# Ticket filtering and sorting

`ticket_search` and ticket-scoped `at_query` allow `page_size` up to 500. `ticket_search` retains its smaller interactive default of 25. Other reviewed query entities retain their 100-record limit. Continue with the returned cursor and identical filters to retrieve additional pages.

`ticket_search` and `ticket_count` can filter on native `ticket_type_id`, creation date, current status, company scope, queue, employee, and other reviewed search fields. A creation window has an inclusive start and exclusive end, requires explicit UTC offsets, and may span up to 366 days. `ticket_count` counts native filters only; it cannot count a report's title exclusion.

`ticket_workload_report` reuses `ticket_search` with its authorization and source filters. It defaults to 500 records per page and reads at most ten pages. It then applies `exclude_title_contains` to the retrieved ticket titles, groups the survivors, and sorts `records` by up to three `sort_by` fields. The exclusion is case-insensitive and applies only to `title`. It does not classify tickets by notes, description, vendor, or integration. `ticketType` is a native numeric picklist value; the report groups and sorts that value, not a display label. Missing sort values go last, and ID breaks ties.

Example for tickets created in 2026 through September 25 in the America/Chicago calendar, excluding titles containing `ThreatLocker`:

```json
{
  "filters": {
    "created_window": {
      "start": "2026-01-01T00:00:00-06:00",
      "end": "2026-09-26T00:00:00-05:00"
    },
    "page_size": 500
  },
  "exclude_title_contains": "ThreatLocker",
  "group_by": "ticketType",
  "sort_by": [
    { "field": "ticketType", "direction": "asc" },
    { "field": "companyID", "direction": "asc" },
    { "field": "createDate", "direction": "asc" }
  ],
  "max_pages": 10
}
```

Only authorized companies are included when no company filter is supplied. A report is globally sorted only if `completeness.complete` is true. If a result is partial, `records`, group counts, and sort order describe only the retrieved subset. `scanned_records` and `excluded_records` explain the local exclusion; source tickets can change while pages are read, so the result is not an atomic snapshot. This bounded report does not yet create a durable export or an Excel file.
