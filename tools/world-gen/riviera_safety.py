"""Riviera roadside protection on generated OSM road edges.

Carries the native hazard thresholds and mapped access openings forward. The
new surface's own shoulders and junction arms decide placement; no legacy road
mesh/contact is copied. Visible steel and concrete lie inside solid wall rows.
Source and reconstruction limits: tools/riviera-rails.md.
"""
import json,math
from pathlib import Path
from shapely.geometry import LineString,Point,box
from tile_detail import _prism

_DATA=None

def data():
 global _DATA
 if _DATA is None:
  m=json.loads((Path(__file__).resolve().parents[2]/'data/map.json').read_text());p=m['proj']
  def world(x,z):return ((p['lon0']+x/p['mlon']-23.73)*87745.27512677578,(37.98-p['lat0']+z/p['mlat'])*111320)
  route=LineString([world(x,z) for x,z in zip(m['route']['x'],m['route']['z'])])
  _DATA=(m,route,[Point(world(q['x'],q['z'])) for q in m.get('parkSpots',[])])
 return _DATA

# Same mapped footway stations as src/riviera-guardrails.js, 12 m openings.
ACCESS=[2543,2594,7523,8783,9079,9974,10214,10293,10597]

def build(field,cell,height):
 ox,oz=(v*512 for v in cell)
 if ox>10570 or ox+512<3650 or oz>20780 or oz+512<16730:return [],[],[],[],[]
 m,route,parks=data();lim=next((v['s'] for v in m['marks'] if v['id']=='limanakia'),None);beach=[] if lim is None else [lim-160,lim+25,lim+210];bounds=box(ox,oz,ox+512,oz+512);context=bounds.buffer(20);ps=[];ix=[];concrete_ps=[];concrete_ix=[];rails=[]
 # A real crossing/side road keeps its mouth open. OSM tag boundaries with
 # exactly two incident parts are continuous carriageway, not junctions.
 nodes={}
 for r in field.roads:
  for node,p in ((r['fromNode'],r['points'][0]),(r['toNode'],r['points'][-1])):nodes.setdefault(node,[]).append((r,p))
 junctions=[Point(rows[0][1]) for rows in nodes.values() if len(rows)>2]
 for r in field.ground_roads:
  if r['highway']!='primary' or r['tunnel'] or r['line'].distance(route)>40:continue
  line=r['line'];n=max(1,math.ceil(line.length/2));step=line.length/n
  for side in (-1,1):
   sidewalk=r['section']['sidewalk']['left' if side>0 else 'right'];offset=r['width']/2+sidewalk+.55
   run=[]
   def emit():
    if len(run)<7:return
    for A,B,concrete in zip(run,run[1:],[q[3] for q in run]):
     segment=LineString([(A[0],A[2]),(B[0],B[2])]).intersection(bounds)
     if segment.geom_type!='LineString' or segment.length<.01:continue
     ends=[]
     for x,z in (segment.coords[0],segment.coords[-1]):ends.append((x,z,height(x,z)))
     (x,z,y),(xx,zz,yy)=ends
     h=.86;rails.append([x-ox,y,z-oz,xx-ox,yy,zz-oz,h])
     a,b=(x-ox,z-oz),(xx-ox,zz-oz)
     if concrete:_prism(concrete_ps,concrete_ix,a,b,y,yy,.15,0,h,True)
     else:
      _prism(ps,ix,a,b,y,yy,.09,.51,.86,True)
      # A post per two-metre source segment, all inside the collision volume.
      dx,dz=xx-x,zz-z;length=math.hypot(dx,dz)
      if length>.15:_prism(ps,ix,a,(a[0]+dx/length*.10,a[1]+dz/length*.10),y,y,.08,0,.86,True)
   for j in range(n+1):
    s=step*j;p=line.interpolate(s)
    if not context.covers(p):emit();run=[];continue
    a=line.interpolate(max(0,s-.2));b=line.interpolate(min(line.length,s+.2));dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
    x,z=p.x-side*dz/length*offset,p.y+side*dx/length*offset;q=Point(x,z)
    station=route.project(p);urban=next((zone['urban'] for zone in reversed(m['zones']) if station>=zone['s']),1)
    ref=route.interpolate(station);ra=route.interpolate(max(0,station-1));rb=route.interpolate(min(route.length,station+1));rdx,rdz=rb.x-ra.x,rb.y-ra.y
    reference_side=1 if (x-ref.x)*(-rdz)+(z-ref.y)*rdx>=0 else -1
    concrete=any(v['s0']<=station<=v['s1'] and v['side']==reference_side for v in m.get('barriers',[]))
    blocked=(not concrete and (urban>=.5 or any(abs(station-v)<12 for v in ACCESS) or any(q.distance(p)<12 for p in parks))) or any(q.distance(p)<10 for p in junctions)
    # Preserve the Limanakia walking approaches from the native recipe.
    if not concrete and field.coast and any(abs(station-v)<65 for v in beach):
     coast_side=Point(p.x-side*dz/length*(offset+24),p.y+side*dx/length*(offset+24));opposite=Point(p.x+side*dz/length*(offset+24),p.y-side*dx/length*(offset+24))
     if field.coast.land.boundary.distance(coast_side)<=field.coast.land.boundary.distance(opposite):blocked=True
    # A parallel carriageway must never get a rail across its own asphalt.
    if any(other['id']!=r['id'] and other['polygon'].buffer(.5).covers(q) for other in field.roads):blocked=True
    y=height(x,z);drops=[]
    for distance in (6,16,24):
     xx,zz=x-side*dz/length*distance,z+side*dx/length*distance
     # The shoulder solve deliberately softens the first 64 m. Measure
     # the native cliff hazard before that solve, then place protection on
     # the actual emitted surface; otherwise the solve erases its own rails.
     natural=field.dem.height(xx,zz)
     if field.coast:natural=field.coast.baseline(xx,zz,natural)
     drops.append(y-natural)
    def angle(at):
     a=line.interpolate(max(0,at-1));b=line.interpolate(min(line.length,at+1));return math.atan2(b.y-a.y,b.x-a.x)
    delta=angle(min(line.length,s+4))-angle(max(0,s-4));curve=math.atan2(math.sin(delta),math.cos(delta))/8
    wanted=not blocked and (concrete or drops[0]>2.2 or drops[1]>4.5 or drops[2]>7 or abs(curve)>.012 and drops[1]>3.5)
    if wanted:run.append((x,y,z,concrete))
    else:emit();run=[]
   emit()
 return ps,ix,concrete_ps,concrete_ix,rails
