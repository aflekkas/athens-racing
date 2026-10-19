"""Decide every bridge deck of an area ONCE, for the whole area, and write areas/<area>.structures.json.

A cell only sees the roads its halo loads, so grouping a physical bridge from a clipped halo can differ between
neighbours (a different first way, a shorter chain, a different decision). The plan is therefore made with every road of
the area in view; the bake then builds each cell's decks from the plan, identically in every cell.

  plan-structures.py CACHE AREA

A deck group is kept when its approaches are long enough to lift it (`Structures`) and every road passing under it keeps
4.5 m under the slab; otherwise the deck's roads are left out (the street beneath stays) and iterated until stable. Ground
streets that join a deck inside the underpass dip are left out too. The plan is deterministic, reviewable and committed.
"""
import json,sqlite3,sys,time
from pathlib import Path
from shapely.geometry import mapping
import areas
import tiles
from tiles import Field

cache=Path(sys.argv[1]);area=areas.load(sys.argv[2])
paths={k:cache/v for k,v in area['sources'].items()};dems=[cache/'attica-n37-e023.tif',cache/'attica-n38-e023.tif'];extent=areas.extent(area['cells'])
raw=sqlite3.connect(f'file:{paths["osm"]}?mode=ro',uri=True);tags={i:json.loads(t).get('bridge') for i,t in raw.execute("select id,tags from features where kind='road'")};raw.close()
minx,minz,maxx,maxz=extent.bounds;bounds=(minx-512,minz-512,maxx+512,maxz+512)

def field():
 db=sqlite3.connect(f'file:{paths["profiles"]}?mode=ro',uri=True);source=sqlite3.connect(f'file:{paths["source"]}?mode=ro',uri=True);sections=sqlite3.connect(f'file:{paths["sections"]}?mode=ro',uri=True)
 return Field(db,source,(0,0),dems,True,tags,sections,extent,strict=False,bounds=bounds)

if __name__=='__main__':
 started=time.monotonic();excluded={};history=[]
 for round_ in range(1,10):
  f=field();failed=list(f.structures.failed)
  for g in f.structures.groups:
   centre,samples=f.clearance(g);least=min([centre,*samples])
   if least<4.5:failed.append(dict(id=g['id'],upper=sorted(r['id'] for r in g['roads']),reason='underpass clearance %.2f m'%least))
  history.append(dict(round=round_,groups=len(f.structures.groups),failed=len(failed),unresolved=len(f.structures.unresolved),dropped=len(f.structures.dropped)))
  print(json.dumps(history[-1]),file=sys.stderr,flush=True)
  if not failed:break
  for g in sorted(failed,key=lambda g:g['id']):
   for rid in g['upper']:
    reason='deck group '+g['id']+' cannot be lifted safely: '+g['reason'];excluded[rid]=reason;tiles.EXCLUDED.add(rid);tiles.EXCLUSION_REASONS[rid]=reason
 else:raise SystemExit('Structure plan did not converge')
 for rid,reason in f.structures.dropped.items():excluded[rid]=reason
 plan=dict(area=area['name'],groups=[dict(id=g['id'],bridgeSources=g['bridgeSources'],upper=sorted(r['id'] for r in g['roads']),lower=sorted(r['id'] for r in g['lower']),centre=list(g['centre']),axis=list(g['axis']),acrossEnd=g['acrossEnd'],upperNodes=sorted({n for r in g['roads'] for n in (r['fromNode'],r['toNode'])}),platform=json.loads(json.dumps(mapping(g['platform'])))) for g in sorted(f.structures.groups,key=lambda g:g['id'])],
  unresolved=sorted(f.structures.unresolved),excluded=dict(sorted(excluded.items())),
  report=dict(rounds=history,ruleExclusions=dict(sorted(f.excluded.items())) and len({k for k,v in f.excluded.items() if k not in excluded}),seconds=round(time.monotonic()-started)))
 out=areas.AREAS/f'{area["name"]}.structures.json';out.write_text(json.dumps(plan,indent=1)+'\n')
 print(json.dumps(dict(groups=len(plan['groups']),unresolved=len(plan['unresolved']),excluded=len(plan['excluded']),rounds=len(history),file=str(out))))
