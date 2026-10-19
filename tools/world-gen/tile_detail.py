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


def bridge_edges(platform,cell,deck,ground):
 """A half-metre slab and low concrete edge rails, protecting the explicitly permitted narrow OSM bridge shoulder."""
 from shapely.geometry import box,LineString
 from street_details import lines
 ox,oz=(v*512 for v in cell);bounds=box(ox,oz,ox+512,oz+512);ps=[];ix=[];rails=[]
 for line in lines(platform.buffer(-.15,join_style=2).boundary.intersection(bounds)):
  points=list(line.coords)
  for a,b in zip(points,points[1:]):
   n=max(1,math.ceil(math.dist(a,b)/4))
   for k in range(n):
    x,z=(a[j]+(b[j]-a[j])*k/n for j in (0,1));xx,zz=(a[j]+(b[j]-a[j])*(k+1)/n for j in (0,1));y,yy=deck(x,z),deck(xx,zz)
    if max(y-ground(x,z),yy-ground(xx,zz))<.15:continue
    dx,dz=xx-x,zz-z;length=math.hypot(dx,dz);rx,rz=-dz/length*.15,dx/length*.15;start=len(ps)//3
    for px,pz,py in [(x+rx,z+rz,y),(x-rx,z-rz,y),(xx-rx,zz-rz,yy),(xx+rx,zz+rz,yy)]:
     ps.extend([px-ox,py-.5,pz-oz,px-ox,py+.65,pz-oz])
    for u,v in [(0,2),(2,4),(4,6),(6,0)]:ix.extend([start+u,start+v,start+u+1,start+u+1,start+v,start+v+1])
    ix.extend([start+1,start+3,start+5,start+1,start+5,start+7])
    rails.append([x-ox,y,z-oz,xx-ox,yy,zz-oz,.65])
 return ps,ix,rails
