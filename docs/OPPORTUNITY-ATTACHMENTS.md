# Opportunity attachments

Deployed September 16, 2026. Server discovery and health are verified; native opportunity upload/delete testing by the user remains pending.

The MCP supports direct opportunity attachments with seven tools: `opportunity_file_stage`, `opportunity_attachment_list`, `opportunity_attachment_get`, `opportunity_attachment_download`, `opportunity_attachment_upload`, `opportunity_attachment_delete`, and `opportunity_attachment_operation_status`. Generic operation status/reconciliation also recognizes these receipts. Company-note attachments and nested attachment descendants are excluded.

Stage a file against an `opportunity_id`, then upload its `artifact_id` with a title and a unique request key. The admin console Files form offers Ticket or Opportunity staging. Staged files are encrypted, expire, and are bound to their owner, permissions, company and exact parent type/ID. A ticket file cannot be uploaded to an opportunity, even when their numeric IDs match. Reads recheck current company access; writes require `sales.write`, while reads follow the current Sales Read policy. See [area permissions](AREA-PERMISSIONS.md) for converted policies and legacy compatibility.

Uploads accept TXT, PDF, PNG, JPEG and XLSX, up to **6,000,000 decoded bytes**. The MCP endpoint retains its 64 KiB request-body limit; use authenticated console staging or a supported [native file reference](CHAT-FILE-UPLOADS.md) for larger files. Ticket and opportunity uploads share the existing **10,000,000-byte/five-minute** tenant allowance. Downloads are bounded base64 chunks. The native API adapter uses OpportunityAttachments reads and `Opportunities/{id}/Attachments` writes, with current publish-field metadata checked before upload. Files use the configured internal publication label.

Uploads verify the saved title, MIME type, publication setting and content hash before claiming success. Deletion verifies absence with parent access still valid. Request keys prevent duplicate native mutations; uncertain effects are not automatically dispatched again. Recovery uses encrypted journal intents and persisted native IDs when available.

## Deployment record and requirements

Deployed server version: `0.1.0-opportunity-attachments.20260916.3`.
Deployed image: `rarity-autotask-mcp:ticket-financial-privacy-20260916`.

Migration 012 was applied after a verified database backup for this deployment. For a new deployment, apply migration `012_opportunity_attachments.sql` through the normal migration command before starting the candidate server. It expands the existing artifact catalog and encrypted-intent allowlist; existing ticket artifacts retain their encryption binding. That release required migrations through 012; current readiness requires the full current migration set, through 016. Rollback must account for new opportunity artifact rows and intents; retain the expanded schema when reverting the application.

Tool availability requires `SALES_ENABLED=true` and `ATTACHMENTS_ENABLED=true`. Native writes additionally require both sales and attachment write flags. Existing per-member capabilities, tool switches and the global write pause remain enforced. No flags or dashboard switches were changed while preparing this release. On deployment, verify native permissions/publish metadata and refresh client tool discovery; perform an explicitly authorized live upload/read/delete check before claiming live qualification.

That release also included queue eligibility correction, contextual status guidance and issue/sub-issue updates. See [current status](CURRENT-STATUS.md) for subsequent releases.

API reference: https://www.autotask.net/help/developerhelp/Content/APIs/REST/Entities/OpportunityAttachmentsEntity.htm
