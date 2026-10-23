import runpy,json,sys
from collections import Counter
from pathlib import Path
m=runpy.run_path('/tmp/athens-terrain.uKVC/min-gradient-556/tools/terrain-lp/model.py');data=json.loads(Path('/tmp/athens-terrain.uKVC/min-gradient-input.json').read_text());p=m['Problem'](data)
parent={i:i for i,f in enumerate(p.free)if f}
def find(i):
 while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
 return i
def join(items):
 items=[i for i in items if i in parent]
 if items:
  a=find(items[0])
  for i in items[1:]:parent[find(i)]=a
for ts in p.ct:join(p.index[v]for v in ts)
for x,z in p.squares:
 for tri in [[(x,z),(x+8,z),(x,z+8)],[(x+8,z+8),(x,z+8),(x+8,z)]]:join(p.index[v]for v in tri if v in p.index)
for q in p.profiles:join(p.index[(x,z)]for x,z,*_ in m['basis'](q['x'],q['z'])if (x,z)in p.index)
counts=Counter(find(i)for i in parent);chords=Counter();fixed=[]
for c,ts in zip(p.chords,p.ct):
 comps=set(find(p.index[v])for v in ts if p.free[p.index[v]])
 assert len(comps)<=1
 if comps:chords[next(iter(comps))]+=1
 elif abs(c['signedSag'])>.5:fixed.append({'id':c['id'],'sag':c['signedSag']})
r={'status':'SOURCE graph decomposition diagnosis only; no matrix/solve/acceptance','freeNodes':len(parent),'components':len(counts),'largest':sorted([{'freeNodes':n,'chords':chords[k]}for k,n in counts.items()],key=lambda q:-q['freeNodes'])[:20],'fixedOnlyComfortFailures':fixed,'allConstraintsStayWithinOneFreeComponent':True,'sharedVariable':'gradient bound G only; monotone component constraints','sourceCommit':'556aa6704a1dfa1ff83001550058e0549c3189b1','inputSHA256':'e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281','emittedCells':0}
Path('/tmp/athens-terrain.uKVC/min-gradient-components.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
