import unittest
from border_nodes import split_borders
class Borders(unittest.TestCase):
 def test_shared_border_direction_and_ties(self):
  # Riviera hillside boundary which previously became x=4044.13 on one tile
  # and 4044.14 on the neighbour. Both get the same explicit input vertex.
  for a,b in [([4043,15360.775466991476],[4045,15359.417085645677]),([-1,-1],[513,513]),([0,511],[.02,513])]:
   forward=split_borders([a,b]);reverse=split_borders([b,a]);self.assertEqual(forward,list(reversed(reverse)))
   self.assertTrue(all(abs(v*50-round(v*50))<1e-6 for p in forward for v in p))
  self.assertIn([4044.14,15360.0],split_borders([[4043,15360.775466991476],[4045,15359.417085645677]]))
 def test_negative_and_multiple_cells(self):
  p=split_borders([[-600,12],[1100,12]])
  self.assertEqual([a[0] for a in p],[-600,-512,0,512,1024,1100])

if __name__=='__main__':unittest.main()
