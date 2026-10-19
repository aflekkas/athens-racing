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


def bridge_edges(platform,cell,deck,ground):
 """A half-metre slab edge with a kerb lip, and a low post-and-beam guardrail on it (posts every 4 m).

 Returns (fascia, guardrail, rails): two (positions, indices) meshes and the collision rail list. The collision rail is
 unchanged: a solid 0.3 m wide, 0.65 m high swept volume along the deck edge, so what a car hits is at least what is drawn."""
 from shapely.geometry import box,LineString
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
    ex,ez=(q[0]-p[0])/max(math.dist(p,q),1e-6)*.06,(q[1]-p[1])/max(math.dist(p,q),1e-6)*.06
    _prism(gp,gi,(p[0]-ex,p[1]-ez),(p[0]+ex,p[1]+ez),y,y,.06,.1,.65,True)  # post at the segment start
    rails.append([x-ox,y,z-oz,xx-ox,yy,zz-oz,.65])
 return (fp,fi),(gp,gi),rails
