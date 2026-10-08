import assert from 'node:assert/strict';
import test from 'node:test';
import { businessEntities, documentedCreateOnlyFields, documentedWrites, fields } from '../packages/business/src/contracts.js';
import { businessOperations } from '../packages/business/src/tools.js';

const projectFields = ['id', 'createDateTime', 'createdByContactID', 'creatorResourceID', 'description', 'impersonatorCreatorResourceID', 'impersonatorUpdaterResourceID', 'isAnnouncement', 'lastActivityDate', 'noteType', 'projectID', 'publish', 'title'] as const;
const taskFields = ['id', 'createDateTime', 'creatorResourceID', 'createdByContactID', 'description', 'impersonatorCreatorResourceID', 'impersonatorUpdaterResourceID', 'lastActivityDate', 'noteType', 'publish', 'taskID', 'title'] as const;

test('ProjectNotes and TaskNotes expose only captured native fields and parent writes', () => {
  assert.ok(businessEntities.includes('ProjectNotes'));
  assert.ok(businessEntities.includes('TaskNotes'));
  assert.deepEqual(fields.ProjectNotes, projectFields);
  assert.deepEqual(fields.TaskNotes, taskFields);
  assert.deepEqual(documentedWrites.ProjectNotes, ['create', 'update']);
  assert.deepEqual(documentedWrites.TaskNotes, ['create', 'update']);
  assert.deepEqual(documentedCreateOnlyFields.ProjectNotes, ['projectID']);
  assert.deepEqual(documentedCreateOnlyFields.TaskNotes, ['taskID']);
});

test('note tools are searchable and mutable, with no undocumented delete', () => {
  for (const name of ['project_note_search', 'project_note_get', 'project_note_create', 'project_note_update', 'task_note_search', 'task_note_get', 'task_note_create', 'task_note_update']) assert.ok(businessOperations[name], name);
  assert.equal(businessOperations.project_note_delete, undefined);
  assert.equal(businessOperations.task_note_delete, undefined);
});
