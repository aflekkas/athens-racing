import unittest
from bridge_policy import require_bridge_yes,connected_approaches,exclusion_reason
class Policy(unittest.TestCase):
 def road(self,i,a,b,za,zb,name='A'):
  return dict(id=i,way=i,fromNode=a,toNode=b,points=[[0,za],[0,zb]],name=name,highway='primary',tunnel=False)
 def test_literal_source(self):
  road=self.road('bridge','a','b',-10,10)
  require_bridge_yes([road],{'bridge':'yes'})
  for tag in [None,True,'viaduct','no','1']:
   with self.assertRaises(ValueError):require_bridge_yes([road],{'bridge':tag})
 def test_only_connected_approaches(self):
  bridge=self.road('bridge','a','b',-10,10)
  approach=self.road('approach','b','c',10,180)
  far=self.road('far','c','d',180,300)
  adjacent=self.road('adjacent','x','y',-10,10)
  other=self.road('other','a','z',-10,-90,'B')
  spur=self.road('spur','a','q',-10,-60,'C')   # makes node a a three-road junction: B is a side street, not the bridge's continuation
  self.assertEqual([r['id'] for r in connected_approaches([far,adjacent,other,spur,approach,bridge],[bridge],(0,0))],['bridge','approach'])
 def test_continuation_at_a_tag_boundary_joins_the_chain(self):
  # OSM often changes name or class exactly at a bridge end; a node joining two roads is a continuation, not a junction.
  bridge=self.road('bridge','a','b',-10,10)
  renamed=self.road('renamed','b','c',10,90,'B')
  renamed['highway']='secondary'
  side=self.road('side','b','s',10,60,'C')      # now b joins three roads: neither continuation nor side street is pulled in
  self.assertEqual([r['id'] for r in connected_approaches([bridge,renamed],[bridge],(0,0))],['bridge','renamed'])
  self.assertEqual([r['id'] for r in connected_approaches([bridge,renamed,side],[bridge],(0,0))],['bridge'])
 def test_exclusion_rules(self):
  base=dict(tunnel=False,bridge=False,layer=0)
  self.assertIsNone(exclusion_reason(base,None))
  self.assertIsNone(exclusion_reason(dict(base,bridge=True,layer=1),'yes'),'one deck over ground is modelled')
  self.assertEqual(exclusion_reason(dict(base,tunnel=True,layer=-1),None),'tunnel')
  self.assertEqual(exclusion_reason(dict(base,bridge=True,layer=2),'yes'),'bridge on layer 2')
  self.assertEqual(exclusion_reason(dict(base,bridge=True,layer=1),'viaduct'),'bridge=viaduct')
  self.assertEqual(exclusion_reason(dict(base,bridge=True,layer=0),'yes'),'bridge on layer 0')
  self.assertEqual(exclusion_reason(dict(base,layer=-1),None),'layer -1 without a bridge')
if __name__=='__main__':unittest.main()
