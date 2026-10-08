# September 20 candidate validation

Candidate: `0.2.0-integrations-diagnostics.20260920.1`, package `0.2.0`, branch `feat/integrations-project2-diagnostics`, based on GitHub main `efae344`. Runtime image: `rarity-autotask-mcp:integrations-diagnostics-20260920-1`; image ID `sha256:1e6a3694479653580fc936a0c4ea06e73f21e8f46c1df0c334e8dc933ec98955`. Local candidate only; no push or production deployment.

Final regression: **980 tests passed, zero failures, cancellations or skips** (`work/release-tests-final.log`, approximately 65 seconds).

## Build and boundaries

- TypeScript compilation and production Docker build pass (local Node 24.19.0; image Node 24.21.0).
- Compose validates with fixture-only settings. Console JavaScript syntax and Git whitespace checks pass.
- Compiled image runs as UID 1000 with a read-only root filesystem and no network. Both MCP protocol versions return the exact candidate identity and published-profile digest. A separate mounted volume accepts encrypted fsynced diagnostic events through simulated database failure with mode0700 ownership. This tests the local Docker volume, not the production host or crash semantics.
- Migration tests apply 017–019 and verify separate migration/runtime role privileges using PostgreSQL-compatible PGlite. No production migrations were applied.
- The generated catalog contains 320 declared operations and 170 distinct output contracts; configured/authorized publication is narrower. Full-catalog budget and schema reconstruction remain regression checks.

## Functional evidence

The suite covers current scopes and permission revocation, moved native parents, conflict checks, no replay of uncertain writes, readback mismatch versus failure, attachment URL/source/type/byte-limit evidence, provider-attempt correlation, pre-SDK rejection, nested/background calls, database/spool failures, lease recovery, expiry, stale-projection filtering, and console audit authorization.

Real HTTP tests cover incremental progress, disconnects, backpressure, stream size/deadlines, retained admission while accepted writes verify, cancellation of subsequent ordinary reads, and the actual SDK MRTR input-required/resume/replay path. Modern Tasks routing remains disabled after direct evidence that the installed SDK does not serve its methods.

Real Chromium tests exercise the console through loopback HTTP: login → IT Glue credentials → native mapping verification → read enablement; and login → diagnostics list → detail → audited sanitized clipboard export. Desktop and mobile screenshots and test scripts remain in local `work/qa/`. No browser errors were observed. All provider credentials and data in these checks are fixtures.

## Performance evidence

[Before/after Project 2.0 JSON and method](project2-baseline/README.md) cover seven scenarios across both protocols. New RMM/report/write scenarios explicitly have no historical baseline. The isolated RMM cache regression measures five versus eleven RMM reads while retaining current ownership checks. Small local samples do not establish production latency or model-turn savings.

[Controlled diagnostic benchmark](diagnostics-validation/BENCHMARK.md) uses 270 measured requests plus warmups with a local HTTP provider. Memory-sink overhead is modest in this run; fsync fallback adds substantial latency. PostgreSQL/WAL, production concurrency/storage, actual ChatGPT/Codex hosts and backup deletion remain unqualified. No durability acknowledgment was weakened to improve the benchmark.

## Reproduce

```sh
npm run check
node_modules/.bin/tsx --test --test-concurrency=4 tests/*.test.ts
npm run build
node_modules/.bin/tsx scripts/export-tool-catalog.ts
docker build --file deploy/Dockerfile --tag rarity-autotask-mcp:integrations-diagnostics-20260920-1 .
```

Local evidence logs: `work/release-tests-final.log`, `work/release-build.log`, `work/release-image-build.log`, `work/release-image-smoke.log`, `work/final-compose.log`. The [implementation ledger](IMPLEMENTATION-PROGRESS-2026-09-20.md) records outstanding external release gates.
