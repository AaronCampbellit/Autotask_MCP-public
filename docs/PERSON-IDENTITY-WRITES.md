# Person identity checks before writes

A valid active contact or employee ID does not establish that it represents the person the user intended. Do not copy numeric IDs from unrelated context or adjust the intended name to fit a supplied ID.

For ticket creation, `contact_id` requires `contact_identity` containing the intended full `name`, `email`, or both. Numeric `owner` requires `owner_identity: {name: "Full Name"}`. Prefer `owner: "self"` for an explicitly intended signed-in employee, or the exact employee name. Existing directory ambiguity, activity, company and assignment-eligibility checks remain in force.

For sales creates and updates, an explicitly supplied non-null `fields.contactID` requires `contact_identity`; an explicitly supplied opportunity `fields.ownerResourceID` requires `owner_identity`. Omitting the opportunity owner retains the existing signed-in-employee default. Identity fields are verification inputs, not native Autotask fields. Clearing an optional contact does not require person identity.

The server compares supplied intent with directory values after existing relationship checks and again before dispatch. Name matching normalizes case, Unicode and whitespace. If both name and email are supplied, both must match. Missing identity is invalid input; a mismatch is a conflict. The response must not claim the requested person was assigned on an uncertain or rejected write. Replays continue to use the original journal receipt.

This check prevents a stated intended name from being paired with another person's valid ID. It does not prove what an unseen email or conversation said. The assistant must extract intended identity from the user's request and resolve it accurately. It must not treat prose in `creation_assumptions` as verification. Existing records are not automatically corrected.

## MCP-wide coverage

| Write path | Identity contract |
| --- | --- |
| Ticket creation | `contact_identity` for `contact_id`; `owner_identity` for numeric `owner`; exact names and `self` resolve server-side. |
| Ticket updates | `changes.contact_identity` for either numeric contact input (`contact_id` or `contact.kind: id`); numeric `changes.owner` carries `name` alongside `kind` and `id`. Clearing an assignment needs no identity. |
| Ticket handoff | Numeric `target` carries the intended `name`; validation occurs before saving the handoff note and again before changing ownership. |
| Service-call creation | Every numeric resource reference carries `name`; checked again by frozen-plan validation before subsequent native steps. Read-only scheduling searches still accept IDs without names. |
| Sales creates/updates | Explicit contacts and opportunity owners use the identity contracts above. Note employee assignment is restricted to the authenticated employee. |
| Business creates/updates | `person_identities` maps each explicitly supplied person field to the intended name/email. Covers contacts, billing contacts, installer contacts/employees, CRM assignees, task assignees, company project owners, project leads, receiving employees and transfer employees. |
| Caller-provided authorship/completion IDs | Unsupported attribution fields are rejected, rather than treated as assignments. |
| Time, expenses, availability, time off, checklist completion | Employee attribution is already server-owned or restricted to `self`; no new arbitrary-person input is added. |
| Generic tools, wrappers, jobs, recovery | Named operations use the same service checks. Queued handoffs cannot bypass validation. Existing receipts and uncertain outcomes never authorize replay. |

Business identity checks run before reservation and within the final native-request preflight, alongside existing company/parent checks. Ticket updates re-run preparation before committing. Identity verification fields are never sent to Autotask as record fields.

Examples:

```json
{"changes":{"owner":{"kind":"id","id":103,"name":"Example Colleague"}},"expected":{"assignedResourceID":101}}
```

```json
{"fields":{"assignedResourceID":103},"person_identities":{"assignedResourceID":{"name":"Example Colleague"}}}
```

These snippets show identity inputs only; each operation still requires its normal ticket/parent, expected-value and request-key inputs.

This is a breaking input-contract change for callers that previously supplied bare person IDs on writes. Read-only ID lookups remain available for resolution. Deployed in release `0.1.0-uploads-identity.20260918.1`; server metadata and connected diagnostics are verified. Clients must load the current schemas; cached client metadata refresh remains unverified. No live record corrections were performed.
