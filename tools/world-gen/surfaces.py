"""Canonical planar surface tessellation. Elevations must come from a global solve.

This module does not invent bridge/tunnel heights. Callers pass only a single
surface layer, and must separately validate rendered grades and clearance.
"""
import math
import struct
from shapely import constrained_delaunay_triangles, set_precision, union_all
from shapely.geometry import LineString, Point, box
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree


def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]
def snap(geometry):return set_precision(geometry,.01)


def ground_mesh(cell,roads,height,boundaries=()):
    """8 m road/shoulder cells, 16 m elsewhere; exact 2 m border subdivisions.

    roads: [{id, polygon, line}], already globally solved and with >=64 m halo.
    height(x,z): deterministic global surface height; never a tile-local filter.
    XZ uses centimetres (a subset of the required global millimetre lattice).
    Returned triangles partition the tile: no duplicated contact ownership.
    """
    ox,oz=cell[0]*512,cell[1]*512;bounds=box(ox,oz,ox+512,oz+512)
    ordered=sorted(roads,key=lambda r:r['id'])
    polygons=[snap(r['polygon']) for r in ordered]
    tree=STRtree(polygons)
    union=unary_union(polygons) if polygons else None
    near=union.buffer(8,quad_segs=1) if union is not None else None
    lines=[]
    # Explicit border vertices are identical even if the neighbour has no road.
    for n in range(0,512,2):
        for a,b in (((ox+n,oz),(ox+n+2,oz)),((ox+n,oz+512),(ox+n+2,oz+512)),
                    ((ox,oz+n),(ox,oz+n+2)),((ox+512,oz+n),(ox+512,oz+n+2))):
            lines.append(LineString([a,b]))
    for z in range(oz-16,oz+528,16):
        for x in range(ox-16,ox+528,16):
            square=box(x,z,x+16,z+16);lines.append(square.boundary)
            if near is not None and near.intersects(square):
                for n in (8,):
                    lines.append(LineString([(x+n,z),(x+n,z+16)]))
                    lines.append(LineString([(x,z+n),(x+16,z+n)]))
                # Same global southwest/northeast diagonal as Field's height
                # lattice. Clip feature faces only AFTER these plane boundaries
                # are noded, including the full six-metre junction shoulders.
                for dz in range(0,16,8):
                    for dx in range(0,16,8):
                        lines.append(LineString([(x+dx+8,z+dz),(x+dx,z+dz+8)]))
    # Preserve full global feature segments until noding. Clipping and rounding
    # their endpoints independently shifts border intersections by a centimetre.
    # A grid halo supplies identical intersection context on both sides.
    if union is not None:
        clipped=union
        if not clipped.is_empty:lines.append(clipped.boundary)
    for boundary in boundaries:
        clipped=snap(boundary)
        if not clipped.is_empty:lines.append(clipped)
    noded=union_all(lines,grid_size=.01)
    positions=[];triangles=[];owners=[];keys={}
    def vertex(p):
        key=(round(p[0]*100),round(p[1]*100))
        if key not in keys:
            x,z=key[0]/100,key[1]/100
            keys[key]=len(positions)//3
            positions.extend([f32(x-ox),f32(height(x,z)),f32(z-oz)])
        return keys[key]
    faces=sorted(polygonize(noded),key=lambda p:(p.bounds,p.wkb))
    for face in faces:
        if face.area<1e-8 or not bounds.covers(face.representative_point()):continue
        for triangle in constrained_delaunay_triangles(face).geoms:
            ps=list(triangle.exterior.coords)[:-1]
            cross=(ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0])
            if abs(cross)<1e-8:continue
            if cross>0:ps.reverse() # +Y normal
            centroid=triangle.representative_point()
            candidates=[int(i) for i in tree.query(centroid) if polygons[int(i)].covers(centroid)]
            owner=min(candidates,key=lambda i:(ordered[i]['line'].distance(centroid),ordered[i]['id'])) if candidates else None
            triangles.extend(vertex(p) for p in ps)
            owners.append(ordered[owner]['id'] if owner is not None else None)
    return dict(cell=list(cell),positions=positions,triangles=triangles,owners=owners)


def validate_partition(mesh):
    """Independent area, manifold and upward winding checks on emitted triangles."""
    p=mesh['positions'];edges={};area=0
    for a,b,c in zip(mesh['triangles'][::3],mesh['triangles'][1::3],mesh['triangles'][2::3]):
        x,z=p[a*3],p[a*3+2];xx,zz=p[b*3],p[b*3+2];xxx,zzz=p[c*3],p[c*3+2]
        cross=(zz-z)*(xxx-x)-(xx-x)*(zzz-z)
        if cross<=0:raise ValueError('Degenerate/downward terrain triangle')
        area+=cross/2
        for u,v in ((a,b),(b,c),(c,a)):
            key=tuple(sorted((u,v)));edges[key]=edges.get(key,0)+1
    if abs(area-512**2)>.01:raise ValueError('Terrain area coverage mismatch')
    for (a,b),count in edges.items():
        border=any(p[a*3+axis]==p[b*3+axis] and p[a*3+axis] in (0,512) for axis in (0,2))
        if count!=(1 if border else 2):raise ValueError('Terrain nonmanifold edge/T junction')
    return dict(area=area,triangles=len(mesh['triangles'])//3)


class SurfaceHeight:
    """Sample the actual emitted triangles, e.g. to place paint without clipping."""
    def __init__(self,mesh):
        from shapely.geometry import Polygon
        self.positions=mesh['positions'];self.indices=mesh['triangles']
        self.ox,self.oz=(v*512 for v in mesh['cell'])
        p=self.positions
        self.polygons=[Polygon([(p[v*3],p[v*3+2]) for v in self.indices[i:i+3]]) for i in range(0,len(self.indices),3)]
        self.tree=STRtree(self.polygons)
        self.borders=[]
        for axis,value in ((0,0),(0,512),(2,0),(2,512)):
            other=2 if axis==0 else 0
            samples={p[i+other]:p[i+1] for i in range(0,len(p),3) if p[i+axis]==value}
            self.borders.append(sorted(samples.items()))

    def __call__(self,x,z):
        x-=self.ox;z-=self.oz;point=Point(x,z);p=self.positions
        # Interpolate shared border segments directly. Adjacent triangle
        # barycentric arithmetic may otherwise differ by one Float32 ULP.
        side=0 if x==0 else 1 if x==512 else 2 if z==0 else 3 if z==512 else None
        if side is not None:
            from bisect import bisect_left
            samples=self.borders[side];at=z if side<2 else x
            i=bisect_left(samples,(at,-math.inf))
            if i<len(samples) and samples[i][0]==at:return samples[i][1]
            if 0<i<len(samples):
                a,y=samples[i-1];b,yy=samples[i]
                return y+(yy-y)*(at-a)/(b-a)
            raise ValueError('Missing canonical boundary contact')
        for face in sorted(int(i) for i in self.tree.query(point)):
            if not self.polygons[face].covers(point):continue
            a,b,c=self.indices[face*3:face*3+3]
            ax,az=p[a*3],p[a*3+2];bx,bz=p[b*3],p[b*3+2];cx,cz=p[c*3],p[c*3+2]
            denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
            u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denominator
            v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denominator
            return u*p[a*3+1]+v*p[b*3+1]+(1-u-v)*p[c*3+1]
        raise ValueError(f'No emitted terrain triangle at {x+self.ox},{z+self.oz}')
