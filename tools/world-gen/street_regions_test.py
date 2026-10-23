"""Street surface regions and markings on synthetic scenes (needs shapely; the runner skips without it)."""
import json, math, random, unittest
from pathlib import Path
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from road_section import KERB_RISE, KERB_RUN, cross_section
from street_audit import audit_regions, check
from street_details import line_offsets, road_markings
from street_regions import RAMP, StreetRegions, polygons_of, fill_junction_holes, diff, meet, side_region
from border_nodes import canonical_polygon
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

    def test_solid_paint_follows_emitted_planes_between_its_endpoints(self):
        from surfaces import SurfaceHeight
        # The road rises two metres in the middle, despite equal end heights.
        surface=SurfaceHeight(dict(cell=(0,0),positions=[0,0,0,10,2,0,20,0,0,0,0,4,10,2,4,20,0,4],triangles=[0,3,1,1,3,4,1,4,2,2,4,5]))
        from street_details import paint_triangles
        ps=[];ix=[];paint_triangles(Polygon([(0,1),(20,1),(20,2),(0,2)]),ps,ix,0,0,surface)
        self.assertGreater(len(ix),6)
        for i in range(0,len(ix),3):
            tri=[ps[v*3:v*3+3] for v in ix[i:i+3]]
            for weights in ((1/3,1/3,1/3),(.1,.2,.7),(.5,.5,0)):
                x,y,z=[sum(p[k]*w for p,w in zip(tri,weights)) for k in range(3)]
                self.assertAlmostEqual(y,surface(x,z)+.015,places=6)

    def test_markings_stay_on_the_carriageway(self):
        roads = [road('a', [(-100, 0), (100, 0)], {'highway': 'primary', 'lanes': '4', 'oneway': 'yes'})]; r = StreetRegions(roads)
        points, indices = road_markings(roads, (0, 0), lambda x, z: 0., r)
        half = roads[0]['width'] / 2
        self.assertTrue(all(abs(points[i + 2]) <= half + .01 for i in range(0, len(points), 3)))


class JunctionHoles(unittest.TestCase):
    def test_pocket_beside_a_junction_is_closed_but_islands_and_far_holes_stay(self):
        roads = t_junction()
        square = lambda cx, cz, h: [(cx - h, cz - h), (cx + h, cz - h), (cx + h, cz + h), (cx - h, cz + h)]
        ground = Polygon(square(0, 0, 60), [square(4, 4, .6), square(10, -10, 1.2), square(50, 50, .6)])  # 1.4 m2, 5.8 m2, 1.4 m2
        closed = fill_junction_holes(ground, roads)
        holes = sorted(round(Polygon(r).area, 1) for p in polygons_of(closed) for r in p.interiors)
        self.assertEqual(holes, [1.4, 5.8], 'the 1.4 m2 pocket 5 m from the node is closed; the larger island and the far hole stay')
        bend = fill_junction_holes(ground, roads[:2])
        self.assertEqual(sum(len(p.interiors) for p in polygons_of(bend)), 3, 'a plain two-street bend is not a junction: nothing is closed')


WEST = json.loads((Path(__file__).parent / 'fixtures' / 'west-robust-geometry.json').read_text())


class WestBakeCrashes(unittest.TestCase):
    """Inputs that stopped the west bake: each cell used to raise, and must now give clean polygonal geometry."""

    def test_overlay_of_invalid_rings_does_not_throw(self):
        for case in WEST['overlays']:
            a, b = shapely.from_wkb(case['a']), shapely.from_wkb(case['b'])
            self.assertFalse(a.is_valid, 'the fixture keeps the invalid ring that broke cell %s' % case['cell'])
            with self.assertRaises(shapely.errors.GEOSException):
                shapely.difference(a, b)
            result = diff(a, b)
            self.assertTrue(result.is_valid)
            self.assertIn(result.geom_type, ('Polygon', 'MultiPolygon'))
            self.assertGreater(result.area, 0)
            self.assertLessEqual(result.area, shapely.make_valid(a).area + 1e-6)
            self.assertLessEqual(meet(a, b).area, min(shapely.make_valid(a).area, b.area) + 1e-6)

    def test_valid_overlays_are_untouched(self):
        a, b = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)]), Polygon([(5, 5), (15, 5), (15, 15), (5, 15)])
        self.assertTrue(diff(a, b).equals_exact(shapely.difference(a, b), 0))
        self.assertTrue(meet(a, b).equals_exact(shapely.intersection(a, b), 0))

    def test_a_polygon_whose_snapping_splits_stays_flat_inside_a_multipolygon(self):
        polygon = shapely.from_wkb(WEST['splitPolygon']['wkb'])
        self.assertEqual(canonical_polygon(polygon).geom_type, 'MultiPolygon', 'the fixture still splits when snapped')
        far = Polygon([(100, 100), (110, 100), (110, 110), (100, 110)])
        result = canonical_polygon(shapely.MultiPolygon([polygon, far]))
        self.assertTrue(result.is_valid)
        self.assertTrue(all(g.geom_type == 'Polygon' for g in result.geoms))
        self.assertAlmostEqual(result.area, polygon.area + far.area, delta=1)

    def test_a_street_that_crosses_itself_keeps_a_sidewalk_beside_it(self):
        street = WEST['loopStreet']
        line = LineString(street['line'])
        self.assertFalse(line.is_simple, 'the fixture is the self-crossing street of cell -13,-9')
        for side, right in (('left', False), ('right', True)):
            width = street['sidewalk'][side]
            region = side_region(line, street['width'] / 2, width, right)
            self.assertTrue(region.is_valid)
            # a strip out to the sidewalk edge beside a 1.5 km street, not a filled loop: about length x reach
            reach = street['width'] / 2 + KERB_RUN + width
            self.assertLess(region.area, line.length * (reach + 1.5))
            self.assertGreater(region.area, line.length * reach * .8)
            for station in range(6, int(line.length) - 6, 3):
                a, b = line.interpolate(station - .5), line.interpolate(station + .5)
                dx, dz = b.x - a.x, b.y - a.y
                length = math.hypot(dx, dz) or 1.
                u = (1 if right else -1) * (street['width'] / 2 + KERB_RUN + width / 2); c = line.interpolate(station)
                point = Point(c.x - dz / length * u, c.y + dx / length * u)
                self.assertTrue(region.covers(point), 'sidewalk sample %s at station %d' % (side, station))



class SyntheticLaneArrowPrototype(unittest.TestCase):
    def setUp(self):
        from lane_indications_test import parsed,FIXTURE
        from shapely.geometry import box
        self.record=parsed(dict(highway='primary',oneway='yes',lanes='3',**{'turn:lanes':'left|through|right'}),[[512,0],[512,80]])
        self.glyphs=FIXTURE['glyphs'];self.surface=box(506,0,518,80);self.empty=Polygon()
    def height(self,cell=(0,0),slope=False,missing=False,duplicate=False):
        from surfaces import SurfaceHeight
        base=cell[0]*512*.01 if slope else 0;rise=5.12 if slope else 0
        p=[0,base,0,512,base+rise,0,512,base+rise,512,0,base,512];indices=[0,2,1,0,3,2]
        if missing:indices=[0,3,2]
        if duplicate:p+=p;indices+=[4,6,5,4,7,6]
        return SurfaceHeight(dict(cell=list(cell),positions=p,triangles=indices))
    def emit(self,cell=(0,0),**changes):
        from street_details import prototype_lane_arrow
        args=dict(record=self.record,direction=1,lane_index=1,station=40,glyphs=self.glyphs,cell=cell,height=self.height(cell),surface=self.surface,exclusions=self.empty,source_sha='a'*64,owner='w900:0',layer=0,synthetic=True)
        args.update(changes);return prototype_lane_arrow(**args)
    def test_whole_glyph_fits_then_tiles_clip_with_identical_seam_vertices(self):
        a,ar=self.emit();b,br=self.emit((1,0))
        self.assertTrue(ar['emitted'] and br['emitted']);self.assertFalse(ar['releaseEligible'])
        left={(a[0][i+1],a[0][i+2]) for i in range(0,len(a[0]),3) if a[0][i]==512}
        right={(b[0][i+1],b[0][i+2]) for i in range(0,len(b[0]),3) if b[0][i]==0}
        self.assertEqual(left,right);self.assertTrue(left)
        for (ps,ix),report in [( (a[0],a[1]),ar),((b[0],b[1]),br)]:
            self.assertEqual(report['triangles'],len(ix)//3);self.assertEqual(report['arrayBytes'],len(ps)*4+len(ix)*2)
    def test_junction_zebra_and_carriageway_gaps_omit_whole_glyph(self):
        from shapely.geometry import box
        for changes in [dict(exclusions=box(511.9,39.9,512.1,40.1)),dict(surface=self.surface.difference(box(511.9,39.9,512.1,40.1))),dict(surface=box(511.9,0,512.1,80))]:
            mesh,report=self.emit(**changes);self.assertEqual(mesh,([],[]));self.assertFalse(report['emitted']);self.assertIn('whole glyph',report['reason'])
    def test_wrong_source_owner_layer_missing_and_ambiguous_height_never_borrow(self):
        for changes in [dict(source_sha='b'*64),dict(owner='w901:0'),dict(layer=1),dict(height=lambda x,z:0),dict(height=self.height(missing=True)),dict(height=self.height(duplicate=True))]:
            with self.assertRaises(ValueError):self.emit(**changes)
    def test_every_vertex_conforms_to_exact_affine_surface(self):
        mesh,report=self.emit(height=self.height(slope=True))
        self.assertTrue(report['emitted'])
        for i in range(0,len(mesh[0]),3):self.assertAlmostEqual(mesh[0][i+1],mesh[0][i]*.01+.015,places=9)
    def test_no_markings_does_not_remove_zebra_or_independent_edge_lines(self):
        from shapely.geometry import box
        tagged={'highway':'primary','oneway':'yes','lanes':'2','maxspeed':'70','lane_markings':'no'}
        r=road('unmarked',[(-60,0),(60,0)],tagged,crossings=[(60,0,0,True)])
        self.assertEqual({style for offset,style in line_offsets(r['section'],r['width'])},{'solid'})
        # The crossing emitter is independent of longitudinal separator policy.
        region=StreetRegions([r]);self.assertTrue(region.zebras)
        ps,ix=road_markings([r],(-1,-1),lambda x,z:0,region)
        bare=road('unmarked',[(-60,0),(60,0)],tagged)
        _,base_ix=road_markings([bare],(-1,-1),lambda x,z:0,StreetRegions([bare]))
        self.assertGreater(len(ix),len(base_ix))

if __name__ == '__main__':
    unittest.main()
