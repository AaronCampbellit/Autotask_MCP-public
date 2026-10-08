# Quote delivery and conversion: reviewed 2026-09-14

The REST route inventory and current official entity documentation support creating and updating sales records. They do not establish a native quote-send, quote-PDF, acceptance-signing, or Won Quote command endpoint. This is a finding about the reviewed interface, not proof that no future or partner integration could provide one.

| Workflow | Verified integration path | MCP behavior |
| --- | --- | --- |
| Draft opportunity, quote and lines | Existing REST sales entities | Existing sales tools save and verify supplied fields. |
| Customer response evidence | Read-only `extApprovalContactResponse` and `extApprovalResponseDate` on Quotes; current picklist supplies its meaning | `quote_workflow_inspect` reads values and labels; missing/unknown values remain unknown. No signature contents are exposed. |
| Publication evidence | Read-only `lastPublishedDateTime` and `lastPublishedByResourceID` | A publication timestamp does not establish email delivery or viewing. |
| Publish/send eQuote | Autotask quote UI; no REST send action found | Manual handoff; no email is sent by inspecting or creating a quote. |
| Native quote PDF | Autotask quote preview/print workflow; no REST quote PDF generation route found | `quote_workflow_prepare` gives the UI handoff. Existing PDF attachments can be discovered/retrieved through bounded `CompanyNoteAttachments` tools after the native workflow. |
| Customer acceptance | Customer-facing eQuote workflow, with response evidence available to reads | Never simulate acceptance by setting internal `approvalStatus`. |
| Won Quote / Won Opportunity conversion | Native UI wizards | Do not equate updating status or creating a linked ticket with the wizard's billing, ordering or contract effects. |
| Alternative quoting product | Official Kaseya Quote Manager integration | A separate configured integration to investigate if desired; no new provider account or external connection was created. |

## Existing accepted quote PDFs

The official quote-preview documentation says a customer response creates an opportunity CRM note and an accepted quote PDF attachment. `quote_opportunity_pdf_search` queries `CompanyNoteAttachments` for PDF candidates associated with the quote's opportunity; `quote_opportunity_pdf_get` then requires designated `quote_id`, `note_id` and `attachment_id` values, verifies the CompanyNote and PDF envelope, and retrieves the existing artifact in bounded chunks. Multiple quotes can share an opportunity, so the tool reports opportunity-note association and does not claim that the attachment belongs to one specific quote or proves acceptance. This is retrieval of an existing artifact, not a PDF-generation or acceptance endpoint.

## Sources

- [Quote preview, customer response and PDF attachments](https://ww1.autotask.net/help/content/3_Features/5_Sales/Quotes/ViewPreviewQuote.htm)
- [Won Quote wizard scope](https://ww1.autotask.net/help/content/3_Features/5_Sales/Quotes/WonLostQuotesWizards.htm)
- [REST Quotes: fields, relationships and Quick Quote limits](https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/QuotesEntity.htm)
- [Searching and managing quotes: UI navigation and wizard actions](https://ww1.autotask.net/help/content/3_Features/5_Sales/Quotes/ManageQuotes.htm)
- [Won Opportunity wizard](https://ww1.autotask.net/help/content/3_Features/5_Sales/Opportunities/WonOpportunityWizard.htm)
- [Official Kaseya Quote Manager integration](https://ww1.autotask.net/help/content/3_Features/5_Sales/KaseyaQuoteManager/Commerce_integration_Overview.htm)
- [REST Invoices: invoice output routes](https://ww5.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/InvoicesEntity.htm)
- [REST CompanyNoteAttachments: query and specific attachment retrieval](https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/CompanyNoteAttachmentsEntity.htm)
- Official captured REST Swagger route inventory, local ignored `work/docker/swagger.json`; no quote delivery/PDF/conversion action appears in that inventory.

Live customer delivery and conversion were not tested. No customer communications, acceptance actions or conversion records were created during this investigation.
