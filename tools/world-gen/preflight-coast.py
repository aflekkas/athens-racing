"""Cheap full-extent topology check before expensive height/contact auditing."""
import sys,sqlite3,json,time
from pathlib import Path
from tiles import Field
from surfaces import ground_mesh,validate_partition
from street_details import pavement_regions
root=Path(sys.argv[1]);raw=sqlite3.connect(root/'source.sqlite');tags={i:json.loads(t).get('bridge') for i,t in raw.execute("select id,tags from features where kind='road'")}
db=sqlite3.connect(root/'profiles-a.sqlite');source=sqlite3.connect(root/'clean.sqlite');dems=[root/'attica-n37-e023.tif',root/'attica-n38-e023.tif'];seams={};count=0
cells=[(x,z) for z in range(25,37) for x in range(10)]+[(x,24) for x in range(2,8)]+[(10,31)]
for cell in cells:
 start=time.monotonic();f=Field(db,source,cell,dems,True,tags);u,k,p=pavement_regions(f.ground_roads);m=ground_mesh(cell,f.ground_roads,lambda x,z:0,[k.boundary,p.boundary]);validate_partition(m);ps=m['positions']
 edges=[sorted({ps[i+other] for i in range(0,len(ps),3) if ps[i+axis]==value}) for axis,other,value in [(0,2,0),(0,2,512),(2,0,0),(2,0,512)]]
 seams[cell]=edges;x,z=cell
 for n,a,b in [((x-1,z),0,1),((x+1,z),1,0),((x,z-1),2,3),((x,z+1),3,2)]:
  if n in seams:
   if edges[a]!=seams[n][b]:raise ValueError(f'Seam {cell}/{n}: {set(edges[a])-set(seams[n][b])} / {set(seams[n][b])-set(edges[a])}')
   count+=1
 print(json.dumps(dict(cell=cell,seams=count,seconds=time.monotonic()-start)),flush=True)
print(json.dumps(dict(passed=True,cells=len(cells),seams=count)),flush=True)
