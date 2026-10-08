import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationConnectionString } from '../apps/server/src/migrate.js';

test('direct migrations select the migration role while Compose keeps its DATABASE_URL fallback',()=>{
  const runtime='postgresql://runtime:opaque-runtime-secret@postgres/autotask_mcp',migration='postgresql://migration:opaque-migration-secret@postgres/autotask_mcp';
  assert.equal(migrationConnectionString({DATABASE_URL:runtime,MIGRATION_DATABASE_URL:migration}),migration);
  assert.equal(migrationConnectionString({DATABASE_URL:migration}),migration);
  assert.equal(migrationConnectionString({DATABASE_URL:runtime,MIGRATION_DATABASE_URL:''}),runtime);
  assert.equal(migrationConnectionString({MIGRATION_DATABASE_URL:migration}),migration);
});
test('missing migration connections fail without exposing configured environment values',()=>{
  assert.throws(()=>migrationConnectionString({OTHER_SECRET:'NEVER-LOG-ME'}),error=>error instanceof Error&&error.message==='MIGRATION_DATABASE_URL or DATABASE_URL is required.');
  assert.throws(()=>migrationConnectionString({DATABASE_URL:'',MIGRATION_DATABASE_URL:''}));
});
