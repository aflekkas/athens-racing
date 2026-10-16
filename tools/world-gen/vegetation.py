#!/usr/bin/env python3
"""Optional OSM vegetation provenance. Data only; never enables tree rendering.

Explicit trees, sampled tree rows, and park placement candidates stay distinct.
Park samples are not claims of surveyed trees and must undergo road/building
exclusion and the owner's appearance decision before any renderer uses them.
"""
import argparse,hashlib,json,math,os,sqlite3,time
from pathlib import Path
import osmium
from shapely.geometry import shape,Point,LineString
from shapely.ops import transform
from shapely import prepare
from model import project,PROJECTION
from ingest import sha,encode


def candidates(geometry,spacing=20):
    """World-aligned park candidates; preserve holes and concave boundaries."""
    prepare(geometry);a,b,c,d=geometry.bounds
    for iz in range(math.ceil(b/spacing),math.floor(d/spacing)+1):
        for ix in range(math.ceil(a/spacing),math.floor(c/spacing)+1):
            x,z=ix*spacing,iz*spacing
            if geometry.contains(Point(x,z)):yield x,z


def extract(pbf,output):
    pbf,output=Path(pbf),Path(output);started=time.monotonic()
    fingerprint={'pbfSha256':sha(pbf),'codeSha256':sha(Path(__file__)),'projection':PROJECTION}
    if output.exists():
        db=sqlite3.connect(f'file:{output}?mode=ro',uri=True);result=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]);db.close()
        if result['inputs']!=fingerprint or output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Vegetation cache mismatch')
        return result
    tmp=output.with_suffix('.partial.sqlite');index=output.with_suffix('.locations.idx')
    if tmp.exists() or index.exists():raise ValueError('Inspect incomplete vegetation cache before retrying')
    db=sqlite3.connect(tmp);db.executescript('PRAGMA cache_size=-16384; CREATE TABLE points(id TEXT PRIMARY KEY,source TEXT,kind TEXT,x REAL,z REAL,seed INTEGER,tags TEXT); CREATE INDEX source ON points(source); CREATE TABLE areas(id TEXT PRIMARY KEY,geometry BLOB,tags TEXT); CREATE TABLE metadata(value TEXT);')
    counts={'tree':0,'tree_row':0,'park_candidate':0,'park_areas':0};errors={};factory=osmium.geom.GeoJSONFactory()
    def error(reason):errors[reason]=errors.get(reason,0)+1
    def point(identifier,source,kind,x,z,tags):
        seed=int.from_bytes(hashlib.sha256(identifier.encode()).digest()[:4],'little')
        db.execute('INSERT INTO points VALUES(?,?,?,?,?,?,?)',(identifier,source,kind,round(x,3),round(z,3),seed,encode(tags)));counts[kind]+=1
    class Handler(osmium.SimpleHandler):
        def node(self,node):
            if node.tags.get('natural')=='tree':
                x,z=project(node.lon,node.lat);key='osm:node:'+str(node.id);point(key,key,'tree',x,z,dict(node.tags))
        def way(self,way):
            if way.tags.get('natural')!='tree_row':return
            key='osm:way:'+str(way.id);tags=dict(way.tags)
            try:line=LineString([project(n.lon,n.lat) for n in way.nodes])
            except (osmium.InvalidLocationError,ValueError):error('invalidTreeRow');return
            # Samples carry inferred provenance; no fake OSM node IDs.
            n=max(1,math.ceil(line.length/10))
            for i in range(n+1):
                p=line.interpolate(line.length*i/n);point(key+':row:'+str(i),key,'tree_row',p.x,p.y,tags)
        def area(self,area):
            if area.tags.get('leisure')!='park':return
            tags=dict(area.tags);key='osm:'+('way:' if area.from_way() else 'relation:')+str(area.orig_id())
            try:g=transform(lambda x,y,z=None:project(x,y),shape(json.loads(factory.create_multipolygon(area))))
            except (RuntimeError,ValueError):error('invalidPark');return
            if not g.is_valid or g.is_empty:error('invalidPark');return
            db.execute('INSERT INTO areas VALUES(?,?,?)',(key,g.wkb,encode(tags)));counts['park_areas']+=1
            for x,z in candidates(g):point(f'{key}:candidate:{int(x)}:{int(z)}',key,'park_candidate',x,z,tags)
    try:Handler().apply_file(str(pbf),locations=True,idx='sparse_file_array,'+str(index))
    finally:index.unlink(missing_ok=True)
    # A park relation and a tagged member can overlap. Keep source provenance,
    # but runtime placement must deduplicate coordinates after exclusion.
    result={'inputs':fingerprint,'counts':counts,'errors':errors,'renderEnabled':False,'placementValidated':False}
    db.execute('INSERT INTO metadata VALUES(?)',(encode(result),));db.commit();db.close();tmp.replace(output)
    output.with_suffix('.sha256').write_text(sha(output)+'\n');output.with_suffix('.metrics.json').write_text(encode(dict(result,seconds=time.monotonic()-started,bytes=output.stat().st_size))+'\n')
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('pbf');parser.add_argument('output');args=parser.parse_args();print(encode(extract(args.pbf,args.output)))
