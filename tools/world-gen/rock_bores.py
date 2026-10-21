"""Mapped Loumbarda bores, with the native Riviera limestone shell recipe.

This supports rock bores with no crossing road above, not at-grade tunnel
substitutes. OSM direction, source id and layer -1 survive. The road is part of
the shared surface solve; a cell owns only its clipped shell and solid walls.
Dimensions beyond the source axes are estimates (tools/riviera-landmarks.md).
The unchanged six-metre shoulder gate still applies to the road surface.
"""
import json,math
from pathlib import Path

PLAN=json.loads((Path(__file__).with_name('rock-bores.json')).read_text())


def supported(road):
    return road.get('id') in PLAN and road.get('way')==PLAN[road['id']]['sourceWay'] and road.get('tunnel') and not road.get('bridge') and road.get('layer')==-1


def validate(roads):
    for bore in roads:
        if not supported(bore):continue
        for road in roads:
            if road['id']==bore['id'] or set(road['nodeRefs'])&set(bore['nodeRefs']):continue
            if bore['line'].intersects(road['line']):
                raise ValueError('Rock bore requires a supported overpassing road structure: '+bore['id']+' / '+road['id'])


def build(roads,cell,height):
    """Return visible shell triangles, matching wall collision rows and records.

    Stations and frames are computed on complete OSM ways before cell clipping.
    Polygon clipping keeps ownership exact across the west bore cell boundary.
    """
    from shapely.geometry import LineString,box,Point
    ox,oz=(v*512 for v in cell);bounds=box(ox,oz,ox+512,oz+512)
    positions=[];indices=[];rails=[];records=[]
    def triangle(a,b,c):
        polygon=[a,b,c]
        for axis,limit,sign in ((0,ox,1),(0,ox+512,-1),(2,oz,1),(2,oz+512,-1)):
            result=[]
            for A,B in zip(polygon,polygon[1:]+polygon[:1]):
                da,db=sign*(A[axis]-limit),sign*(B[axis]-limit)
                if da>=0:result.append(A)
                if (da>=0)!=(db>=0):
                    f=da/(da-db);result.append([A[k]+f*(B[k]-A[k]) for k in range(3)])
            polygon=result
            if len(polygon)<3:return
        start=len(positions)//3
        for p in polygon:positions.extend([p[0]-ox,p[1],p[2]-oz])
        for k in range(1,len(polygon)-1):
            A,B,C=polygon[0],polygon[k],polygon[k+1];u=[B[j]-A[j] for j in range(3)];v=[C[j]-A[j] for j in range(3)]
            if sum(q*q for q in (u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]))>1e-12:indices.extend([start,start+k,start+k+1,start+k+1,start+k,start])
    def quad(a,b,c,d):triangle(a,b,c);triangle(a,c,d)
    for road in sorted(roads,key=lambda r:r['id']):
        if not supported(road) or not road['line'].buffer(road['width']/2+3).intersects(bounds):continue
        line=road['line'];width=road['width']/2+.65
        inner=[[-width,-.35],[-width,3.7],[-width*.80,5.45],[-width*.28,6.15],[width*.32,6.35],[width*.83,5.45],[width,3.6],[width,-.35]]
        outer=[[-width-1.9,-1.8],[-width-1.9,5.3],[-width-1.45,9.2],[-width*.40,11.2],[width*.33,10.1],[width+1.2,8.3],[width+1.9,4.5],[width+1.9,-1.8]]
        n=max(2,math.ceil(line.length/1.5));stations=[-1.,*[line.length*i/n for i in range(n+1)],line.length+1.]
        def point(s,offset,h=0):
            at=max(0,min(line.length,s));p=line.interpolate(at);a=line.interpolate(max(0,at-.1));b=line.interpolate(min(line.length,at+.1));dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
            x,z=p.x+dx/length*(s-at)-dz/length*offset,p.y+dz/length*(s-at)+dx/length*offset
            return [x,height(x,z)+h,z]
        def ring(s,section):
            t=max(0,min(1,s/line.length));out=[]
            for k,(u,h) in enumerate(section):
                # Native limestone silhouette: only the outer shell is rough;
                # the clear bore envelope and solid walls remain untouched.
                ridge=math.sin(math.pi*t)*(.8+.45*math.sin(s*1.3+k*2)) if section is outer else 0.
                out.append(point(s,u+math.copysign(ridge,u),h+ridge*1.5+.20*math.sin(s*.8+k) if section is outer else h))
            return out
        for a,b in zip(stations,stations[1:]):
            ia,ib,oa,ob=ring(a,inner),ring(b,inner),ring(a,outer),ring(b,outer)
            # Open bottom: the shared emitted road owns the bore floor.
            for k in range(7):quad(ia[k],ib[k],ib[k+1],ia[k+1]);quad(oa[k+1],ob[k+1],ob[k],oa[k])
            for side in (-1,1):
                A=point(a,side*(width+.15));B=point(b,side*(width+.15))
                wall=LineString([(A[0],A[2]),(B[0],B[2])]);clipped=wall.intersection(bounds)
                if clipped.geom_type=='LineString' and clipped.length>1e-5:
                    ends=[]
                    for x,z in (clipped.coords[0],clipped.coords[-1]):
                        f=wall.project(Point(x,z))/wall.length
                        ends.extend([x-ox,A[1]+f*(B[1]-A[1]),z-oz])
                    rails.append([*ends,3.6])
        for s in (0,line.length):
            i,o=ring(s,inner),ring(s,outer)
            for k in range(7):quad(i[k],o[k],o[k+1],i[k+1])
        records.append(dict(id=road['id'],name=PLAN[road['id']]['name'],layer=-1,sourceWay=road['way'],width=road['width'],axis=[[x-ox,height(x,z),z-oz] for x,z in line.coords],minimumClearance=5.0,wallHeight=3.6))
    return positions,indices,rails,records
