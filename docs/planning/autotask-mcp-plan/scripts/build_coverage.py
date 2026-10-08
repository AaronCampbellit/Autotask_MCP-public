"""Derive planning coverage from factual observations; vendor page copies are not retained."""
from pathlib import Path
import json
import re
from collections import Counter

ROOT=Path(__file__).resolve().parents[1]
seed=json.loads((ROOT.parent/'autotask-mcp-design/entity-coverage.json').read_text(encoding='utf-8-sig'))
pages={row['url']:row for row in json.loads((ROOT/'extracted-reference-details.json').read_text(encoding='utf-8'))}

def domain(name):
    overrides={'AttachmentInfo (REST API)':'Shared attachments','Currencies':'Contracts and finance',
               'DeletedTaskActivityLogs':'Projects','DomainRegistrars':'Assets','InternalLocationWithBusinessHours':'Resources and scheduling',
               'InternalLocations':'Resources and scheduling','Modules':'Platform administration','NotificationHistory':'Service desk',
               'OrganizatonalResources':'Resources and scheduling','Skills':'Resources and scheduling'}
    if name in overrides: return overrides[name]
    if 'Webhook' in name or name.startswith(('UserDefined','Version','Threshold','Entity')): return 'Platform administration'
    if name.startswith(('Resource','Department','Holiday','Appointment','ServiceCall','TimeOff','Organizational','Role')): return 'Resources and scheduling'
    if name.startswith(('TimeEntr','TimeSheet','Timesheet','Expense')): return 'Time and expenses'
    if name.startswith(('Contract','Billing','Invoice','AdditionalInvoice','PriceList','Tax','WorkType','Currency','Payment')): return 'Contracts and finance'
    if name.startswith(('Ticket','ChangeRequest','Checklist','DeletedTicket')): return 'Service desk'
    if name.startswith(('Project','Task','Phase','ChangeOrder')): return 'Projects'
    if name.startswith(('Article','Document','Knowledge')): return 'Knowledge'
    if name.startswith(('Company','Companies','Contact','ClientPortal','Comanaged','Classification','ActionType')): return 'CRM'
    if name.startswith(('ConfigurationItem','Subscription')): return 'Assets'
    if name.startswith(('Inventory','Product','Purchase','SalesOrder','Shipping','Receiving','Rma','RMA')): return 'Inventory and procurement'
    if name.startswith(('Quote','Opportunity','Opportunities')): return 'Sales and quoting'
    if name.startswith(('Service','ServiceBundle','Tag','Survey','Sla','SLA','Country','Countries')): return 'Reference catalogs'
    return 'Review classification'

def support(page,key):
    if not page: return 'unresolved'
    details=page['details']
    if key not in details: return 'unresolved'
    value=details[key].strip().lower()
    if value.startswith('true') or value.startswith('[yes]'): return 'documented yes'
    if value.startswith('false'): return 'documented no'
    if value=='': return 'unmarked in table'
    return 'unresolved'

rows={}
for item in seed:
    label=item['IndexLabel']
    if label in rows:
        rows[label]['index_occurrences']+=1
        continue
    candidates=[u for u in item['DocumentationURLs'] if u in pages]
    page=pages[candidates[0]] if candidates else None
    details=page['details'] if page else {}
    notes=[]
    for operation, condition in (page or {}).get('operation_conditions',{}).items():
        if 'documented_false_flag' in condition:
            notes.append(f"{operation.capitalize()} requires the documented {condition['documented_false_flag']} flag to be false; verify the effective API rule.")
        elif 'editable_attribute' in condition:
            notes.append(f"{operation.capitalize()} is limited to {condition['editable_attribute']}; preserve other relationship attributes.")
        else:
            notes.append(f'{operation.capitalize()} has conditions requiring review at the source URL.')
    for flag in ('Can Create','Can Update','Can Delete','Can Query'):
        raw_value=details.get(flag,'')
        if raw_value.startswith('[yes]') and raw_value.strip()!='[yes]':
            notes.append(flag+': '+raw_value.replace('[yes]','').strip())
    if not page: notes.append('No captured entity reference maps from this index row; manual documentation/Swagger discovery required.')
    if len(candidates)>1: notes.append('Multiple entity references linked from index row; verify primary mapping.')
    if page and '/Webhooks/' in page['url']: notes.append('Generic webhook-family reference; specialize entity name and inspect tenant-supported webhook types.')
    if page and details.get('Entity Name') and details['Entity Name'] != label:
        notes.append('Index label differs from documented entity name; resolve exact runtime spelling and route.')
    rows[label]={'entity':label,'domain':domain(label),'index_occurrences':1,
                 'documentation_url':page['url'] if page else None,
                 'documented_name':details.get('Entity Name',page['title'] if page else None),
                 'documented_path':details.get('Entity Path',details.get('Full path')),
                 'operations':{op:support(page,key) for op,key in [('query','Can Query'),('create','Can Create'),('update','Can Update'),('delete','Can Delete')]},
                 'udfs':support(page,'Can Have UDFs'),'webhooks':support(page,'Supports webhooks'),
                 'parent':details.get('Parent'),'children':details.get('Children'),
                 'documented_urls':details.get('URLs',details.get('Entity URLs')),
                 'documented_parent_urls':details.get('Parent Entity URLs'),
                 'source_text':page['url'] if page else None,
                 'notes':notes,'validation':'Documentation extraction only; tenant and conditional rules unverified',
                 'implementation':'planned',
                 'work_package':domain(label)}
records=sorted(rows.values(),key=lambda x:(x['domain'],x['entity']))
(ROOT/'entity-coverage.json').write_text(json.dumps(records,indent=2,ensure_ascii=False),encoding='utf-8')
(ROOT/'extracted-reference-details.json').write_text(json.dumps(list(pages.values()),indent=2,ensure_ascii=False),encoding='utf-8')

lines=['# Autotask entity coverage plan','',
       'Each unique index label is accounted for below. Y = the documentation marks support; N = explicit false; — = the old-format table leaves support unmarked; ? = unresolved. An unmarked cell is not permission to use an operation. These are documentation observations, not tested capabilities. All operations require route review, conditional-rule review, and tenant validation before enabling.',
       '',f'{len(seed)} source index rows → {len(records)} distinct labels. ResourceTimeOffAdditional appears twice in the source index. ConfigurationItemExts has no linked reference. Neither discrepancy is silently discarded.','',
       'The JSON inventory retains factual parent/child relationships, API paths, original mapping notes, external source URLs, and separate operation support. Vendor prose, examples and full page copies are excluded; consult each reference for conditions. Broad module coverage is planned in 05-DOMAIN-WORKFLOWS.md; special actions are covered in 04-AUTOTASK-ADAPTER.md.','']
symbols={'documented yes':'Y','documented no':'N','unmarked in table':'—','unresolved':'?'}
for group in sorted({r['domain'] for r in records}):
    lines += [f'**{group}**','', '| Entity | Query | Create | Update | Delete | UDFs | Evidence / exception |','| --- | --- | --- | --- | --- | --- | --- |']
    for row in [r for r in records if r['domain']==group]:
        cells=[symbols[row['operations'][k]] for k in ('query','create','update','delete')]
        reference=f"[Reference]({row['documentation_url']})" if row['documentation_url'] else 'Unlinked'
        note=' '.join(row['notes'])
        lines.append('| '+row['entity']+' | '+' | '.join(cells)+' | '+symbols[row['udfs']]+' | '+reference+(' '+note if note else '')+' |')
    lines += ['']
(ROOT/'13-ENTITY-COVERAGE.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'unique_entities':len(records),'domain_counts':dict(Counter(r['domain'] for r in records)),
                  'unresolved_operations':{k:sum(r['operations'][k]=='unresolved' for r in records) for k in ('query','create','update','delete')},
                  'needs_classification':[r['entity'] for r in records if r['domain']=='Review classification']},indent=2))
