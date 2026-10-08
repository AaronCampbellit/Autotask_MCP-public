# Documentation

Start with the [project README](../README.md) for purpose and a local demo. This index separates operating guides from dated evidence and preserved plans.

## Start here

| Need | Guide |
| --- | --- |
| Latest recorded release, deployment and outstanding verification | [Current status](CURRENT-STATUS.md) |
| What the code implements | [Implementation overview](IMPLEMENTATION.md) |
| Local setup and checks | [README development](../README.md#development), [dependencies](DEPENDENCIES.md) |
| Deploy or recover the server | [Deployment](DEPLOYMENT.md), [runtime environment](../deploy/runtime.env.example), [metadata mount](../deploy/metadata/README.md) |
| Configure integrations | [Autotask connection](AUTOTASK-CONSOLE-CONFIGURATION.md), [Datto RMM](DATTO-RMM.md) |
| Onboard people and grant access | [Entra onboarding](ENTRA-USER-ONBOARDING.md), [area permissions](AREA-PERMISSIONS.md) |
| Understand console sign-in and replay boundaries | [Console authentication](CONSOLE-AUTH.md) |
| Connect ChatGPT to the private server | [Connection runbook](CHATGPT-CONNECTION.md) |
| Understand schemas and availability | [Generated tool catalog](TOOL-CATALOG.json), [output contracts](OUTPUT-CONTRACTS.md) |
| Review Autotask routes, workflow coverage and known gaps | [API workflow audit](API-WORKFLOW-AUDIT.md), [231-entity reference index](AUTOTASK-ENTITY-RECONCILIATION.json) |
| Find remaining work | [Build tracker](LOCAL-BUILD-TRACKER.md) |

## Workflow guides

- Tickets: [operational writes](OPERATIONAL-WRITES.md), [classification](TICKET-CLASSIFICATION.md), [checklists](CHECKLISTS.md), [record links](RECORD-LINKS.md), [closed-record notes](CLOSED-RECORD-NOTES.md), [authoring](work-request-authoring.md).
- Time and scheduling: [work management](WORK-MANAGEMENT.md), [time-entry timing](TIME-ENTRY-TIMING.md), [workday/site/playbook support](SUPPORTING-TOOLS.md).
- Sales and business: [sales tools](SALES-MCP.md), [business domains](BUSINESS-MCP.md), [business integration](BUSINESS-INTEGRATION.md), [CRM to-dos and notes](CRM-TODOS-AND-NOTES.md), [quote workflow boundaries](QUOTE-DELIVERY-INVESTIGATION.md).
- Files: [ticket attachments and copying](TICKET-ATTACHMENTS.md), [opportunity attachments](OPPORTUNITY-ATTACHMENTS.md), [chat file uploads](CHAT-FILE-UPLOADS.md), [protected artifacts](ARTIFACTS.md).
- RMM: [setup and original tools](DATTO-RMM.md), [expanded tools and permissions](RMM-EXPANDED.md), [native API coverage](RMM-API-COVERAGE.json).
- Operations: [console history](CONSOLE-HISTORY.md), [collector](READ-ONLY-COLLECTOR.md), [capacity](CAPACITY.md), [metadata qualification](METADATA-QUALIFICATION.md), [reports and synchronization](REPORTS-AND-SYNC.md).

## Verification and historical records

[Documentation audit](DOCUMENTATION-AUDIT.md) records the current documentation checks. [Current status](CURRENT-STATUS.md) is the authority for recorded deployments. Availability must still be checked for the actual caller; catalog size is not a count of live-qualified operations.

The following documents retain evidence for their dated revisions. Old scanner requirements, tool counts, candidate states and implementation gaps must not be treated as current setup instructions. The API audit documents the latest static workflow review; it does not certify every indexed entity or live tenant permission:

- [Earlier verification](VERIFICATION.md), [acceptance matrix](ACCEPTANCE-STATUS.md), [September 15 completion audit](AUTOTASK-COMPLETION-AUDIT.md), [entity reconciliation index](AUTOTASK-ENTITY-RECONCILIATION.json).
- [Scanner removal](SCANNER-REMOVAL.md), [MCP publishing audit](MCP-PUBLISHING-AUDIT.md), [tool metadata cleanup](TOOL-METADATA-GUIDANCE.md), [original ticket-link scope](TICKET-LINKS.md).
- [Time-entry latency investigation](TIME-ENTRY-LATENCY.md), [time readback incident](TIME-READBACK-2026-09-15.md), [uncertain time-write incident](TIME-WRITE-INCIDENT-2026-09-15.md).

## Plans and source archives

- [MCP tool-call diagnostics](planning/MCP-TOOL-CALL-DIAGNOSTICS-2026-09-18.md): proposed complete call coverage, no daily capture cap, durable delivery and seven-day retention. Not implemented.

The [original Autotask plan](planning/autotask-mcp-plan/README.md), [design specification](planning/autotask-mcp-design/BUILD-SPEC.md), [Thread research](planning/thread-research-2026-09-10/RESEARCH.md), and [RMM / IT Glue research](planning/rmm-itglue-2026-09-15/README.md) preserve original requirements and captured source material. They are not current deployment instructions. RMM has since shipped; IT Glue and [MCP client notifications](planning/MCP-CLIENT-NOTIFICATIONS-2026-09-17.md) remain outside the implemented release.

## Keeping documentation current

Check feature claims against source and the generated catalog. Update the README, relevant guide and current status with releases; distinguish implementation, deployment, client refresh and live acceptance. Preserve historical test results instead of silently relabeling them as new evidence. Follow [AGENTS.md](../AGENTS.md) for release versioning.

- [Ticket completion searches and historical activity](TICKET-COMPLETIONS.md).

- [Native editable fields and UDF updates](NATIVE-FIELD-UPDATES.md)

## September 20 implementation candidate

- [Implementation ledger and acceptance gates](planning/IMPLEMENTATION-PROGRESS-2026-09-20.md)
- [IT Glue](ITGLUE-IMPLEMENTATION.md) and [document media](ITGLUE-MEDIA.md)
- [Provider composites](PROVIDER-COMPOSITES.md) and [read investigations](READ-INVESTIGATIONS.md)
- [Project 2.0 discovery](PROJECT2-DISCOVERY.md) and [read selection](PROJECT2-READ-SELECTION.md)
- [Diagnostic durability](DIAGNOSTIC-DURABILITY.md) and [measured overhead](planning/diagnostics-validation/BENCHMARK.md)
