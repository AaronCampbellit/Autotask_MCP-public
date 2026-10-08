# Dependency and runtime baseline

Direct package versions are pinned in [package.json](../package.json), with resolved transitive versions and integrity data in [package-lock.json](../package-lock.json). This is the September 10, 2026 implementation baseline, not a promise that the selected packages remain the latest or free from future advisories.

| Component | Pinned version | Purpose | Package-declared license |
| --- | --- | --- | --- |
| `@modelcontextprotocol/server` | 2.0.0 | Official MCP server and HTTP handler | MIT |
| `jose` | 6.2.12 | JWT/JWKS validation | MIT |
| `pg` | 8.23.0 | PostgreSQL connection pool | MIT |
| `zod` | 4.6.2 | Validated tool contracts | MIT |
| `@electric-sql/pglite` | 0.5.8 | In-memory PostgreSQL engine for SQL tests | Apache-2.0 |
| `@types/node` | 22.20.2 | Node type declarations used by this build | MIT |
| `@types/pg` | 8.23.1 | PostgreSQL driver type declarations | MIT |
| `tsx` | 4.23.13 | Development/test TypeScript execution | MIT |
| `typescript` | 7.0.2 | Type checking and build | Apache-2.0 |

Version/license values were inspected from the installed package metadata. This is direct-dependency documentation, not a completed transitive license/security assessment. The Node declaration package is a Node 22 API baseline; the actual runtime baseline is Node 24. Revisit the declarations with the normal dependency update cycle.

The installed official server README identifies v2 as its stable release line and the 2026-07-28 MCP specification. The implementation uses the official v2 server package with bounded native Node streaming ingress for modern JSON and legacy SSE responses. The separate SDK Node helper is not a dependency. References: [official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk), [v2 serving documentation](https://ts.sdk.modelcontextprotocol.io/v2/serving/http), and [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28). Actual target-client compatibility must still be measured; an SDK dependency does not prove Codex/ChatGPT/Claude interoperability.

## Runtime and install paths

The package engine accepts `>=24.16.0 <25`. The original Windows checks used Node 24.16.0; current Docker development and deployment use Node 24.21.0 Bookworm slim. Container build/readiness evidence is recorded in [current status](CURRENT-STATUS.md). Pin an image digest and establish the upgrade owner during deployment qualification.

Windows [bootstrap.ps1](../scripts/bootstrap.ps1) copies the root package manifests into `work/runtime`, runs `npm ci` there with cache in `work/npm-cache`, and connects root module resolution through a `node_modules` junction. The root lockfile remains authoritative. The script never deletes or replaces an existing user-owned `node_modules` directory or a junction to another target. Native command failures stop the script.

The Windows bootstrap executed successfully on September 10 after a previously blocked attempt. It installed the locked dependency tree under `work/runtime` and preserved the matching junction. No execution-policy or security-control bypass was used. The compiled fixture smoke check is reproducible with `scripts/smoke.ps1`; it stores temporary output in `work` and stops its own server.

Container installs use `/app/node_modules` in isolated image stages. The build stage installs the locked full toolchain and compiles to `/app/work/build`. The runtime stage contains production dependencies, compiled application/packages/scripts, console assets, playbooks, registry data and the full SQL migration set (001–016 as of September 17). It does not contain local `.env` files, fixture credentials, the Windows junction, npm caches or the planning source corpus.

## Update and release work

For dependency changes, update the root manifest/lock together, repeat type/build/tests, and test affected transport/auth/SQL behavior. Keep compatibility evidence separate from installation success. A production release still needs transitive vulnerability/license review, supported-client checks, real PostgreSQL and container verification, a rollback path, and an assigned maintenance owner.
