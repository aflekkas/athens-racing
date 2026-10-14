"""Compact offline vector extension from the published Protomaps OSM planet archive.
Fetch-only dependencies: pmtiles, mapbox-vector-tile. Runtime has no tile dependency.
"""
import concurrent.futures, functools, gzip, json, math, urllib.request
from pathlib import Path
from pmtiles.reader import Reader
from mapbox_vector_tile import decode
from shapely.geometry import shape, box, Polygon, LineString
from shapely.ops import transform, unary_union

URL='https://build.protomaps.com/20261013.pmtiles'
CORE=[23.50,37.775,24.07,38.205]
def extract(root, bounds, width, height):
    west,south,east,north=bounds
    merc=lambda lat:math.log(math.tan(math.pi/4+math.radians(lat)/2))
    span=math.radians(east-west)
    project=lambda lon,lat:((lon-west)/(east-west)*width,(merc(north)-merc(lat))/span*width)
    old=json.loads(gzip.decompress((root/'tools/maps/attica/source.json.gz').read_bytes()))
    ow,os,oe,on=old['bounds'];oldwidth=old['size'][0]
    def convert(p):
        lon=ow+p[0]/oldwidth*(oe-ow);lat=math.degrees(2*math.atan(math.exp(merc(on)-p[1]/oldwidth*math.radians(oe-ow)))-math.pi/2)
        return [round(v,2) for v in project(lon,lat)]
    core=box(*project(CORE[0],CORE[3]),*project(CORE[2],CORE[1]));extent=box(0,0,width,height)
    # Keep the original direct OSM extract in the Athens basin; refresh only its surround.
    elements=[]
    for e in old['elements']:
        if str(e['id']).startswith('proto-'):continue
        e=dict(e);e['p']=[convert(p) for p in e['p']] if isinstance(e['p'][0],list) else convert(e['p']);elements.append(e)
    cache=root/'.scratch/attica-map';cache.mkdir(parents=True,exist_ok=True)
    @functools.lru_cache(maxsize=256)
    def read(offset,length):
        req=urllib.request.Request(URL,headers={'Range':f'bytes={offset}-{offset+length-1}','User-Agent':'AthensStreetRacers-offline-extract/1.0'})
        with urllib.request.urlopen(req,timeout=45) as r:
            if r.status!=206:raise RuntimeError('PMTiles server did not honor bounded range request')
            data=r.read(length+1)
            if len(data)!=length:raise RuntimeError('Incorrect PMTiles range length')
            return data
    reader=Reader(read);z=11;n=2**z;tx=lambda lon:int((lon+180)/360*n);ty=lambda lat:int((1-merc(lat)/math.pi)/2*n)
    tiles=[(x,y) for x in range(tx(west),tx(east)+1) for y in range(ty(north),ty(south)+1)]
    def tile(xy):
        x,y=xy;file=cache/f'ref-{x}-{y}.mvt'
        if not file.exists():file.write_bytes(reader.get(z,x,y))
        return xy,decode(gzip.decompress(file.read_bytes()))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:data=list(pool.map(tile,tiles))
    lands=[]
    for (x,y),layers in data:
        for kind in ['earth','roads','landuse']:
            layer=layers.get(kind,{});ex=layer.get('extent',4096)
            def proj(xx,yy,zz=None):
                lon=(x+xx/ex)/n*360-180;lat=math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+1-yy/ex)/n))));return project(lon,lat)
            for i,f in enumerate(layer.get('features',[])):
                g=transform(proj,shape(f['geometry'])).intersection(extent)
                if g.is_empty:continue
                if kind=='earth':lands.append(g);continue
                props=f['properties'];tag=props.get('kind_detail') if kind=='roads' else props.get('kind')
                if kind=='roads' and tag not in ['primary','secondary','tertiary','motorway','trunk']:continue
                if kind=='landuse' and tag not in ['residential','commercial','industrial','retail']:continue
                g=g.difference(core).simplify(.6)
                for j,part in enumerate(g.geoms if hasattr(g,'geoms') else [g]):
                    if not isinstance(part,(Polygon,LineString)) or part.is_empty:continue
                    pts=list(part.exterior.coords) if isinstance(part,Polygon) else list(part.coords)
                    tags={'highway' if kind=='roads' else 'landuse':tag}
                    elements.append({'id':f'proto-{kind}-{x}-{y}-{i}-{j}','t':tags,'p':[[round(a,2),round(b,2)] for a,b in pts]})
    land=unary_union(lands).simplify(.35)
    polygons=[[[[round(x,2),round(y,2)] for x,y in ring.coords] for ring in [p.exterior,*p.interiors]] for p in (land.geoms if hasattr(land,'geoms') else [land]) if isinstance(p,Polygon)]
    print('Vector extension',len(tiles),'tiles;',len(elements),'elements',flush=True)
    return elements,polygons
