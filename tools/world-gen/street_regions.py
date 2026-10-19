"""Street surface regions from road sections: carriageway, junction fillets, kerb, sidewalk, ramp.

Everything here is a GLOBAL function of the loaded roads (never tile-local): two cells that both
load a street produce the very same polygons and vertex lifts, so borders match exactly.

Regions (all disjoint, snapped to the 2 cm lattice):
  U  asphalt = every ribbon + junction fillets (rounded corners at >=3-way nodes)
  K  kerb bevel: 30 cm wide, rises 12 cm, only beside a street that has a sidewalk on that side
  S  sidewalk: the flat raised paving beyond the kerb, class/tag/mapped width per side
  B  ramp: the 1 m blend from sidewalk height back to ground
  Z  flush zones (zebra crossings and junction corners): the kerb is dropped to 12% of its height

lift(x,z) is the height added to the canonical road/ground plane at a mesh vertex. It is a
product of three 1-Lipschitz-bounded ramps, so it is continuous and every emitted triangle stays
under the owner's 30 degree shoulder gate (the kerb bevel is atan(.12/.30) = 21.8 degrees).
"""
import math
from collections import defaultdict
import shapely
from shapely import set_precision, contains_xy, union_all
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.strtree import STRtree
from shapely import prepare
from border_nodes import canonical_polygon as _canonical_polygon


def canonical_polygon(geometry):
    return geometry if geometry.is_empty else _canonical_polygon(geometry)
from road_section import KERB_RISE, KERB_RUN

STEEP_FULL, STEEP_NONE = .10, .22   # terrain slopes where the kerb is full height / gone
RAMP = 1.0              # metres from the sidewalk edge back to ground
DROP_FLOOR = .12        # flush kerb height as a share of the full kerb
DROP_BLEND = 1.2        # metres over which a flush zone blends back to a full kerb
FILLET_MIN_AREA = .15
ZEBRA_ALONG = 3.6       # crossing width along the road
BAR, PITCH = .45, .9


GRID = .02


def _polygonal(geometry):
    """Overlays can return a collection with stray lines/points at touching edges; keep only the area."""
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry
    parts = polygons_of(geometry)
    return MultiPolygon(parts) if parts else Polygon()


def unary_union(geoms):
    """Order-stable union: a plain left fold over the inputs in the order given (callers sort by id).

    Cascaded unions group their inputs by spatial index, so near-collinear ribbon edges meet in a grouping that
    depends on the whole window, and an ill-conditioned intersection then lands a 2 cm snap apart in two cells.
    A fold only ever combines a polygon with what its neighbours (earlier in id order) already built, so the
    boundary near a point is the same in every cell that sees that neighbourhood.
    """
    result = Polygon()
    for g in geoms:
        g = _polygonal(g)
        if not g.is_empty:
            result = g if result.is_empty else _polygonal(shapely.union(result, g))
    return result


def diff(a, b):
    return _polygonal(shapely.difference(_polygonal(a), _polygonal(b)))


def meet(a, b):
    return _polygonal(shapely.intersection(_polygonal(a), _polygonal(b)))


def polygons_of(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [p for g in getattr(geometry, 'geoms', []) for p in polygons_of(g)]


def clean(geometry, minimum=.02):
    """Snap to the lattice and drop centimetre slivers so no face is thinner than the mesh tolerance."""
    if geometry.is_empty:
        return Polygon()
    kept = [p for p in polygons_of(set_precision(geometry, .02)) if p.area > minimum]
    # Node every outline at the global 512 m borders from its own vertices (exact fractions), so the border
    # crossings of derived edges never depend on which neighbours were loaded.
    return canonical_polygon(unary_union(kept)) if kept else Polygon()


def fill_small_holes(geometry, limit=1.0):
    """Close enclosed gaps under `limit` m2 (centimetre voids between ribbons and fillets, never a real block)."""
    parts = [Polygon(p.exterior, [r for r in p.interiors if Polygon(r).area >= limit]) for p in polygons_of(geometry)]
    return unary_union(parts) if parts else Polygon()


class Distance:
    """Distance to a polygonal region: 0 inside, else to the nearest boundary segment (STRtree)."""
    def __init__(self, geometry):
        self.empty = geometry.is_empty
        if self.empty:
            return
        self.geometry = geometry; prepare(geometry)
        segments = []
        for polygon in polygons_of(geometry):
            for ring in (polygon.exterior, *polygon.interiors):
                coords = list(ring.coords)
                segments.extend(LineString(coords[i:i + 2]) for i in range(len(coords) - 1))
        self.segments = segments; self.tree = STRtree(segments)

    def __call__(self, x, z, limit=math.inf):
        if self.empty:
            return math.inf
        p = Point(x, z)
        if self.geometry.covers(p):
            return 0.
        return self.segments[int(self.tree.nearest(p))].distance(p)


def node_table(roads):
    nodes = defaultdict(list)
    for road in roads:
        nodes[road['fromNode']].append((road, road['points'][0]))
        nodes[road['toNode']].append((road, road['points'][-1]))
    return nodes


def fillet_radius(items):
    return 4. if any(r['section']['class'] in ('motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link') for r, _ in items) else 3.


def junction_fillets(roads, ribbons):
    """Round the concave corners at >=3-way nodes: closing of the local asphalt, minus the asphalt itself.

    Each node is computed ONLY from the ribbons that reach it, unioned in id order, so two cells whose windows
    hold different far-away streets still build the very same arc vertices (a unioned window is not repeatable
    to the last bit, and one 2 cm snap flip is a cracked seam).
    """
    pieces = []
    order = sorted(roads, key=lambda r: r['id'])
    tree = STRtree([ribbons[r['id']] for r in order])
    for key, items in sorted(node_table(roads).items()):
        distinct = {r['id'] for r, _ in items}
        if len(distinct) < 3:
            continue
        x, z = items[0][1]; r = fillet_radius(items); hw = max(road['width'] for road, _ in items) / 2
        reach = Point(x, z).buffer(hw + 6 * r + 6, quad_segs=4)
        near = [ribbons[order[int(i)]['id']] for i in sorted(tree.query(reach, predicate='intersects'))]
        asphalt = unary_union(near)  # near is in id order
        local = meet(asphalt, reach)
        closed = local.buffer(r, quad_segs=2).buffer(-r, quad_segs=2)
        patch = meet(diff(closed, asphalt), Point(x, z).buffer(hw + 3 * r, quad_segs=4))
        pieces.extend(p for p in polygons_of(set_precision(patch, .02)) if p.area >= FILLET_MIN_AREA)
    return unary_union(pieces) if pieces else Polygon()


def side_region(line, half_width, sidewalk, right):
    """Everything on one side of the street's line out to kerb+sidewalk distance (flat caps)."""
    distance = half_width + KERB_RUN + sidewalk
    shape = line.buffer(distance if right else -distance, single_sided=True, cap_style=2, join_style=2, mitre_limit=2.)
    return canonical_polygon(set_precision(shape if shape.is_valid else shape.buffer(0), .02))


def crossing_zone(road, station, point):
    """Flush rectangle across the carriageway and both sidewalks at a crossing."""
    line = road['line']; a = line.interpolate(max(0., station - .5)); b = line.interpolate(min(line.length, station + .5))
    dx, dz = b.x - a.x, b.y - a.y; length = math.hypot(dx, dz) or 1.; tx, tz = dx / length, dz / length; nx, nz = -tz, tx  # nx,nz = right
    hw = road['width'] / 2; wl, wr = road['section']['sidewalk']['left'], road['section']['sidewalk']['right']
    left = -(hw + (KERB_RUN + wl if wl else 0.) + .3); right = hw + (KERB_RUN + wr if wr else 0.) + .3
    h = ZEBRA_ALONG / 2
    return Polygon([(point[0] + tx * s + nx * u, point[1] + tz * s + nz * u) for s, u in ((-h, left), (h, left), (h, right), (-h, right))]), (tx, tz, nx, nz)


class StreetRegions:
    def __init__(self, roads, clip=None):
        """roads: dicts with id, line, polygon (ribbon), width, section, fromNode, toNode, points."""
        self.roads = roads
        self.ribbons = {r['id']: canonical_polygon(r['polygon']) for r in roads}
        ribbons = unary_union([self.ribbons[r['id']] for r in sorted(roads, key=lambda r: r['id'])]) if roads else Polygon()
        self.fillets = clean(junction_fillets(roads, self.ribbons)) if roads else Polygon()
        if clip is not None and not self.fillets.is_empty:
            self.fillets = clean(diff(self.fillets, clip))  # e.g. the bridge deck platform: no ground asphalt beneath it
        self.asphalt = fill_small_holes(clean(unary_union([ribbons, self.fillets]))) if roads else Polygon()
        self.owner_extra = self._assign_fillets()
        strips = []
        for road in roads:
            for side, right in (('left', False), ('right', True)):
                width = road['section']['sidewalk'][side]
                if width > 0:
                    strips.append(side_region(road['line'], road['width'] / 2, width, right))
        reach = unary_union(strips) if strips else Polygon()
        outside = clean(diff(reach, self.asphalt))
        near = canonical_polygon(set_precision(self.asphalt.buffer(KERB_RUN, join_style=2, mitre_limit=2.), .02))
        self.kerb = clean(meet(outside, near))
        self.sidewalk = clean(diff(outside, near))
        self.raised = clean(unary_union([self.kerb, self.sidewalk]))
        halo = self.raised.buffer(RAMP, quad_segs=2, join_style=2, mitre_limit=2.)
        self.ramp = clean(diff(diff(halo, self.raised), self.asphalt))
        self.strips = clean(unary_union([self.kerb, self.sidewalk, self.ramp])) if not self.raised.is_empty else Polygon()
        self.zebras = []; zones = []
        for road in roads:
            for station, x, z, marked in road['section'].get('crossings', []):
                polygon, frame = crossing_zone(road, station, (x, z)); zones.append(polygon)
                if marked:
                    self.zebras.append((road, station, (x, z), frame))
        self.flush = clean(unary_union([self.fillets, *zones])) if (zones or not self.fillets.is_empty) else Polygon()
        self._d_asphalt = Distance(self.asphalt); self._d_raised = Distance(self.raised); self._d_flush = Distance(self.flush)
        self._cache = {}

    def _assign_fillets(self):
        """Give each fillet patch to the nearest street so its triangles have an owner and a ribbon station."""
        extra = defaultdict(list)
        if not self.roads:
            return {}
        tree = STRtree([r['line'] for r in self.roads])
        for patch in polygons_of(self.fillets):
            point = patch.representative_point(); nearest = self.roads[int(tree.nearest(point))]
            reach = nearest['line'].distance(point) + 1e-6
            owner = min((self.roads[int(i)] for i in tree.query(point, predicate='dwithin', distance=reach)), key=lambda r: (r['line'].distance(point), r['id']))
            extra[owner['id']].append(patch)
        return {k: unary_union(v) for k, v in extra.items()}

    def surface(self, road):
        """The road's ribbon plus its share of the junction fillets (the owner polygon for meshing)."""
        extra = self.owner_extra.get(road['id'])
        base = self.ribbons[road['id']]
        return base if extra is None else canonical_polygon(unary_union([base, extra]))

    def lift(self, x, z, slope=None):
        """Height above the canonical plane at (x,z), rounded to 1 mm so neighbouring cells agree exactly.

        slope(x, z) -> terrain gradient (rise/run); the kerb fades out on steep ground (full up to 10%, none at 22%)
        so a hillside street never exceeds the 15 cm / 30 degree shoulder step.
        """
        key = (x, z)
        if key in self._cache:
            return self._cache[key]
        value = 0.
        if not self.raised.is_empty:
            ramp = max(0., 1. - self._d_raised(x, z) / RAMP)
            if ramp > 0:
                up = min(1., max(0., self._d_asphalt(x, z) - .03) / (KERB_RUN - .06))
                drop = 1.
                if not self.flush.is_empty:
                    drop = DROP_FLOOR + (1 - DROP_FLOOR) * min(1., self._d_flush(x, z) / DROP_BLEND)
                steep = 1. if slope is None else min(1., max(0., 1. - (slope(x, z) - STEEP_FULL) / (STEEP_NONE - STEEP_FULL)))
                value = round(KERB_RISE * up * ramp * drop * steep * 1000) / 1000
        self._cache[key] = value
        return value

    def boundaries(self):
        """Lines the tessellator must node so each region/contour has its own vertices."""
        # No contour at the end of the ramp: the ground triangles beside a sidewalk fall from kerb height to
        # ground level by themselves (a 12 cm edge is inside the 15 cm / 30 degree shoulder gate).
        lines = [r.boundary for r in (self.kerb, self.sidewalk) if not r.is_empty]
        if not self.flush.is_empty and not self.strips.is_empty:
            # Only where the kerb actually rises: contours through asphalt would just add triangles.
            for zone in (self.flush, self.flush.buffer(DROP_BLEND, quad_segs=2, join_style=2, mitre_limit=2.)):
                contour = zone.boundary.intersection(self.strips)
                if not contour.is_empty:
                    lines.append(contour)
        return [l for l in lines if l is not None and not l.is_empty]

    def classify(self, xs, zs):
        """Vectorised region label per point: 0 ground, 1 kerb, 2 sidewalk (asphalt is owner-based)."""
        labels = [0] * len(xs)
        for code, region in ((1, self.kerb), (2, self.sidewalk)):
            if not region.is_empty:
                inside = contains_xy(region, xs, zs)
                labels = [code if hit else old for hit, old in zip(inside, labels)]
        return labels
