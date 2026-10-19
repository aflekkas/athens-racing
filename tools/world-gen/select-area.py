"""Pick the 512 m cells of a streamed Athens area from the cleaned OSM cache, deterministically.

A cell is wanted when it holds roads or buildings, touches the mainland land mask, and lies within the
area's distance (km, from the cell's nearest edge to the coastline) of the sea: a coastal band of
`strip_km` south of row `core_row`, and `core_km` north of it (Faliro, Neo Faliro and the Piraeus
peninsula are narrower than 2 km, so the whole city is inside). The ring of sea/empty neighbours is
added so the coastline and open water are baked, not cut off at the last land cell.

  select-area.py CACHE OUTPUT.json [--strip-km 1.2 --core-km 1.5 --core-row 13 --west -19 --north 7 --south 24]
"""
import argparse,collections,json,math,sqlite3
from pathlib import Path
from shapely.geometry import box,shape

p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('output',type=Path)
p.add_argument('--strip-km',type=float,default=1.2);p.add_argument('--core-km',type=float,default=1.5);p.add_argument('--core-row',type=int,default=13)
p.add_argument('--west',type=int,default=-19);p.add_argument('--east',type=int,default=9);p.add_argument('--north',type=int,default=7);p.add_argument('--south',type=int,default=24)
a=p.parse_args()
db=sqlite3.connect(f'file:{a.cache/"clean.sqlite"}?mode=ro',uri=True)
land=shape(json.loads(db.execute("select value from metadata where key='manifest'").fetchone()[0])['masks']['c_attica_mainland']);coast=land.boundary
buildings=collections.Counter();roads=collections.Counter()
for kind,minx,maxx,minz,maxz in db.execute("select o.kind,s.minx,s.maxx,s.minz,s.maxz from objects o join spatial s on o.rowid=s.rowid where o.kind in ('road','building') and s.maxx>? and s.minx<? and s.maxz>? and s.minz<?",((a.west-1)*512,(a.east+1)*512,(a.north-1)*512,(a.south+1)*512)):
    cell=(math.floor((minx+maxx)/1024),math.floor((minz+maxz)/1024));(roads if kind=='road' else buildings)[cell]+=1
land_cells=set()
for z in range(a.north,a.south+1):
    for x in range(a.west,a.east+1):
        if not (buildings[(x,z)] or roads[(x,z)]):continue
        c=box(x*512,z*512,x*512+512,z*512+512)
        if not land.intersects(c):continue
        limit=a.core_km if z<a.core_row else a.strip_km
        if (land.contains(c.centroid) or c.intersects(coast)) and c.distance(coast)/1000<=limit:land_cells.add((x,z))
ring=set()
for x,z in land_cells:
    for dx in (-1,0,1):
        for dz in (-1,0,1):
            if (x+dx,z+dz) not in land_cells:ring.add((x+dx,z+dz))
# Ring cells that are land with real content are left out (the area stops there); the rest are sea or empty ground.
sea={c for c in ring if not (buildings[c] or roads[c]) or not land.intersects(box(c[0]*512,c[1]*512,c[0]*512+512,c[1]*512+512))}
result=dict(name=a.output.stem,parameters=dict(stripKm=a.strip_km,coreKm=a.core_km,coreRow=a.core_row,west=a.west,east=a.east,north=a.north,south=a.south),
    land=[list(c) for c in sorted(land_cells)],sea=[list(c) for c in sorted(sea)],buildings=sum(buildings[c] for c in land_cells),roads=sum(roads[c] for c in land_cells))
a.output.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(json.dumps(dict(land=len(land_cells),sea=len(sea),buildings=result['buildings'],roads=result['roads'])))
