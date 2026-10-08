# Ticket resolution

**ID:** `rarity.technician.resolution` · **Draft:** `0.2.0` · **Purpose:** record the supplied resolution, any requested time, and an explicitly requested valid completion transition.

**Entry conditions:** exact ticket, actual resolution facts, intended audience, any requested duration/date and offset-qualified start_datetime, and explicit completion intent. A request to “review whether this is ready to close” is a read, not a close instruction.

**Procedure:**

1. Retrieve `ticket_context` with `purpose: resolve` as needed for resolution evidence, current status, outstanding required fields/checklist items, existing time and permitted completion choices. The tool must validate current requirements even if the client omits a context call.
2. Separate blockers enforced by the actual tenant/API contract from proposed procedural preferences. Ask for genuinely missing required facts; do not manufacture resolution text, customer acceptance, root cause or time merely to make a transition valid.
3. Use `ticket_resolve` when the employee requests the coordinated job. The fixed workflow prevalidates planned actions, records its steps, persists and verifies resolution documentation, persists and verifies requested time, and only then applies and verifies the valid completion transition. Existing verified time is not recreated. If the request has no time component, the workflow does not invent one.
4. A failed required prerequisite stops later steps. An ambiguous timeout on a prerequisite first requires reconciliation; it is never treated as successful merely to allow closure. A concurrent change to a completion requirement/status produces a conflict under the tool contract.
5. State each component's actual outcome. If resolution and time are saved but closure failed, return their links and the still-unfinished status step with the operation ID. Recovery targets only unfinished recorded steps after current permission/state checks.

**Fictitious example:** “Record this internally: replaced the failed switch and verified the uplink. Log 20 minutes and close the ticket.” Resolve the actual time interval before executing; do not invent start_datetime from the duration alone. If the final update fails, the receipt says: “Resolution note and 20-minute time entry are saved. Closing the ticket failed; status is [last verified state, with time]. Operation [ID] is partial.” The assistant does not rerun the request with a new key.

**Acceptance:** failed resolution prevents closure; saved time is not duplicated on status recovery; “ready to close?” causes no mutation; unresolved required fields prompt only for missing facts; prohibited completion actions are denied rather than routed to an approval.

**Local implementation review:** This version documents supported tools and their limitations. It remains proposed guidance pending Rarity business validation; reading it grants no new permissions and does not authorize a write.
