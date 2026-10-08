# Historical uncertain ticket-time investigation — September 15, 2026

## Evidence boundary

This summary preserves the technical conclusions of the original private
investigation. Journal UUIDs, request keys, ticket/employee/role/time-entry IDs,
exact meeting intervals and summaries, customer details and deployment receipts
are withheld. Original live requests and observations are not relabeled as
synthetic tests. Historical uncertain receipts were not manually rewritten.

## Initial uncertainty and diagnostic defect

An initial time-entry attempt retained `unknown_outcome` without a native saved ID
or detailed upstream category. A later complete own-time query did not show the
entry, but caller visibility alone could neither reconstruct the dispatch nor
prove that no hidden native record existed. The missing original response left
the historical cause unresolved. No automatic retry was justified.

The adapter already treated timeouts, transport failures, unexpected HTTP status,
malformed responses and unusable create IDs conservatively. The workflow discarded
the finite category, making the retained receipt less useful for diagnosis.
The correction persisted `timeout`, `transport_failure`, `http_error`,
`invalid_response` or `missing_record_id` with an observed integer HTTP status.
The redactor accepts only those categories and status values from 100 to 599;
raw response bodies, URLs, headers and exception messages remain excluded.
No-retry handling and same-key deduplication were preserved. Old receipts cannot
be backfilled from evidence that was never retained.

## Later confirmed mechanism

Subsequent user-authorized investigation captured the provider's specific
start/stop-required rejection. Paired start/end timestamps were missing from the
payload. A role mismatch was investigated as a possible contributor, but later
success with unchanged role/work-type selections did not support it as the cause
of this entry's rejection.

The correction added paired timestamp inputs, strict duration/local-date checks,
native serialization and timestamp readback. Only the exact reviewed rejection
maps to an actionable `invalid_input` / `start_stop_required` receipt; unrelated
HTTP errors remain uncertain, and arbitrary error bodies are not persisted.
The original record described a user-authorized save with matching independent
readback. Its private receipt is withheld; publishing this summary does not
create, verify or alter a current native entry.

## Historical local validation

- The diagnostic correction passed strict TypeScript checking and **600 fixture/mock
  tests**, including the five failure categories, one dispatch, same-key retrieval
  and rejection of untrusted diagnostic fields.
- The paired-interval correction passed strict TypeScript checking and **609
  fixture/mock tests**, including offset/DST instants, incomplete/reversed/mismatched
  intervals, native serialization, narrow rejection classification, timestamp
  verification and duplicate protection.

These combined working-tree totals included other in-progress tests; they are not
new tests added by this incident alone or acceptance of every provider workflow.
Private deployment observations and saved business records are withheld. Do not
repeat an uncertain operation with a new key based on an empty later query.
See [readback analysis](TIME-READBACK-2026-09-15.md), [current source status](CURRENT-STATUS.md)
and [historical verification](VERIFICATION.md).
