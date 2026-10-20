#!/usr/bin/env python3
"""Paved squares of Athens from OSM: `plazas.py CACHE OUT.json [LAWNS.json]` writes `assets/athens/plazas.json` (and the garden and lawn outlines, `assets/athens/lawns.json`).

Every polygon tagged place=square, or highway=pedestrian (a closed way with area=yes, or a multipolygon relation; not a building, not a park or garden, 300 to 40,000 m2), grown by 8 m minus every lawn, wood and water polygon, and any gap under 14 m between a square and a lawn closed in full, inside the Attica extract, as an outline in world
metres (x east, z south, the cells' projection) rounded to half a metre and simplified by 2 m. The ground bake has no class for these, so a
square is baked as plain earth; src/athens-plazas.js lays paving over them at run time, on the streamed ground, with no change to any cell."""
import json,sys
from pathlib import Path
import osmium
from shapely.geometry import Polygon,MultiPolygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

LAT0,LON0,MLAT,MLON=37.98,23.73,111320.,87745.27512677578
def world(lat,lon):return ((lon-LON0)*MLON,-(lat-LAT0)*MLAT)
LAWN_MIN=80.
LAWN_BAND=50.
MIN_AREA=300.;MAX_AREA=40000.  # larger ones are parks and campuses that carry a pedestrian tag, not squares
PARKLIKE=('leisure','landuse','natural','amenity')
CLOSE=14. # a gap of up to 14 m between a square and a lawn is closed in full
RIM=8.   # paving also covers the unmapped rim around a square (OSM maps the kerb strip and the footways beside it as lines, not areas), but never a lawn, a wood or water
GREEN=dict(leisure=('park','garden','pitch','playground','golf_course','nature_reserve'),landuse=('grass','meadow','recreation_ground','village_green','cemetery','allotments','forest','orchard','vineyard','farmland','flowerbed'),natural=('wood','scrub','grassland','heath','bare_rock','scree','water'),landscape=('lawn',))
REGION=(-40000.,-38000.,36000.,34000.)  # x0,z0,x1,z1: the horizon grid's extent

class Collect(osmium.SimpleHandler):
 def __init__(s):super().__init__();s.rows=[];s.green=[];s.lawns=[]
 def area(s,a):
  t=a.tags
  if t.get('building') not in (None,'no'):return
  if any(t.get(k) in v for k,v in GREEN.items()):
   try:
    g=unary_union([Polygon([world(n.lat,n.lon) for n in r]).buffer(0) for r in a.outer_rings() if len(list(r))>=4])
    if not g.is_empty:
     s.green.append(g)
     # gardens, flower beds and lawns are not a ground class of the bake (only leisure=park and landuse grass are): they come out as lawn outlines too
     if t.get('leisure')=='garden' or t.get('landuse')=='flowerbed' or t.get('landscape')=='lawn':
      for q in (g.geoms if isinstance(g,MultiPolygon) else [g]):
       if LAWN_MIN<=q.area<=MAX_AREA:s.lawns.append(q)
   except Exception:pass
   if not t.get('place')=='square':return
  if any(t.get(k) for k in PARKLIKE):return
  if not (t.get('place')=='square' or (t.get('highway')=='pedestrian' and (t.get('area')=='yes' or not a.from_way()))):return
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
 plazas=[];tree=STRtree(h.green) if h.green else None
 for p in sorted(h.rows,key=lambda g:(round(g.centroid.x),round(g.centroid.y))):
  c=p.centroid
  if not (REGION[0]<=c.x<=REGION[2] and REGION[1]<=c.y<=REGION[3]):continue
  near=[h.green[int(i)] for i in tree.query(p.buffer(CLOSE))] if tree else []
  grown=p.buffer(RIM).difference(unary_union(near)) if near else p.buffer(RIM)
  if near: # a strip between the square and a lawn that is under 2 x CLOSE wide is closed completely (the footway or kerb strip OSM maps as a line)
   lawn=unary_union(near);fill=p.buffer(CLOSE).intersection(lawn.buffer(CLOSE)).difference(lawn)
   if not fill.is_empty:grown=unary_union([grown,fill])
  for g in near: # the bake classes a whole park as grass, but its ground is blended across large triangles, so a sandy band remains beside a square: lay lawn over the 50 m of park next to it
   if g.area<1000 or g.area>3e5:continue
   zone=g.intersection(p.buffer(LAWN_BAND))
   for q in (zone.geoms if zone.geom_type in ('MultiPolygon','GeometryCollection') else [zone]):
    if q.geom_type=='Polygon' and LAWN_MIN<=q.area<=MAX_AREA*1.5:h.lawns.append(q)
  parts=[g for g in (grown.geoms if grown.geom_type=='MultiPolygon' else [grown]) if g.geom_type=='Polygon' and g.area>=20]
  for g in parts or [p]:
   q=g.simplify(2.,preserve_topology=True)
   if q.is_empty or q.geom_type!='Polygon':q=g
   if q.geom_type!='Polygon':continue
   ring=[[round(x*2),round(z*2)] for x,z in list(q.exterior.coords)[:-1]]
   plazas.append([v for pt in ring for v in pt])
 out.write_text(json.dumps({'unit':.5,'plazas':plazas},separators=(',',':')))
 print(len(plazas),'plazas',out.stat().st_size,'bytes')
 if len(sys.argv)>3:
  lawns=[]
  for g in sorted(h.lawns,key=lambda g:(round(g.centroid.x),round(g.centroid.y))):
   c=g.centroid
   if not (REGION[0]<=c.x<=REGION[2] and REGION[1]<=c.y<=REGION[3]):continue
   q=g.simplify(2.,preserve_topology=True)
   if q.is_empty or q.geom_type!='Polygon':q=g
   if q.geom_type!='Polygon':continue
   lawns.append([v for x,z in list(q.exterior.coords)[:-1] for v in (round(x*2),round(z*2))])
  Path(sys.argv[3]).write_text(json.dumps({'unit':.5,'plazas':lawns},separators=(',',':')));print(len(lawns),'lawns',Path(sys.argv[3]).stat().st_size,'bytes')
if __name__=='__main__':main()
