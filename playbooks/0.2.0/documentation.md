# Work documentation

**ID:** `rarity.technician.documentation` · **Draft:** `0.2.0` · **Purpose:** record the employee's supplied work and, when requested, its stated time.

**Entry conditions:** exact ticket, actual work facts/text, intended note audience and any requested time amount/date and an offset-qualified start_datetime. Use time_entry_clock when current local time is needed; never invent an interval. Resolve permitted defaults for role/work type and business-required fields; a missing factual description or uncertain duration requires clarification.

**Procedure:**

1. Identify whether the employee requested a note, time, or both. For a standalone note or time operation, `ticket_note_add` or `time_log_ticket` remains appropriate. Use `ticket_document_work` for the coordinated documentation-and-time workflow.
2. Retrieve `ticket_context` with `purpose: continue_work` only when history is needed to fulfill the request or resolve a real conflict. The workflow performs its required state/time checks server-side; the client need not repeat lookups purely to satisfy a script.
3. Preserve the requested audience and technician. If “log my time” is requested, use the signed-in mapped resource. These documentation tools only record the mapped employee's own time. Delegated time creation is not implemented; do not supply another employee or imply that a capability enables it. Existing time and potential overlap are evidence for a conflict, never a basis to invent a different duration.
4. Call `ticket_document_work` with the supplied facts, explicit or unambiguously user-requested audience, requested time and stable request key. The tool validates all planned components before its first mutation, records its fixed ordered steps, saves and verifies documentation, then saves and verifies requested time according to the workflow contract. It never changes assignment or ticket status. Use ticket_handoff or ticket_update for requested ownership changes, and ticket_resolve for requested completion; do not silently expand this workflow.
5. Return the receipt, including note audience, saved record links, time/resource, selected defaults and actual ticket state if verified. If the note succeeds and time fails, say so and recover through that recorded operation; do not create the note again.

**Fictitious example:** “Add an internal note: replaced the failed switch and verified the uplink. Log 30 minutes for me today.” Resolve the actual time interval before writing; the duration alone is insufficient. A verified receipt can say: “Internal note saved. Thirty minutes recorded to your resource for the resolved local date. Role and work type came from the displayed validated default rule.” It may say “Ticket remains In Progress” only if the receipt verifies that state. The switch replacement does not justify invented serial numbers or customer confirmation.

**Acceptance:** a missing duration does not become elapsed chat time; an ambiguous audience does not become a public note; delegated time without permission is denied before any component is written; recovery after saved documentation does not duplicate it; a default is both eligible and explained.

**Local implementation review:** This version documents supported tools and their limitations. It remains proposed guidance pending Rarity business validation; reading it grants no new permissions and does not authorize a write.
