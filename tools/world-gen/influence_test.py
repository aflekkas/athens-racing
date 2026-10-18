"""Core continuity regressions; uses only Python's standard library."""
import math
import unittest
from influence import blended_height, profile_height, lattice_height, smooth_lattice_sample, SUPPORT, ROAD_QUERY_HALO


class InfluenceTests(unittest.TestCase):
    def parallel(self, x, z=0, reverse=False):
        candidates = [(name, y + z * .1, max(0, abs(x-c)-4), abs(x-c), 8)
                      for name, y, c in [('a', 10, 0), ('b', 12, 6)]]
        return blended_height(80, list(reversed(candidates)) if reverse else candidates)

    def test_overlapping_road_boundaries_and_nearest_ties(self):
        # x=2,4 cross the containing-road set; x=3 is a nearest-road tie.
        for x in (2, 3, 4, -4, 10):
            self.assertLess(abs(self.parallel(x+1e-6)-self.parallel(x-1e-6)), 1e-5)
        for x in range(-70, 80):
            self.assertEqual(self.parallel(x), self.parallel(x, reverse=True))

    def test_compact_support_returns_to_dem_without_jump(self):
        def h(d): return blended_height(100, [('road', 0, d, d+4, 8)])
        self.assertEqual(h(SUPPORT), 100)
        self.assertLess(abs(h(SUPPORT-1e-6)-100), 1e-8)
        self.assertEqual(blended_height(17, []), 17)

    def test_single_road_grade_and_shoulders(self):
        for z in range(-100,101):
            self.assertAlmostEqual(blended_height(100, [('road', 10+z*.1, 0, 0, 8)]), 10+z*.1)
        for side in (-1,1):
            previous=blended_height(100,[('road',10,0,4,8)])
            for step in range(1,25):
                d=step*.25
                y=blended_height(100,[('road',10,d,4+d,8)])
                self.assertLessEqual(abs(y-previous), .15)
                self.assertLessEqual(abs(y-previous)/.25, math.tan(math.pi/6))
                previous=y

    def test_hairpin_internal_nearest_segment_tie(self):
        segments=[(0,0,50,0,10,10),(50,0,50,6,10,11.2),(50,6,0,6,11.2,11.2)]
        def h(z):return profile_height(10,z,segments,12)
        self.assertLess(abs(h(3+1e-6)-h(3-1e-6)),1e-5)
        self.assertEqual(h(3),profile_height(10,3,list(reversed(segments)),12))
        for x in range(1,50):
            self.assertAlmostEqual(profile_height(x,0,[(0,0,50,0,0,10)],12),x*.2)

    def test_nonlinear_field_cannot_make_a_steep_centimetre_sliver(self):
        sample=lambda x,z:.0015*x*x
        def grade(height):
            a=height(100,100);b=height(104,100);c=height(102,100.01)
            gx=(b-a)/4;gz=(c-a-gx*2)/.01
            return math.hypot(gx,gz)
        self.assertGreater(grade(sample),math.tan(math.pi/6))
        self.assertLess(grade(lambda x,z:lattice_height(x,z,sample)),math.tan(math.pi/6))
        for z in (100,100.5,102,103.99,104):
            left=lattice_height(104-1e-7,z,sample)
            right=lattice_height(104+1e-7,z,sample)
            self.assertLess(abs(left-right),1e-6)

    def test_global_filter_preserves_linear_profile_grades(self):
        sample=lambda x,z:7+x*.12-z*.08
        for x in (-512,-8,0,512,4096):
            for z in (-512,0,512,18432):
                self.assertAlmostEqual(smooth_lattice_sample(x,z,sample),sample(x,z),places=10)
        spike=lambda x,z:1. if x==0 and z==0 else 0.
        self.assertAlmostEqual(smooth_lattice_sample(0,0,spike),36/256)

    def test_global_halo_covers_widest_mitres(self):
        self.assertGreaterEqual(ROAD_QUERY_HALO, SUPPORT+30*5+8+16)

if __name__ == '__main__': unittest.main()
