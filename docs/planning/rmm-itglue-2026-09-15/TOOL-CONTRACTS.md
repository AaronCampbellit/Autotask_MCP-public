# Proposed MCP tool contracts

These are design inputs, not registered tools or final JSON Schemas. `?` indicates an optional argument. Endpoint catalogs retain method/path observations and source URLs. Consult the vendor source for exact native types, required fields and schemas; copied descriptions/examples are excluded. Common authorization, cursor, receipt and output contracts are defined in IMPLEMENTATION-PLAN.md.

| Proposed tool | Phase | Arguments | Native route(s) |
| --- | --- | --- | --- |
| rmm_site_search | P1 | company, page_size, cursor | `GET /v2/account/sites` |
| rmm_site_get | P1 | company, site_uid | `GET /v2/site/{siteUid}` |
| rmm_device_search | P1 | company, site_uid?, hostname?, page_size, cursor | `GET /v2/site/{siteUid}/devices` |
| rmm_device_get | P1 | company, device_uid | `GET /v2/device/{deviceUid}` |
| rmm_device_audit_get | P1 | company, device_uid, kind:device|printer|esxihost | `GET /v2/audit/device/{deviceUid}`; `GET /v2/audit/printer/{deviceUid}`; `GET /v2/audit/esxihost/{deviceUid}` |
| rmm_software_search | P1 | company, device_uid, name?, page_size, cursor | `GET /v2/audit/device/{deviceUid}/software` |
| rmm_alert_search | P1 | company, site_uid?, device_uid?, state:open|resolved, page_size, cursor | `GET /v2/site/{siteUid}/alerts/open`; `GET /v2/site/{siteUid}/alerts/resolved`; `GET /v2/device/{deviceUid}/alerts/open`; `GET /v2/device/{deviceUid}/alerts/resolved` |
| rmm_alert_get | P1 | company, alert_uid | `GET /v2/alert/{alertUid}` |
| rmm_patch_search | P1 | company, site_uid?, device_uid?, page_size, cursor | `GET /v2/site/{siteUid}/patches`; `GET /v2/device/{deviceUid}/patches` |
| rmm_component_search | P1 | name?, page_size, cursor | `GET /v2/account/components` |
| rmm_job_get | P1 | company, job_uid, device_uid | `GET /v2/job/{jobUid}`; `GET /v2/job/{jobUid}/results/{deviceUid}` |
| rmm_job_output_get | P1 | company, job_uid, device_uid, stream:stdout|stderr, offset, length | `GET /v2/job/{jobUid}/results/{deviceUid}/stdout`; `GET /v2/job/{jobUid}/results/{deviceUid}/stderr` |
| rmm_quickjob_run | P3 | company, device_uid, component_uid, job_name, variables, request_key | `PUT /v2/device/{deviceUid}/quickjob` |
| rmm_alert_resolve | P3 | company, alert_uid, expected, request_key | `POST /v2/alert/{alertUid}/resolve` |
| rmm_alert_mute | P3 | company, alert_uid, expected, request_key | `POST /v2/alert/{alertUid}/mute` |
| rmm_alert_unmute | P3 | company, alert_uid, expected, request_key | `POST /v2/alert/{alertUid}/unmute` |
| rmm_device_udf_update | P3 | company, device_uid, fields, expected, request_key | `POST /v2/device/{deviceUid}/udf` |
| rmm_device_warranty_update | P3 | company, device_uid, warranty, expected, request_key | `POST /v2/device/{deviceUid}/warranty` |
| itg_organization_search | P1 | company, filters, page_size, cursor | `GET /organizations` |
| itg_organization_get | P1 | company, id | `GET /organizations/:id` |
| itg_configuration_search | P1 | company, filters, page_size, cursor | `GET /configurations` |
| itg_configuration_get | P1 | company, id | `GET /configurations/:id` |
| itg_contact_search | P1 | company, filters, page_size, cursor | `GET /contacts` |
| itg_contact_get | P1 | company, id | `GET /contacts/:id` |
| itg_flexible_asset_search | P1 | company, filters, page_size, cursor | `GET /flexible_assets` |
| itg_flexible_asset_get | P1 | company, id | `GET /flexible_assets/:id` |
| itg_document_search | P1 | company, folder_id?, all_folders, page_size, cursor | `GET /organizations/:organization_id/relationships/documents` |
| itg_document_get | P1 | company, document_id | `GET /documents/:id`; `GET /documents/:document_id/relationships/sections` |
| itg_checklist_search | P1 | company, filters, page_size, cursor | `GET /organizations/:organization_id/relationships/checklists` |
| itg_checklist_get | P1 | company, id | `GET /checklists/:id` |
| itg_document_create | P2 | company, folder_id?, name, sections, request_key | `POST /documents`; `POST /documents/:document_id/relationships/sections` |
| itg_document_update | P2 | company, document_id, fields, expected, request_key | `PATCH /documents/:id` |
| itg_document_section_update | P2 | company, document_id, section_id, fields, expected, request_key | `PATCH /documents/:document_id/relationships/sections/:id` |
| itg_document_publish | P2 | company, document_id, expected, request_key | `PATCH /documents/:id/publish` |
| itg_flexible_asset_create | P2 | company, id?, fields, expected?, request_key | `POST /flexible_assets` |
| itg_flexible_asset_update | P2 | company, id?, fields, expected?, request_key | `PATCH /flexible_assets/:id` |
| itg_configuration_create | P2 | company, id?, fields, expected?, request_key | `POST /configurations` |
| itg_configuration_update | P2 | company, id?, fields, expected?, request_key | `PATCH /configurations/:id` |
| itg_checklist_update | P2 | company, id, fields, expected, request_key | `PATCH /checklists/:id` |
