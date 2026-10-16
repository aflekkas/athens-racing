import sqlite3,json,math,time
from shapely.geometry import Polygon,box
from collections import deque
from pathlib import Path
start=time.monotonic();db=sqlite3.connect('file:/tmp/athens-world-cache/clean.sqlite?mode=ro',uri=True)
queue=deque([(4,25)]);seen={(4,25)};edges={};limit=200
while queue and len(edges)<limit:
 cell=queue.popleft();x,z=[n*512 for n in cell];bounds=box(x,z,x+512,z+512);deps=set()
 rows=db.execute("SELECT o.data FROM spatial s CROSS JOIN objects o ON o.rowid=s.rowid WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? AND o.kind='building' ORDER BY o.id",(x+512,x,z+512,z))
 for data, in rows:
  b=json.loads(data);owner=tuple(math.floor(v/512) for v in b['centroid'])
  if owner==cell or not any(Polygon(p['footprint']).intersection(bounds).area>1e-6 for p in b['parts']):continue
  deps.add(owner)
 for d in sorted(deps):
  if d not in seen:seen.add(d);queue.append(d)
 edges[','.join(map(str,cell))]=[','.join(map(str,d)) for d in sorted(deps)]
result=dict(start=[4,25],processed=len(edges),reachableAtLeast=len(seen),pending=len(queue),limit=limit,complete=not queue,seconds=time.monotonic()-start,dependencies=edges)
p=Path('/tmp/athens-world-generator/.scratch/athens-world/dependency-audit.json');p.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='dependencies'}))
