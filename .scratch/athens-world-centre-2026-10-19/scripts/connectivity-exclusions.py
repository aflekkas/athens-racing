import sqlite3,json,collections,sys,math
sys.path.insert(0,'wt-centre/tools/world-gen')
import areas
from bridge_policy import exclusion_reason
g=sqlite3.connect('file:graph-ac.sqlite?mode=ro',uri=True)
edges=[json.loads(d) for d, in g.execute('select data from edges')]
for e in edges:e['length']=sum(math.hypot(b[0]-a[0],b[2]-a[2]) for a,b in zip(e['points'],e['points'][1:]))
cells={tuple(c) for c in areas.load('centre')['cells']};edges=[e for e in edges if tuple(e['cell']) in cells];print('graph edges in the baked cells',len(edges))
# road info for rule-based exclusions
prof=sqlite3.connect('file:profiles-ac.sqlite?mode=ro',uri=True);raw=sqlite3.connect('file:source.sqlite?mode=ro',uri=True)
tags={i:json.loads(t).get('bridge') for i,t in raw.execute("select id,tags from features where kind='road'")}
road={}
for d, in prof.execute('select data from roads'):
    r=json.loads(d);road[r['id']]=r
plan=json.load(open('wt-centre/tools/world-gen/areas/centre.structures.json'))['excluded']
steep={e['id']:'steep' for e in json.load(open('wt-centre/tools/world-gen/steep-exclusions.json'))}
coast={e['id']:'coast' for e in json.load(open('wt-centre/tools/world-gen/coast-exclusions.json'))}
cat={}
for rid,r in road.items():
    if rid in coast:cat[rid]='coast';continue
    if rid in steep:cat[rid]='steep';continue
    reason=exclusion_reason(r,tags.get(r['way']))
    if reason:cat[rid]='tunnel' if reason=='tunnel' else 'layers'
    elif rid in plan:cat[rid]='plan:'+('dip' if 'dip' in plan[rid] else 'deck')
print(collections.Counter(cat.values()))
def blocked(e):return bool(e['flags']&8)
def reach(include_cats):
    use=[e for e in edges if not blocked(e) and (e['source'] not in cat or cat[e['source']] in include_cats)]
    out=collections.defaultdict(list)
    for e in use:out[e['fromNode']].append(e)
    start=next(e for e in edges if e['id']=='osm:way:23182990:2-0:f:0:1')
    seen={start['id']};stack=[start]
    while stack:
        e=stack.pop()
        for n in out.get(e['toNode'],[]):
            if n['id'] not in seen:seen.add(n['id']);stack.append(n)
    def pir(e):x,z=e['cell'];return x<=-13 and z<=11
    tot=sum(e['length'] for e in use if pir(e));r=sum(e['length'] for e in use if pir(e) and e['id'] in seen)
    return round(100*r/max(tot,1)),round(sum(e['length'] for e in use if e['id'] in seen)/1000)
allcats={'coast','steep','tunnel','layers','plan:dip','plan:deck'}
print('as baked (no excluded roads):',reach(set()))
print('everything included:',reach(allcats))
for c in sorted(allcats):print('add back only',c,reach({c}))
