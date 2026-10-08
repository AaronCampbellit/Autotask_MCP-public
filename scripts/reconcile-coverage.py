#!/usr/bin/env python3
"""Build a documentary entity evidence index; matches never certify implementation."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'docs/planning/autotask-mcp-plan/entity-coverage.json'
entities = json.loads(source.read_text())
files = sorted([*ROOT.glob('packages/**/*.ts'), *ROOT.glob('apps/server/src/**/*.ts'), *ROOT.glob('tests/*.test.ts')])
files = [p for p in files if p.name != 'fixtures.ts']
texts = [(p.relative_to(ROOT).as_posix(), p.read_text().splitlines()) for p in files]
rows = []
for entity in entities:
    name = entity['entity']
    pattern = re.compile(r'(?<![A-Za-z0-9_])' + re.escape(name) + r'(?![A-Za-z0-9_])')
    hits = [{'path': path, 'lines': [i for i, line in enumerate(lines, 1) if pattern.search(line)]}
            for path, lines in texts]
    hits = [hit for hit in hits if hit['lines']]
    rows.append({
        'entity': name, 'domain': entity['domain'], 'parent': entity.get('parent'),
        'documented_operations': entity['operations'],
        'documentation_url': entity['documentation_url'],
        'documented_routes': entity.get('documented_urls'),
        'documented_parent_routes': entity.get('documented_parent_urls'),
        'source_notes': entity.get('notes', []),
        'candidate_code_references': [h for h in hits if not h['path'].startswith('tests/')],
        'candidate_test_references': [h for h in hits if h['path'].startswith('tests/')],
        'operation_review': 'pending: trace exact routes, runtime registration, fields, scope and evidence per operation',
        'tenant_validation': 'not assessed by static scan',
    })
result = {
    'schema_version': 'coverage-reconciliation-v1',
    'review_date': '2026-09-15',
    'purpose': 'Every original entity retained with candidate source/test references. Text matches are navigation aids, not implementation, test-pass, authorization or deployment evidence. Absence of a match does not prove absence of an adapter; aliases and indirect routes require manual review.',
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'summary': {'entities': len(rows), 'entities_with_candidate_code_references': sum(bool(r['candidate_code_references']) for r in rows), 'entities_with_candidate_test_references': sum(bool(r['candidate_test_references']) for r in rows), 'operation_reviews_pending': len(rows)},
    'entities': rows,
}
assert len(rows) == 231 and len({r['entity'] for r in rows}) == 231
output = ROOT / 'docs/AUTOTASK-ENTITY-RECONCILIATION.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result['summary']))
