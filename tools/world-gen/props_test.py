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

class Furniture(unittest.TestCase):
    def straight(self,highway='residential',oneway=False,length=200.):
        e=edge('a:f:0',1 if oneway else 0);return [(e,[[256.,0.,300.],[256.,0.,300.-length]])],Field(a=road(hw=3,highway=highway,oneway=oneway,way='w9'))
    def kinds(self,props_):return [k for k in props_['kind']]
    def test_lit_roads_get_lamps_every_42_m_on_alternating_sides(self):
        emitted,field=self.straight();_,pr=build(emitted,field,0,0,[],{'w9':(True,())},[],FLAT)
        lamps=[pr['rows'][i*5:i*5+5] for i,k in enumerate(pr['kind']) if k==KINDS['lamp']];self.assertGreaterEqual(len(lamps),4)
        zs=[l[2] for l in lamps];self.assertTrue(all(abs((a-b)-42)<.1 for a,b in zip(zs,zs[1:])))
        self.assertEqual({round(l[0]-256) for l in lamps},{4,-4},'both sides of a two-way street, staggered')
    def test_unlit_roads_get_none_and_service_roads_are_never_lit_by_rule(self):
        emitted,field=self.straight();_,pr=build(emitted,field,0,0,[],{},[],FLAT);self.assertEqual(pr['kind'],[])
        emitted,field=self.straight('service');_,pr=build(emitted,field,0,0,[],{'w9':(True,())},[],FLAT);self.assertEqual(pr['kind'],[])
    def test_parking_lane_tags_give_parked_cars_along_that_kerb_only(self):
        emitted,field=self.straight();_,pr=build(emitted,field,0,0,[],{'w9':(False,('right',))},[],FLAT)
        cars=[pr['rows'][i*5:i*5+5] for i,k in enumerate(pr['kind']) if k==KINDS['parked_car']];self.assertGreater(len(cars),5)
        self.assertTrue(all(c[0]>256 for c in cars),'right of a northbound street is east');self.assertTrue(all(abs(c[0]-(256+1.9))<.01 for c in cars))
    def test_buildings_block_props(self):
        emitted,field=self.straight();wall=[box(240,0,262,512)];_,pr=build(emitted,field,0,0,[],{'w9':(True,())},wall,FLAT);self.assertEqual(pr['kind'],[])
    def test_bus_stops_stand_on_the_kerb_of_their_own_side_and_shelters_are_marked(self):
        emitted,field=self.straight();n=[node('b1','bus_stop',262,200,shelter='yes'),node('b2','bus_stop',250,150)]
        _,pr=build(emitted,field,0,0,n,{},[],FLAT);self.assertEqual(sorted(pr['kind']),[KINDS['bus_stop'],KINDS['bus_shelter']])
        xs={k:pr['rows'][i*5] for i,k in enumerate(pr['kind'])};self.assertAlmostEqual(xs[KINDS['bus_shelter']],256+3+1.5,delta=.01);self.assertAlmostEqual(xs[KINDS['bus_stop']],256-3-1.5,delta=.01)
    def test_a_stop_sign_goes_on_the_least_important_arm_and_never_at_a_signal(self):
        a=edge('a:f:0');b=edge('b:f:0');pa=[[100.,0.,300.],[100.,0.,100.]];pb=[[0.,0.,100.],[100.,0.,100.]]
        emitted=[(a,pa),(b,pb)];field=Field(a=road(hw=6,highway='primary'),b=road(hw=3,highway='residential'))
        _,pr=build(emitted,field,0,0,[node('s1','stop',100,100)],{},[],FLAT);self.assertEqual(pr['kind'],[KINDS['stop']]);self.assertAlmostEqual(pr['rows'][0],100-4.5,delta=.01,msg='4.5 m before the node, on the minor (eastbound) road');self.assertAlmostEqual(pr['rows'][2],100+3.8,delta=.01,msg='on its right kerb')
        sig,pr=build(emitted,field,0,0,[node('s1','stop',100,100),node('g1','signals',100,101)],{},[],FLAT);self.assertNotIn(KINDS['stop'],pr['kind'])
    def test_osm_nodes_become_their_models_and_other_cells_nodes_are_ignored(self):
        emitted,field=self.straight()
        n=[node('k1','kiosk',200,200),node('f1','fountain',210,210),node('m1','monument',220,220),node('z1','bench',-20,5),node('l1','lamp',300,300),node('b','bollard',230,230)]
        _,pr=build(emitted,field,0,0,n,{},[],FLAT);self.assertEqual(sorted(pr['kind']),sorted([KINDS['kiosk'],KINDS['fountain'],KINDS['monument'],KINDS['lamp'],KINDS['bollard']]))
    def test_a_cell_is_bounded(self):
        emitted,field=self.straight(length=250.);many=[node(f'l{i}','lamp',i%500+1,i//500+1) for i in range(2000)];_,pr=build(emitted,field,0,0,many,{},[],FLAT);self.assertLessEqual(len(pr['kind']),props.MAX_PROPS)
    def test_a_crossing_sign_stands_before_the_crossing_on_each_approach_and_not_at_a_signal(self):
        emitted,field=self.straight()
        _,pr=build(emitted,field,0,0,[node('c1','crossing',256,150)],{},[],FLAT)
        rows=[pr['rows'][i*5:i*5+5] for i,k in enumerate(pr['kind']) if k==KINDS['crossing']];self.assertEqual(len(rows),1)
        self.assertAlmostEqual(rows[0][0],256+3.8,delta=.01);self.assertAlmostEqual(rows[0][2],150+3,delta=.3,msg='3 m before the crossing, in the direction of travel (north)')
        _,pr=build(emitted,field,0,0,[node('c1','crossing',256,150),node('c2','crossing',256,152)],{},[],FLAT);self.assertEqual(pr['kind'].count(KINDS['crossing']),1,'two nodes of one crossing give one sign')
        _,pr=build(emitted,field,0,0,[node('c3','crossing',300,150)],{},[],FLAT);self.assertEqual(pr['kind'],[])
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
        self.assertEqual(c({'highway':'crossing'}),'crossing');self.assertIsNone(c({'highway':'crossing','crossing':'no'}));self.assertIsNone(c({'name':'x'}))
if __name__=='__main__':unittest.main()
