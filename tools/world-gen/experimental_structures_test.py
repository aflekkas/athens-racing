"""Opt-in scalar feasibility and source graph regressions; never a release gate."""
import copy
import hashlib
import json
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from experimental_structures import (source_graph,full_approach_graph,solve_recipe,require_release_candidate,
                                    REQUIRED_GATES,_profile_graph,certify_node_adjacency,extend_source_way)
from structure_context import read_profile_certificate
from model import unproject
ROOT=Path(__file__).parent;FIXTURE=json.loads((ROOT/'fixtures/structure-context.json').read_text())

class ExperimentalStructures(unittest.TestCase):
 def data(self,short=False):
  part=FIXTURE['infeasible' if short else 'experimental'];raw=(ROOT/('fixtures/three-level-synthetic-short.osm' if short else 'fixtures/three-level-synthetic.osm')).read_bytes()
  graph=source_graph(raw,[23.72,37.97,23.74,37.99]);certificate=read_profile_certificate(part['certificate'].encode(),part['certificateSha256'])
  return copy.deepcopy(part['recipe']),graph,certificate
 def test_three_level_scalar_solution_retains_tags_and_cannot_release(self):
  recipe,graph,certificate=self.data();result=solve_recipe(recipe,graph,certificate,experimental=True)
  self.assertTrue(result['feasible']);self.assertFalse(result['releaseEligible']);self.assertEqual(result['sourceLayers']['w215668928'],1)
  self.assertEqual(set(result['physicalLayers'].values()),{0,1,2});self.assertEqual(set(result['requiredGates']),set(REQUIRED_GATES))
  self.assertTrue(all('pending' in value for value in result['requiredGates'].values()))
  for c in result['crossings']:self.assertGreaterEqual(result['heights'][c['upper']]-result['heights'][c['lower']],5-1e-8)
  with self.assertRaisesRegex(ValueError,'never release'):require_release_candidate(result)
 def test_short_approaches_report_positive_residual_without_lowering_existing_roads(self):
  recipe,graph,certificate=self.data(True);result=solve_recipe(recipe,graph,certificate,experimental=True)
  self.assertFalse(result['feasible']);self.assertFalse(result['releaseEligible'])
  self.assertTrue(any(r.get('residualMetres',0)>3 for r in result['residuals']))
  self.assertIn('existing lower levels pinned',result['heightMeaning'])
 def test_optin_allowlist_and_exact_versions_are_mandatory(self):
  recipe,graph,certificate=self.data()
  with self.assertRaisesRegex(ValueError,'opt-in'):solve_recipe(recipe,graph,certificate)
  for mutate,pattern in [(lambda r:r.update(id='other'),'opt-in'),(lambda r:r.update(bridgeWays=['w999']),'allowlist'),(lambda r:r.update(sourceSha256='0'*64),'hash mismatch'),(lambda r:r['wayVersions'].update(w215668928=2),'version mismatch'),(lambda r:r['segments'].clear(),'actual approach')]:
   bad=copy.deepcopy(recipe);mutate(bad)
   with self.assertRaisesRegex(ValueError,pattern):solve_recipe(bad,graph,certificate,experimental=True)
 def test_cycles_and_one_level_shortcuts_fail(self):
  recipe,graph,certificate=self.data();cycle=copy.deepcopy(recipe);cycle['dependencies'].append([2,0])
  with self.assertRaisesRegex(ValueError,'Cyclic'):solve_recipe(cycle,graph,certificate,experimental=True)
  one=copy.deepcopy(recipe);one['physicalLayers']={k:1 for k in one['segments']}
  with self.assertRaisesRegex(ValueError,'Three explicit'):solve_recipe(one,graph,certificate,experimental=True)
 def test_missing_certified_lower_profile_and_boundary_graph_hash_fail(self):
  recipe,graph,certificate=self.data();value=json.loads(certificate.payload);value['nodes'].pop('101');raw=json.dumps(value).encode();bad=read_profile_certificate(raw,hashlib.sha256(raw).hexdigest())
  with self.assertRaisesRegex(ValueError,'Missing approach boundary'):solve_recipe(recipe,graph,bad,experimental=True)
  value['sourceGraphSha256']='0'*64;raw=json.dumps(value).encode();bad=read_profile_certificate(raw,hashlib.sha256(raw).hexdigest())
  with self.assertRaisesRegex(ValueError,'graph hash'):solve_recipe(recipe,graph,bad,experimental=True)
 def test_geometric_crossing_splits_profiles_but_never_adds_a_turn_or_merges_owners(self):
  recipe,graph,certificate=self.data();scope=full_approach_graph(graph,set(recipe['bridgeWays'])|set(recipe['supportWays']))
  original=copy.deepcopy(graph['adjacency']);vertices,arcs,crossings,layers=_profile_graph(graph,scope,recipe['physicalLayers'])
  self.assertEqual(len(crossings),2);self.assertEqual(graph['adjacency'],original)
  for c in crossings:
   self.assertNotEqual(c['lower'],c['upper']);self.assertEqual(vertices[c['lower']],vertices[c['upper']]);self.assertNotIn(c['lower'],graph['nodes'])
 def test_whole_approach_graph_uses_node_connectivity_and_rejects_uncertified_crop_edges(self):
  recipe,graph,certificate=self.data();scope=full_approach_graph(graph,set(recipe['bridgeWays'])|set(recipe['supportWays']))
  self.assertEqual(set(scope['boundaryProfilesRequired']),{'101','102','201','202','301','302'})
  graph['nodes']['301']['complete']=False
  with self.assertRaisesRegex(ValueError,'Incomplete real approach'):solve_recipe(recipe,graph,certificate,experimental=True)
 def test_node_adjacency_proof_requires_exact_complete_source_way_versions(self):
  recipe,g,cert=self.data();root=ET.fromstring((ROOT/'fixtures/three-level-synthetic.osm').read_bytes());way=next(w for w in root.findall('way') if w.get('id')=='215668928')
  response=ET.Element('osm',version='0.6');response.append(copy.deepcopy(way));raw=ET.tostring(response);g['nodes']['301']['complete']=False
  sealed=certify_node_adjacency(g,'301',raw);self.assertTrue(sealed['nodes']['301']['complete']);self.assertFalse(g['nodes']['301']['complete']);self.assertNotEqual(sealed['sourceSha256'],g['sourceSha256'])
  response[0].set('version','2')
  with self.assertRaisesRegex(ValueError,'stale'):certify_node_adjacency(g,'301',ET.tostring(response))
  with self.assertRaisesRegex(ValueError,'Incomplete adjacency'):certify_node_adjacency(g,'301',b'<osm/>')
 def test_full_way_addition_does_not_certify_adjacency_or_allow_moved_source_nodes(self):
  recipe,g,cert=self.data();root=ET.fromstring((ROOT/'fixtures/three-level-synthetic.osm').read_bytes());full=ET.Element('osm',version='0.6')
  for n in root.findall('node'):
   if n.get('id') in ('301','302'):full.append(copy.deepcopy(n))
  way=copy.deepcopy(next(w for w in root.findall('way') if w.get('id')=='215668928'));way.set('id','999');full.append(way)
  added=extend_source_way(g,'w999',ET.tostring(full));self.assertIn('w999',added['ways']);self.assertNotIn('w999',g['ways']);self.assertEqual(added['nodes']['301']['complete'],g['nodes']['301']['complete'])
  full[0].set('lon',str(float(full[0].get('lon'))+.000001))
  with self.assertRaisesRegex(ValueError,'node moved'):extend_source_way(g,'w999',ET.tostring(full))
 def test_default_bridge_policy_and_existing_plans_are_byte_identical(self):
  golden=json.loads((ROOT/'fixtures/default-structure-policy.json').read_text())
  for path,sha in golden.items():self.assertEqual(hashlib.sha256((ROOT/path).read_bytes()).hexdigest(),sha,path)
  for path in ['bridge_policy.py','coastal.py','tiles.py','plan-structures.py']:
   self.assertNotIn('import experimental_structures',(ROOT/path).read_text())

if __name__=='__main__':unittest.main()
