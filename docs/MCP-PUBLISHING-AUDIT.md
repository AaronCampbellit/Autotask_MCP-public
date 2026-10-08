# MCP publishing and update-delivery audit — September 15, 2026

## Remediation

Release `0.1.0-publication.20260915.1` explicitly disables change notifications for the stateless transport, corrects generated update/correction and workflow annotations, and adds `at_diagnostics` release and available-tool metadata fingerprint fields. Registration tests cover runtime/legacy discovery and both supported wire versions. The findings below describe the audited predecessor. Deployment verification is recorded in CURRENT-STATUS.md.

## Conclusion

Tool definitions and output contracts are being served, but deployment alone is not proof that users have refreshed metadata. The current release has a notification-capability mismatch and some inaccurate mutation annotations. This audit made no production changes and created no business records.

## Verified evidence

Deployed image: `rarity-autotask-mcp:output-contracts-20260915` (release commit `59a2ca6`). A read-only, in-process check used the deployed SDK, real runtime configuration and existing mapped principal; it did not bypass authentication on the public server.

- Both 2025-11-25 and 2026-07-28 `tools/list` responses contained 211 unique, valid tool names with meaningful object output schemas. The complete catalog has 217 tools; configuration and permissions determine visibility.
- Response size was approximately 1.95 MB. This is a measurement, not evidence of latency or a protocol violation. Pagination/metadata deduplication could reduce discovery cost if profiling justifies it.
- Existing release checks independently verified authenticated tunnel `at_describe(time_log_ticket)` and `at_invoke(time_entry_clock)` responses.
- Both deployed `initialize` and `server/discover` advertise `tools.listChanged: true` and server version `0.1.0`.
- Sample update annotations: `opportunity_update`, `asset_update`, and `time_correct` advertise `destructiveHint: false`; `ticket_update` and `at_invoke` correctly advertise true for their overwrite-capable behavior.

## Findings and required follow-up

### 1. Notification capability does not match the transport

`apps/server/src/app.ts` creates a new handler per request, uses legacy stateless mode and `maxSubscriptions: 0`, and closes the handler after the response. GET streaming is not offered. The installed SDK defaults `tools.listChanged` to true, which our server does not override.

Set this capability explicitly false for the current stateless architecture. If automatic notifications are later required for clients that support them, implement and test an authenticated persistent subscription lifecycle and tool-change invalidation. Merely calling a notification method on a request-local server is insufficient. This does not replace a host's own metadata publication workflow.

MCP defines the capability as indicating change notifications. The newer protocol sends them to subscribed clients. Authorization-dependent tool visibility is allowed. See [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools). Declining GET SSE with HTTP 405 is itself allowed by the [2025 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports); the issue is the advertised capability.

### 2. Update/overwrite annotations need correction

Review every update/correction tool, including generated families and legacy variants. Mark overwrite-capable writes accurately and add registration-level tests. OpenAI's [annotation guidance](https://developers.openai.com/plugins/deploy/submission#MCP) includes overwrites under destructive behavior. This metadata does not replace existing authorization or concurrency checks. Our closed-account `openWorldHint: false` is consistent with that guidance; external hosting alone does not require true.

### 3. Release identity does not distinguish deployments

`serverInfo.version` remains hardcoded `0.1.0`. Add a build/release identifier and advertised metadata digest to deployment diagnostics, with a test comparing the deployed manifest and expected release. A version bump is useful evidence, not a guaranteed client-cache invalidation mechanism.

### 4. Client propagation remains an unverified release step

For developer-mode ChatGPT MCP connections, the documented process is: deploy, open the connection, select Refresh, verify changed metadata, then test in a new conversation. Do this for each separate registration in use, including tunnel/direct connections. A successful `at_describe` call proves current server metadata, not replacement of the client's cached tool schema. See [OpenAI metadata refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).

Published directory plugins use reviewed snapshots: scan, submit an updated version, and publish after approval. See [published metadata versions](https://developers.openai.com/plugins/deploy/submission#how-published-mcp-metadata-versions-work). No evidence here establishes that the private pilot is a reviewed directory publication, so that path must not be presumed.

Release completion should record the connection type, refreshed metadata evidence and a representative fresh-chat test. Do not report that updates reached all users based solely on readiness, deployment, a Git push, or server-side discovery. No general server-side force-refresh mechanism for ChatGPT is established by the reviewed documentation.
