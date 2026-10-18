"""Deterministic coastal mask and local bridge/approach surfaces from cached OSM.

Bridges keep separate contact layers. Their incident same-name carriageways
form the approach deck; the crossing ground corridor has a smooth underpass.
All functions are global-coordinate fields, evaluated before tile clipping.
"""
import json,math
from shapely.geometry import shape,Point,Polygon,LineString,box
from shapely.ops import unary_union
from shapely import prepare
from bridge_policy import require_bridge_yes,connected_approaches


def smooth(t):
 t=max(0.,min(1.,t));return t*t*t*(10+t*(-15+6*t))


class Coast:
 def __init__(self,source,cell):
  manifest=json.loads(source.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
  mainland=manifest['masks']['c_attica_mainland']
  if not mainland:raise ValueError('Resolved OSM mainland coast required')
  ox,oz=(v*512 for v in cell);halo=box(ox-512,oz-512,ox+1024,oz+1024)
  land=[shape(mainland).intersection(halo)]
  # Closed coastline islands preserve the same OSM outline as mainland.
  for text, in source.execute("SELECT o.data FROM spatial s JOIN objects o ON o.rowid=s.rowid WHERE o.kind='coast' AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=?",(ox+1024,ox-512,oz+1024,oz-512)):
   g=shape(json.loads(text)['geometry'])
   if g.geom_type=='LineString' and g.is_ring:
    island=Polygon(g.coords)
    if island.is_valid and island.area>1:land.append(island.intersection(halo))
  self.land=unary_union(land);prepare(self.land)
 def baseline(self,x,z,y):
  p=Point(x,z)
  if self.land.covers(p):return max(.25,y)
  # Bathymetry is inferred, not a measured underwater DEM.
  return -8. if self.land.is_empty else -min(8.,.25+self.land.distance(p)*.15)
 def water(self,cell,roads):
  x,z=(v*512 for v in cell);area=box(x,z,x+512,z+512)
  # Mapped quays/pier roads retain a full physical shoulder.
  safe=unary_union([r['polygon'].buffer(8,join_style=2) for r in roads])
  return area.difference(self.land.union(safe))


# Approved playable cells; expanding this boundary requires resolving any new
# mapped structures, not silently treating a newly included bridge as ground.
COAST_EXTENT=box(0,25*512,10*512,37*512)

class Structures:
 def __init__(self,roads,bridge_tags):
  bridges=[r for r in roads if r['bridge'] and r['polygon'].intersects(COAST_EXTENT)]
  require_bridge_yes(bridges,bridge_tags)
  if any(r['tunnel'] or r['layer'] and not r['bridge'] for r in roads if r['polygon'].intersects(COAST_EXTENT)):raise ValueError('Unresolved tunnel/non-bridge structure')
  groups=[];remaining=set(r['id'] for r in bridges)
  while remaining:
   first=next(r for r in bridges if r['id']==min(remaining));group=[first];remaining.remove(first['id'])
   for r in bridges:
    if r['id'] in remaining and r['name']==first['name'] and r['line'].distance(first['line'])<40:group.append(r);remaining.remove(r['id'])
   centre0=unary_union([r['line'] for r in group]).centroid
   upper=connected_approaches(roads,group,(centre0.x,centre0.y))
   bridge_area=unary_union([r['polygon'] for r in group])
   lower=[r for r in roads if r not in upper and not r['layer'] and r['line'].intersects(bridge_area)]
   if not lower:raise ValueError('Bridge has no resolved crossing road: '+first['id'])
   centre=unary_union([r['line'].intersection(bridge_area) for r in lower]).centroid
   line=max(lower,key=lambda r:r['line'].length)['line'];at=line.project(centre);a=line.interpolate(max(0,at-1));b=line.interpolate(min(line.length,at+1));length=a.distance(b)
   tx,tz=(b.x-a.x)/length,(b.y-a.y)/length
   # A 128 m smooth taper along the underpass keeps its grade bounded.
   # The deck extends onto connected approaches to avoid a grade break at an OSM bridge tag boundary.
   platform=unary_union([r['polygon'] for r in upper]).buffer(.6,join_style=2)
   counts={}
   for r in upper:
    for n in (r['fromNode'],r['toNode']):counts[n]=counts.get(n,0)+1
   outer=[p for r in upper for n,p in [(r['fromNode'],r['points'][0]),(r['toNode'],r['points'][-1])] if counts[n]==1]
   across_end=min(112.,min(abs((p[0]-centre.x)*(-tz)+(p[1]-centre.y)*tx) for p in outer)-24)
   if across_end<35:raise ValueError('Bridge approaches too short for a safe underpass solve')
   groups.append(dict(id=first['id'],bridgeSources=[r['id'] for r in group],roads=upper,lower=lower,centre=(centre.x,centre.y),axis=(tx,tz),platform=platform,acrossEnd=across_end))
  self.groups=groups;self.raised={r['id'] for g in groups for r in g['roads']}
  self.deck=[r for r in roads if r['id'] in self.raised];self.ground=[r for r in roads if r['id'] not in self.raised]
  self.platform=unary_union([g['platform'] for g in groups])
 def depression(self,x,z):
  result=0.
  for g in self.groups:
   dx,dz=x-g['centre'][0],z-g['centre'][1];tx,tz=g['axis'];along=abs(dx*tx+dz*tz);across=abs(dx*(-tz)+dz*tx)
   result=max(result,6.*(1-smooth((along-8)/192))*(1-smooth((across-20)/(g['acrossEnd']-20))))
  return result
