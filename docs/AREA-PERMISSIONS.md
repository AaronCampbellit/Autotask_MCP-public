# Per-area access

Deployment update: included in `0.1.0-attachments-access.20260917.1` on September 17, 2026. See [current release verification](CURRENT-STATUS.md). Earlier candidate/test statements below describe development checkpoints; live business and client-specific checks remain as noted.

The People & permissions editor and permission templates now use independent Read and Write selections for Tickets, Time entries, Scheduling, Projects, Sales, Finance, Purchasing, Inventory & products, Assets & configuration, and Expenses. Clients & contacts exposes Read only because this connector has no client/contact write tools. Datto RMM and administration retain their separate existing controls. Team time is an additional ownership permission, not a substitute for Time entries access.

Write includes Read in the same area. Unchecking Read removes Write. Company scope remains independent: All clients does not grant any additional area. Operation controls still pause individual tools globally; they do not grant user permissions.

## What the areas mean

- Sales: opportunities, quotes, quote items, opportunity notes/attachments and CRM to-dos. Quote pricing is part of Sales data.
- Finance: contracts, invoices, invoice exports and billing tools. Finance Read also unlocks existing protected financial fields on tickets, time, clients, projects and configuration items. Changing protected project or asset financial fields additionally requires Finance Write.
- Purchasing: purchase orders, their items and receiving.
- Inventory & products: product and inventory records, stock additions/removals/transfers. Purchasing and Inventory include their own native costs; neither grants invoice or contract access.
- Other areas follow their named operational records. Ownership, company scope, native eligibility and operation enablement checks still apply.

Linked records can require Read in another area. For example, logging time on a project task requires Projects Read; reading a ticket's linked asset requires Assets & configuration Read. Sales contact/resource references require Clients & contacts Read, and product catalog references require Inventory Read. The combined workday needs Tickets, Projects, Scheduling and Time Read. Denied dependencies are not silently granted.

## Enforcement and overhead

`Principal.areaPermissions` is the authoritative area allowlist for converted policies; an empty list denies all Autotask areas. Member/template validation rejects unknown grants, duplicates and Write without Read. Internal capability flags are derived server-side for existing service ownership and eligibility checks. Those compatibility flags do not override the area allowlist and are not presented as effective permissions by `at_whoami`.

The same local area checks run in discovery, dispatch controls, generic queries, domain services, relevant adapters and read projections. Queued and resumed work uses the same dispatch authorization. Changes to area grants invalidate in-flight principals, and existing policy/mapping versions continue to invalidate saved work and artifacts. Unclassified tools are denied for explicit area policies until their area is reviewed.

No additional Autotask requests, Entra requests, AI calls, database tables or per-request permission lookups are introduced. Checks use the principal already loaded by existing authorization. There is a small amount of local validation and comparison work.

## Existing users and deployment

Existing stored policies keep their prior behavior until an administrator saves explicit area selections. The editor supplies a legacy-derived starting selection for review, then saves the explicit area allowlist and a new policy/mapping version. This is a deliberate conversion on save, not a bulk database rewrite. Review the new area groupings before saving an existing user or template: a cohesive area may group tools that previously had different shared prerequisites. Existing templates do not retroactively update users.

Once converted, an update that omits `areaPermissions` is rejected; it cannot silently restore the broad legacy model. The new field uses the existing policy JSON storage. No database migration or live access change has been performed for this work.

The feature is deployed in the release recorded above. Future deployments require a new release version as required by AGENTS.md. Representative live permission tests remain separate from the fixture validation below.

## Local validation — September 17, 2026

- Full repository suite: 722 tests passed.
- After the final financial-field refinement: 49 targeted permission, business-service and console tests passed, including protected-field inference and write denial.
- TypeScript check and whitespace validation passed.
- Browser fixture verified independent Sales/Finance controls, Write selecting Read, and removing Read clearing Write. The temporary preview was stopped afterward.
- No deployment, live permission updates, commit or push was performed for this change.
