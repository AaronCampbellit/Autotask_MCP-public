# Identity, authorization and permissions

**Identity contract**

For Entra, identify an employee by the validated tenant ID and object ID, not display name or mutable email. Store the mapping to an active Autotask resource. New mappings are saved by an authorized operator; email matching can suggest candidates but cannot grant access. Refuse unmapped or inactive members with instructions to resolve the mapping. [Entra authorization](https://learn.microsoft.com/en-us/entra/architecture/authorize-applications-resources-workloads)

Validate the access token signature, issuer, audience, expiry and granted scopes with a maintained library; support signing-key rollover. Apply Entra app assignment and conditional-access requirements during sign-in. Use an application-side active-user/session check so local revocation does not wait solely on a long-lived bearer token. Define and measure the refresh delay for Entra group changes; do not claim instantaneous Entra revocation without evidence.

Keep Autotask API-user credentials server-side. The caller cannot choose a credential profile or impersonation resource. Separate ordinary operational credentials from any required elevated admin credential profile; elevated dispatch requires a specific capability and is audited. Both remain server configuration for the same Rarity instance. Prefer the smallest set of credential profiles that can enforce the intended access.

**Required employee impersonation**

Design input from Aaron's WYRE review: an invalid impersonation ID can be ignored, allowing execution without impersonation. Rarity must not inherit that fallback. WYRE's header mechanism is a starting point; trustworthy employee mapping and operation-specific permission evidence are additional requirements.

Resolve the validated Entra tenant/object identity through the server-owned mapping to an active Autotask resource in Rarity's instance. Validate the resource ID against the API schema and verify the resource exists, is active and is the intended employee. Email/name matching only suggests a mapping; it cannot establish identity. Record the mapping's operator, version and verification time. Neither model arguments nor client headers can select or repair the mapping.

Each operation declares an execution identity mode: `employee_required` or an explicitly reviewed `service_identity` operation. Unknown mode or unknown enforcement evidence blocks enablement. An operation marked `employee_required` rejects a missing, malformed, nonexistent, inactive, ambiguous, revoked or mismatched mapping before dispatching the requested business operation. If current identity validity cannot be established within the configured freshness bound, return an identity-validation-unavailable error and do not dispatch. Never omit the impersonation header, substitute a default employee, or retry under the integration/elevated identity to make the request succeed.

Recheck mapping version/activity at dispatch and before every queued item or retry. A changed mapping stops queued work created under the previous identity; it must not silently transfer that work to a different resource. An upstream impersonation rejection is a terminal authorization failure for that attempt, not a reason to remove the header. Identity checks may perform bounded resource-validation reads; they do not authorize the requested business operation.

Verify impersonation separately for each entity, method and special action. Record whether the API accepts the header, attributes activity to the employee, and enforces that employee's permissions. A successful response or correct creator name proves neither record visibility nor mutation restrictions. Use designated test records/resources to establish allowed and denied cases for both reads and writes. An operation whose employee-permission enforcement is unsupported or unproven remains disabled in employee-required mode.

An explicit service-identity operation is a separate reviewed contract with application-enforced permissions and honest integration attribution. It is never a runtime fallback for failed employee impersonation, and an employee-required operation cannot automatically change modes. This remains an allow/deny design with no approval step.

**Authorization decision**

Effective permission is the intersection of the authenticated principal's scopes, assigned application capabilities, target-record scope, field policy, operation state, credential permissions, and Autotask's own restrictions. Native impersonation is another enforcement layer where supported, not a substitute for these checks. Re-authorize immediately before dispatch and before each batch item.

Every registry entry must declare a policy resolver. Resolve a ticket child through its parent ticket/company; a task through its project/company; a contract line through its contract/company; a resource-only record through its owner/team scope. If the chain cannot be resolved, deny rather than assuming global access. This applies to arbitrary direct IDs, indirect references, caches, pagination, counts, exports and file downloads.

**Proposed permission vocabulary**

| Capability family | Examples |
| --- | --- |
| operational.read | Ticket, task, contact, asset, knowledge reads within assigned scope |
| tickets.write | Routine ticket edits, notes, assignment and checklist changes |
| time.self / time.team | Own or delegated time operations; separate correction permissions |
| scheduling.write | Own/team service-call and appointment management |
| crm.write / projects.write | Scoped domain edits |
| finance.read / finance.write | Sensitive financial reads and financial mutations |
| procurement.write | Purchase/receiving/stock workflows; financial fields also require finance.write |
| configuration.write | UDFs, supported reference settings and resource administration |
| bulk.execute | Bounded multi-record execution, in addition to every underlying domain/action permission |
| entity.delete / access.manage | Scoped deletion and identity/access changes; separately assignable from ordinary edits |
| platform.manage / audit.read | MCP administration and audit retrieval |

Capabilities are server-owned identifiers. OAuth scopes may aggregate them into a manageable number of consent scopes; a broad OAuth scope must not bypass the finer policy. Field restrictions include query/filter/sort/aggregate access, not only response redaction, to avoid leaking protected costs through counts or ordering.

**Confirmed write policy**

| Operation | Default treatment |
| --- | --- |
| Requested routine status/title/description update | Execute after validation and authorization |
| Requested internal/external note | Execute; make audience explicit in result |
| Requested own unposted time creation | Execute with resolved role/work type and recorded resource |
| Routine assignment or scheduling | Execute within scope after conflict checks |
| Multi-record mutation | Execute with bulk.execute and all underlying action/record/field permissions |
| Delete, irreversible action, account/access change | Execute with the specific delete/action/access capability |
| Rates, prices, costs, contract quantities, invoice-affecting changes | Execute with finance.write and the specific domain/action permissions |
| Posted/billed time correction | Execute only with correction permissions and a supported upstream state |
| Read/export | Authorized read; large/sensitive exports may need an explicit export capability |

Changing a billable ticket's innocuous title is not automatically a financial mutation. Classify the requested fields and downstream effects, not merely the entity name. A bulk operation cannot avoid its permission checks by selecting a different wrapper. Track related rapid mutations and expose an operator guard for unexpected write bursts; do not claim perfect detection of a malicious client splitting a batch into individual calls.

**Direct execution contract**

The MCP makes an allow-or-deny decision for every requested action. It does not create approval proposals, return approval links, wait for confirmation, or support self/second-person approval. A permitted, valid request enters the journal and dispatch path immediately, or a durable job when its size requires background execution. A denied request returns a safe permission error; no other person can approve that request into execution. An access administrator can separately change a role binding within their administrative authority.

Validation still resolves exact targets, required fields, current state and applicable API restrictions. Missing or ambiguous input produces an input error or clarification, not an approval flow. Optional validation/dry-run output is available when requested, but never a prerequisite or a grant of authority. A later execution independently validates and authorizes its own payload.

For bulk execution, resolve a bounded fixed target set, check the entire set before dispatch, and store immutable payloads and stable per-item request keys in the job/journal. Reject mixed-permission requests before starting; recheck each item when it is dispatched. Subsequent revocation or state changes can stop remaining work, with completed items reported honestly. Newly matching records are not silently added. Cancellation stops undispatched work and never claims to undo completed API calls.

At dispatch, recheck user activity, capabilities, scope, metadata and current values. Stale preconditions fail with a conflict; a changed payload needs a new request key. These checks protect correctness and do not create a human confirmation requirement.

Autotask-native approval entities and business-state rules remain supported where the API permits them; the caller needs the relevant business capability. Client-side confirmation settings are controlled by Codex, ChatGPT or Claude and their administrators. The MCP adds no approval layer and does not bypass client or upstream controls.

**Audit and attribution**

Record the human requester, actual Autotask resource/credential profile, application/client identity when reliably available, target IDs, sanitized diff, result, verification, policy version and correlation ID. Keep the native Autotask creator attribution distinct from our execution audit; updates may not alter a creator field. Never report that a technician performed an action natively when only the integration identity is available.

**Failure cases to prove**

Unmapped user, wrong Entra tenant, token for another audience, stale group assignment, direct foreign-company child ID, forbidden financial filter, inactive resource, revoked write capability, requester lacking finance scope, payload substitution, duplicate dispatch, concurrent permission revocation, and a queued job whose requester has been disabled. Each must fail without a broader-credential fallback or disclosure of a prohibited record.
