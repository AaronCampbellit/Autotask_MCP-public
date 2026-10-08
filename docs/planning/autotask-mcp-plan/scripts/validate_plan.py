"""Validate the research/plan package; this does not test an MCP implementation."""
from pathlib import Path
from hashlib import sha256
from collections import Counter
import json
import re

ROOT=Path(__file__).resolve().parents[1]
errors=[]
docs=sorted(ROOT.glob('*.md'))
for doc in docs:
    content=doc.read_text(encoding='utf-8-sig')
    for target in re.findall(r'\]\(([^)]+)\)',content):
        if target.startswith(('https://','http://','#','mailto:')):
            continue
        target=target.strip('<>').split('#')[0]
        if not (doc.parent/target).exists():
            errors.append(f'Broken local link: {doc.name} -> {target}')
    if content.count('```') % 2:
        errors.append(f'Unclosed code fence: {doc.name}')

for filename in ['source-manifest.json','supplemental-manifest.json']:
    manifest=json.loads((ROOT/filename).read_text(encoding='utf-8-sig'))
    for row in manifest:
        if row.get('status')!=200:
            errors.append('Fetch failed: '+row['url'])
            continue
        if not row['url'].startswith('https://') or not re.fullmatch(r'[0-9a-fA-F]{64}',row['sha256']) or row['bytes'] <= 0:
            errors.append('Invalid source provenance: '+row['url'])
        if any(key in row for key in ['local_html','local_text','local_file','details']):
            errors.append('Copied source/cache content in public manifest: '+row['url'])

inventory=json.loads((ROOT/'entity-coverage.json').read_text(encoding='utf-8-sig'))
if len(inventory)!=231 or len({r['entity'] for r in inventory})!=231:
    errors.append('Entity inventory count/uniqueness mismatch')
if sum(r['index_occurrences'] for r in inventory)!=232:
    errors.append('Source index occurrence mismatch')
if any(r['domain']=='Review classification' for r in inventory):
    errors.append('Unclassified entity')
for row in inventory:
    if row['source_text'] and not row['source_text'].startswith('https://'):
        errors.append('Source must be an external URL: '+row['entity'])

backlog=(ROOT/'10-DELIVERY-BACKLOG.md').read_text(encoding='utf-8')
packages=[]
for line in backlog.splitlines():
    if re.match(r'^\| WP-\d{2} \|',line):
        cells=[c.strip() for c in line.strip().strip('|').split('|')]
        packages.append(dict(zip(['id','deliverable','dependencies','exit_evidence'],cells)))
if len(packages)!=36 or len({p['id'] for p in packages})!=36:
    errors.append('Work package count/uniqueness mismatch')
(ROOT/'delivery-backlog.json').write_text(json.dumps(packages,indent=2),encoding='utf-8')

requirements=[]
for line in (ROOT/'15-TRACEABILITY.md').read_text(encoding='utf-8').splitlines():
    if re.match(r'^\| R-\d{2} \|',line):
        cells=[c.strip() for c in line.strip().strip('|').split('|')]
        requirements.append(dict(zip(['id','requirement','implementation','acceptance'],cells)))
if len(requirements)!=64 or len({r['id'] for r in requirements})!=64:
    errors.append('Requirement count/uniqueness mismatch')
(ROOT/'requirements.json').write_text(json.dumps(requirements,indent=2),encoding='utf-8')

workflow_catalog=json.loads((ROOT/'technician-workflows.json').read_text(encoding='utf-8'))
workflow_names={w['name'] for w in workflow_catalog['required_additional_workflows']}
expected_workflows={'ticket_document_work','ticket_handoff','ticket_resolve','my_workday','ticket_prepare_visit'}
if workflow_names!=expected_workflows:
    errors.append('Technician workflow catalog mismatch')
contracts=(ROOT/'14-TOOL-CONTRACTS.md').read_text(encoding='utf-8')
for name in workflow_catalog['foundation_named_tools']+sorted(workflow_names)+workflow_catalog['supporting_tools']:
    if f'| {name} |' not in contracts:
        errors.append('Named tool missing from public contract: '+name)
for workflow in workflow_catalog['required_additional_workflows']:
    seen=set()
    for step in workflow['steps']:
        if step['id'] in seen or not set(step['after']).issubset(seen):
            errors.append('Invalid workflow step dependency/order: '+workflow['name']+'/'+step['id'])
        seen.add(step['id'])

workflow_cases=[]
for line in (ROOT/'19-TECHNICIAN-WORKFLOW-EVALUATION.md').read_text(encoding='utf-8').splitlines():
    if re.match(r'^\| WF-\d{2} \|',line):
        cells=[c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells)!=3:
            errors.append('Malformed technician evaluation row: '+cells[0])
        workflow_cases.append(dict(zip(['id','scenario','expected_outcome'],cells)))
if {c['id'] for c in workflow_cases}!={f'WF-{n:02}' for n in range(1,39)} or len(workflow_cases)!=38:
    errors.append('Technician evaluation ID/count mismatch')
(ROOT/'technician-evaluations.json').write_text(json.dumps({'status':'planned_not_run','cases':workflow_cases},indent=2),encoding='utf-8')

authored=[p for p in docs if p.name!='13-ENTITY-COVERAGE.md']
word_count=sum(len(re.findall(r'\b\S+\b',p.read_text(encoding='utf-8'))) for p in authored)
summary={'validation':'Planning artifacts and provenance metadata only; vendor copies excluded; no server or tenant tests',
         'markdown_documents':len(docs),'authored_words_approx':word_count,
         'unique_entity_labels':len(inventory),'source_index_rows':sum(r['index_occurrences'] for r in inventory),
         'domain_counts':dict(Counter(r['domain'] for r in inventory)),
         'work_packages':len(packages),'traceable_requirements':len(requirements),
         'additional_technician_workflows':len(workflow_names),'technician_scenarios':len(workflow_cases),
         'source_pages':len(json.loads((ROOT/'source-manifest.json').read_text(encoding='utf-8-sig'))),
         'supplemental_pages':len(json.loads((ROOT/'supplemental-manifest.json').read_text(encoding='utf-8-sig'))),
         'errors':errors}
(ROOT/'validation-report.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
raise SystemExit(1 if errors else 0)
