import unittest
from bridge_policy import require_bridge_yes,connected_approaches
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
  self.assertEqual([r['id'] for r in connected_approaches([far,adjacent,other,approach,bridge],[bridge],(0,0))],['bridge','approach'])
if __name__=='__main__':unittest.main()
