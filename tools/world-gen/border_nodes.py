"""Canonical fixed-point intersections with global cell borders, before clipping."""
from fractions import Fraction
SCALE=50 # two centimetres, still a subset of the world millimetre lattice

def split_borders(coords):
 points=[];size=512*SCALE
 for a,b in zip(coords,coords[1:]):
  aa=tuple(round(v*SCALE) for v in a);bb=tuple(round(v*SCALE) for v in b);cuts={}
  for axis in (0,1):
   lo,hi=sorted((aa[axis],bb[axis]))
   if lo==hi:continue
   for edge in range((lo//size+1)*size,hi,size):
    numerator=edge-aa[axis];denominator=bb[axis]-aa[axis];other=1-axis
    value=round(Fraction(aa[other]*denominator+(bb[other]-aa[other])*numerator,denominator))
    p=[0,0];p[axis]=edge;p[other]=value;cuts[Fraction(numerator,denominator)]=p
  points.append([v/SCALE for v in aa]);points.extend([[v/SCALE for v in cuts[t]] for t in sorted(cuts)])
 points.append([round(v*SCALE)/SCALE for v in coords[-1]])
 return points

def lift_border_runs(polygon):
 """Move every outline edge that lies ON a cell border 2 cm into the polygon.

 Such an edge is real only on one side of the border: the cell the polygon lies in gets a triangle edge on the border, the
 neighbour, where the polygon has no area, gets none, and the two cells' border samples differ (a cracked seam by 2 cm).
 After the lift the outline crosses the border at ordinary nodes (split_borders) that both cells see."""
 from shapely.geometry import Point,Polygon
 size=512*SCALE;rings=[];changed=False
 for ring in [polygon.exterior,*polygon.interiors]:
  points=[[round(v*SCALE) for v in c] for c in ring.coords[:-1]];moved=[[0,0] for _ in points]
  for i in range(len(points)):
   j=(i+1)%len(points)
   for axis in (0,1):
    other=1-axis
    if points[i][axis]!=points[j][axis] or points[i][axis]%size or points[i][other]==points[j][other]:continue
    mid=[(points[i][0]+points[j][0])/2/SCALE,(points[i][1]+points[j][1])/2/SCALE]
    for sign in (1,-1):
     probe=list(mid);probe[axis]+=sign*.5/SCALE
     if polygon.covers(Point(probe)):
      for k in (i,j):moved[k][axis]=sign
      break
  rings.append([[(p[0]+m[0])/SCALE,(p[1]+m[1])/SCALE] for p,m in zip(points,moved)]);changed=changed or any(m!=[0,0] for m in moved)
 if not changed:return polygon
 lifted=Polygon(rings[0],rings[1:])
 return lifted if lifted.is_valid else lifted.buffer(0)

def canonical_polygon(geometry):
 """Node each original outline before any union can shorten its segments."""
 from shapely import set_precision
 from shapely.geometry import Polygon,MultiPolygon
 g=set_precision(geometry,1/SCALE)
 if g.geom_type=='Polygon':g=set_precision(lift_border_runs(g),1/SCALE)
 if g.geom_type=='Polygon':return set_precision(Polygon(split_borders(list(g.exterior.coords)),[split_borders(list(r.coords)) for r in g.interiors]),1/SCALE)
 if g.geom_type=='MultiPolygon':return MultiPolygon([canonical_polygon(p) for p in g.geoms])
 return g
