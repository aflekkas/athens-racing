#!/usr/bin/env python3
"""Offline greater-Athens selector map. pip install numpy pillow shapely scipy.
--fetch refreshes the OSM surround (tools/maps/attica/fetch-vector.py), --fetch-dem the regional EU-DEM relief.
The default rebuild uses the committed ODbL / EU-DEM snapshots plus shipped track data; no runtime tile requests.
Outputs (runtime): a hillshaded land texture and a sea-depth texture (WebP), a quantized vector file (coastline and
the road hierarchy), and src/attica-map-data.js (projection, routes, ranked labels). assets/maps/attica.svg is a
flattened composite kept for the static menu backdrop.
"""
import argparse, base64, concurrent.futures, gzip, io, json, math, os, struct, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'tools/maps/attica/source.json.gz'
DEM_SNAPSHOT = ROOT / 'tools/maps/attica/dem.png'
CACHE = Path(os.environ.get('ATTICA_CACHE') or ROOT / '.scratch/attica-map')
WEST, SOUTH, EAST, NORTH = 23.00, 37.70, 24.50, 38.24
WIDTH = 1500
merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
SPAN = math.radians(EAST - WEST)
HEIGHT = round(WIDTH * (merc(NORTH) - merc(SOUTH)) / SPAN)
METERS = 6371008.8 * SPAN * math.cos(math.radians((NORTH + SOUTH) / 2))  # map width in metres at the central latitude
LAND_RES, SEA_RES, DEM_W = 2, .5, 1000  # texture pixels per map unit; regional DEM snapshot columns
Q = 40  # vector quantization: 1/40 map unit (about 2 m)
def project(lon, lat): return [(lon-WEST)/(EAST-WEST)*WIDTH, (merc(NORTH)-merc(lat))/SPAN*WIDTH]
def inverse(x, y): return [WEST+x/WIDTH*(EAST-WEST), math.degrees(2*math.atan(math.exp(merc(NORTH)-y/WIDTH*SPAN))-math.pi/2)]
def inverse_np(x, y): return WEST+x/WIDTH*(EAST-WEST), np.degrees(2*np.arctan(np.exp(merc(NORTH)-y/WIDTH*SPAN))-np.pi/2)
def request(url, data=None):
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers={'User-Agent':'AthensStreetRacers-offline-map/1.0'}), timeout=210) as r: return r.read()
def path(coords, close=False, digits=1):
    return ''.join(('M' if i == 0 else 'L')+f'{x:.{digits}f},{y:.{digits}f}' for i,(x,y) in enumerate(coords))+('Z' if close else '')
def geometries(g): return list(g.geoms) if hasattr(g, 'geoms') else [g]
def compact(elements):
    out=[]
    for e in elements:
        t=e.get('tags', {})
        if 'geometry' in e:
            pts=[project(p['lon'],p['lat']) for p in e['geometry']]
            if len(pts)<2: continue
            pts=list(LineString(pts).simplify(.6).coords)
            out.append({'id':e['id'],'t':{k:v for k,v in t.items() if k in ['natural','landuse','highway','name','name:en','ref']},'p':[[round(x,2),round(y,2)] for x,y in pts]})
        elif 'lon' in e:
            out.append({'id':e['id'],'t':t,'p':project(e['lon'],e['lat'])})
    return out

def terrarium(zoom, x, y):
    cache=CACHE/f'dem{zoom}-{x}-{y}.png'; cache.parent.mkdir(parents=True,exist_ok=True)
    if not cache.exists(): cache.write_bytes(request(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png'))
    rgb=np.asarray(Image.open(cache).convert('RGB')).astype(float); return rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768

def sample_tiles(zoom, xs, ys):
    """Bilinear EU-DEM heights (Mapzen terrarium tiles) at the given map coordinates."""
    n=2**zoom; tx=lambda lon:(lon+180)/360*n; ty=lambda lat:(1-np.log(np.tan(np.pi/4+np.radians(lat)/2))/np.pi)/2*n
    lon,lat=inverse_np(xs,ys); gx,gy=tx(lon),ty(lat)
    x0,x1,y0,y1=int(gx.min()),int(gx.max()),int(gy.min()),int(gy.max())
    tiles=[(x,y) for x in range(x0,x1+1) for y in range(y0,y1+1)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rasters=dict(zip(tiles,pool.map(lambda t:terrarium(zoom,*t),tiles)))
    mosaic=np.zeros(((y1-y0+1)*256,(x1-x0+1)*256))
    for (x,y),r in rasters.items(): mosaic[(y-y0)*256:(y-y0+1)*256,(x-x0)*256:(x-x0+1)*256]=r
    return ndimage.map_coordinates(mosaic,[(gy-y0)*256-.5,(gx-x0)*256-.5],order=1,mode='nearest')

def fetch():
    import runpy
    extract=runpy.run_path(str(ROOT/'tools/maps/attica/fetch-vector.py'))['extract']
    elements,land=extract(ROOT,[WEST,SOUTH,EAST,NORTH],WIDTH,HEIGHT)
    # Zoom 11 elevation tiles; downsample to an approximately 300 m overview grid (fallback relief).
    gw,gh=420,round(420*HEIGHT/WIDTH); jj,ii=np.mgrid[0:gh,0:gw]
    dem=sample_tiles(11,ii/(gw-1)*WIDTH,jj/(gh-1)*HEIGHT)
    SOURCE.parent.mkdir(parents=True,exist_ok=True)
    source={'bounds':[WEST,SOUTH,EAST,NORTH],'size':[WIDTH,HEIGHT],'date':'2026-10-15','elements':elements,'land':land,'vectorExtension':'https://build.protomaps.com/20261013.pmtiles','dem':{'width':gw,'height':gh,'h':np.rint(dem).astype(int).ravel().tolist()}}
    SOURCE.write_bytes(gzip.compress(json.dumps(source,separators=(',',':')).encode(),mtime=0)); print('Source snapshot',SOURCE.stat().st_size,flush=True)

def fetch_dem():
    # Zoom 12 terrarium tiles (EU-DEM, about 30 m) reduced to a 1000-column grid (about 130 m), stored as 16-bit PNG metres + 100.
    gh=round(DEM_W*HEIGHT/WIDTH); jj,ii=np.mgrid[0:gh,0:DEM_W]
    dem=sample_tiles(12,ii/(DEM_W-1)*WIDTH,jj/(gh-1)*HEIGHT)
    Image.fromarray(np.clip(np.rint(dem)+100,0,65535).astype(np.uint16)).save(DEM_SNAPSHOT,optimize=True)
    print('DEM snapshot',DEM_SNAPSHOT.stat().st_size,'bytes',DEM_W,'x',gh,flush=True)
    for id,map_json,terrain_bin in TRACKS:
        bx0,by0,bx1,by1=detail_box(map_json,terrain_bin); per=DETAIL_DEM_M/(METERS/WIDTH)
        w,h=math.ceil((bx1-bx0)/per)+1,math.ceil((by1-by0)/per)+1; jj,ii=np.mgrid[0:h,0:w]
        dem=sample_tiles(12,bx0+ii/(w-1)*(bx1-bx0),by0+jj/(h-1)*(by1-by0))
        Image.fromarray(np.clip(np.rint(dem)+100,0,65535).astype(np.uint16)).save(DETAIL_DEM(id),optimize=True)
        print('DEM detail',id,w,'x',h,DETAIL_DEM(id).stat().st_size,'bytes',flush=True)

TRACKS=[('riviera','data/map.json','data/terrain.bin'),('megara','data/maps/megara/map.json','data/maps/megara/terrain.bin'),('penteli','data/maps/penteli/map.json','data/maps/penteli/terrain.bin'),('psychiko','data/maps/psychiko/map.json','data/maps/psychiko/terrain.bin')]
def detail_box(map_json, terrain_bin):
    # Close-up detail covers each track's shipped terrain grid (its playable surroundings), in map units.
    p=json.loads((ROOT/map_json).read_bytes())['proj']; nx,nz,x0,z0,step=struct.unpack('<iifff',(ROOT/terrain_bin).read_bytes()[:20])
    corners=[project(p['lon0']+(x0+i*(nx-1)*step)/p['mlon'],p['lat0']-(z0+j*(nz-1)*step)/p['mlat']) for i in (0,1) for j in (0,1)]
    return [min(c[0] for c in corners),min(c[1] for c in corners),max(c[0] for c in corners),max(c[1] for c in corners)]
DETAIL_DEM=lambda id: ROOT/f'tools/maps/attica/dem-{id}.png'
DETAIL_DEM_M=30  # native EU-DEM spacing of the z12 tiles

def regional_dem(source):
    if DEM_SNAPSHOT.exists():
        h=np.asarray(Image.open(DEM_SNAPSHOT)).astype(float)-100
    else:
        d=source['dem']; h=np.asarray(d['h'],dtype=float).reshape(d['height'],d['width'])
    return np.maximum(h,0)

def smoothstep(a,b,x): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def mix(a,b,t): return a+((hexrgb(b) if isinstance(b,str) else np.asarray(b,float))-a)*t[...,None]
def hexrgb(h): return np.array([int(h[i:i+2],16) for i in (1,3,5)],float)
def ramp(stops, v):
    xs=[s for s,_ in stops]; return np.stack([np.interp(v,xs,[hexrgb(c)[k] for _,c in stops]) for k in range(3)],-1)

ELEV=[(0,'#161d21'),(150,'#192125'),(450,'#1d2629'),(800,'#222b2e'),(1200,'#283134')]
URBAN='#252d33'; SHADE=.72
def build():
    source=json.loads(gzip.decompress(SOURCE.read_bytes())); assert source['bounds']==[WEST,SOUTH,EAST,NORTH]
    elements=source['elements']; extent=box(0,0,WIDTH,HEIGHT)
    coasts=[LineString(e['p']) for e in elements if e['t'].get('natural')=='coastline']
    # Shipped geographic race routes and their local 10 m elevation grids.
    routes={}; patches=[]; local_places=[]; local_roads=[]; corridors=[]
    MAJOR=['motorway','trunk','primary','secondary','tertiary']
    for id,file,binfile in TRACKS:
        d=json.loads((ROOT/file).read_bytes()); p=d['proj']
        convert=lambda x,z:project(p['lon0']+x/p['mlon'],p['lat0']-z/p['mlat'])
        raw=[convert(x,z) for x,z in zip(d['route']['x'],d['route']['z'])]
        pts=list(LineString(raw).simplify(.06).coords)
        middle=len(d['route']['x'])//2; loop=math.dist(raw[0],raw[-1])<.5
        routes[id]={'path':path(pts,digits=2),'pin':convert(d['route']['x'][middle],d['route']['z'][middle]),'bounds':list(LineString(pts).bounds),
                    'start':[round(v,2) for v in raw[0]],'end':[round(v,2) for v in raw[-1]],'loop':loop,
                    'length':round(sum(math.dist(a,b) for a,b in zip(pts,pts[1:])),2)}
        # Each track ships the full-resolution OSM street network around its route; it replaces the coarse overview
        # roads inside that corridor, so close-ups stay true to the race line.
        network=d.get('roadNetwork') or {}
        if network.get('roads'):
            corridor=LineString(raw).buffer(network['radius']/(METERS/WIDTH)*.95); corridors.append(corridor)
            for road in network['roads']:
                cls=road.get('h','').replace('_link','')
                cls=cls if cls in MAJOR else 'street'
                q=road['p']; line=LineString([convert(q[i],q[i+1]) for i in range(0,len(q)-1,2)]) if len(q)>=4 else None
                if line is None: continue
                for l in geometries(line.intersection(corridor).simplify(.03)):
                    if isinstance(l,LineString) and l.length>.05: local_roads.append((cls,list(l.coords)))
        buildings=[[convert(q[i],q[i+1]) for i in range(0,len(q)-1,2)] for q in (b.get('p') for b in d.get('buildings') or []) if q and len(q)>=6]
        patches.append((id,detail_box(file,binfile),buildings))
        for pl in d.get('places') or []:
            if pl.get('kind')=='bay' and pl.get('name'): local_places.append((pl['name'],*convert(pl['x'],pl['z'])))
    # Coastline is directed with land on the left. Classify polygonized faces against
    # the nearest directed coastline segment, including small offshore islands.
    if source.get('land'):
        land=[Polygon(rings[0],rings[1:]) for rings in source['land']]
    else:
        clipped=[c.intersection(extent) for c in coasts if c.intersects(extent)]
        faces=list(polygonize(unary_union(clipped+[extent.boundary])))
        segments=[]
        for c in coasts:
            for a,b in zip(c.coords,list(c.coords)[1:]):
                dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
                if length < .05: continue
                mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2
                segments.append((length,Point(mx+dy/length*.03,my-dx/length*.03),Point(mx-dy/length*.03,my+dx/length*.03)))
        segments.sort(key=lambda s:s[0],reverse=True)
        land=[]
        for face in faces:
            for _,left,right in segments:
                if face.contains(left):land.append(face);break
                if face.contains(right):break
    assert any(f.contains(Point(*project(23.73,37.98))) for f in land),'Athens must be land'
    assert not any(f.contains(Point(*project(23.65,37.85))) for f in land),'Saronic Gulf must be sea'
    land_rings=[[list(f.exterior.coords),*[list(r.coords) for r in f.interiors]] for f in land]

    def mask(res, supersample=1):
        s=res*supersample; img=Image.new('L',(round(WIDTH*s),round(HEIGHT*s)))
        draw=ImageDraw.Draw(img)
        for rings in land_rings:
            draw.polygon([(x*s,y*s) for x,y in rings[0]],fill=255)
            for hole in rings[1:]: draw.polygon([(x*s,y*s) for x,y in hole],fill=0)
        if supersample>1: img=img.resize((round(WIDTH*res),round(HEIGHT*res)),Image.Resampling.BOX)
        return np.asarray(img,float)/255

    # ---------------------------------------------------------------- relief: regional EU-DEM, refined by the track grids
    RW,RH=WIDTH*LAND_RES,round(HEIGHT*LAND_RES)
    dem=regional_dem(source); gh,gw=dem.shape
    py,px=np.mgrid[0:RH,0:RW].astype(float); ux,uy=(px+.5)/LAND_RES,(py+.5)/LAND_RES
    h=ndimage.map_coordinates(dem,[uy/HEIGHT*(gh-1),ux/WIDTH*(gw-1)],order=3,mode='nearest')
    cell=METERS/WIDTH/LAND_RES
    # Soft multi-directional hillshade (NW key light, W and N fills), normalized so flat ground is 1.
    dzy,dzx=np.gradient(ndimage.gaussian_filter(h,.7),cell); dzx*=1.5; dzy*=1.5
    norm=np.sqrt(1+dzx*dzx+dzy*dzy); alt=math.radians(42); shade=np.zeros_like(h)
    for az,wgt in [(315,.62),(270,.2),(0,.18)]:
        a=math.radians(az); lx,ly=math.sin(a)*math.cos(alt),-math.cos(a)*math.cos(alt)
        shade+=wgt*(-dzx*lx-dzy*ly+math.sin(alt))/norm
    shade/=math.sin(alt)
    slope=1/norm
    # Hypsometric slate tint, very low contrast; urban land is a slightly lifted, cooler fabric.
    color=ramp(ELEV,h)
    urban=Image.new('L',(RW,RH)); urban_draw=ImageDraw.Draw(urban)
    for e in elements:
        t=e['t']; pts=e['p']
        if 'landuse' not in t or not pts or not isinstance(pts[0],list) or len(pts)<4: continue
        urban_draw.polygon([(x*LAND_RES,y*LAND_RES) for x,y in pts],fill=255)
    um=ndimage.gaussian_filter(np.asarray(urban,float)/255,1.1)
    color=mix(color,URBAN,um*.72)
    light=np.clip(shade,.3,1.9)
    color=color*(1+(light-1)*SHADE)[...,None]
    color=color*(.9+.1*slope)[...,None]
    land_img=Image.fromarray(np.clip(color,0,255).astype('uint8'))
    buf=io.BytesIO(); land_img.save(buf,format='WEBP',quality=82,method=6); land_webp=buf.getvalue()

    # ---------------------------------------------------------------- track detail: 10 m relief + OSM buildings where the camera closes in
    def colorize(hm, cell, urban_mask, exaggerate):
        dzy,dzx=np.gradient(hm,cell); dzx*=exaggerate; dzy*=exaggerate
        norm=np.sqrt(1+dzx*dzx+dzy*dzy); alt=math.radians(42); sh=np.zeros_like(hm)
        for az,wgt in [(315,.62),(270,.2),(0,.18)]:
            a=math.radians(az); lx,ly=math.sin(a)*math.cos(alt),-math.cos(a)*math.cos(alt)
            sh+=wgt*(-dzx*lx-dzy*ly+math.sin(alt))/norm
        sh/=math.sin(alt)
        c=ramp(ELEV,hm); c=mix(c,URBAN,urban_mask*.72)
        c=c*(1+(np.clip(sh,.3,1.9)-1)*SHADE)[...,None]
        return c*(.9+.1/norm)[...,None]
    detail_assets=[]; detail_bytes={}
    for id,(bx0,by0,bx1,by1),buildings in patches:
        res=min(12,820/max(bx1-bx0,by1-by0)); PW,PH=math.ceil((bx1-bx0)*res),math.ceil((by1-by0)*res)
        qy,qx=np.mgrid[0:PH,0:PW].astype(float); ux,uy=bx0+(qx+.5)/res,by0+(qy+.5)/res
        if DETAIL_DEM(id).exists():
            g=np.maximum(np.asarray(Image.open(DETAIL_DEM(id))).astype(float)-100,0); gh2,gw2=g.shape
            hm=ndimage.map_coordinates(g,[(uy-by0)/(by1-by0)*(gh2-1),(ux-bx0)/(bx1-bx0)*(gw2-1)],order=3,mode='nearest')
        else: hm=ndimage.map_coordinates(dem,[uy/HEIGHT*(gh-1),ux/WIDTH*(gw-1)],order=3,mode='nearest')
        hm=np.maximum(hm,0)
        edge=np.minimum.reduce([ux-bx0,bx1-ux,uy-by0,by1-uy])*(METERS/WIDTH); alpha=smoothstep(0,450,edge)
        um=Image.new('L',(PW,PH)); ud=ImageDraw.Draw(um)
        for e in elements:
            t=e['t']; pts=e['p']
            if 'landuse' not in t or not pts or not isinstance(pts[0],list) or len(pts)<4: continue
            if max(q[0] for q in pts)<bx0 or min(q[0] for q in pts)>bx1 or max(q[1] for q in pts)<by0 or min(q[1] for q in pts)>by1: continue
            ud.polygon([((x-bx0)*res,(y-by0)*res) for x,y in pts],fill=255)
        c=colorize(hm,METERS/WIDTH/res,ndimage.gaussian_filter(np.asarray(um,float)/255,2),1.5)
        # Building footprints as a faint lifted fabric (they read as city blocks, not as 3D).
        bm=Image.new('L',(PW*2,PH*2)); bd=ImageDraw.Draw(bm)
        for poly in buildings: bd.polygon([((x-bx0)*res*2,(y-by0)*res*2) for x,y in poly],fill=255)
        bmask=np.asarray(bm.resize((PW,PH),Image.Resampling.BOX),float)/255
        c=mix(c,'#3a454d',bmask*.75)
        rgba=np.dstack([np.clip(c,0,255),alpha*255]).astype('uint8')
        buf=io.BytesIO(); Image.fromarray(rgba,'RGBA').save(buf,format='WEBP',quality=88,method=6,alpha_quality=60)
        name=f'assets/maps/attica-detail-{id}.webp'; detail_bytes[name]=buf.getvalue()
        detail_assets.append({'id':id,'src':name,'box':[round(bx0,2),round(by0,2),round(bx1,2),round(by1,2)]})
        print('detail',id,PW,PH,len(buf.getvalue()),'buildings',len(buildings))

    # ---------------------------------------------------------------- sea: depth styled by distance from the coast (no bathymetry in the source)
    land_lo=mask(SEA_RES,4)
    dist=ndimage.distance_transform_edt(land_lo<.5)/SEA_RES  # map units
    sea=mix(hexrgb('#0f2029')*np.ones(dist.shape+(3,)),'#060b10',smoothstep(0,38,dist)**.8)
    sea=sea+(hexrgb('#173341')-hexrgb('#0f2029'))*np.exp(-dist/1.6)[...,None]*.9
    sea_img=Image.fromarray(np.clip(sea,0,255).astype('uint8'))
    buf=io.BytesIO(); sea_img.save(buf,format='WEBP',quality=88,method=6); sea_webp=buf.getvalue()

    # ---------------------------------------------------------------- vectors: coastline + road hierarchy, quantized
    def on_edge(a,b):
        return any(abs(a[i]-v)<.02 and abs(b[i]-v)<.02 for i,v in [(0,0),(0,WIDTH),(1,0),(1,HEIGHT)])
    coast=[]
    for rings in land_rings:
        for ring in rings:
            run=[ring[0]]
            for a,b in zip(ring,ring[1:]):
                if on_edge(a,b):
                    if len(run)>1: coast.append(run)
                    run=[b]
                else: run.append(b)
            if len(run)>1: coast.append(run)
    classes=['land','coast','motorway','trunk','primary','secondary','tertiary','street']
    detail=unary_union(corridors)
    layers={k:[] for k in classes}; layers['coast']=coast; layers['land']=[ring for rings in land_rings for ring in rings]
    for e in elements:
        kind=e['t'].get('highway'); pts=e['p']
        if kind not in layers or not pts or not isinstance(pts[0],list): continue
        line=LineString(pts)
        if not line.intersects(extent): continue
        for l in geometries(line.intersection(extent).difference(detail)):
            if isinstance(l,LineString) and l.length>.3: layers[kind].append(list(l.coords))
    for kind,coords in local_roads: layers[kind].append(coords)
    vec=bytearray(b'ATV1'); vec+=struct.pack('<H',len(classes))
    for i,k in enumerate(classes):
        lines=[l for l in layers[k] if len(l)>1]
        vec+=struct.pack('<BI',i,len(lines))
        for l in lines:
            vec+=struct.pack('<H',len(l))
            vec+=np.clip(np.rint(np.asarray(l)*Q),0,65535).astype('<u2').tobytes()

    # ---------------------------------------------------------------- labels: curated OSM places/summits, ranked and zoom-tiered
    # z = minimum zoom in screen px per map unit; the selector places them at screen size and drops collisions.
    labels=[]
    wanted={'Athens':('ATHENS','city',0,0),'Piraeus':('PIRAEUS','town',1,0),'Eleusis':('ELEFSINA','town',2,0),'Glyfada':('GLYFADA','town',2,1.6),
            'Kifisia':('KIFISIA','town',2,1.6),'Koropi':('KOROPI','town',3,1.6),'Marousi':('MAROUSI','town',3,2.2),'Rafina':('RAFINA','town',3,1.6),
            'Markopoulo':('MARKOPOULO','town',4,2.2),'Aspropyrgos':('ASPROPYRGOS','town',4,2.2),'Nea Makri':('NEA MAKRI','town',4,2.2),
            'Vouliagmeni':('VOULIAGMENI','suburb',5,3.2),'Varkiza':('VARKIZA','suburb',5,3.2),'Vari':('VARI','suburb',6,4),'Voula':('VOULA','suburb',6,4),
            'Psychiko':('PSYCHIKO','suburb',5,3.2),'Filothei':('FILOTHEI','suburb',6,4),'Chalandri':('CHALANDRI','suburb',6,4),'Cholargos':('CHOLARGOS','suburb',7,5),
            'Neo Psychiko':('NEO PSYCHIKO','suburb',7,5),'Galatsi':('GALATSI','suburb',7,5),'Dionysos':('DIONYSOS','suburb',5,3.2),'Ekali':('EKALI','suburb',7,4),
            'Melissia':('MELISSIA','suburb',7,4),'Gerakas':('GERAKAS','suburb',7,4),'Agia Paraskevi':('AGIA PARASKEVI','suburb',7,4),'Kaisariani':('KAISARIANI','suburb',7,5),
            'Mandra':('MANDRA','town',6,3.2),'Magoula':('MAGOULA','town',7,3.2),'Spata':('SPATA','town',5,2.6),'Pallini':('PALLINI','suburb',6,3.2)}
    summits={'Καραβόλα':('PARNITHA','1,413 m'),'Πυργάρι':('PENTELI','1,109 m'),'Εύζωνας':('HYMETTUS','1,026 m')}
    for e in elements:
        if isinstance(e['p'][0],list):continue
        t=e['t'];name=t.get('name:en') or t.get('name');name={'Kifissia':'Kifisia','Βάρκιζα':'Varkiza'}.get(name,name);x,y=e['p']
        if t.get('natural')=='peak' and t.get('name') in summits:
            text,sub=summits.pop(t['name']);labels.append({'t':text,'s':sub,'k':'peak','p':2,'z':0,'x':round(x,1),'y':round(y,1)})
        elif t.get('place') and name in wanted and 0<=x<=WIDTH and 0<=y<=HEIGHT:
            text,cls,rank,z=wanted.pop(name);labels.append({'t':text,'k':cls,'p':rank,'z':z,'x':round(x,1),'y':round(y,1)})
    for lon,lat,text,z in [(23.595,37.845,'SARONIC GULF',0),(24.06,37.93,'AEGEAN SEA',0),(23.52,37.99,'GULF OF ELEFSINA',2.2)]:
        x,y=project(lon,lat);labels.append({'t':text,'k':'water','p':1,'z':z,'x':round(x,1),'y':round(y,1)})
    for name,x,y in local_places:
        labels.append({'t':name.upper(),'k':'water','p':6,'z':6,'x':round(x,1),'y':round(y,1)})
    print('Labels',len(labels),'missing',sorted(wanted)+sorted(summits))
    labels.sort(key=lambda l:l['p'])

    # ---------------------------------------------------------------- static backdrop composite (menu backdrop, loading art)
    BW,BH=WIDTH,HEIGHT
    lm=mask(1,4)[...,None]
    comp=np.asarray(sea_img.resize((BW,BH),Image.Resampling.BICUBIC),float)*(1-lm)+np.asarray(land_img.resize((BW,BH),Image.Resampling.LANCZOS),float)*lm
    buf=io.BytesIO(); Image.fromarray(np.clip(comp,0,255).astype('uint8')).save(buf,format='WEBP',quality=80,method=6)
    coast_d=''.join(path(l) for l in coast); motor_d=''.join(path(l) for l in layers['motorway'])
    svg=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}"><desc>Greater Athens, WGS84 Web Mercator, {WEST},{SOUTH},{EAST},{NORTH}. Map data © OpenStreetMap contributors, ODbL. '
         f'Relief produced using Copernicus data and information funded by the European Union, EU-DEM via Mapzen/AWS.</desc>'
         f'<image width="{WIDTH}" height="{HEIGHT}" href="data:image/webp;base64,{base64.b64encode(buf.getvalue()).decode()}"/>'
         f'<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="{coast_d}" stroke="#7d9cab" stroke-opacity=".5" stroke-width=".6"/><path d="{motor_d}" stroke="#a89e8e" stroke-opacity=".35" stroke-width=".7"/></g></svg>')

    module=('// Generated by tools/build-attica-map.py; route geometry from shipped OSM maps.\n'
        'export const MAP_VIEW = '+json.dumps({'width':WIDTH,'height':HEIGHT,'metersPerUnit':METERS/WIDTH},separators=(',',':'))+';\n'
        'export const MAP_ASSETS = '+json.dumps({'land':'assets/maps/attica-land.webp','sea':'assets/maps/attica-sea.webp','vectors':'assets/maps/attica-vectors.bin','detail':detail_assets,'quantize':Q,'layers':classes},separators=(',',':'))+';\n'
        'export const TRACK_ROUTES = '+json.dumps(routes,separators=(',',':'))+';\n'
        'export const MAP_LABELS = '+json.dumps(labels,separators=(',',':'),ensure_ascii=False)+';\n'
        'export const TRACK_PINS = Object.fromEntries(Object.entries(TRACK_ROUTES).map(([id, route]) => [id, route.pin]));\n')
    runtime=len(land_webp)+len(sea_webp)+len(vec)+len(module.encode())+sum(map(len,detail_bytes.values()))
    assert runtime<900000,f'Selector map assets too large: {runtime}'
    assert len(svg.encode())<300000,f'Backdrop too large: {len(svg.encode())}'
    out=ROOT/'assets/maps'
    (out/'attica-land.webp').write_bytes(land_webp);(out/'attica-sea.webp').write_bytes(sea_webp);(out/'attica-vectors.bin').write_bytes(bytes(vec))
    for name,data in detail_bytes.items(): (ROOT/name).write_bytes(data)
    (out/'attica.svg').write_text(svg);(ROOT/'src/attica-map-data.js').write_text(module)
    print('Selector map',runtime,'bytes (land',len(land_webp),'sea',len(sea_webp),'vectors',len(vec),'module',len(module.encode()),'); backdrop',len(svg.encode()),
          '; land faces',len(land),'; lines',{k:len(v) for k,v in layers.items()})

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--fetch',action='store_true');parser.add_argument('--fetch-dem',action='store_true');args=parser.parse_args()
    if args.fetch:fetch()
    if args.fetch_dem:fetch_dem()
    build()
