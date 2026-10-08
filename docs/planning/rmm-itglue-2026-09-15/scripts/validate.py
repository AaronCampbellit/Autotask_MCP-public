#!/usr/bin/env python3
"""Offline factual inventory/provenance checks; vendor schemas are not retained."""
import pathlib,json,re
R=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((R/'source-manifest.json').read_text())
for source in manifest:
 assert source['url'].startswith('https://')
 assert source['bytes']>0 and re.fullmatch(r'[0-9a-f]{64}',source['sha256'])
 assert 'file' not in source and source['repository_copy']=='Not retained; consult the source URL.'
rmm=json.loads((R/'rmm-endpoints.json').read_text());itg=json.loads((R/'itglue-endpoints.json').read_text())
coverage=json.loads((R/'endpoint-coverage.json').read_text());tools=json.loads((R/'proposed-tools.json').read_text())
expected={('rmm',op['method'],op['path']) for op in rmm}|{('itglue',op['method'],op['path']) for op in itg}
actual={(op['provider'],op['method'],op['path']) for op in coverage}
assert expected==actual and len(actual)==len(coverage),'missing/duplicate coverage'
assert len({tool['name'] for tool in tools})==len(tools)
for tool in tools:
 for route in tool['native_routes']:assert (tool['provider'],route['method'],route['path']) in expected,(tool['name'],route)
for op in rmm:
 assert op['source'].startswith('https://')
 assert not any(key in op for key in ['description','summary','parameters','request_body','responses','security'])
for op in itg:
 assert op['documentation_group'] and op['source_url'].startswith('https://'),op['path']
 assert not any(key in op for key in ['sections','shared_detail_sections'])
 for alias in op['documented_aliases']:
  assert ('itglue',alias['method'],alias['path']) in expected
links=0
for file in R.glob('*.md'):
 for target in re.findall(r'\]\(([^)]+)\)',file.read_text()):
  if target.startswith(('http:','https:','#')):continue
  assert (file.parent/target.split('#')[0]).exists(),(file.name,target);links+=1
assert all(not op['live_tested'] and op['native_access']=='not_checked' for op in coverage)
assert not (R/'sources').exists(),'vendor caches must not be recreated'
print(json.dumps({'passed':True,'source_provenance_records':len(manifest),'rmm_operations':len(rmm),
                  'itglue_routes':len(itg),'coverage':len(coverage),'proposed_tools':len(tools),
                  'local_links':links,'vendor_page_copies':0,'schema_validation':'Consult vendor source; no copied schema retained.'}))
