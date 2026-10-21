"""Areas, clipped buildings and the bridge guardrail geometry (needs shapely)."""
import math,re,unittest
from shapely.geometry import Polygon,box
import areas
from border_nodes import canonical_polygon,lift_border_runs
from buildings import clipped_piece
from tile_detail import bridge_edges,_prism

ID=re.compile(r'^[a-z0-9][a-z0-9:._/-]*$',re.I)

class Areas(unittest.TestCase):
 def test_coast_is_the_original_120_cells(self):
  coast=areas.load('coast')
  self.assertEqual(len(coast['cells']),120);self.assertEqual(len(set(coast['cells'])),120)
  self.assertEqual(set(coast['cells']),{(x,z) for x in range(10) for z in range(25,37)})
 def test_piraeus_faliro_extends_the_coast_as_one_world(self):
  a=areas.load('piraeus-faliro');cells=a['cells']
  self.assertEqual(len(cells),len(set(cells)),'no cell is baked twice')
  self.assertTrue(set(areas.load('coast')['cells'])<set(cells),'the coast is part of the same world, so every border is shared')
  self.assertIn(tuple(a['spawn']['cell']),cells)
  self.assertEqual(a['sources']['profiles'],'profiles-ap.sqlite');self.assertEqual(a['sources']['source'],'clean.sqlite')
  spec=a['spec'];land,sea=set(map(tuple,spec['land'])),set(map(tuple,spec['sea']))
  self.assertFalse(land&sea,'a cell is either land or sea ring');self.assertTrue(len(land)>100)
 def test_land_cells_are_contiguous_with_the_coast(self):
  a=areas.load('piraeus-faliro');cells=set(a['cells']);seen={(4,25)};stack=[(4,25)]
  while stack:
   x,z=stack.pop()
   for n in ((x+1,z),(x-1,z),(x,z+1),(x,z-1)):
    if n in cells and n not in seen:seen.add(n);stack.append(n)
  self.assertEqual(seen,cells,'every cell is reachable from the Glyfada spawn through shared borders')
 def test_extent_covers_every_cell(self):
  a=areas.load('piraeus-faliro');e=areas.extent(a['cells'])
  for x,z in a['cells']:self.assertTrue(e.covers(box(x*512,z*512,x*512+512,z*512+512).buffer(-1)))

class Centre(unittest.TestCase):
    def test_centre_extends_piraeus_faliro_as_one_world(self):
        c = areas.load('centre'); base = set(areas.load('piraeus-faliro')['cells']); cells = c['cells']
        self.assertEqual(c['parents'], ['piraeus-faliro']); self.assertEqual(len(cells), len(set(cells)))
        self.assertTrue(base < set(cells), 'the earlier areas are part of the same world, so every border is shared')
        new = [x for x in cells if x not in base]
        self.assertEqual(len(new), len(c['spec']['land'])); self.assertFalse(set(new) & base)
        self.assertEqual(c['sources']['profiles'], 'profiles-ac.sqlite')
    def test_centre_is_contiguous_and_every_new_cell_names_its_district(self):
        c = areas.load('centre'); cells = set(c['cells']); seen = {(4, 25)}; stack = [(4, 25)]
        while stack:
            x, z = stack.pop()
            for n in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
                if n in cells and n not in seen: seen.add(n); stack.append(n)
        self.assertEqual(seen, cells, 'every cell is reachable from the Glyfada spawn through shared borders')
        spec = c['spec']
        self.assertTrue(all('%d,%d' % tuple(x) in spec['districtOf'] for x in spec['land']))
    def test_candidates_are_the_cells_left_for_later(self):
        cand = areas.load('centre-candidates')['spec']; now = {tuple(x) for x in areas.load('centre')['spec']['land']}
        later = {tuple(x) for x in cand['land']} - now
        self.assertTrue(later, 'cells that did not fit the world ceiling remain listed'); self.assertFalse(later & set(areas.load('centre')['cells']))


class CentreFull(unittest.TestCase):
    def test_centre_full_extends_centre_with_every_candidate_cell(self):
        f = areas.load('centre-full'); cells = f['cells']; centre = set(areas.load('centre')['cells']); cand = {tuple(x) for x in areas.load('centre-candidates')['spec']['land']}
        self.assertEqual(f['parents'], ['centre']); self.assertEqual(len(cells), len(set(cells))); self.assertTrue(centre < set(cells))
        self.assertTrue(cand <= set(cells), 'every candidate cell is baked'); self.assertEqual(len(cells), 450)
        self.assertEqual(f['sources']['profiles'], 'profiles-ad.sqlite', 'baked from the caches that solved the Tavros underpass link at grade')
    def test_cells_are_contiguous_from_the_spawn(self):
        cells = set(areas.load('centre-full')['cells']); seen = {(4, 25)}; stack = [(4, 25)]
        while stack:
            x, z = stack.pop()
            for n in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
                if n in cells and n not in seen: seen.add(n); stack.append(n)
        self.assertEqual(seen, cells)

class Riviera(unittest.TestCase):
 def test_riviera_extends_same_world_and_full_route_safety_envelope(self):
  from pathlib import Path
  import json
  from shapely.geometry import LineString
  a=areas.load('riviera');base=areas.load('east');self.assertEqual(a['world'],base['world']);self.assertEqual(a['parents'],['east'])
  self.assertTrue(set(base['cells'])<set(a['cells']));self.assertEqual(len(a['cells']),len(set(a['cells'])))
  data=json.loads((Path(__file__).resolve().parents[2]/'data/map.json').read_text());p=data['proj'];r=data['route']
  line=LineString([((p['lon0']+x/p['mlon']-23.73)*87745.27512677578,(37.98-p['lat0']+z/p['mlat'])*111320) for x,z in zip(r['x'],r['z'])])
  self.assertTrue(areas.extent(a['cells']).covers(line.buffer(768)), 'the full reference and safety/scenery envelope, not just racing endpoints')

class Clipping(unittest.TestCase):
 part=dict(height=12.0,heightSource='levels',landuse='residential',palette=3,id='w1:0')
 def test_building_across_a_border_is_two_flush_pieces(self):
  footprint=Polygon([(500,100),(530,100),(530,140),(500,140)])  # crosses x=512
  left=clipped_piece('w1:0/0:0',footprint.intersection(box(0,0,512,512)),self.part)
  right=clipped_piece('w1:0/1:0',footprint.intersection(box(512,0,1024,512)),self.part)
  for piece,cell in ((left,(0,0)),(right,(1,0))):
   self.assertIsNotNone(piece);self.assertEqual(piece['height'],12.0);self.assertEqual(piece['palette'],3)
   self.assertTrue(ID.match(piece['id']));self.assertTrue(4<=len(piece['footprint'])<=14)
   poly=Polygon(piece['footprint']);self.assertTrue(box(cell[0]*512-.001,0,cell[0]*512+512.001,512).covers(poly),'a piece stays inside its own cell')
  total=Polygon(left['footprint']).area+Polygon(right['footprint']).area
  self.assertAlmostEqual(total,footprint.area,delta=footprint.area*.01)
  self.assertEqual(max(x for x,z in left['footprint']),512);self.assertEqual(min(x for x,z in right['footprint']),512)
 def test_piece_ids_are_valid_wire_ids_for_negative_cells(self):
  piece=clipped_piece('w9:1/-12:7.1',Polygon([(-5100,3600),(-5090,3600),(-5090,3612),(-5100,3612)]),self.part)
  self.assertTrue(ID.match(piece['id']),piece['id'])

class Borders(unittest.TestCase):
 def test_no_outline_edge_lies_on_a_border(self):
  # A tip that reaches a border with a 2 cm edge along it would give one neighbour a triangle edge the other cannot have.
  tip=Polygon([(500,0),(512,0),(512,.02),(520,5),(520,10),(500,10)])
  def on_border(g):return [(a,b) for a,b in zip(g.exterior.coords,list(g.exterior.coords)[1:]) if a[0]==b[0]==512 and a[1]!=b[1]]
  self.assertTrue(on_border(tip))
  lifted=canonical_polygon(tip)
  self.assertFalse(on_border(lifted));self.assertAlmostEqual(lifted.area,tip.area,delta=.5);self.assertTrue(lifted.is_valid)
  self.assertTrue(any(c[0]==512 for c in lifted.exterior.coords),'the outline still crosses the border at a node both cells share')
  square=Polygon([(100,100),(110,100),(110,110),(100,110)]);self.assertEqual(lift_border_runs(square).wkt,square.wkt,'polygons off the borders are untouched')

class Guardrail(unittest.TestCase):
 def test_prism_faces_point_outward(self):
  ps=[];ix=[];_prism(ps,ix,(10,10),(14,10),1.0,1.0,.1,.4,.7,True)
  cx=sum(ps[i] for i in range(0,len(ps),3))/8;cy=sum(ps[i] for i in range(1,len(ps),3))/8;cz=sum(ps[i] for i in range(2,len(ps),3))/8
  self.assertEqual(len(ix),5*6)
  for t in range(0,len(ix),3):
   a,b,c=[ps[v*3:v*3+3] for v in ix[t:t+3]]
   n=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])]
   mid=[sum(v[k] for v in (a,b,c))/3-(cx,cy,cz)[k] for k in range(3)]
   self.assertGreater(sum(n[k]*mid[k] for k in range(3)),0)
  ys=ps[1::3];self.assertAlmostEqual(min(ys),1.4);self.assertAlmostEqual(max(ys),1.7)
 def test_low_beam_and_posts_over_the_unchanged_collision_rail(self):
  platform=box(20,20,80,26);deck=lambda x,z:5.0;ground=lambda x,z:0.0
  (fp,fi),(gp,gi),rails=bridge_edges(platform,(0,0),deck,ground)
  self.assertTrue(rails);self.assertTrue(all(r[6]==.65 for r in rails),'collision rail: solid, 0.65 m high, as the gate requires')
  self.assertGreater(len(fi),0);self.assertGreater(len(gi),0)
  top=max(gp[1::3])-5.0
  self.assertAlmostEqual(top,.65,places=6);self.assertLessEqual(top,.65+1e-9,'everything drawn lies inside the 0.65 m collision rail')
  self.assertGreaterEqual(min(fp[1::3])-5.0,-.5-1e-9);self.assertLessEqual(max(fp[1::3])-5.0,.1+1e-9)
  beam=[y-5.0 for y in gp[1::3]];self.assertGreaterEqual(min(beam),.1-1e-9)
  self.assertLess(sum(1 for y in beam if abs(y-.37)<1e-9),len(beam),'the beam floats above the deck on posts: the gap under it is open')
 def test_no_rail_where_the_deck_meets_the_ground(self):
  (fp,fi),(gp,gi),rails=bridge_edges(box(20,20,80,26),(0,0),lambda x,z:.05,lambda x,z:0.0)
  self.assertEqual((rails,fi,gi),([],[],[]))

if __name__=='__main__':unittest.main()
