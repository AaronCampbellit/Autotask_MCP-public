# CRM to-dos and project/task notes

These tools extend the existing business pack. Use `business_schema` with `CompanyToDos`, `ProjectNotes` or `TaskNotes` for current native fields, required values and picklists. Record text follows the shared [authoring standard](work-request-authoring.md): improve clarity while preserving intent, uncertainty, people and scope. No customer email delivery or execution of the requested work is implied by saving text.

## CRM to-dos

- `crm_todo_search`: company-scoped search, optional `owner: "self"` or resource ID, `completion: "all" | "open" | "completed"`, text and pagination. Default completion is `all`; owner is unrestricted within the authorized company scope unless requested. Text searches `activityDescription`.
- `crm_todo_get`: read one authorized to-do by ID.
- `crm_todo_create`: requires a company and native `actionType`, `assignedToResourceID`, `startDateTime`, `endDateTime`. Supply offset-qualified timestamps; do not invent an owner or schedule. Optional text is `activityDescription`. Optional contact, contract, opportunity and ticket links must match the company; contacts and assigned resources must be active.
- `crm_todo_update`: update supplied fields with matching `expected` values. `completedDate` marks completion; there is no `isComplete` field. Company moves are unavailable. A changed schedule must retain a valid start/end ordering.
- `crm_todo_delete`: requires expected `companyID`, `activityDescription`, `assignedToResourceID`, `startDateTime`, `endDateTime` and `completedDate` from the current record (use null for an absent value).

Creation/update use `Companies/{companyID}/ToDos`; deletion uses that parent route plus the ID. Reads use `CompanyToDos`. A native completion can affect subsequent visibility; incomplete readback is reported as unverified and must not be treated as permission to repeat the write.

## Project and task notes

`project_note_search`, `project_note_get`, `project_note_create`, `project_note_update` and the corresponding `task_note_*` tools provide read/search/create/update. No note-delete tool is exposed.

Project-note searches and creates require `project_id`; task-note searches and creates require `task_id`. The server resolves the parent project and company before returning records or writing. A note cannot be moved to another project/task through an update. Note creation requires the native fields reported by `business_schema`, including the explicit `publish` audience and `noteType`; no customer-visible audience is guessed. Project notes also require `title`, `description` and `isAnnouncement`; task notes require `description` with an optional title. Contact-authored notes are not created by these tools.

## Write safeguards and access

All writes use stable `request_key` values, durable receipts, current principal/company checks and final saved-value verification. Updates require expected values for every changed field. Unknown outcomes are reconciled through `business_operation_status`, never blindly repeated. Existing business-pack read/finance gates remain; CRM to-do writes additionally require `sales.write`, and note writes require `projects.write`.

Live business-write testing remains user-controlled. Automated fixtures cover routes, references, scope, expected values and pagination; read-only tenant metadata verifies supported fields and API access.

Native reference sources: [CompanyToDos](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/CompanyToDosEntity.htm), [ProjectNotes](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/ProjectNotesEntity.htm), [TaskNotes](https://ww3.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/TaskNotesEntity.htm). The source manifest retains upstream URLs and historical retrieval metadata; full vendor page copies are excluded. Runtime metadata is rechecked before writes.
