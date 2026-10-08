# Historical ticket-time latency investigation — September 15, 2026

## Evidence boundary

The original investigation used private live tickets, journal receipts, screenshots
and read-only profiling. Customer headings, contact content, native and third-party
record IDs, exact work intervals, meeting narratives and deployment identifiers
are withheld. Original live observations remain historical observations, not
synthetic benchmarks or current public-release acceptance.

## Mechanisms found

A registered client's named time-entry tool lacked the paired timestamp fields that
the server exposed through authenticated `at_describe`. The mismatch was consistent
with a duration-only rejection, but the missing original client trace prevented
proof of the full routing sequence. A server update alone did not prove that the
existing client registration was refreshed.

Read-only profiling showed repeated scoped ticket/metadata reads within preflight.
The profiler prohibited non-query upstream POST requests and measured validation,
not a new live create. Journal elapsed excluded earlier resolution, other tool
calls and client/model processing, so it could not explain the entire chat turn.
A separate user-supplied third-party workflow was an uncontrolled comparison; it
did not prove equivalent native traffic, cache behavior or verification semantics.
Third-party ticket IDs and native Autotask IDs remain distinct namespaces.

## Remediation

- Explicit native ticket context avoids redundant technician resolution, while the
  destination workflow still resolves and authorizes the actual ticket.
- `ticketWorkMetadata` supplies one scoped parent snapshot within a validation
  stage. It does not cache mutable tickets across requests or security boundaries.
- Preparation reuses baseline metadata. After queue admission, a fresh scoped
  snapshot is checked for parent/default drift and passed to eligibility validation.
- Creates retain final identity, budget, metadata/eligibility and expiry checks,
  durable same-key journaling, uncertain-outcome handling and saved-ID verification.
- Missing start/end anchors are rejected before lookup, preflight or journal
  reservation, including generic validation/invocation and queued submissions.
  Errors identify `start_datetime`, `end_datetime` and `timing_source` recovery.
  Previously stored intents retain their original recovery paths.
- A verified write receipt is ordinary completion evidence. Additional lookup is
  appropriate when evidence is incomplete or a separate question requires it.

## Historical measurements and regression evidence

A limited read-only cold/warm comparison recorded these aggregate request counts:

| Preflight sample | Before | After |
| --- | ---: | ---: |
| Cold upstream requests | 14 | 8 |
| Warm upstream requests | 9 | 3 |
| Ticket GETs per preflight | 9 | 3 |

These were single samples against private records. The underlying private receipts
and workload identifiers are withheld; the table is neither a reproducible public
benchmark nor an end-to-end chat or live-write performance qualification.

Strict TypeScript checking and **615 fixture/mock tests** passed in the original
combined working tree. New cases asserted cold/warm parent-read counts, ticket
movement/default drift rejection, no lookup/journal for stale timing input and
exact-duration generic-wrapper recovery. Existing queue, budget, scope, expiry,
saved-ID and duplicate/uncertain-outcome checks remained intact.

Clients can retain stale registered schemas; refresh or re-register according to
that client's supported procedure and inspect the exposed fields. The historical
record did not complete client-refresh or end-to-end acceptance. A missing-anchor
error before dispatch does not authorize replay of an earlier uncertain operation
under a new request key. See [current source status](CURRENT-STATUS.md) and
[historical verification](VERIFICATION.md) for current evidence limits.
