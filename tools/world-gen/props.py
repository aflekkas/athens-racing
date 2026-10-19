"""Street signals and street furniture for one cell, from OSM nodes and road tags. Data only: tile-local instance rows.

Signals: OSM highway=traffic_signals nodes are clustered per junction (35 m); every drivable edge that ends within 25 m of a
cluster gets a head at its stop line, on the right kerb, with the junction's fixed-time plan (src/signal-plan.js): the green
wave offset comes from the junction's position (northing / 80 km/h), the phase group from the approach heading.
Props: lamps (OSM street_lamp nodes and lit=yes roads), bus stops and shelters, kiosks, benches, bollards, stop / give-way /
one-way signs, fountains, monuments and cars parked where parking:lane is tagged. Rows are (x, y, z, yaw, variant).
"""
import hashlib,json,math,sqlite3
from shapely.geometry import Point
from shapely.strtree import STRtree

CYCLE=28.;WAVE_V=80/3.6;STOP_OFF=9.;CLUSTER_R=35.;ARM_R=25.
KINDS=dict(lamp=0,bus_stop=1,bus_shelter=2,kiosk=3,bench=4,bollard=5,stop=6,give_way=7,oneway=8,fountain=9,monument=10,parked_car=11,crossing=12)
NODE_KINDS=('signals','stop','give_way','lamp','bus_stop','bollard','bench','kiosk','fountain','monument','crossing')
FURNITURE=True
LAMP_SPACING=42.;PARK_SPACING=6.5;MAX_PROPS=900;MAX_SIGNALS=96
PARKING_VALUES=('parallel','diagonal','perpendicular','marked','yes')
RANK=dict(motorway=0,trunk=1,primary=2,secondary=3,tertiary=4,unclassified=5,residential=6,living_street=7,service=8,road=6)

def road_extras(tags):
    """(lit, parking sides) from a raw OSM road tag dict; None when neither matters."""
    lit=tags.get('lit')=='yes';sides=[]
    both=tags.get('parking:lane:both') or tags.get('parking:both')
    for side in ('left','right'):
        v=tags.get('parking:lane:'+side) or tags.get('parking:'+side) or both
        if v in PARKING_VALUES:sides.append(side)
    return (lit,tuple(sides)) if lit or sides else None

def load_nodes(path,ox,oz,margin=80):
    if not path:return []
    db=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
    rows=[dict(id=i,kind=k,x=x,z=z,tags=json.loads(t)) for i,k,x,z,t in db.execute('SELECT id,kind,x,z,tags FROM nodes WHERE x>=? AND x<? AND z>=? AND z<? ORDER BY id',(ox-margin,ox+512+margin,oz-margin,oz+512+margin))]
    db.close();return rows

def hash01(*parts):return int.from_bytes(hashlib.sha256(':'.join(map(str,parts)).encode()).digest()[:4],'big')/4294967296

def clusters(nodes):
    """Signal nodes within CLUSTER_R of each other form one junction; its id is its smallest node id, its centre their mean."""
    sig=[n for n in nodes if n['kind']=='signals'];parent=list(range(len(sig)))
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for i in range(len(sig)):
        for j in range(i+1,len(sig)):
            if math.hypot(sig[i]['x']-sig[j]['x'],sig[i]['z']-sig[j]['z'])<CLUSTER_R:parent[find(j)]=find(i)
    groups={}
    for i,n in enumerate(sig):groups.setdefault(find(i),[]).append(n)
    return [dict(id=min(m['id'] for m in g),x=sum(m['x'] for m in g)/len(g),z=sum(m['z'] for m in g)/len(g),members=g) for g in groups.values()]

def polyline(points):
    """Cumulative lengths of a tile-local [x,y,z] polyline."""
    s=[0.]
    for a,b in zip(points,points[1:]):s.append(s[-1]+math.hypot(b[0]-a[0],b[2]-a[2]))
    return s

def at(points,total,station):
    """(x,z,dx,dz) at `station` metres along the polyline (clamped)."""
    station=max(0.,min(total[-1],station))
    for i in range(1,len(points)):
        if total[i]>=station or i==len(points)-1:
            a,b=points[i-1],points[i];l=(total[i]-total[i-1]) or 1e-9;f=(station-total[i-1])/l
            dx,dz=(b[0]-a[0])/l,(b[2]-a[2])/l;return a[0]+(b[0]-a[0])*f,a[2]+(b[2]-a[2])*f,dx,dz
    return points[-1][0],points[-1][2],0.,1.

def side_offset(x,z,dx,dz,distance,side='right'):
    """Point `distance` m to the right of travel (x right, z down: right of (dx,dz) is (-dz,dx))."""
    sign=1 if side=='right' else -1;return x-dz*distance*sign,z+dx*distance*sign

def build(emitted,field,ox,oz,nodes,extras,footprints,height):
    """Signal rows and prop rows for the cell. `emitted` is [(edge, tile-local positions)], `footprints` world Polygons,
    `height(x,z)` the rendered ground height at world x,z. Returns (signals, props) as dicts of flat lists."""
    tree=STRtree(footprints) if footprints else None
    def free(x,z,r=.7):
        if tree is None:return True
        p=Point(ox+x,oz+z).buffer(r)
        return not any(footprints[int(i)].intersects(p) for i in tree.query(p))
    def inside(x,z,pad=0.):return -pad<=x<512+pad and -pad<=z<512+pad
    sig=dict(rows=[],edges=[]);props=dict(rows=[],kind=[])
    def prop(kind,x,z,yaw,variant=0):
        if len(props['kind'])>=MAX_PROPS or not inside(x,z):return
        props['rows'].extend([round(x,2),round(height(ox+x,oz+z),2),round(z,2),round(yaw,3),float(variant)]);props['kind'].append(KINDS[kind])
    world=lambda p:(ox+p[0],oz+p[2])
    junctions=clusters(nodes)
    edges=[]
    for edge,points in emitted:
        if edge['flags']&8 or len(points)<2:continue
        total=polyline(points)
        if total[-1]<12:continue
        road=field.byid.get(edge['source']);hw=(road['width']/2) if road else 3.
        edges.append((edge,points,total,hw,road))
    # ---- signals: one head per approach that ends at a junction cluster
    for edge,points,total,hw,road in edges:
        ex,ez=world(points[-1]);best=None
        for j in junctions:
            d=min(math.hypot(ex-m['x'],ez-m['z']) for m in j['members'])
            if d<ARM_R and (best is None or d<best[0]):best=(d,j)
        if best is None or len(sig['edges'])>=MAX_SIGNALS:continue
        j=best[1];x,z,dx,dz=at(points,total,total[-1]-STOP_OFF)
        px,pz=side_offset(x,z,dx,dz,hw+.85)
        if not inside(px,pz):continue
        yaw=math.atan2(-dx,-dz)+math.pi;group=0. if abs(dz)>=abs(dx) else 1.
        offset=(-(j['z'])/WAVE_V)%CYCLE
        sig['rows'].extend([round(px,2),round(height(ox+px,oz+pz),2),round(pz,2),round(yaw,3),round(offset,2),group]);sig['edges'].append(edge['id'])
    signalled=set()
    for edge,points,total,hw,road in edges:
        ex,ez=world(points[-1])
        if any(math.hypot(ex-m['x'],ez-m['z'])<ARM_R for j in junctions for m in j['members']):signalled.add(edge['id'])
    if not FURNITURE:return sig,props
    # ---- one-way signs at the start of one-way edges that begin at a junction
    for edge,points,total,hw,road in edges:
        if edge['flags']&1 and total[-1]>=30 and edge['id'] not in signalled:
            x,z,dx,dz=at(points,total,7.);px,pz=side_offset(x,z,dx,dz,hw+.8)
            if free(px,pz,.5) and hash01(edge['id'],'oneway')<.5:prop('oneway',px,pz,math.atan2(-dx,-dz)+math.pi)
    # ---- OSM nodes: signs by approach, bus stops, lamps, benches, bollards, kiosks, fountains, monuments
    ends=[]
    for edge,points,total,hw,road in edges:ends.append((points[-1],edge,points,total,hw,road))
    def nearest_edge(wx,wz,limit):
        best=None
        for edge,points,total,hw,road in edges:
            for a,b in zip(points,points[1:]):
                ax,az=world(a);bx,bz=world(b);vx,vz=bx-ax,bz-az;l2=vx*vx+vz*vz or 1e-9;f=max(0,min(1,((wx-ax)*vx+(wz-az)*vz)/l2));qx,qz=ax+vx*f,az+vz*f;d=math.hypot(wx-qx,wz-qz)
                if d<limit and (best is None or d<best[0]):best=(d,hw,qx,qz,vx/math.sqrt(l2),vz/math.sqrt(l2))
        return best
    crossing_done=set()
    for n in nodes:
        lx,lz=n['x']-ox,n['z']-oz
        if not inside(lx,lz):continue
        k=n['kind']
        if k in ('stop','give_way'):
            # The sign belongs to the least important road that ends at the node (all of them when equal); never at a signal.
            arms=[(RANK.get((road or {}).get('highway'),9),edge,points,total,hw) for (end,edge,points,total,hw,road) in ends if math.hypot(world(end)[0]-n['x'],world(end)[1]-n['z'])<6 and edge['id'] not in signalled]
            if not arms:continue
            worst=max(a[0] for a in arms)
            for rank,edge,points,total,hw in arms:
                if rank!=worst or total[-1]<10:continue
                x,z,dx,dz=at(points,total,total[-1]-4.5);px,pz=side_offset(x,z,dx,dz,hw+.8)
                if free(px,pz,.5):prop(k,px,pz,math.atan2(-dx,-dz)+math.pi)
        elif k=='crossing':
            # A pedestrian-crossing sign on the right kerb of every approach that runs over the crossing, 3 m before it.
            for edge,points,total,hw,road in edges:
                if edge['id'] in signalled:continue
                best=None
                for i,(a,b) in enumerate(zip(points,points[1:])):
                    vx,vz=b[0]-a[0],b[2]-a[2];l2=vx*vx+vz*vz or 1e-9;f=max(0,min(1,((lx-a[0])*vx+(lz-a[2])*vz)/l2));d=math.hypot(lx-a[0]-vx*f,lz-a[2]-vz*f)
                    if d<4 and (best is None or d<best[0]):best=(d,total[i]+math.sqrt(l2)*f)
                if best is None or best[1]<5:continue
                x,z,dx,dz=at(points,total,best[1]-3.);px,pz=side_offset(x,z,dx,dz,hw+.8)
                key=(edge['id'],round(best[1]/6))
                if key in crossing_done or not free(px,pz,.5):continue
                crossing_done.add(key);prop('crossing',px,pz,math.atan2(-dx,-dz)+math.pi)
        elif k=='lamp':
            if free(lx,lz,.4):prop('lamp',lx,lz,hash01(n['id'])*6.283)
        elif k=='bus_stop':
            hit=nearest_edge(n['x'],n['z'],25)
            if not hit:continue
            d,hw,qx,qz,dx,dz=hit;sgn=1 if (n['x']-qx)*(-dz)+(n['z']-qz)*dx>=0 else -1   # which side of the road the stop is on
            sx,sz=qx-ox-dz*sgn*(hw+1.5),qz-oz+dx*sgn*(hw+1.5)
            if free(sx,sz,.8):prop('bus_shelter' if n['tags'].get('shelter')=='yes' else 'bus_stop',sx,sz,math.atan2(-dx,-dz)+(0. if sgn==1 else math.pi))
        elif k in ('bench','bollard','kiosk','fountain','monument'):
            if free(lx,lz,.5):prop(k,lx,lz,hash01(n['id'])*6.283)
    # Procedural fill goes last so the cell cap never costs the OSM-mapped furniture above.
    # ---- lamps along lit roads (forward edges only, so each two-way road gets one staggered side), and OSM lamps
    for edge,points,total,hw,road in edges:
        extra=extras.get((road or {}).get('way','').split(':')[0]) if road else None
        if not extra:continue
        lit,parking=extra
        if lit and ':f:' in edge['id'] and road['highway'] in RANK and RANK[road['highway']]<=6 and total[-1]>=2*18:
            n=int((total[-1]-24)//LAMP_SPACING)+1
            for k in range(max(n,0)):
                s=12+k*LAMP_SPACING;x,z,dx,dz=at(points,total,s);px,pz=side_offset(x,z,dx,dz,hw+.7,'right' if k%2==0 else 'left')
                if free(px,pz,.5):prop('lamp',px,pz,math.atan2(-dx,-dz))
        if parking and ':f:' in edge['id']:
            for side in parking:
                s=14.
                while s<total[-1]-14 and len(props['kind'])<MAX_PROPS:
                    x,z,dx,dz=at(points,total,s);px,pz=side_offset(x,z,dx,dz,hw-1.1,side)
                    if hash01(edge['id'],side,int(s))<.55 and free(px,pz,1.4):prop('parked_car',px,pz,math.atan2(-dx,-dz),int(hash01(edge['id'],side,int(s),'c')*6))
                    s+=PARK_SPACING
    return sig,props
