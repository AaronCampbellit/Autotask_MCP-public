# Historical time-entry readback incident — September 15, 2026

## Evidence boundary

This technical summary describes the original private investigation. Customer,
user, ticket/time-entry identifiers, exact work intervals, role selections and
live deployment receipts are withheld. The original provider observations were
live observations; they are not represented as fictional fixture results. No
entry was recreated or edited merely to investigate its readback.

## Mechanism

Two independent defects affected verification of an accepted time entry:

1. A native `internalNotes` value was null, while the shared output contract
   accepted only string or absence. An authenticated read reproduced
   `output_contract_error` at `data.internalNotes`.
2. Saved start/end instants differed from the frozen intent by a sub-second shift.
   Both endpoints shifted together and duration was unchanged. Strict readback
   correctly kept the operation `accepted_unverified`; one observed mismatch
   does not establish a universal provider rounding rule.

## Correction

The shared time-record schema permits null summary/internal notes while rejecting
non-string, non-null values. `time_entry_clock` produces whole-second anchors for
future current-time fallback entries, and its metadata describes that precision.
Explicit user/calendar timestamps and exact instant comparison remain unchanged.
No undocumented tolerance was introduced, and old intents or saved entries were
not rewritten.

A successful read establishes that a saved entry exists; it does not prove an
exact match to an older frozen intent. Presentation should use the user's chosen
timezone and disclose timing assumptions without rewriting historical provenance.

## Historical validation and limits

Recorded local verification passed **628 tests** and strict TypeScript checks.
Regression coverage exercised nullable native records through both SDK protocol
versions, rejected numeric note values, and checked whole-second clock anchors,
exact durations and strict saved-ID readback. Existing summary/resource/duration
checks remained in place.

The original private record also described authenticated read-only verification
of the already-saved entry. Its identifying receipts and deployment details are
withheld. This public summary does not verify a current deployment or authorize
another create. Unknown or accepted-unverified writes retain their original
recovery requirements. See [current source status](CURRENT-STATUS.md) and the
[verification boundary](VERIFICATION.md).
