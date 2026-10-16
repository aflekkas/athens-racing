"""Single-cell geometry probe. Refuses layered structures; never emits a manifest."""
import sys,json,math,sqlite3,collections
from pathlib import Path
from functools import lru_cache
sys.path.insert(0,'/tmp/athens-world-generator/tools/world-gen')
import numpy as np
from shapely.geometry import LineString,Point,Polygon,box,shape
from shapely.strtree import STRtree
from surfaces import ground_mesh,validate_partition,f32
from elevation import Elevation
from appearance import BUILDINGS,linear,ground_colour
from ingest import encode
from styles import face_shaded,ROAD,PAVEMENT,KERB_TOP,KERB_SIDE,MARKING
from street_details import pavement_regions,kerb_sides,road_markings

class Field:
 def __init__(self,db,source,cell,dems):
  self.cell=cell;self.dem=Elevation(dems);ox,oz=cell[0]*512,cell[1]*512;self.ox=ox;self.oz=oz
  self.roads=[];self.byid={};self.land=[]
  for row,data in db.execute('SELECT r.rowid,r.data FROM roads r JOIN spatial s USING(rowid) WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY r.id',(ox+608,ox-96,oz+608,oz-96)):
   r=json.loads(data);line=LineString(r['points']);r['line']=line;r['polygon']=line.buffer(r['width']/2,cap_style=2,join_style=2)
   samples=list(db.execute('SELECT s.station,p.y FROM samples s JOIN points p ON p.rowid=s.point WHERE s.road=? ORDER BY s.station',(row,)))
   r['stations']=[s[0] for s in samples];r['ys']=[s[1] for s in samples]
   if (r['bridge'] or r['tunnel'] or r['layer']) and r['polygon'].intersects(box(ox,oz,ox+512,oz+512)):
    raise ValueError('Ground probe refuses unsolved layered road '+r['id'])
   if not(r['bridge'] or r['tunnel'] or r['layer']):self.roads.append(r);self.byid[r['id']]=r
  self.tree=STRtree([r['polygon'] for r in self.roads])
  for data, in source.execute("SELECT o.data FROM objects o JOIN spatial s USING(rowid) WHERE o.kind IN ('landuse','landcover') AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id",(ox+512,ox,oz+512,oz)):
   value=json.loads(data);g=shape(value['geometry']);self.land.append((g,value['tags']))
  self.landtree=STRtree([p for p,t in self.land])
 @lru_cache(maxsize=65536)
 def height(self,x,z):
  point=Point(x,z);baseline=self.dem.height(x,z)
  if not self.roads:return baseline
  inside=[int(i) for i in self.tree.query(point) if self.roads[int(i)]['polygon'].covers(point)]
  ids=inside or [int(self.tree.nearest(point))]
  values=[]
  for i in ids:
   road=self.roads[i];station=road['line'].project(point)
   y=float(np.interp(station,road['stations'],road['ys']));distance=road['polygon'].distance(point)
   values.append((y,1/(1+road['line'].distance(point)),distance))
  y=sum(h*w for h,w,d in values)/sum(w for h,w,d in values)
  distance=min(d for h,w,d in values)
  if distance>64:return baseline
  return min(y+distance*.4,max(y-distance*.4,baseline))
 def colour(self,x,z):
  p=Point(x,z);candidates=[int(i) for i in self.landtree.query(p) if self.land[int(i)][0].covers(p)]
  tags=self.land[min(candidates,key=lambda i:self.land[i][0].area)][1] if candidates else {}
  h=self.height(x,z);slope=math.hypot(self.height(x+1,z)-self.height(x-1,z),self.height(x,z+1)-self.height(x,z-1))/2
  return ground_colour(x,z,h,slope,tags.get('landuse',''),tags.get('natural',''))[1]

TABLES={'nodes':[],'nodePositions':[],'edges':[],'edgePoints':[],'edgeLayers':[],'turns':[],'ribbons':[],'ribbonVertices':[],'junctions':[],'junctionVertices':[],'markings':[],'contactPositions':[],'contactTriangles':[],'contactLayers':[],'coarseHeights':[],'finePositions':[],'fineTriangles':[],'buildings':[],'buildingCorners':[],'buildingHeights':[],'signs':[],'signTransforms':[],'anchors':[],'anchorTransforms':[]}

def bake(dbpath,sourcepath,cell,dems):
 db=sqlite3.connect(f'file:{dbpath}?mode=ro',uri=True);source=sqlite3.connect(f'file:{sourcepath}?mode=ro',uri=True)
 field=Field(db,source,cell,dems);roadunion,kerb,pavement=pavement_regions(field.roads)
 surface=ground_mesh(cell,field.roads,field.height,[kerb.boundary,pavement.boundary]);validation=validate_partition(surface)
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
   meshes.append(dict(name='probe',material=material,attributes=attrs,index=array('Uint16Array',ix),userData={},layers=1,drawRange=dict(start=0,count=len(ix))))
 p=surface['positions'];t['finePositions']=p;t['fineTriangles']=surface['triangles'];t['contactPositions']=p
 t['coarseHeights']=[f32(field.height(ox+x,oz+z)) for z in range(0,513,16) for x in range(0,513,16)]
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
 raised=[v+.10 if i%3==1 else v for i,v in enumerate(p)]
 mesh(raised,pavement_tri,8);mesh(raised,kerb_tri,9)
 sideps,sideix=kerb_sides(roadunion.boundary,cell,field.height);mesh(sideps,sideix,10)
 paintps,paintix=road_markings(field.roads,cell,field.height);mesh(paintps,paintix,11)
 for owner,indices in sorted(roadtri.items()):
  road=field.byid[owner];sid=identifier('surface:'+owner);edge=identifier('edge:'+owner+':'+str(cell[0])+':'+str(cell[1]))
  start=len(t['ribbonVertices'])//5
  for vertex in indices:
   x,y,z=p[vertex*3:vertex*3+3];station=road['line'].project(Point(ox+x,oz+z));t['ribbonVertices'].extend([x,y,z,station,0])
  t['ribbons'].extend([sid,edge,start,len(indices),1])
 mesh(p,[v for ix in roadtri.values() for v in ix],1)
 # Centroid ownership, including dependency records for crossing boxes.
 dependencies=set();maxbuilding=0;buildinggroups={}
 for data, in source.execute("SELECT o.data FROM objects o JOIN spatial s USING(rowid) WHERE o.kind='building' AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id",(ox+512,ox,oz+512,oz)):
  building=json.loads(data);owner=tuple(math.floor(v/512) for v in building['centroid'])
  if owner!=tuple(cell):dependencies.add(','.join(map(str,owner)));continue
  maxbuilding=max(maxbuilding,building['triangles'])
  for part in building['parts']:
   corners=part['footprint'];base=min(field.height(x,z) for x,z in corners);colour=part['palette']+2
   t['buildings'].extend([identifier('building:'+part['id']),len(t['buildingCorners'])//2,len(corners),colour])
   t['buildingCorners'].extend(v for x,z in corners for v in (x-ox,z-oz));t['buildingHeights'].extend([base,part['height']])
   positions=[]
   for i in range(0,len(part['positions']),3):
    x,y,z=part['positions'][i:i+3];positions.extend([x+part['origin'][0]-ox,y+base,z+part['origin'][2]-oz])
   positions,indices,shades=face_shaded(positions,part['indices'])
   ps,ix,cs=buildinggroups.setdefault(colour,([],[],[]));offset=len(ps)//3
   ps.extend(positions);ix.extend(v+offset for v in indices);cs.extend(shades)
 for colour,(ps,ix,cs) in sorted(buildinggroups.items()):mesh(ps,ix,colour,cs)
 triangles=sum(len(arrays[m['index']]['data'])//3 for m in meshes)
 center=Point(ox+256,oz+256);road=min(field.roads,key=lambda r:r['line'].distance(center));station=road['line'].project(center)
 eye=road['line'].interpolate(station);ahead=road['line'].interpolate(min(road['line'].length,station+12))
 if eye.distance(ahead)<1:ahead=road['line'].interpolate(max(0,station-12))
 camera=[eye.x-ox,field.height(eye.x,eye.y)+1.8,eye.y-oz];target=[ahead.x-ox,field.height(ahead.x,ahead.y)+1.8,ahead.y-oz]
 nodes=collections.defaultdict(list)
 for candidate in field.roads:
  for node,point in ((candidate['fromNode'],candidate['points'][0]),(candidate['toNode'],candidate['points'][-1])):
   if ox+45<point[0]<ox+467 and oz+45<point[1]<oz+467:nodes[node].append((candidate,point))
 junction=max((items for items in nodes.values() if len(items)>=3),key=lambda items:max(r['width'] for r,p in items))
 wide,point=max(junction,key=lambda item:(item[0]['width'],item[0]['line'].length))
 line=wide['line'];at=line.project(Point(point));camera_station=min(24,line.length*.8) if at<1 else max(0,line.length-24)
 eye_wide=line.interpolate(camera_station)
 wide_camera=[eye_wide.x-ox,field.height(eye_wide.x,eye_wide.y)+1.8,eye_wide.y-oz]
 wide_target=[point[0]-ox,field.height(*point)+1.8,point[1]-oz]
 metadata=dict(tileVersion=1,world='athens-probe',revision='ground-probe-style-2',cell=list(cell),origin=[ox,0,oz],ids=ids,strings=strings,palette=palette,meshes=meshes,terrain=dict(coarseSize=33,spacing=16),budgets=dict(triangles=triangles,buildingTriangles=maxbuilding),probe=dict(camera=camera,target=target,wideCamera=wide_camera,wideTarget=wide_target,road=road['id'],roadName=road['name'],releaseReady=False))
 field.dem.close();db.close();source.close()
 return dict(metadata=metadata,tables=t,arrays=arrays,dependencies=sorted(dependencies)),validation

if __name__=='__main__':
 tile,validation=bake(sys.argv[1],sys.argv[2],tuple(map(int,sys.argv[3:5])),sys.argv[5:]);print(encode(tile));print(encode(validation),file=sys.stderr)
