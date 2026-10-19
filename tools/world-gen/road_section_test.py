"""Tag -> cross-section mapping. Pure Python: runs anywhere python3 does."""
import itertools, json, unittest
from pathlib import Path
from road_section import CLASSES, KERB_RISE, SIDEWALK_MAX, SIDEWALK_MIN, cross_section, width_band

FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'coast-road-tags.json').read_text())


def section(**tags):
    return cross_section({k.replace('__', ':'): v for k, v in tags.items()})


class Defaults(unittest.TestCase):
    """Missing tags: every class falls back to the documented per-class default."""
    EXPECT = {  # class: (two-way width, one-way width, sidewalk each side)
        'motorway': (14.4, 10.8, 0), 'trunk': (14.0, 7.0, 2.0), 'primary': (7.0, 7.0, 2.5), 'secondary': (6.6, 6.6, 2.2),
        'tertiary': (6.4, 5.6, 2.0), 'unclassified': (6.0, 5.0, 1.8), 'residential': (6.0, 4.8, 1.8),
        'living_street': (6.0, 4.2, 1.5), 'service': (4.8, 3.2, 0), 'road': (6.0, 4.5, 1.5),
        'primary_link': (6.8, 4.5, 0), 'trunk_link': (6.8, 4.5, 0), 'tertiary_link': (6.4, 4.5, 0),
    }

    def test_class_defaults(self):
        for klass, (two, one, sidewalk) in self.EXPECT.items():
            with self.subTest(klass=klass):
                s = cross_section({'highway': klass, 'oneway': 'no'})
                self.assertEqual(s['class'], klass)
                self.assertEqual(s['surface'], 'asphalt')
                self.assertAlmostEqual(s['width'], two, 3, 'two-way default width')
                self.assertEqual(s['widthSource'], 'class')
                self.assertEqual(s['sidewalk'], {'left': float(sidewalk), 'right': float(sidewalk)})
                self.assertEqual(s['sidewalkSource']['left'], 'class' if sidewalk else 'none')
                self.assertEqual(s['kerb'], KERB_RISE if sidewalk else 0.)
                o = cross_section({'highway': klass, 'oneway': 'yes'})
                self.assertAlmostEqual(o['width'], one, 3, 'one-way default width')
                self.assertEqual(o['oneway'], 1)

    def test_unknown_class_is_a_generic_road(self):
        s = cross_section({'highway': 'track'})
        self.assertEqual(s['class'], 'road')
        self.assertEqual(s['surface'], 'unpaved')
        self.assertEqual(cross_section({})['class'], 'road')

    def test_motorways_and_roundabouts_are_one_way_without_a_tag(self):
        self.assertEqual(cross_section({'highway': 'motorway'})['oneway'], 1)
        self.assertEqual(cross_section({'highway': 'residential', 'junction': 'roundabout'})['oneway'], 1)
        self.assertEqual(cross_section({'highway': 'residential', 'oneway': '-1'})['oneway'], -1)


class Lanes(unittest.TestCase):
    def test_lane_tag_sets_width_in_whole_lanes(self):
        for lanes in range(1, 6):
            s = section(highway='primary', lanes=str(lanes), oneway='yes')
            self.assertEqual(s['lanes'], lanes)
            self.assertAlmostEqual(s['width'], max(6.6, min(17.5, lanes * 3.5)), 3)

    def test_two_way_has_a_lane_each_way(self):
        s = section(highway='residential', lanes='1')
        self.assertEqual((s['lanes'], s['lanesForward'], s['lanesBackward']), (2, 1, 1))

    def test_directional_lane_tags(self):
        s = section(highway='secondary', lanes__forward='2', lanes__backward='1')
        self.assertEqual((s['lanes'], s['lanesForward'], s['lanesBackward']), (3, 2, 1))
        self.assertAlmostEqual(s['width'], 9.9, 3)

    def test_odd_lane_count_gives_forward_the_extra_lane(self):
        s = section(highway='tertiary', lanes='3')
        self.assertEqual((s['lanesForward'], s['lanesBackward']), (2, 1))

    def test_width_tag_without_lanes_sets_lane_count_and_is_clamped(self):
        s = section(highway='tertiary', width='9')
        self.assertEqual((s['widthSource'], s['width'], s['lanes']), ('width', 9.0, 3))
        self.assertEqual(section(highway='residential', width='1.2')['width'], 4.8)
        self.assertEqual(section(highway='residential', width='40')['width'], 8.0)
        self.assertEqual(section(highway='residential', est_width='5.5', oneway='yes')['width'], 5.5)

    def test_lane_tag_beats_width_tag(self):
        s = section(highway='tertiary', lanes='2', width='11')
        self.assertEqual((s['widthSource'], s['width']), ('lanes', 6.4))

    def test_garbage_values_fall_back(self):
        for tags in ({'lanes': 'many'}, {'lanes': '0'}, {'lanes': '99'}, {'width': 'wide'}, {'width': '-3'}, {'lanes': '2;3'}):
            with self.subTest(tags=tags):
                s = cross_section({'highway': 'residential', **tags})
                lo, hi = width_band('residential')
                self.assertTrue(lo <= s['width'] <= hi)

    def test_every_road_of_a_class_and_lane_count_has_one_width(self):
        widths = {}
        for combo in FIXTURE['combos']:
            s = cross_section(combo['tags'])
            if s['widthSource'] == 'width':
                continue
            widths.setdefault((s['class'], s['lanes'], s['oneway'] != 0), set()).add(s['width'])
        self.assertTrue(all(len(v) == 1 for v in widths.values()), widths)


class Sidewalks(unittest.TestCase):
    def sides(self, **tags):
        s = section(highway='residential', **tags)
        return s['sidewalk']['left'], s['sidewalk']['right'], s['sidewalkSource']

    def test_tag_values(self):
        self.assertEqual(self.sides(sidewalk='both')[:2], (1.8, 1.8))
        self.assertEqual(self.sides(sidewalk='yes')[:2], (1.8, 1.8))
        self.assertEqual(self.sides(sidewalk='left')[:2], (1.8, 0.))
        self.assertEqual(self.sides(sidewalk='right')[:2], (0., 1.8))
        self.assertEqual(self.sides(sidewalk='no')[:2], (0., 0.))
        self.assertEqual(self.sides(sidewalk='none')[:2], (0., 0.))
        self.assertEqual(self.sides(sidewalk__left='yes', sidewalk__right='no')[:2], (1.8, 0.))
        self.assertEqual(self.sides(sidewalk__both='no')[:2], (0., 0.))
        self.assertEqual(self.sides(sidewalk='both', sidewalk__right='no')[:2], (1.8, 0.))
        self.assertEqual(self.sides(sidewalk='no')[2], {'left': 'tag', 'right': 'tag'})

    def test_separate_without_a_mapped_footway_uses_the_class_default(self):
        left, right, source = self.sides(sidewalk='separate')
        self.assertEqual((left, right, source['left']), (1.8, 1.8, 'class'))

    def test_snapped_footways_enable_sidewalks_beyond_the_class_default(self):
        s = cross_section({'highway': 'service'}, hints={'left': True, 'right': 2.3})
        self.assertEqual(s['sidewalk'], {'left': 1.8, 'right': 2.3})
        self.assertEqual(s['sidewalkSource'], {'left': 'mapped', 'right': 'mapped'})
        self.assertEqual(cross_section({'highway': 'service', 'sidewalk': 'no'}, hints={'left': True})['sidewalk']['left'], 0.)

    def test_tagged_widths(self):
        s = section(highway='primary', sidewalk__left__width='3.1', sidewalk='both')
        self.assertEqual((s['sidewalk']['left'], s['sidewalk']['right']), (3.1, 2.5))
        self.assertEqual(section(highway='primary', sidewalk='both', sidewalk__left__width='0.2')['sidewalk']['left'], 2.5)

    def test_bridges_tunnels_and_unpaved_streets_have_none(self):
        for tags in ({'bridge': 'yes'}, {'tunnel': 'yes'}, {'surface': 'gravel'}, {'surface': 'dirt'}):
            with self.subTest(tags=tags):
                s = cross_section({'highway': 'primary', 'sidewalk': 'both', **tags})
                self.assertEqual(s['sidewalk'], {'left': 0., 'right': 0.})
                self.assertEqual(s['kerb'], 0.)

    def test_sidewalk_widths_stay_in_range(self):
        for combo in FIXTURE['combos']:
            s = cross_section(combo['tags'])
            for width in s['sidewalk'].values():
                self.assertTrue(width == 0 or SIDEWALK_MIN <= width <= SIDEWALK_MAX, combo)

    def test_present_where_tagged_or_class_default(self):
        for combo in FIXTURE['combos']:
            tags = combo['tags']; s = cross_section(tags)
            if tags.get('bridge') or tags.get('tunnel') or s['surface'] == 'unpaved':
                continue
            klass = s['class']
            for side in ('left', 'right'):
                tagged = tags.get('sidewalk:' + side) or tags.get('sidewalk:both') or tags.get('sidewalk')
                tagged = {'left': 'yes' if side == 'left' else 'no', 'right': 'yes' if side == 'right' else 'no'}.get(tagged, tagged) if tagged in ('left', 'right') else tagged
                if tagged in ('yes', 'both'):
                    self.assertGreater(s['sidewalk'][side], 0, combo)
                elif tagged in ('no', 'none'):
                    self.assertEqual(s['sidewalk'][side], 0, combo)
                else:
                    self.assertEqual(s['sidewalk'][side] > 0, CLASSES[klass][5] > 0, combo)


class Surfaces(unittest.TestCase):
    def test_surface_classes(self):
        cases = {'asphalt': 'asphalt', 'concrete': 'concrete', 'paving_stones': 'paving', 'sett': 'paving', 'cobblestone': 'paving',
                 'gravel': 'unpaved', 'dirt': 'unpaved', 'unpaved': 'unpaved', 'compacted': 'unpaved', 'asphalt;concrete': 'asphalt', 'weird': 'asphalt'}
        for value, expected in cases.items():
            self.assertEqual(section(highway='residential', surface=value)['surface'], expected, value)
        self.assertEqual(section(highway='residential')['surface'], 'asphalt')

    def test_only_asphalt_and_concrete_carry_paint(self):
        for value in ('paving_stones', 'gravel'):
            m = section(highway='primary', lanes='4', surface=value)['markings']
            self.assertEqual((m['centre'], m['lane'], m['edge']), ('none', 'none', 'none'))


class Markings(unittest.TestCase):
    def test_two_lane_streets(self):
        self.assertEqual(section(highway='residential')['markings']['centre'], 'dashed')
        self.assertEqual(section(highway='residential', oneway='yes')['markings']['centre'], 'none')
        self.assertEqual(section(highway='service')['markings']['centre'], 'none')
        self.assertEqual(section(highway='living_street')['markings']['centre'], 'none')

    def test_fast_roads_get_edge_lines_and_solid_centre(self):
        m = section(highway='primary', maxspeed='70')['markings']
        self.assertEqual((m['centre'], m['edge']), ('solid', 'solid'))
        self.assertEqual(section(highway='primary', maxspeed='50')['markings']['centre'], 'dashed')
        self.assertEqual(section(highway='tertiary', maxspeed='70')['markings']['edge'], 'solid')
        self.assertEqual(section(highway='residential')['markings']['edge'], 'none')

    def test_multi_lane(self):
        m = section(highway='trunk', lanes='4')['markings']
        self.assertEqual((m['centre'], m['lane']), ('double', 'dashed'))
        m = section(highway='primary', lanes='3', oneway='yes')['markings']
        self.assertEqual((m['centre'], m['lane']), ('none', 'dashed'))
        self.assertEqual(section(highway='primary', lanes='1', oneway='yes')['markings']['lane'], 'none')

    def test_dash_pattern_follows_maxspeed(self):
        self.assertEqual(section(highway='residential', maxspeed='30')['markings']['dash'], [3., 3.])
        self.assertEqual(section(highway='primary', maxspeed='70')['markings']['dash'], [3., 9.])
        self.assertEqual(section(highway='motorway', maxspeed='120')['markings']['dash'], [6., 12.])


class Recorded(unittest.TestCase):
    def test_parking_lit_and_speed_are_recorded(self):
        s = section(highway='residential', parking__lane__right='parallel', parking__lane__left='no_parking', lit='yes', maxspeed='30')
        self.assertEqual(s['parking'], {'left': None, 'right': 'parallel'})
        self.assertEqual((s['lit'], s['maxspeed']), (True, 30.))
        self.assertIsNone(section(highway='residential')['lit'])

    def test_serialisable_and_deterministic(self):
        for combo in FIXTURE['combos']:
            a = cross_section(combo['tags']); b = cross_section(dict(reversed(list(combo['tags'].items()))))
            self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))


class Bands(unittest.TestCase):
    def test_every_tag_combination_stays_inside_its_class_band(self):
        values = {'lanes': [None, '1', '2', '3', '4', '8', '16', '30', 'x'], 'width': [None, '0.5', '3', '6', '12', '70', 'x'],
                  'oneway': [None, 'yes', '-1', 'no'], 'surface': [None, 'asphalt', 'gravel']}
        checked = 0
        for klass in list(CLASSES) + ['track', 'path', None]:
            lo, hi = width_band(klass)
            for lanes, width, oneway, surface in itertools.product(*values.values()):
                tags = {'highway': klass} if klass else {}
                for k, v in zip(('lanes', 'width', 'oneway', 'surface'), (lanes, width, oneway, surface)):
                    if v is not None:
                        tags[k] = v
                s = cross_section(tags); checked += 1
                self.assertTrue(lo <= s['width'] <= hi, (tags, s['width'], lo, hi))
        self.assertGreater(checked, 5000)

    def test_real_coast_tag_combinations(self):
        self.assertEqual(FIXTURE['roads'], 1744)
        self.assertGreater(len(FIXTURE['combos']), 100)
        for combo in FIXTURE['combos']:
            s = cross_section(combo['tags']); lo, hi = width_band(s['class'])
            self.assertTrue(lo <= s['width'] <= hi, combo)
            self.assertEqual(s['lanes'], s['lanesForward'] + s['lanesBackward'])


class Table(unittest.TestCase):
    def test_exported_table_matches_the_model(self):
        from road_section import export_table
        self.assertEqual(json.loads((Path(__file__).parent / 'fixtures' / 'road-classes.json').read_text()), json.loads(json.dumps(export_table())),
                         'regenerate with: python3 tools/world-gen/road_section.py > tools/world-gen/fixtures/road-classes.json')


if __name__ == '__main__':
    unittest.main()
