"""Select all 512 m cells meeting the full Riviera route + 768 m safety/scenery envelope.

Run from any directory; no raw downloads or hand-pasted road geometry.
The inherited basin and new cells feed one global profile/structure solve.
"""
import argparse,hashlib,json,math
from pathlib import Path
from shapely.geometry import LineString,box
import areas
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--rebuild',type=Path,help='also write the required shared-boundary rebuild JSON and .env cell list');args=parser.parse_args()
root=Path(__file__).resolve().parents[2];source=root/'data/map.json'
data=json.loads(source.read_text());p=data['proj'];r=data['route']
points=[((p['lon0']+x/p['mlon']-23.73)*87745.27512677578,(37.98-p['lat0']+z/p['mlat'])*111320) for x,z in zip(r['x'],r['z'])]
mask=LineString(points).buffer(768);base=areas.load('east');existing=set(base['cells']);x,z,xx,zz=mask.bounds
cells=[(cx,cz) for cx in range(math.floor(x/512),math.floor(xx/512)+1) for cz in range(math.floor(z/512),math.floor(zz/512)+1) if box(cx*512,cz*512,cx*512+512,cz*512+512).intersects(mask) and (cx,cz) not in existing]
spec=dict(name='riviera',world=base['world'],extends=['east'],cells=cells,spawn=base['spawn'],sources={**base['sources'],**{k:f'{k}-riviera.sqlite' for k in ['profiles','graph','turns','sections']}},selection=dict(source='data/map.json',sha256=hashlib.sha256(source.read_bytes()).hexdigest(),routeSamples=len(points),safetySceneryMetres=768,method='All cells intersecting the transformed full reference polyline buffered by 768 m; complete source roads are retained in the union profile solve with a further 512 m source halo.'))
(areas.AREAS/'riviera.json').write_text(json.dumps(spec,indent=2)+'\n')
if args.rebuild:
 union=existing|set(cells);changed=set(areas.load('coast')['cells'])|set(cells)
 halo={(x+dx,z+dz) for x,z in changed for dx in (-1,0,1) for dz in (-1,0,1)}&union
 ordered=[c for c in areas.load('riviera')['cells'] if c in halo]
 args.rebuild.write_text(json.dumps(ordered)+'\n');args.rebuild.with_suffix('.env').write_text(';'.join(','.join(map(str,c)) for c in ordered)+'\n')
print(json.dumps(dict(added=len(cells),total=len(existing)+len(cells))))
