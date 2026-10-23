"""Own synthetic source receipts: no surveyed arrow positions or real paint claims."""
import copy
import json
import unittest
from pathlib import Path
from lane_indications import digest,parse_lane_indications,synthetic_arrow_polygons

FIXTURE=json.loads((Path(__file__).parent/'fixtures/lane-indications-synthetic.json').read_text())


def receipt(tags,points=None):
    points=points or [[0,0],[0,80]]
    source=dict(kind='synthetic-fixture',sourceSha256='a'*64,wayId='w900',version=3,timestamp='2026-01-01T00:00:00Z',
        points=points,nodeRefs=[str(9000+i) for i in range(len(points))],wayOrientation='original-node-order',normalizedRoadIds=['w900:0'],
        geometrySha256=digest(points),tagsSha256=digest(tags))
    source['nodeRefsSha256']=digest(source['nodeRefs'])
    expected={k:source[k] for k in ('sourceSha256','wayId','version','timestamp','nodeRefsSha256','geometrySha256','tagsSha256','wayOrientation','normalizedRoadIds')}
    return source,copy.deepcopy(expected)


def parsed(tags,points=None):
    source,expected=receipt(tags,points)
    return parse_lane_indications(tags,source,expected)


class DirectionalRecords(unittest.TestCase):
    def setUp(self):self.tags=dict(highway='primary',oneway='yes',lanes='3',**{'turn:lanes':'left|through|through'})
    def test_oneway_left_through_through_retains_original_receipt_not_paint(self):
        source,expected=receipt(self.tags);result=parse_lane_indications(self.tags,source,expected)
        self.assertEqual(result['unresolved'],[]);self.assertEqual([r['turns'] for r in result['indications']],[['left'],['through'],['through']])
        self.assertEqual([r['laneIndex'] for r in result['indications']],[0,1,2]);self.assertEqual(result['source'],source)
        self.assertFalse(result['paintEvidence']);self.assertFalse(result['releaseEligible'])
        source['nodeRefs'].reverse();self.assertNotEqual(result['source'],source)
    def test_backward_and_explicit_two_plus_two_driving_lane_order(self):
        reverse=parsed({**self.tags,'oneway':'-1'});self.assertEqual({r['direction'] for r in reverse['indications']},{-1})
        both=parsed(dict(highway='primary',lanes='4',**{'lanes:forward':'2','lanes:backward':'2','turn:lanes:forward':'left|through','turn:lanes:backward':'through|right'}))
        self.assertEqual(both['unresolved'],[]);self.assertEqual([(r['direction'],r['laneIndex'],r['turns']) for r in both['indications']],[(-1,0,['through']),(-1,1,['right']),(1,0,['left']),(1,1,['through'])])
    def test_combinations_empty_and_none_never_become_through(self):
        r=parsed({**self.tags,'turn:lanes':'left;through||none'})
        self.assertEqual([v['turns'] for v in r['indications']],[['left','through'],[],[]])
    def test_mismatch_conflicts_and_unknown_tokens_are_unresolved(self):
        cases=[{'turn:lanes':'left|through'},{'lanes':'17'},{'lanes:forward':'2'},{'lanes:backward':'1'},
            {'turn:lanes:forward':'right|through|through'},{'turn:lanes':'left;none|through|through'},
            {'turn:lanes':'merge_to_left|through|through'},{'turn:lanes':'left;left|through|through'},
            {'oneway':'no'},{'oneway':'alternating'},{'lanes:both_ways':'1'},
            {'turn:lanes:conditional':'left|through|through @ (Mo-Fr)'},{'access:lanes':'yes|no|yes'}, {'access':'private'}]
        for change in cases:
            with self.subTest(change=change):
                r=parsed({**self.tags,**change});self.assertTrue(r['unresolved']);self.assertEqual(r['indications'],[])
    def test_directional_count_sum_and_opposite_oneway_indications_fail(self):
        for tags in [dict(highway='primary',lanes='3',**{'lanes:forward':'2','lanes:backward':'2','turn:lanes:forward':'left|through'}),{**self.tags,'turn:lanes:backward':'right'}]:
            r=parsed(tags);self.assertTrue(r['unresolved']);self.assertEqual(r['indications'],[])
    def test_source_sha_version_orientation_mapping_and_geometry_cannot_be_swapped(self):
        for key,value in [('sourceSha256','b'*64),('version',4),('wayId','w901'),('wayOrientation','reverse'),('normalizedRoadIds',['w901:0']),('geometrySha256','c'*64),('tagsSha256','d'*64),('timestamp','')]:
            source,expected=receipt(self.tags);source[key]=value;r=parse_lane_indications(self.tags,source,expected)
            self.assertTrue(r['unresolved'],key);self.assertEqual(r['indications'],[])
        source,expected=receipt(self.tags);source['nodeRefs'].reverse()
        self.assertIn('source node orientation hash mismatch',parse_lane_indications(self.tags,source,expected)['unresolved'])
        source,expected=receipt(self.tags);source['points'][1][1]=81
        self.assertIn('source geometry hash mismatch',parse_lane_indications(self.tags,source,expected)['unresolved'])
    def test_ordinary_generation_modules_do_not_import_lane_indications(self):
        import ast
        root=Path(__file__).parent
        for name in ('tiles.py','sections.py','road_section.py'):
            tree=ast.parse((root/name).read_text())
            for node in ast.walk(tree):
                if isinstance(node,ast.ImportFrom):self.assertNotEqual(node.module,'lane_indications',name)
                elif isinstance(node,ast.Import):self.assertNotIn('lane_indications',[a.name for a in node.names],name)
    def test_input_records_remain_owned_by_caller(self):
        source,expected=receipt(self.tags);before=copy.deepcopy((self.tags,source,expected));r=parse_lane_indications(self.tags,source,expected)
        self.assertEqual((self.tags,source,expected),before);r['rawTags']['oneway']='no';self.assertEqual(self.tags['oneway'],'yes')


class SyntheticGeometry(unittest.TestCase):
    def setUp(self):self.tags=dict(highway='primary',oneway='yes',lanes='3',**{'turn:lanes':'left|through|through'})
    def glyph(self,record,direction=1,lane=0,station=40):return synthetic_arrow_polygons(record,direction,lane,station,FIXTURE['glyphs'],synthetic=True)
    def test_no_implicit_optin_real_receipt_mutation_or_untagged_arrows(self):
        record=parsed(self.tags)
        with self.assertRaisesRegex(ValueError,'Synthetic-only'):synthetic_arrow_polygons(record,1,0,40,FIXTURE['glyphs'])
        record['source']['kind']='osm-source';record['recordSha256']=digest({k:v for k,v in record.items() if k!='recordSha256'})
        with self.assertRaisesRegex(ValueError,'Synthetic-only'):self.glyph(record)
        record=parsed(self.tags);record['indications'][0]['turns']=['right']
        with self.assertRaisesRegex(ValueError,'Mutated'):self.glyph(record)
        for value in ['none|through|through','|through|through']:
            with self.assertRaisesRegex(ValueError,'Missing explicit'):self.glyph(parsed({**self.tags,'turn:lanes':value}))
    def test_original_way_reversal_preserves_world_geometry_and_driving_left(self):
        a,_=self.glyph(parsed(self.tags));b,_=self.glyph(parsed({**self.tags,'oneway':'-1'},[[0,80],[0,0]]),-1)
        self.assertLess(a.symmetric_difference(b).area,1e-10);self.assertGreater(a.centroid.x,0)
        _,report=self.glyph(parsed(self.tags));self.assertFalse(report['releaseEligible']);self.assertFalse(report['paintEvidence'])
    def test_combination_glyph_is_union_and_has_explicit_template_hash(self):
        a,_=self.glyph(parsed({**self.tags,'turn:lanes':'left;through|through|through'}));left,_=self.glyph(parsed(self.tags));through,report=self.glyph(parsed({**self.tags,'turn:lanes':'through|through|through'}))
        self.assertLess(a.symmetric_difference(left.union(through)).area,1e-10);self.assertEqual(report['templateSha256'],digest(FIXTURE['glyphs']))
    def test_unsolved_structures_and_invalid_station_or_template_fail(self):
        for change in [{'bridge':'yes'},{'tunnel':'yes'},{'layer':'1'}]:
            with self.assertRaisesRegex(ValueError,'structure/layer'):self.glyph(parsed({**self.tags,**change}))
        for material in ['gravel','paving_stones']:
            with self.assertRaisesRegex(ValueError,'material'):self.glyph(parsed({**self.tags,'surface':material}))
        for station in [-1,0,80,float('nan')]:
            with self.assertRaisesRegex(ValueError,'station'):self.glyph(parsed(self.tags),station=station)
        with self.assertRaisesRegex(ValueError,'template'):synthetic_arrow_polygons(parsed(self.tags),1,0,40,{},synthetic=True)
        with self.assertRaisesRegex(ValueError,'modelled lane'):synthetic_arrow_polygons(parsed(self.tags),1,0,40,{'left':[[-20,-1],[20,-1],[0,1]]},synthetic=True)

if __name__=='__main__':unittest.main()
