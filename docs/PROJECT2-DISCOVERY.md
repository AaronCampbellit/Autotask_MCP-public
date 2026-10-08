# Project 2.0 discovery implementation

Local implementation, September 20, 2026. Deployment and ChatGPT/Codex host acceptance are separate gates.

Published JSON schemas are converted once per immutable Zod schema identity and input/output mode, deeply frozen, and reused through weak caches. Runtime validation still uses the original Zod validator. Repeated schema fragments retain local reference compaction. Metadata ordering and digests use deterministic operation-name order.

`at_discover` is bounded (25 default, 100 maximum), supports category and effect filters, and issues encrypted 15-minute cursors. Cursors bind the complete current authorized catalog, employee, tenant, policy/mapping versions, company scope, and exact filters/page size. Every page requires a newly authorized tool list. They never grant execution permission.

One effect model distinguishes reads, local persistence, native mutations, orchestration, and cancellation. It drives annotations, search labels, and read-dispatch eligibility. Reconciliation changes local receipts, so it is a local effect. The read dispatcher refuses mutations, local effects, orchestration, cancellation and recursive dispatchers; it invokes eligible reads through the regular authorized runtime.

The existing full discovery profile remains available. The opt-in technician profile has a fixed allowlist of common ticket/time reads and typed writes, metadata helpers, and long-tail dispatchers. It does not grow based on connection browsing history. In the full-feature local fixture, the serialized metadata projection was 424,715 bytes compared with 1,806,076 bytes for full discovery (24%). This measures fixture metadata, not host context consumption or live wire performance; final wire bounds have separate tests and change as tools are added.

A bounded private metadata TTL cache utility is available for an explicit host pilot only. It remains disabled without configured host acceptance evidence and a positive TTL (maximum 60 seconds). Partition keys include employee, tenant, effective grants/company scope, policy/mapping versions, configuration version and profile. Values are copied on entry/exit, expired entries are removed and memory has an entry cap. No business-result or authorization cache is introduced. Production host TTL enablement remains pending actual host evidence; fresh execution authorization is mandatory regardless of cached metadata.

Tests cover deterministic pagination, stale/changed authorization rejection, effect agreement, recursion refusal, immutable schemas, full-validator preservation, profile size and cache partition/expiry/isolation. Existing schema reconstruction tests still prove publication compaction preserves schema constraints.
