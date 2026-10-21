#!/usr/bin/env python3
"""Generated polykatoikia lots in empty urban block interiors (owner-approved infill, 2026-10-20).

Every residential landuse polygon is cut by what OSM maps: buildings, roads and footways (with their width and a
sidewalk), other landuse and landcover, water and coast, and the paved plazas and lawns of assets/athens/*.json.
What is left is the empty block interior. Each interior component of at least 350 m2 is filled with 4 to 7 storey
lots on a grid along its long side, up to 60% of its area. A lot is only kept when it lies wholly inside the free
interior, so it cannot touch a road, footway, park, plaza, water or an OSM building.

Lots are written in the clean-database record format (one part, the same mesh builder) to `infill.sqlite` beside
clean.sqlite. The bake reads that file with the building query (tiles.py), and every record carries
generated=true so the audit can count it.

    python3 infill.py CACHE ASSETS_ATHENS_DIR OUT.sqlite [--bounds minx,minz,maxx,maxz]
"""
import argparse
import hashlib
import json
import math
import sqlite3
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import LineString, Polygon, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from buildings import building_mesh  # noqa: E402  (the same mesh builder as the clean step)
from model import palette_index  # noqa: E402

SIDEWALK_M = 2.0            # kerb to building line beyond the carriageway
FOOTWAY_BUFFER_M = 2.5      # footway, path, steps, pedestrian way, cycleway
MIN_INTERIOR_M2 = 150.0     # a free gap smaller than one lot is no room for a lot (courtyard paving instead)
MIN_LOT_M2 = 150.0          # no generated lot is smaller than this (owner brief: lots down to about 150 m2)
MAX_INTERIOR_M2 = 30000.0   # bigger free ground is open land, not a city block: no lots
MIN_RING_BUILT = 0.15       # share of the 60 m ring around the interior that OSM builds on
RING_M = 60.0
MAX_COVER = 0.60            # share of an interior that may be built
LOT_W = (8.0, 13.0)          # street-facing width, metres, seeded per lot
LOT_D = (11.0, 17.0)        # depth, metres, seeded per lot
GAP_M = 1.5                 # clearance between neighbouring lots
STOREYS = (4, 7)            # inclusive
FLOOR_M = 3.2               # matches buildings.building_height for building:levels
TILE_M = 2048.0             # exclusions are indexed per tile, not per block
CANDIDATE_STEP_M = 3.0      # grid spacing of candidate lot positions
FOOTWAY_HIGHWAYS = {'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'bridleway'}
PLAZA_UNIT = 0.5            # plazas.json / lawns.json store metres in half-metre units
EXCLUDE_KINDS = ('building', 'road', 'landuse', 'landcover', 'water', 'coast')
RESIDENTIAL = ('residential',)
REVISION_FILES = ('infill.py', 'buildings.py', 'model.py')
WORLD_BOUNDS = (-40000.0, -38000.0, 36000.0, 34000.0)


def seeded(key, low, high):
    """A deterministic number in [low, high] for a lot key: the same key gives the same lot in every bake."""
    h = int.from_bytes(hashlib.sha256(key.encode()).digest()[:4], 'big') / 0xFFFFFFFF
    return low + (high - low) * h


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assets_polygons(path):
    raw = json.loads(Path(path).read_text())
    unit = float(raw.get('unit', PLAZA_UNIT))
    out = []
    for ring in raw['plazas']:
        pts = [(ring[i] * unit, ring[i + 1] * unit) for i in range(0, len(ring) - 1, 2)]
        if len(pts) >= 3:
            poly = Polygon(pts).buffer(0)
            if not poly.is_empty:
                out.append(poly)
    return out


def road_buffer(tags, points):
    line = LineString(points)
    if line.length == 0:
        return None
    if (tags.get('highway') or '') in FOOTWAY_HIGHWAYS:
        return line.buffer(FOOTWAY_BUFFER_M, cap_style=2)
    try:
        half = float(tags['width']) / 2.0
    except (KeyError, TypeError, ValueError):
        half = 3.5
    return line.buffer(max(half, 2.0) + SIDEWALK_M, cap_style=2)


def tiles(bounds):
    minx, minz, maxx, maxz = bounds
    x = minx
    while x < maxx:
        z = minz
        while z < maxz:
            yield (x, z, min(x + TILE_M, maxx), min(z + TILE_M, maxz))
            z += TILE_M
        x += TILE_M


def tile_owns(tile, block):
    c = block.centroid
    return tile[0] <= c.x < tile[2] and tile[1] <= c.y < tile[3]


def residential_blocks(db, tile):
    minx, minz, maxx, maxz = tile
    rows = db.execute(
        "SELECT o.id, o.data FROM spatial s JOIN objects o ON o.rowid = s.rowid "
        "WHERE o.kind = 'landuse' AND s.maxx >= ? AND s.minx <= ? AND s.maxz >= ? AND s.minz <= ? ORDER BY o.id",
        (minx, maxx, minz, maxz)).fetchall()
    for oid, data in rows:
        value = json.loads(data)
        if value['tags'].get('landuse') in RESIDENTIAL:
            block = shape(value['geometry']).buffer(0)
            if not block.is_empty and block.area >= MIN_INTERIOR_M2:
                yield oid, block


class Exclusions:
    """Everything OSM maps inside one bounding box, parsed once and indexed for the blocks in it."""

    def __init__(self, db, plazas, bounds):
        self.pieces, self.buildings = self.load(db, plazas, bounds)
        self.tree = STRtree(self.pieces) if self.pieces else None
        self.built_tree = STRtree(self.buildings) if self.buildings else None

    def around(self, bounds):
        if self.tree is None:
            return Polygon()
        hits = self.tree.query(box(*bounds))
        return unary_union([self.pieces[int(i)] for i in hits])

    @staticmethod
    def load(db, plazas, bounds):
        minx, minz, maxx, maxz = bounds
        pieces = []
        buildings = []
        rows = db.execute(
            'SELECT o.kind, o.data FROM spatial s JOIN objects o ON o.rowid = s.rowid '
            'WHERE o.kind IN (%s) AND s.maxx >= ? AND s.minx <= ? AND s.maxz >= ? AND s.minz <= ?'
            % ','.join('?' * len(EXCLUDE_KINDS)), (*EXCLUDE_KINDS, minx, maxx, minz, maxz)).fetchall()
        for kind, data in rows:
            value = json.loads(data)
            if kind == 'building':
                for part in value['parts']:
                    buildings.append(Polygon(part['footprint']).buffer(1.0))
                    pieces.append(buildings[-1])
            elif kind == 'road':
                g = road_buffer(value, value['points'])
                if g is not None:
                    pieces.append(g)
            elif kind == 'landuse':
                if value['tags'].get('landuse') in RESIDENTIAL:
                    continue  # a residential block is the thing we fill, not an obstacle
                pieces.append(shape(value['geometry']).buffer(0))
            else:  # landcover, water, coast
                pieces.append(shape(value['geometry']).buffer(0))
        for plaza in plazas:
            if plaza.bounds[2] >= minx and plaza.bounds[0] <= maxx and plaza.bounds[3] >= minz and plaza.bounds[1] <= maxz:
                pieces.append(plaza)
        return [p for p in pieces if not p.is_empty], [b for b in buildings if not b.is_empty]

    def built_share(self, interior):
        """Share of the ring 60 m around an interior that OSM builds on."""
        if self.built_tree is None:
            return 0.0
        ring = interior.buffer(RING_M).difference(interior)
        if ring.is_empty or ring.area <= 0:
            return 0.0
        covered = unary_union([self.buildings[int(i)] for i in self.built_tree.query(ring)])
        return covered.intersection(ring).area / ring.area


def interior_components(block, excluded):
    free = block.difference(excluded) if not excluded.is_empty else block
    geoms = list(free.geoms) if hasattr(free, 'geoms') else [free]
    return [g for g in geoms if g.geom_type == 'Polygon' and g.area >= MIN_INTERIOR_M2]


def lots_in(interior, storeys_range=STOREYS):
    """Lots packed edge first: candidates on a 3 m grid in the interior's frame, nearest the block edge first,
    each kept only if it lies wholly inside, clears the lots already placed by GAP_M and stays under the cover cap."""
    rect = interior.minimum_rotated_rectangle
    coords = list(rect.exterior.coords)
    angle = math.degrees(math.atan2(coords[1][1] - coords[0][1], coords[1][0] - coords[0][0]))
    centre = interior.centroid
    local = affinity.rotate(interior, -angle, origin=centre)
    minx, miny, maxx, maxy = local.bounds
    candidates = []
    row = 0
    y = miny + 1.0
    while y < maxy:
        col = 0
        x = minx + 1.0
        while x < maxx:
            key = f'{round(centre.x)}:{round(centre.y)}:{round(angle)}:{row}:{col}'
            lot = box(x, y, x + seeded(key + ':w', *LOT_W), y + seeded(key + ':d', *LOT_D))
            if local.contains(lot) and lot.area >= MIN_LOT_M2:
                candidates.append((local.exterior.distance(lot), key, lot))
            x += CANDIDATE_STEP_M
            col += 1
        y += CANDIDATE_STEP_M
        row += 1
    candidates.sort(key=lambda c: (c[0], c[1]))
    built = 0.0
    placed = []
    lots = []
    for _, key, lot in candidates:
        if built + lot.area > MAX_COVER * local.area:
            continue
        clear = lot.buffer(GAP_M / 2)
        if any(clear.intersects(p) for p in placed):
            continue
        placed.append(lot)
        built += lot.area
        storeys = round(seeded(key + ':s', *storeys_range))
        lots.append((key, affinity.rotate(lot, angle, origin=centre), storeys))
    return lots


def generated_record(identifier, footprint, storeys):
    tags = {'building': 'apartments', 'building:levels': str(storeys), 'generated': 'yes'}
    mesh = building_mesh(identifier + ':0', footprint, tags, 'residential')
    if mesh is None:
        return None
    mesh['palette'] = palette_index(identifier)
    c = footprint.centroid
    return {'id': identifier, 'centroid': [c.x, c.y], 'parts': [mesh],
            'triangles': mesh['triangles'], 'awtTriangles': mesh['triangles'],
            'generated': True, 'storeys': storeys, 'landuse': 'residential'}


def build(cache, assets, out, bounds=WORLD_BOUNDS, storeys_range=STOREYS):
    clean = sqlite3.connect(f'file:{Path(cache) / "clean.sqlite"}?mode=ro', uri=True)
    plazas = assets_polygons(Path(assets) / 'plazas.json') + assets_polygons(Path(assets) / 'lawns.json')
    out = Path(out)
    if out.exists():
        out.unlink()
    db = sqlite3.connect(out)
    db.executescript('''
        CREATE TABLE objects(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, kind TEXT, data TEXT);
        CREATE VIRTUAL TABLE spatial USING rtree(rowid, minx, maxx, minz, maxz);
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
    ''')
    stats = {'blocks': 0, 'interiors': 0, 'lots': 0, 'skippedMesh': 0, 'interiorM2': 0.0, 'lotM2': 0.0}
    seen = set()
    for tile in tiles(bounds):
        blocks = [(bid, b) for bid, b in residential_blocks(clean, tile) if tile_owns(tile, b)]
        if not blocks:
            continue
        span = (min(b.bounds[0] for _, b in blocks) - 5, min(b.bounds[1] for _, b in blocks) - 5,
                max(b.bounds[2] for _, b in blocks) + 5, max(b.bounds[3] for _, b in blocks) + 5)
        excl = Exclusions(clean, plazas, span)
        for _, block in blocks:
            stats['blocks'] += 1
            excluded = excl.around(block.bounds)
            for interior in interior_components(block, excluded):
                stats['interiors'] += 1
                if interior.area > MAX_INTERIOR_M2:
                    stats['openLand'] = stats.get('openLand', 0) + 1
                    continue
                if excl.built_share(interior) < MIN_RING_BUILT:
                    stats['sparseRing'] = stats.get('sparseRing', 0) + 1
                    continue
                stats['interiorM2'] += interior.area
                for key, footprint, storeys in lots_in(interior, storeys_range):
                    if not footprint.within(interior):
                        continue
                    stats['candidatesKept'] = stats.get('candidatesKept', 0) + 1
                    identifier = 'gen:' + key
                    if identifier in seen:
                        continue
                    seen.add(identifier)
                    record = generated_record(identifier, footprint, storeys)
                    if record is None:
                        stats['skippedMesh'] += 1
                        continue
                    cur = db.execute('INSERT INTO objects(id, kind, data) VALUES(?, ?, ?)',
                                     (identifier, 'building', json.dumps(record, separators=(',', ':'))))
                    minx, miny, maxx, maxy = footprint.bounds
                    db.execute('INSERT INTO spatial(rowid, minx, maxx, minz, maxz) VALUES(?, ?, ?, ?, ?)',
                               (cur.lastrowid, minx, maxx, miny, maxy))
                    stats['lots'] += 1
                    stats['lotM2'] += footprint.area
    here = Path(__file__).resolve().parent
    meta = {'generator': 'infill.py', 'bounds': list(bounds), 'stats': stats,
            'codeSha256': {name: file_sha(here / name) for name in REVISION_FILES},
            'params': dict(sidewalk=SIDEWALK_M, footway=FOOTWAY_BUFFER_M, minInterior=MIN_INTERIOR_M2,
                           maxCover=MAX_COVER, gap=GAP_M, storeys=list(storeys_range), floor=FLOOR_M)}
    db.execute('INSERT INTO metadata(key, value) VALUES(?, ?)', ('infill', json.dumps(meta, sort_keys=True)))
    db.commit()
    db.close()
    return meta


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('cache')
    ap.add_argument('assets')
    ap.add_argument('out')
    ap.add_argument('--bounds', default=None)
    args = ap.parse_args(argv)
    bounds = tuple(float(v) for v in args.bounds.split(',')) if args.bounds else WORLD_BOUNDS
    print(json.dumps(build(args.cache, args.assets, args.out, bounds)['stats'], sort_keys=True))


if __name__ == '__main__':
    main(sys.argv[1:])
