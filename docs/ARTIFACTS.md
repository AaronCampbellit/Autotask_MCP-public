# Protected local artifacts

This implements the local artifact and file-staging slice of planning work packages WP-06, WP-08, WP-25 and WP-27. It covers requirements R-31, R-32 and R-38 with fixture evidence for FILE-01–03. Staging uses ordinary file validation; native attachment writes remain user-tested, and large streaming reports are separate work.

The service exports fixed CSV views of an authorized ticket, its notes, or the employee's own time. It can stage a client-supplied text, PDF, PNG, JPEG or XLSX attachment after authorization, filename, type and size validation. Staging creates no Autotask attachment and sends no notification.

## Runtime API

```ts
import { ArtifactService, PostgresArtifactCatalog } from '../packages/artifacts/src/index.js';

const artifacts = new ArtifactService(ticketWorkflows, {
  projectRoot: '/app',
  encryptionKey: Buffer.from(process.env.ARTIFACT_ENCRYPTION_KEY!, 'base64'),
  catalog: new PostgresArtifactCatalog(pool),

});
```

Apply `packages/storage/migrations/005_artifacts.sql` after the foundation migration. The PostgreSQL catalog is required for durable deployments. `MemoryArtifactCatalog` is the default fixture option; it does not rebuild ownership from disk after a restart.

| Method | Inputs | Result |
| --- | --- | --- |
| `exportCsv(principal, input)` | `ticket`, `collection: ticket / notes / own_time` | `status`, artifact summary in `data`, up to five projected preview rows, warnings |
| `list(principal, {})` | No caller owner or path | Authorized summaries in `data.artifacts` |
| `download(principal, input)` | `artifact_id` | `metadata`, `bytes: Buffer`, safe HTTP `headers` |
| `downloadChunk(principal, input)` | `artifact_id`, byte `offset`, optional `length` up to 262,144 | Metadata, base64 content, offset and `next_offset` |
| `remove(principal, input)` | `artifact_id` | `artifact_id`, `deleted: true` |
| `stageUpload(principal, input)` | `ticket`, `filename`, allowed `mime`, canonical `content_base64` | `status: staged`, summary and explicit local-only warning |
| `cleanupExpired()` | Internal server retention action | Removed count and `may_have_more` |

The exported Zod schemas are `artifactExportSchema`, `artifactListSchema`, `artifactIdSchema`, `artifactChunkSchema` and `artifactStageSchema`. Unknown keys, caller paths, URLs, headers, raw row/column lists and alternate owner/resource identifiers are rejected.

Download routes must authenticate the caller and call the service for every request. Use the returned attachment headers. Never make the artifact directory public, add an unauthenticated static route, or treat knowledge of an artifact ID as authorization. MCP integrations can use `downloadChunk`; HTTP integrations can return the bounded `bytes` buffer.

## Storage, authorization and integrity

Encrypted files reside only at `projectRoot/work/artifacts/<SHA256 actor key>/<UUID>.blob`. The parent directories must be real directories, not symlinks. Filenames are generated from validated IDs and a fixed MIME-to-extension mapping. A submitted filename is validated as an attachment name and is never used as a storage path or HTTP header.

Each file uses AES-256-GCM with a random nonce and a distinct 32-byte server key. Authenticated associated data binds the artifact ID, owner, mapped resource, mapping/policy/scope, actual ticket/company, MIME, decoded byte count, checksum and expiry. Both the GCM tag and SHA-256 checksum must verify before bytes are returned. Customer content, original upload filenames and CSV text are absent from catalog/audit records.

The catalog retains actor/resource/mapping/policy and company-scope bindings, the actual parent, all exported native record IDs, MIME, decoded byte count, checksum, expiry, collection/source and completeness. Every list/download reauthorizes the employee, ticket and included note/time record. Own-time artifacts also require `time.self`; upload staging and access require `tickets.write`. Changed mappings, policy/capabilities or scope cannot inherit old exports. Parent moves, deleted/moved child records and changed time ownership also prevent download. A failed dependency is not an empty or complete report.

PostgreSQL functions serialize quota reservation before any encrypted file write, then atomically publish state with an audit event. Pending files count against quota until removed, including after interrupted publication. Deletion removes the ciphertext before releasing its quota. Owner/state checks and the access event occur atomically before a completed download is returned. Audit rows have an UPDATE/DELETE rejection trigger and contain only owner, artifact ID, action and timestamp. Database owners and backup administrators retain their usual privileged controls.

The service rechecks employee, parent and included-record access after publication or download-audit storage completes, before returning previews or bytes. A download access event records an attempt after initial authorization; it does not prove client delivery. A later revocation or delivery failure can still withhold the content.

Supported deployment topology is one application instance with a persistent artifact volume and a shared PostgreSQL catalog. Mount only `/app/work/artifacts`; do not hide `/app/work/build`. Restore the database, encrypted files and matching artifact key together. The ciphertext format is `ATF1 | 12-byte nonce | 16-byte GCM tag | ciphertext`. Losing the key prevents recovery; a wrong key fails closed. Multi-replica file availability and key rotation are separate deployment work.

## Limits and retention

Defaults are 6,000,000 decoded content bytes per file, 1,000 rows per export, 20 active artifacts and 40,000,000 decoded content bytes per actor, 160,000,000 decoded content bytes globally, a 15-second operation deadline, and 24-hour content expiry. Configurable bounds allow up to 7,000,000 file bytes, 1,000 rows, 100 artifacts per actor, 60-second deadlines and 24-hour expiry. Byte quotas count decoded payloads; ciphertext framing, catalog and audit metadata add storage overhead.

Exports are bounded in memory. Notes use at most ten 50-record source pages; own time uses at most ten 100-record pages. A cap or upstream incomplete collection produces `status: partial`, `complete: false` and an explicit warning. No cross-currency arithmetic, financial columns, atomic snapshot claim or complete streaming-report claim is made. Large reports still require the worker/export-job integration in WP-27.

Call `cleanupExpired()` from trusted server retention work. Each call handles at most 100 catalog records; continue when `may_have_more` is true. Expired content cannot be downloaded even before cleanup runs. Deleting ciphertext is not a promise to erase backup copies or immutable audit metadata; production backup, audit retention and deletion propagation policy still needs deployment review. A crash before publication can leave a pending catalog row/ciphertext; expiry cleanup removes it safely. Missing files and failed integrity checks remain explicit failures.

## CSV and upload handling

CSV uses a fixed, operational-only column list and the shared field projection. Strings beginning with `=`, `+`, `-` or `@`, including after Unicode/control whitespace, receive a leading apostrophe. Every cell is quoted and quotes/newlines are encoded. Numeric values remain numeric strings; no financial rate, cost or margin is included even if the employee has finance capability. The artifact warns that formula-like strings have been neutralized.

Uploads reject unsafe names, path separators, Windows device names, noncanonical base64, size violations, extension/MIME mismatches, malformed UTF-8/control-heavy text and recognizable HTML/XML/SVG supplied as text. PDF/PNG/JPEG signatures are checked. XLSX validation checks the bounded ZIP structure, CRCs and workbook content types, rejecting encrypted, corrupt and macro-enabled packages. These checks are a preliminary type screen, not malware detection. Files are not malware-scanned. Authorization, content/type validation, encrypted storage and integrity checks still apply.

Every download uses `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a restrictive sandbox CSP. The artifact service has no inline HTML renderer, local-path upload or arbitrary URL fetch. Reviewed native file references are handled by the [chat file-input adapter](CHAT-FILE-UPLOADS.md); native publication is a separate attachment-tool action.

## Evidence and remaining remote file work

`tests/artifacts.test.ts` exercises formula payloads, explicit projections, child/actor/policy revocation, current own-time access, ciphertext tampering, wrong-key recovery, restart with a PostgreSQL catalog, quota contention, migration rollback/idempotency, immutable audit metadata, staged-upload type checks and storage failures, retention and safe download headers. All use fictitious records, temporary directories under project `work`, PGlite and fake fetches. No tenant business requests occur.

The vendor [AttachmentInfo reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/AttachmentInfoEntity.htm) describes attachment creation/deletion uses actual parent child URLs and documents the approximate 6–7 MB individual API limit plus a 10,000,000-byte creation budget over five minutes. The vendor [TicketAttachments reference](https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketAttachmentsEntity.htm) explains that ticket attachment queries can include note/time descendants and that entity ID wins when both entity and parent IDs are supplied. Both warn about attachment API changes. Those sources inform the native attachment limits and parent/classification checks documented in [TICKET-ATTACHMENTS.md](TICKET-ATTACHMENTS.md). No native attachment was created as a build test.

## Native ticket attachments

Protected local artifacts and native Autotask attachments are separate records. The [ticket attachment tools](TICKET-ATTACHMENTS.md) use ticket-scoped native routes. Uploads require an owned, validated staged artifact plus reviewed publish metadata and a persistent shared byte budget. No external URL is downloaded on the caller’s behalf.
