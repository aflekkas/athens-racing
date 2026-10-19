"""Stream ground-cell AWT intermediates. Refuses unresolved structures; never publishes a manifest."""
import sys,json,math,sqlite3,collections
from pathlib import Path
from functools import lru_cache
import numpy as np
import shapely
from shapely.geometry import LineString,Point,Polygon,box,shape
from shapely.strtree import STRtree
from shapely.ops import unary_union
from surfaces import ground_mesh,validate_partition,f32,SurfaceHeight
from elevation import Elevation
from coastal import Coast, Structures
from tile_detail import water_mesh,vegetation_rows,bridge_edges
from details import fnv1a
from influence import blended_height, profile_height, lattice_height, smooth_lattice_sample, SUPPORT, ROAD_QUERY_HALO
from appearance import BUILDINGS,linear,ground_colour
from ingest import encode
from styles import face_shaded,ROAD,ROAD_CONCRETE,ROAD_PAVING,ROAD_UNPAVED,PAVEMENT,KERB_TOP,KERB_SIDE,MARKING
from street_details import road_markings,ribbon_polygon,ribbon_lateral
from street_regions import StreetRegions
from street_audit import audit_regions,check as check_streets
from road_section import cross_section


# Steep hillside streets whose 6 m shoulders cannot reach the owner's 30 degree / 15 cm gates
# on the shared 8 m surface lattice. Each entry is {id, reason}; excluded in every coastal cell
# (so neighbours agree), from ground, graph, anchors and turns, and reported by the coast bake.
COAST_EXCLUSIONS=json.loads((Path(__file__).parent/'coast-exclusions.json').read_text())
EXCLUDED={e['id'] for e in COAST_EXCLUSIONS}

class Field:
 def __init__(self,db,source,cell,dems,coastal=False,bridge_tags=None,sections=None):
  self.cell=cell;self.dem=Elevation(dems);ox,oz=cell[0]*512,cell[1]*512;self.ox=ox;self.oz=oz;halo=512 if coastal else ROAD_QUERY_HALO
  self.roads=[];self.byid={};self.land=[];self.coast=Coast(source,cell) if coastal else None
  for row,data in db.execute('SELECT r.rowid,r.data FROM spatial s CROSS JOIN roads r ON r.rowid=s.rowid WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY r.id',(ox+512+halo,ox-halo,oz+512+halo,oz-halo)):
   r=json.loads(data)
   if coastal and r['id'] in EXCLUDED:continue
   if sections is not None:
    found=sections.execute('SELECT data FROM sections WHERE id=?',(r['id'],)).fetchone()
    if found is None:raise ValueError('Missing road cross-section '+r['id'])
    r['section']=json.loads(found[0]);r['width']=r['section']['width'];r['widthSource']=r['section']['widthSource']
   else:r['section']=cross_section({'highway':r['highway']})  # unit-test fixtures without a section cache
   line=LineString(r['points']);r['line']=line;r['polygon']=ribbon_polygon(line,r['width'])
   samples=list(db.execute('SELECT s.station,p.y FROM samples s JOIN points p ON p.rowid=s.point WHERE s.road=? ORDER BY s.station',(row,)))
   r['stations']=[s[0] for s in samples];r['ys']=[s[1] for s in samples]
   coords=np.asarray(line.coords);stations=np.r_[0,np.cumsum(np.linalg.norm(np.diff(coords,axis=0),axis=1))]
   breaks=np.unique(np.r_[stations,np.clip(r['stations'],0,line.length)])
   xs=np.interp(breaks,stations,coords[:,0]);zs=np.interp(breaks,stations,coords[:,1]);ys=np.interp(breaks,r['stations'],r['ys'])
   r['segments']=[tuple(map(float,v)) for v in zip(xs[:-1],zs[:-1],xs[1:],zs[1:],ys[:-1],ys[1:])]
   if not coastal and (r['bridge'] or r['tunnel'] or r['layer']) and r['polygon'].intersects(box(ox,oz,ox+512,oz+512)):
    raise ValueError('Ground probe refuses unsolved layered road '+r['id'])
   if coastal or not(r['bridge'] or r['tunnel'] or r['layer']):self.roads.append(r);self.byid[r['id']]=r
  self.structures=Structures(self.roads,bridge_tags or {}) if coastal else None
  if self.structures:
   for road in self.roads:
    if road['id'] in self.structures.raised:road['section'].update(sidewalk=dict(left=0.,right=0.),kerb=0.)
   # A ground street that merely brushes the deck platform (a frontage road beside an approach) must not run
   # under it with less than the 4.5 m clearance: its asphalt stops at the platform edge. Crossing (lower) roads stay.
   crossing={l['id'] for g in self.structures.groups for l in g['lower']}
   joined={n for r in self.roads if r['id'] in self.structures.raised for n in (r['fromNode'],r['toNode'])}
   landings=[]
   if not self.structures.platform.is_empty:
    for road in self.structures.ground:
     if road['id'] in crossing or not road['polygon'].intersects(self.structures.platform):continue
     # A side street that meets the approach keeps a small asphalt landing around the shared node (its graph
     # contact); everywhere else under the platform edge it stops, so no ground asphalt sits just below the deck.
     keep=unary_union([Point(p).buffer(3.) for p,n in ((road['points'][0],road['fromNode']),(road['points'][-1],road['toNode'])) if n in joined]) if (road['fromNode'] in joined or road['toNode'] in joined) else None
     if keep is not None:landings.append(keep)
     margin=self.structures.platform.buffer(.3,join_style=2)  # deck triangles overhang the platform outline by a few cm
     cut=margin if keep is None else margin.difference(keep)
     road['polygon']=road['polygon'].difference(cut).buffer(0)
  self.ground_roads=self.structures.ground if self.structures else self.roads
  # Ground asphalt (including junction fillets) never sits under the deck platform except on a side street's landing.
  self.deck_clip=(self.structures.platform.buffer(.3,join_style=2).difference(unary_union(landings)) if landings else self.structures.platform.buffer(.3,join_style=2)) if self.structures and not self.structures.platform.is_empty else None
  self.polygons=np.array([r['polygon'] for r in self.roads],dtype=object)
  self.lines=np.array([r['line'] for r in self.roads],dtype=object)
  self.tree=STRtree(self.polygons)
  for data, in source.execute("SELECT o.data FROM spatial s CROSS JOIN objects o ON o.rowid=s.rowid WHERE o.kind IN ('landuse','landcover') AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id",(ox+512,ox,oz+512,oz)):
   value=json.loads(data);g=shape(value['geometry']);self.land.append((g,value['tags']))
  self.landtree=STRtree([p for p,t in self.land])
 @lru_cache(maxsize=65536)
 def height(self,x,z):
  point=Point(x,z);baseline=self.dem.height(x,z)
  if self.coast:baseline=self.coast.baseline(x,z,baseline)
  if not self.roads:return baseline
  # Query every influence, never choose a containing or nearest profile.
  candidates=[]
  ids=self.tree.query(box(x-SUPPORT,z-SUPPORT,x+SUPPORT,z+SUPPORT))
  ds=shapely.distance(self.polygons[ids],point);inside=ds<SUPPORT
  ids=ids[inside];ds=ds[inside]
  centres=shapely.distance(self.lines[ids],point)
  for i,d,centre in zip(ids,ds,centres):
   road=self.roads[int(i)]
   y=profile_height(x,z,road['segments'],road['width']/2+8)
   candidates.append((road['id'],y,float(d),float(centre),road['width']))
  return blended_height(baseline,candidates)
 @lru_cache(maxsize=65536)
 def _surface_sample(self,x,z):
  # The kerb/sidewalk rise is added per emitted vertex (StreetRegions.lift), never through the 8 m lattice.
  return self.height(x,z)
 @lru_cache(maxsize=65536)
 def _base_lattice(self,x,z):
  return smooth_lattice_sample(x,z,self._surface_sample)
 @lru_cache(maxsize=65536)
 def _lattice_sample(self,x,z):
  # Coastal blocks include hillside junctions: a second fixed global filter
  # bounds short profile overshoots without selecting a road or tile locally.
  # Affine grades remain unchanged, and deck/ground share the same baseline.
  return smooth_lattice_sample(x,z,self._base_lattice) if self.coast else self._base_lattice(x,z)
 @lru_cache(maxsize=65536)
 def _ground_sample(self,x,z):
  return self._lattice_sample(x,z)-(smooth_lattice_sample(x,z,self.structures.depression) if self.structures else 0.)
 def deck_height(self,x,z):return lattice_height(x,z,self._lattice_sample)
 def slope(self,x,z):
  # Terrain gradient on the canonical surface, central differences over 8 m (continuous across lattice creases).
  return math.hypot(self.surface_height(x+4,z)-self.surface_height(x-4,z),self.surface_height(x,z+4)-self.surface_height(x,z-4))/8
 def surface_height(self,x,z):
  # Solve/sample one global eight-metre lattice BEFORE clipping the road union.
  # Sampling a curved height function independently at near-collinear polygon
  # vertices can create arbitrarily steep interpolation slivers. Every emitted
  # road/shoulder triangle now lies inside one of these canonical planes.
  return lattice_height(x,z,self._ground_sample)
 def colour(self,x,z,h=None,slope=None):
  p=Point(x,z);candidates=[int(i) for i in self.landtree.query(p) if self.land[int(i)][0].covers(p)]
  tags=self.land[min(candidates,key=lambda i:self.land[i][0].area)][1] if candidates else {}
  if h is None:h=self.height(x,z)
  if slope is None:slope=math.hypot(self.height(x+1,z)-self.height(x-1,z),self.height(x,z+1)-self.height(x,z-1))/2
  return ground_colour(x,z,h,slope,tags.get('landuse',''),tags.get('natural',''))[1]

SURFACES={'asphalt':(1,'asphalt'),'concrete':(12,'asphalt'),'paving':(13,'paving'),'unpaved':(14,None)}
TABLES={'nodes':[],'nodePositions':[],'edges':[],'edgePoints':[],'edgeLayers':[],'turns':[],'ribbons':[],'ribbonVertices':[],'junctions':[],'junctionVertices':[],'markings':[],'contactPositions':[],'contactTriangles':[],'contactLayers':[],'coarseHeights':[],'finePositions':[],'fineTriangles':[],'buildings':[],'buildingCorners':[],'buildingHeights':[],'signs':[],'signTransforms':[],'anchors':[],'anchorTransforms':[]}

def bake(dbpath,sourcepath,graphpath,turnpath,cell,dems,world,revision,coastal=False,vegetation=None,osm=None,sections=None):
 db=sqlite3.connect(f'file:{dbpath}?mode=ro',uri=True);source=sqlite3.connect(f'file:{sourcepath}?mode=ro',uri=True)
 sectiondb=sqlite3.connect(f'file:{sections}?mode=ro',uri=True) if sections else None
 bridge_tags={}
 if coastal:
  if not osm:raise ValueError('Coastal bake requires original ingested OSM tags')
  raw=sqlite3.connect(f'file:{osm}?mode=ro',uri=True)
  for identifier,tags in raw.execute("SELECT id,tags FROM features WHERE kind='road'"):
   value=json.loads(tags).get('bridge')
   if value:bridge_tags[identifier]=value
  raw.close()
 field=Field(db,source,cell,dems,coastal,bridge_tags,sectiondb)
 # Surfaces within 96 m of the cell decide everything inside it (reach, fillets and ramps are all < 40 m): a
 # window keeps the global geometry identical across cells without unioning the whole 1.5 km height halo.
 window=box(field.ox-96,field.oz-96,field.ox+608,field.oz+608);near_roads=[r for r in field.ground_roads if r['line'].intersects(window)]
 regions=StreetRegions(near_roads,clip=field.deck_clip)
 # Owner polygons include each street's share of the junction fillets; the kerb/sidewalk rise is added per vertex.
 mesh_roads=[dict(r,polygon=regions.surface(r)) for r in near_roads]
 streets=check_streets(audit_regions(near_roads,regions,cell))
 surface=ground_mesh(cell,mesh_roads,lambda x,z:field.surface_height(x,z)+regions.lift(x,z,field.slope),regions.boundaries(),None,regions.asphalt if near_roads else None);
 validation=validate_partition(surface)
 ox,oz=field.ox,field.oz;t={k:[] for k in TABLES};arrays=[];meshes=[];ids=[''];strings=[''];palette=[[1,1,1],ROAD,*[linear(c) for c in BUILDINGS],PAVEMENT,KERB_TOP,KERB_SIDE,MARKING,ROAD_CONCRETE,ROAD_PAVING,ROAD_UNPAVED]
 def identifier(s):
  if s not in ids:ids.append(s)
  return ids.index(s)
 def array(type,data):arrays.append(dict(type=type,data=data));return len(arrays)-1
 def mesh(positions,indices,material,colours=None,user_data=None):
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
   meshes.append(dict(name='probe',material=material,attributes=attrs,index=array('Uint16Array',ix),userData=dict(worldSurface=material in (0,1,8,9,12,13,14),**(user_data or {})),layers=1,drawRange=dict(start=0,count=len(ix))))
 p=surface['positions'];t['finePositions']=p;t['fineTriangles']=surface['triangles'];t['contactPositions']=p.copy()
 rendered_height=SurfaceHeight(surface)
 t['coarseHeights']=[f32(field.surface_height(ox+x,oz+z)) for z in range(0,513,16) for x in range(0,513,16)]
 terrain=identifier('terrain:'+str(cell[0])+':'+str(cell[1]));roadtri=collections.defaultdict(list);ground=[];pavement_tri=[];kerb_tri=[]
 loose=[i for i,owner in enumerate(surface['owners']) if not owner];centres=[[ox+sum(p[v*3] for v in surface['triangles'][i*3:i*3+3])/3 for i in loose],[oz+sum(p[v*3+2] for v in surface['triangles'][i*3:i*3+3])/3 for i in loose]]
 region_of=dict(zip(loose,regions.classify(*centres)))
 for i,owner in enumerate(surface['owners']):
  tri=surface['triangles'][i*3:i*3+3]
  sid=identifier('surface:'+owner) if owner else terrain
  t['contactTriangles'].extend([*tri,sid,1 if owner else 2]);t['contactLayers'].append(0)
  if owner:roadtri[owner].extend(tri)
  else:
   (kerb_tri if region_of[i]==1 else pavement_tri if region_of[i]==2 else ground).extend(tri)
 colours=[]
 # Colour the actual solved surface; avoid four extra global-field queries
 # per vertex merely to classify its terrain palette.
 vertices=np.asarray(p).reshape(-1,3);faces=np.asarray(surface['triangles']).reshape(-1,3)
 normals=np.cross(vertices[faces[:,1]]-vertices[faces[:,0]],vertices[faces[:,2]]-vertices[faces[:,0]])
 grades=np.hypot(normals[:,0],normals[:,2])/np.abs(normals[:,1]);vertex_grades=np.zeros(len(vertices))
 for side in range(3):np.maximum.at(vertex_grades,faces[:,side],grades)
 for i in range(0,len(p),3):colours.extend(field.colour(ox+p[i],oz+p[i+2],p[i+1],float(vertex_grades[i//3])))
 # Terrain under an approach deck is coplanar with it and z-fights; lower only its RENDER copy (contact keeps p).
 render_p=p
 if field.structures and not field.structures.platform.is_empty:
  shapely.prepare(field.structures.platform);render_p=list(p)
  for i in range(0,len(p),3):
   if field.structures.platform.covers(Point(ox+p[i],oz+p[i+2])):render_p[i+1]=f32(p[i+1]-.3)
 mesh(render_p,ground,0,colours)
 raised=render_p
 mesh(raised,pavement_tri,8,user_data=dict(tileSurface='paving'));mesh(raised,kerb_tri,9)
 # The bevel is the physical/rendered kerb (12 cm over 30 cm); no unsupported vertical wall.
 paintps,paintix=road_markings(near_roads,cell,rendered_height,regions);mesh(paintps,paintix,11,user_data=dict(tileSurface='marking'))
 deck_surface=None;deck_height=None;structure_records=[];rails=[]
 if field.structures and field.structures.deck:
  deck_surface=ground_mesh(cell,field.structures.deck,field.deck_height,[field.structures.platform.boundary])
  deck_height=SurfaceHeight(deck_surface)
  dp=deck_surface['positions'];deck_road=[];deck_shoulder=[];offset=len(t['contactPositions'])//3;t['contactPositions'].extend(dp)
  for i,owner in enumerate(deck_surface['owners']):
   tri=deck_surface['triangles'][i*3:i*3+3];centre=Point(ox+sum(dp[v*3] for v in tri)/3,oz+sum(dp[v*3+2] for v in tri)/3)
   if not field.structures.platform.covers(centre):continue
   t['contactTriangles'].extend([*[v+offset for v in tri],identifier('surface:'+owner) if owner else terrain,1 if owner else 2]);t['contactLayers'].append(1)
   (deck_road if owner else deck_shoulder).extend(tri)
   if owner:roadtri[owner].extend(tri)
  mesh(dp,deck_road,1,user_data=dict(tileSurface='asphalt'));mesh(dp,deck_shoulder,8)
  underside=dp.copy()
  for j in range(1,len(underside),3):underside[j]-=.5
  underside_ix=[]
  deck_indices=deck_road+deck_shoulder
  for j in range(0,len(deck_indices),3):
   a,b,c=deck_indices[j:j+3];underside_ix.extend([a,c,b])
  mesh(underside,underside_ix,8)
  ps,ix,rails=bridge_edges(field.structures.platform,cell,field.deck_height,field.surface_height);mesh(ps,ix,8,user_data=dict(bridgeGuard=True))
  ps,ix=road_markings(field.structures.deck,cell,deck_height);mesh(ps,ix,11,user_data=dict(tileSurface='marking'))
  for g in field.structures.groups:
   x,z=g['centre'];clearance=field.deck_height(x,z)-field.surface_height(x,z)-.5
   if clearance<4.5:raise ValueError('Insufficient bridge clearance '+g['id']+': '+str(clearance))
   clearances=[]
   for lower in g['lower']:
    line=lower['line'];n=max(1,math.ceil(line.length))
    for j in range(n+1):
     q=line.interpolate(line.length*j/n)
     if g['platform'].covers(q):clearances.append(field.deck_height(q.x,q.y)-field.surface_height(q.x,q.y)-.5)
   if clearances and min(clearances)<4.5:raise ValueError('Underpass road clearance below 4.5 m: '+str(min(clearances)))
   structure_records.append(dict(id=g['id'],kind='osm-bridge-guarded',layer=1,shoulderMetres=.25,bridgeSources=g['bridgeSources'],clearance=min(clearances or [clearance]),clearanceSamples=len(clearances),roads=[r['id'] for r in g['roads']]))
 def road_height(edge,x,z):return deck_height(x,z) if deck_height and edge['source'] in field.structures.raised else rendered_height(x,z)
 # Directed graph is clipped globally; sample final emitted contacts for Y.
 graphdb=sqlite3.connect(f'file:{graphpath}?mode=ro',uri=True)
 graphrows=[json.loads(data) for data, in graphdb.execute('SELECT data FROM edges WHERE tx BETWEEN ? AND ? AND tz BETWEEN ? AND ? ORDER BY id',(cell[0]-1,cell[0]+1,cell[1]-1,cell[1]+1))]
 graphdb.close();byroad=collections.defaultdict(list);node_positions={};emitted_graph=[]
 turndb=sqlite3.connect(f'file:{turnpath}?mode=ro',uri=True)
 blocked={row[0] for row in turndb.execute('SELECT edge FROM blocked')}
 for edge in graphrows:
  if edge['id'] in blocked:edge['flags']|=8
 graphrows=[e for e in graphrows if not(coastal and e['source'] in EXCLUDED)]
 for edge in graphrows:byroad[edge['source']].append(edge)
 for edge in graphrows:
  if tuple(edge['cell'])!=tuple(cell):continue
  positions=[]
  for x,y,z,station in edge['points']:
   lx,lz=f32(x-ox),f32(z-oz);positions.append([lx,f32(road_height(edge,ox+lx,oz+lz)),lz])
  for key,point in ((edge['fromNode'],positions[0]),(edge['toNode'],positions[-1])):
   if key in node_positions:
    if math.dist(node_positions[key],point)>.0001:raise ValueError('Graph node contact mismatch '+key+': '+str((node_positions[key],point)))
    point[:]=node_positions[key]
   else:
    node_positions[key]=point;t['nodes'].extend([identifier(key),len(t['nodePositions'])//3]);t['nodePositions'].extend(point)
  name=edge['name']
  if name not in strings:strings.append(name)
  road=field.byid[edge['source']];direction='forward' if ':f:' in edge['id'] else 'backward'
  raw_lanes=road['directionalTags'].get('lanes:'+direction,road['lanes'] if road['oneway'] else None)
  try:lanes=int(raw_lanes) if raw_lanes is not None and float(raw_lanes).is_integer() and 0<float(raw_lanes)<=32 else 0
  except (TypeError,ValueError):lanes=0
  t['edges'].extend([identifier(edge['id']),identifier(edge['fromNode']),identifier(edge['toNode']),len(t['edgePoints'])//3,len(positions),strings.index(name),lanes,edge['speedKph'],edge['flags'],identifier(edge['surface'])])
  t['edgePoints'].extend(v for point in positions for v in point);t['edgeLayers'].append(1 if field.structures and edge['source'] in field.structures.raised else edge['layer'])
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
  rp=deck_surface['positions'] if field.structures and owner in field.structures.raised else p
  for vertex in indices:
   x,y,z=rp[vertex*3:vertex*3+3]
   station,lateral=ribbon_lateral(road['line'],ox+x,oz+z,orientation==1)
   t['ribbonVertices'].extend([x,y,z,station,lateral])
  t['ribbons'].extend([sid,edge,start,len(indices),1])
 bysurface=collections.defaultdict(list)
 for owner,ix in sorted(roadtri.items()):
  if not field.structures or owner not in field.structures.raised:bysurface[field.byid[owner]['section']['surface']].extend(ix)
 for name,(material,tile) in SURFACES.items():
  if bysurface[name]:mesh(p,bysurface[name],material,user_data=dict(tileSurface=tile) if tile else None)
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
 safe_road_area=unary_union([regions.surface(r) for r in near_roads if r['public']]).buffer(-.03)
 for edge,points in emitted_graph:
  if edge['flags']&8 or len(points)<3 or field.structures and edge['source'] in field.structures.raised:continue
  line=LineString([(q[0],q[2]) for q in points])
  if line.length<20:continue
  at=line.length/2;mid=line.interpolate(at);a=line.interpolate(at-.5);b=line.interpolate(at+.5)
  dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
  if length<1e-6:continue
  dx,dz=dx/length,dz/length;right=(-dz,dx);offset=max(0,field.byid[edge['source']]['width']/2-1.6)
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
 if field.coast:
  water=field.coast.water(cell,field.roads);ps,ix=water_mesh(water,ox,oz)
  palette.append(linear('#426b80'));mesh(ps,ix,len(palette)-1,user_data=dict(water=True))
 triangles=sum(len(arrays[m['index']]['data'])//3 for m in meshes)
 road_sections=dict(schema=['class','width','lanes','sidewalkLeft','sidewalkRight','surface','oneway'],roads={owner:[(sec:=field.byid[owner]['section'])['class'],sec['width'],sec['lanes'],sec['sidewalk']['left'],sec['sidewalk']['right'],sec['surface'],sec['oneway']] for owner in sorted(roadtri)})
 extensions={}
 if vegetation:
  vp,vk,vs=vegetation_rows(vegetation,field,all_building_footprints,rendered_height,int(triangles*.25))
  extensions=dict(worldDetail=dict(version=1,buildings=dict(facadeStyle=array('Uint8Array',[0]*(len(t['buildings'])//4)),detailSeed=array('Uint32Array',[fnv1a(ids[t['buildings'][i]]) for i in range(0,len(t['buildings']),4)])),vegetation=dict(positionHeight=array('Float32Array',vp),kind=array('Uint8Array',vk),seed=array('Uint32Array',vs))))
  validation['vegetationInstances']=len(vk)

 validation['streets']=streets;validation['renderContactTopIdentity']=True;validation['structures']=structure_records
 validation['graphEdges']=len(emitted_graph);validation['graphContactPoints']=len(t['edgePoints'])//3
 validation['turnRestrictions']=len(t['turns'])//4;validation['safeAnchors']=len(t['anchors'])//5;validation['releaseReady']=False
 metadata=dict(tileVersion=1,world=world,revision=revision,cell=list(cell),origin=[ox,0,oz],ids=ids,strings=strings,palette=palette,meshes=meshes,terrain=dict(coarseSize=33,spacing=16),budgets=dict(triangles=triangles,buildingTriangles=maxbuilding),developmentOnly=True,releaseReady=False,structures=structure_records,rails=rails,roadSections=road_sections,extensions=extensions)
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
 parser.add_argument('--coastal',action='store_true')
 parser.add_argument('--vegetation',type=Path)
 parser.add_argument('--osm',type=Path,help='Ingested OSM source DB; required for literal bridge=yes provenance in coastal mode')
 parser.add_argument('--sections',type=Path,help='Road cross-section cache (sections.py); required: every street is drawn from it')
 args=parser.parse_args()
 inputs={name:sha(getattr(args,name)) for name in ('profiles','source','graph','turns')}
 inputs['dem']=[sha(p) for p in args.dem]
 inputs['coastal']=args.coastal
 if args.coastal and not args.osm:parser.error('--coastal requires --osm')
 if args.osm:inputs['osm']=sha(args.osm)
 if args.sections:inputs['sections']=sha(args.sections)
 if args.vegetation:inputs['vegetation']=sha(args.vegetation)
 inputs['code']={p.name:sha(p) for p in sorted(Path(__file__).parent.glob('*.py'))}
 revision=hashlib.sha256(encode(inputs).encode()).hexdigest()
 print(encode(dict(inputs=inputs,revision=revision,releaseReady=False)),file=sys.stderr,flush=True)
 for value in args.cell:
  cell=tuple(map(int,value.split(',')))
  if len(cell)!=2:parser.error('Cell must have exactly two coordinates')
  start=time.monotonic()
  tile,validation=bake(args.profiles,args.source,args.graph,args.turns,cell,args.dem,args.world,revision,args.coastal,args.vegetation,args.osm,args.sections)
  print(encode(tile),flush=True)
  print(encode(dict(cell=cell,seconds=time.monotonic()-start,**validation)),file=sys.stderr,flush=True)
