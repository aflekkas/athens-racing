#!/usr/bin/env python3
"""Prepare and emit a bounded genuine OSM/DEM extension, without publishing.

The cells file is explicit. This never manufactures links to a prior world:
outer seams, shared portal identities and directed reachability are separate
mandatory assembly gates. Source/cell/DEM/code hashes identify every output.
"""
import argparse
import contextlib
import hashlib
import json
import math
from pathlib import Path
import shutil
import sqlite3
import sys
import time


def prepare(cache, source, dems, bounds, cells):
    from ingest import ingest, sha
    from clean import clean
    from profiles import build as profiles
    from graph import build as graph
    from turns import build as turns
    from sidewalks import build as sidewalks
    from sections import build as sections
    from vegetation import extract as vegetation
    from details import build as details
    from street_nodes import extract as street_nodes
    record=json.loads(source.with_suffix('.source.json').read_text())
    if record['sha256']!=sha(source) or record.get('missingWayNodes') or not record.get('restrictionClosureComplete'):
        raise ValueError('Bounded source closure/integrity not accepted')
    paths={key:cache/(key+'.sqlite') for key in ('source','clean','profiles','graph','turns','sidewalks','sections','vegetation','details','street-nodes')}
    ingest(source,paths['source'],bounds)
    clean(paths['source'],paths['clean'])
    profiles(paths['clean'],paths['profiles'],'b_basin',dems,cells)
    graph(paths['profiles'],paths['graph'])
    turns(paths['source'],paths['graph'],paths['turns'])
    sidewalks(source,paths['sidewalks'],bounds)
    sections(paths['profiles'],paths['source'],paths['sidewalks'],paths['sections'])
    vegetation(source,paths['vegetation'])
    details(paths['source'],paths['clean'],paths['details'])
    street_nodes([source],paths['street-nodes'])
    return paths


def structure_plan(paths,dems,cells):
    import areas
    import tiles
    from tiles import Field
    from shapely.geometry import mapping
    extent=areas.extent(cells);a,b,c,d=extent.bounds
    raw=sqlite3.connect(f'file:{paths["source"]}?mode=ro',uri=True)
    tags={i:json.loads(t).get('bridge') for i,t in raw.execute("SELECT id,tags FROM features WHERE kind='road'")};raw.close()
    excluded={};history=[]
    for iteration in range(1,10):
        db=sqlite3.connect(f'file:{paths["profiles"]}?mode=ro',uri=True);source=sqlite3.connect(f'file:{paths["clean"]}?mode=ro',uri=True);sections=sqlite3.connect(f'file:{paths["sections"]}?mode=ro',uri=True)
        f=Field(db,source,(0,0),dems,True,tags,sections,extent,strict=False,bounds=(a-512,b-512,c+512,d+512))
        failed=list(f.structures.failed)
        for group in f.structures.groups:
            centre,samples=f.clearance(group);least=min([centre,*samples])
            if least<4.5:failed.append(dict(id=group['id'],upper=sorted(r['id'] for r in group['roads']),reason='underpass clearance %.2f m'%least))
        history.append(dict(iteration=iteration,groups=len(f.structures.groups),failed=len(failed)))
        groups=[dict(id=g['id'],bridgeSources=g['bridgeSources'],upper=sorted(r['id'] for r in g['roads']),lower=sorted(r['id'] for r in g['lower']),centre=list(g['centre']),axis=list(g['axis']),acrossEnd=g['acrossEnd'],upperNodes=sorted({n for r in g['roads'] for n in (r['fromNode'],r['toNode'])}),platform=mapping(g['platform'])) for g in sorted(f.structures.groups,key=lambda g:g['id'])]
        unresolved=sorted(f.structures.unresolved);dropped=dict(f.structures.dropped)
        f.dem.close();db.close();source.close();sections.close()
        if not failed:break
        for group in sorted(failed,key=lambda g:g['id']):
            for road in group['upper']:
                reason='deck group '+group['id']+' cannot be lifted safely: '+group['reason'];excluded[road]=reason;tiles.EXCLUDED.add(road);tiles.EXCLUSION_REASONS[road]=reason
    else:raise ValueError('Structure plan did not converge')
    excluded.update(dropped)
    return dict(groups=groups,unresolved=unresolved,excluded=dict(sorted(excluded.items())),report=dict(rounds=history)),extent


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--dem',type=Path,action='append',required=True);parser.add_argument('--bounds',nargs=4,type=float,required=True);parser.add_argument('--cells',type=Path,required=True);parser.add_argument('--world',default='athens-ekali-development');parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    cells=json.loads(args.cells.read_text());cells=cells.get('cells') if isinstance(cells,dict) else cells
    if not cells or len(cells)>64 or len({tuple(c) for c in cells})!=len(cells) or any(len(c)!=2 or any(type(n)!=int for n in c) for c in cells):raise ValueError('Expected unique bounded explicit cell set (max64)')
    from ingest import sha,encode
    with contextlib.redirect_stdout(sys.stderr):
        paths=prepare(args.cache,args.source,args.dem,args.bounds,cells)
        plan,extent=structure_plan(paths,args.dem,cells)
    inputs=dict(source=sha(args.source),sourceRecord=sha(args.source.with_suffix('.source.json')),dem=[dict(path=p.name,sha256=sha(p)) for p in args.dem],cells=cells,world=args.world,code={p.name:sha(p) for p in sorted(Path(__file__).parent.glob('*.py'))},caches={k:sha(v) for k,v in paths.items()},structurePlan=plan)
    revision=hashlib.sha256(encode(inputs).encode()).hexdigest();record=dict(revision=revision,inputs=inputs,acceptance=False)
    (args.cache/'extension-inputs.json').write_text(json.dumps(record,indent=2)+'\n');(args.cache/'extension-structures.json').write_text(json.dumps(plan,indent=2)+'\n')
    if args.prepare_only:return
    from tiles import bake
    for cell in cells:
        usage=shutil.disk_usage('/')
        if usage.used/(usage.used+usage.free)>=.83:raise ValueError('Shared disk hard stop at83%')
        started=time.monotonic()
        tile,audit=bake(paths['profiles'],paths['clean'],paths['graph'],paths['turns'],tuple(cell),args.dem,args.world,revision,True,paths['vegetation'],paths['source'],paths['sections'],extent,plan,paths['details'],paths['street-nodes'])
        print(encode(tile),flush=True)
        print(encode(dict(cell=cell,seconds=time.monotonic()-started,**audit)),file=sys.stderr,flush=True)


if __name__=='__main__':main()
