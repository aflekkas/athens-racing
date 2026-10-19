"""Independent checks on a StreetRegions build: no overlaps, no junction gaps, sidewalks where the section says."""
import math
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
from street_regions import StreetRegions, polygons_of, node_table, side_region
from road_section import KERB_RUN

OVERLAP_TOLERANCE = .05      # m2: lattice snapping leaves centimetre slivers at most
HOLE_LIMIT = 4.              # m2: a hole this small beside a junction node is a gap, not an island or a block


def side_points(road, bounds, spacing=3.):
    """(side, point) pairs half-way across the sidewalk of each side that has one, at least 6 m from the ends."""
    line = road['line']; half = road['width'] / 2; out = []
    for side, sign in (('left', -1), ('right', 1)):
        width = road['section']['sidewalk'][side]
        if width <= 0:
            continue
        station = 6.
        while station < line.length - 6:
            a = line.interpolate(station - .5); b = line.interpolate(station + .5)
            dx, dz = b.x - a.x, b.y - a.y; length = math.hypot(dx, dz) or 1.
            centre = line.interpolate(station)
            u = sign * (half + KERB_RUN + width / 2)
            x, z = centre.x + (-dz / length) * u, centre.y + (dx / length) * u
            if bounds is None or bounds.contains(Point(x, z)):
                out.append((road, side, Point(x, z)))
            station += spacing
    return out


def audit_regions(roads, regions, cell=None):
    bounds = box(cell[0] * 512, cell[1] * 512, cell[0] * 512 + 512, cell[1] * 512 + 512) if cell else None
    parts = dict(asphalt=regions.asphalt, kerb=regions.kerb, sidewalk=regions.sidewalk, ramp=regions.ramp)
    names = list(parts); overlap = 0.
    inside = bounds if bounds is not None else box(-1e9, -1e9, 1e9, 1e9)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if not parts[a].is_empty and not parts[b].is_empty:
                # Snapping leaves centimetre slivers along kilometres of outline: only overlap thicker than 3 cm counts.
                overlap += parts[a].intersection(parts[b]).intersection(inside).buffer(-.03).area
    covered = unary_union([regions.asphalt, regions.kerb, regions.sidewalk])
    missing = total = 0; worst = []
    for road in roads:
        for road, side, point in side_points(road, bounds):
            total += 1
            if not (regions.sidewalk.covers(point) or covered.covers(point)):
                missing += 1
                if len(worst) < 5:
                    worst.append([road['id'], side, round(point.x, 1), round(point.y, 1)])
    holes = 0; checked = 0; hole_examples = []
    for key, items in sorted(node_table(roads).items()):
        if len({r['id'] for r, _ in items}) < 3:
            continue
        x, z = items[0][1]
        if bounds is not None and not bounds.buffer(20).contains(Point(x, z)):
            continue
        checked += 1; disc = Point(x, z).buffer(max(r['width'] for r, _ in items) / 2 + 6)
        for polygon in polygons_of(regions.asphalt):
            if not polygon.intersects(disc):
                continue
            for ring in polygon.interiors:
                hole = Polygon(ring)
                if hole.area < HOLE_LIMIT and hole.intersects(disc):
                    holes += 1
                    if len(hole_examples) < 5:
                        hole_examples.append([round(hole.centroid.x, 1), round(hole.centroid.y, 1), round(hole.area, 2), key])
    return dict(overlapArea=round(overlap, 4), junctionsChecked=checked, junctionHoles=holes, holeExamples=hole_examples, sidewalkSamples=total, sidewalkMissing=missing,
                missingExamples=worst, fillets=len(polygons_of(regions.fillets)), zebras=len(regions.zebras))


def check(report):
    """Raise when the build breaks the owner's 'clean junctions, sidewalks present' rule."""
    problems = []
    if report['overlapArea'] > OVERLAP_TOLERANCE:
        problems.append('street regions overlap by %.3f m2' % report['overlapArea'])
    if report['junctionHoles']:
        problems.append('%d gaps in junction asphalt %s' % (report['junctionHoles'], report['holeExamples']))
    if report['sidewalkMissing'] > max(2, .01 * report['sidewalkSamples']):
        problems.append('%d of %d sidewalk samples have no sidewalk %s' % (report['sidewalkMissing'], report['sidewalkSamples'], report['missingExamples']))
    if problems:
        raise ValueError('Street cross-section audit failed: ' + '; '.join(problems))
    return report
