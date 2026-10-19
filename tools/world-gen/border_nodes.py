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

def canonical_polygon(geometry):
 """Node each original outline before any union can shorten its segments."""
 from shapely import set_precision
 from shapely.geometry import Polygon,MultiPolygon
 g=set_precision(geometry,1/SCALE)
 if g.geom_type=='Polygon':return set_precision(Polygon(split_borders(list(g.exterior.coords)),[split_borders(list(r.coords)) for r in g.interiors]),1/SCALE)
 if g.geom_type=='MultiPolygon':return MultiPolygon([canonical_polygon(p) for p in g.geoms])
 return g
