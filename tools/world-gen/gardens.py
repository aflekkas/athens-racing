#!/usr/bin/env python3
"""Gardens, lawns and flower beds as ground for the bake (beauty handover, step 5b).

ingest.py keeps only buildings, water, coast and areas with landuse or a natural landcover tag, so a polygon tagged
only leisure=garden, landscape=lawn or landuse=flowerbed never reached the cells, and the ground under it was drawn
as earth. This reads the Attica extract for those closed ways (and leisure=park, which appearance.py already
counts as grass) and writes them as `landcover` records with their tags into infill.sqlite. The bake's ground lookup
(tiles.py: the smallest land polygon around a point) then gives them the grass class (appearance.GRASS_LEISURE).

Multipolygon relations are not read here: most gardens and lawns in the extract are closed ways.

    python3 gardens.py ATTICA.osm.pbf INFILL.sqlite
"""
import json
import sqlite3
import sys
from pathlib import Path

import osmium
from shapely.geometry import Polygon, mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model import project  # noqa: E402  (the projection every cell uses)

GRASS_TAGS = {'leisure': ('garden', 'park'), 'landscape': ('lawn',), 'landuse': ('flowerbed',)}


def wanted(tags):
    for key, values in GRASS_TAGS.items():
        if tags.get(key) in values:
            return True
    return False


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.found = []

    def way(self, w):
        if not w.is_closed() or not wanted(w.tags):
            return
        try:
            ring = [project(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(ring) < 4:
            return
        poly = Polygon(ring).buffer(0)
        if poly.is_empty or poly.area < 4.0:
            return
        self.found.append((f'garden:w{w.id}', {k: v for k, v in w.tags}, poly))


def run(pbf, out):
    collector = Collector()
    collector.apply_file(str(pbf), locations=True)
    db = sqlite3.connect(out)
    db.executescript('''
        CREATE TABLE IF NOT EXISTS objects(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, kind TEXT, data TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS spatial USING rtree(rowid, minx, maxx, minz, maxz);
    ''')
    count = 0
    for identifier, tags, poly in collector.found:
        data = {'id': identifier, 'sourceId': identifier, 'geometry': mapping(poly), 'tags': tags}
        cur = db.execute('INSERT OR REPLACE INTO objects(id, kind, data) VALUES(?, ?, ?)',
                         (identifier, 'landcover', json.dumps(data, separators=(',', ':'))))
        minx, miny, maxx, maxy = poly.bounds
        db.execute('INSERT OR REPLACE INTO spatial(rowid, minx, maxx, minz, maxz) VALUES(?, ?, ?, ?, ?)',
                   (cur.lastrowid, minx, maxx, miny, maxy))
        count += 1
    db.commit()
    db.close()
    return count


if __name__ == '__main__':
    print(json.dumps({'gardens': run(Path(sys.argv[1]), sys.argv[2])}))
