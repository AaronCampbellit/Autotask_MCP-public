# IT Glue implementation and qualification

Implemented locally September 20, 2026. This is not evidence of deployment, configured credentials, native account qualification, or live business writes.

The provider is independently disabled by default. Administrators configure US/EU/AU credentials encrypted at rest, then explicitly map organizations using the documented organization ID + Autotask PSA ID/type filters. Credential/region changes clear mappings. Each operation reauthorizes current capabilities, company scope and connection version and rechecks the native organization association. Organization hierarchy does not grant access. Multiple mapped organizations require an explicit organization ID.

Reads cover organizations, configurations, contacts, flexible assets and their field schemas, documents and bounded section pages, checklists, reviewed related items, expiration metadata and reference dictionaries. Cursors are encrypted and bound to actor, policy/mapping/connection versions, operation and filters. Pagination requires native completeness metadata; next URLs are never followed. Included cross-customer records are not returned. HTML becomes plain text, reviewed IT Glue source links exclude query strings, and secret/unsupported flexible fields are omitted.

Writes cover draft document creation with per-section POST receipts, narrow document/section changes, explicit publishing, reviewed primitive flexible asset fields, configuration creation and conservatively gated updates, and checklist name edits. Expected values are checked immediately before dispatch; this is not atomic native compare-and-swap. Configuration updates require an explicitly empty adapter relationship; unknown ownership fails closed. Flexible asset replacement refuses existing secret or unsupported fields. Request keys reserve encrypted intents durably before dispatch. Repeated keys return receipts, and uncertain or partially completed requests never automatically repeat native writes. See [document media](ITGLUE-MEDIA.md) for staged PNG/JPEG uploads; media upload does not edit or publish sections.

## Verified locally

- Strict TypeScript compilation.
- Provider fixture tests: company isolation, native mapping changes, revocation, expected conflicts, moved parents, idempotent receipts, unknown/partial outcomes, POST section creation, cursor binding, transport limits and credential replacement.
- PGlite applies foundation and migration 017; verifies encrypted configuration/intents, concurrent optimistic versions, unique reservations and actor/tenant isolation.
- Supplementary-read fixtures verify same-organization related records, omitted password records and truthful partial completeness.
- Document-media fixtures verify artifact company ownership, format/size/hash validation, immediate guard checks, readback, concurrency and unknown outcomes.

## Release gates and conservative limits

- Securely configure a real regional API key and confirm license/API permissions and pilot organization/device associations. No live provider calls or business mutations were performed.
- Validate actual response shapes in the account, especially adapter relationship ownership, flexible field types, checklist organization attributes and image response envelopes. Unknown/missing evidence intentionally rejects rather than claiming safe access.
- User-selected live authoring/action tests remain pending. Publishing can remain accepted/unverified; receipt acceptance is not proof of content publication.
- Related-item includes are bounded evidence, never an exhaustive list. Flexible asset search returns metadata; individual reads expose only reviewed primitive traits. Configuration writes do not override PSA synchronization.
- No password tools, bulk deletion, schema administration, arbitrary commands, external image URLs, or automatic section insertion are exposed.

Endpoint qualification uses the [official developer reference](https://api.itglue.com/developer/) and the captured September 15 inventory. Tests validate local behavior, not upstream account connectivity.
