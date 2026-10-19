"""Cheap marking/kerb geometry. Caller supplies solved roads and height field.

Rendering helpers only: contact integration and stage conformance remain the
caller's responsibility. No trees, street props, furniture or runtime lights.
"""
import math
from border_nodes import canonical_polygon
from collections import defaultdict
from shapely.geometry import Point,Polygon,box
from shapely.ops import unary_union,substring
from shapely import constrained_delaunay_triangles,set_precision


KERB_WIDTH = .6  # 10 cm rise with headroom for longitudinal road grade.


def pavement_regions(roads):
    if not roads:return Polygon(),Polygon(),Polygon()
    # Snap each global source outline before unioning it. Otherwise the raw
    # kerb's inner ring and the contact road union round to two different lines
    # at a tile border, leaving a centimetre sliver on only one side.
    road=unary_union([canonical_polygon(r['polygon']) for r in roads])
    kerb_outer=unary_union([canonical_polygon(r['polygon'].buffer(KERB_WIDTH,join_style=2)) for r in roads])
    outer=unary_union([canonical_polygon(r['polygon'].buffer(1.8,join_style=2)) for r in roads])
    kerb=kerb_outer.difference(road)
    pavement=outer.difference(kerb_outer)
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


PAINT=.065  # half-width: 13 cm lines


def paint_triangles(paint,ps,ix,ox,oz,height,lift=.015):
    for polygon in polygons(paint):
        for tri in constrained_delaunay_triangles(polygon).geoms:
            points=list(tri.exterior.coords)[:-1]
            if (points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0])>0:points.reverse()
            for x,z in points:ix.append(len(ps)//3);ps.extend([x-ox,height(x,z)+lift,z-oz])


def line_offsets(section,width):
    """(lateral metres, style) for every painted line of a road; lateral > 0 is the geographic right."""
    m=section['markings'];half=width/2;lane=section['laneWidth'];lines=[]
    if m['edge']=='solid':lines.extend([(-half+.35,'solid'),(half-.35,'solid')])
    if m['lane']=='dashed':
        forward,backward=section['lanesForward'],section['lanesBackward']
        if section['oneway']:
            lines.extend((half-k*lane,'dashed') for k in range(1,section['lanes']))
        else:
            # Right-hand traffic: forward lanes sit to the right of the centre line.
            centre=half-forward*lane
            lines.extend((half-k*lane,'dashed') for k in range(1,forward))
            lines.extend((centre-k*lane,'dashed') for k in range(1,backward))
    if not section['oneway'] and m['centre']!='none':
        centre=half-section['lanesForward']*section['laneWidth']
        if m['centre']=='double':lines.extend([(centre-.14,'solid'),(centre+.14,'solid')])
        else:lines.append((centre,m['centre']))
    return lines


def zebra_paint(road,station,point,frame):
    """Bars across the carriageway at a marked crossing, 45 cm bars on a 90 cm pitch, clear of the edge lines."""
    tx,tz,nx,nz=frame;half=road['width']/2-.5;bars=[]
    for k in range(4):
        along=(k-1.5)*PITCH
        a=(point[0]+tx*(along-BAR/2)-nx*half,point[1]+tz*(along-BAR/2)-nz*half);b=(point[0]+tx*(along+BAR/2)-nx*half,point[1]+tz*(along+BAR/2)-nz*half)
        c=(point[0]+tx*(along+BAR/2)+nx*half,point[1]+tz*(along+BAR/2)+nz*half);d=(point[0]+tx*(along-BAR/2)+nx*half,point[1]+tz*(along-BAR/2)+nz*half)
        bars.append(Polygon([a,b,c,d]))
    return bars


BAR,PITCH=.45,.9


def road_markings(roads,cell,height,regions=None):
    ox,oz=cell[0]*512,cell[1]*512;bounds=box(ox,oz,ox+512,oz+512)
    nodes=defaultdict(list)
    for road in roads:
        for key,point in ((road['fromNode'],road['points'][0]),(road['toNode'],road['points'][-1])):
            nodes[key].append((point,road['width']))
    junctions=unary_union([Point(items[0][0]).buffer(max(w for p,w in items)*.5+2.2) for items in nodes.values() if len(items)>=3])
    ps=[];ix=[]
    for road in roads:
        section=road['section'];dash,gap=section['markings']['dash'];line=road['line']
        surface=regions.surface(road) if regions else road['polygon']
        for offset,style in line_offsets(section,road['width']):
            for route in lines(line.offset_curve(offset)) if abs(offset)>.001 else [line]:
                spans=[(0,route.length)] if style=='solid' else [(start,min(start+dash,route.length)) for start in range(0,math.ceil(route.length),round(dash+gap))]
                for a,b in spans:
                    piece=substring(route,a,b)
                    if piece.geom_type!='LineString' or piece.length<.05:continue
                    paint_triangles(piece.buffer(PAINT,cap_style=2,join_style=2).intersection(surface).intersection(bounds).difference(junctions),ps,ix,ox,oz,height)
    if regions:
        for road,station,point,frame in regions.zebras:
            if not (ox-6<point[0]<ox+518 and oz-6<point[1]<oz+518):continue
            for bar in zebra_paint(road,station,point,frame):
                paint_triangles(bar.intersection(regions.asphalt).intersection(bounds),ps,ix,ox,oz,height)
    return ps,ix


def pavement_lift(distance,kerb_width=KERB_WIDTH,pavement_width=1.8,rise=.10):
    """Continuous, drivable bevel with a flat pavement and a 1 m outer blend.

    Distance is to the global road union, not a tile-local clipped outline.
    This gives every shared vertex one height, including centimetre slivers
    around snapped junction boundaries. The kerb rises by 10 cm across 60 cm.
    """
    if distance<=0 or distance>=pavement_width+1:return 0.
    return rise*min(1.,distance/kerb_width,max(0.,pavement_width+1-distance))


def ribbon_polygon(line,width,cap_extension=.02):
    """Butt-ended road with a 2 cm endpoint allowance for the 1 cm mesh lattice.

    Without this allowance, snapping a diagonal end cap can put its graph node
    just outside the asphalt. Keep the graph/stations on the original line.
    """
    from shapely.geometry import LineString
    points=list(line.coords)
    if len(points)<2 or line.length<=0:raise ValueError('Empty road ribbon')
    a,b=points[0],points[1];dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
    if not length:raise ValueError('Repeated road endpoint')
    points[0]=(a[0]-dx/length*cap_extension,a[1]-dz/length*cap_extension)
    a,b=points[-2],points[-1];dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
    if not length:raise ValueError('Repeated road endpoint')
    points[-1]=(b[0]+dx/length*cap_extension,b[1]+dz/length*cap_extension)
    return LineString(points).buffer(width/2,cap_style=2,join_style=2)


def ribbon_lateral(line, x, z, forward=True):
    """Signed distance to the reference edge's right, including reverse edges."""
    point=Point(x,z);station=line.project(point);center=line.interpolate(station)
    a=line.interpolate(max(0,station-.05));b=line.interpolate(min(line.length,station+.05))
    dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
    if length<1e-9:raise ValueError('Ribbon reference has no tangent')
    return station,((x-center.x)*-dz+(z-center.y)*dx)/length*(1 if forward else -1)
