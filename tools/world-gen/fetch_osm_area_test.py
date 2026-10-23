import importlib.util
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
import xml.etree.ElementTree as ET

spec=importlib.util.spec_from_file_location('bounded_osm',Path(__file__).with_name('fetch-osm-area.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class OfficialAreaSource(unittest.TestCase):
    def test_preserves_way_order_and_rejects_snapshot_conflict(self):
        objects={};root=ET.fromstring('<osm><way id="21" version="12"><nd ref="43"/><nd ref="41"/><nd ref="44"/></way></osm>')
        m.merge(objects,root);m.merge(objects,root)
        self.assertEqual([n.attrib['ref'] for n in objects['way','21'].findall('nd')],['43','41','44'])
        with self.assertRaisesRegex(ValueError,'snapshot conflict'):
            m.merge(objects,ET.fromstring('<osm><way id="21" version="13"/></osm>'))

    def test_subdivision_closes_restriction_way_and_reports_other_missing_members(self):
        calls=[]
        def request(url):
            calls.append(url)
            if len(calls)==1:
                raise urllib.error.HTTPError(url,400,'limit',{},io.BytesIO(b'You requested too many nodes (limit is 50000).'))
            if '/way/9/full' in url:return b'<osm><node id="2" lat="38" lon="23"/><way id="9"><nd ref="2"/></way></osm>'
            return b'<osm><node id="1" lat="38" lon="23"/><way id="8"><nd ref="1"/></way><relation id="3"><member type="way" ref="8" role="from"/><member type="way" ref="9" role="to"/><tag k="type" v="restriction"/></relation><relation id="4"><member type="way" ref="99" role="outer"/><tag k="type" v="multipolygon"/></relation></osm>'
        with tempfile.TemporaryDirectory() as folder:
            result=m.fetch_area([23,38,23.1,38.1],Path(folder)/'source.osm',request)
            self.assertEqual(len(calls),4);self.assertTrue(result['restrictionClosureComplete'])
            self.assertEqual(result['missingWayNodes'],[])
            self.assertEqual(result['unresolvedRelationMembers'],[dict(relation='4',restriction=False,type='way',ref='99',role='outer')])
            self.assertEqual(result['counts'],dict(node=2,way=2,relation=2))

    def test_missing_road_nodes_fail_closed_with_report(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)/'source.osm'
            with self.assertRaisesRegex(ValueError,'Incomplete road/restriction closure'):
                m.fetch_area([23,38,23.01,38.01],output,lambda url:b'<osm><way id="8"><nd ref="999"/></way></osm>')
            self.assertTrue(output.with_suffix('.source.json').exists())
            self.assertTrue(output.with_suffix('.failure.json').exists())


if __name__=='__main__':unittest.main()
