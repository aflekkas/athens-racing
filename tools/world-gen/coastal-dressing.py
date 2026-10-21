#!/usr/bin/env python3
"""Export cell-owned OSM scenery recipes for the existing shared dressing worker.

Usage: coastal-dressing.py CACHE AREA OUTPUT.js --bounds x0,z0,x1,z1
No road, contact, building or terrain geometry is replaced. Woods/scrub use the
normal world-aligned vegetation candidates; marinas/piers/lakes port nature.js's
recipes from actual OSM outlines, in the shared world projection. Bounds select
a source region, not a new playable extent. A later southern extension uses the
same exporter. Output is source recipes, never AWT cells.
"""
import argparse, json, math, sqlite3
from pathlib import Path
import osmium
from shapely.geometry import shape, Point, box, Polygon
from shapely.ops import transform
from shapely import constrained_delaunay_triangles
import areas
import infill
from model import project, PROJECTION
from ingest import sha
from details import fnv1a


def category(tags):
    if tags.get('natural') == 'wood' or tags.get('landuse') == 'forest': return 'wood'
    if tags.get('natural') in ('scrub', 'heath', 'grassland'): return 'scrub'
    if tags.get('leisure') in ('park', 'garden'): return 'park'
    if tags.get('leisure') == 'marina': return 'marina'
    if tags.get('man_made') in ('pier', 'breakwater'): return 'pier'
    if tags.get('natural') == 'water': return 'lake' if tags.get('water')=='lake' else 'water'
    if tags.get('natural') in ('beach','sand'):return 'sand'
    if tags.get('natural') in ('bare_rock','scree','shingle'):return 'rock'
    if tags.get('landuse')=='residential':return 'residential'
    if tags.get('leisure') in ('pitch','swimming_pool','playground') or tags.get('landuse') in ('commercial','retail','industrial','cemetery'):return 'developed'


def candidates(poly, kind):
    """World-grid hash jitter, stable across cell boundaries; inferred, not surveyed trees."""
    spacing = {'wood':18, 'scrub':14, 'park':22, 'marina':16}[kind]
    x0,z0,x1,z1=poly.bounds
    for iz in range(math.floor(z0/spacing), math.ceil(z1/spacing)):
        for ix in range(math.floor(x0/spacing), math.ceil(x1/spacing)):
            seed=fnv1a(f'coastal:{ix}:{iz}:{kind}')
            x=(ix+.2+(seed%600)/1000)*spacing;z=(iz+.2+((seed>>12)%600)/1000)*spacing
            if poly.contains(Point(x,z)): yield round(x,2),round(z,2),seed


def run(cache, area, output, bounds, infill_db=None):
    cells=set(map(tuple,areas.load(area)['cells'])); region=box(*bounds)
    records={}; factory=osmium.geom.GeoJSONFactory()
    class Collect(osmium.SimpleHandler):
        def area(self,a):
            tags=dict(a.tags);kind=category(tags)
            if not kind:return
            g=transform(lambda x,y,z=None:project(x,y),shape(json.loads(factory.create_multipolygon(a))))
            if g.is_empty or not g.is_valid or not g.intersects(region):return
            key=('w' if a.from_way() else 'r')+str(a.orig_id())
            records[key]=(kind,g.intersection(region),tags)
        def way(self,w):
            if w.is_closed() or category(dict(w.tags))!='pier':return
            from shapely.geometry import LineString
            g=LineString([project(n.lon,n.lat) for n in w.nodes]).buffer(1.6,cap_style='flat')
            if g.intersects(region):records['w'+str(w.id)]=('pier',g.intersection(region),dict(w.tags))
    Collect().apply_file(str(cache/'attica.osm.pbf'),locations=True)
    recipes={f'{x},{z}':{'trees':[],'boats':[],'surfaces':[],'cover':[]} for x,z in cells if box(x*512,z*512,(x+1)*512,(z+1)*512).intersection(region).area>0};sources={};counts={}
    for identifier,(kind,g,tags) in sorted(records.items()):
        sources[identifier]={'kind':kind,'name':tags.get('name','')};counts[kind]=counts.get(kind,0)+1
        x0,z0,x1,z1=g.bounds
        for cx in range(math.floor(x0/512),math.floor(x1/512)+1):
            for cz in range(math.floor(z0/512),math.floor(z1/512)+1):
                key=f'{cx},{cz}'
                if key not in recipes:continue
                clipped=g.intersection(box(cx*512,cz*512,(cx+1)*512,(cz+1)*512)).simplify(.75,preserve_topology=True)
                for poly in ([clipped] if clipped.geom_type=='Polygon' else getattr(clipped,'geoms',[])):
                    if poly.geom_type!='Polygon' or poly.area<1:continue
                    rings=[list(poly.exterior.coords)]+[list(r.coords) for r in poly.interiors]
                    recipes[key]['cover'].append([kind,identifier,[[[round(x-cx*512,2),round(z-cz*512,2)] for x,z in r] for r in rings]])
        if kind in ('wood','scrub','park'):continue # runtime candidates use all land, including untagged gaps
        if kind=='marina':

            for x,z,seed in candidates(g,kind):
                cell=(math.floor(x/512),math.floor(z/512))
                if cell not in cells:continue
                r=recipes.setdefault(','.join(map(str,cell)),{'trees':[],'boats':[],'surfaces':[]})
                if kind=='marina':r['boats'].append([round(x-cell[0]*512,2),round(z-cell[1]*512,2),round((math.pi/2 if g.bounds[2]-g.bounds[0]>g.bounds[3]-g.bounds[1] else 0),4),seed%2,identifier])
                else:r['trees'].append([round(x-cell[0]*512,2),round(z-cell[1]*512,2),4 if kind=='scrub' or seed%5==0 else 1,seed,identifier])
        elif kind in ('lake','pier'):
            x0,z0,x1,z1=g.bounds
            for cx in range(math.floor(x0/512),math.floor(x1/512)+1):
                for cz in range(math.floor(z0/512),math.floor(z1/512)+1):
                    if (cx,cz) not in cells:continue
                    clipped=g.intersection(box(cx*512,cz*512,(cx+1)*512,(cz+1)*512)).simplify(.3,preserve_topology=True)
                    if clipped.is_empty or clipped.area<1:continue
                    # Triangulate with holes intact; canonical cell clipping gives unique ownership.
                    triangles=[]
                    for t in constrained_delaunay_triangles(clipped).geoms:
                        p=list(t.exterior.coords)[:3]
                        if not clipped.covers(t.representative_point()):continue
                        if (p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])>0:p.reverse()
                        triangles.extend(round(v-origin,3) for point in p for v,origin in zip(point,(cx*512,cz*512)))
                    r=recipes.setdefault(f'{cx},{cz}',{'trees':[],'boats':[],'surfaces':[]})
                    r['surfaces'].append([kind,identifier,triangles])
    # Dedup overlapping relation/member vegetation and cap deterministically by hash (never by a north-to-south scan).
    for r in recipes.values():
        seen=set();trees=[]
        for row in sorted(r['trees'],key=lambda p:p[3]):
            k=(round(row[0]/4),round(row[1]/4))
            if k not in seen:trees.append(row);seen.add(k)
        r['trees']=trees[:512];r['boats']=r['boats'][:64]
    infill_meta=None
    if infill_db:
        db=sqlite3.connect(f'file:{infill_db}?mode=ro',uri=True)
        infill_meta=json.loads(db.execute("SELECT value FROM metadata WHERE key='infill'").fetchone()[0])
        kept=0
        for identifier,data in db.execute('SELECT id,data FROM objects ORDER BY id'):
            record=json.loads(data)
            for part in record['parts']:
                poly=Polygon(part['footprint']);cx=math.floor(poly.centroid.x/512);cz=math.floor(poly.centroid.y/512);key=f'{cx},{cz}'
                if key not in recipes or not box(cx*512+2,cz*512+2,(cx+1)*512-2,(cz+1)*512-2).contains(poly):continue
                ring=[[round(x-cx*512,2),round(z-cz*512,2)] for x,z in list(poly.exterior.coords)[:-1]]
                recipes[key].setdefault('infill',[]).append([identifier,record['storeys'],ring]);kept+=1
        infill_meta['cellOwnedLots']=kept;infill_meta['inferred']=True;infill_meta['basisCommit']='9c90acfb'
        db.close()
    report={'schema':1,'area':area,'bounds':bounds,'projection':PROJECTION,'osmSha256':sha(cache/'attica.osm.pbf'),'codeSha256':sha(Path(__file__)),'infill':infill_meta,'sourceCounts':counts,'sources':sources,'cells':recipes}
    output.write_text('// Generated by tools/world-gen/coastal-dressing.py; OSM contributors, ODbL.\n// Inferred placements from mapped areas; no road/contact geometry.\nexport const COASTAL_DRESSING='+json.dumps(report,separators=(',',':'),sort_keys=True)+';\n')
    print(json.dumps({'cells':len(recipes),'sources':counts,'trees':sum(len(r['trees']) for r in recipes.values()),'boats':sum(len(r['boats']) for r in recipes.values()),'bytes':output.stat().st_size}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('area');p.add_argument('output',type=Path);p.add_argument('--bounds',required=True);p.add_argument('--infill-db',type=Path);a=p.parse_args();run(a.cache,a.area,a.output,list(map(float,a.bounds.split(','))),a.infill_db)
