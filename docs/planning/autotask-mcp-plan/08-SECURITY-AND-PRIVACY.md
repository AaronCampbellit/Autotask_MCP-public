# Security and privacy design

This document describes required product controls and validation. It does not certify the implementation or assume a specific compliance obligation for Rarity.

**Trust boundaries and controls**

| Boundary / threat | Required control | Evidence |
| --- | --- | --- |
| AI client sends a privileged tool call | Validate identity, scopes, capability, record and field access on every call | Direct-ID and wrapper bypass tests |
| Ticket/KB content contains instructions | Treat returned material as untrusted data; no authority from embedded prompts | Adversarial note/attachment scenarios |
| OAuth token for wrong audience or tenant | Signature/issuer/audience/time validation; fixed Rarity tenant binding | Token-negative suite |
| Client changes impersonation, headers or endpoint | Server-owned credential/resource mapping and reviewed route construction | SSRF/header/identity injection suite |
| Missing/invalid impersonation silently becomes integration access | Required identity validation and header assertion; no default resource or broader-identity retry | AUTH-05–08, including negative tenant permission evidence |
| Queued operation substituted or permission revoked | Immutable payload hash, target snapshot, policy version and dispatch-time authorization | Substitution/deduplication/revocation suite |
| Financial fields leak through filters/exports | Field policy before query, join and aggregation, then output filtering | Inference/export tests |
| Cached data crosses identities or scopes | Scoped cache keys plus current authorization | Cross-user revocation tests |
| Webhook replay or forgery | Documented signature validation, dedupe, sequence and reconciliation | Raw-body signature and ordering tests |
| Uploaded file is malicious or oversized | Type/size validation, scanning, quarantine and safe delivery | File corpus and decompression limits |
| Unknown write result is retried | Durable journal, reconciliation, no blind duplicate creation | Fault injection around dispatch |
| Audit/store unavailable | Block new writes, preserve uncertainty and recovery state | Dependency failure tests |
| Dependency or build tampering | Locked dependencies, reviewed updates, SBOM and signed release provenance | Release pipeline checks |

**Content handling**

By default, send only the fields needed for the operation to the AI client. Full detail remains available when authorized and requested. A summary must not silently replace the ability to retrieve full notes/time/history. Label internal/external notes and source records. Restrict protected UDFs, financial fields, HR information and any sensitive attachments by field/record policy.

Our MCP does not need to send data to a second model provider. Data returned to Codex, ChatGPT or Claude is processed under Rarity's selected client account and policies, which must be reviewed separately. Thread's Bedrock/privacy assurances do not apply to our independent MCP or those external clients.

Audit metadata should contain IDs and sanitized changes. Full notes, secrets, exported files and raw request bodies should not appear in routine application logs. When temporary payload retention is needed for execution or reconciliation, encrypt it, limit access and expire it independently of the long-lived audit trail.

**Secret handling**

Use secret references and a pluggable secret provider. Encrypt application-stored credentials with a deployment key held outside the database/backups. Rotate Autotask and webhook credentials with an overlap/rollback procedure where supported. Never expose credentials in tool discovery, errors, URLs, screenshots, support bundles or metrics. Validate masking by automated secret-canary tests.

For Entra or a broker, use maintained OAuth/OIDC libraries. Protect the authorization-code flow with PKCE and appropriate redirect/issuer validation; publish accurate resource metadata. Do not treat DCR registration as membership approval. If CIMD is enabled, validate metadata fetches against SSRF and redirect restrictions. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

**Abuse and reliability boundaries**

Enforce per-user and global request/body/output/job limits before expensive work. Query depth, field count, OR conditions and export size are bounded. Separate input rejection from Autotask rate-limit backoff. A valid employee token does not imply unlimited bulk extraction rights.

Validate Origin when supplied; do not use permissive credentialed CORS. Keep the admin console protected against CSRF and XSS, including malicious customer names, note text and HTML invoice output. Block private/link-local/metadata destinations in all URL-fetching surfaces. Server configuration may allow only approved Autotask zones and identity endpoints, not arbitrary model-provided hosts.

**Audit integrity and access**

Use a restricted append-only audit writer, separate reader privileges, retention controls and backup/export evidence. Optional chained hashes or immutable external storage can provide tamper evidence; they are not a substitute for access control, and ordinary database records should not be described as immutable without those controls. Record administrative policy changes and audit access itself.

**Incident response surfaces**

Provide a write kill switch, user/session revocation, credential-profile disablement, per-operation pause, queued-job cancellation and webhook quarantine. Preserve correlation IDs and uncertain writes for reconciliation. The runbook must identify affected records and downstream changes without relying on a model's conversation summary. Resume only after the identity/policy/credential issue is resolved and pending work is re-authorized.

**Review gates**

Before any production write pilot: identity mapping, scope enforcement, dispatch authorization, journal recovery, secret redaction and tenant validation. Before broader rollout: dependency/security review, backup restoration, retention policy, external-client account policy and operational incident exercise. Use external security review for the internet-facing authentication/authorization boundary if available; record unreviewed areas honestly.
