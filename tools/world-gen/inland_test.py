import json
import sqlite3
import unittest
from shapely.geometry import Polygon
from inland import VerifiedInland,validate_facts
from coastal import Coast


class InlandPrerequisite(unittest.TestCase):
    def test_positive_full_coverage_is_explicit(self):
        validate_facts([23,37,24,39],(0,0,512,512),0,250,False)
        for args,message in [(([23.74,37,24,39],(0,0,512,512),0,250,False),'coverage'),(([23,37,24,39],(0,0,512,512),1,250,False),'coastline'),(([23,37,24,39],(0,0,512,512),0,0,False),'sea ambiguity'),(([23,37,24,39],(0,0,512,512),0,250,True),'missing')]:
            with self.assertRaisesRegex(ValueError,message):validate_facts(*args)

    def test_actual_water_masks_preserve_tags_and_holes(self):
        coast=object.__new__(VerifiedInland);coast.waters=[('water:w1',Polygon([(10,10),(100,10),(100,100),(10,100)],holes=[[(30,30),(50,30),(50,50),(30,50)]]),{'natural':'water','water':'pond'})]
        masks=coast.water_masks((0,0));self.assertEqual(masks[0]['tags'],{'natural':'water','water':'pond'});self.assertEqual(len(masks[0]['geometry']['coordinates']),2)
        self.assertTrue(coast.water((0,0),[]).is_empty)

    def test_inland_baseline_never_invents_zero_water_or_extrapolates(self):
        coast=object.__new__(VerifiedInland);coast.bounds=(0,0,512,512)
        self.assertEqual(coast.baseline(30,40,317.25),317.25)
        for x,y in [(30,0),(600,300)]:
            with self.assertRaisesRegex(ValueError,'verified DEM'):coast.baseline(x,40,y)

    def test_default_coast_still_requires_resolved_osm_mainland(self):
        db=sqlite3.connect(':memory:');db.execute('CREATE TABLE metadata(key,value)');db.execute('INSERT INTO metadata VALUES(?,?)',('manifest',json.dumps({'masks':{'c_attica_mainland':None}})))
        with self.assertRaisesRegex(ValueError,'Resolved OSM mainland coast required'):Coast(db,(0,0))
        db.close()


if __name__=='__main__':unittest.main()
