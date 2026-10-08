# Read reuse, caching and investigations

The RMM ticket-context fixture now uses **5 provider reads instead of 11** for the same verified device and alert evidence. A request-local cache shares repeated device/site observations within the read stage. Device summary and alert reads may overlap; the final ticket/device/company association check bypasses the cache. A moved-device fixture still fails closed. Native writes do not enter this stage cache.

`ScopedReadCache` provides bounded entry count, serialized byte size and in-flight reads, TTL, LRU eviction, rejected-loader cleanup, invalidation and equivalent-read coalescing. Keys bind actor, resource, tenant, authorization scope, mapping/policy versions, connection/version, entity and arguments. Every consumer checks authorization before and after reading, including cache hits. One canceled waiter does not cancel another waiter's shared provider request. An invalidated or expired in-flight load cannot repopulate current entries.

RMM site-filter dictionaries use the shared cache for 60 seconds, while current native site/company mapping and current principal checks still execute for every caller. Responses preserve the original fetch timestamp and expose cache age/hit metadata. Provider observations do not become live health claims. Mutable pre-write state and component approval checks are not shared-cache candidates.

Three read-only tools assemble deterministic investigation sections:

- `ticket_investigate`: ticket evidence and optionally provider environment context, with final ticket/company/asset association checks.
- `client_overview`: scoped open-ticket evidence and optionally bounded provider inventory comparison.
- `device_investigate`: an exact RMM device's summary, audit, alerts and optional software, with fresh final device/site verification.

Sections are selectable; summary/detail modes retain independent completeness, source provenance, continuation handles and exact primitive drill-down arguments. Summary mode bounds arrays and text; each section has a 160 KB evidence ceiling. Missing metadata or unavailable dependencies produce explicit unavailable sections, while ownership, permission and revocation failures fail closed. No automatic name matching, mapping changes or remediation occurs.

Autotask primitive workflows retain their existing scheduler ownership and execute sequentially inside the investigation wrapper. Parallelism is limited to the specifically reviewed RMM read stage. Caches remain process-local and do not establish multi-replica rate coordination.

Tests measure the 11-to-5 RMM reduction, fresh moved-device checks, dictionary load reduction, TTL/eviction, independent cancellation, version isolation, late-loader invalidation, in-flight bounds and all three investigation contracts against real runtime primitives. These fixtures establish local behavior; real-host and deployment acceptance remain separate.
