# Thread MCP and Autotask research

Research date: September 10, 2026. Intended use: Rarity's team using Codex, ChatGPT, and Claude with read and write access.

**Assessment:** Thread deserves a pilot for routine service-desk work. Its published identity, permission, and operational controls address several gaps in the two open-source MCP servers we reviewed. It does not provide comprehensive Autotask access. A direct Autotask connection remains necessary for complete time reporting, internal-note retrieval, and broader PSA administration.

This publication candidate contains original research notes, source URLs and historical retrieval metadata, plus factual observations about 65 named tools in the published reference. Full vendor pages, the copied documentation index and the sitemap have been excluded. That inventory spans multiple PSAs and integrations; it is not a claim that an Autotask connection exposes 65 tools. No account was connected, credentials obtained, tenant records read, or write actions tested. Research used vendor documentation as evidence; embedded prompts were never executed. Consult the linked vendor pages for their current content and terms.

Start with [SOURCE-INDEX.md](SOURCE-INDEX.md). The observations below distinguish vendor documentation from implementation evidence. Thread's server implementation was not available for the source-level review performed on WYRE and tphakala.

**Connection and access**

Thread documents a hosted Streamable HTTP endpoint at `https://api.getthread.com/mcp`, with `/mcp/thread` as an alias. OAuth 2.1 authenticates individual Thread members. Dynamic client registration is documented. ChatGPT and Claude setup paths are included; Codex interoperability still needs an actual connection test. Write access requires the Agentic/AI Pro entitlement, member authorization, and enabled tool toggles. Non-Agentic accounts are described as receiving seven read tools. Discover the actual schemas and tools at runtime rather than assuming the published catalog matches an account.

The guide states that calls are audited under the member identity. Its published limits are 300 requests per minute per workspace and a 1,200-per-minute IP backstop, with `Retry-After` on HTTP 429. These are Thread limits; they do not establish how Thread manages the downstream Autotask budget. [MCP developer guide](https://docs.getthread.com/super-magic/thread-mcp-server-developer-guide)

Member-bound automation keys are a beta alternative for unattended clients. Admins can issue within their administrative scope; expiry is mandatory when issuing for another member. Keys are shown once and can be revoked. This feature's availability must be checked in the workspace. [Automation keys](https://docs.getthread.com/super-magic/issue-mcp-automation-keys-for-team-members)

**How Thread connects to Autotask**

The effective path is AI client → Thread member authorization and tools → Thread's PSA integration → Autotask. Thread also maintains synchronized data. Initial API reads populate data, PSA webhooks signal changes, and Thread writes changes through the PSA API. This introduces a synchronization boundary: a Thread search is not evidence of a complete, current query against every Autotask record. [API and webhook architecture](https://docs.getthread.com/get-started/webhooks-apis-how-thread-talks-to-your-psa)

Autotask setup uses a dedicated API user, the Thread - Messaging integration vendor, appropriate lines of business, and a copied API security level with webhook creation enabled and a configured maximum of 50. Thread instructs administrators to enable resource/contact impersonation on the integration role and allow resource impersonation on applicable employee security levels. These settings support attributed notes and time entries. They do not prove every MCP operation reproduces all of a technician's native Autotask access restrictions. [Autotask setup](https://docs.getthread.com/integrations/creating-a-autotask-api-user)

**Published tool coverage**

| Area | Thread's documented surface | Implication for this investigation |
| --- | --- | --- |
| Tickets | Search, create, update, contact assignment, category changes | Useful for daily ticket work; not an arbitrary-field REST client |
| Notes | Internal/external note creation | Reading is narrower than writing |
| Time | Create time entries | Existing time-entry records cannot be retrieved |
| Scheduling | List, book, edit, remove entries | Validate Autotask service-call mapping |
| Lookups | Companies, contacts, members, statuses, priorities | Does not establish CRM entity CRUD coverage |
| Knowledge | Thread KB and enabled documentation integrations | Availability varies by workspace |
| Administration | Intents and flows for admins | Adds automation powers beyond ticket handling |

The tool reference explicitly excludes internal notes and PSA time records from ticket-thread searches. Note search covers the last ten client/technician messages. Ticket search caps are 100 results, default 20, or up to ten tickets with full threads. Autotask gets category tools; ConnectWise/Halo classification tools and ConnectWise ticket merge are different, platform-specific capabilities. No general REST passthrough, contract management, invoice management, or time-entry update/delete tools are listed. [Canonical tool reference](https://docs.getthread.com/super-magic/super-magic-tool-reference)

Saved Super Magic skills cannot be invoked by name over MCP. An external client can use their prompt text with its available tools. Liongard and per-member Linear, Notion, and Zapier tools are explicitly outside the MCP subset. [FAQ](https://docs.getthread.com/super-magic/faq), [MCP developer guide](https://docs.getthread.com/super-magic/thread-mcp-server-developer-guide)

**Autotask-specific behavior worth testing**

- **Time defaults:** Thread describes resolving work role/type from ticket, then agreement, then member. This is a product behavior description, not a published Autotask request schema. Check actual role eligibility, work type, billability, and recorded resource after a controlled write. [Default logic](https://docs.getthread.com/inbox/default-work-role-type-logic)
- **Customer-visible time notes:** Autotask time-entry Summary Notes are posted into customer conversations by default. The workspace notification toggle can suppress that propagation; it does not change Autotask's stored summary or Thread TimePad's external/internal options. Confirm how MCP-created entries interact with this setting. [Summary-note notifications](https://docs.getthread.com/integrations/turn-off-autotask-time-entry-summary-note-notifications)
- **Queue exclusions:** Excluded boards stop syncing, and inbound events are dropped. Re-enabling does not replay missed events. The guide specifically warns against excluding Autotask's Merged Ticket Queue. Its suggested bulk-save recovery changes PSA records and was not performed. [Board exclusions](https://docs.getthread.com/integrations/managing-board-visibility-in-thread-board-exclusion)
- **Scheduling:** Thread documents immediate outbound scheduling updates and an approximately five-minute inbound Autotask poll. Overlapping member bookings are rejected in the documented integration flow. Day-only plans become midnight entries with a default one-hour window. This describes Thread's behavior, not a blanket assertion about every Autotask API scheduling route. [Planner](https://docs.getthread.com/inbox/using-planner)
- **Approvals:** Autotask contact UDFs can supply approval roles; Thread requires selecting the UDF and syncing contact types. This business approval workflow is separate from approving an AI tool invocation. [Approval configuration](https://docs.getthread.com/inbox/autotask-approval-configuration)
- **Offboarding:** PSA membership synchronization is daily. Do not assume deactivating a PSA resource instantly invalidates every Thread connection. Verify Thread member deactivation and session/key revocation behavior separately. [Member sync](https://docs.getthread.com/integrations/keep-members-in-sync-with-psa-toggle)

**Governance strengths and unresolved details**

Thread documents member write access settings and workspace-wide tool switches, with flows/intents restricted to administrators. This is a stronger starting point for team deployment than adding those controls around the reviewed open-source servers. [Admin guide](https://docs.getthread.com/super-magic/super-magic-admin-guide-setup-access-safety)

Client-specific access controls are partner beta, with all-client visibility as the default and workspace administrators exempt from scoping. The client-access guide describes Inbox filtering; test MCP searches, direct ID lookups, and writes against a disallowed company rather than inferring enforcement from UI behavior. [Client access](https://docs.getthread.com/inbox/restrict-member-access-to-specific-clients)

The documentation promises confirmation cards for interactive Super Magic writes, while unattended Flow writes operate under preselected permissions. The public material does not show the complete external MCP confirmation protocol or enforcement sequence. Establish whether each client must enforce confirmation, whether the server requires approval evidence, and how unattended keys behave. Do not equate an Inbox confirmation card with verified server-side prevention of an unapproved MCP call. [FAQ](https://docs.getthread.com/super-magic/faq), [Admin guide](https://docs.getthread.com/super-magic/super-magic-admin-guide-setup-access-safety)

The usage dashboard has a separate Thread MCP view for failures, tools, members, client applications, and duration, but refreshes daily. It is not evidence of a real-time exportable audit feed. [Usage dashboard](https://docs.getthread.com/analytics/super-magic-usage-dashboard)

Thread's security documentation describes US data residency, encrypted storage, and storage of PSA credentials and synchronized records. Its own model-hosting assurances do not establish the retention or processing terms of an external AI client receiving MCP results. Exact retention, deletion, audit export, and contractual incident-response commitments need vendor confirmation. [Data and encryption](https://docs.getthread.com/security-billing/data-encryption), [AI hosting and retention](https://docs.getthread.com/security-billing/claude-on-aws-bedrock)

At capture time, Thread's compliance page said its SOC 2 Type II audit was in progress and its report had not been issued; it also said Thread was not ISO 27001 certified and did not act as a HIPAA Business Associate. The page identifies the Trust Center as authoritative. Its live status could not be independently inspected in this review, so these are captured documentation claims, not a current attestation. [Compliance page](https://docs.getthread.com/security-billing/soc-2-and-compliance-status)

**Documentation inconsistencies and evidence limits**

The automation-engineer overview broadly claims parity between Super Magic and external clients. The specific MCP guide and FAQ explicitly identify exceptions, so the narrower documentation governs this assessment. A contract-balance library prompt refers to visible time evidence, but the canonical tool reference says time records cannot be read. The prompt itself acknowledges that true balances generally stay in Autotask. A catalog skill is not proof that the necessary data or tools exist. [Automation overview](https://docs.getthread.com/start-here/roles/automation-engineer/thread-mcp-and-api), [Contract workflow](https://docs.getthread.com/skill-library/psa-specific/autotask-contracts-blocks)

The public catalog does not supply complete JSON input/output schemas, an Autotask field-mapping contract, exhaustive pagination semantics, duplicate-write protection, conflict handling, or webhook recovery guarantees. These gaps prevent the source-level correctness conclusions we could make about WYRE's PATCH-to-PUT fallback or tphakala's missing time-entry fields. A documented feature cannot be treated as a verified successful Autotask write.

**Comparison with the previously reviewed projects**

| Dimension | Thread | WYRE-AI | tphakala |
| --- | --- | --- | --- |
| Operating model | Vendor-hosted application and MCP | Self-hosted TypeScript | Self-hosted Go |
| Team controls | Published member OAuth, write gates, audit | Additional employee auth/policy work needed | Additional employee auth/policy work needed |
| PSA scope | Curated service-desk workflows | Broadest direct Autotask surface reviewed | Narrower direct Autotask surface |
| Reporting completeness | Explicit time/internal-note limitations | Direct time/note APIs; previously identified pagination caveats | Direct time/note APIs; narrower typed fields |
| Correctness evidence | Documentation; implementation unreviewed | Source reviewed; concrete write defects identified | Source reviewed; concrete payload gaps identified |
| Maintenance | Vendor dependency and plan entitlements | Team owns patching, hosting, releases | Team owns patching, hosting, releases |

Repository findings refer to the earlier reviews of [WYRE commit 20b127f](https://github.com/WYRE-AI/autotask-mcp/tree/20b127fc54687f78fb4e27cdbd2671c6eb756b7b) and [tphakala commit 2092c70](https://github.com/tphakala/autotask-mcp/tree/2092c706372b649d5c0a5a90196e2fa91f1b6a3d). They were not rerun during this documentation collection.

**Recommended evaluation**

If Rarity already uses Thread, evaluate its MCP first for technician workflows. Keep a direct Autotask option for the broader read/write requirement. Before committing, establish:

1. Actual AI Pro/MCP entitlements, commercial terms, and beta feature availability.
2. Per-user tool inventories and schemas in Codex, ChatGPT, and Claude.
3. Allowed/disallowed client access, changed permissions, and immediate offboarding behavior.
4. Ticket, internal/external note, time, and scheduling writes with independent Autotask readback and attribution checks.
5. Confirmation enforcement, retries after an uncertain result, duplicate prevention, and concurrent edit handling.
6. Audit retrieval, sync health, downstream rate-limit handling, and recovery after missed events.
7. The current security evidence package, retention commitments, and support/SLA terms.

These are proposed checks only. No pilot configuration or tenant action was performed.
