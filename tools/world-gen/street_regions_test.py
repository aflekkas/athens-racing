"""Street surface regions and markings on synthetic scenes (needs shapely; the runner skips without it)."""
import math, random, unittest
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from road_section import KERB_RISE, KERB_RUN, cross_section
from street_audit import audit_regions, check
from street_details import line_offsets, road_markings
from street_regions import RAMP, StreetRegions, polygons_of
from street_details import ribbon_polygon


def road(identifier, points, tags=None, crossings=(), start=None, end=None):
    section = cross_section({'highway': 'residential', **(tags or {})})
    section['crossings'] = list(crossings)
    line = LineString(points)
    return dict(id=identifier, line=line, polygon=ribbon_polygon(line, section['width']), width=section['width'], section=section,
                fromNode=start or identifier + 'a', toNode=end or identifier + 'b', points=[list(p) for p in points])


def t_junction(main_tags=None, side_tags=None):
    return [road('main0', [(-80, 0), (0, 0)], main_tags, end='n'), road('main1', [(0, 0), (80, 0)], main_tags, start='n'),
            road('side', [(0, 0), (0, 70)], side_tags, start='n')]


class Regions(unittest.TestCase):
    def test_every_region_is_disjoint_and_the_reach_is_covered(self):
        roads = t_junction(); r = StreetRegions(roads)
        parts = [r.asphalt, r.kerb, r.sidewalk, r.ramp]
        for i, a in enumerate(parts):
            for b in parts[i + 1:]:
                self.assertLess(a.intersection(b).area, 1e-3)
        reach = unary_union([r.asphalt, r.kerb, r.sidewalk])
        self.assertGreater(reach.area, r.asphalt.area)
        report = check(audit_regions(roads, r))
        self.assertEqual((report['junctionHoles'], report['sidewalkMissing'], report['overlapArea']), (0, 0, 0))

    def test_cross_section_widths_on_a_straight_street(self):
        # Residential two-way: 6.0 m carriageway, 30 cm kerb, 1.8 m sidewalk, 1 m ramp, both sides.
        r = StreetRegions([road('a', [(-100, 0), (100, 0)])]); hw = 3.0
        at = lambda u: Point(40, u)
        self.assertTrue(r.asphalt.covers(at(hw - .05)) and r.asphalt.covers(at(-hw + .05)))
        for sign in (1, -1):
            self.assertTrue(r.kerb.covers(at(sign * (hw + KERB_RUN / 2))))
            self.assertTrue(r.sidewalk.covers(at(sign * (hw + KERB_RUN + .1))))
            self.assertTrue(r.sidewalk.covers(at(sign * (hw + KERB_RUN + 1.78))))
            self.assertTrue(r.ramp.covers(at(sign * (hw + KERB_RUN + 1.85))))
            self.assertTrue(r.ramp.covers(at(sign * (hw + KERB_RUN + 1.8 + RAMP - .1))))
            self.assertFalse(r.ramp.covers(at(sign * (hw + KERB_RUN + 1.8 + RAMP + .2))))
        self.assertEqual(r.fillets.area, 0)

    def test_one_sided_and_absent_sidewalks(self):
        r = StreetRegions([road('a', [(-100, 0), (100, 0)], {'sidewalk': 'right'})])
        self.assertTrue(r.kerb.covers(Point(40, 3.15)))      # +z is the geographic right of an eastward way
        self.assertTrue(r.sidewalk.covers(Point(40, 4.5)))
        self.assertFalse(r.kerb.covers(Point(40, -3.15)))
        self.assertFalse(r.sidewalk.covers(Point(40, -4.5)) or r.ramp.covers(Point(40, -4.5)))
        none = StreetRegions([road('s', [(-100, 0), (100, 0)], {'highway': 'service'})])
        self.assertTrue(none.kerb.is_empty and none.sidewalk.is_empty and none.ramp.is_empty)
        self.assertEqual(none.lift(40, 4.0), 0)

    def test_t_junction_corners_are_rounded_and_cause_no_holes(self):
        roads = t_junction(); plain = unary_union([road['polygon'] for road in roads]); r = StreetRegions(roads)
        self.assertEqual(len(polygons_of(r.fillets)), 2)
        self.assertGreater(r.asphalt.area - plain.area, 1.0)
        for x in (-1, 1):  # the sharp inside corner of the plain union now lies on an arc
            self.assertTrue(r.asphalt.covers(Point(x * 3.2, 3.2)), 'fillet area covers the old sharp corner')
        self.assertEqual(sum(len(p.interiors) for p in polygons_of(r.asphalt)), 0)

    def test_dual_carriageway_median_is_not_filled(self):
        a = road('north', [(-120, -4), (0, -4)], {'oneway': 'yes', 'lanes': '2'}, end='x'); b = road('north1', [(0, -4), (120, -4)], {'oneway': 'yes', 'lanes': '2'}, start='x')
        c = road('south', [(120, 4), (0, 4)], {'oneway': 'yes', 'lanes': '2'}, end='y'); d = road('south1', [(0, 4), (-120, 4)], {'oneway': 'yes', 'lanes': '2'}, start='y')
        side = road('cross', [(60, -60), (60, 60)], {'oneway': 'no'}, start='s0', end='s1')
        r = StreetRegions([a, b, c, d, side])
        # 8 m between centres, 6.0 m wide ribbons (2 lanes x 3.0): a 2 m median stays out of the asphalt away from the cross street.
        self.assertFalse(r.asphalt.covers(Point(-60, 0)))
        self.assertTrue(r.asphalt.covers(Point(-60, 3.5)) and r.asphalt.covers(Point(-60, -3.5)))

    def test_dead_end_and_isolated_street_have_no_fillets(self):
        r = StreetRegions([road('dead', [(0, 0), (60, 0)])])
        self.assertTrue(r.fillets.is_empty)
        check(audit_regions([road('dead', [(0, 0), (60, 0)])], r))

    def test_mapped_wider_sidewalk_and_bridge_without_any(self):
        wide = StreetRegions([road('w', [(-100, 0), (100, 0)], {'highway': 'primary', 'sidewalk': 'both', 'sidewalk:both:width': '3.4'})])
        self.assertTrue(wide.sidewalk.covers(Point(40, 3.5 + KERB_RUN + 3.3)))
        deck = StreetRegions([road('b', [(-100, 0), (100, 0)], {'highway': 'primary', 'bridge': 'yes'})])
        self.assertTrue(deck.kerb.is_empty and deck.sidewalk.is_empty)


class Lift(unittest.TestCase):
    def setUp(self):
        self.roads = t_junction(side_tags={'sidewalk': 'both'}); self.r = StreetRegions(self.roads)

    def test_zero_on_asphalt_full_on_sidewalk_zero_on_ground(self):
        r = self.r
        self.assertEqual(r.lift(40, 0), 0); self.assertEqual(r.lift(40, 2.9), 0)
        self.assertAlmostEqual(r.lift(40, 3.0 + KERB_RUN + .9), KERB_RISE, 3)
        self.assertEqual(r.lift(40, 3 + KERB_RUN + 1.8 + RAMP + .5), 0)
        self.assertEqual(r.lift(500, 500), 0)

    def test_kerb_bevel_is_monotonic_and_below_thirty_degrees(self):
        values = [self.r.lift(40, 3.0 + k * .02) for k in range(0, 20)]
        self.assertEqual(values, sorted(values))
        steepest = max(abs(b - a) / .02 for a, b in zip(values, values[1:]))
        self.assertLess(math.degrees(math.atan(steepest)), 30)

    def test_lift_is_lipschitz_everywhere(self):
        rng = random.Random(7); worst = 0
        for _ in range(4000):
            x, z = rng.uniform(-60, 60), rng.uniform(-14, 40); dx, dz = rng.uniform(-.1, .1), rng.uniform(-.1, .1)
            delta = abs(self.r.lift(x, z) - self.r.lift(x + dx, z + dz)) / max(1e-9, math.hypot(dx, dz)); worst = max(worst, delta)
        self.assertLess(math.degrees(math.atan(worst)), 30, 'steepest lift gradient %.3f' % worst)

    def test_junction_corners_are_dropped_kerbs(self):
        r = self.r; kerbs = 0
        for patch in polygons_of(r.fillets):
            zone = r.kerb.intersection(patch.buffer(.3))
            for piece in polygons_of(zone):
                kerbs += 1
                self.assertLess(r.lift(piece.representative_point().x, piece.representative_point().y), KERB_RISE * .5)
        self.assertGreater(kerbs, 0)
        self.assertAlmostEqual(r.lift(40, 3.0 + KERB_RUN + .9), KERB_RISE, 3, 'straight kerbs keep their full height')

    def test_zebra_crossing_drops_the_kerb_and_gets_bars(self):
        crossing = road('a', [(-100, 0), (100, 0)], crossings=[(100., 0., 0., 1)]); r = StreetRegions([crossing])
        self.assertEqual(len(r.zebras), 1)
        self.assertLessEqual(r.lift(0, 3.0 + KERB_RUN + .2), KERB_RISE * .2)
        self.assertAlmostEqual(r.lift(8, 3.0 + KERB_RUN + .9), KERB_RISE, 3)
        points, indices = road_markings([crossing], (0, 0), lambda x, z: 0., r)
        self.assertGreater(len(indices), 0)
        xs = [points[i] for i in range(0, len(points), 3)]
        self.assertTrue(any(abs(x) < 1.6 for x in xs), 'zebra bars near the crossing')
        marked = StreetRegions([road('u', [(-100, 0), (100, 0)], crossings=[(100., 0., 0., 0)])])
        self.assertEqual(len(marked.zebras), 0)
        self.assertLessEqual(marked.lift(0, 3.0 + KERB_RUN + .2), KERB_RISE * .2, 'an unmarked crossing still has dropped kerbs')


class Lines(unittest.TestCase):
    def offsets(self, **tags):
        section = cross_section({'highway': 'residential', **tags}); return line_offsets(section, section['width'])

    def test_two_lane_two_way_has_one_centre_dash(self):
        self.assertEqual(self.offsets(), [(0., 'dashed')])

    def test_one_way_three_lane_primary_has_lane_dashes_and_edge_lines(self):
        section = cross_section({'highway': 'primary', 'lanes': '3', 'oneway': 'yes', 'maxspeed': '70'})
        lines = line_offsets(section, section['width']); half = section['width'] / 2
        self.assertEqual(sorted(round(u, 3) for u, s in lines if s == 'dashed'), [-1.75, 1.75])
        self.assertEqual(sorted(u for u, s in lines if s == 'solid'), [-half + .35, half - .35])

    def test_trunk_four_lane_two_way_has_a_double_centre(self):
        section = cross_section({'highway': 'trunk', 'lanes': '4'}); lines = line_offsets(section, section['width'])
        self.assertEqual(len([1 for u, s in lines if s == 'solid' and abs(u) < .2]), 2)
        self.assertEqual(len([1 for u, s in lines if s == 'dashed']), 2)

    def test_markings_stay_on_the_carriageway(self):
        roads = [road('a', [(-100, 0), (100, 0)], {'highway': 'primary', 'lanes': '4', 'oneway': 'yes'})]; r = StreetRegions(roads)
        points, indices = road_markings(roads, (0, 0), lambda x, z: 0., r)
        half = roads[0]['width'] / 2
        self.assertTrue(all(abs(points[i + 2]) <= half + .01 for i in range(0, len(points), 3)))


if __name__ == '__main__':
    unittest.main()
