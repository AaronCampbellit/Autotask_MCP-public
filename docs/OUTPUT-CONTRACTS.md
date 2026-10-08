# MCP output contracts

## Scope and release status

`autotask-output-v1` declares output contracts for all declared tools in [the generated catalog](TOOL-CATALOG.json), including optional/generated business, sales, work-management, checklist and legacy registrations. Deployed on September 15, 2026 as `rarity-autotask-mcp:output-contracts-20260915`, preserving the previously deployed timing/read-consolidation changes. Output-contract validation is separate from performance evidence.

Output schemas describe and validate response data. They do not reduce upstream ticket reads or establish faster time-entry workflows, native permissions, successful reconciliation, or calendar accuracy.

## Source of truth

- `packages/output-contracts/src/common.ts`: shared pages, provenance, records, collections, metadata, write states, errors, artifacts and time receipts.
- `apps/server/src/output-contracts.ts`: explicit named contracts and generated mappings. Business/sales record fields reuse the domain's reviewed inventories. No unknown-tool fallback is provided; missing mappings fail registration/catalog generation.
- `apps/server/src/output-validation.ts`: validates the existing JSON wire representation without applying Zod defaults or stripping extension fields. PostgreSQL Date instances and undefined optional JS properties serialize exactly as before.
- `apps/server/src/tool-runtime.ts`: attaches output schemas to every assembled tool; validates the selected operation, including calls through `at_invoke`.
- `apps/server/src/app.ts`: passes schemas to installed SDK `registerTool`, including legacy registrations, and preserves both `structuredContent` and its JSON text copy.

Shared schemas have typed, required response structure. Native record projections use the existing finite field lists; tenant-specific nullable/picklist scalars remain scalar unions. Metadata dictionaries and JSON Schema documents intentionally have dynamic keys. Extension fields remain compatible, but missing required fields, invalid states, incorrect identifier types and invalid verification evidence are rejected. Output schemas do not replace authorization or record projection.

## Outcomes and time fields

Normal write receipts preserve `ready`, `dispatching`, `accepted_unverified`, `succeeded_verified`, `failed`, `partial` and `unknown_outcome`. A complete tool invocation is not equivalent to a successful business write. Inspect the journal status and each workflow step; never reinterpret an unknown outcome as success or repeat it with a new key.

For `time_log_ticket`, verified success requires:

- `status: succeeded_verified`
- `data.ticket_id`: native Autotask ticket ID
- `data.time_entry_id`: saved native TimeEntry ID
- `data.verification.performed: true`

When available, `data.start_datetime`, `data.end_datetime`, `data.timezone`, `data.work_date`, `data.hours_worked`, `data.timing_source` and `data.timing_basis` expose the stored interval, duration and supplied provenance. Hours retain full precision (22 minutes is 22/60 hours). Start/end are instants; the timezone supplies local presentation. Legacy receipts without those fields remain valid; neither the schema nor the response formatter invents values. Read tools retain native time field names such as `id`, `startDateTime`, `endDateTime` and `hoursWorked`.

Task/internal time receipts retain their supported saved-ID/verification fields; they currently do not expose every timing field in their journal receipts. `time_get` can provide native saved fields with the existing authorization checks. This work does not silently add inferred timing to those receipts.

Generated CRM/business/sales verified receipts require their native ID, entity/action and `verified: true`. Write-only inventory commands may legitimately remain accepted-unverified without a native ID. Multipart ticket workflows retain separate step IDs and states; saved note/time effects must not be recreated after a partial or uncertain root result.

## Specification and installed SDK

Reviewed [MCP 2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#output-schema) and [MCP 2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema), plus the installed `@modelcontextprotocol/server` 2.0.0 implementation (`validateToolOutput`, `standardSchemaToJsonSchema`, and wire result projection).

The SDK validates non-error `structuredContent` against the registered output schema. It skips normal output validation for `isError` results. Our application validates its own error envelopes explicitly and includes them in every advertised contract. SDK/protocol-level failures (for example invalid inputs before a handler) can still be text-only error results; callers must check `isError` before requiring structured content. We do not alter SDK protocol errors.

All advertised roots are object-shaped, including unions. Both supported wire versions preserve the existing object response instead of introducing an extra `{result: ...}` wrapper. Serialized JSON text is preserved alongside structured data.

## Compatibility changes

1. Tool definitions gain `outputSchema`; existing names and input schemas remain intact.
2. `at_describe` additionally returns `output_schema` and `output_schema_version`.
3. A malformed service response now produces `isError: true` with `status: output_contract_error`, a sanitized error, `safe_to_redispatch: false`, and the operation ID when available. `observed_status` is unvalidated diagnostic context, not proof of success. This error describes a response defect, not whether a dispatched business effect occurred; inspect the existing journal.
4. An uncaught `AppError` with `unknown_outcome` retains that status in the structured error instead of being mislabeled `failed`. Its error code and no-retry semantics remain available.
5. Generated catalog format is `runtime-catalog-v2`. Existing operation name/effect/capability fields remain; each operation adds a contract version and content-addressed `output_contract_id`. Look that ID up in `output_contracts` and validate against the resulting standalone JSON Schema document. Its local `$defs` references belong to that document, not to the enclosing catalog.

## Adding or changing a tool

1. Inspect actual responses and all outcome paths before choosing a schema. Reuse a shared family, extend it for supported fields, or add an explicit contract. Never add an unrestricted root object to suppress a client warning.
2. Add the mapping in `output-contracts.ts`. Generated business/sales operations reuse their exported definitions and reviewed field lists. A new response family still needs a reviewed mapping.
3. Require saved identifiers/verification evidence only where the implementation supports them. Keep uncertain and partial branches honest; preserve absent legacy fields.
4. Keep authorization, write execution and journaling in the domain layer. Validate responses after those controls without redispatching or changing stored outcomes.
5. Add/update native-shaped fixture assertions and MCP contract tests. Check both wire versions, error results, partial pages, duplicate replay and invalid response rejection. A direct schema test alone is insufficient for registration changes.
6. Run `npm run check`, `npm run build`, and `npm test` in the supported Node 24 runtime.
7. Run `npx tsx scripts/export-tool-catalog.ts` and review the generated diff. It stores identical contracts once by hash. Schema changes require regenerating the catalog.
8. Deploy as a separate release step. Inspect authenticated `tools/list` and `at_describe` on the deployed version before claiming live availability.

## Client refresh after deployment

Refresh every ChatGPT MCP connection used for this server (public endpoint and tunnel are separate registrations), inspect the refreshed output metadata, and start a new conversation. Server deployment alone does not refresh a client's stored schema. See [OpenAI's metadata refresh procedure](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) and [the existing stale-schema investigation](TIME-ENTRY-LATENCY.md).

Do not refresh against the old deployment and conclude the output-schema work is live. Authenticated tunnel `at_describe` now verifies production output-contract availability. Client cached-metadata refresh remains unverified.

## Local validation — September 15, 2026

- Node 24.21.0: `npm run check` and `npm run build` passed.
- Full suite: **624 passed**, zero failures, skips or cancellations. Contract tests exercise actual SDK-backed MCP `tools/list` and `tools/call` on both reviewed protocol versions, including legacy registrations.
- Covered representative reads, projected records, pagination and partial results; verified time IDs/intervals; definitive failure and unknown outcomes; partial multi-effect writes; same-key replay; invalid normal/error output; and JSON serialization of PostgreSQL dates and optional properties. Existing business/sales/work fixture tests also validate their native-shaped response contracts.
- Regenerated catalog: **217 operations**, **185 distinct output contracts**; every operation resolves to an object schema. `git diff --check` passed.
- No live business records were created. The subsequent deployment is recorded below; client metadata refresh remains unverified.

Schema declarations and contract enforcement do not by themselves reduce ticket reads or prove a faster time-entry workflow. Tenant-specific live response variants remain a validation gap; unexpected variants now produce a contract error requiring investigation rather than a misleading success result.

## Deployment verification — September 15, 2026

Deployed `rarity-autotask-mcp:output-contracts-20260915` with the existing HTTPS, collector and scanner overrides. Docker health and LAN HTTPS readiness passed. No database migration changes were needed; existing journals and volumes were preserved.

The deployed image's in-process SDK `tools/list`, using the existing mapped principal and current controls, exposes output schemas for all **211 currently available tools**, on both supported protocol versions. This is a deployed registration check, not an external OAuth transport test. The full catalog contains 217 operations; configuration and permissions govern availability.

Separately, authenticated calls through the connected tunnel verified `at_describe(time_log_ticket)` returns `autotask-output-v1` with the saved-ID requirement, and `at_invoke(time_entry_clock)` returns successful structured content and compatible text. No Autotask business writes were made. Refresh client tool metadata and start a new conversation to pick up cached schema changes.

## Publication diagnostics

`at_diagnostics` adds `server_release`, a 64-character SHA-256 `metadata_sha256` for the caller's currently available tools, `metadata_scope: currently_available_tools`, `tool_change_notifications: false` and `client_refresh_required: true`. These fields identify server metadata; they do not report whether a particular client has refreshed. The fingerprint uses the same annotation helper as SDK registration. Existing diagnostic fields remain intact. See the deployment checklist for the separate client-delivery gate.

Native TimeEntry `summaryNotes` and `internalNotes` may be null. Contracts preserve those nulls; they do not substitute empty or invented text. See [the readback incident](TIME-READBACK-2026-09-15.md).

### Ticket creation review

`ticket_create_options` adds `creation_fields` (the twelve-field checklist) and `creation_guidance`, alongside native required inputs and field metadata including issue/sub-issue parent relationships. `ticket_create` retains its receipt and original `verified_saved_fields`, and adds `creation_review` with string arrays `assumptions`, `defaulted_fields` and `unresolved_fields`. The review is returned only with an available original verified snapshot; no review is claimed for failed or uncertain creation. The new assumptions input is stored encrypted and survives same-key replay. Older clients can omit all new inputs; refresh tools/list after deployment for the new guidance.

## Supporting tools

`my_workday` adds `data.timezone_source` (`request`, `employee_configuration`, or `workspace_configuration`) and `data.recorded_hours_scope: returned_batch`. Each collection retains its own encrypted `continuation`; workday continuation inputs use `cursors.assigned_tickets`, `cursors.tasks` and `cursors.time`. Top-level completeness never calls a continuation-only result a complete day. `ticket_prepare_visit` adds the same timezone-source enum. See [supporting-tool semantics](SUPPORTING-TOOLS.md). Playbook list/get now default to version `0.2.0`, while explicit `0.1.0` remains supported and unchanged.

## Classification discovery

`ticket_create_options` now accepts optional `category` and exposes `classification_policy`, `numbered_groups`, `category_defaults`, and `ticket_type_availability` with `category_restrictions` (`category_scoped` or `unavailable`) and current choices. Role/work-type choices include `number_range` or null. Ticket time metadata optionally includes category/queue labels under `time.classification`. See [the policy](TICKET-CLASSIFICATION.md) for override placement and limitations.
