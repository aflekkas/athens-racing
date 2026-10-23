import runpy,unittest,copy
m=runpy.run_path('/tmp/athens-terrain.uKVC/plan-b-controller.py');H=m['H'];Stop=m['StopDiagnostic']
def certificate(id_):return {'schema':'terrain-lp-component-1','partitionVersion':1,'inputSHA256':H,'componentId':id_,'mode':'inner','stage':'gradient','facets':16,'fullRowCount':679034,'solverStatus':0}
def verification(id_):return {'componentId':id_,'mode':'inner','stage':'gradient','completeModelVerified':False,'primalPassed':True,'dualPassed':True,'dualityGap':0,'gradientVariable':.1,'maxEuclideanGradient':.1,'maxSag':.5,'maxAdjustment':.75,'maxProfileCorrection':0,'maxRowViolation':0,'conservativeDualBound':.1}
def full():return {'schema':'terrain-lp-decomposition-verification-1','inputSHA256':H,'mode':'inner','stage':'gradient','fullPrimalPassed':True,'fullDualPassed':True,'optimumVerified':True,'dualityGap':0,'gradientVariable':.1,'maxEuclideanGradient':.1,'maxSag':.5,'maxAdjustment':.75,'maxProfileCorrection':0,'conservativeDualBound':.1}
class Fake:
 def __init__(self):self.calls=[];self.modify=lambda i,c,v:None;self.budget=200;self.full_result=full();self.fail_saved=False;self.final_budget=False
 def saved(self):
  self.calls.append('saved');c=certificate('-32,608');v=verification('-32,608')
  if self.fail_saved:c['inputSHA256']='wrong'
  return c,v
 def remaining(self):return 44 if self.final_budget and len([c for c in self.calls if isinstance(c,int)])==6 else self.budget
 def component(self,i,meta):
  self.calls.append(i);c=certificate(meta[0]);v=verification(meta[0]);self.modify(i,c,v);return c,v
 def assemble(self,certificates):self.calls.append('assemble');assert len(certificates)==7;return self.full_result
class Tests(unittest.TestCase):
 def test_success_assembles_only_complete_seven(self):
  e=Fake();r=m['sequence'](e);self.assertEqual(e.calls,['saved',0,1,2,3,4,5,'assemble']);self.assertTrue(r['optimumVerified'])
 def test_first_timeout_stops_later_components_and_assembly(self):
  e=Fake();e.modify=lambda i,c,v:c.update(solverStatus=1)if i==2 else None
  with self.assertRaisesRegex(Stop,'Nonoptimal'):m['sequence'](e)
  self.assertEqual(e.calls,['saved',0,1,2])
 def test_first_verifier_failure_stops(self):
  e=Fake();e.modify=lambda i,c,v:v.update(primalPassed=False)if i==1 else None
  with self.assertRaisesRegex(Stop,'verification rejected'):m['sequence'](e)
  self.assertEqual(e.calls,['saved',0,1])
 def test_wrong_component_id_stops(self):
  e=Fake();e.modify=lambda i,c,v:c.update(componentId='another')
  with self.assertRaisesRegex(Stop,'header mismatch'):m['sequence'](e)
  self.assertEqual(e.calls,['saved',0])
 def test_historical_pin_failure_blocks_first_solve(self):
  e=Fake();e.fail_saved=True
  with self.assertRaisesRegex(Stop,'header mismatch'):m['sequence'](e)
  self.assertEqual(e.calls,['saved'])
 def test_insufficient_total_reserve_blocks_new_component(self):
  e=Fake();e.budget=83
  with self.assertRaisesRegex(Stop,'Insufficient total time'):m['sequence'](e)
  self.assertEqual(e.calls,['saved'])
 def test_full_reserve_exhaustion_blocks_assembly(self):
  e=Fake();e.final_budget=True
  with self.assertRaisesRegex(Stop,'Full verification time'):m['sequence'](e)
  self.assertNotIn('assemble',e.calls)
 def test_resource_guard_exception_stops_queue(self):
  e=Fake()
  def pressure(i,c,v):raise Stop('RSS guard fixture')
  e.modify=pressure
  with self.assertRaisesRegex(Stop,'RSS guard'):m['sequence'](e)
  self.assertEqual(e.calls,['saved',0])
 def test_profile_change_rejected_despite_claimed_pass(self):
  e=Fake();e.modify=lambda i,c,v:v.update(maxProfileCorrection=.001)
  with self.assertRaisesRegex(Stop,'verification rejected'):m['sequence'](e)
  self.assertEqual(e.calls,['saved',0])
 def test_full_report_requires_exact_norm_and_optimal_dual(self):
  for change in [dict(maxEuclideanGradient=.2),dict(dualityGap=.01),dict(fullDualPassed=False)]:
   e=Fake();e.full_result.update(change)
   with self.assertRaises(Stop):m['sequence'](e)
 def test_nonfinite_verifier_is_not_accepted(self):
  e=Fake();e.modify=lambda i,c,v:v.update(dualityGap=float('nan'))
  with self.assertRaisesRegex(Stop,'Nonfinite'):m['sequence'](e)
  self.assertEqual(e.calls,['saved',0])
if __name__=='__main__':unittest.main()
