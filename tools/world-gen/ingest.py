#!/usr/bin/env python3
"""Stream a pinned OSM PBF into a disk-backed, spatially indexed source database."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import resource
import time
import osmium
from shapely.geometry import shape, LineString, box
from shapely.ops import transform
from model import PROJECTION, VERSION, project, road_tags


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def ingest(pbf, output, bounds):
    start = time.monotonic()
    fingerprint = dict(pbfSha256=sha(pbf), generator=VERSION, bounds=bounds,
                       codeSha256=hashlib.sha256((Path(__file__).read_bytes()+Path(__file__).with_name('model.py').read_bytes()+Path(__file__).with_name('appearance.py').read_bytes())).hexdigest())
    extraction=None
    source_record=Path(pbf).with_suffix('.source.json')
    if source_record.exists():
        record=json.loads(source_record.read_text())
        if record.get('sha256')!=fingerprint['pbfSha256']:raise ValueError('Extract provenance hash mismatch')
        extraction={key:record[key] for key in ('inputs','selected','requested','discarded') if key in record}
        fingerprint['extractionSha256']=hashlib.sha256(encode(extraction).encode()).hexdigest()
    output = Path(output)
    if output.exists():
        if output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Corrupt source cache')
        with sqlite3.connect(output) as cached:
            previous = json.loads(cached.execute("select value from metadata where key='manifest'").fetchone()[0])
        if previous['inputs'] != fingerprint:
            raise ValueError('Cache input differs: use a new output path; never overwrite a source cache')
        print(encode(dict(cached=True, **previous)), flush=True)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.partial.sqlite')
    if temporary.exists():
        raise ValueError(f'Incomplete prior build: inspect/remove {temporary} before retrying')
    db = sqlite3.connect(temporary)
    db.executescript('''
      PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768; PRAGMA temp_store=FILE;
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE features(rowid INTEGER PRIMARY KEY, id TEXT, kind TEXT, tags TEXT, geometry BLOB, refs TEXT, UNIQUE(id,kind));
      CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);
      CREATE TABLE memberships(way INTEGER PRIMARY KEY);
      CREATE TABLE building_relations(id INTEGER PRIMARY KEY);
      CREATE TABLE node_rules(id INTEGER PRIMARY KEY,tags TEXT);
      CREATE TABLE restrictions(id INTEGER PRIMARY KEY,tags TEXT,members TEXT);
      CREATE TABLE node_use(id INTEGER PRIMARY KEY,uses INTEGER NOT NULL);
    ''')
    counts = collections.Counter(); errors = collections.Counter()
    west,south,east,north = bounds
    region = box(*project(west,north),*project(east,south))
    factory = osmium.geom.GeoJSONFactory()

    def feature(identifier, kind, tags, geom, refs=None):
        if geom.is_empty or not geom.is_valid:
            errors['invalid:'+kind] += 1; return
        if not region.intersects(geom):
            return
        cursor = db.execute('INSERT INTO features(id,kind,tags,geometry,refs) VALUES(?,?,?,?,?)',
                            (identifier,kind,encode(tags),geom.wkb,encode(refs) if refs else None))
        x,z,xx,zz = geom.bounds
        db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)', (cursor.lastrowid,x,xx,z,zz))
        counts[kind] += 1
        if sum(counts.values()) % 10000 == 0:
            db.commit(); print(encode(dict(counts=counts, seconds=round(time.monotonic()-start,1))), flush=True)

    class Relations(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            if tags.get('type') == 'multipolygon' and tags.get('building') not in (None,'no'):
                db.execute('INSERT INTO building_relations VALUES(?)',(relation.id,))
                db.executemany('INSERT OR IGNORE INTO memberships VALUES(?)', ((m.ref,) for m in relation.members if m.type == 'w'))
            if tags.get('type') == 'restriction':
                db.execute('INSERT INTO restrictions VALUES(?,?,?)',
                           (relation.id,encode(tags),encode([(m.type,m.ref,m.role) for m in relation.members])))
    Relations().apply_file(str(pbf)); db.commit()

    class Features(osmium.SimpleHandler):
        def node(self,node):
            tags=dict(node.tags)
            if any(k in tags for k in ('barrier','access','motor_vehicle','motorcar')) and west<=node.lon<=east and south<=node.lat<=north:
                db.execute('INSERT INTO node_rules VALUES(?,?)',(node.id,encode(tags)))

        def way(self, way):
            tags = dict(way.tags)
            road = road_tags(tags)
            coast = tags.get('natural') == 'coastline'
            if road is None and not coast:
                return
            try:
                points = [project(n.lon,n.lat) for n in way.nodes]
            except osmium.InvalidLocationError:
                errors['invalidRoadLocations'] += 1; return
            if len(points) < 2:
                errors['shortRoad'] += 1; return
            line = LineString(points)
            if not region.intersects(line):
                return
            refs = [n.ref for n in way.nodes]
            if road:feature('w'+str(way.id),'road',tags,line,refs)
            if coast:feature('w'+str(way.id),'coast',tags,line,refs)
            if road:
                # Count membership, not repeated points in a roundabout.
                db.executemany('INSERT INTO node_use VALUES(?,1) ON CONFLICT(id) DO UPDATE SET uses=uses+1',
                               ((ref,) for ref in set(refs)))

        def area(self, area):
            tags = dict(area.tags)
            boundary = not area.from_way() and area.orig_id() == 957716
            building = tags.get('building') not in (None,'no')
            landuse = bool(tags.get('landuse'))
            landcover = tags.get('natural') in ('beach','sand','bare_rock','scree','shingle','scrub','heath','grassland','wood')
            water = tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank'
            if not (boundary or building or landuse or water or landcover):
                return
            if building and area.from_way() and db.execute('select 1 from memberships where way=?',(area.orig_id(),)).fetchone():
                return
            try:
                geom = transform(lambda x,y,z=None: project(x,y), shape(json.loads(factory.create_multipolygon(area))))
            except (RuntimeError, ValueError):
                errors['invalidArea'] += 1; return
            feature(('w' if area.from_way() else 'r')+str(area.orig_id()),
                    'boundary' if boundary else 'building' if building else 'water' if water else 'landuse' if landuse else 'landcover', tags, geom)

    # Disk-backed sparse index; never a country-sized Python node dictionary.
    index = str(output.with_suffix('.locations.idx'))
    try:
        Features().apply_file(str(pbf), locations=True, idx='sparse_file_array,'+index)
    finally:
        if os.path.exists(index):
            os.unlink(index)
    db.execute('CREATE INDEX feature_kind ON features(kind)')
    errors['unassembledOrOutsideBuildingRelations']=db.execute("SELECT count(*) FROM building_relations b WHERE NOT EXISTS(SELECT 1 FROM features f WHERE f.id='r'||b.id)").fetchone()[0]
    # Keep only relevant restrictions, while retaining via-way/conditional cases verbatim.
    db.execute("DELETE FROM restrictions WHERE NOT EXISTS (SELECT 1 FROM json_each(restrictions.members) m JOIN features f ON f.id='w'||json_extract(m.value,'$[1]') WHERE json_extract(m.value,'$[0]')='w')")
    manifest = dict(inputs=fingerprint, projection=PROJECTION, counts=counts, errors=errors,
                    sourceBytes=Path(pbf).stat().st_size,
                    attribution='© OpenStreetMap contributors (ODbL 1.0)', sourceExtraction=extraction,
                    restrictions=db.execute('SELECT count(*) FROM restrictions').fetchone()[0])
    db.execute('INSERT INTO metadata VALUES(?,?)', ('manifest',encode(manifest)))
    db.commit(); db.close(); os.replace(temporary,output)
    metrics=dict(generationSeconds=round(time.monotonic()-start,3), databaseBytes=output.stat().st_size,peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
    output.with_suffix('.sha256').write_text(sha(output)+'\n')
    output.with_suffix('.metrics.json').write_text(encode(metrics)+'\n')
    print(encode(dict(**manifest,**metrics)), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--bounds', nargs=4, type=float, default=[22.8,37.4,24.7,38.6], metavar=('WEST','SOUTH','EAST','NORTH'))
    args = parser.parse_args(); ingest(args.pbf,args.output,args.bounds)
