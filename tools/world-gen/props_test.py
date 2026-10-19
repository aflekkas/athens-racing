"""Signals and street furniture rows (props.py). Needs shapely."""
import math,unittest
from shapely.geometry import box
import props
from props import build,clusters,road_extras,STOP_OFF,KINDS

class Field:
    def __init__(self,**roads):self.byid=roads
def road(hw=6.,highway='primary',oneway=False,way='w1'):return dict(width=hw*2,highway=highway,oneway=oneway,way=way+':0')
def edge(i,flags=0):return dict(id=i,source=i.split(':')[0],flags=flags)
FLAT=lambda x,z:3.0
def node(i,kind,x,z,**tags):return dict(id=i,kind=kind,x=x,z=z,tags=tags)

class Signals(unittest.TestCase):
    # A street runs south to north (z decreasing) and ends at a junction at (100,100) with a signal node on it.
    def world(self):
        a=edge('a:f:0');pa=[[100.,0.,300.],[100.,0.,200.],[100.,0.,100.]]
        b=edge('b:f:0');pb=[[0.,0.,100.],[50.,0.,100.],[100.,0.,100.]]   # a cross street arriving from the west
        return [(a,pa),(b,pb)],Field(a=road(hw=6,highway='primary'),b=road(hw=4,highway='residential'))
    def test_every_approach_ending_at_a_signalised_junction_gets_a_head_on_its_right_kerb_at_the_stop_line(self):
        emitted,field=self.world();sig,pr=build(emitted,field,0,0,[node('n1','signals',100,102)],{},[],FLAT)
        self.assertEqual(sig['edges'],['a:f:0','b:f:0']);rows=[sig['rows'][i:i+6] for i in range(0,12,6)]
        x,y,z,yaw,offset,group=rows[0]
        self.assertAlmostEqual(z,100+STOP_OFF,delta=.01,msg='9 m before the junction node');self.assertAlmostEqual(abs(x-100),6.85,delta=.01,msg='half the carriageway plus .85 m')
        self.assertGreater(x,100,'travelling north (z decreasing) the right-hand kerb is east')
        self.assertEqual(group,0.);self.assertEqual(rows[1][5],1.,'the cross street is the other phase group');self.assertEqual(y,3.0)
    def test_one_plan_per_junction_and_the_wave_follows_the_northing(self):
        emitted,field=self.world();s1,_=build(emitted,field,0,0,[node('n1','signals',100,102)],{},[],FLAT)
        self.assertEqual(s1['rows'][4],s1['rows'][10],'both approaches share the junction offset')
        far=[(edge('c:f:0'),[[100.,0.,300.],[100.,0.,200.]])];s2,_=build(far,Field(c=road()),0,2000,[node('n2','signals',100,2200)],{},[],FLAT)
        self.assertNotEqual(s1['rows'][4],s2['rows'][4]);gap=(s1['rows'][4]-s2['rows'][4])%props.CYCLE
        self.assertAlmostEqual(gap,((2200-102)/props.WAVE_V)%props.CYCLE,delta=.05,msg='2.1 km further north = 2.1 km / 80 km/h later')
    def test_junction_nodes_within_35_m_are_one_junction(self):
        c=clusters([node('n1','signals',0,0),node('n2','signals',20,10),node('n3','signals',500,0)])
        self.assertEqual(sorted(len(j['members']) for j in c),[1,2]);self.assertEqual(min(j['id'] for j in c),'n1')
    def test_an_edge_far_from_any_signal_is_not_signalised(self):
        emitted,field=self.world();sig,_=build(emitted,field,0,0,[node('n1','signals',400,400)],{},[],FLAT);self.assertEqual(sig['edges'],[])

class Extras(unittest.TestCase):
    def test_road_extras_reads_lit_and_parking_tags(self):
        self.assertEqual(road_extras({'lit':'yes'}),(True,()));self.assertEqual(road_extras({'parking:lane:both':'parallel'}),(False,('left','right')))
        self.assertEqual(road_extras({'parking:lane:right':'no_parking'}),None);self.assertIsNone(road_extras({'highway':'x'}))
class StreetNodes(unittest.TestCase):
    def test_osm_tags_become_street_furniture_kinds(self):
        try:from street_nodes import classify
        except ImportError:self.skipTest('pyosmium is not installed')
        c=classify
        self.assertEqual(c({'highway':'traffic_signals'}),'signals');self.assertEqual(c({'highway':'stop'}),'stop');self.assertEqual(c({'highway':'give_way'}),'give_way')
        self.assertEqual(c({'highway':'street_lamp'}),'lamp');self.assertEqual(c({'highway':'bus_stop'}),'bus_stop');self.assertEqual(c({'public_transport':'platform','bus':'yes'}),'bus_stop')
        self.assertEqual(c({'barrier':'bollard'}),'bollard');self.assertEqual(c({'amenity':'bench'}),'bench');self.assertEqual(c({'shop':'kiosk'}),'kiosk')
        self.assertEqual(c({'amenity':'fountain'}),'fountain');self.assertEqual(c({'historic':'monument'}),'monument')
        self.assertEqual(c({'highway':'crossing'}),'crossing');self.assertIsNone(c({'name':'x'}))
if __name__=='__main__':unittest.main()
