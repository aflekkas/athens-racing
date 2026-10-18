"""Read-only pre-bake inventory; conservative 120-cell coast-inclusive envelope."""
import json,sqlite3,math,collections
from pathlib import Path
from shapely.geometry import shape,Polygon,box,LineString
cache=Path('/home/dev/data/athens-world-cache');out=Path(__file__).parent
connect=lambda name:sqlite3.connect(f'file:{cache}/{name}.sqlite?mode=ro',uri=True)
source=connect('clean');graph=connect('graph-a');veg=connect('vegetation');profiles=connect('profiles-a')
cells={(x,z) for x in range(10) for z in range(25,37)};bounds=box(0,12800,5120,18944)
rows={c:dict(cell=list(c),edges=0,roadMetres=0,buildings=0,coastMetres=0,trees=0,layeredRoads=[]) for c in cells}
roadids=set();unique={};adj=collections.defaultdict(set);starts=set();ends=set()
for data, in graph.execute('SELECT data FROM edges WHERE tx BETWEEN 0 AND 9 AND tz BETWEEN 25 AND 36'):
 e=json.loads(data);c=tuple(e['cell']);rows[c]['edges']+=1;roadids.add(e['source'])
 key=(e['source'],tuple(sorted((e['fromNode'],e['toNode']))));length=sum(math.hypot(b[0]-a[0],b[2]-a[2]) for a,b in zip(e['points'],e['points'][1:]))
 if key not in unique:unique[key]=length;rows[c]['roadMetres']+=length
 if not(e['flags']&8):
  adj[e['fromNode']].add(e['toNode'])
  if c==(4,25):starts.add(e['fromNode'])
  if c==(8,36):ends.add(e['toNode'])
seen=set(starts);queue=collections.deque(starts)
while queue:
 for v in adj[queue.popleft()]:
  if v not in seen:seen.add(v);queue.append(v)
owner_dependencies=set();coasts=[]
for kind,data in source.execute('SELECT o.kind,o.data FROM spatial s JOIN objects o ON o.rowid=s.rowid WHERE s.minx<=5120 AND s.maxx>=0 AND s.minz<=18944 AND s.maxz>=12800'):
 if kind not in ('building','coast'):continue
 r=json.loads(data)
 if kind=='building':
  owner=tuple(math.floor(v/512) for v in r['centroid'])
  if owner in cells:rows[owner]['buildings']+=1
  elif any(Polygon(p['footprint']).intersection(bounds).area>1e-6 for p in r['parts']):owner_dependencies.add(owner)
 else:
  g=shape(r['geometry']).intersection(bounds)
  if g.is_empty:continue
  coasts.append(r['id'])
  for c in cells:rows[c]['coastMetres']+=g.intersection(box(c[0]*512,c[1]*512,(c[0]+1)*512,(c[1]+1)*512)).length
layered=set()
for data, in profiles.execute('SELECT r.data FROM spatial s JOIN roads r ON r.rowid=s.rowid WHERE s.minx<=5120 AND s.maxx>=0 AND s.minz<=18944 AND s.maxz>=12800'):
 r=json.loads(data)
 if not(r['bridge'] or r['tunnel'] or r['layer']):continue
 g=LineString(r['points']).buffer(r['width']/2)
 for c in cells:
  if g.intersects(box(c[0]*512,c[1]*512,(c[0]+1)*512,(c[1]+1)*512)):rows[c]['layeredRoads'].append(r['id']);layered.add(r['id'])
for x,z in veg.execute('SELECT x,z FROM points WHERE x>=0 AND x<5120 AND z>=12800 AND z<18944'):rows[(math.floor(x/512),math.floor(z/512))]['trees']+=1
report=dict(proposedBoundsCells=[0,25,9,36],cells=len(cells),squareKm=len(cells)*512**2/1e6,roadKm=sum(unique.values())/1000,graphEdges=sum(r['edges'] for r in rows.values()),buildingOwners=sum(r['buildings'] for r in rows.values()),pointVegetation=sum(r['trees'] for r in rows.values()),coastKm=sum(r['coastMetres'] for r in rows.values())/1000,buildingDependencyCells=[list(c) for c in sorted(owner_dependencies)],layeredRoads=len(layered),layeredCells=[r['cell'] for r in rows.values() if r['layeredRoads']],directedGraphPathBetweenFixtures=bool(ends&seen),notes=['Inventory only; no cells generated. Conservative contiguous rectangular envelope includes coast and offshore islands.','Graph connectivity ignores turn restrictions; a legal route and layered surface support remain stage-2 work.','Vegetation count excludes area scatter; that is bounded by stage-2 quality budgets.'],perCell=[rows[c] for c in sorted(cells)])
(out/'inventory.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='perCell'},indent=2))
