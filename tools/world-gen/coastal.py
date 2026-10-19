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
from street_regions import unary_union as fold_union, canonical_polygon


def snap_border_nodes(geometry,tol=.05):
  """Move a vertex that lies on a cell border to the nearest 2 m border node when it is within `tol`.

  A platform edge noded at 2 cm precision can cross a border a centimetre or two from the 2 m border vertices every
  cell emits, leaving a 2 cm sliver segment whose side (deck or not) each cell decides from its own triangulation.
  With the crossing on the 2 m node there is no such segment. Falls back to the input if the result is not valid."""
  from shapely.geometry import Polygon,MultiPolygon
  if geometry.is_empty:return geometry
  if geometry.geom_type=='MultiPolygon':return MultiPolygon([snap_border_nodes(p,tol) for p in geometry.geoms])
  def ring(coords):
   out=[]
   for x,z in coords:
    for axis in (0,1):
     v=(x,z)[axis];border=round(v/512)*512
     if abs(v-border)<1e-9:
      other=(z,x)[axis];node=round(other/2)*2
      if 0<abs(other-node)<=tol:x,z=((x,node) if axis==0 else (node,z))
    out.append((x,z))
   return out
  snapped=Polygon(ring(geometry.exterior.coords),[ring(r.coords) for r in geometry.interiors])
  return snapped if snapped.is_valid and abs(snapped.area-geometry.area)<1 else geometry


def deck_platform(polygons):
  """Order-stable union of the deck roads' ribbons, widened 0.6 m, snapped like every street region: two cells that load
  different far-away roads must still build the same platform edge to the last bit (a 2 cm flip is a cracked seam)."""
  return snap_border_nodes(canonical_polygon(fold_union(polygons).buffer(.6,join_style=2)))


def smooth(t):
 t=max(0.,min(1.,t));return t*t*t*(10+t*(-15+6*t))


class Coast:
 def __init__(self,source,cell,bounds=None):
  manifest=json.loads(source.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
  mainland=manifest['masks']['c_attica_mainland']
  if not mainland:raise ValueError('Resolved OSM mainland coast required')
  ox,oz=(v*512 for v in cell);halo=box(*bounds) if bounds else box(ox-512,oz-512,ox+1024,oz+1024)
  land=[shape(mainland).intersection(halo)]
  # Closed coastline islands preserve the same OSM outline as mainland.
  for text, in source.execute("SELECT o.data FROM spatial s JOIN objects o ON o.rowid=s.rowid WHERE o.kind='coast' AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=?",(halo.bounds[2],halo.bounds[0],halo.bounds[3],halo.bounds[1])):
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


class Structures:
 """Deck groups inside `extent` (the union of an area's cells). Roads the policy excludes never get here."""
 def __init__(self,roads,bridge_tags,extent,strict=True,plan=None):
  if plan is not None:return self._from_plan(roads,plan)
  bridges=[r for r in roads if r['bridge'] and r['polygon'].intersects(extent)]
  require_bridge_yes(bridges,bridge_tags)
  if any(r['tunnel'] or r['layer'] and not r['bridge'] for r in roads if r['polygon'].intersects(extent)):raise ValueError('Unresolved tunnel/non-bridge structure')
  groups=[];self.unresolved=[];self.failed=[];remaining=set(r['id'] for r in bridges)
  while remaining:
   first=next(r for r in bridges if r['id']==min(remaining));group=[first];remaining.remove(first['id'])
   for r in bridges:
    if r['id'] in remaining and r['name']==first['name'] and r['line'].distance(first['line'])<40:group.append(r);remaining.remove(r['id'])
   centre0=unary_union([r['line'] for r in group]).centroid
   upper=connected_approaches(roads,group,(centre0.x,centre0.y))
   bridge_area=unary_union([r['polygon'] for r in group])
   # A road passes UNDER the deck only where its centreline truly crosses a bridge way without sharing a node with it:
   # the same test the profile solver uses to lift a deck. A street that merely meets the bridge end (a junction)
   # is not a crossing, and the deck there is at ground level.
   def passes_under(r):
    return not r['layer'] and any(not set(r['nodeRefs'])&set(b['nodeRefs']) and r['line'].intersection(b['line']).geom_type in ('Point','MultiPoint') for b in group)
   lower=[r for r in roads if r not in upper and passes_under(r)]
   # A deck over no mapped street (a railway, a stream) has nothing to clear: it is drawn as an ordinary road.
   if not lower:self.unresolved.extend(sorted(r['id'] for r in group));continue
   centre=unary_union([r['line'].intersection(bridge_area) for r in lower]).centroid
   line=max(lower,key=lambda r:r['line'].length)['line'];at=line.project(centre);a=line.interpolate(max(0,at-1));b=line.interpolate(min(line.length,at+1));length=a.distance(b)
   tx,tz=(b.x-a.x)/length,(b.y-a.y)/length
   # A 128 m smooth taper along the underpass keeps its grade bounded.
   # The deck extends onto connected approaches to avoid a grade break at an OSM bridge tag boundary.
   platform=deck_platform([r['polygon'] for r in sorted(upper,key=lambda r:r['id'])])
   counts={}
   for r in upper:
    for n in (r['fromNode'],r['toNode']):counts[n]=counts.get(n,0)+1
   outer=[p for r in upper for n,p in [(r['fromNode'],r['points'][0]),(r['toNode'],r['points'][-1])] if counts[n]==1]
   # Only deck ends inside the 200 m along-taper can still be under the dip; farther ones are untouched whatever
   # their sideways distance (a deck running at a shallow angle over the road would otherwise look "too short").
   near_ends=[abs((p[0]-centre.x)*(-tz)+(p[1]-centre.y)*tx) for p in outer if abs((p[0]-centre.x)*tx+(p[1]-centre.y)*tz)<200]
   across_end=min(112.,min(near_ends,default=1e9)-24)
   if across_end<35:
    if strict:raise ValueError('Bridge approaches too short for a safe underpass solve: '+first['id'])
    self.failed.append(dict(id=first['id'],ends=[(round(p[0]),round(p[1]),round((p[0]-centre.x)*tx+(p[1]-centre.y)*tz),round((p[0]-centre.x)*(-tz)+(p[1]-centre.y)*tx)) for p in outer],axis=(tx,tz),lower=[r['id'] for r in lower],centre=(centre.x,centre.y),upper=sorted(r['id'] for r in upper),reason='approaches too short ('+str(round(across_end))+' m)'));continue
   groups.append(dict(id=first['id'],bridgeSources=[r['id'] for r in group],roads=upper,lower=lower,centre=(centre.x,centre.y),axis=(tx,tz),platform=platform,acrossEnd=across_end))
  self.groups=groups;self.raised={r['id'] for g in groups for r in g['roads']}
  # A ground street that joins the deck chain at a node inside the underpass dip would start 4+ m below the deck it
  # connects to; it is left out (a stub ends at the junction) and reported, the same decision in every cell.
  self.dropped={}
  for g in groups:
   nodes={n for r in g['roads'] for n in (r['fromNode'],r['toNode'])}
   for r in roads:
    if r['id'] in self.raised or r['id'] in self.dropped:continue
    for n,p in ((r['fromNode'],r['points'][0]),(r['toNode'],r['points'][-1])):
     # The ground lattice is smoothed over ~16 m, so the dip reaches that far beyond its formula: probe the fringe too.
     if n in nodes and max(self.depression(p[0]+dx,p[1]+dz) for dx in (-16,-8,0,8,16) for dz in (-16,-8,0,8,16))>1e-4:self.dropped[r['id']]='meets a deck inside its underpass dip'
  self.deck=[r for r in roads if r['id'] in self.raised];self.ground=[r for r in roads if r['id'] not in self.raised and r['id'] not in self.dropped]
  self.platform=canonical_polygon(fold_union([g['platform'] for g in sorted(groups,key=lambda g:g['id'])]))
 def _from_plan(self,roads,plan):
  """Groups decided once for the whole area (plan-structures.py): a physical bridge is solved identically in every cell,
  however much of it a cell's halo happens to load (grouping from a clipped halo can differ between neighbours).

  Every group's platform comes from the plan too, whole: a road that merely touches a far deck is cut by that deck's
  platform in every cell, whether or not the cell loaded the deck's own roads (a cut re-nodes the whole road polygon,
  and a few hundredths of a millimetre of difference is a cracked seam)."""
  byid={r['id']:r for r in roads};groups=[];self.failed=[];self.dropped={}
  self.unresolved=[i for i in plan['unresolved'] if i in byid];platforms=[];self.crossing_ids=set();self.joined_nodes=set()
  for g in sorted(plan['groups'],key=lambda g:g['id']):
   shape_=shape(g['platform']);platforms.append(shape_);self.crossing_ids.update(g['lower']);self.joined_nodes.update(g['upperNodes'])
   groups.append(dict(id=g['id'],bridgeSourcesAll=list(g['bridgeSources']),bridgeSources=[i for i in g['bridgeSources'] if i in byid],roads=[byid[i] for i in g['upper'] if i in byid],lower=[byid[i] for i in g['lower'] if i in byid],
    centre=tuple(g['centre']),axis=tuple(g['axis']),platform=shape_,acrossEnd=g['acrossEnd']))
  self.groups=groups;self.raised={r['id'] for g in groups for r in g['roads']}
  self.deck=[r for r in roads if r['id'] in self.raised];self.ground=[r for r in roads if r['id'] not in self.raised]
  self.platform=canonical_polygon(fold_union(platforms))
 def relevant(self,box_):
  """Groups with roads in view, a bridge way in view and a platform that reaches `box_`: the ones a cell builds, gates and records."""
  return [g for g in self.groups if g['roads'] and g['bridgeSources'] and g['platform'].intersects(box_)]
 def approaches(self,box_):
  """Groups seen only by their approach roads: the raised chain of a deck can run hundreds of metres from the bridge itself, so
  a cell may load some of its roads and none of its bridge ways. Its deck edges are still the approach of a literal bridge=yes."""
  return [g for g in self.groups if g['roads'] and not g['bridgeSources'] and g.get('bridgeSourcesAll') and g['platform'].intersects(box_)]
 def depression(self,x,z):
  result=0.
  for g in self.groups:
   dx,dz=x-g['centre'][0],z-g['centre'][1];tx,tz=g['axis'];along=abs(dx*tx+dz*tz);across=abs(dx*(-tz)+dz*tx)
   result=max(result,6.*(1-smooth((along-8)/192))*(1-smooth((across-20)/(g['acrossEnd']-20))))
  return result
