#!/usr/bin/env python3
"""Refresh factual routes in memory; never retain vendor page bodies or specifications."""
import urllib.request, json, hashlib, datetime, pathlib, re, sys
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCES={
 'rmm-openapi.json':'https://vidal-api.centrastage.net/api/v3/api-docs/Datto-RMM-v2',
 'rmm-swagger-config.json':'https://vidal-api.centrastage.net/api/v3/api-docs/swagger-config',
 'rmm-api-guide.html':'https://rmm.datto.com/help/en/Content/2SETUP/APIv2.htm',
 'itglue-api.html':'https://api.itglue.com/developer/',
 'itglue-access.html':'https://help.itglue.kaseya.com/help/Content/1-admin/it-glue-api/getting-started-with-the-it-glue-api.html',
 'itglue-pagination.html':'https://help.itglue.kaseya.com/help/Content/1-admin/it-glue-api/pagination-in-the-it-glue-api.html',
 'itglue-filtering.html':'https://help.itglue.kaseya.com/help/Content/1-admin/it-glue-api/sorting-and-filtering-in-the-it-glue-api.html',
 'integration-authority.html':'https://rmm.datto.com/help/en/Content/3NEWUI/Setup/Integrations/ITGlueIntegration.htm',
 'rmm-components.html':'https://rmm.datto.com/help/en/Content/3NEWUI/Automation/Components/Scripting.htm',
}
class Headings(HTMLParser):
 def __init__(self):super().__init__();self.sections=[];self.current=None;self.heading=None;self.skip=0;self.page_key=None
 def handle_starttag(self,t,a):
  if t=='div':
   cls=dict(a).get('class','')
   if cls.startswith('page__'):self.page_key=cls.split()[0]
  if t in ('script','style'):self.skip+=1
  if t in ('h1','h2','h3','h4'):
   self.heading={'tag':t,'anchor':dict(a).get('id'),'title':'','text':'','page_key':self.page_key};self.sections.append(self.heading);self.current=self.heading
  if t in ('p','tr','td','th','li','br','pre') and self.current:self.current['text']+='\n'
 def handle_endtag(self,t):
  if t in ('script','style'):self.skip=max(0,self.skip-1)
  if t in ('h1','h2','h3','h4'):self.heading=None
 def handle_data(self,s):
  if self.skip:return
  if self.heading:self.heading['title']+=s
  # Only heading text is needed to identify endpoint facts.
if '--offline' in sys.argv:
 import subprocess
 raise SystemExit(subprocess.call([sys.executable,str(ROOT/'scripts/validate.py')]))
manifest=[];raw_sources={}
for name,url in SOURCES.items():
 raw=urllib.request.urlopen(url,timeout=45).read()
 if name in ('rmm-openapi.json','itglue-api.html'):raw_sources[name]=raw
 manifest.append({'repository_copy':'Not retained; consult the source URL.','url':url,'retrieved_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
(ROOT/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
spec=json.loads(raw_sources['rmm-openapi.json']);rmm=[]
for path,methods in spec['paths'].items():
 for method,op in methods.items():
  if method.lower() not in ('get','post','put','patch','delete','head','options'):continue
  rmm.append({'method':method.upper(),'path':path,'operation_id':op.get('operationId'),'tags':op.get('tags',[]),'source':SOURCES['rmm-openapi.json'],'schema_status':'Consult vendor source for schemas, field conditions and examples; no copied specification retained.','implementation_status':'not_implemented_by_this_plan'})
(ROOT/'rmm-endpoints.json').write_text(json.dumps(rmm,indent=2)+'\n')
p=Headings();p.feed(raw_sources['itglue-api.html'].decode('utf-8'));itg=[];resource='';cur=None
for s in p.sections:
 title=' '.join(s['title'].split());m=re.match(r'^(GET|POST|PUT|PATCH|DELETE)\s+(/\S+)',title)
 if m:
  cur={'resource':resource,'method':m[1],'path':m[2],'anchor':s['anchor'],'source_url':SOURCES['itglue-api.html']+('#'+s['anchor'] if s['anchor'] else ''),'sections':[s],'implementation_status':'not_implemented_by_this_plan'};itg.append(cur)
 elif s['tag']=='h1':resource=title;cur=None
 elif cur:cur['sections'].append(s)
for op in itg:
 peers=[v for v in itg if v['sections'][0].get('page_key')==op['sections'][0].get('page_key')]
 op['documentation_group']=op['sections'][0].get('page_key')
 op['documented_aliases']=[{'method':v['method'],'path':v['path']} for v in peers if v is not op]
 # Parameter tables and examples remain at the vendor source URL.
 op['schema_status']='Consult source_url for parameters, field conditions and examples; no copied prose retained.'
for op in itg:op.pop('sections',None)
(ROOT/'itglue-endpoints.json').write_text(json.dumps(itg,indent=2)+'\n')
print(json.dumps({'rmm_operations':len(rmm),'rmm_paths':len(spec['paths']),'rmm_schemas':len(spec.get('components',{}).get('schemas',{})),'itglue_documented_routes':len(itg),'itglue_resources':len(set(x['resource'] for x in itg)),'sources':len(manifest)}))
