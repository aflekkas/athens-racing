"""Ground classes, the park and facade lookups, and the shore-foam strip (needs shapely)."""
import json,os,sqlite3,tempfile,unittest
from shapely.geometry import Polygon,box
from shapely import wkb
import appearance
from appearance import ground_category,ground_colour,TERRAIN,linear
from tile_detail import foam_mesh,park_areas,facade_styles

class GroundClasses(unittest.TestCase):
 def test_each_osm_class_lands_in_its_own_ground_class(self):
  g=lambda landuse='',natural='',leisure='',h=30,slope=.1,coast=1e9:ground_category(h,slope,landuse,natural,coast,leisure)
  self.assertEqual(g('commercial'),'urban');self.assertEqual(g('industrial'),'urban')
  self.assertEqual(g('residential'),'urban');self.assertEqual(g(),'earth')  # residual block ground is courtyard paving; open land stays earth
  self.assertEqual(g(leisure='park'),'grass');self.assertEqual(g('grass'),'grass');self.assertEqual(g(natural='grassland'),'grass')
  self.assertEqual(g(natural='scrub'),'scrub');self.assertEqual(g(natural='heath'),'scrub')
  self.assertEqual(g('forest'),'forest');self.assertEqual(g(natural='wood'),'forest')
  self.assertEqual(g(natural='beach'),'sand');self.assertEqual(g(h=3,slope=.05,coast=10),'sand')
  self.assertEqual(g(natural='bare_rock'),'rock');self.assertEqual(g(slope=.5),'rock')
 def test_steep_ground_is_rock_even_in_a_park(self):
  self.assertEqual(ground_category(250,.6,'','',1e9,'park'),'rock')
 def test_colours_stay_within_the_bakes_brightness_variation(self):
  for name,hexcolour in TERRAIN.items():
   base=linear(hexcolour)
   for x in range(0,400,37):
    cat,rgb=ground_colour(x,x*.7,40,.1,**{'landuse':{'urban':'commercial','grass':'grass','forest':'forest'}.get(name,''),'natural':{'sand':'beach','scrub':'scrub','rock':'bare_rock'}.get(name,'')})
    self.assertEqual(cat,name);self.assertTrue(all(.93<=c/b<=1.07 for c,b in zip(rgb,base)))
 def test_grass_and_forest_are_new_classes(self):
  self.assertIn('grass',TERRAIN);self.assertIn('forest',TERRAIN);self.assertEqual(len(TERRAIN),7)

class Lookups(unittest.TestCase):
 def test_parks_come_from_the_vegetation_cache_and_only_those_touching_the_cell(self):
  with tempfile.TemporaryDirectory() as d:
   path=os.path.join(d,'veg.sqlite');db=sqlite3.connect(path);db.execute('CREATE TABLE areas(id TEXT PRIMARY KEY,geometry BLOB,tags TEXT)')
   db.execute('INSERT INTO areas VALUES(?,?,?)',('a',box(100,100,200,200).wkb,'{}'));db.execute('INSERT INTO areas VALUES(?,?,?)',('b',box(2000,2000,2100,2100).wkb,'{}'));db.commit();db.close()
   found=park_areas(path,0,0);self.assertEqual(len(found),1);self.assertEqual(found[0][1],{'leisure':'park'});self.assertEqual(park_areas(None,0,0),[])
 def test_facade_style_comes_from_the_building_details_cache(self):
  with tempfile.TemporaryDirectory() as d:
   path=os.path.join(d,'details.sqlite');db=sqlite3.connect(path);db.execute('CREATE TABLE buildings(id TEXT PRIMARY KEY,data TEXT)')
   db.execute('INSERT INTO buildings VALUES(?,?)',('w10',json.dumps({'facadeStyle':4})));db.execute('INSERT INTO buildings VALUES(?,?)',('r20',json.dumps({'facadeStyle':7})));db.commit();db.close()
   self.assertEqual(facade_styles(path,['building:w10:0','building:r20:1','building:w99:0']),[4,7,0]);self.assertEqual(facade_styles(None,['building:w10:0']),[0])

class Foam(unittest.TestCase):
 def sea(self):return box(0,0,512,512).difference(box(200,0,512,512))   # sea on the west, a straight shore at x=200
 def test_foam_hugs_the_shore_and_not_the_cell_edges(self):
  ps,ix,foam=foam_mesh(self.sea(),0,0,6.)
  self.assertTrue(ix and len(ix)%3==0);self.assertEqual(len(foam),len(ps)//3);self.assertTrue(all(0<=f<=1 for f in foam))
  xs=[ps[i] for i in range(0,len(ps),3)];self.assertGreater(min(xs),193.9);self.assertLess(max(xs),200.1,'only the 6 m strip beside the shore')
  for i in range(0,len(ps),3):
   expected=max(0,1-(200-ps[i])/6);self.assertAlmostEqual(foam[i//3],expected,places=3)
 def test_a_cell_with_no_shore_has_no_foam(self):
  self.assertEqual(foam_mesh(box(0,0,512,512),0,0),([],[],[]));self.assertEqual(foam_mesh(None,0,0),([],[],[]))
 def test_triangles_are_not_degenerate(self):
  ps,ix,foam=foam_mesh(self.sea(),0,0)
  for i in range(0,len(ix),3):
   a,b,c=(ps[ix[i+k]*3:ix[i+k]*3+3] for k in range(3));cross=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])
   self.assertLess(cross*-1,0.0001) if False else self.assertNotEqual(cross,0)
if __name__=='__main__':unittest.main()


class CourtyardGround(unittest.TestCase):
    def test_yards_are_grass_and_most_block_ground_is_paving(self):
        from appearance import ground_colour, yard
        cells=[(i*24.0+12,j*24.0+12) for i in range(80) for j in range(80)]
        share=sum(yard(x,z) for x,z in cells)/len(cells)
        self.assertTrue(0.05<share<0.15, share)
        classes=[ground_colour(x,z,20,.05,landuse='residential')[0] for x,z in cells]
        self.assertEqual(set(classes),{'urban','grass'})
        self.assertEqual(ground_colour(0,0,20,.05,landuse='residential',leisure='garden')[0],'grass')
        self.assertEqual(ground_colour(0,0,20,.05)[0],'earth')
