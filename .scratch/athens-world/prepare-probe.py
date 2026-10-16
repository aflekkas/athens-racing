import sqlite3,json,sys
from pathlib import Path
sys.path.insert(0,'/tmp/athens-world-generator/tools/world-gen')
from shapely import from_wkb
from clean import query
from buildings import building_parts,palette_index
from ingest import encode
c=Path('/tmp/athens-world-cache');source=sqlite3.connect(f'file:{c}/source.sqlite?mode=ro',uri=True)
path=c/'probe-source.sqlite'
if path.exists():raise SystemExit('Existing probe source retained')
db=sqlite3.connect(path);db.executescript('CREATE TABLE objects(rowid INTEGER PRIMARY KEY,id TEXT,kind TEXT,data TEXT);CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);')
x,z=4*512,25*512
for identifier,kind,tags,wkb in source.execute("SELECT f.id,f.kind,f.tags,f.geometry FROM spatial s CROSS JOIN features f ON f.rowid=s.rowid WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? AND f.kind IN ('building','landuse','landcover') ORDER BY f.id",(x+512,x,z+512,z)):
 g=from_wkb(wkb);tags=json.loads(tags)
 if kind=='building':
  center=g.centroid;landuses=[]
  for lid,lt,lw,_ in query(source,center,'landuse'):
   land=from_wkb(lw)
   if land.covers(center):landuses.append((land.area,lid,json.loads(lt)['landuse']))
  parts=building_parts(identifier,g,tags,min(landuses)[2] if landuses else '')
  if parts is None:continue
  for p in parts:p['palette']=palette_index(identifier)
  data=dict(id=identifier,centroid=[center.x,center.y],parts=parts,triangles=sum(p['triangles'] for p in parts))
 else:
  from shapely.geometry import mapping
  data=dict(id=identifier,geometry=mapping(g),tags=tags)
 row=db.execute('INSERT INTO objects(id,kind,data) VALUES(?,?,?)',(identifier,kind,encode(data))).lastrowid
 a,b,cc,d=g.bounds;db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(row,a,cc,b,d))
db.commit();print(list(db.execute('SELECT kind,count(*) FROM objects GROUP BY kind')))
