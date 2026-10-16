#!/usr/bin/env python3
"""Run: python tools/world-gen/test.py (uses pinned requirements)."""
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from shapely.geometry import Polygon, LineString
from model import road_tags, building_height, project, unproject
from buildings import building_mesh, building_parts, simplify_footprint
from ingest import ingest, sha
from clean import clean, road_parts, public_direction
from clip import clip
from elevation import Elevation
from appearance import BUILDINGS, TERRAIN, ground_colour
from surfaces import ground_mesh, validate_partition, SurfaceHeight
from profiles import solve_constraints, build as build_profiles
from styles import face_shaded
from street_details import road_markings
import numpy as np
import rasterio
from rasterio.transform import from_origin


class ModelTests(unittest.TestCase):
    def test_access_precedence_and_direction(self):
        r=road_tags(dict(highway='primary',access='no',motorcar='yes',oneway='-1',layer='1',bridge='yes'))
        self.assertTrue(r['public']);self.assertEqual(r['oneway'],-1);self.assertTrue(r['bridge']);self.assertEqual(r['layer'],1)
        self.assertFalse(road_tags(dict(highway='residential',access='private'))['public'])
        self.assertFalse(road_tags({'highway':'primary','motor_vehicle:conditional':'no @ (Mo-Fr)'})['public'])
        self.assertEqual(road_tags(dict(highway='residential',junction='roundabout'))['oneway'],1)
        self.assertEqual(road_tags(dict(highway='motorway',oneway='no'))['oneway'],0)
        self.assertIsNone(road_tags(dict(highway='footway')))
        self.assertIsNone(road_tags(dict(highway='construction')))

    def test_directional_access_keeps_specific_vehicle_rules(self):
        tags={'access':'no','motorcar:forward':'yes'}
        self.assertTrue(public_direction(tags,'forward'))
        self.assertFalse(public_direction(tags,'backward'))
        self.assertTrue(public_direction({'motorcar':'yes','access:forward':'no'},'forward'))
        self.assertFalse(public_direction({'motorcar':'yes','motorcar:forward':'no'},'forward'))

    def test_units_widths_and_layer_errors(self):
        r=road_tags(dict(highway='primary',width='30 ft',maxspeed='30 mph'))
        self.assertAlmostEqual(r['width'],9.144);self.assertAlmostEqual(r['speed'],48.28032)
        self.assertEqual(road_tags(dict(highway='primary',lanes='3'))['width'],9.6)
        self.assertEqual(road_tags(dict(highway='primary',width='varies'))['widthSource'],'class')
        self.assertFalse(road_tags(dict(highway='primary',layer='unknown'))['public'])

    def test_height_palette_and_real_footprint(self):
        self.assertEqual(building_height({'building:levels':'4'},'industrial'),(12.8,'levels'))
        self.assertEqual(building_height({'height':'20'},''),(20,'height'))
        polygon=Polygon([(0,0),(8,0),(8,8),(0,8)])
        mesh=building_mesh('w1',polygon,{},'residential')
        self.assertEqual(mesh['triangles'],10)
        self.assertFalse(Polygon(mesh['footprint']).exterior.is_ccw,'AWT corners must be clockwise')
        self.assertEqual(mesh,building_mesh('w1',polygon,{},'residential'))
        self.assertLessEqual(mesh['triangles'],40)
        p=mesh['positions'];roof_area=0
        for a,b,c in zip(mesh['indices'][::3],mesh['indices'][1::3],mesh['indices'][2::3]):
            if p[a*3+1]>0 and p[b*3+1]>0 and p[c*3+1]>0:
                cross=(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3])-(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2])
                self.assertGreater(cross,0,'roof must face upward');roof_area+=cross/2
        self.assertAlmostEqual(roof_area,polygon.area)
        courtyard=Polygon([(0,0),(10,0),(10,10),(0,10)],holes=[[(3,3),(3,7),(7,7),(7,3)]])
        self.assertIsNone(simplify_footprint(courtyard),'never silently fill a courtyard')
        parts=building_parts('courtyard',courtyard,{},'')
        self.assertIsNotNone(parts)
        self.assertLessEqual(sum(p['triangles'] for p in parts),40)
        from shapely.ops import unary_union
        self.assertAlmostEqual(unary_union([Polygon(p['footprint']) for p in parts]).symmetric_difference(courtyard).area,0,places=3)

    def test_concave_building_is_preserved(self):
        polygon=Polygon([(0,0),(12,0),(12,4),(4,4),(4,12),(0,12)])
        mesh=building_mesh('w2',polygon,{},'residential')
        self.assertEqual(Polygon(mesh['footprint']).area,polygon.area)
        self.assertEqual(mesh['triangles'],16)
        self.assertEqual(simplify_footprint(polygon),polygon)
        triangle=Polygon([(0,0),(12,0),(0,12)])
        block=building_mesh('w3',triangle,{},'')
        self.assertEqual(len(block['footprint']),4)
        self.assertAlmostEqual(Polygon(block['footprint']).area,triangle.area)

    def test_owner_ground_and_building_palettes(self):
        self.assertFalse(set(BUILDINGS)&set(TERRAIN.values()))
        self.assertEqual(ground_colour(0,0,2,.01,coast_distance=5)[0],'sand')
        self.assertEqual(ground_colour(0,0,100,.8)[0],'rock')
        self.assertEqual(ground_colour(0,0,100,.1,natural='scrub')[0],'scrub')
        self.assertEqual(ground_colour(0,0,100,.1,landuse='residential')[0],'urban')
        self.assertEqual(ground_colour(512,512,20,.1),ground_colour(512,512,20,.1))

    def test_canonical_ground_tiles_are_manifold_and_share_border(self):
        line=LineString([(400,200),(600,280)])
        roads=[dict(id='w1',line=line,polygon=line.buffer(4,quad_segs=1))]
        left=ground_mesh((0,0),roads,lambda x,z:x*.01+z*.02)
        right=ground_mesh((1,0),roads,lambda x,z:x*.01+z*.02)
        for mesh in (left,right):
            self.assertAlmostEqual(validate_partition(mesh)['area'],512**2)
            self.assertIn('w1',mesh['owners'])
            self.assertIn(None,mesh['owners'])
        def border(mesh,x):
            p=mesh['positions']
            return {(p[i+2],p[i+1]) for i in range(0,len(p),3) if p[i]==x}
        self.assertEqual(border(left,512),border(right,0))
        self.assertTrue(set(range(0,513,16)) <= {z for z,y in border(left,512)})

    def test_profile_grade_and_actual_crossing_clearance(self):
        # Two paths connected by a long ramp: the crossing pair needs 5 m,
        # while every neighbouring sample remains within its grade bound.
        y=np.array([0.,0.,0.,0.])
        a=np.array([0,1,2,0]);b=np.array([1,2,3,3])
        gaps=np.array([2.,2.,2.,5.]);lower=np.array([False,False,False,True])
        result=solve_constraints(y,a,b,gaps,lower)
        self.assertTrue(result['pass_'],result)
        self.assertGreaterEqual(y[0]-y[3],4.998)
        self.assertLessEqual(max(abs(y[i]-y[i+1]) for i in range(3)),2.002)
        impossible=solve_constraints(np.array([0.,0.]),np.array([0,0]),np.array([1,1]),np.array([1.,5.]),np.array([False,True]),max_iterations=100)
        self.assertFalse(impossible['pass_'],'infeasible grade/clearance must fail closed')
        chain=np.linspace(0,300,1001);start=chain.copy()
        result=solve_constraints(chain,np.arange(1000),np.arange(1,1001),np.full(1000,.2),np.zeros(1000,dtype=bool))
        self.assertTrue(result['pass_'],result)
        self.assertLessEqual(float(np.max(np.abs(np.diff(chain)))),.20000001)
        self.assertAlmostEqual(float(chain.mean()),float(start.mean()),places=5)

    def test_unlit_faces_keep_triangle_budget_and_flat_colours(self):
        block=building_mesh('shade',Polygon([(0,0),(10,0),(10,8),(0,8)]),{'height':'12'},'')
        ps,ix,colours=face_shaded(block['positions'],block['indices'])
        self.assertEqual(len(ix),len(block['indices']))
        self.assertEqual(len(ps),len(colours))
        levels=set()
        for i in range(0,len(colours),9):
            self.assertEqual(len(set(colours[i:i+9])),1)
            levels.add(colours[i])
        self.assertIn(1,levels)
        self.assertGreaterEqual(len(levels),4)
        self.assertGreater(min(levels),.3)
        self.assertLess(min(levels),.5)

    def test_paint_height_uses_rendered_triangle_plane(self):
        mesh=dict(cell=[2,3],positions=[0,2,0,0,8,10,10,5,0],triangles=[0,1,2])
        height=SurfaceHeight(mesh)
        self.assertAlmostEqual(height(1026,1539),4.4)
        with self.assertRaisesRegex(ValueError,'No emitted terrain'):height(1044,1556)

    def test_markings_are_clipped_to_road_and_tile(self):
        line=LineString([(-20,100),(540,100)])
        road=dict(id='paint',fromNode='a',toNode='b',points=list(line.coords),line=line,width=6.4,polygon=line.buffer(3.2,cap_style=2))
        ps,ix=road_markings([road],(0,0),lambda x,z:7)
        self.assertGreater(len(ix),0)
        for x,y,z in zip(ps[::3],ps[1::3],ps[2::3]):
            self.assertGreaterEqual(x,0);self.assertLessEqual(x,512)
            self.assertAlmostEqual(y,7.015)
            self.assertLessEqual(abs(z-100),.066)

    def test_projection_roundtrip(self):
        for p in ((23.73,37.98),(22.9,38.4),(24.5,37.5)):
            q=unproject(*project(*p));self.assertAlmostEqual(q[0],p[0]);self.assertAlmostEqual(q[1],p[1])

    def test_topology_splits_shared_nodes_not_crossing_lines(self):
        db=sqlite3.connect(':memory:');db.execute('CREATE TABLE node_use(id INTEGER PRIMARY KEY,uses INTEGER)')
        db.execute('CREATE TABLE node_rules(id INTEGER PRIMARY KEY,tags TEXT)')
        db.executemany('INSERT INTO node_use VALUES(?,?)',[(1,1),(2,2),(3,1)])
        parts=list(road_parts(db,'w1',dict(highway='primary',oneway='-1'),LineString([(0,0),(1,0),(2,0)]),[1,2,3]))
        self.assertEqual(len(parts),2);self.assertEqual(parts[0]['toNode'],parts[1]['fromNode'])
        self.assertFalse(parts[0]['forward']);self.assertTrue(parts[0]['backward'])
        db.close()

    def test_dem_bilinear_sampling_and_missing_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'dem.tif'
            values=np.arange(16,dtype='float32').reshape(4,4)
            with rasterio.open(path,'w',driver='GTiff',height=4,width=4,count=1,dtype='float32',crs='EPSG:4326',transform=from_origin(23.7,38.0,.01,.01),nodata=-9999) as raster:
                raster.write(values,1)
            elevation=Elevation([path])
            self.assertAlmostEqual(elevation.height(*project(23.715,37.985)),5)
            self.assertAlmostEqual(elevation.height(*project(23.72,37.98)),7.5)
            with self.assertRaises(ValueError):elevation.height(*project(24,38))
            self.assertLessEqual(elevation.block.cache_info().currsize,256)
            elevation.close()

    def test_broken_references_fail_or_are_explicitly_pruned(self):
        xml='''<osm version="0.6"><node id="1" lon="23.75" lat="37.9"/>
          <way id="1"><nd ref="1"/><nd ref="99"/><tag k="highway" v="residential"/></way>
          <relation id="1"><member type="way" ref="1" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation></osm>'''
        with tempfile.TemporaryDirectory() as directory,contextlib.redirect_stdout(io.StringIO()):
            root=Path(directory);source=root/'source.osm';source.write_text(xml);out=root/'reduced.osm.pbf'
            bounds=[23.7,37.8,23.8,38]
            with self.assertRaisesRegex(ValueError,'Missing referenced nodes ID 99'):clip(source,out,bounds)
            result=clip(source,out,bounds,resume_write=True,drop_incomplete=True)
            self.assertEqual(result['discarded']['missing']['nodes'],['99'])
            self.assertEqual(result['discarded']['incomplete']['ways'],['1'])
            self.assertEqual(result['discarded']['incomplete']['relations'],['1'])
            self.assertEqual(result['selected'],dict(nodes=1,ways=0,relations=0))
            self.assertFalse(out.with_suffix('.selection.sqlite').exists())

    def test_small_stream_ingestion_and_clean_are_repeatable(self):
        xml='''<?xml version="1.0"?><osm version="0.6" generator="test">
          <node id="1" lat="37.9" lon="23.75"/><node id="2" lat="37.9" lon="23.751"/>
          <node id="3" lat="37.901" lon="23.751"/><node id="4" lat="37.901" lon="23.75"/>
          <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
          <way id="2"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/></way>
          <way id="3"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/><tag k="building:levels" v="3"/></way>
          <way id="4"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="landuse" v="industrial"/><tag k="natural" v="coastline"/></way>
          <relation id="50"><member type="way" ref="3" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>
          <relation id="51"><member type="way" ref="1" role="from"/><member type="node" ref="2" role="via"/><member type="way" ref="2" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_right_turn"/></relation>
        </osm>'''
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root=Path(directory);source=root/'fixture.osm';source.write_text(xml)
            for name in ('a','b'):
                clip(source,root/(name+'.osm.pbf'),[23.749,37.899,23.7505,37.9005])
                ingest(source,root/(name+'.sqlite'),[23.7,37.8,23.8,38])
                clean(root/(name+'.sqlite'),root/(name+'-clean.sqlite'))
            self.assertEqual(sha(root/'a.osm.pbf'),sha(root/'b.osm.pbf'))
            self.assertEqual(sha(root/'a.sqlite'),sha(root/'b.sqlite'))
            self.assertEqual(sha(root/'a-clean.sqlite'),sha(root/'b-clean.sqlite'))
            dem=root/'flat.tif'
            with rasterio.open(dem,'w',driver='GTiff',height=100,width=100,count=1,dtype='float32',crs='EPSG:4326',transform=from_origin(23.5,38.5,.01,.01)) as raster:
                raster.write(np.full((100,100),10,dtype='float32'),1)
            for name in ('a','b'):
                profile=build_profiles(root/(name+'-clean.sqlite'),root/(name+'-profiles.sqlite'),'a_south',[dem])
                self.assertTrue(profile['validation']['pass'])
            self.assertEqual(sha(root/'a-profiles.sqlite'),sha(root/'b-profiles.sqlite'))
            with sqlite3.connect(root/'a-clean.sqlite') as db:
                self.assertEqual(db.execute("SELECT count(*) FROM objects WHERE kind='road'").fetchone()[0],2)
                self.assertEqual(db.execute("SELECT count(*) FROM objects WHERE kind='building'").fetchone()[0],1)
                self.assertEqual(db.execute("SELECT id FROM objects WHERE kind IN ('coast','landuse') ORDER BY id").fetchall(),[('coast:w4',),('landuse:w4',)])
                self.assertEqual(db.execute("SELECT id FROM objects WHERE kind='building'").fetchone()[0],'r50')
                block=json.loads(db.execute("SELECT data FROM objects WHERE kind='building'").fetchone()[0])
                self.assertEqual(block['parts'][0]['heightSource'],'landuse-default')
                self.assertEqual(block['parts'][0]['height'],8)
                self.assertEqual(db.execute("SELECT count(*) FROM objects WHERE kind='restriction'").fetchone()[0],1)
            ingest(source,root/'a.sqlite',[23.7,37.8,23.8,38]) # cache hit
            with self.assertRaises(ValueError):ingest(source,root/'a.sqlite',[23.7,37.8,23.9,38])


if __name__=='__main__':unittest.main()
