"""Cheap marking/kerb geometry. Caller supplies solved roads and height field.

Rendering helpers only: contact integration and stage conformance remain the
caller's responsibility. No trees, street props, furniture or runtime lights.
"""
import math
from collections import defaultdict
from shapely.geometry import Point,Polygon,box
from shapely.ops import unary_union,substring
from shapely import constrained_delaunay_triangles


def pavement_regions(roads):
    if not roads:return Polygon(),Polygon(),Polygon()
    road=unary_union([r['polygon'] for r in roads])
    kerb=road.buffer(.18,join_style=2).difference(road)
    pavement=road.buffer(1.8,join_style=2).difference(road.buffer(.18,join_style=2))
    return road,kerb,pavement


def lines(geometry):
    if geometry.is_empty:return
    if geometry.geom_type in ('LineString','LinearRing'):yield geometry
    elif hasattr(geometry,'geoms'):
        for item in geometry.geoms:yield from lines(item)


def polygons(geometry):
    if geometry.is_empty:return
    if geometry.geom_type=='Polygon':yield geometry
    elif hasattr(geometry,'geoms'):
        for item in geometry.geoms:yield from polygons(item)


def kerb_sides(boundary,cell,height,rise=.10):
    ox,oz=cell[0]*512,cell[1]*512;bounds=box(ox,oz,ox+512,oz+512);ps=[];ix=[]
    for line in lines(boundary.intersection(bounds)):
        points=list(line.coords)
        for a,b in zip(points,points[1:]):
            pieces=max(1,math.ceil(math.dist(a,b)/4))
            for j in range(pieces):
                x,z=[a[k]+(b[k]-a[k])*j/pieces for k in range(2)]
                xx,zz=[a[k]+(b[k]-a[k])*(j+1)/pieces for k in range(2)]
                y,yy=height(x,z),height(xx,zz);n=len(ps)//3
                ps.extend([x-ox,y,z-oz,xx-ox,yy,zz-oz,x-ox,y+rise,z-oz,xx-ox,yy+rise,zz-oz])
                # Both winding directions: tiny vertical edge, visible from either side.
                ix.extend([n,n+2,n+1,n+1,n+2,n+3,n+1,n+2,n,n+3,n+2,n+1])
    return ps,ix


def road_markings(roads,cell,height):
    ox,oz=cell[0]*512,cell[1]*512;bounds=box(ox,oz,ox+512,oz+512)
    nodes=defaultdict(list)
    for road in roads:
        for key,point in ((road['fromNode'],road['points'][0]),(road['toNode'],road['points'][-1])):
            nodes[key].append((point,road['width']))
    junctions=unary_union([Point(items[0][0]).buffer(max(w for p,w in items)*.65) for items in nodes.values() if len(items)>=3])
    ps=[];ix=[]
    for road in roads:
        width=road['width']
        if width<5:continue
        # Preserve the actual line shape. Painted lane/centre dividers use a
        # stable 3 m dash / 3 m gap, clipped away from intersection interiors.
        lanes=max(2,round(width/3.2));line=road['line']
        offsets=[-width/2+width*k/lanes for k in range(1,lanes)]
        for offset in offsets:
            for route in lines(line.offset_curve(offset)) if abs(offset)>.001 else [line]:
                for start in range(0,math.ceil(route.length),6):
                    dash=substring(route,start,min(start+3,route.length))
                    if dash.geom_type!='LineString' or dash.length<.05:continue
                    paint=dash.buffer(.065,cap_style=2,join_style=2).intersection(road['polygon']).intersection(bounds).difference(junctions)
                    for polygon in polygons(paint):
                        for tri in constrained_delaunay_triangles(polygon).geoms:
                            points=list(tri.exterior.coords)[:-1]
                            if (points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0])>0:points.reverse()
                            for x,z in points:ix.append(len(ps)//3);ps.extend([x-ox,height(x,z)+.015,z-oz])
    return ps,ix
