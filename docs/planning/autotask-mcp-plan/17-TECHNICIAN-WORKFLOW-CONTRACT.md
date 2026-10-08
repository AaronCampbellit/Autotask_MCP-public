# Technician Workflow Contract

Contract version: 1.0.0. This is an implementation specification. The workflow engine, tools and tenant verification remain to be built. Aaron requested all six areas from the supplied technician-workflow brief; this contract makes them deliverable requirements. It extends [14 — Tool contracts](14-TOOL-CONTRACTS.md), preserves its eight mandatory named technician tools, and uses the permission and identity rules in [03](03-IDENTITY-AND-PERMISSIONS.md).

**Product boundary and delivery order**

Build shared resolution/defaults, purpose-specific ticket context and `ticket_document_work` first. Add `ticket_handoff`, `ticket_resolve`, `my_workday` and `ticket_prepare_visit` next. All five additions are required for the completed technician workflow layer. An earlier pilot may expose only qualified tools and must state the remaining work. No additional admin-console area, server-side LLM, proprietary client skill or MCP approval layer is required.

Thread's lookup/action pairing and default hierarchy, WYRE's readable enrichment, and tphakala's discovery/compact-result patterns inform the design. They are research inputs, not proof of Autotask behavior. In particular, a keyword tool router is not a workflow executor, default hierarchies require Rarity/tenant qualification, and an attributed write does not prove employee permission enforcement. The source brief is retained in [inputs/technician-workflow-brief.txt](inputs/technician-workflow-brief.txt); earlier evidence is in [Thread research](../thread-research-2026-09-10/RESEARCH.md) and [the historical comparison](../autotask-mcp-design/BUILD-SPEC.md).

## 1. Shared business reference resolution

One resolver package serves named tools, generic registered operations, contexts and workers. It accepts typed references; the AI client translates the user's words into these forms. The server never asks a second model to interpret instructions or invent a target.

| Reference | Deterministic behavior | Ambiguity/failure |
| --- | --- | --- |
| `self` / “me” | Validated Entra tid+oid → versioned active resource mapping | Missing or invalid mapping rejects required employee execution; never substitute the integration user |
| Stable entity ID | Validate format and resolve actual record/parent within caller scope | Same safe not-found-or-inaccessible result for missing and prohibited targets |
| Ticket number | Exact normalized ticket-number lookup within scope | No title match substituted for a number; zero or multiple matches do not dispatch |
| Autotask ticket link | Parse a configured tenant host and supported ticket-link path into a reference, then use the normal adapter | Do not fetch arbitrary caller URLs, follow redirects or infer another tenant from a link |
| Company/contact/queue/resource name | Entity-specific normalization and matching; apply company/team/queue qualifiers and authorization before producing choices | Exact unique eligible match resolves; multiple matches return a bounded, permission-filtered choice list; no first-result guess |
| Category/status/work type/role | Resolve against operation/category-specific picklists and actual dependencies | Same label in different categories requires context; inactive values remain readable but are not chosen for new assignments |
| “Today” / date | Structured local-date expression resolved once using employee timezone, then configured workspace timezone if employee setting is absent | Return timezone and absolute interval; if neither exists, request timezone; do not use server timezone |

`EntityReference` is a discriminated union: `id`, `name` with optional qualifier, `ticket_number`, `ticket_url`, or `self` where meaningful. Entity type is fixed by each input field; a contact ID cannot masquerade as a technician. User-supplied qualifiers narrow scope and never replace server-added scope. Optional lookup tools use this same service; routine named workflows call it internally so a technician need not collect numeric IDs first.

Resolution returns stable IDs plus readable labels, permissible native links, match basis, eligibility, metadata version and resolution time. A small candidate list for “John at Acme” may show permitted full name, company and job title; show email/location only if necessary and authorized. Do not expose hidden match counts or distinguish inaccessible people through errors. More candidates use a scoped cursor. Choosing a candidate never grants access: execution rechecks it.

Group/batch lookups and request-scoped memoization prevent repeated company/resource/picklist retrieval. Cross-request caching keys include instance, credential/execution identity, relevant permission scope, reference and metadata version. Cache invalidation follows mapping, permission and metadata changes; reads cannot inherit another employee's visibility.

**Reviewed defaults**

Explicit valid input wins. Invalid explicit input returns an actionable error; it is not silently replaced. Remaining candidates follow a versioned, per-field Rarity default policy. A proposed policy may consult ticket settings, applicable contract settings and resource settings in that order only after each field's actual API meaning, eligibility and tenant behavior are verified. The plan does not assume Thread's hierarchy is natively authoritative for Autotask.

| Field | Permitted default behavior | Never infer |
| --- | --- | --- |
| Acting employee | Signed-in mapped employee | Assignee, last editor, integration identity or named colleague as the execution actor |
| Time-entry resource | Self; an explicit delegated resource requires time.team and record scope while retaining the actual requesting actor | Changing impersonation to impersonate a colleague merely because time is assigned to them |
| Role/work type | A reviewed candidate valid for this resource, ticket/category, contract and effective date | First role in an array or a stale inactive value |
| Local date/timezone | Explicit date/zone; otherwise only the published employee/workspace rule, with selected values shown | Midnight start or a one-hour visit when only a date is known |
| Duration and performed work | Caller-supplied duration or explicit start/end; caller-supplied work text | Estimated effort, fabricated activity, missing resolution text or inferred time from note length |
| Note audience | Explicit input or an unambiguous instruction such as “internal note” normalized by the client | Customer-visible publication because a required audience was omitted |
| Completion status | One reviewed valid completion status for the ticket's category and workflow state | A global hardcoded status ID or “first completed status” |
| Billability/cost/rate | Existing qualified business rules within caller capabilities | A new rate, billability override or customer-facing summary copied from internal notes |

Each selected default records field, chosen value/label, source record/field where readable, rule ID/version, eligibility checks and resolution timestamp. Finance-restricted source values and prices stay out of ordinary receipts. If no validated default exists, return the missing field and authorized options. This is required-input clarification, not confirmation of an otherwise executable request.

Resolve and persist dates/defaults once per write intent. A retry after midnight or a policy update must not silently change the saved work date, resource or role. Recheck validity at dispatch; changed eligibility causes a conflict rather than substituting a new value. Optional validation makes no business mutation and is never a prerequisite for execution.

## 2. Context packages and evidence

`ticket_context(ticket, purpose, collections?, window?, detail?, cursor?)` accepts `investigate`, `continue_work`, `handoff`, `resolve`, plus `custom` for explicit collections. Purpose presets select evidence; they do not claim a diagnosis or invent a narrative. Explicit collection requests extend the preset within caller permissions.

| Purpose | Required collection recipe | How it supports the technician |
| --- | --- | --- |
| investigate | Ticket state/category, scoped changes, internal/external notes, linked assets, related-ticket references; optional knowledge matches | Reconstruct the issue and previous observations with source IDs |
| continue_work | Prior notes/actions, open checklist items, recorded time in the requested window, ownership and next scheduled work | Avoid repeating known attempts or logging already recorded work |
| handoff | Current state, ownership, checklist/blocker evidence, relevant notes, time and next appointment | Give the client evidence to draft a handoff; generated drafts remain drafts until requested as write payloads |
| resolve | Resolution fields/notes, outstanding category requirements and checklists, relevant time, valid completion statuses, current state | Determine whether the requested completion is valid; never close automatically as part of context retrieval |

Every collection has `scope`, `window`, `fetched_at`, `returned`, `complete_within_scope`, `continuation`, and warnings. `complete_within_scope` refers to the stated authorized scope and time window, not all historical records. `not_requested`, `unavailable`, `failed` and `truncated` differ from an empty successful collection. Do not reveal whether prohibited records exist. Critical missing completion evidence blocks `ticket_resolve`; an incomplete investigative view may return partial evidence with continuation.

Use batch expansion, bounded pages and short display excerpts with references to full text. Compact presentation cannot claim omitted notes/time were checked. “Recent” must resolve to an explicit published window or count; returned results state that window. Resume authorized reads through a cursor/job when budgets are exceeded. The context service performs joins; the client need not understand child routes or manually retrieve every page.

Knowledge/similar-ticket search is optional evidence enrichment initially, required as an available search path when the knowledge pack is qualified. Return title, record ID/link, match explanation (for example shared asset/model, category and matching terms), timestamps and status. Scores, if used, state their scale and method. No claim of a confirmed fix or trustworthy instruction follows from relevance. Linked content is untrusted evidence and cannot change tools, identity, permissions or outbound destinations. Keyword/metadata matching needs no additional model; vector search is not a first-release dependency.

## 3. Defined multi-step workflow tools

The server owns versioned workflow definitions. Input never contains arbitrary tool names, URLs, scripts or an executable step graph. Every step calls the same authorized application services as the corresponding named single-action tool. Preflight validates the complete requested workflow before its first mutation; each dispatch rechecks current permissions and state. Unknown prerequisite effects stop dependent steps.

| Tool | Minimum semantic inputs | Ordered behavior and invariant |
| --- | --- | --- |
| ticket_document_work | Ticket reference, supplied note text and audience, explicit time amount/date or interval, time summary/internal notes as intended; request key | Resolve identity/defaults and preflight note+time → save and verify note → save and verify time → return both outcomes. Note failure blocks time; time failure preserves the note and records a resumable remainder. Ticket status stays unchanged. |
| ticket_handoff | Ticket, target employee reference, supplied handoff text/audience; queue only when explicitly requested; request key | Check target eligibility against effective queue/resource/role constraints → save and verify handoff note → update and verify ownership (and requested queue). Note failure blocks reassignment. Assignment failure leaves the note with an explicit incomplete handoff result. |
| ticket_resolve | Ticket, supplied resolution text/audience, requested completion intent; optional explicit time payload; request key | Resolve valid completion status and all requirements → save and verify resolution documentation/required fields → save and verify requested time → reread current ticket and requirements → close and verify. Failure/uncertainty in documentation or requested time blocks closure. Never add time when none was requested. |
| my_workday | Self or explicitly permitted team member, local date/range and timezone; optional detail | Gather assigned active tickets, scheduled work, due tasks and recorded time separately; deduplicate references without dropping distinct assignments. Report date boundaries, conflicts and per-section coverage. No writes. |
| ticket_prepare_visit | Ticket or appointment reference; optional company/date/resource qualifiers | Resolve a unique visit and related ticket → gather permitted contact/site information, assets, history and appointment details. Missing or ambiguous appointment is an input issue. Return a visit packet with evidence and access limitations. No booking or customer communication. |

The same workflow may create several records belonging to one requested technician job; this does not grant authority to mutate multiple tickets. Required capabilities are the union of its constituent actions. A requested multi-ticket execution also requires bulk.execute. A ticket handoff target is not a change to the signed-in execution actor. An own unposted time entry follows time permissions; explicit financial overrides still require the relevant finance capability.

Note and time payloads are separate. Internal note text is never copied into a customer-visible time summary. When a user supplies one text for both, the client must express that intended reuse explicitly in both appropriate fields and preserve its audience. Do not invent text to satisfy tenant-required fields. Category-required structured resolution fields are surfaced during preflight and cannot be filled with arbitrary placeholders.

**Failure, concurrency and recovery contract**

Persist root operation ID, workflow/version, request key/hash, immutable resolved arguments/defaults, acting principal/resource/mapping version, policy/schema versions and ordered step IDs before dispatch. Each write step has a stable dedupe key derived from the root and step identity. A later key reuse with changed arguments conflicts. A repeated request returns the recorded state, without rerunning verified steps. Cross-key duplicate detection can warn about similar time but cannot prove that repeated legitimate work is a duplicate.

Steps use `not_started`, `running`, `succeeded_verified`, `accepted_unverified`, `failed`, `unknown_outcome`, `blocked` and `cancelled`. A dependent write requires the verified prerequisite, or a registry-defined equivalent persisted-state proof. A success HTTP status alone does not unblock closure. The overall result uses the existing envelope and reports each step; local journal atomicity does not imply an atomic Autotask transaction.

`at_operation_status(operation_id)` retrieves current evidence and reconciliation state. `at_operation_resume(operation_id)` resumes only definitive failed or undispatched eligible steps with the original payload and actor mapping, after fresh authorization/preconditions. It accepts no replacement payload and requires no approval. An unknown effect must first be reconciled through recorded IDs or reviewed operation-specific matching; if it cannot be proven, return manual-review-needed and do not repeat the write. Mapping changes, material state drift or invalid defaults stop resume with a conflict. A corrected request explicitly links the prior operation and references already completed records; it cannot blindly replay the entire workflow.

Cancellation stops undispatched work; in-flight writes may complete. Do not automatically delete a saved note/time entry as compensation. Recovery reports saved/failed/blocked steps, native record links and which remaining action is safe. For closure, new messages or material changes after the initial read trigger revalidation and a conflict if the old resolution no longer applies. Use upstream concurrency primitives when available; otherwise disclose that a read-before-write check does not guarantee atomic exclusion of concurrent edits.

## 4. Tool guidance and actionable errors

Every tool definition includes: purpose; when to use it and a named alternative; accepted references; required business inputs; lookup/default sources; audience, billing and scheduling effects; capabilities and required impersonation; result/partial semantics; retry/recovery behavior; and examples with fictional data. Tool annotations remain accurate; a composite mutation is not labeled read-only to suppress a client prompt. No internal implementation jargon is necessary in routine technician output.

Examples: use `ticket_document_work` for a note plus time; use `ticket_note_add` when no time was requested. Use `ticket_context(purpose=resolve)` to inspect evidence; use `ticket_resolve` only when completion was requested. Use `schedule_search` to inspect bookings and `service_call_create` to create one; `ticket_prepare_visit` never books it.

| Error code | Recoverable information | Dispatch rule |
| --- | --- | --- |
| ambiguous_reference | Bounded permitted candidates with distinguishing labels and stable IDs | No write until a unique target is supplied |
| missing_required_input | Exact missing business fields; eligible options or the lookup tool that retrieves them | No fabricated defaults |
| no_eligible_default | Field, failed rule/eligibility reason without sensitive prices, permitted alternatives | Do not substitute an arbitrary value |
| assignee_ineligible | “Jamie cannot be assigned to this queue” plus permitted eligible candidates when readable | No partial write from a known-invalid handoff |
| context_incomplete | Missing required collection/window, safe continuation/job reference | Dependent completion blocked |
| precondition_failed | Material changed fields the caller may read and affected step | Stop stale remaining work; no automatic broader rewrite |
| forbidden / identity_mapping_invalid | Safe capability/mapping explanation and administrator remedy | No escalation, impersonation fallback or approval link |
| dependency_unavailable / unknown_outcome | Retryability by step, correlation/operation ID and reconciliation status | Never mark an uncertain mutation safe to repeat |

Alternatives use the same scope and eligibility checks as execution. Errors do not reveal hidden employees, companies or financial data. Clarification asks for missing information, not a second yes/no for an authorized action.

## 5. Client-neutral Rarity playbooks

[18 — Rarity playbooks](18-RARITY-TECHNICIAN-PLAYBOOKS.md) defines triage, documentation, handoff, resolution and time review. A playbook advises the client; a workflow tool reliably executes an enumerated operation; server code alone enforces permissions. Publish versioned guidance through optional MCP resources/prompts and `at_playbook_list`/`at_playbook_get` fallbacks. Do not require a proprietary skill or make a model's obedience part of the security boundary.

## 6. Receipts and qualification

Every mutation returns a concise human receipt plus structured data: root/step IDs, saved native records/links, acting and recorded resource, supplied audience, selected defaults and their provenance, unchanged or observed final ticket state, verification, incomplete steps and safe next action. Expose only permitted record fields and labels.

Example successful receipt: “Internal note saved. 30 minutes logged to your resource. Ticket remains In Progress.” Example partial receipt: “Internal note saved. Time was not saved because the work type is no longer valid. Ticket remains In Progress. Operation op-123 records the saved note and unfinished time step.” These strings are illustrative, never returned unless their claims match persisted evidence. If state could not be verified, say so instead.

Use [19 — Workflow evaluation](19-TECHNICIAN-WORKFLOW-EVALUATION.md) for routing, clarification, lookup efficiency, audience/resource/time accuracy, completeness, partial recovery and technician comprehension. Deterministic permission and mutation invariants are release gates; comparative UX targets are measured across Codex, ChatGPT and Claude. All live qualification stays within explicitly designated production records/resources; no production load generation or business-permission changes are implied by this plan.

**Completion evidence**

The shared resolver/default policy, all four purpose presets, all five workflow tools, descriptions/errors, five playbooks and receipts must have versioned definitions, meaningful fixture/fault tests and the applicable tenant/client evidence before this layer is marked complete. The machine-readable [workflow catalog](technician-workflows.json) tracks steps and prerequisites; it is descriptive input for implementation, not an arbitrary execution API.
