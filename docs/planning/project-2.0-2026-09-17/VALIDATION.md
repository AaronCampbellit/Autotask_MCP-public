# Local baseline validation

Validated September 17, 2026 after the user authorized installation of any tools needed to build and test.

Source: `AaronCampbellit/Autotask_MCP@c9175fac35e9e0ce0130f3f33a192618848df261`. Runtime source and lockfile are unchanged. Archived exploratory prototypes were excluded.

| Check | Result |
| --- | --- |
| `npm ci --no-fund` | Passed; 27 packages installed, audit reported zero vulnerabilities |
| `npm run check` | Passed |
| `npm test` | 782 passed; zero failures, cancellations, or skips; 53,494 ms |
| `npm run build` | Passed |
| `node --check work/build/scripts/preflight.js` | Passed |
| `docker compose -f deploy/compose.yaml config --quiet` | Passed with fixture configuration values |
| `docker build --file deploy/Dockerfile --tag rarity-autotask-mcp:review-c9175fac .` | Passed; local candidate image only |

Local host: Node 24.19.0, npm 11.17.0, Docker 29.7.1, Docker Compose 5.4.0. The Dockerfile independently uses Node 24.21.0.

Discovery measurements reproduce the CI baseline: legacy 1,739,552 bytes; modern 1,739,729 bytes. Test-suite elapsed time is not a production latency benchmark.

Full test and container-build logs are retained in ignored `work/research/local-test-2026-09-17.log` and `work/research/local-container-build-2026-09-17.log` in this checkout. The candidate image was not published or deployed. Live provider operations and actual host Tasks/MRTR capabilities were not exercised.
