"""Bounded OSM vegetation and coast render records; no regional data is copied."""
import json,sqlite3,math
from shapely.geometry import Point,Polygon
from shapely.ops import unary_union
from shapely import constrained_delaunay_triangles
from appearance import linear
from details import fnv1a


def water_mesh(geometry,ox,oz):
 positions=[];indices=[]
 parts=[geometry] if geometry.geom_type=='Polygon' else getattr(geometry,'geoms',[])
 for part in parts:
  if part.geom_type!='Polygon':continue
  for triangle in constrained_delaunay_triangles(part).geoms:
   points=list(triangle.exterior.coords)[:-1]
   if (points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0])>0:points.reverse()
   start=len(positions)//3
   for x,z in points:positions.extend([x-ox,-.05,z-oz])
   indices.extend([start,start+1,start+2])
 return positions,indices


def foam_mesh(water,ox,oz,width=6.):
 """Strip of sea along this cell's coastline (not its edges): (positions, indices, foam), foam 1 on the shore to 0 `width` m out."""
 from shapely.geometry import box
 if water is None or water.is_empty:return [],[],[]
 shore=water.boundary.difference(box(ox,oz,ox+512,oz+512).boundary.buffer(.05))
 if shore.is_empty:return [],[],[]
 band=water.intersection(shore.buffer(width,cap_style='flat')).simplify(.25)
 positions=[];indices=[];foam=[]
 parts=[band] if band.geom_type=='Polygon' else [g for g in getattr(band,'geoms',[]) if g.geom_type=='Polygon']
 for part in parts:
  if part.is_empty or part.area<1:continue
  for triangle in constrained_delaunay_triangles(part).geoms:
   points=list(triangle.exterior.coords)[:-1]
   if (points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0])>0:points.reverse()
   start=len(positions)//3
   for x,z in points:positions.extend([x-ox,.03,z-oz]);foam.append(max(0.,1.-shore.distance(Point(x,z))/width))
   indices.extend([start,start+1,start+2])
 return positions,indices,foam


def park_areas(path,ox,oz):
 """Actual cached green-area geometry and OSM tags touching this cell."""
 if not path:return []
 from shapely import wkb
 from shapely.geometry import box
 db=sqlite3.connect(f'file:{path}?mode=ro',uri=True);cell=box(ox,oz,ox+512,oz+512);out=[]
 for blob,tags in db.execute('SELECT geometry,tags FROM areas'):
  g=wkb.loads(blob)
  if g.intersects(cell):out.append((g,json.loads(tags) or {'leisure':'park'}))
 db.close();return out


def facade_styles(path,identifiers):
 """Facade style (details.py: 0 unknown, 1..3 apartments, 4 shops, 5 offices, 6 masonry, 7 industrial) per building id
 `building:<w|r><osm id>:<part>`, from the building-details cache; 0 where it has no record."""
 if not path:return [0]*len(identifiers)
 db=sqlite3.connect(f'file:{path}?mode=ro',uri=True);out=[]
 for identifier in identifiers:
  row=db.execute('SELECT data FROM buildings WHERE id=?',(identifier.split(':')[1],)).fetchone() if identifier.count(':')>=1 else None
  out.append(int(json.loads(row[0]).get('facadeStyle',0)) if row else 0)
 db.close();return out


def vegetation_rows(path,field,buildings,height,triangle_budget):
 if not path:return [],[],[]
 db=sqlite3.connect(f'file:{path}?mode=ro',uri=True);ox,oz=field.ox,field.oz
 rows=db.execute("SELECT id,kind,x,z,seed,tags FROM points WHERE x>=? AND x<? AND z>=? AND z<? ORDER BY CASE kind WHEN 'tree' THEN 0 WHEN 'tree_row' THEN 1 ELSE 2 END,id",(ox,ox+512,oz,oz+512))
 excluded=unary_union([r['polygon'].buffer(2) for r in field.roads]+[b.buffer(1) for b in buildings]);positions=[];kinds=[];seeds=[];seen=set();limit=min(96,triangle_budget//36)
 for identifier,kind,x,z,seed,tags in rows:
  if len(kinds)>=limit:break
  key=(round(x/2),round(z/2));p=Point(x,z)
  if key in seen or excluded.covers(p) or field.coast and not field.coast.land.covers(p):continue
  y=height(x,z)
  if y<0:continue
  try:h=float(json.loads(tags).get('height',5.5))
  except (TypeError,ValueError):h=5.5
  positions.extend([x-ox,y,z-oz,min(10,max(3,h))]);kinds.append({'tree':0,'tree_row':1,'park_candidate':2}[kind]);seeds.append(seed);seen.add(key)
 db.close();return positions,kinds,seeds


def _prism(ps,ix,a,b,ya,yb,w,lo,hi,ends=False):
 """Box along a->b (cell-local x,z), `w` either side of the line, from deck+lo to deck+hi. Outward-wound quads."""
 (x,z),(xx,zz)=a,b;dx,dz=xx-x,zz-z;length=math.hypot(dx,dz)
 if length<1e-6:return
 rx,rz=-dz/length*w,dx/length*w;start=len(ps)//3
 for px,pz,py in [(x-rx,z-rz,ya),(x+rx,z+rz,ya),(xx+rx,zz+rz,yb),(xx-rx,zz-rz,yb)]:ps.extend([px,py+lo,pz])
 for px,pz,py in [(x-rx,z-rz,ya),(x+rx,z+rz,ya),(xx+rx,zz+rz,yb),(xx-rx,zz-rz,yb)]:ps.extend([px,py+hi,pz])
 cx=sum(ps[(start+i)*3] for i in range(8))/8;cy=sum(ps[(start+i)*3+1] for i in range(8))/8;cz=sum(ps[(start+i)*3+2] for i in range(8))/8
 faces=[(0,3,7,4),(1,2,6,5),(4,5,6,7)]+([(0,1,5,4),(3,2,6,7)] if ends else [])
 for q in faces:
  v=[start+i for i in q];p=[ps[i*3:i*3+3] for i in v]
  n=[(p[1][1]-p[0][1])*(p[2][2]-p[0][2])-(p[1][2]-p[0][2])*(p[2][1]-p[0][1]),(p[1][2]-p[0][2])*(p[2][0]-p[0][0])-(p[1][0]-p[0][0])*(p[2][2]-p[0][2]),(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])]
  mid=[sum(c[k] for c in p)/4-(cx,cy,cz)[k] for k in range(3)]
  if sum(n[k]*mid[k] for k in range(3))<0:v=v[::-1]
  ix.extend([v[0],v[1],v[2],v[0],v[2],v[3]])


def bridge_post_stations(platform,cell):
 """Four-metre stations on whole source rings, with one half-open cell owner.

 Outline noding and tile clipping must not reset the post cadence. Canonical
 ring direction/start also makes GEOS ring rotation and reversal immaterial.
 """
 from street_details import lines
 ox,oz=(v*512 for v in cell)
 for line in lines(platform.boundary):
  points=list(line.coords)[:-1]
  if len(points)<3:continue
  start=min(range(len(points)),key=lambda i:points[i])
  points=points[start:]+points[:start]
  if points[-1]<points[1]:points=[points[0]]+list(reversed(points[1:]))
  points.append(points[0]);station=0.
  for a,b in zip(points,points[1:]):
   length=math.dist(a,b)
   if length<1e-9:continue
   if max(a[0],b[0])>=ox and min(a[0],b[0])<=ox+512 and max(a[1],b[1])>=oz and min(a[1],b[1])<=oz+512:
    at=math.ceil((station-1e-8)/4)*4.
    while at<station+length-1e-8:
     f=max(0.,min(1.,(at-station)/length));x=a[0]+(b[0]-a[0])*f;z=a[1]+(b[1]-a[1])*f
     for border in (ox,ox+512):
      if abs(x-border)<1e-8:x=float(border)
     for border in (oz,oz+512):
      if abs(z-border)<1e-8:z=float(border)
     if ox<=x<ox+512 and oz<=z<oz+512:yield x,z,(b[0]-a[0])/length,(b[1]-a[1])/length
     at+=4.
   station+=length


def bridge_post_mesh(platform,cell,rails):
 """Posts follow the source outline, not every triangulation node or clipped
 segment start. Interpolate their height from the unchanged collision rail;
 keep even a post at a rail end entirely inside that solid swept volume.
 """
 ox,oz=(v*512 for v in cell);gp=[];gi=[]
 for x,z,_,_ in bridge_post_stations(platform,cell):
  x-=ox;z-=oz
  for r in rails:
   dx,dz=r[3]-r[0],r[5]-r[2];length=math.hypot(dx,dz)
   f=((x-r[0])*dx+(z-r[2])*dz)/(length*length)
   if not -1e-8<=f<=1+1e-8 or abs((x-r[0])*dz-(z-r[2])*dx)/length>1e-7:continue
   at=max(0.,min(length,f*length));lo=max(0.,at-.06);hi=min(length,at+.06)
   a=(r[0]+dx*lo/length,r[2]+dz*lo/length);b=(r[0]+dx*hi/length,r[2]+dz*hi/length)
   ya=r[1]+(r[4]-r[1])*lo/length;yb=r[1]+(r[4]-r[1])*hi/length
   _prism(gp,gi,a,b,ya,yb,.06,.1,.65,True)
   break
 return gp,gi


def bridge_edges(platform,cell,deck,ground):
 """A half-metre slab edge with a kerb lip, and a low post-and-beam guardrail on it (posts every 4 m).

 Returns (fascia, guardrail, rails): two (positions, indices) meshes and the collision rail list. The collision rail is
 unchanged: a solid 0.3 m wide, 0.65 m high swept volume along the deck edge, so what a car hits is at least what is drawn."""
 from shapely.geometry import box
 from street_details import lines
 ox,oz=(v*512 for v in cell);bounds=box(ox,oz,ox+512,oz+512);fp=[];fi=[];gp=[];gi=[];rails=[]
 # On the deck edge itself: an inward offset retreats at acute corners, leaving the corner more than the gate's 0.22 m from any rail.
 for line in lines(platform.boundary.intersection(bounds)):
  points=list(line.coords)
  for a,b in zip(points,points[1:]):
   n=max(1,math.ceil(math.dist(a,b)/4))
   for k in range(n):
    x,z=(a[j]+(b[j]-a[j])*k/n for j in (0,1));xx,zz=(a[j]+(b[j]-a[j])*(k+1)/n for j in (0,1));y,yy=deck(x,z),deck(xx,zz)
    if max(y-ground(x,z),yy-ground(xx,zz))<.15:continue
    p,q=(x-ox,z-oz),(xx-ox,zz-oz)
    _prism(fp,fi,p,q,y,yy,.15,-.5,.1)        # slab edge, 10 cm lip above the deck surface
    _prism(gp,gi,p,q,y,yy,.04,.37,.65)       # beam, 28 cm tall, top at the collision rail's height
    rails.append([x-ox,y,z-oz,xx-ox,yy,zz-oz,.65])
 posts,post_indices=bridge_post_mesh(platform,cell,rails)
 offset=len(gp)//3;gp.extend(posts);gi.extend(i+offset for i in post_indices)
 return (fp,fi),(gp,gi),rails


def mapped_retaining_wall_mesh(record, geometry, certificate, cell):
 """Source-only wall faces from exact compiled support owners; no height fallback."""
 from structure_context import mapped_wall_mesh
 return mapped_wall_mesh(record, geometry, certificate, cell)


def matched_bridge_footprint(records, bridge_sources, source_sha):
 """Only an explicit source association may constrain a bridge's context."""
 from structure_context import matched_footprint
 return matched_footprint(records, bridge_sources, source_sha)
