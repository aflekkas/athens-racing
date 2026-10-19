"""Streamed Athens areas: which 512 m cells one bake covers, and which cache files feed it.

An area file under `areas/` lists `cells` (or the selector's `land` + `sea`), may `extends` earlier areas
(the union is baked as ONE world so every border is shared and checked), and names the source databases
for the bake. Every cell of an area is a playable contact cell: buildings are clipped to the cells they
cover, so no cell depends on a neighbour to be safe to drive on.
"""
import json
from pathlib import Path
from shapely.geometry import box
from shapely.ops import unary_union
from shapely import prepare

AREAS=Path(__file__).parent/'areas'
SOURCES=dict(profiles='profiles-a.sqlite',source='clean.sqlite',graph='graph-a.sqlite',turns='turns-a.sqlite',vegetation='vegetation.sqlite',osm='source.sqlite',sections='sections-a.sqlite')


def load(name,_seen=()):
    if name in _seen:raise ValueError('Area cycle '+name)
    spec=json.loads((AREAS/f'{name}.json').read_text())
    cells=[];seen=set()
    def add(items):
        for c in items:
            c=tuple(c)
            if c not in seen:seen.add(c);cells.append(c)
    for parent in spec.get('extends',[]):add(load(parent,_seen+(name,))['cells'])
    add(spec.get('cells') or [*spec.get('land',[]),*spec.get('sea',[])])
    return dict(name=name,world=spec.get('world') or f'athens-{name}-development',cells=cells,spawn=spec.get('spawn'),sources={**SOURCES,**spec.get('sources',{})},
                parents=spec.get('extends',[]),spec=spec)


def extent(cells):
    """Union of the cell squares: the finite boundary of the playable world (structures are resolved inside it)."""
    shape=unary_union([box(x*512,z*512,x*512+512,z*512+512) for x,z in cells]);prepare(shape);return shape


if __name__=='__main__':
    import sys
    a=load(sys.argv[1]);print(json.dumps(dict(name=a['name'],world=a['world'],cells=a['cells'],spawn=a['spawn'])))
