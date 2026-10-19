"""Pick the cells of an inland area from named district boxes (lon/lat), deterministically.

The coast-distance selector (select-area.py) cannot describe Athens' inland districts. This one takes district
bounding boxes, keeps the 512 m cells that hold roads or buildings and drops cells that already belong to the
areas it extends. Output is an area file: `land` (the new cells), `extends`, `world`, `sources`, and the
districts it was built from, so the selection can be reproduced and audited.

  select-region.py CACHE OUTPUT.json --extends piraeus-faliro --world athens-centre-development \
      --district name=W,S,E,N [--district ...] [--suffix ac]
"""
import argparse,collections,json,math,sqlite3
from pathlib import Path
import areas as A

MLON,MLAT=87745.27512677578,111320
p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('output',type=Path)
p.add_argument('--extends',action='append',default=[]);p.add_argument('--world',required=True);p.add_argument('--suffix',default='ac')
p.add_argument('--district',action='append',required=True,help='name=west,south,east,north (degrees)');a=p.parse_args()
districts={}
for d in a.district:
    name,box_=d.split('=');districts[name]=[float(v) for v in box_.split(',')]
existing={tuple(c) for parent in a.extends for c in A.load(parent)['cells']}
wanted={}
for name,(w,s,e,n) in districts.items():
    x0,z0=(w-23.73)*MLON,-(n-37.98)*MLAT;x1,z1=(e-23.73)*MLON,-(s-37.98)*MLAT
    for x in range(math.floor(x0/512),math.floor(x1/512)+1):
        for z in range(math.floor(z0/512),math.floor(z1/512)+1):wanted.setdefault((x,z),name)
xs=[c[0] for c in wanted];zs=[c[1] for c in wanted]
db=sqlite3.connect(f'file:{a.cache/"clean.sqlite"}?mode=ro',uri=True);content=collections.Counter();roads=collections.Counter();buildings=collections.Counter()
for kind,mnx,mxx,mnz,mxz in db.execute("select o.kind,s.minx,s.maxx,s.minz,s.maxz from objects o join spatial s on o.rowid=s.rowid where o.kind in ('road','building') and s.maxx>? and s.minx<? and s.maxz>? and s.minz<?",((min(xs)-1)*512,(max(xs)+2)*512,(min(zs)-1)*512,(max(zs)+2)*512)):
    c=(math.floor((mnx+mxx)/1024),math.floor((mnz+mxz)/1024));(roads if kind=='road' else buildings)[c]+=1
land=sorted(c for c in wanted if c not in existing and (roads[c] or buildings[c]))
out=dict(name=a.output.stem,world=a.world,extends=a.extends,spawn=next((A.load(parent)['spawn'] for parent in a.extends if A.load(parent)['spawn']),None),land=[list(c) for c in land],sea=[],districts=districts,districtOf={f'{x},{z}':wanted[(x,z)] for x,z in land},
    buildings=sum(buildings[c] for c in land),roads=sum(roads[c] for c in land),sources={k:f'{v.split("-")[0]}-{a.suffix}.sqlite' for k,v in dict(profiles='profiles-a.sqlite',graph='graph-a.sqlite',turns='turns-a.sqlite',sections='sections-a.sqlite').items()})
a.output.write_text(json.dumps(out)+'\n');print(json.dumps({k:(v if not isinstance(v,(list,dict)) else len(v)) for k,v in out.items()}))
