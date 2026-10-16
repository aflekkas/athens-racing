"""Actual-footprint wall/flat-roof mesh; no floor, windows, roof props or texture."""
from shapely import constrained_delaunay_triangles
from shapely.geometry.polygon import orient
from shapely.geometry import Polygon, LineString
from shapely.ops import split, unary_union
import math
from model import building_height
import hashlib


def palette_index(identifier):
    slot=int.from_bytes(hashlib.sha256(str(identifier).encode()).digest()[:4],'big')%20
    return 0 if slot<8 else 1 if slot<14 else 2 if slot<17 else slot-14


def simplify_footprint(polygon):
    """AWT v1.1: preserve concavity, 4–14 corners, at most 15% area change."""
    if polygon.geom_type != 'Polygon' or not polygon.is_valid or polygon.area < 1 or polygon.interiors:
        return None
    original=polygon;tolerance=.05
    if len(polygon.exterior.coords)-1==3:
        points=list(polygon.exterior.coords)[:-1]
        i=max(range(3),key=lambda i:math.dist(points[i],points[(i+1)%3]))
        a,b=points[i],points[(i+1)%3]
        points.insert(i+1,((a[0]+b[0])/2,(a[1]+b[1])/2))
        polygon=Polygon(points) # AWT minimum 4 corners, unchanged triangular outline.
    while len(polygon.exterior.coords)-1>14 and tolerance<=8:
        polygon=original.simplify(tolerance,preserve_topology=True);tolerance*=1.5
    rounded=[]
    for x,z in list(polygon.exterior.coords)[:-1]:
        point=(round(x,3),round(z,3))
        if not rounded or point!=rounded[-1]:rounded.append(point)
    if len(rounded)>1 and rounded[0]==rounded[-1]:rounded.pop()
    if len(set(rounded))!=len(rounded):return None
    polygon=Polygon(rounded)
    if not polygon.is_valid or not 4<=len(rounded)<=14 or polygon.area<1 or polygon.symmetric_difference(original).area>original.area*.15:
        return None
    return polygon


def building_mesh(identifier, polygon, tags, landuse, base=0):
    outline=simplify_footprint(polygon)
    if outline is None:return None
    outline=orient(outline,sign=1)
    points=list(outline.exterior.coords)[:-1]
    height,source=building_height(tags,landuse)
    # Per-instance local coordinates keep buffer precision independent of distance.
    origin=[points[0][0],base,points[0][1]]
    positions=[]
    for y in (0,height):
        for x,z in points:positions.extend([round(x-origin[0],3),round(y,3),round(z-origin[2],3)])
    count=len(points);indices=[]
    for i in range(count):
        j=(i+1)%count
        indices.extend([i,i+count,j,j,i+count,j+count])
    lookup={p:i for i,p in enumerate(points)}
    for triangle in constrained_delaunay_triangles(outline).geoms:
        # Orient roof clockwise in XZ for a +Y normal in XYZ.
        triangle=orient(triangle,sign=-1)
        indices.extend(lookup[tuple(p)]+count for p in list(triangle.exterior.coords)[:-1])
    assert len(indices)//3<=40
    return dict(id=identifier,origin=origin,positions=positions,indices=indices,height=round(height,3),
                heightSource=source,palette=palette_index(identifier),triangles=len(indices)//3,
                footprint=[[round(x,3),round(z,3)] for x,z in reversed(points)],landuse=landuse)


def building_parts(identifier, geometry, tags, landuse):
    """Represent simple courtyards by cuts, keeping one <=40-triangle entity cap."""
    source=list(geometry.geoms) if hasattr(geometry,'geoms') else [geometry]
    variants=[source]
    # A cut through a hole opens it without filling it. Search a small fixed set
    # of directions; diagonal cuts often need fewer corners than axial cuts.
    for _ in range(4):
        next_variants=[];complete=[]
        for polygons in variants:
            index=next((i for i,p in enumerate(polygons) if p.interiors),None)
            if index is None:complete.append(polygons);continue
            polygon=polygons[index];center=Polygon(polygon.interiors[0]).representative_point()
            extent=math.hypot(polygon.bounds[2]-polygon.bounds[0],polygon.bounds[3]-polygon.bounds[1])*2
            angles=[0,math.pi/4,math.pi/2,3*math.pi/4]
            angles.extend(math.atan2(z-center.y,x-center.x) for x,z in list(polygon.convex_hull.exterior.coords)[:-1][:8])
            for angle in angles:
                dx,dz=math.cos(angle)*extent,math.sin(angle)*extent
                cut=LineString([(center.x-dx,center.y-dz),(center.x+dx,center.y+dz)])
                parts=list(split(polygon,cut).geoms)
                if len(parts)<2 or sum(len(p.interiors) for p in parts)>=len(polygon.interiors):continue
                result=polygons[:index]+parts+polygons[index+1:]
                if sum(len(p.exterior.coords)-1 for p in result)<=30:next_variants.append(result)
        variants=complete+sorted(next_variants,key=lambda ps:(sum(len(p.interiors) for p in ps),sum(len(p.exterior.coords) for p in ps),b''.join(p.wkb for p in ps)))[:16]
        if all(not any(p.interiors for p in ps) for ps in variants):break
    best=None
    for polygons in variants:
        if any(p.interiors for p in polygons):continue
        polygons=sorted(polygons,key=lambda p:(p.bounds,p.wkb))
        meshes=[building_mesh(identifier+':'+str(i),p,tags,landuse) for i,p in enumerate(polygons)]
        if any(m is None for m in meshes):continue
        triangles=sum(m['triangles'] for m in meshes)
        if triangles>40:continue
        reconstructed=unary_union([Polygon(m['footprint']) for m in meshes])
        if reconstructed.symmetric_difference(geometry).area>geometry.area*.15:continue
        choice=(triangles,encode_footprints(meshes))
        if best is None or choice<best[0]:best=(choice,meshes)
    return best[1] if best else None


def encode_footprints(meshes):
    return tuple(tuple(tuple(p) for p in mesh['footprint']) for mesh in meshes)
