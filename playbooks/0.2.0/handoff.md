# Ticket handoff

**ID:** `rarity.technician.handoff` · **Draft:** `0.2.0` · **Purpose:** move requested ownership with enough supplied context for the next technician to continue.

**Entry conditions:** exact ticket, an authorized and eligible destination resource/queue, and supplied handoff facts or an explicit request to draft them from evidence. Do not infer a new queue merely from the destination technician's name.

**Procedure:**

1. Call `ticket_context` with `purpose: handoff` when context is needed. Gather current state/owner, recorded completed work, blockers, outstanding items and evidence-supported next steps.
2. Structure the handoff into current state, work actually completed, blocker/open question and proposed next action. Include only known facts. A draft based on source records labels absent information as unknown; it does not claim the new technician accepted the work.
3. Resolve the destination and check eligibility, scope and required fields. Multiple authorized Jamies require a choice; a unique Jamie who is ineligible is not silently replaced by an eligible colleague. If the destination is ambiguous or ineligible, use the authorized reference results or ask a focused question; do not claim an alternative was automatically chosen.
4. Call `ticket_handoff` with the exact destination, supplied handoff content and audience. The deterministic contract validates every planned step first, records and verifies the handoff note before changing ownership, and stops if the prerequisite note fails. Assignment state is rechecked at dispatch.
5. Report saved documentation and verified ownership separately. If the note persisted but ownership failed, report that partial outcome and inspect its operation ID. Do not claim the handoff completed, resend the note, schedule an appointment or notify the colleague unless those separate actions were actually requested and implemented.

**Fictitious example:** “Assign T20260910.0101 to Jamie Chen with this internal handoff: uplink is stable after replacement; intermittent client drops still need investigation.” A unique eligible match proceeds. If Jamie cannot be assigned in the current queue, the tool returns an eligibility error and permitted alternatives; it does not first write the note or quietly move the ticket to another queue.

**Acceptance:** duplicate names yield a bounded authorized choice; ineligibility fails before writes; a failed note prevents assignment; a failed assignment after a verified note yields an honest partial receipt; external communication is not a hidden handoff side effect.

**Local implementation review:** This version documents supported tools and their limitations. It remains proposed guidance pending Rarity business validation; reading it grants no new permissions and does not authorize a write.
