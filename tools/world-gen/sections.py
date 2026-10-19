#!/usr/bin/env python3
"""Build the per-road cross-section cache: OSM tags + snapped footways/crossings -> road_section.

Input: the profile database (the roads the bake draws), the ingested OSM source database (raw
tags) and sidewalks.sqlite (sidewalks.py). Output: sections-*.sqlite, one JSON section per road
part id plus a manifest of coverage statistics. Deterministic; reruns are byte-identical.
"""
import argparse, hashlib, json, math, sqlite3, time
from pathlib import Path
from shapely import from_wkb
from shapely.geometry import LineString, Point, box
from road_section import cross_section, KERB_RISE
from ingest import encode, sha

# A mapped footway belongs to a street when it runs beside the carriageway, on one side,
# roughly parallel, within this lateral band beyond the kerb.
SNAP_NEAR, SNAP_FAR = .4, 7.5
SNAP_ANGLE = math.radians(25)
SNAP_SHARE = .55          # share of the footway's length that must satisfy the band/angle test
SIDE_COVERAGE = .35       # share of the street's length the matched footways must cover
CROSSING_DEDUPE = 5.      # metres: one crossing per spot
MARKED = {'zebra', 'marked', 'traffic_signals', 'uncontrolled', 'yes', 'island'}


def side_of(line, x, z):
    """(station, lateral, tangent_dot) of point against a road line; lateral > 0 = geographic right."""
    point = Point(x, z); station = line.project(point); centre = line.interpolate(station)
    a = line.interpolate(max(0., station - .5)); b = line.interpolate(min(line.length, station + .5))
    dx, dz = b.x - a.x, b.y - a.y; length = math.hypot(dx, dz) or 1.
    return station, ((x - centre.x) * -dz + (z - centre.y) * dx) / length, (dx / length, dz / length)


def sample_line(line, spacing=3.):
    count = max(1, math.ceil(line.length / spacing))
    return [line.interpolate(line.length * i / count) for i in range(count + 1)]


def footway_match(road_line, half_width, footway):
    """Return ('left'|'right', median_distance, stations) if the footway is this street's sidewalk, else None."""
    samples = sample_line(footway); inside = []; sides = []; distances = []; stations = []
    for index, p in enumerate(samples):
        d = road_line.distance(p)
        if not half_width + SNAP_NEAR <= d <= half_width + SNAP_FAR:
            continue
        station, lateral, (tx, tz) = side_of(road_line, p.x, p.y)
        if station <= 0 or station >= road_line.length:
            continue  # beyond the street's end: it belongs to another street
        q = samples[min(index + 1, len(samples) - 1)]; o = samples[max(index - 1, 0)]
        fx, fz = q.x - o.x, q.y - o.y; length = math.hypot(fx, fz)
        if length < 1e-6 or abs(fx * tx + fz * tz) / length < math.cos(SNAP_ANGLE):
            continue
        inside.append(index); sides.append(lateral > 0); distances.append(d); stations.append(station)
    if len(inside) < max(2, SNAP_SHARE * len(samples)):
        return None
    right = sum(sides) > len(sides) / 2
    if sum(sides) not in (0, len(sides)) and min(sum(sides), len(sides) - sum(sides)) > .2 * len(sides):
        return None  # straddles the street: a crossing or an unrelated path
    return ('right' if right else 'left'), sorted(distances)[len(distances) // 2], stations


def covered_length(stations, spacing=3.):
    stations = sorted(stations); total = 0.; previous = None
    for s in stations:
        total += spacing if previous is None or s - previous > spacing * 1.5 else s - previous
        previous = s
    return total


def build(profiles, osm, sidewalks, output):
    started = time.monotonic(); output = Path(output)
    code = b''.join(Path(__file__).with_name(n).read_bytes() for n in ('sections.py', 'road_section.py', 'model.py'))
    inputs = dict(profilesSha256=sha(profiles), osmSha256=sha(osm), sidewalksSha256=sha(sidewalks), codeSha256=hashlib.sha256(code).hexdigest())
    if output.exists():
        db = sqlite3.connect(f'file:{output}?mode=ro', uri=True)
        manifest = json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]); db.close()
        if manifest['inputs'] != inputs or output.with_suffix('.sha256').read_text().strip() != sha(output):
            raise ValueError('Section cache input differs: use a new output path')
        return manifest
    temporary = output.with_suffix('.partial.sqlite')
    if temporary.exists():
        raise ValueError(f'Inspect/remove {temporary} before retrying')
    roads = sqlite3.connect(f'file:{profiles}?mode=ro', uri=True); raw = sqlite3.connect(f'file:{osm}?mode=ro', uri=True)
    walks = sqlite3.connect(f'file:{sidewalks}?mode=ro', uri=True)
    db = sqlite3.connect(temporary)
    db.executescript('CREATE TABLE metadata(value TEXT); CREATE TABLE sections(id TEXT PRIMARY KEY, data TEXT) WITHOUT ROWID;')
    parts = []
    for rowid, data in roads.execute('SELECT rowid,data FROM roads ORDER BY id'):
        road = json.loads(data); line = LineString(road['points'])
        tags = json.loads(raw.execute("SELECT tags FROM features WHERE id=? AND kind='road'", (road['way'],)).fetchone()[0])
        base = cross_section(tags)
        parts.append(dict(id=road['id'], way=road['way'], line=line, tags=tags, base=base, half=base['width'] / 2, hints={}, covered={'left': [], 'right': []}))
    # Footway -> street assignment: each footway belongs to its single nearest matching street.
    footway_rows = {}
    for rowid, identifier, tags, wkb in walks.execute("SELECT rowid,id,tags,geometry FROM ways WHERE kind='sidewalk' ORDER BY id"):
        footway_rows[rowid] = (identifier, json.loads(tags), from_wkb(wkb))
    assignments = {}
    for part in parts:
        x, z, xx, zz = part['line'].bounds; margin = part['half'] + SNAP_FAR + 2
        for rowid, in walks.execute('SELECT w.rowid FROM way_index i JOIN ways w ON w.rowid=i.rowid WHERE w.kind=? AND i.minx<=? AND i.maxx>=? AND i.minz<=? AND i.maxz>=? ORDER BY w.id', ('sidewalk', xx + margin, x - margin, zz + margin, z - margin)):
            match = footway_match(part['line'], part['half'], footway_rows[rowid][2]) if rowid in footway_rows else None
            if match and (rowid not in assignments or (match[1], part['id']) < (assignments[rowid][1], assignments[rowid][0])):
                assignments[rowid] = (part['id'], match[1], match[0], match[2])
    by_id = {p['id']: p for p in parts}
    for rowid, (road_id, _, side, stations) in assignments.items():
        part = by_id[road_id]; _, tags, _ = footway_rows[rowid]
        width = None
        try:
            width = float(str(tags.get('width', '')).split()[0]) if tags.get('width') else None
        except ValueError:
            pass
        part['covered'][side].extend(stations); previous = part['hints'].get(side)
        part['hints'][side] = width if width and not isinstance(previous, float) else previous or True
    for part in parts:
        for side in ('left', 'right'):
            if covered_length(part['covered'][side]) < min(SIDE_COVERAGE * part['line'].length, 25.):
                part['hints'].pop(side, None)
    # Crossings: tagged highway=crossing nodes lying on a street, plus footway=crossing ways cutting it.
    crossings = {p['id']: [] for p in parts}
    def add_crossing(part, x, z, tags):
        station = part['line'].project(Point(x, z)); kind = tags.get('crossing', 'marked')
        if station < 1. or station > part['line'].length - 1.:
            return  # junction mouths are handled by the corner kerb drops
        point = part['line'].interpolate(station)
        if any(abs(station - s) < CROSSING_DEDUPE for s, *_ in crossings[part['id']]):
            return
        crossings[part['id']].append((round(station, 3), round(point.x, 3), round(point.y, 3), 1 if kind in MARKED or tags.get('crossing_ref') else 0))
    for part in parts:
        x, z, xx, zz = part['line'].bounds
        for nx, nz, tags in ((r[0], r[1], json.loads(r[2])) for r in walks.execute('SELECT n.x,n.z,n.tags FROM node_index i JOIN nodes n ON n.rowid=i.rowid WHERE i.minx<=? AND i.maxx>=? AND i.minz<=? AND i.maxz>=? ORDER BY n.id', (xx + 2, x - 2, zz + 2, z - 2))):
            if part['line'].distance(Point(nx, nz)) <= 1.5:
                add_crossing(part, nx, nz, tags)
        margin = 3
        for wkb, tags in walks.execute("SELECT w.geometry,w.tags FROM way_index i JOIN ways w ON w.rowid=i.rowid WHERE w.kind='crossing' AND i.minx<=? AND i.maxx>=? AND i.minz<=? AND i.maxz>=? ORDER BY w.id", (xx + margin, x - margin, zz + margin, z - margin)):
            cut = part['line'].intersection(from_wkb(wkb))
            for point in (cut.geoms if hasattr(cut, 'geoms') else [cut]):
                if point.geom_type == 'Point' and not point.is_empty:
                    add_crossing(part, point.x, point.y, json.loads(tags))
    stats = dict(roads=0, byClass={}, sidewalkSources={'class': 0, 'tag': 0, 'mapped': 0, 'none': 0}, crossings=0, mappedStreets=0)
    for part in parts:
        section = cross_section(part['tags'], part['hints'])
        section['crossings'] = sorted(crossings[part['id']])
        if section['width'] != part['base']['width']:
            raise ValueError('Sidewalk hints must not change carriageway width: ' + part['id'])
        db.execute('INSERT INTO sections VALUES(?,?)', (part['id'], encode(section)))
        stats['roads'] += 1; stats['byClass'][section['class']] = stats['byClass'].get(section['class'], 0) + 1
        for source in section['sidewalkSource'].values():
            stats['sidewalkSources'][source] += 1
        stats['crossings'] += len(section['crossings']); stats['mappedStreets'] += bool(part['hints'])
    manifest = dict(inputs=inputs, stats=stats, kerbRise=KERB_RISE, footwaysSnapped=len(assignments), footwaysRead=len(footway_rows))
    db.execute('INSERT INTO metadata VALUES(?)', (encode(manifest),)); db.commit(); db.close()
    temporary.replace(output)
    output.with_suffix('.sha256').write_text(sha(output) + '\n')
    output.with_suffix('.metrics.json').write_text(encode(dict(seconds=round(time.monotonic() - started, 2), bytes=output.stat().st_size)) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('profiles', 'osm', 'sidewalks', 'output'):
        parser.add_argument(name, type=Path)
    args = parser.parse_args(); print(encode(build(args.profiles, args.osm, args.sidewalks, args.output)))
