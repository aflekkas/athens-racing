"""Bridge dressing follows the source shape, independently of tile clipping and noding."""
import math, unittest
from shapely.geometry import Polygon, box
from tile_detail import bridge_post_stations, bridge_edges

class PostCadence(unittest.TestCase):
 def stations(self, platform, cell):
  return sorted((round(x,8),round(z,8)) for x,z,_,_ in bridge_post_stations(platform,cell))
 def test_redundant_source_nodes_do_not_move_or_add_posts(self):
  a=Polygon([(500,100),(540,100),(540,110),(500,110)])
  b=Polygon([(500,100),(513,100),(527,100),(540,100),(540,110),(521,110),(500,110)])
  for cell in [(0,0),(1,0)]:self.assertEqual(self.stations(a,cell),self.stations(b,cell))
 def test_ring_rotation_and_direction_do_not_move_posts(self):
  points=[(500,100),(540,100),(540,110),(500,110)]
  expected=self.stations(Polygon(points),(1,0))
  for ring in [points[2:]+points[:2],list(reversed(points))]:self.assertEqual(self.stations(Polygon(ring),(1,0)),expected)
 def test_cell_union_matches_whole_source_cadence_once(self):
  p=box(500,100,540,110)
  a=self.stations(p,(0,0));b=self.stations(p,(1,0));full=sorted(a+b)
  self.assertFalse(set(a)&set(b),'a border post has one cell owner')
  self.assertEqual(len(full),25,'100 m perimeter at a four metre cadence')
  self.assertIn((512.,100.),full)
 def test_emitted_posts_do_not_multiply_at_a_source_split(self):
  shapes=[Polygon([(500,100),(540,100),(540,110),(500,110)]),Polygon([(500,100),(513,100),(540,100),(540,110),(500,110)])]
  totals=[]
  for p in shapes:
   count=0
   for cell in [(0,0),(1,0)]:
    _,(positions,_),rails=bridge_edges(p,cell,lambda x,z:6.,lambda x,z:0.)
    count+=(len(positions)//3-len(rails)*8)//8
   totals.append(count)
  self.assertEqual(totals,[25,25],'one post per four source metres, independent of noding')
 def test_holes_have_their_own_stable_outline(self):
  p=Polygon([(20,20),(100,20),(100,100),(20,100)],holes=[[(40,40),(80,40),(80,80),(40,80)]])
  self.assertEqual(len(self.stations(p,(0,0))),120)
 def test_posts_keep_existing_collision_and_beam_envelope(self):
  fascia,guard,rails=bridge_edges(box(20,20,80,26),(0,0),lambda x,z:5+.02*x,lambda x,z:0)
  self.assertTrue(rails);self.assertTrue(guard[1]);self.assertTrue(fascia[1])
  self.assertTrue(all(r[6]==.65 for r in rails))
  # Last part of the guard buffer holds posts, after one eight-vertex beam per rail.
  posts=guard[0][len(rails)*24:]
  self.assertTrue(posts)
  for i in range(0,len(posts),3):
   x,y,z=posts[i:i+3]
   def encloses(r):
    dx,dz=r[3]-r[0],r[5]-r[2];l2=dx*dx+dz*dz
    f=((x-r[0])*dx+(z-r[2])*dz)/l2
    side=abs((x-r[0])*dz-(z-r[2])*dx)/math.sqrt(l2)
    floor=r[1]+(r[4]-r[1])*f
    return -1e-8<=f<=1+1e-8 and side<=.15+1e-8 and floor+.1-1e-8<=y<=floor+.65+1e-8
   self.assertTrue(any(encloses(r) for r in rails),(x,y,z))
 def test_no_posts_on_a_ground_level_approach(self):
  fascia,guard,rails=bridge_edges(box(20,20,80,26),(0,0),lambda x,z:.05,lambda x,z:0)
  self.assertEqual((guard,rails),(([],[]),[]))

if __name__=='__main__':unittest.main()
