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
    elev=np.clip(h/1400,0,1)[:,:,None]; low=np.array([27,38,40]); high=np.array([62,79,78])
    rgb=np.clip((low+(high-low)*elev)*shade[:,:,None],0,255).astype('uint8')
    raster=Image.fromarray(rgb).resize((WIDTH,HEIGHT),Image.Resampling.BICUBIC); urban_mask=Image.new('L',raster.size); urban_draw=ImageDraw.Draw(urban_mask); minor_roads=[]
    roads={k:[] for k in ['primary','trunk','motorway']}
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
        if t.get('highway') in ['tertiary','secondary','primary','trunk','motorway']:
            for l in geometries(line.intersection(extent).simplify(.6)):
                if isinstance(l,LineString):
                    if t['highway'] in ['secondary','tertiary']:minor_roads.append((t['highway'],list(l.coords)))
                    else:roads[t['highway']].append(path(l.coords))
    raster=Image.composite(Image.new('RGB',raster.size,(64,76,82)),raster,urban_mask)
    draw=ImageDraw.Draw(raster)
    for kind,coords in minor_roads:draw.line(coords,fill=(53,67,73) if kind=='tertiary' else (76,94,99),width=1)
    buf=io.BytesIO();raster.save(buf,format='WEBP',quality=86,method=6);relief=base64.b64encode(buf.getvalue()).decode()
    labels=[]
    # Curated OSM names/coordinates avoid hundreds of overlapping suburb labels.
    desired={'Athens':('ATHENS', 'city'),'Piraeus':('PIRAEUS','place'),'Glyfada':('GLYFADA','place'),'Vouliagmeni':('VOULIAGMENI','place'),'Varkiza':('VARKIZA','place'),'Dionysos':('DIONYSOS','place'),'Kifisia':('KIFISIA','place'),'Marousi':('MAROUSI','place'),'Chalandri':('CHALANDRI','place'),'Koropi':('KOROPI','place'),'Penteli':('PENTELI','place'),'Parnitha':('PARNITHA · 1,413 m','peak'),'Hymettus':('HYMETTUS · 1,026 m','peak')}
    for e in elements:
        if isinstance(e['p'][0],list):continue
        name=e['t'].get('name:en'); key={'Kifissia':'Kifisia','Βάρκιζα':'Varkiza'}.get(name or e['t'].get('name'),name)
        if key in desired:
            text,cls=desired.pop(key);x,y=e['p'];y += -28 if key=='Varkiza' else 28 if key=='Kifisia' else 0;labels.append(f'<text class="{cls}" x="{x:.1f}" y="{y:.1f}">{html.escape(text)}</text>')
    # Geographic annotations placed by coordinates; mountains named at their summits.
    for lon,lat,text,cls in [(23.885,38.083,'PENTELI · 1,109 m','peak'),(23.811,37.963,'HYMETTUS','peak'),(23.717,38.174,'PARNITHA','peak'),(23.595,37.845,'SARONIC GULF','water'),(24.015,37.97,'AEGEAN SEA','water'),(23.739,37.963,'SYNGROU','road'),(23.771,38.021,'KIFISIAS','road'),(23.849,38.02,'ATTIKI ODOS / A6','road'),(23.752,37.884,'POSEIDONOS / EO91','road'),(23.869,37.81,'LOMVARDA','place')]:
        x,y=project(lon,lat);labels.append(f'<text class="{cls}" x="{x:.1f}" y="{y:.1f}">{text}</text>')
    styles='text{font:500 12px sans-serif;fill:#a1b7bd;letter-spacing:1.4px;paint-order:stroke;stroke:#142026;stroke-width:3px;stroke-linejoin:round}.city{font-size:24px;fill:#e2eaeb;letter-spacing:5px}.peak{font-size:11px;fill:#829b91}.water{font-size:16px;fill:#426e85;letter-spacing:4px}.road{font-size:9px;fill:#779798;letter-spacing:1px}'
    road_svg=''
    for kind,color,w in [('primary','#6d8281',1.5),('trunk','#6a9090',2),('motorway','#749eac',2.5)]:
        d=''.join(roads[kind]);road_svg+=f'<defs><path id="r-{kind}" d="{d}"/></defs><use href="#r-{kind}" stroke="#142228" stroke-width="{w+2}"/><use href="#r-{kind}" stroke="{color}" stroke-width="{w}"/>'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}"><desc>Greater Athens, WGS84 Web Mercator, {WEST},{SOUTH},{EAST},{NORTH}. Map data © OpenStreetMap contributors, ODbL. Relief produced using Copernicus data and information funded by the European Union, EU-DEM via Mapzen/AWS and local EU-DEM terrain.bin.</desc><defs><clipPath id="land"><path d="{land_path}" fill-rule="evenodd"/></clipPath></defs><style>{styles}</style><rect width="{WIDTH}" height="{HEIGHT}" fill="#10222e"/><g clip-path="url(#land)"><image width="{WIDTH}" height="{HEIGHT}" href="data:image/webp;base64,{relief}"/></g><path d="{land_path}" fill="none" stroke="#63828a" stroke-width="1"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">{road_svg}</g>{"".join(labels)}</svg>'
    meters=6371008.8*SPAN*math.cos(math.radians((NORTH+SOUTH)/2))
    module='// Generated by tools/build-attica-map.py; route geometry from shipped OSM maps.\nexport const MAP_VIEW = '+json.dumps({'width':WIDTH,'height':HEIGHT,'metersPerUnit':meters/WIDTH},separators=(',',':'))+';\nexport const TRACK_ROUTES = '+json.dumps(routes,separators=(',',':'))+';\nexport const TRACK_PINS = Object.fromEntries(Object.entries(TRACK_ROUTES).map(([id, route]) => [id, route.pin]));\n'
    size=len(svg.encode())+len(module.encode());assert size<500000,f'Map assets too large: {size}'
    (ROOT/'assets/maps/attica.svg').write_text(svg);(ROOT/'src/attica-map-data.js').write_text(module)
    print('Map + routes',size,'bytes; land faces',len(land),'road segments',sum(map(len,roads.values())))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--fetch',action='store_true');args=parser.parse_args()
    if args.fetch:fetch()
    build()
