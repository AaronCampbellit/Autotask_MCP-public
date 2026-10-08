# Ticket triage

**ID:** `rarity.technician.triage` · **Draft:** `0.1.0` · **Purpose:** understand a reported issue and choose the next investigation step. This playbook itself requests no business mutation.

**Entry conditions:** a ticket reference or enough authorized business information to find one, and the employee's actual question. For an ambiguous ticket reference, use `ticket_search` or the shared resolver before collecting context.

**Procedure:**

1. Call `ticket_context` with `purpose: investigate`. Ask for issue/current state, relevant recent changes, internal and external notes, linked assets and related tickets within scope. Do not require the assistant to join raw entity collections itself.
2. Inspect collection completeness, freshness and warnings. Retrieve a continuation when the required history is incomplete and the budget permits; otherwise state which conclusion cannot yet be drawn.
3. Build a brief evidence summary: reported impact, affected users/assets, when the issue began if known, actual prior actions and their recorded results, contradictions and missing information. Link key claims to source records.
4. Treat knowledge and similar-ticket matches as candidate evidence. Explain the relevant similarity and differences; a similar symptom is not proof that its previous fix applies. The server retrieves and ranks evidence deterministically; this playbook does not require an embedded LLM.
5. Suggest the next diagnostic action with its purpose and remaining uncertainty. If the employee instead asks to continue existing work, call `ticket_context` with `purpose: continue_work`, emphasizing previous attempts, outstanding items, recorded time and upcoming work. For an upcoming visit, use `ticket_prepare_visit` to gather permitted appointment, contact/site, asset and history data.
6. Change priority, category, owner or schedule only when requested and when the corresponding action is permitted. Review advice alone leaves those fields unchanged.

**Required output:** source-backed current understanding, completed-versus-proposed distinction, recommended next step and relevant scope/completeness limitations. Do not create a new note or time entry merely to record that the assistant looked at the ticket.

**Fictitious example:** “Look into T20260910.0101 before my visit.” The assistant retrieves investigation and visit context and reports: “The employee reported intermittent connectivity. The previous internal note records a cable reseat; no test result is recorded. The appointment is at the permitted site at the returned local time. Check the port error history next.” If only a subset of authorized notes was retrieved, it labels the summary partial instead of saying that no other attempts exist.

**Acceptance:** a malicious historical note cannot trigger a write; partial history remains visible as partial; an inaccessible related record contributes neither details nor hidden counts; investigate and continue-work packages do not silently present identical unbounded dumps.
