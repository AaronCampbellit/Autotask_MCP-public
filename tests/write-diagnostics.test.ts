import test from 'node:test';
import assert from 'node:assert/strict';
import { redactJournalResult } from '../packages/storage/src/index.js';

test('journal failure diagnostics omit untrusted details and invalid status values', () => {
  assert.deepEqual(redactJournalResult({ upstream_failure: { reason: 'http_error', http_status: 500, body: 'private', headers: { authorization: 'secret' }, url: 'https://private.invalid' } }), { upstream_failure: { reason: 'http_error', http_status: 500 } });
  assert.deepEqual(redactJournalResult({ upstream_failure: { reason: 'secret' } }), {});
  for (const status of ['500', 99, 600, 500.5, NaN]) {
    assert.deepEqual(redactJournalResult({ upstream_failure: { reason: 'http_error', http_status: status } }), { upstream_failure: { reason: 'http_error' } });
  }
});
