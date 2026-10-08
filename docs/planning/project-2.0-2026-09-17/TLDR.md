# Autotask MCP Project 2.0 — TLDR

Publication note: this historical assessment names revisions, file line numbers,
and CI records from the original private development repository. The public
source snapshot starts with fresh history; those records are retained as
provenance and are not publicly accessible validation links.

Research date: September 17, 2026. Planning only.

**You already have a real MCP SDK 2.0 server. The next step is to make it a faster, more capable investigation and workflow service. An SDK migration is not the main job.**

I reviewed GitHub commit `c9175fac` (private development commit), traced the application’s transport and execution paths, inspected the exact locked SDK packages, and checked current official documentation. The commit’s GitHub Actions run `35271662839` (private development history) passed **782 tests**. A subsequent [local validation](VALIDATION.md) also passed all 782 tests, typechecking, compilation, Compose validation, and the container build. This review did not benchmark production or exercise live business operations.

## What needs the most attention

1. **Discovery is too expensive to keep growing indefinitely.** The 281-operation catalog produces a **1,739,729-byte** modern discovery result in CI. There is already schema compaction, but every available tool is still registered for every request. Introduce a smaller, stable technician profile, keep common writes directly typed, and provide controlled discovery for less-used operations. Measure actual host behavior before changing the default.
2. **Modern execution context is not wired through.** Tool handlers discard the SDK callback context. Cancellation does not flow through the application into provider requests, and the response wrapper buffers the entire result. This blocks useful live progress and complicates long operations.
3. **Measure where time goes.** There are audit records and request-budget counters, but no end-to-end tracing through authentication, queues, providers, validation, and serialization. This is the first implementation milestone and the way to assess whether newer hardware would help.
4. **Reduce repeated reads and run independent reads concurrently.** Ticket collections and RMM composites contain sequential calls and repeated device/site lookups. Reuse evidence within one authorized read operation; preserve fresh checks at write boundaries. Existing scheduler guards deliberately reject some nested parallel work, so a blanket `Promise.all` rewrite would be wrong.
5. **Build better investigation tools.** Start with `ticket_investigate` and `client_overview`, using existing ticket-to-device mappings. Return compact evidence, relevant alerts/tickets, timestamps, gaps, and continuations. Add IT Glue documents later through verified organization mappings.
6. **Make long work durable and interactive.** Adapt the existing job infrastructure for read/report workloads and the official Tasks extension. Add MRTR clarification where supported. Both need real client compatibility tests and an ordinary tool fallback.

## Features already done well

Structured output and output validation; scoped identities and read/write permissions; native IDs; guarded write workflows; encrypted journals; stable request keys; uncertainty-aware receipts; API budgets; dual modern/legacy protocol support; schema compaction and discovery-size tests.

These are foundations to retain. “More v2 features” must not remove them.

## Recommended delivery order

| Release milestone | User-visible outcome |
| --- | --- |
| A — Measure and verify | Reliable compatibility matrix, latency baseline, traces, and reproducible technician scenarios |
| B — Make common work faster | Smaller discovery, private cache hints, fewer repeated reads, bounded parallel retrieval |
| C — Improve answers | One-call ticket/client investigations with compact, traceable, partial-aware evidence |
| D — Handle long/interactive work | Durable reports, task status, useful progress, cancellation, and supported clarification flows |
| E — Add knowledge | Read-only IT Glue integration and correlated documentation |

Proposed success targets include a **50% smaller default discovery payload**, **30% lower p95 latency on selected read scenarios**, and **30% fewer provider calls** on targeted composites. These are targets to validate against the baseline, not measured gains.

**My first implementation choice:** tracing and compatibility tests, followed by a measured `rmm_ticket_context` optimization and a smaller discovery pilot. Deliver those before expanding the catalog again.

Read the [deep dive and implementation plan](PLAN.md) for findings, architecture, work packages, acceptance tests, dependencies, and rollout criteria. The [evidence register](EVIDENCE.md) ties the findings to immutable code and official sources.
