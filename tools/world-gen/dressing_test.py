"""Ground classes, the park and facade lookups, and the shore-foam strip (needs shapely)."""
import importlib.util,json,os,sqlite3,tempfile,unittest
from shapely.geometry import Polygon,box
from shapely import wkb
import appearance
from appearance import ground_category,ground_colour,TERRAIN,linear
from tile_detail import foam_mesh,park_areas,facade_styles

class GroundClasses(unittest.TestCase):
 def test_each_osm_class_lands_in_its_own_ground_class(self):
  g=lambda landuse='',natural='',leisure='',h=30,slope=.1,coast=1e9:ground_category(h,slope,landuse,natural,coast,leisure)
  self.assertEqual(g('commercial'),'urban');self.assertEqual(g('industrial'),'urban')
  self.assertEqual(g('residential'),'urban');self.assertEqual(g(),'earth')  # residential urban is a styling default, not surveyed paving
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


class SourceGreenAreas(unittest.TestCase):
 def test_lookup_preserves_tags_and_holes_without_relabelling_wood_as_park(self):
  garden=Polygon([(10,10),(200,10),(200,200),(10,200)],holes=[[(50,50),(80,50),(80,80),(50,80)]])
  records=[('garden',garden,{'leisure':'garden','name':'source garden'}),('wood',box(300,300,400,400),{'natural':'wood'}),('forest',box(500,500,600,600),{'landuse':'forest'})]
  with tempfile.TemporaryDirectory() as d:
   path=os.path.join(d,'veg.sqlite');db=sqlite3.connect(path);db.execute('CREATE TABLE areas(id TEXT PRIMARY KEY,geometry BLOB,tags TEXT)')
   db.executemany('INSERT INTO areas VALUES(?,?,?)',[(key,g.wkb,json.dumps(tags)) for key,g,tags in records]);db.commit();db.close()
   found=park_areas(path,0,0)
   self.assertEqual([tags for g,tags in found],[tags for key,g,tags in records])
   self.assertTrue(found[0][0].equals(garden));self.assertEqual(len(found[0][0].interiors),1)
   self.assertEqual([ground_category(30,.1,tags.get('landuse',''),tags.get('natural',''),1e9,tags.get('leisure','')) for g,tags in found],['grass','forest','forest'])
 def test_scenery_reduction_is_deterministic_and_authenticates_cache_source(self):
  from scenery import reduce_scenery
  from model import PROJECTION
  from ingest import sha
  from pathlib import Path
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'vegetation.sqlite';source=Path(d)/'source.json'
   db=sqlite3.connect(path);db.executescript('CREATE TABLE areas(id TEXT,geometry BLOB,tags TEXT); CREATE TABLE points(id TEXT,source TEXT,kind TEXT,x REAL,z REAL,seed INTEGER,tags TEXT); CREATE TABLE metadata(value TEXT);')
   garden=Polygon([(0,0),(100,0),(100,100),(0,100)],holes=[[(20,20),(40,20),(40,40),(20,40)]])
   db.execute('INSERT INTO areas VALUES(?,?,?)',('osm:way:1',garden.wkb,json.dumps({'leisure':'garden'})))
   db.execute('INSERT INTO points VALUES(?,?,?,?,?,?,?)',('osm:way:1:candidate:60:60','osm:way:1','park_candidate',60,60,7,'{"leisure":"garden"}'))
   db.execute('INSERT INTO metadata VALUES(?)',(json.dumps({'inputs':{'pbfSha256':'source-hash','projection':PROJECTION,'codeSha256':'code-hash'},'counts':{'garden_areas':1},'errors':{}}),));db.commit();db.close()
   path.with_suffix('.sha256').write_text(sha(path))
   source.write_text(json.dumps({'sha256':'source-hash','bytes':100,'bounds':[23,38,24,39],'attribution':'OSM contributors','responses':[],'missingWayNodes':[],'wholeWays':True,'restrictionClosureComplete':True,'unresolvedRelationMembers':[{'ref':'missing'}]}))
   a=reduce_scenery(path,source);self.assertEqual(a,reduce_scenery(path,source));self.assertFalse(a['placementValidated']);self.assertEqual(a['source']['unresolvedRelationMembers'],1)
   self.assertEqual(a['areas'][0]['tags'],{'leisure':'garden'});self.assertEqual(len(a['areas'][0]['geometry']['coordinates']),2);self.assertEqual(a['points'][0]['inference'],'sampled-green-area')
   record=json.loads(source.read_text());record['sha256']='wrong';source.write_text(json.dumps(record))
   with self.assertRaisesRegex(ValueError,'hash mismatch'):reduce_scenery(path,source)
 @unittest.skipUnless(importlib.util.find_spec('osmium'),'osmium is not installed')
 def test_partial_green_relation_is_rejected_even_when_outer_way_exists(self):
  from vegetation import incomplete_green_relations
  xml="""<osm version="0.6"><node id="1" lat="38.07" lon="23.81"/><node id="2" lat="38.071" lon="23.81"/><node id="3" lat="38.071" lon="23.811"/><way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/></way><relation id="20"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="leisure" v="garden"/></relation><relation id="21"><member type="way" ref="10" role="outer"/><member type="way" ref="99" role="inner"/><tag k="type" v="multipolygon"/><tag k="natural" v="wood"/></relation><relation id="22"><member type="relation" ref="20" role="outer"/><tag k="type" v="multipolygon"/><tag k="landuse" v="forest"/></relation></osm>"""
  with tempfile.TemporaryDirectory() as d:
   path=os.path.join(d,'source.osm')
   with open(path,'w') as f:f.write(xml)
   self.assertEqual(incomplete_green_relations(path),{21,22})
 @unittest.skipUnless(importlib.util.find_spec('osmium'),'osmium is not installed')
 def test_area_candidates_preserve_holes_and_source_classes(self):
  from vegetation import candidates,area_kind
  garden=Polygon([(0,0),(100,0),(100,100),(0,100)],holes=[[(20,20),(80,20),(80,80),(20,80)]])
  from shapely.geometry import Point
  self.assertTrue(all(garden.contains(Point(x,z)) for x,z in candidates(garden)))
  self.assertEqual([area_kind(t) for t in [{'leisure':'garden'},{'natural':'wood'},{'landuse':'forest'},{'leisure':'park'},{'landuse':'residential'},{'leisure':'pitch'},{'landuse':'grass'}]],['garden','wood','wood','park',None,None,None])

if __name__=='__main__':unittest.main()
