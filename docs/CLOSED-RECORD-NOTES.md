# Notes and attachments on closed records

Deployment update: included in `0.1.0-attachments-access.20260917.1` on September 17, 2026. See [current release verification](CURRENT-STATUS.md). Earlier candidate/test statements below describe development checkpoints; live business and client-specific checks remain as noted.

The feature is deployed; no live opportunity or ticket was changed during its development tests.

Ticket notes and ticket/opportunity attachments retain the direct write path. A permission failure, generic validation error or uncertain upload is never classified as a reason to reopen. The shared assistant policy explicitly prohibits that fallback.

Opportunity notes have a documented active-parent restriction ([CompanyNotes](https://autotask.net/help/developerhelp/content/apis/REST/Entities/CompanyNotesEntity.htm)). `opportunity_note_create` checks current tenant metadata and returns `confirmation_required` for observed Closed, Implemented or Lost opportunities. Other non-active states require manual review. The preview contains the exact validated note, original status and closure dates, a ten-minute encrypted confirmation token bound to the employee and permissions, and an explicit warning that status transitions can trigger native automation/history. This is local preflight, not a claim that a native write was rejected.

After the user approves that exact preview, `opportunity_note_confirm_reopen` requires `approve_reopen_and_restore: true`. It checks the original opportunity snapshot, verifies the temporary Active status, saves the note through the ordinary journaled write, and restores the original status and dates. Lost dates are captured before reopening because Autotask clears them when leaving Lost. Closed dates are sent as date-only values; midnight API representations are normalized without changing their date ([Opportunities](https://autotask.net/help/developerhelp/content/apis/rest/entities/OpportunitiesEntity.htm)). Missing closure-date fields, or a Lost record without a lost date, block automatic preparation. The operation never runs the Won wizard or alters a quote.

Each native step has a durable receipt. The note retains the caller's original request key; reopen and restore keys bind the approved note, opportunity snapshot and identity. Repeated confirmation calls report receipts without automatically resuming an interrupted workflow. Existing note receipts block a fresh reopen. The execution controls check the confirmation tool plus opportunity_update and opportunity_note_create switches.

## Failures and recovery

- Unknown or unverified writes stop the workflow. A lost note response does not cause another note, another reopen or a restoration attempt.
- A definite note rejection permits the already-approved restoration, with the failed note clearly reported.
- Concurrent observed changes block restoration. Read-before-write checks cannot provide an atomic lock across Autotask requests.
- Inspect each returned operation ID with `sales_operation_status`, then read the current opportunity. Status inspection never repeats writes. An unknown create without an ID needs native investigation before any new note is attempted.
- If reopening succeeded but restoration is not verified, the opportunity may remain Active. Retain the original approval preview; after resolving uncertain writes and checking fresh values, use an explicit opportunity_update to restore the original status and closure dates. Never blindly replay the whole workflow or retry a note under another key.
- An interrupted process deliberately requires review rather than background resumption. Historical receipts describe verified steps at that time, not a guarantee that nobody later changed the opportunity.

Approval is an assistant workflow requirement plus an explicit API argument and authenticated preview; the service cannot independently verify a human conversation. No live tenant behavior or native automation side effects have been tested. Fixture tests cover direct closed-record writes, approved restoration, date preservation, stale/tampered/expired approval, revoked permissions, definite and uncertain failures, concurrent edits and replay.
