# Shared request capacity

> Current-status note (2026-09-14): this document contains earlier design or test snapshots. For current implementation and deployment distinctions, start with [CURRENT-STATUS.md](CURRENT-STATUS.md). Historical test results remain evidence for their stated revision only.

The local capacity foundation now separates request concurrency from a shared rolling request budget. The existing scheduler bounds concurrent work across adapters and employees. `SharedRequestBudget` additionally limits total admitted HTTP attempts for the configured tenant/Autotask database and reduces available capacity using a fresh, reviewed ThresholdInformation observation. Every real retry, pagination request, metadata/threshold request made by a future collector, parent-scope read and verification read needs its own admission.

No tenant request allowance is hardcoded. An absent live configuration selects `ClosedRequestBudget`; an explicitly selected fixture simulator may use `FixtureUnlimitedRequestBudget`. Documentary registry coverage, an authenticated user and a positive threshold observation do not themselves qualify an operation.

## Configuration

The production factory constructs one shared instance and passes the same `RequestBudgetPort` to the base, technician and scheduling HTTP adapters. Configure these values together:

| Variable | Constraint |
| --- | --- |
| `AUTOTASK_REQUESTS_PER_WINDOW` | Reviewed local share, integer 1–1,000,000 |
| `AUTOTASK_BUDGET_WINDOW_MS` | Reviewed rolling window, integer 1–86,400,000 ms; must match the observed threshold window |
| `AUTOTASK_EXTERNAL_HEADROOM` | Reserved unused capacity for other integrations, integer 1–1,000,000 requests |
| `AUTOTASK_THRESHOLD_MAX_AGE_MS` | Capture freshness, integer 1–300,000 ms and no longer than the budget window |
| `AUTOTASK_THRESHOLD_PATH` | Fixed server-owned path to the reviewed local threshold envelope |
| `AUTOTASK_BUDGET_MAX_WAIT_MS` | Optional budget queue deadline, 0–60,000 ms; default 0 rejects immediately when full |
| `AUTOTASK_BUDGET_QUEUE_SIZE` | Optional waiting request bound, 0–1,000; default 100 |

The numeric bounds above are local configuration constraints, not claimed Autotask tenant limits. Determine actual allowance, window and operating headroom from reviewed tenant evidence and a controlled pilot. Blank environment strings count as absent. Partial configuration, including only a threshold path or queue setting, is rejected.

## Trusted threshold file

`LocalThresholdProvider` reads a fixed path; it makes no network request and assumes no native ThresholdInformation URL or response schema. An authorized collector/operator normalizes and reviews a capture using this strict envelope:

```json
{
  "schemaVersion": 1,
  "observation": {
    "tenantId": "reviewed-tenant-id",
    "source": "ThresholdInformation",
    "observedAt": "2026-09-10T12:00:00.000Z",
    "expiresAt": "2026-09-10T12:00:30.000Z",
    "windowMs": 60000,
    "limit": 1000,
    "used": 600,
    "evidenceReference": "reviewed-threshold-capture-identifier"
  },
  "evidence": {
    "path": "work/threshold/capture.json",
    "sha256": "64-lowercase-hex-digits-from-the-captured-file"
  }
}
```

The numbers and identifiers shown are illustrative, not a tenant allowance, approval or valid live capture. `limit` and `used` describe the reviewed database-wide window; the observation must name the configured tenant and window. The evidence path is relative to the configured evidence root. Credentials, request headers, record bodies and query secrets do not belong in this artifact.

Before publishing the envelope, place its immutable source file beneath the evidence root and calculate its SHA-256. File references cannot escape through absolute paths, traversal or symlinks. The envelope is limited to 64 KiB and evidence to 2 MiB. File modification times cannot predate the stated capture by more than one second or lie more than one second in the future. Timestamps and hashes provide consistency checks; they do not prove that a tenant response or the operator's normalized interpretation is truthful. This is a server-owned review boundary, never MCP tool input.

The provider validates and hash-checks replacements at most 30 seconds apart and coalesces concurrent loads. A corrupt/missing replacement invalidates the observation and rejects waiting work after the refresh deadline; it does not fall back to the previous capture. Queued waits are split at the refresh deadline, so a long budget wait cannot bypass file refresh. `validate()` checks local evidence without consuming a request. It does not query Autotask. A future deployed collector is still required to keep the file current; simply touching a stale file does not renew its observation.

## Admission and accounting

For each request, the limiter applies both constraints:

1. Count this process's admitted attempts inside its rolling configured window. The count must remain below `requestsPerWindow`.
2. Start from the observed global limit, subtract the observed global usage, reserved external headroom and this process's attempts since that observation. The result must leave at least one request available.

Requests at the same millisecond as a capture are counted conservatively because their ordering cannot be established. A new observation never resets local rolling usage. Accounting has no refund: a permit followed by a failed authorization or preflight still consumes local allowance. Failed HTTP attempts and safe read retries also consume allowance. Mutations gain no automatic retry from the budget.

The intended adapter sequence is: acquire the existing concurrency slot; check identity; await budget admission; refresh operation-specific metadata and date/period eligibility; recheck authoritative identity and current controls; run immediate freshness checks; send the HTTP request. A queue wait is never an authorization grant. Readback is a separate request and may itself be throttled; the operation journal must retain a truthful unverified/uncertain receipt instead of reporting successful verification.

The budget queue preserves FIFO ordering within an actor and serves waiting actors according to their least recent turn. It has explicit length, deadline and cancellation bounds. Missing, stale or invalid observations reject work before HTTP dispatch. Clock regression invalidates the observation. Timers are only needed while requests wait and are cleared when the queue empties or the limiter closes. `status()` returns safe counts, age, limits and the current blocking reason; it contains no actor identities, credentials, paths or request bodies.

## Capacity limits still requiring deployment work

ThresholdInformation is an observation of shared pressure, not an atomic capacity reservation across other integrations. Other clients can consume capacity after a capture. The local headroom reduces that risk but does not guarantee a global slot. Native throttling and bounded safe-read retry handling remain necessary.

This implementation coordinates one application process. All adapters in that process must share one limiter for the same database. Its local rolling history is not durable across restarts and is not coordinated across replicas. Run one application instance for the first pilot, capture fresh threshold evidence when restarting, and qualify conservative headroom. Multiple replicas require a shared durable admission store or a strictly partitioned reviewed budget before enabling them. The current implementation does not claim a distributed reservation guarantee.

Attachment byte quotas, endpoint-specific concurrency, long-job resource limits and future collector traffic remain separate budgets. This request limiter does not infer or satisfy them. Record calls per workflow, queue time, p95/p99 latency, actual 429s and readback completion during the designated-record pilot. Do not intentionally exhaust production quota to measure the limit.

## Local evidence

```powershell
npx tsx --test tests/request-budget.test.ts tests/autotask.test.ts
npm run check
```

The deterministic tests simulate 20 active actors and record outputs under `work/budget-tests`:

| Scenario | Simulated evidence |
| --- | --- |
| Mixed burst | 80 physical attempts across 20 actors, including 15 readbacks and 5 safe-read retries; at most 20 admissions in each 1-second rolling window |
| Heavy actor fairness | One actor queues 20 requests alongside 19 peers; every peer receives a turn within 10 virtual seconds at a 2-request/second test allowance |
| Sustained load | 4,800 attempted requests over 60 virtual seconds; 1,800 admitted and 3,000 denied under changing outside usage; 20 actors; no configured local rolling-window overflow |
| Failure checks | Missing/stale/foreign observations, queue overflow, cancellation, deadlines, clock regression, changed files and invalid configuration reject safely |
| HTTP integration | Every safe-read retry is charged; budget exhaustion prevents the mutation fetch; identity and date eligibility are checked after a budget wait |

`burst-results.json` includes simulated workflow completion latency and queue metrics. `soak-results.json` reports admitted/rejected counts and outside-pressure assumptions. These are simulator results, not native throughput measurements or production qualification. Existing adapter tests separately exercise the shared four-request global/two-request-per-actor concurrency bound with 20 principals. The real 20-staff, mixed-workflow and client acceptance gates remain subject to controlled tenant qualification.
