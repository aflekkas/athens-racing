#!/usr/bin/env python3
"""Normalize sources into a bounded-memory intermediate SQLite/NDJSON database.

This is deliberately separate from the streaming wire format. Nothing is loaded
by the game until the tile packer, conformance validator and runtime are ready.
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import resource
import time
from shapely import from_wkb
from shapely.geometry import Polygon, Point, box, mapping
from shapely.ops import polygonize, unary_union
from model import PROJECTION, project, road_tags
from buildings import building_parts, palette_index
from appearance import BUILDINGS, TERRAIN
from ingest import encode, sha

A=[[23.665,37.950],[23.760,37.955],[23.800,37.915],[23.845,37.865],[23.900,37.840],[23.900,37.775],[23.750,37.775],[23.680,37.880]]
B=[[23.665,37.935],[23.716,37.920],[23.758,37.889],[23.801,37.929],[23.819,37.973],[23.844,38.012],[23.864,38.053],[23.823,38.082],[23.750,38.080],[23.694,38.060],[23.669,38.010]]


def query(db,geometry,kind):
    x,z,xx,zz=geometry.bounds
    return db.execute('SELECT f.id,f.tags,f.geometry,f.refs FROM spatial s CROSS JOIN features f ON f.rowid=s.rowid WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? AND f.kind=? ORDER BY f.id', (xx,x,zz,z,kind))


def masks(db):
    south=Polygon([project(*p) for p in A]);basin=Polygon([project(*p) for p in B])
    boundary=db.execute("SELECT geometry FROM features WHERE id='r957716'").fetchone()
    source=json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    west,southlat,east,north=source['inputs']['bounds']
    envelope=box(*project(west,north),*project(east,southlat))
    coastline=[from_wkb(row[0]).intersection(envelope) for row in db.execute("SELECT geometry FROM features WHERE kind='coast'")]
    mainland=None
    if boundary and coastline:
        pieces=list(polygonize(unary_union([envelope.boundary,*coastline])))
        athens=Point(project(23.73,37.98))
        candidates=[p for p in pieces if p.covers(athens)]
        # A coastline that does not partition the bbox cannot establish mainland.
        if len(candidates)==1 and len(pieces)>1 and candidates[0].area<envelope.area*.95:
            mainland=candidates[0].intersection(from_wkb(boundary[0]))
    return {'a_south':south,'b_basin':south.union(basin),'c_attica_mainland':mainland}


def public_direction(tags,direction):
    # Mode specificity wins; direction-specific values override that mode's base.
    for mode in ('motorcar','motor_vehicle','vehicle','access'):
        for key in (mode+':'+direction,mode):
            if key in tags:return tags[key] in ('yes','permissive','designated')
    return True


def road_parts(db,identifier,tags,geometry,refs):
    normalized=road_tags(tags)
    if normalized is None:return
    points=list(geometry.coords);keep=[0]
    # Drop exact duplicate consecutive nodes, preserving OSM connectivity at all junctions.
    for i in range(1,len(refs)):
        if refs[i]!=refs[keep[-1]] and points[i]!=points[keep[-1]]:keep.append(i)
    if len(keep)<2:return
    cuts=[0]
    for j,i in enumerate(keep[1:-1],1):
        uses=db.execute('SELECT uses FROM node_use WHERE id=?',(refs[i],)).fetchone()
        if uses and uses[0]>1:cuts.append(j)
    cuts.append(len(keep)-1)
    for a,b in zip(cuts,cuts[1:]):
        selected=keep[a:b+1];ps=[points[i] for i in selected]
        length=sum(math.dist(p,q) for p,q in zip(ps,ps[1:]))
        if length<.01:continue
        start,end=refs[selected[0]],refs[selected[-1]]
        forward=normalized['oneway']!=-1;backward=normalized['oneway']!=1
        node_rules={str(refs[i]):json.loads(row[0]) for i in selected if (row:=db.execute('SELECT tags FROM node_rules WHERE id=?',(refs[i],)).fetchone())}
        part=dict(id=f'{identifier}:{selected[0]}',way=identifier,fromNode=str(start),toNode=str(end),
                  nodeRefs=[str(refs[i]) for i in selected],points=[[round(x,3),round(z,3)] for x,z in ps],
                  length=round(length,3),forward=forward,backward=backward,nodeRules=node_rules,**normalized)
        part['publicForward']=forward and not normalized['review'] and public_direction(tags,'forward')
        part['publicBackward']=backward and not normalized['review'] and public_direction(tags,'backward')
        part['public']=part['publicForward'] or part['publicBackward']
        part['directionalTags']={k:v for k,v in tags.items() if k.endswith((':forward',':backward'))}
        if node_rules:
            part['public']=part['publicForward']=part['publicBackward']=False;part['review']=True
        # Rendering may use restricted roads, but spawn/tow/routing must test public.
        yield part


def clean(source,output):
    start=time.monotonic();output=Path(output)
    code=b''.join(Path(__file__).with_name(n).read_bytes() for n in ('clean.py','model.py','buildings.py','appearance.py'))
    inputs=dict(sourceSha256=sha(source),codeSha256=hashlib.sha256(code).hexdigest(),schema='athens-source-1')
    if output.exists():
        if output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Corrupt clean cache')
        with sqlite3.connect(output) as cached:
            result=json.loads(cached.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
        if result['inputs']!=inputs:raise ValueError('Clean cache input mismatch: choose a new output path')
        print(encode(dict(cached=True,**result)),flush=True);return result
    db=sqlite3.connect(f'file:{source}?mode=ro',uri=True);db.execute('PRAGMA cache_size=-32768')
    temporary=output.with_suffix('.partial.sqlite')
    if temporary.exists():raise ValueError('Inspect/remove partial clean database before retrying')
    out=sqlite3.connect(temporary)
    out.executescript('''PRAGMA cache_size=-32768; PRAGMA temp_store=FILE;
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE objects(rowid INTEGER PRIMARY KEY,id TEXT UNIQUE,kind TEXT,data TEXT);
      CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);
      CREATE TABLE rejected(id TEXT PRIMARY KEY,reason TEXT,x REAL,z REAL);
    ''')
    counts=collections.Counter();rejected=collections.Counter()
    def add(identifier,kind,data,bounds):
        c=out.execute('INSERT INTO objects(id,kind,data) VALUES(?,?,?)',(identifier,kind,encode(data)))
        x,z,xx,zz=bounds;out.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(c.lastrowid,x,xx,z,zz));counts[kind]+=1
    for identifier,kind,tags,wkb,refs in db.execute('SELECT id,kind,tags,geometry,refs FROM features ORDER BY rowid'):
        tags=json.loads(tags);geometry=from_wkb(wkb)
        if kind=='road':
            for part in road_parts(db,identifier,tags,geometry,json.loads(refs)):
                ps=part['points'];xs=[p[0] for p in ps];zs=[p[1] for p in ps]
                add(part['id'],'road',part,(min(xs),min(zs),max(xs),max(zs)))
        elif kind=='building':
            # Multipolygon components are one building entity, so the cap applies to their total.
            center=geometry.centroid;landuses=[]
            for lid,lt,lw,_ in query(db,center,'landuse'):
                land=from_wkb(lw)
                if land.covers(center):landuses.append((land.area,lid,json.loads(lt)['landuse']))
            landuse=min(landuses)[2] if landuses else ''
            meshes=building_parts(identifier,geometry,tags,landuse)
            if meshes is None:
                reason='footprint-invalid-holes-or-budget';rejected[reason]+=1
                out.execute('INSERT INTO rejected VALUES(?,?,?,?)',(identifier,reason,center.x,center.y));continue
            for mesh in meshes:mesh['palette']=palette_index(identifier)
            add(identifier,'building',dict(id=identifier,centroid=[center.x,center.y],parts=meshes,triangles=sum(m['triangles'] for m in meshes),awtTriangles=sum(m['triangles'] for m in meshes)),geometry.bounds)
        elif kind in ('coast','water','landuse','landcover'):
            # A closed coastline way may also carry landuse: preserve both roles.
            role_id=f'{kind}:{identifier}'
            add(role_id,kind,dict(id=role_id,sourceId=identifier,geometry=mapping(geometry),tags=tags),geometry.bounds)
        if sum(counts.values())%10000==0:out.commit()
    for identifier,tags,members in db.execute('SELECT id,tags,members FROM restrictions ORDER BY id'):
        # Restriction consumers must support via-way/conditional forms before public activation.
        out.execute('INSERT INTO objects(id,kind,data) VALUES(?,?,?)',('r'+str(identifier),'restriction',encode(dict(id=str(identifier),tags=json.loads(tags),members=json.loads(members)))))
        counts['restriction']+=1
    region_masks={k:mapping(v) if v else None for k,v in masks(db).items()}
    source_manifest=json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    result=dict(inputs=inputs,projection=PROJECTION,buildingPalette=BUILDINGS,terrainPalette=TERRAIN,counts=counts,rejected=rejected,
                sourceWarnings=dict(errors=source_manifest['errors'],extraction=source_manifest.get('sourceExtraction')),
                masks=region_masks,
                releaseReady=False,blockers=['tile packing and validation pending','ground/structure height solve pending',*(['mainland coastline mask pending'] if region_masks['c_attica_mainland'] is None else []),'routing restriction evaluation pending'])
    out.execute('INSERT INTO metadata VALUES(?,?)',('manifest',encode(result)));out.commit();out.close();db.close()
    os.replace(temporary,output)
    metrics=dict(generationSeconds=round(time.monotonic()-start,3),databaseBytes=output.stat().st_size,peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
    output.with_suffix('.sha256').write_text(sha(output)+'\n')
    output.with_suffix('.metrics.json').write_text(encode(metrics)+'\n')
    print(encode(dict(**result,**metrics)),flush=True);return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();clean(args.source,args.output)
