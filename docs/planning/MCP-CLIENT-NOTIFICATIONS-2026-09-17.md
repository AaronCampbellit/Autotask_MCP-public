# Future feature: client notifications for ticket notes and time entries

Status: deferred feature plan, recorded September 17, 2026. No implementation, Autotask configuration, notification sending, deployment or scheduled work is authorized by this document alone.

## Goal and agreed direction

Allow staff to request a customer email while adding a ticket note or time entry through the MCP. Autotask should send the email using approved RS branded templates and the configured support reply address. Notification is off unless explicitly requested.

Create dedicated MCP fields and workflow rules. Leave the existing `SAY_Notify_TicketContact` and `SAY_Notify_AdditionalContacts` fields and their workflows intact.

This is an indirect workflow integration. The documented note/time-entry API does not expose the native notification panel's per-entry To/CC/BCC controls. Recipient options in this feature are ticket-contact groups, not arbitrary individual email lists.

## Existing tenant evidence

User-provided screenshots show both SAY fields are active List (Single Select) ticket UDFs with exact stored values `True` and `False`, hidden from the Client Portal. Their workflow summaries show ticket-created/note-added events, Note Publish equal to “All Autotask Users,” the corresponding flag equal to `True`, reset to `False`, and the “Ticket Note - Created or Edited” notification template. Recipients are Ticket Contact or Additional Contacts respectively. No time-entry trigger is visible in those summaries. Template contents and actual sending behavior have not been tested.

## 1. Dedicated Autotask fields

Create these ticket User-Defined Fields under Admin → Features & Settings → Application-Wide (Shared) Features → User-Defined Fields → Tickets:

- `MCP_Notify_TicketContact`
- `MCP_Notify_AdditionalContacts`

Use List (Single Select), stored values `True` and `False`, and keep both hidden from the Client Portal. Treat blank and `False` as off. Confirm field metadata and exact stored values through the API before enabling MCP support.

## 2. Dedicated Autotask workflows

Prepare four rules, initially disabled:

| Rule | Event | Recipient |
| --- | --- | --- |
| MCP — Note — Ticket Contact | Note added | Ticket Contact |
| MCP — Note — Additional Contacts | Note added | Additional Contacts |
| MCP — Time Entry — Ticket Contact | Time added | Ticket Contact |
| MCP — Time Entry — Additional Contacts | Time added | Additional Contacts |

Each rule requires its corresponding flag to be `True`, appropriate customer-visible content, and an update resetting that flag to `False`. Confirm exact event labels, API-created activity eligibility, visibility conditions and reset/send ordering in the tenant. Do not copy the existing ticket-created trigger without a demonstrated need.

## 3. Templates and reply handling

Select or prepare approved RS branded templates separately for notes and time entries. Verify the triggering note description or time-entry summary is included, rather than unrelated/latest activity. Exclude internal notes and financial details under the existing ticket-content policy. Verify sender, support reply address, ticket-number threading, Thermometer behavior and attachment handling. Check existing workflows for overlapping notifications.

## 4. MCP behavior

Expose notification choices on applicable note/time-entry workflows: none (default), Ticket Contact, Additional Contacts, or both. Preserve explicit notification intent through composite workflows and retries. Validate existing user permissions, ticket scope, recipient identities/email eligibility, public content and configuration before setting flags. Explain that Additional Contacts can include everyone in that ticket group; do not silently change ticket contacts to emulate a per-message recipient list.

Record requested recipients and durable operation progress. Set only the requested flags, create the activity, and reconcile flag state and notification history. Report entry saved separately from notification recorded as sent or notification unconfirmed. A history record is not proof of delivery or reading; flag reset alone is not proof of sending.

## 5. Reliability design gate

Flag setting and activity creation are separate operations. Before enabling this feature, design and test recovery for failed creation, stale flags, timeouts, delayed workflows, permission changes and repeated requests. Reuse existing idempotency/operation receipts; do not retry an uncertain write or send blindly. Clear stale flags only when ownership and the current state make that safe.

Serialize MCP notification operations per ticket. This does not prevent a technician or another integration from adding activity while a flag is active. Shared flags across note/time rules also permit the wrong activity type to consume a flag. Test this explicitly; consider separate per-activity flags or a different supported trigger design if needed. Do not claim the two-field design provides atomic, exactly-once notification. If recipient/content correlation cannot be made sufficiently reliable, keep the feature disabled and document the limitation.

## 6. Acceptance tests

Use a controlled ticket and explicitly approved test recipients when implementation resumes:

- Notes and time entries: none, primary contact, additional contacts, and both.
- Missing/inactive/opted-out contacts, empty additional-contact groups and internal content.
- Correct branded content, sender/reply routing, ticket number, attachments and Thermometer.
- Flag reset, notification-history correlation and accurate partial-success reporting.
- Failed writes after flags are set, uncertain outcomes, retries and delayed notifications.
- Concurrent MCP/manual activity, both recipient flags enabled, and existing SAY/other workflows running.

Confirm actual received emails as well as saved records and history. Existing SAY behavior must remain unchanged. No global “notify on every note/time entry” rule should be introduced.

## 7. Future rollout

Document field mappings, rule/template configuration, administrator controls and recovery steps. After controlled tests pass, enable the qualified rules and feature together. Follow AGENTS.md: bump the MCP release version, use a distinct image tag, deploy, verify advertised version and live behavior, then commit/push as requested for that future release. Rollback must disable the MCP notification path and its dedicated rules and reconcile pending flags without affecting SAY configuration.

## Research references

- [Thread: email communication workflows](https://chatgenie.helpdocs.io/article/y8vbejd663-setting-up-an-email-communication-workflow-in-autotask): describes the Quick Notification API limitation and workflow-based contact notifications.
- [Neo Agent: end-user email notifications](https://docs.neoagent.io/integrations/psa/autotask/ticket-contact-notifications): documents selective UDF-triggered note/time-entry notifications. This is evidence of an integration pattern, not tenant qualification or an exactly-once guarantee.
- [Autotask TicketNotes](https://ww1.autotask.net/help/developerhelp/content/APIs/REST/Entities/TicketNotesEntity.htm), [TimeEntries](https://ww1.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/TimeEntriesEntity.htm), and [NotificationHistory](https://ww3.autotask.net/help/developerhelp/Content/APIs/REST/Entities/NotificationHistoryEntity.htm): recheck current entity metadata and supported fields during implementation.
