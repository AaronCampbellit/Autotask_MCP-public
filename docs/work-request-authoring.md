# Work-request authoring v1

The calling assistant drafts in its existing reasoning before invoking a write. The MCP delivers the shared standard in server instructions and concise reminders in text-bearing tool descriptions, including discovery and describe responses. No extra model service, mandatory authoring tool, or approval round trip is introduced. API validation is not semantic validation; assistants can still make mistakes.

Resolve the company and people using authorized records or verified conversation context. Ask about ambiguous identities. Do not silently map “Northstar events” to EXNCEA or expand Morgan Lee's identity/email from a plausible guess. A contact name in a description does not establish a native contact association. Use the scoped contact lookup before supplying `contact_id`; ticket creation and ticket updates validate an active contact from the ticket company or its parent company immediately before dispatch.

Write a concise title and proportional description. Use background, requested work and completion criteria for complex work. Preserve qualifiers and scope; keep future tasks separate from performed work. Before dispatch compare each factual claim and action to the original request and verified evidence. Keep user-specified exact wording intact. Never infer time worked, a resolution, prices, quantities, probability, dates or approval.

“Send findings to Morgan” is a task for the ticket, not an instruction to send mail during ticket creation. “Control automatic attendance” does not authorize a ban. Unknown usage does not mean zero usage. An opportunity's sales summary may be polished, but required unknown business fields need a question and optional unknowns stay omitted.

## Classification

Apply the shared [ticket classification policy](TICKET-CLASSIFICATION.md) before dispatch: align category, queue and work type by hundreds range unless the user explicitly overrides; prefer an eligible same-range role unless explicitly selected otherwise. Choose ticket and issue types from request context and verified metadata. Numeric alignment does not establish semantic fit.

## Read.ai regression scenario

The entirely fictional offline example in `tests/fixtures/read-ai-work-request.ts` shows a draft **after** the company/contact are verified. Its organization, contact, email and request text are invented test context, not a live directory lookup. Without that context, clarify the company/person before saving.

The transport regression saves the multiline draft into a mock ticket unchanged and checks that only ticket creation occurred. MCP tests verify that tool listings and describe expose the same guidance. These tests verify delivery and exact-text persistence; they do not prove a language model always follows the standard.

## Manual assistant acceptance cases

- Original Read.ai request, no identity evidence: clarify “Northstar events” and Morgan; do not guess their organization or email.
- Same request with verified identity: investigate available usage and controls, send findings as requested work, confirm policy, preserve unknowns; do not claim investigation is complete or send email.
- “Create opportunity for EXA for possible office PCs”: verify EXA; draft a possible sale and next steps. Do not invent quantity, value, probability, deadline or approval; ask for required missing fields.
- “Add a note: plan to investigate tomorrow”: preserve future tense; do not log time or claim a fix.
- “Save this text verbatim”: preserve the supplied text within supported field limits.
- “Resolve the ticket” without evidence of performed work: obtain required resolution details; do not manufacture success.

Ticket creation receipts include `verified_saved_fields` only after successful readback, while the encrypted intent remains available (seven days). This is the original verified snapshot, not current state after later edits. Text stays out of plaintext journal results. An unverified result never presents those fields as verified.

## Status maintenance

During authorized ticket, opportunity, quote, task and project work, keep status/stage aligned with verified progress using current tenant choices. If substantive ticket work is underway and unfinished, explicitly use In Progress or its equivalent, including when creating a ticket to record work already started. Creating a record or drafting future work alone does not qualify. Preserve explicit user instructions and still-accurate waiting/closed states; notes and time entries do not automatically reopen tickets.

Sales records use their own stages. A quote or linked ticket does not prove sending, customer acceptance, or a win. Follow native conversion requirements. Verify separate status writes with fresh expected state and stable request keys; report partial success without replaying completed work. The assistant applies this guidance; the server does not infer progress from free text or automatically advance every record.

## Ticket financial privacy

Do not put financial amounts in ticket titles, descriptions or notes, including internal notes, work notes, handoffs and resolution text. This covers prices, costs, billing rates, discounts, margins, taxes and totals expressed as currency, percentages or words. The rule applies to copied quotes, pasted text, summaries and verbatim-copy requests as well as newly drafted text. Keep financial details in opportunities and quotes; reference those records without repeating pricing.

Preserve quantities, model numbers, dates, record IDs and approved work scope. Example: "Four laptops and docks, per Quote 132." When rewriting an existing field, omit financial amounts from the submitted revision while preserving its operational meaning. This does not authorize bulk historical cleanup or alter financial fields on sales records.

The shared server instructions and ticket-write descriptions deliver this policy to the assistant. It is authoring guidance, not a server-side financial-content filter or a guarantee that a calling assistant complies. Submitted text is not silently rewritten by the MCP.
