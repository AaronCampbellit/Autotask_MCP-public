# Cross-provider read workflows

`ticket_environment_context` reads the authorized ticket and asset, verified RMM device/link and open alert evidence, and a bounded set of IT Glue document references from the ticket's company. It rechecks ticket company and asset association before returning. Document references are company context, not proof that a document describes the device; retrieve the full document sections before relying on its content.

`client_inventory_compare` reads only mapped RMM sites for the requested company and IT Glue configurations for its mapped organization. It compares exact normalized BIOS serial observations against configuration serials. Unique serials are candidates within the observed pages, not verified identities. Duplicate serials remain ambiguous; names never establish identity. Missing serials and unmatched observations do not establish absence or deletion. Neither operation writes assets, documents or mappings.

Both workflows return separate source data, completeness, fetch provenance, limitations and native-tool continuation arguments. Defaults are two pages of twenty records per provider; requests allow at most ten pages of fifty. RMM hardware audit reads have an additional fifty-device ceiling. Budget exhaustion is partial. An unavailable provider does not imply failure of another provider; permission, scope, ownership and revocation failures fail the request. Supply `organization_id` when a company has several mapped IT Glue organizations; the workflow never silently chooses one.

These are local composite workflows, not native vendor API endpoints. They invoke the existing registered read tools so their policy checks and provider constraints still apply. Retrieved text is untrusted evidence and never authorizes remediation.

Fixture coverage exercises exact company scoping, duplicate serials, partial pages, unavailable versus forbidden sources, changed ticket ownership, revoked access, and both composites through the real ToolRuntime and provider fixture adapters. No live business writes or deployment are part of these checks.
