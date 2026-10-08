# Datto RMM and IT Glue MCP implementation research

Research date: 2026-09-15. **Implementation complete for the reviewed P0–P3 candidate scope, September 20, 2026.** Account/live acceptance remains pending; deployment is deferred at the user’s request. See [completion evidence](../IMPLEMENTATION-PROGRESS-2026-09-20.md). The source inventory and design discussion below are historical research, not proof of live access.

This isolated planning bundle extends the existing Autotask MCP design with RMM operations and IT Glue documentation. It does not change Entra sign-in, existing company scope, users, integration settings, or the main task's source files. Everything labelled proposed is an implementation decision, not a vendor guarantee.

## Start here

- [RMM-focused baseline, September 17](../DATTO-RMM-BASELINE-2026-09-17.md): refreshed schema comparison, first delivery scope, and correction excluding deprecated alert mute/unmute actions. This qualification takes precedence over older proposed actions below.

- [Implementation plan](IMPLEMENTATION-PLAN.md): architecture, scope, stages, delivery checklist and completion gates.
- [API inventory](API-INVENTORY.md): every captured method/path and its implementation disposition.
- [Proposed tool contracts](TOOL-CONTRACTS.md): 39 initial tool designs, arguments and native routes.
- [Provider behavior and gaps](PROVIDER-NOTES.md): authentication, paging, side effects, source discrepancies and unsupported claims.
- [Acceptance scenarios](ACCEPTANCE.md): meaningful fixture tests and user-controlled live validation.
- [Source manifest](source-manifest.json): source URLs, fetch timestamps, byte sizes and SHA-256 hashes.

## Evidence coverage

| Provider | Captured evidence | Limit |
| --- | --- | --- |
| Datto RMM | Live official Swagger configuration, OpenAPI 3 specification: 59 operations on 55 paths, 118 component schemas; API guide | Captured from the public Vidal platform; the actual tenant platform/build must be compared before enabling tools. |
| IT Glue | Entire official HTML API reference, 209 route declarations (162 documentation groups) across 37 resource families, parameter/error sections and route aliases | HTML is not a formal OpenAPI/JSON Schema contract. Every implemented field still needs a reviewed typed schema. |
| Supporting guides | API access, pagination, sorting/filtering, RMM component behavior, three-product source-of-truth guidance | Describes supported product behavior, not our tenant's license or effective permissions. |

Machine-readable files: [RMM endpoints](rmm-endpoints.json), [IT Glue endpoints](itglue-endpoints.json), [coverage decisions](endpoint-coverage.json), [proposed tools](proposed-tools.json). The catalogs retain factual method/path and alias observations, original coverage decisions and upstream URLs. Vendor descriptions, examples, parameter tables and full schemas have been excluded. Consult the [official RMM specification](https://vidal-api.centrastage.net/api/v3/api-docs/Datto-RMM-v2) and each IT Glue source URL for current field rules; attribution is not a redistribution grant.

“All” here means all operations in those captured references, not every feature in the vendors' interfaces, private APIs or a promise to ship 268 MCP tools. RMM's prose guide lists at least one route absent from its live specification; see the explicit gap log. Other RMM platforms may differ.

## Reproduce

From this directory:

```sh
python3 scripts/collect.py           # public responses in memory; retains facts + metadata
python3 scripts/build_inventory.py  # rebuilds coverage and proposed contract tables
python3 scripts/validate.py         # offline factual inventory/provenance checks
```

`python3 scripts/collect.py --offline` validates retained observations without downloading pages or claiming to re-extract full schemas. Refreshes can introduce vendor changes; inspect the inventory diff and update reviewed counts/gates before relying on it. Raw vendor responses are never written to this repository.

## Intended first delivery

Keep our current Entra entry point. Add outbound API adapters, verified Autotask company → RMM site → IT Glue organization mappings, and read-only device/alert/document context. Follow with IT Glue authoring and controlled RMM component execution. Secrets, account administration and destructive operations have a documented later-phase disposition; they are not silently included in the first rollout.

Existing parent-task runtime documentation remains authoritative for what is already deployed. This bundle introduces no registered runtime operations.

## Planning verification

Historical validation checked nine source hashes, parameter groups and local schemas before publication cleanup. Current offline validation checks provenance metadata, all 268 method/path observations and dispositions, all 39 proposed-tool route references, aliases and local links. It does not verify removed page bodies, full schemas or provider runtime behavior.

The documented legacy RMM OpenAPI URL failed, while the URL discovered through official Swagger configuration succeeded. This is recorded as evidence, not a guessed endpoint fallback. No repository commit, application changes, credentials, business writes or deployment actions were performed in this side task.
