#!/usr/bin/env python3
"""Extract mapped sidewalks and pedestrian crossings from the reduced OSM extract.

Roads come from ingest.py; footways are not roads, so they are read here, once, into a
small spatially indexed SQLite that build-sections.py snaps onto streets. Nothing is
downloaded and nothing from this file is shipped: only the derived road sections are.
Tables: ways(id, kind[sidewalk|crossing], tags, geometry) and nodes(id, tags, x, z), both
with an rtree. Coordinates use the AWT/1 projection (model.project).
"""
import argparse, hashlib, json, os, sqlite3, time
from pathlib import Path
import osmium
from shapely.geometry import LineString
from model import project, VERSION
from ingest import encode, sha


def build(pbf, output, bounds):
    started = time.monotonic(); output = Path(output)
    fingerprint = dict(pbfSha256=sha(pbf), generator=VERSION, bounds=bounds, codeSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    if output.exists():
        db = sqlite3.connect(f'file:{output}?mode=ro', uri=True)
        meta = json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]); db.close()
        if meta['inputs'] != fingerprint or output.with_suffix('.sha256').read_text().strip() != sha(output):
            raise ValueError('Sidewalk cache input differs: use a new output path')
        return meta
    temporary = output.with_suffix('.partial.sqlite')
    if temporary.exists():
        raise ValueError(f'Inspect/remove {temporary} before retrying')
    db = sqlite3.connect(temporary)
    db.executescript('''PRAGMA cache_size=-16384;
      CREATE TABLE metadata(value TEXT);
      CREATE TABLE ways(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, kind TEXT, tags TEXT, geometry BLOB);
      CREATE VIRTUAL TABLE way_index USING rtree(rowid,minx,maxx,minz,maxz);
      CREATE TABLE nodes(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, tags TEXT, x REAL, z REAL);
      CREATE VIRTUAL TABLE node_index USING rtree(rowid,minx,maxx,minz,maxz);''')
    west, south, east, north = bounds
    counts = {'sidewalk': 0, 'crossing': 0, 'crossingNode': 0}

    class Handler(osmium.SimpleHandler):
        def node(self, node):
            tags = dict(node.tags)
            if tags.get('highway') == 'crossing' and west <= node.lon <= east and south <= node.lat <= north:
                x, z = project(node.lon, node.lat)
                row = db.execute('INSERT INTO nodes(id,tags,x,z) VALUES(?,?,?,?)', ('n%d' % node.id, encode(tags), x, z)).lastrowid
                db.execute('INSERT INTO node_index VALUES(?,?,?,?,?)', (row, x, x, z, z)); counts['crossingNode'] += 1

        def way(self, way):
            tags = dict(way.tags)
            if tags.get('highway') not in ('footway', 'path', 'pedestrian', 'cycleway'):
                return
            kind = {'sidewalk': 'sidewalk', 'crossing': 'crossing'}.get(tags.get('footway'))
            if kind is None and tags.get('highway') == 'footway' and tags.get('footway') is None and tags.get('sidewalk'):
                kind = 'sidewalk'
            if kind is None:
                return
            try:
                points = [project(n.lon, n.lat) for n in way.nodes]
            except osmium.InvalidLocationError:
                return
            if len(points) < 2 or not any(west <= n.lon <= east and south <= n.lat <= north for n in way.nodes):
                return
            line = LineString(points)
            row = db.execute('INSERT INTO ways(id,kind,tags,geometry) VALUES(?,?,?,?)', ('w%d' % way.id, kind, encode(tags), line.wkb)).lastrowid
            x, z, xx, zz = line.bounds
            db.execute('INSERT INTO way_index VALUES(?,?,?,?,?)', (row, x, xx, z, zz)); counts[kind] += 1

    index = str(output.with_suffix('.locations.idx'))
    try:
        Handler().apply_file(str(pbf), locations=True, idx='sparse_file_array,' + index)
    finally:
        if os.path.exists(index):
            os.unlink(index)
    meta = dict(inputs=fingerprint, counts=counts, attribution='© OpenStreetMap contributors (ODbL 1.0)')
    db.execute('INSERT INTO metadata VALUES(?)', (encode(meta),)); db.commit(); db.close()
    os.replace(temporary, output)
    output.with_suffix('.sha256').write_text(sha(output) + '\n')
    output.with_suffix('.metrics.json').write_text(encode(dict(seconds=round(time.monotonic() - started, 2), bytes=output.stat().st_size)) + '\n')
    return meta


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--bounds', nargs=4, type=float, default=[22.8, 37.4, 24.7, 38.6], metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    args = parser.parse_args(); print(encode(build(args.pbf, args.output, args.bounds)))
