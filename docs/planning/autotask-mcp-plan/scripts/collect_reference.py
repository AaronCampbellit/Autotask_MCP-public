"""Collect factual observations/provenance in memory; never retain vendor page copies or call a tenant."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT.parent / 'autotask-mcp-design' / 'entity-coverage.json'

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if not self.skip and tag in ('p','li','tr','h1','h2','h3','h4','br'):
            self.parts.append('\n')
        if not self.skip and tag == 'img':
            src = dict(attrs).get('src', '')
            if 'CheckMark' in src:
                self.parts.append(' [yes] ')
            elif any(x in src.lower() for x in ('crossmark', 'xmark', 'redx', 'nocheck')):
                self.parts.append(' [no] ')
    def handle_endtag(self, tag):
        if tag in ('script','style'):
            self.skip = max(0, self.skip - 1)
        if not self.skip and tag in ('td','th'):
            self.parts.append(' | ')
        if not self.skip and tag in ('p','li','tr','h1','h2','h3','h4'):
            self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
    def value(self):
        return '\n'.join(re.sub(r'\s+', ' ', s).strip() for s in ''.join(self.parts).splitlines() if s.strip())

def text(html):
    parser = TextParser()
    parser.feed(html)
    return parser.value()

def extract(html, url):
    values = {}
    conditions = {}
    names = ('Entity Name','Entity Path','Can Create','Can Update','Can Query','Can Delete','Can Have UDFs','Supports webhooks','Parent','Children','URLs','Full path','Entity URLs','Parent Entity URLs')
    canonical = {x.lower():x for x in names}
    def key(cell):
        return canonical.get(text(cell).strip(' |:').lower())
    for table in re.findall(r'<table\b[^>]*>(.*?)</table>', html, flags=re.I|re.S):
        rows = [re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, flags=re.I|re.S)
                for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table, flags=re.I|re.S)]
        for number, cells in enumerate(rows):
            if len(cells) < 2:
                continue
            keys = [key(c) for c in cells]
            pairs = []
            if all(keys) and number + 1 < len(rows) and len(rows[number+1]) == len(cells):
                pairs = zip(keys, rows[number+1])
            elif len(cells) == 2 and keys[0] and not keys[1]:
                pairs = [(keys[0],cells[1])]
            for label, cell in pairs:
                value = text(cell).strip(' |')
                if label.startswith('Can ') or label == 'Supports webhooks':
                    operation = label.removeprefix('Can ').lower()
                    required_false = re.search(r'\bonly when\s+(\w+)\s*=\s*false', value, re.I)
                    if required_false:
                        conditions[operation] = {'documented_false_flag': required_false.group(1)}
                    elif re.search(r'\blag days only\b', value, re.I):
                        conditions[operation] = {'editable_attribute': 'lag days'}
                    elif value.startswith('[yes]') and value.strip() != '[yes]':
                        conditions[operation] = {'source_review_required': True}
                    value = ('[yes]' if value.lower().startswith(('[yes]', 'true'))
                             else 'false' if value.lower().startswith('false')
                             else '' if not value else 'unresolved')
                values[label] = value
    title = re.search(r'<h1\b[^>]*>(.*?)</h1>', html, flags=re.I|re.S)
    return {'url':url,'title':text(title.group(1)) if title else None,'details':values,'operation_conditions':conditions,
            'evidence':'Factual API observations only; source URL required for field rules and conditions.'}

def fetch(url):
    try:
        request = Request(url, headers={'User-Agent':'Rarity-Autotask-MCP-Research/1.0'})
        with urlopen(request, timeout=45) as response:
            raw = response.read()
            status = response.status
            encoding = response.headers.get_content_charset() or 'utf-8'
        page = raw.decode(encoding, errors='replace')
        if not re.search(r'<h1\b', page, flags=re.I):
            raise ValueError('Expected entity page heading missing')
        result = extract(page,url)
        result.update({'status':status,'retrieved_utc':datetime.now(timezone.utc).isoformat(),
                       'bytes':len(raw),'sha256':sha256(raw).hexdigest(),
                       'repository_copy':'Not retained; consult the source URL.'})
        return result
    except Exception as exc:
        return {'url':url,'status':0,'error':str(exc),'retrieved_utc':datetime.now(timezone.utc).isoformat()}

def main():
    seed = json.loads(SEED.read_text(encoding='utf-8-sig'))
    urls = sorted({url.split('#')[0] for item in seed for url in item['DocumentationURLs'] if '/REST/Entities/' in url})
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(fetch,url):url for url in urls}
        for future in as_completed(pending):
            result = future.result()
            results.append(result)
            if len(results) % 25 == 0 or result['status'] != 200:
                print(json.dumps({'completed':len(results),'total':len(urls),'last_status':result['status'],'last_url':result['url']}),flush=True)
    results.sort(key=lambda x:x['url'])
    observations = json.loads((ROOT/'extracted-reference-details.json').read_text(encoding='utf-8'))
    by_url = {row['url']:row for row in observations}
    for result in results:
        if result['status'] == 200:
            by_url[result['url']] = {key:result[key] for key in ('url','title','details','operation_conditions','evidence')}
    (ROOT/'extracted-reference-details.json').write_text(json.dumps(sorted(by_url.values(),key=lambda row:row['url']),indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    metadata = [{key:value for key,value in row.items() if key not in ('details','icons','operation_conditions')} for row in results]
    (ROOT/'source-manifest.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({'pages':len(results),'successful':sum(r['status']==200 for r in results),
                      'retained_raw_page_copies':0}),flush=True)

if __name__ == '__main__':
    main()
