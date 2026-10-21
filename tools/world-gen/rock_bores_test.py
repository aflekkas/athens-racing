import unittest,math
from shapely.geometry import LineString
import rock_bores
from bridge_policy import exclusion_reason

class RockBores(unittest.TestCase):
    def road(self):
        # An actual mapped bore crosses row 36; this also exercises ownership.
        return dict(id='w172988026:0',way='w172988026',tunnel=True,bridge=False,layer=-1,width=7.,nodeRefs=['a','b'],line=LineString([(9090.639,18385.522),(9089.638,18402.665),(9087.568,18411.282),(9083.979,18418.662),(9079.53,18426.443),(9073.195,18432.555)]))
    def test_only_source_verified_bores_are_supported(self):
        r=self.road();self.assertIsNone(exclusion_reason(r,None))
        for patch in [dict(id='w999:0'),dict(way='w999'),dict(layer=0)]:
            self.assertEqual(exclusion_reason(dict(r,**patch),None),'tunnel')
    def test_crossing_road_requires_a_separate_structure(self):
        r=self.road();other=dict(r,id='w2:0',nodeRefs=['c','d'],line=LineString([(9000,18400),(9200,18400)]))
        with self.assertRaisesRegex(ValueError,'overpassing'):rock_bores.validate([r,other])
    def test_cell_owned_shell_and_continuous_walls(self):
        r=self.road();counts=[]
        for cell in [(17,35),(17,36)]:
            ps,ix,walls,records=rock_bores.build([r],cell,lambda x,z:10+.01*(z-18400))
            self.assertTrue(ps and ix and walls and records)
            self.assertTrue(all(-1e-6<=ps[i]<=512+1e-6 for i in range(len(ps)) if i%3!=1))
            self.assertTrue(all(-1e-6<=v<=512+1e-6 for row in walls for i,v in enumerate(row[:6]) if i%3!=1))
            self.assertTrue(all(row[6]==3.6 for row in walls))
            counts.append(len(ix))
        self.assertTrue(all(counts))
if __name__=='__main__':unittest.main()
