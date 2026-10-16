"""Bounded stage-A topology audit, not a runtime graph or spawn approval."""
import sqlite3,json,heapq,math
from pathlib import Path
from collections import defaultdict
from shapely.geometry import LineString,Point
c=Path('/tmp/athens-world-cache');db=sqlite3.connect(f'file:{c}/profiles-a.sqlite?mode=ro',uri=True)
source=sqlite3.connect(f'file:{c}/source.sqlite?mode=ro',uri=True)
roads={};edges={};outgoing=defaultdict(list);byway=defaultdict(list)
for row,data in db.execute('SELECT rowid,data FROM roads ORDER BY id'):
 r=json.loads(data);roads[r['id']]=r
 for direction,allowed in [('f',r['publicForward']),('b',r['publicBackward'])]:
  if not allowed:continue
  edge=dict(id=r['id']+':'+direction,road=r['id'],way=r['way'],a=r['fromNode'] if direction=='f' else r['toNode'],b=r['toNode'] if direction=='f' else r['fromNode'],length=r['length'],layer=r['layer'])
  edges[edge['id']]=edge;outgoing[edge['a']].append(edge['id']);byway[edge['way']].append(edge['id'])
prohibited=set();blocked=set();audit=defaultdict(int)
for rid,tags,members in source.execute('SELECT id,tags,members FROM restrictions ORDER BY id'):
 tags=json.loads(tags);members=json.loads(members);ways={f'w{ref}' for kind,ref,role in members if kind=='w'}
 if not any(w in byway for w in ways):continue
 if {v.strip() for v in tags.get('except','').split(';')} & {'motorcar','motor_vehicle','vehicle'}:audit['exceptMotorcar']+=1;continue
 rule=next((tags[k] for k in ('restriction:motorcar','restriction:motor_vehicle','restriction:vehicle','restriction') if k in tags),None)
 if rule is None:
  relevant=('restriction:conditional','restriction:motorcar:conditional','restriction:motor_vehicle:conditional','restriction:vehicle:conditional')
  if any(k in tags for k in relevant):
   for way in ways:blocked.update(byway[way])
   audit['unsupportedFailClosed']+=1
  else:audit['otherVehicleClass']+=1
  continue
 via=[str(ref) for kind,ref,role in members if kind=='n' and role=='via']
 viaways=[ref for kind,ref,role in members if kind=='w' and role=='via']
 fromways={f'w{ref}' for kind,ref,role in members if kind=='w' and role=='from'}
 toways={f'w{ref}' for kind,ref,role in members if kind=='w' and role=='to'}
 unsupported=any('conditional' in k or 'lanes' in k for k in tags) or len(via)!=1 or viaways or not fromways or not toways or not rule.startswith(('no_','only_'))
 if unsupported:
  # A no_* via-way restriction can safely forbid entry into that connector
  # from its from-way. This is deliberately stricter than the source rule,
  # without making every segment of a long coastal road unavailable.
  if viaways and rule.startswith('no_') and not any('conditional' in k for k in tags):
   first=f'w{viaways[0]}'
   for way in fromways:
    for incoming in byway[way]:
     for target in outgoing[edges[incoming]['b']]:
      if edges[target]['way']==first:prohibited.add((incoming,target))
   audit['viaEntryConservativelyProhibited']+=1
  else:
   for way in ways:blocked.update(byway[way])
   audit['unsupportedFailClosed']+=1
  continue
 via=via[0];arriving=[edges[e] for w in fromways for e in byway[w] if edges[e]['b']==via]
 for incoming in arriving:
  for eid in outgoing[via]:
   e=edges[eid];target=e['way'] in toways
   if rule in ('no_u_turn','only_u_turn'):target=target and e['b']==incoming['a']
   if rule.startswith('only_') and rule!='only_u_turn' and incoming['way'] in toways and len(toways)==1:target=target and e['b']!=incoming['a']
   if target if rule.startswith('no_') else not target:prohibited.add((incoming['id'],eid))
 audit['compiledNodeRestriction']+=1
nominal=Point(4559.38514,18642.95518)
startroad=min((r for r in roads.values() if r['way']=='w459160388' and r['public']),key=lambda r:LineString(r['points']).distance(nominal))
start=next(e for e in byway[startroad['way']] if edges[e]['road']==startroad['id'] and e not in blocked)
targets={e for e in edges if edges[e]['road']=='w24826358:0' and e not in blocked}
queue=[(0,start)];distance={start:0};previous={};goal=None
while queue:
 cost,current=heapq.heappop(queue)
 if cost!=distance[current]:continue
 if current in targets:goal=current;break
 for nxt in outgoing[edges[current]['b']]:
  if nxt in blocked or (current,nxt) in prohibited:continue
  alternative=cost+edges[nxt]['length']
  if alternative<distance.get(nxt,math.inf):
   distance[nxt]=alternative;previous[nxt]=current;heapq.heappush(queue,(alternative,nxt))
route=[]
if goal:
 cursor=goal
 while True:
  route.append(cursor)
  if cursor==start:break
  cursor=previous[cursor]
 route.reverse()
result=dict(purpose='Stage-A topology-only Riviera-to-Glyfada audit. No contact/clearance/spawn acceptance.',profileRoads=len(roads),publicDirectedEdges=len(edges),blockedDirectedEdges=len(blocked),prohibitedTransitions=len(prohibited),restrictionAudit=dict(audit),start=start,target=goal,reachable=goal is not None,routeMetres=sum(edges[e]['length'] for e in route),routeEdges=len(route),route=route,releaseReady=False)
Path('/tmp/athens-world-generator/.scratch/athens-world/connectivity-a.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='route'}))
