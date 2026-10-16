"""Stream ground-cell AWT intermediates. Refuses unresolved structures; never publishes a manifest."""
import sys,json,math,sqlite3,collections
from pathlib import Path
from functools import lru_cache
import numpy as np
from shapely.geometry import LineString,Point,Polygon,box,shape
from shapely.strtree import STRtree
from shapely.ops import unary_union
from surfaces import ground_mesh,validate_partition,f32,SurfaceHeight
from elevation import Elevation
from appearance import BUILDINGS,linear,ground_colour
from ingest import encode
from styles import face_shaded,ROAD,PAVEMENT,KERB_TOP,KERB_SIDE,MARKING
from street_details import pavement_regions,kerb_sides,road_markings,pavement_lift,ribbon_polygon,ribbon_lateral

class Field:
 def __init__(self,db,source,cell,dems):
  self.cell=cell;self.dem=Elevation(dems);ox,oz=cell[0]*512,cell[1]*512;self.ox=ox;self.oz=oz
  self.roads=[];self.byid={};self.land=[]
  for row,data in db.execute('SELECT r.rowid,r.data FROM spatial s CROSS JOIN roads r ON r.rowid=s.rowid WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY r.id',(ox+608,ox-96,oz+608,oz-96)):
   r=json.loads(data);line=LineString(r['points']);r['line']=line;r['polygon']=ribbon_polygon(line,r['width'])
   samples=list(db.execute('SELECT s.station,p.y FROM samples s JOIN points p ON p.rowid=s.point WHERE s.road=? ORDER BY s.station',(row,)))
   r['stations']=[s[0] for s in samples];r['ys']=[s[1] for s in samples]
   if (r['bridge'] or r['tunnel'] or r['layer']) and r['polygon'].intersects(box(ox,oz,ox+512,oz+512)):
    raise ValueError('Ground probe refuses unsolved layered road '+r['id'])
   if not(r['bridge'] or r['tunnel'] or r['layer']):self.roads.append(r);self.byid[r['id']]=r
  self.tree=STRtree([r['polygon'] for r in self.roads])
  for data, in source.execute("SELECT o.data FROM spatial s CROSS JOIN objects o ON o.rowid=s.rowid WHERE o.kind IN ('landuse','landcover') AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id",(ox+512,ox,oz+512,oz)):
   value=json.loads(data);g=shape(value['geometry']);self.land.append((g,value['tags']))
  self.landtree=STRtree([p for p,t in self.land])
 @lru_cache(maxsize=65536)
 def height(self,x,z):
  point=Point(x,z);baseline=self.dem.height(x,z)
  if not self.roads:return baseline
  # Compact support is continuous at every road boundary and tie. Selecting
  # only the nearest/containing road introduced steps between adjacent profiles.
  ids=sorted((int(i) for i in self.tree.query(box(x-64,z-64,x+64,z+64))),key=lambda i:self.roads[i]['id'])
  values=[];distance=math.inf
  for i in ids:
   road=self.roads[i];d=road['polygon'].distance(point);distance=min(distance,d)
   if d>=64:continue
   station=road['line'].project(point);y=float(np.interp(station,road['stations'],road['ys']))
   radius=road['width']/2+16;center_distance=road['line'].distance(point)
   weight=(1-d/64)**2/(1+(center_distance/radius)**4)
   values.append((y,weight))
  if not values:return baseline
  y=sum(h*w for h,w in values)/sum(w for h,w in values)
  return min(y+distance*.4,max(y-distance*.4,baseline))
 @lru_cache(maxsize=65536)
 def surface_height(self,x,z):
  if not self.roads:return self.height(x,z)
  point=Point(x,z);distance=self.roads[int(self.tree.nearest(point))]['polygon'].distance(point)
  return self.height(x,z)+pavement_lift(distance)
 def colour(self,x,z):
  p=Point(x,z);candidates=[int(i) for i in self.landtree.query(p) if self.land[int(i)][0].covers(p)]
  tags=self.land[min(candidates,key=lambda i:self.land[i][0].area)][1] if candidates else {}
  h=self.height(x,z);slope=math.hypot(self.height(x+1,z)-self.height(x-1,z),self.height(x,z+1)-self.height(x,z-1))/2
  return ground_colour(x,z,h,slope,tags.get('landuse',''),tags.get('natural',''))[1]

TABLES={'nodes':[],'nodePositions':[],'edges':[],'edgePoints':[],'edgeLayers':[],'turns':[],'ribbons':[],'ribbonVertices':[],'junctions':[],'junctionVertices':[],'markings':[],'contactPositions':[],'contactTriangles':[],'contactLayers':[],'coarseHeights':[],'finePositions':[],'fineTriangles':[],'buildings':[],'buildingCorners':[],'buildingHeights':[],'signs':[],'signTransforms':[],'anchors':[],'anchorTransforms':[]}

def bake(dbpath,sourcepath,graphpath,turnpath,cell,dems,world,revision):
 db=sqlite3.connect(f'file:{dbpath}?mode=ro',uri=True);source=sqlite3.connect(f'file:{sourcepath}?mode=ro',uri=True)
 field=Field(db,source,cell,dems);roadunion,kerb,pavement=pavement_regions(field.roads)
 surface=ground_mesh(cell,field.roads,field.surface_height,[kerb.boundary,pavement.boundary]);
 validation=validate_partition(surface)
 ox,oz=field.ox,field.oz;t={k:[] for k in TABLES};arrays=[];meshes=[];ids=[''];strings=[''];palette=[[1,1,1],ROAD,*[linear(c) for c in BUILDINGS],PAVEMENT,KERB_TOP,KERB_SIDE,MARKING]
 def identifier(s):
  if s not in ids:ids.append(s)
  return ids.index(s)
 def array(type,data):arrays.append(dict(type=type,data=data));return len(arrays)-1
 def mesh(positions,indices,material,colours=None):
  # Split by triangle blocks; compact remapping bounds each upload job.
  for start in range(0,len(indices),16384*3):
   selected=indices[start:start+16384*3];remap={};ps=[];cs=[];ix=[]
   for old in selected:
    if old not in remap:
     remap[old]=len(ps)//3;ps.extend(positions[old*3:old*3+3])
     if colours is not None:cs.extend(colours[old*3:old*3+3])
    ix.append(remap[old])
   attrs=dict(position=dict(array=array('Float32Array',ps),itemSize=3,normalized=False))
   if colours is not None:attrs['color']=dict(array=array('Uint8Array',[round(c*255) for c in cs]),itemSize=3,normalized=True)
   meshes.append(dict(name='probe',material=material,attributes=attrs,index=array('Uint16Array',ix),userData=dict(worldSurface=material in (0,1,8,9)),layers=1,drawRange=dict(start=0,count=len(ix))))
 p=surface['positions'];t['finePositions']=p;t['fineTriangles']=surface['triangles'];t['contactPositions']=p
 rendered_height=SurfaceHeight(surface)
 t['coarseHeights']=[f32(field.surface_height(ox+x,oz+z)) for z in range(0,513,16) for x in range(0,513,16)]
 terrain=identifier('terrain:'+str(cell[0])+':'+str(cell[1]));roadtri=collections.defaultdict(list);ground=[];pavement_tri=[];kerb_tri=[]
 for i,owner in enumerate(surface['owners']):
  tri=surface['triangles'][i*3:i*3+3]
  sid=identifier('surface:'+owner) if owner else terrain
  t['contactTriangles'].extend([*tri,sid,1 if owner else 2]);t['contactLayers'].append(0)
  if owner:roadtri[owner].extend(tri)
  else:
   center=Point(ox+sum(p[v*3] for v in tri)/3,oz+sum(p[v*3+2] for v in tri)/3)
   (kerb_tri if kerb.covers(center) else pavement_tri if pavement.covers(center) else ground).extend(tri)
 colours=[]
 for i in range(0,len(p),3):colours.extend(field.colour(ox+p[i],oz+p[i+2]))
 mesh(p,ground,0,colours)
 raised=p
 mesh(raised,pavement_tri,8);mesh(raised,kerb_tri,9)
 # The bevel is the physical/rendered kerb; no unsupported vertical wall.
 paintps,paintix=road_markings(field.roads,cell,rendered_height);mesh(paintps,paintix,11)
 # Directed graph is clipped globally; sample final emitted contacts for Y.
 graphdb=sqlite3.connect(f'file:{graphpath}?mode=ro',uri=True)
 graphrows=[json.loads(data) for data, in graphdb.execute('SELECT data FROM edges WHERE tx BETWEEN ? AND ? AND tz BETWEEN ? AND ? ORDER BY id',(cell[0]-1,cell[0]+1,cell[1]-1,cell[1]+1))]
 graphdb.close();byroad=collections.defaultdict(list);node_positions={};emitted_graph=[]
 turndb=sqlite3.connect(f'file:{turnpath}?mode=ro',uri=True)
 blocked={row[0] for row in turndb.execute('SELECT edge FROM blocked')}
 for edge in graphrows:
  if edge['id'] in blocked:edge['flags']|=8
 for edge in graphrows:byroad[edge['source']].append(edge)
 for edge in graphrows:
  if tuple(edge['cell'])!=tuple(cell):continue
  positions=[]
  for x,y,z,station in edge['points']:
   lx,lz=f32(x-ox),f32(z-oz);positions.append([lx,f32(rendered_height(ox+lx,oz+lz)),lz])
  for key,point in ((edge['fromNode'],positions[0]),(edge['toNode'],positions[-1])):
   if key in node_positions:
    if node_positions[key]!=point:raise ValueError('Graph node contact mismatch '+key)
   else:
    node_positions[key]=point;t['nodes'].extend([identifier(key),len(t['nodePositions'])//3]);t['nodePositions'].extend(point)
  name=edge['name']
  if name not in strings:strings.append(name)
  road=field.byid[edge['source']];direction='forward' if ':f:' in edge['id'] else 'backward'
  raw_lanes=road['directionalTags'].get('lanes:'+direction,road['lanes'] if road['oneway'] else None)
  try:lanes=int(raw_lanes) if raw_lanes is not None and float(raw_lanes).is_integer() and 0<float(raw_lanes)<=32 else 0
  except (TypeError,ValueError):lanes=0
  t['edges'].extend([identifier(edge['id']),identifier(edge['fromNode']),identifier(edge['toNode']),len(t['edgePoints'])//3,len(positions),strings.index(name),lanes,edge['speedKph'],edge['flags'],identifier(edge['surface'])])
  t['edgePoints'].extend(v for point in positions for v in point);t['edgeLayers'].append(edge['layer'])
  emitted_graph.append((edge,positions))
  for incoming,via,target in turndb.execute('SELECT from_edge,via_node,to_edge FROM turns WHERE from_edge=? ORDER BY via_node,to_edge',(edge['id'],)):
   t['turns'].extend([identifier(incoming),identifier(via),identifier(target),1])
 for owner,indices in sorted(roadtri.items()):
  road=field.byid[owner];sid=identifier('surface:'+owner)
  candidates=byroad[owner]
  if not candidates:raise ValueError('Ribbon has no graph edge '+owner)
  reference=min(candidates,key=lambda e:(tuple(e['cell'])!=tuple(cell),':f:' not in e['id'],e['id']))
  edge=identifier(reference['id']);orientation=1 if ':f:' in reference['id'] else -1
  start=len(t['ribbonVertices'])//5
  for vertex in indices:
   x,y,z=p[vertex*3:vertex*3+3]
   station,lateral=ribbon_lateral(road['line'],ox+x,oz+z,orientation==1)
   t['ribbonVertices'].extend([x,y,z,station,lateral])
  t['ribbons'].extend([sid,edge,start,len(indices),1])
 mesh(p,[v for ix in roadtri.values() for v in ix],1)
 turndb.close()
 # Centroid ownership, including dependency records for crossing boxes.
 dependencies=set();maxbuilding=0;buildinggroups={};all_building_footprints=[]
 for data, in source.execute("SELECT o.data FROM spatial s CROSS JOIN objects o ON o.rowid=s.rowid WHERE o.kind='building' AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id",(ox+512,ox,oz+512,oz)):
  building=json.loads(data);all_building_footprints.extend(Polygon(part['footprint']) for part in building['parts']);owner=tuple(math.floor(v/512) for v in building['centroid'])
  if owner!=tuple(cell):
   if any(Polygon(part['footprint']).intersection(box(ox,oz,ox+512,oz+512)).area>1e-6 for part in building['parts']):dependencies.add(','.join(map(str,owner)))
   continue
  maxbuilding=max(maxbuilding,building['triangles'])
  for part in building['parts']:
   corners=part['footprint'];base=min(field.surface_height(x,z) for x,z in corners);colour=part['palette']+2
   t['buildings'].extend([identifier('building:'+part['id']),len(t['buildingCorners'])//2,len(corners),colour])
   t['buildingCorners'].extend(v for x,z in corners for v in (x-ox,z-oz));t['buildingHeights'].extend([base,part['height']])
   positions=[]
   for i in range(0,len(part['positions']),3):
    x,y,z=part['positions'][i:i+3];positions.extend([x+part['origin'][0]-ox,y+base,z+part['origin'][2]-oz])
   positions,indices,shades=face_shaded(positions,part['indices'])
   ps,ix,cs=buildinggroups.setdefault(colour,([],[],[]));offset=len(ps)//3
   ps.extend(positions);ix.extend(v+offset for v in indices);cs.extend(shades)
 for colour,(ps,ix,cs) in sorted(buildinggroups.items()):mesh(ps,ix,colour,cs)
 # Safe tow/spawn candidates use actual contacts and a bus-sized footprint.
 building_tree=STRtree(all_building_footprints)
 safe_road_area=unary_union([r['polygon'] for r in field.roads if r['public']]).buffer(-.03)
 for edge,points in emitted_graph:
  if edge['flags']&8 or len(points)<3:continue
  line=LineString([(q[0],q[2]) for q in points])
  if line.length<20:continue
  at=line.length/2;mid=line.interpolate(at);a=line.interpolate(at-.5);b=line.interpolate(at+.5)
  dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
  if length<1e-6:continue
  dx,dz=dx/length,dz/length;right=(-dz,dx);offset=max(0,edge['width']/2-1.6)
  x,z=mid.x+right[0]*offset,mid.y+right[1]*offset
  corners=[(x+dx*f+right[0]*w,z+dz*f+right[1]*w) for f,w in [(-7,-1.5),(-7,1.5),(7,1.5),(7,-1.5)]]
  samples=[(x,z),*corners]
  if any(not (0<xx<512 and 0<zz<512) for xx,zz in samples):continue
  covered=True;heights=[]
  for xx,zz in samples:
   q=Point(xx,zz);faces=[int(i) for i in rendered_height.tree.query(q) if rendered_height.polygons[int(i)].covers(q)]
   if not any(surface['owners'][i] and field.byid[surface['owners'][i]]['public'] for i in faces):covered=False;break
   heights.append(rendered_height(ox+xx,oz+zz))
  if not covered or max(heights)-min(heights)>2.8:continue
  body=Polygon([(ox+xx,oz+zz) for xx,zz in corners])
  if not safe_road_area.covers(body):continue
  if any(all_building_footprints[int(i)].intersects(body) for i in building_tree.query(body)):continue
  anchor='anchor:tow:'+edge['id'];kind=0 if not t['anchors'] else 1
  label=edge['name'] or 'Athens road'
  if label not in strings:strings.append(label)
  t['anchors'].extend([identifier(anchor),len(t['anchorTransforms'])//4,identifier(edge['id']),kind,strings.index(label)])
  t['anchorTransforms'].extend([f32(x),f32(rendered_height(ox+f32(x),oz+f32(z))),f32(z),f32(math.atan2(-dx,-dz))])
 triangles=sum(len(arrays[m['index']]['data'])//3 for m in meshes)
 validation['renderContactTopIdentity']=True
 validation['graphEdges']=len(emitted_graph);validation['graphContactPoints']=len(t['edgePoints'])//3
 validation['turnRestrictions']=len(t['turns'])//4;validation['safeAnchors']=len(t['anchors'])//5;validation['releaseReady']=False
 metadata=dict(tileVersion=1,world=world,revision=revision,cell=list(cell),origin=[ox,0,oz],ids=ids,strings=strings,palette=palette,meshes=meshes,terrain=dict(coarseSize=33,spacing=16),budgets=dict(triangles=triangles,buildingTriangles=maxbuilding),developmentOnly=True,releaseReady=False)
 field.dem.close();db.close();source.close()
 return dict(metadata=metadata,tables=t,arrays=arrays,dependencies=sorted(dependencies)),validation

if __name__=='__main__':
 import argparse,hashlib,time
 from ingest import sha
 parser=argparse.ArgumentParser(description=__doc__)
 for name in ('profiles','source','graph','turns'):parser.add_argument('--'+name,type=Path,required=True)
 parser.add_argument('--dem',type=Path,action='append',required=True)
 parser.add_argument('--cell',action='append',required=True,help='x,z; repeat to stream several cells')
 parser.add_argument('--world',default='athens-development')
 args=parser.parse_args()
 inputs={name:sha(getattr(args,name)) for name in ('profiles','source','graph','turns')}
 inputs['dem']=[sha(p) for p in args.dem]
 inputs['code']={p.name:sha(p) for p in sorted(Path(__file__).parent.glob('*.py'))}
 revision=hashlib.sha256(encode(inputs).encode()).hexdigest()
 print(encode(dict(inputs=inputs,revision=revision,releaseReady=False)),file=sys.stderr,flush=True)
 for value in args.cell:
  cell=tuple(map(int,value.split(',')))
  if len(cell)!=2:parser.error('Cell must have exactly two coordinates')
  start=time.monotonic()
  tile,validation=bake(args.profiles,args.source,args.graph,args.turns,cell,args.dem,args.world,revision)
  print(encode(tile),flush=True)
  print(encode(dict(cell=cell,seconds=time.monotonic()-start,**validation)),file=sys.stderr,flush=True)
