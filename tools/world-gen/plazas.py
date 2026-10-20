#!/usr/bin/env python3
"""Paved squares of Athens from OSM: `plazas.py CACHE OUT.json` writes `assets/athens/plazas.json`.

Every polygon tagged place=square, or highway=pedestrian with area=yes (not a building, not tagged leisure, landuse, natural or amenity, 300 to 40,000 m2), inside the Attica extract, as an outline in world
metres (x east, z south, the cells' projection) rounded to half a metre and simplified by 1 m. The ground bake has no class for these, so a
square is baked as plain earth; src/athens-plazas.js lays paving over them at run time, on the streamed ground, with no change to any cell."""
import json,sys
from pathlib import Path
import osmium
from shapely.geometry import Polygon,MultiPolygon
from shapely.ops import unary_union

LAT0,LON0,MLAT,MLON=37.98,23.73,111320.,87745.27512677578
def world(lat,lon):return ((lon-LON0)*MLON,-(lat-LAT0)*MLAT)
MIN_AREA=300.;MAX_AREA=40000.  # larger ones are parks and campuses that carry a pedestrian tag, not squares
PARKLIKE=('leisure','landuse','natural','amenity')
REGION=(-40000.,-38000.,36000.,34000.)  # x0,z0,x1,z1: the horizon grid's extent

class Collect(osmium.SimpleHandler):
 def __init__(s):super().__init__();s.rows=[]
 def area(s,a):
  t=a.tags
  if t.get('building') not in (None,'no'):return
  if any(t.get(k) for k in PARKLIKE):return
  if not (t.get('place')=='square' or (t.get('highway')=='pedestrian' and t.get('area')=='yes')):return
  parts=[]
  for ring in a.outer_rings():
   pts=[world(n.lat,n.lon) for n in ring]
   if len(pts)>=4:parts.append(Polygon(pts).buffer(0))
  if not parts:return
  g=unary_union(parts)
  for p in (g.geoms if isinstance(g,MultiPolygon) else [g]):
   if MIN_AREA<=p.area<=MAX_AREA:s.rows.append(p)

def main():
 cache=Path(sys.argv[1]);out=Path(sys.argv[2]);h=Collect()
 h.apply_file(str(cache/'attica.osm.pbf'),locations=True)
 plazas=[]
 for p in sorted(h.rows,key=lambda g:(round(g.centroid.x),round(g.centroid.y))):
  c=p.centroid
  if not (REGION[0]<=c.x<=REGION[2] and REGION[1]<=c.y<=REGION[3]):continue
  q=p.simplify(1.,preserve_topology=True)
  if q.is_empty or q.geom_type!='Polygon':q=p
  if q.geom_type!='Polygon':continue
  ring=[[round(x*2),round(z*2)] for x,z in list(q.exterior.coords)[:-1]]
  flat=[v for pt in ring for v in pt]
  plazas.append(flat)
 out.write_text(json.dumps({'unit':.5,'plazas':plazas},separators=(',',':')))
 print(len(plazas),'plazas',out.stat().st_size,'bytes')
if __name__=='__main__':main()
