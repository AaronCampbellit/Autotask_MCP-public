import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryPrincipalStore } from '../packages/storage/src/index.js';
import { fixturePrincipals } from '../packages/workflows/src/fixtures.js';
import { PlaybookService } from '../packages/playbooks/src/index.js';
test('five pinned draft playbooks disclose unavailable tools and preserve guidance without granting access', async () => {
  const p = fixturePrincipals()[0]!, store = new MemoryPrincipalStore([p]), service = new PlaybookService(store);
  const listing = await service.list(p, {}, ['ticket_context']);
  assert.equal(listing.playbooks.length, 5);
  for (const item of listing.playbooks) {
    const detail = await service.get(p, { id: item.id }, ['ticket_context']);
    assert.equal(detail.version, '0.2.0');
    const legacy=await service.get(p,{id:item.id,version:'0.1.0'},[]);assert.equal(legacy.version,'0.1.0');assert.notEqual(legacy.body_sha256,detail.body_sha256);assert.match(detail.resource_uri,/0\.2\.0$/);
    assert.equal(detail.lifecycle, 'draft');
    assert.equal(detail.published_at, null);
    assert.match(detail.body_sha256, /^[a-f0-9]{64}$/);
    assert.ok(detail.markdown.startsWith('# '));
  }
  assert.deepEqual(listing.playbooks.find(b => b.id === 'handoff')!.unavailable_tools, ['ticket_handoff']);
  await assert.rejects(service.get(p, { id: '../secrets' }, []));
  await assert.rejects(service.get(p, { id: 'triage', version: '9.0.0' }, []));
  store.set({ ...p, active: false });
  await assert.rejects(service.get(p, { id: 'triage' }, []), { code: 'identity_mapping_invalid' });
});
