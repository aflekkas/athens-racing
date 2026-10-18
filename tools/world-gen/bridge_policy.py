"""Owner-authorized narrow shoulders: literal bridge=yes and connected approaches only."""
import math

def require_bridge_yes(bridges,tags):
 if any(tags.get(r['way'])!='yes' for r in bridges):
  raise ValueError('Guarded shoulder exception requires literal OSM bridge=yes')

def connected_approaches(roads,bridges,centre):
 if not bridges:return []
 upper={r['id']:r for r in bridges};first=bridges[0]
 while True:
  ends={node for r in upper.values() for node,p in [(r['fromNode'],r['points'][0]),(r['toNode'],r['points'][-1])] if math.dist(p,centre)<160}
  extra=[r for r in roads if r['id'] not in upper and not r['tunnel'] and r['name']==first['name'] and r['highway']==first['highway'] and ends.intersection((r['fromNode'],r['toNode']))]
  if not extra:return list(upper.values())
  upper.update((r['id'],r) for r in sorted(extra,key=lambda r:r['id']))
