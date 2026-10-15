#!/usr/bin/env python3
"""Offline greater-Athens map. pip install numpy pillow shapely; run with --fetch to refresh.
Default rebuild uses the compact, ODbL source snapshot; no runtime tile requests.
"""
import argparse, base64, concurrent.futures, gzip, html, io, json, math, struct, urllib.parse, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'tools/maps/attica/source.json.gz'
WEST, SOUTH, EAST, NORTH = 23.00, 37.70, 24.50, 38.24
WIDTH = 1500
merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
SPAN = math.radians(EAST - WEST)
HEIGHT = round(WIDTH * (merc(NORTH) - merc(SOUTH)) / SPAN)
def project(lon, lat): return [(lon-WEST)/(EAST-WEST)*WIDTH, (merc(NORTH)-merc(lat))/SPAN*WIDTH]
def inverse(x, y): return [WEST+x/WIDTH*(EAST-WEST), math.degrees(2*math.atan(math.exp(merc(NORTH)-y/WIDTH*SPAN))-math.pi/2)]
def request(url, data=None):
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers={'User-Agent':'AthensStreetRacers-offline-map/1.0'}), timeout=210) as r: return r.read()
def path(coords, close=False):
    return ''.join(('M' if i == 0 else 'L')+f'{x:.1f},{y:.1f}' for i,(x,y) in enumerate(coords))+('Z' if close else '')
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

def fetch():
    import runpy
    extract=runpy.run_path(str(ROOT/'tools/maps/attica/fetch-vector.py'))['extract']
    elements,land=extract(ROOT,[WEST,SOUTH,EAST,NORTH],WIDTH,HEIGHT)
    # Zoom 11 elevation tiles; downsample to an approximately 200 m overview grid.
    zoom=11; n=2**zoom
    tx=lambda lon:(lon+180)/360*n
    ty=lambda lat:(1-merc(lat)/math.pi)/2*n
    tiles=[(x,y) for x in range(int(tx(WEST)),int(tx(EAST))+1) for y in range(int(ty(NORTH)),int(ty(SOUTH))+1)]
    def tile(xy):
        x,y=xy; cache=ROOT/f'.scratch/attica-map/dem-{x}-{y}.png'; cache.parent.mkdir(parents=True,exist_ok=True)
        if not cache.exists():cache.write_bytes(request(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png'))
        rgb=np.asarray(Image.open(cache)).astype(float); return xy,rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rasters=dict(pool.map(tile,tiles))
    gw,gh=420,round(420*HEIGHT/WIDTH); dem=np.zeros((gh,gw))
    for j in range(gh):
        for i in range(gw):
            lon,lat=inverse(i/(gw-1)*WIDTH,j/(gh-1)*HEIGHT); xx,yy=tx(lon),ty(lat)
            dem[j,i]=rasters[(int(xx),int(yy))][min(255,int(yy%1*256)),min(255,int(xx%1*256))]
    SOURCE.parent.mkdir(parents=True,exist_ok=True)
    source={'bounds':[WEST,SOUTH,EAST,NORTH],'size':[WIDTH,HEIGHT],'date':'2026-10-15','elements':elements,'land':land,'vectorExtension':'https://build.protomaps.com/20261013.pmtiles','dem':{'width':gw,'height':gh,'h':np.rint(dem).astype(int).ravel().tolist()}}
    SOURCE.write_bytes(gzip.compress(json.dumps(source,separators=(',',':')).encode(),mtime=0)); print('Source snapshot',SOURCE.stat().st_size,flush=True)

def build():
    source=json.loads(gzip.decompress(SOURCE.read_bytes())); assert source['bounds']==[WEST,SOUTH,EAST,NORTH]
    elements=source['elements']; extent=box(0,0,WIDTH,HEIGHT)
    coasts=[LineString(e['p']) for e in elements if e['t'].get('natural')=='coastline']
    # Use the shipped geographic race routes and corridor elevation data.
    routes={}; terrain=[]
    for id,file,binfile in [('riviera','data/map.json','data/terrain.bin'),('megara','data/maps/megara/map.json','data/maps/megara/terrain.bin'),('penteli','data/maps/penteli/map.json','data/maps/penteli/terrain.bin')]:
        d=json.loads((ROOT/file).read_bytes()); p=d['proj']
        convert=lambda x,z:project(p['lon0']+x/p['mlon'],p['lat0']-z/p['mlat'])
        pts=list(LineString([convert(x,z) for x,z in zip(d['route']['x'],d['route']['z'])]).simplify(.35).coords)
        middle=len(d['route']['x'])//2
        routes[id]={'path':path(pts),'pin':convert(d['route']['x'][middle],d['route']['z'][middle]),'bounds':list(LineString(pts).bounds)}
        b=(ROOT/binfile).read_bytes(); nx,nz,x0,z0,step=struct.unpack('<iifff',b[:20]); heights=np.frombuffer(b,dtype='<i2',count=nx*nz,offset=32).reshape(nz,nx)/10
        terrain.append((p,nx,nz,x0,z0,step,heights))
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
    land_path=''.join(path(f.exterior.coords,True)+''.join(path(r.coords,True) for r in f.interiors) for f in land)
    dem=source['dem']; gw,gh=dem['width'],dem['height']; h=np.asarray(dem['h'],dtype=float).reshape(gh,gw)
    # Use shipped DEMs wherever they cover the overview cell; regional DEM fills gaps.
    for j in range(gh):
        for i in range(gw):
            lon,lat=inverse(i/(gw-1)*WIDTH,j/(gh-1)*HEIGHT)
            for p,nx,nz,x0,z0,step,heights in terrain:
                xx=((lon-p['lon0'])*p['mlon']-x0)/step; zz=(-(lat-p['lat0'])*p['mlat']-z0)/step
                if 0<=xx<nx-1 and 0<=zz<nz-1:
                    a,b=int(xx),int(zz); fx,fz=xx-a,zz-b
                    h[j,i]=heights[b,a]*(1-fx)*(1-fz)+heights[b,a+1]*fx*(1-fz)+heights[b+1,a]*(1-fx)*fz+heights[b+1,a+1]*fx*fz
    # Hypsometric tint and a NW-lit normal field: true DEM relief, no fake rings.
    cell_meters=6371008.8*SPAN*math.cos(math.radians((NORTH+SOUTH)/2))/(gw-1)
    dy,dx=np.gradient(h,cell_meters); shade=np.clip((-.65*dx+.65*dy+1)/np.sqrt(1+dx*dx+dy*dy),.25,1.3)
    # Calm relief: keep the real NW-lit shape but compress it toward neutral.
    shade=1+(shade-1)*.6
    elev=np.clip(h/1400,0,1)[:,:,None]; low=np.array([29,40,43]); high=np.array([58,72,71])
    rgb=np.clip((low+(high-low)*elev)*shade[:,:,None],0,255).astype('uint8')
    raster=Image.fromarray(rgb).resize((WIDTH,HEIGHT),Image.Resampling.BICUBIC); urban_mask=Image.new('L',raster.size); urban_draw=ImageDraw.Draw(urban_mask)
    roads={k:[] for k in ['trunk','motorway']}
    for e in elements:
        t=e['t']; pts=e['p']
        if not pts or not isinstance(pts[0],list):continue
        line=LineString(pts)
        if not line.intersects(extent):continue
        if 'landuse' in t and len(pts)>3:
            poly=Polygon(pts)
            if not poly.is_valid:poly=poly.buffer(0)
            poly=poly.intersection(extent).simplify(.7)
            for f in geometries(poly):
                if isinstance(f,Polygon) and f.area>3:urban_draw.polygon(list(f.exterior.coords),fill=100)
        # Only the motorway network (and the EO trunk roads) is drawn: the overview is a locator, not a street map.
        if t.get('highway') in roads:
            for l in geometries(line.intersection(extent).simplify(.8)):
                if isinstance(l,LineString):roads[t['highway']].append(path(l.coords))
    urban_mask=urban_mask.point(lambda v:v*.62)
    raster=Image.composite(Image.new('RGB',raster.size,(60,72,78)),raster,urban_mask)
    buf=io.BytesIO();raster.save(buf,format='WEBP',quality=86,method=6);relief=base64.b64encode(buf.getvalue()).decode()
    # Curated OSM places/summits: few names, ranked; the selector places them at screen size and drops collisions.
    labels=[]; wanted={'Athens':('ATHENS','city',0),'Piraeus':('PIRAEUS','place',1),'Glyfada':('GLYFADA','place',2),'Kifisia':('KIFISIA','place',2),'Koropi':('KOROPI','place',2),'Eleusis':('ELEFSINA','place',2),'Vouliagmeni':('VOULIAGMENI','place',3),'Marousi':('MAROUSI','place',3),'Rafina':('RAFINA','place',3),'Varkiza':('VARKIZA','place',4),'Dionysos':('DIONYSOS','place',4)}
    summits={'Καραβόλα':('PARNITHA','1,413 m'),'Πυργάρι':('PENTELI','1,109 m'),'Εύζωνας':('HYMETTUS','1,026 m')}
    for e in elements:
        if isinstance(e['p'][0],list):continue
        t=e['t'];name=t.get('name:en') or t.get('name');name={'Kifissia':'Kifisia','Βάρκιζα':'Varkiza'}.get(name,name);x,y=e['p']
        if t.get('natural')=='peak' and t.get('name') in summits:
            text,sub=summits.pop(t['name']);labels.append({'t':text,'s':sub,'k':'peak','p':1,'x':round(x,1),'y':round(y,1)})
        elif t.get('place') and name in wanted and 0<=x<=WIDTH and 0<=y<=HEIGHT:
            text,cls,rank=wanted.pop(name);labels.append({'t':text,'k':cls,'p':rank,'x':round(x,1),'y':round(y,1)})
    for lon,lat,text in [(23.595,37.845,'SARONIC GULF'),(24.06,37.93,'AEGEAN SEA')]:
        x,y=project(lon,lat);labels.append({'t':text,'k':'water','p':1,'x':round(x,1),'y':round(y,1)})
    print('Labels',len(labels),'missing',sorted(wanted)+sorted(summits))
    labels.sort(key=lambda l:l['p'])
    road_svg=''
    for kind,color,w in [('trunk','#4f6a70',.75),('motorway','#628896',1.15)]:
        d=''.join(roads[kind]);road_svg+=f'<defs><path id="r-{kind}" d="{d}"/></defs><use href="#r-{kind}" stroke="#142228" stroke-width="{w+1.1}"/><use href="#r-{kind}" stroke="{color}" stroke-width="{w}"/>'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}"><desc>Greater Athens, WGS84 Web Mercator, {WEST},{SOUTH},{EAST},{NORTH}. Map data © OpenStreetMap contributors, ODbL. Relief produced using Copernicus data and information funded by the European Union, EU-DEM via Mapzen/AWS and local EU-DEM terrain.bin.</desc><defs><clipPath id="land"><path d="{land_path}" fill-rule="evenodd"/></clipPath></defs><rect width="{WIDTH}" height="{HEIGHT}" fill="#10222e"/><g clip-path="url(#land)"><image width="{WIDTH}" height="{HEIGHT}" href="data:image/webp;base64,{relief}"/></g><path d="{land_path}" fill="none" stroke="#557a83" stroke-width=".7"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">{road_svg}</g></svg>'
    meters=6371008.8*SPAN*math.cos(math.radians((NORTH+SOUTH)/2))
    module='// Generated by tools/build-attica-map.py; route geometry from shipped OSM maps.\nexport const MAP_VIEW = '+json.dumps({'width':WIDTH,'height':HEIGHT,'metersPerUnit':meters/WIDTH},separators=(',',':'))+';\nexport const TRACK_ROUTES = '+json.dumps(routes,separators=(',',':'))+';\nexport const MAP_LABELS = '+json.dumps(labels,separators=(',',':'),ensure_ascii=False)+';\nexport const TRACK_PINS = Object.fromEntries(Object.entries(TRACK_ROUTES).map(([id, route]) => [id, route.pin]));\n'
    size=len(svg.encode())+len(module.encode());assert size<500000,f'Map assets too large: {size}'
    (ROOT/'assets/maps/attica.svg').write_text(svg);(ROOT/'src/attica-map-data.js').write_text(module)
    print('Map + routes',size,'bytes; land faces',len(land),'road segments',sum(map(len,roads.values())))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--fetch',action='store_true');args=parser.parse_args()
    if args.fetch:fetch()
    build()
