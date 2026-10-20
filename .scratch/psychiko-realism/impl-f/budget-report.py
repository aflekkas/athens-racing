import json,hashlib,subprocess
from pathlib import Path
p=Path(__file__).resolve().parent
load=lambda f:json.loads((p/f).read_text())
before,after=load('harness/perf-before.json'),load('harness/perf-final.json');checks=[];table=['| Camera | Calls before → after | Triangles before → after | Limit |','| --- | ---: | ---: | ---: |']
assert not after['errors']
for f,h in after['sourceHashes'].items():assert hashlib.sha256(Path(f).read_bytes()).hexdigest()==h,f
for tier in ['low','high']:
 b=next(r for r in before['rows'] if r['tier']==tier);a=next(r for r in after['rows'] if r['tier']==tier)
 for pose,label,tri,call in [('mid','matched',909000 if tier=='low' else 935000,69*1.1 if tier=='low' else 81*1.1),('start','Faros',1600000 if tier=='low' else 1700000,166 if tier=='low' else 192)]:
  x=next(r['render'] for r in b['poses'] if r['name']==pose);y=next(r['render'] for r in a['poses'] if r['name']==pose);name=tier.title()+' · '+label
  checks.append({'name':name,'before':{'calls':x['calls'],'triangles':x['triangles']},'after':{'calls':y['calls'],'triangles':y['triangles']},'triangleLimit':tri,'callLimit':call,'pass':y['triangles']<=tri and y['calls']<=call});table.append(f"| {name} | {x['calls']:,} → {y['calls']:,} | {x['triangles']:,} → {y['triangles']:,} | {tri:,} |")
for r in load('detail-fixed.json')['rows']:
 b,a=r['before'],r['after'];name=r['name'].replace('psychiko-mid-','Game · ');checks.append({'name':name,'before':b,'after':a,'triangleLimit':821000,'callLimit':79*1.1,'pass':a['triangles']<=821000 and a['calls']<=79*1.1});table.append(f"| {name} | {b['calls']:,} → {a['calls']:,} | {b['triangles']:,} → {a['triangles']:,} | 821,000 |")
assert all(c['pass'] for c in checks),checks
(p/'budget-results.json').write_text(json.dumps({'pass':True,'runtimeHashesMatch':True,'checks':checks},indent=2)+'\n');(p/'budget-table.md').write_text('\n'.join(table)+'\n');print('\n'.join(table))
