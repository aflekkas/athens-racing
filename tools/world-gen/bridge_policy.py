"""Owner-authorized narrow shoulders: literal bridge=yes and connected approaches only."""
import math

def require_bridge_yes(bridges,tags):
 if any(tags.get(r['way'])!='yes' for r in bridges):
  raise ValueError('Guarded shoulder exception requires literal OSM bridge=yes')

def exclusion_reason(road,bridge_tag):
 """Why the streamed world leaves a road out, or None. Decided from the road's own tags only, so every cell agrees.

 One deck over ground is the only structure modelled: literal bridge=yes on layer 1. Tunnels, bridges stacked on
 layer 2 or more, other bridge types and layered non-bridges are not drawn; they are left out of ground, graph,
 anchors and turns in every cell and counted in the bake report (a gap, never an invented surface).
 """
 if road['tunnel']:return 'tunnel'
 if road['bridge']:
  if bridge_tag!='yes':return 'bridge='+str(bridge_tag)
  if road['layer']!=1:return 'bridge on layer '+str(road['layer'])
  return None
 if road['layer']:return 'layer '+str(road['layer'])+' without a bridge'
 return None

def connected_approaches(roads,bridges,centre):
 """The deck's upper chain: the bridge ways plus every road that continues them within 160 m of the crossing.

 A road continues the chain at a shared node when it has the same name and highway class, or when the node joins
 exactly two roads (a tag boundary on one carriageway, not a junction): OSM often changes name or class right at the
 bridge end, and an approach cut there would be too short to lift the deck safely."""
 if not bridges:return []
 degree={}
 for r in roads:
  for node in (r['fromNode'],r['toNode']):degree[node]=degree.get(node,0)+1
 upper={r['id']:r for r in bridges};first=bridges[0]
 while True:
  ends={node for r in upper.values() for node,p in [(r['fromNode'],r['points'][0]),(r['toNode'],r['points'][-1])] if math.dist(p,centre)<160}
  extra=[r for r in roads if r['id'] not in upper and not r['tunnel'] and any(node in ends and ((r['name']==first['name'] and r['highway']==first['highway']) or degree[node]==2) for node in (r['fromNode'],r['toNode']))]
  if not extra:return list(upper.values())
  upper.update((r['id'],r) for r in sorted(extra,key=lambda r:r['id']))
