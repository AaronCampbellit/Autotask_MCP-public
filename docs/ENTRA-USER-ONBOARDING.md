# Entra employee onboarding

Deployed September 17, 2026. Originally included in `0.1.0-console-history.20260917.2`; see [current status](CURRENT-STATUS.md) for the latest release. The console history feature requires migration 013; see `CONSOLE-HISTORY.md`.

## Entra permission

Use the existing dashboard sign-in application registration:

- Application (client) ID: `308a0f73-9f9a-4622-8d26-c6c17198a20c`
- Tenant ID: `581437a9-8e26-4857-bc56-1d5a04e7f752`
- Microsoft Graph **Application** permission: `User.Read.All`, with tenant administrator consent.

Find the registration by client ID under Entra **App registrations**, then use **API permissions → Add a permission → Microsoft Graph → Application permissions → User.Read.All → Grant admin consent**. This is the application configured by `ADMIN_ENTRA_CLIENT_ID`, not the API audience or a ChatGPT client. No new secret is needed: the server reuses the existing dashboard app credentials for a separate Graph client-credentials token. After the administrator granted consent, read-only candidate verification successfully retrieved 48 enabled Entra member accounts. The Autotask picker previously retrieved 43 active resources; the consent recheck did not repeat that verification because its shared request budget did not admit the request. Live mapping activation testing remains pending.

Microsoft reference: https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0

## Administrator workflow

Open **People & permissions → Add employee**. The directory picker loads enabled Entra member accounts and active Autotask employees. Search by name/email, select an Entra account, and confirm its corresponding Autotask employee. A unique exact email match is suggested; ambiguous or absent matches require explicit selection. Guest and disabled Entra accounts are excluded. Selecting an account does not grant access.

Choose MCP capabilities individually or from a permission template. **All clients** is selected by default for new mappings and includes newly added clients. The setting does not grant additional tools, administrative privileges, or native Autotask rights. Select **Active employee mapping** and save when ready. Activation checks the Entra account again and requires fresh active Autotask resource evidence. Existing mappings retain their saved policy until edited; legacy explicit company scopes stay selected when editing.

The directory routes require console administrator access and recheck it after reads. Normal session/CSRF controls protect saves. Directory pagination remains on the fixed provider origin; redirects, partial/corrupt pages and oversized responses are rejected. Only identifiers, names, email/UPN and account status are requested from Graph.

## All-client policy

`allCompanies: true` is stored in the existing identity policy JSON; the all-company policy itself requires no schema migration. The live principal store expands that flag to the complete current Autotask company ID list (including internal company 0 when present), cached for at most 60 seconds. Existing per-company enforcement continues to use explicit IDs. A missing/incomplete directory fails closed; it never becomes a wildcard. Policy changes invalidate in-flight access checks. New companies become available after cache refresh; no scheduled database rewrite is needed. Existing explicit company scopes remain supported.

## Multi-employee verification and deployment

Before activating new mappings, configure the collector with `verifyAllResources: true`. The prepared local candidate file is `work/docker/collector.multi-user.candidate.json`; it was applied to the running collector configuration on September 17. This mode verifies up to 500 Resources in one bounded query per cycle, preserves inactive states, requires a complete unique result, and generates independently hashed evidence for every resource. Partial results do not renew the snapshot. The original configured resource must still be present. Legacy single-resource mode remains the default when the flag is omitted. A larger directory requires a separately reviewed paginated collector extension.

For subsequent deployments: back up the existing collector configuration, apply the candidate collector configuration, deploy the new server/collector image and updated collector health check, and wait for fresh evidence before activating new mappings. Check Graph consent, both directory selectors, one intended user mapping, all-client access, and separate tool permissions. The native employee evidence collector retains its existing bounded read-only request allowance. No live users were activated, no Entra permission was changed, and no production configuration was modified while preparing this feature.

## People, templates and controls

The People page automatically loads all enabled Entra member accounts, including accounts without saved mappings, and displays names, email addresses and saved Autotask employee names. Search matches identity and resource text. Missing directory entries remain visible for existing mappings; directory failures are reported rather than treated as an empty successful sync. Discovery never activates users.

Employee and template scopes use searchable company-name checkboxes, with **Select all listed companies** for a fixed selection and **All clients, including newly added clients** for dynamic scope. Templates now persist the optional all-company flag in their existing JSON policy, and applying a template copies its scope as well as its capabilities. Existing selections survive a directory failure and remain identified as unavailable names.

Capability choices are alphabetized by area with separate read and write/manage columns and per-column select-all controls. The existing capability model is unchanged: shared operational reads and finance reads span multiple areas and are labeled accordingly; this does not introduce independent per-tool permissions for each employee. Operation controls group individual tools using the same area headings and independent read/write select-all controls. Local mutations such as file staging and job cancellation appear under write/manage even though they do not perform native Autotask business writes; the mixed invocation tool also appears there. The global business-write pause retains its existing behavior.
