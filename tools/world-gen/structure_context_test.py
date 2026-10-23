"""Small synthetic source ingestion and certified wall/footprint regressions."""
import copy
import contextlib
import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from shapely import wkb
from shapely.geometry import LineString, box
from structure_context import (source_record,context_kind,create_context_tables,insert_context,
    intersected_cells,read_profile_certificate,ProfileCertificate,mapped_wall_mesh,matched_footprint)
from tile_detail import mapped_retaining_wall_mesh,matched_bridge_footprint
from model import unproject

FIXTURE=json.loads((Path(__file__).parent/'fixtures/structure-context.json').read_text())

class SourceContext(unittest.TestCase):
 def setUp(self):
  self.wall=FIXTURE['wall'];self.record=self.wall['record'];self.line=wkb.loads(bytes.fromhex(self.wall['geometryHex']))
  self.certificate=read_profile_certificate(self.wall['certificate'].encode(),self.wall['certificateSha256'])
 def test_certificate_mesh_seams_and_budget(self):
  a,ar=mapped_retaining_wall_mesh(self.record,self.line,self.certificate,(0,0))
  b,br=mapped_retaining_wall_mesh(self.record,self.line,self.certificate,(1,0))
  self.assertEqual((len(a[1])//3,len(b[1])//3),(2,2));self.assertEqual(ar['arrayBytes']+br['arrayBytes'],120)
  self.assertEqual(ar['cells'],[[0,0],[1,0]]);self.assertFalse(ar['releaseEligible'])
  left={(a[0][i],a[0][i+1],a[0][i+2]) for i in range(0,len(a[0]),3) if a[0][i]==512}
  right={(b[0][i]+512,b[0][i+1],b[0][i+2]) for i in range(0,len(b[0]),3) if b[0][i]==0}
  self.assertEqual(left,right);self.assertEqual(sorted(y for x,y,z in left),[0,6])
 def test_hash_mismatch_and_unsealed_certificate_rejected(self):
  with self.assertRaisesRegex(ValueError,'hash mismatch'):read_profile_certificate(self.wall['certificate'].encode()+b' ',self.wall['certificateSha256'])
  changed=copy.deepcopy(self.record);changed['id']='w999'
  with self.assertRaisesRegex(ValueError,'record hash'):mapped_wall_mesh(changed,self.line,self.certificate,(0,0))
  fake=ProfileCertificate(self.certificate.sha256,self.certificate.payload)
  with self.assertRaisesRegex(ValueError,'certificate'):mapped_wall_mesh(self.record,self.line,fake,(0,0))
  with self.assertRaisesRegex(ValueError,'geometry mismatch'):mapped_wall_mesh(self.record,LineString([(510,11),(514,11)]),self.certificate,(0,0))
 def test_side_controls_winding_and_profile_cannot_invert(self):
  data=json.loads(self.wall['certificate']);data['retainedSide']='right';raw=json.dumps(data).encode();cert=read_profile_certificate(raw,hashlib.sha256(raw).hexdigest())
  a,_=mapped_wall_mesh(self.record,self.line,self.certificate,(0,0));b,_=mapped_wall_mesh(self.record,self.line,cert,(0,0))
  self.assertEqual(a[0],b[0]);self.assertEqual(a[1],[0,1,2,0,2,3]);self.assertEqual(b[1],[0,2,1,0,3,2])
  data['spans'][0]['a']['top']=-1;raw=json.dumps(data).encode();cert=read_profile_certificate(raw,hashlib.sha256(raw).hexdigest())
  with self.assertRaisesRegex(ValueError,'Inverted'):mapped_wall_mesh(self.record,self.line,cert,(0,0))
 def test_context_classification_closure_and_source_identity(self):
  self.assertEqual(context_kind({'barrier':'retaining_wall'}),'retaining_wall');self.assertIsNone(context_kind({'barrier':'wall'}))
  with self.assertRaisesRegex(ValueError,'closed'):source_record('w1','bridge_footprint',1,'now','a'*64,{'man_made':'bridge'},LineString([(0,0),(1,1)]))
  p=box(0,0,10,10);a=source_record('w1','bridge_footprint',1,'now','a'*64,{'man_made':'bridge'},p,[1,2,3,1]);b=source_record('w1','bridge_footprint',2,'now','a'*64,{'man_made':'bridge'},p,[1,2,3,1])
  self.assertNotEqual(a['recordSha256'],b['recordSha256']);self.assertEqual(a['geometrySha256'],b['geometrySha256'])
  with sqlite3.connect(':memory:') as db:
   create_context_tables(db);insert_context(db,a,p)
   with self.assertRaises(sqlite3.IntegrityError):insert_context(db,b,p)
 def test_footprint_requires_exact_explicit_source_family(self):
  p=box(0,0,10,10);r=source_record('w1','bridge_footprint',1,'now','a'*64,{'man_made':'bridge'},p,[1,2,3,1]);item=dict(record=r,geometry=p,bridgeSources=['w7:0'])
  self.assertIs(matched_bridge_footprint([item],['w7:0'],'a'*64),item)
  for records,ids,sha in [([item,item],['w7:0'],'a'*64),([item],['w8:0'],'a'*64),([item],['w7:0'],'b'*64)]:
   with self.assertRaisesRegex(ValueError,'ambiguous'):matched_footprint(records,ids,sha)
 def test_segment_cell_enumeration_does_not_skip_middle_cells(self):
  self.assertEqual(intersected_cells(LineString([(10,10),(1540,10)])),[[0,0],[1,0],[2,0],[3,0]])

class AdditiveIngest(unittest.TestCase):
 def xml(self,context):
  root=ET.Element('osm',version='0.6',generator='synthetic-context-test')
  coords={1:(10,10),2:(20,10),3:(30,10),4:(40,40),5:(60,40),6:(60,60),7:(40,60),8:(70,70),9:(80,70),10:(80,80),11:(70,80)}
  for key,(x,z) in coords.items():
   lon,lat=unproject(x,z);ET.SubElement(root,'node',id=str(key),version='1',lat=str(lat),lon=str(lon))
  def way(key,refs,tags):
   w=ET.SubElement(root,'way',id=str(key),version='3',timestamp='2026-01-01T00:00:00Z')
   for n in refs:ET.SubElement(w,'nd',ref=str(n))
   for k,v in tags.items():ET.SubElement(w,'tag',k=k,v=v)
  way(100,[1,2,3],{'highway':'residential'})
  if context:
   way(300,[2,3],{'barrier':'retaining_wall','material':'concrete'})
   way(400,[4,5,6,7,4],{'man_made':'bridge','layer':'1'})
   way(401,[4,5],{'man_made':'bridge'})
   way(501,[8,9,10,11,8],{})
   r=ET.SubElement(root,'relation',id='500',version='8',timestamp='2026-02-02T00:00:00Z');ET.SubElement(r,'member',type='way',ref='501',role='outer')
   for k,v in {'type':'multipolygon','man_made':'bridge','layer':'1'}.items():ET.SubElement(r,'tag',k=k,v=v)
  return ET.tostring(root)
 def test_additive_tables_preserve_versions_and_do_not_touch_road_node_use(self):
  from ingest import ingest
  with tempfile.TemporaryDirectory() as tmp:
   outputs=[]
   for extra in (False,True):
    path=Path(tmp)/('with' if extra else 'without');osm=path.with_suffix('.osm');osm.write_bytes(self.xml(extra));output=path.with_suffix('.sqlite')
    with contextlib.redirect_stdout(io.StringIO()):ingest(osm,output,[23.72,37.97,23.74,37.99])
    with sqlite3.connect(output) as db:
     outputs.append((db.execute("select id,tags,geometry,refs from features where kind='road'").fetchall(),db.execute('select * from node_use order by id').fetchall()))
     if extra:
      rows=db.execute('select id,version,sourceSha256,tags from context_sources order by id').fetchall()
      self.assertEqual([r[:2] for r in rows],[('r500',8),('w300',3),('w400',3)])
      self.assertTrue(all(r[2]==hashlib.sha256(osm.read_bytes()).hexdigest() for r in rows))
      self.assertEqual(json.loads(rows[1][3])['material'],'concrete')
      manifest=json.loads(db.execute("select value from metadata where key='manifest'").fetchone()[0]);self.assertEqual(manifest['contextCounts'],{'bridge_footprint':2,'retaining_wall':1})
      self.assertEqual(manifest['errors']['invalidContext:bridge_footprint'],1)
   self.assertEqual(outputs[0],outputs[1])

if __name__=='__main__':unittest.main()
