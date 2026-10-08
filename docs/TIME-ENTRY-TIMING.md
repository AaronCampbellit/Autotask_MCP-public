# Context-aware ticket time

Deployed September 15, 2026 in `rarity-autotask-mcp:time-context-20260915`.

## Behavior

| User/context | Selected anchor | Calculation |
| --- | --- | --- |
| “Add 30 minutes to my 9am meeting” | 09:00 start on the resolved date/timezone | End 09:30 |
| “Add an hour to the meeting that just ended” | Known meeting end; otherwise current server time | Start one hour earlier |
| Calendar/Outlook meeting already retrieved | Relevant start/end from that conversation | User-requested duration takes precedence over scheduled duration |
| Duration only, no time in user input or context | Current time as assumed **end** | Start = current time minus duration |

Explicit user facts take precedence over retrieved context. Conflicting or ambiguous meetings still need resolution. The assistant should use existing meeting results rather than fetching them again solely to repeat known evidence. This does not automatically connect Outlook or let the server read chat history: the calling assistant selects the relevant anchor and passes it to the MCP.

## Tool inputs

`time_log_ticket` and shared ticket workflow time inputs accept either `start_datetime` or `end_datetime`, plus explicit minutes/date/timezone. The resolver calculates the missing timestamp. If both timestamps are supplied, their elapsed duration must equal minutes. Absolute timestamps need UTC or a numeric offset; the derived start must fall on work_date in the selected timezone. Midnight and DST crossings use elapsed instants rather than wall-clock subtraction.

Use `timing_source: user | calendar | chat | current_time` to label the anchor's source. This is caller-provided provenance, not independent calendar verification.

When no anchor exists, the calling assistant uses the read-only `time_entry_clock` tool with an IANA timezone, then passes its current instant as `end_datetime` and labels `timing_source: current_time`. Set work_date from the derived local start, which can be the previous day near midnight. An explicitly historical date must not silently receive today's timestamps. Legacy lower-level inputs and stored intents remain compatible, but new runtime time writes/validation/queued submissions require at least one anchor and reject missing anchors before any ticket lookup. Use the clock fallback when no contextual anchor exists. See [latency remediation and client refresh](TIME-ENTRY-LATENCY.md).

Capturing the clock before the write produces explicit timestamps that participate in the existing immutable input hash. Retry the same request with the original arguments/key; do not recapture now and alter an existing intent. Different input under the same key conflicts rather than moving or duplicating the entry.

## User-facing confirmation

Verified ticket time/documentation receipts include the saved start/end, local timezone, duration, timing source and calculation (`start_plus_duration`, `end_minus_duration`, or `explicit_interval`). The assistant must show that interval and any current-time assumption after saving, so the user can correct it. Unverified results must not be described as saved. An instruction to add a meeting entry does not implicitly edit an existing entry.

Example: “Logged 30 minutes, September 15, 9:00–9:30 AM Central, using your stated 9 AM start. Tell me if that interval needs correcting.”

## Verification

Strict TypeScript and the full workspace fixture/mock suite passed: 611 tests, no failures/skips/cancellations. A subsequent focused runtime suite passed 17 tests including the newly added authenticated clock check. Coverage includes start/end derivation, calendar/chat/current-time provenance, midnight/DST behavior, mismatched intervals, truthful receipts and same-key stability. The workspace contains unrelated link work; the isolated release excludes it.

Production build and server replacement succeeded; HTTPS readiness is ready. An authenticated live `time_entry_clock` call returned the server instant and America/Chicago local date. Catalog regenerated with 217 declared operations. No new time entries, calendar events, permissions or migrations were created for these examples or deployment checks.
