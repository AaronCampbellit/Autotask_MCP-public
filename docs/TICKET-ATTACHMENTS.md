# Ticket attachments

`packages/attachments` contains the bounded ticket attachment facade. Listing, metadata, downloads and server-side copying include attachments whose native `ticketID` matches the authorized ticket, including note, time-entry and nested descendants. Responses expose `ticket_note_id`, `time_entry_id` and `parent_attachment_id`; partial native listings remain explicitly incomplete. Deletion is restricted to direct attachments with no note, time-entry or parent-attachment association. Upload creates a direct ticket attachment.

The HTTP adapter uses the reviewed native routes:

| Operation | Route |
| --- | --- |
| list | `POST TicketAttachments/query` with an exact `ticketID` filter |
| get | `GET TicketAttachments/{attachmentId}` |
| create | `POST Tickets/{ticketId}/Attachments` |
| delete | `DELETE Tickets/{ticketId}/Attachments/{attachmentId}` |

Download returns native base64 in bounded chunks (up to 262,144 decoded bytes per response). It never follows or fetches a URL returned by Autotask. Responses are limited to a 7,000,000-byte decoded file and a 9,500,000-byte adapter response, which leaves room for the base64 representation and JSON envelope. The service verifies canonical base64, the native `fileSize` when present, and the requested parent before returning content.

Upload accepts an actor-owned artifact produced by `ArtifactService.stageUpload`. The artifact must be complete, belong to the exact ticket, have source `client_upload`, and have a matching SHA-256. Runtime integration should pass `resolvePublishInternal`, which lazily reads current `TicketAttachments` field metadata and returns one exact active internal publish value; the service does not guess an internal audience value. A static `publishInternal` is suitable only for a fixture or separately reviewed test configuration. Upload also requires a shared durable tenant-wide five-minute byte budget and reserves the decoded bytes immediately before dispatch. The staged bytes are re-read immediately before dispatch and the native response is read back by attachment ID, title, MIME, `FILE_ATTACHMENT` type, publish value, size and SHA-256 of returned `data`. The native `fullPath` uses the generated staged artifact filename; the caller title remains the display title. Uploads and deletes reserve durable encrypted intent and never automatically re-dispatch an uncertain write. A repeated request key returns the existing operation status.

`PostgresAttachmentByteBudget` implements that budget with `packages/storage/migrations/010_attachment_budget.sql`: tenant reservations are serialized in PostgreSQL and expire from the five-minute rolling sum. Apply migration `010_attachment_budget` before enabling live upload. The fixture unlimited budget is intentionally unsuitable for live configuration.

The native API documents an approximate 6–7 MB per-file limit and a 10,000,000-byte creation budget over five minutes. This package stays below that limit at 7,000,000 decoded bytes. Staging and upload require ordinary file validation; no malware scanner is used. Reading/copying returned descendants is supported; creating or deleting note/time-entry/nested attachments, native URL downloads and attachment metadata updates remain unsupported. Staging defaults to 6,000,000 bytes; the native attachment path allows 7,000,000 bytes.

The exported service and adapters are `TicketAttachmentService`, `HttpTicketAttachmentPort`, and `FixtureTicketAttachmentPort`; `FixtureUnlimitedAttachmentByteBudget` is test-only. Runtime integration should construct the service with the existing `TicketWorkflows`, `ArtifactService`, `IntentCipher`, migration-backed journal, `resolvePublishInternal: p => attachmentPort.resolvePublishInternal(p)`, and shared byte budget, then expose the service methods through reviewed tool schemas. `operationStatus` reconciles upload, copy and delete journals. The HTTP adapter requires the exact application operation allowlist names `TicketAttachments.query`, `TicketAttachments.get`, `TicketAttachments.create`, `TicketAttachments.delete`, and `TicketAttachments.fields`; its shared request budget and explicit `writesEnabled` setting are also required. `publishInternalLabel` must be the reviewed exact active metadata label.

The route and descendant behavior above is based on the checked-in `TicketAttachmentsEntity.txt`, `AttachmentInfoEntity.txt`, `TicketsEntity.txt`, and the local `work/docker/swagger.json`. No live business write was used for validation.

## Server-side copy

`ticket_attachment_copy` copies one exact native attachment ID between authorized tickets. Both parents and source bytes/association are checked again before dispatch. It preserves filename, title, MIME type and exact bytes, uses current internal visibility and the existing durable upload journal and byte budget, and verifies the saved bytes by SHA-256. It does not send bytes through the model or require browser login. Use a stable request key and `attachment_operation_status` for recovery; an uncertain copy is never automatically redispatched.

Deployed with descendant discovery and XLSX staging in `0.1.0-mcp-expanded.20260917.3`; see [current status](CURRENT-STATUS.md). Native writes were not performed as release tests.
