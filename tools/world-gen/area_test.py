"""Areas, clipped buildings and the bridge guardrail geometry (needs shapely)."""
import math,re,unittest
from shapely.geometry import Polygon,box
import areas
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
