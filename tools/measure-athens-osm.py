#!/usr/bin/env python3
"""Offline research census. pip install osmium shapely; see plan for definitions.
Input: downloaded Geofabrik Greece PBF. Outputs ODbL geometry extracts and census.
No network at runtime, no game integration. Metres use fixed Athens tangent plane.
"""
import argparse, collections, gzip, hashlib, json, math, time
from pathlib import Path
import osmium
from shapely.geometry import Polygon, LineString, box, mapping
from shapely.ops import polygonize, unary_union, transform
from shapely import make_valid
from shapely.prepared import prep
P=argparse.ArgumentParser(); P.add_argument('pbf'); P.add_argument('output'); args=P.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);start=time.time()
lat0=37.98;lon0=23.73;phi=math.radians(lat0)
mlat=111132.92-559.82*math.cos(2*phi)+1.175*math.cos(4*phi)
mlon=111412.84*math.cos(phi)-93.5*math.cos(3*phi)
def xy(lon,lat):return ((lon-lon0)*mlon,-(lat-lat0)*mlat)
def project(g):return transform(lambda x,y,z=None:xy(x,y),g)
def road_km(g):
 # Great-circle lengths after exact mask clipping; avoids fixed-plane length bias on Kythira.
 total=0.0
 for part in parts(g):
  if part.geom_type!='LineString':continue
  coords=list(part.coords)
  for (x,z),(xx,zz) in zip(coords,coords[1:]):
   a,b=math.radians(lat0-z/mlat),math.radians(lat0-zz/mlat)
   dl=math.radians((xx-x)/mlon);da=b-a
   q=math.sin(da/2)**2+math.cos(a)*math.cos(b)*math.sin(dl/2)**2
   total+=6371.0088*2*math.asin(min(1,math.sqrt(q)))
 return total
# Planning masks, not municipal boundaries. A includes entire existing Riviera.
A=[[23.665,37.950],[23.760,37.955],[23.800,37.915],[23.845,37.865],[23.900,37.840],[23.900,37.775],[23.750,37.775],[23.680,37.880]]
B=[[23.665,37.935],[23.716,37.920],[23.758,37.889],[23.801,37.929],[23.819,37.973],[23.844,38.012],[23.864,38.053],[23.823,38.082],[23.750,38.080],[23.694,38.060],[23.669,38.010]]
class Relations(osmium.SimpleHandler):
 def __init__(self):super().__init__();self.rels={};self.buildings={}
 def relation(self,r):
  members=[(m.type,m.ref,m.role) for m in r.members]
  if r.tags.get('boundary')=='administrative':self.rels[r.id]=members
  if r.tags.get('type')=='multipolygon' and r.tags.get('building') not in [None,'no']:self.buildings[r.id]=(dict(r.tags),members)
r=Relations();r.apply_file(args.pbf)
def expand(rid):
 result=[]
 for typ,ref,role in r.rels[rid]:
  if role not in ['', 'outer', 'inner']:continue
  if typ=='w':result.append((ref,role))
  elif typ=='r':result.extend(expand(ref))
 return result
boundary=expand(957716);boundary_ids={ref for ref,role in boundary}
building_members={ref for tags,members in r.buildings.values() for typ,ref,role in members if typ=='w'}
class Boundaries(osmium.SimpleHandler):
 def __init__(self):super().__init__();self.lines={}
 def way(self,w):
  if w.id in boundary_ids:self.lines[w.id]=LineString([xy(n.lon,n.lat) for n in w.nodes])
bd=Boundaries();bd.apply_file(args.pbf,locations=True,idx='flex_mem')
assert boundary_ids <= bd.lines.keys(),'incomplete Attica boundary'
outer=unary_union(list(polygonize([bd.lines[ref] for ref,role in boundary if role!='inner'])))
inner=unary_union(list(polygonize([bd.lines[ref] for ref,role in boundary if role=='inner'])))
attica=make_valid(outer.difference(inner));assert not attica.is_empty
assert attica.covers(project(Polygon(A)).centroid), 'Attica boundary must contain south suburbs'
print('Attica boundary area including waters',attica.area/1e6,flush=True)
scopes={'a_south':project(Polygon(A)),'b_basin':project(Polygon(B)),'c_attica':attica}
mask_bounds={k:g.bounds for k,g in scopes.items()}
prepared_masks={k:prep(g) for k,g in scopes.items()}
roads={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','living_street','service','road'}
main=roads-{'service','road'}
stats={k:{'roadKm':0,'mainRoadKm':0,'serviceRoadKm':0,'restrictedRoadKm':0,'roadWays':0,'buildings':0,'buildingRelations':0,'levelsTagged':0,'heightTagged':0,'bridges':0,'tunnels':0,'tile512':set(),'byHighwayKm':collections.defaultdict(float)} for k in scopes}
files={k:gzip.GzipFile(filename=str(out/(k+'.ndjson.gz')),mode='wb',mtime=0) for k in scopes}
rawsizes=collections.Counter();member_lines={};errors=collections.Counter()
def parts(g):
 if hasattr(g,'geoms'):
  for a in g.geoms:yield from parts(a)
 else:yield g

def emit(k,kind,oid,tags,g):
 blob=(json.dumps({'kind':kind,'id':oid,'tags':tags,'geometry':mapping(g)},ensure_ascii=False,separators=(',',':'))+'\n').encode();files[k].write(blob);rawsizes[k]+=len(blob)
 # road- or building-occupied cells only; no estimate of terrain-only tile inventory.
 minx,minz,maxx,maxz=g.bounds
 for x in range(math.floor(minx/512),math.floor(maxx/512)+1):
  for z in range(math.floor(minz/512),math.floor(maxz/512)+1):
   if g.intersects(box(x*512,z*512,(x+1)*512,(z+1)*512)):stats[k]['tile512'].add((x,z))
def building(oid,tags,g,relation=False):
 if g.is_empty:return
 center=g.centroid
 for k,mask in scopes.items():
  if prepared_masks[k].covers(center):
   s=stats[k];s['buildings']+=1;s['buildingRelations']+=int(relation);s['levelsTagged']+=int('building:levels' in tags);s['heightTagged']+=int('height' in tags);emit(k,'building',oid,tags,g)
class Features(osmium.SimpleHandler):
 def way(self,w):
  t=dict(w.tags);h=t.get('highway');isbuilding=t.get('building') not in [None,'no'] and w.id not in building_members
  if h not in roads and not isbuilding and w.id not in building_members:return
  try:coords=[xy(n.lon,n.lat) for n in w.nodes]
  except osmium.InvalidLocationError:errors['invalidLocations']+=1;return
  if len(coords)<2:return
  bounds=(min(p[0] for p in coords),min(p[1] for p in coords),max(p[0] for p in coords),max(p[1] for p in coords))
  candidates=[k for k,(a,b,c,d) in mask_bounds.items() if not (bounds[2]<a or bounds[0]>c or bounds[3]<b or bounds[1]>d)]
  if not candidates and w.id not in building_members:return
  line=LineString(coords)
  if w.id in building_members:member_lines[w.id]=line
  if not candidates:return
  if h in roads:
   for k in candidates:
    mask=scopes[k]
    if not prepared_masks[k].intersects(line):continue
    clipped=line if prepared_masks[k].contains(line) else line.intersection(mask);length=road_km(clipped)
    if length<=0:continue
    s=stats[k];s['roadKm']+=length;s['roadWays']+=1;s['byHighwayKm'][h]+=length
    s['mainRoadKm' if h in main else 'serviceRoadKm']+=length
    if t.get('access') in ['private','no'] or t.get('motor_vehicle') in ['no','private']:s['restrictedRoadKm']+=length
    if t.get('bridge') not in [None,'no']:s['bridges']+=1
    if t.get('tunnel') not in [None,'no']:s['tunnels']+=1
    emit(k,'road','w'+str(w.id),t,clipped)
  if isbuilding and coords[0]==coords[-1] and len(coords)>=4:building('w'+str(w.id),t,make_valid(Polygon(coords)))
f=Features();f.apply_file(args.pbf,locations=True,idx='flex_mem')
for rid,(tags,members) in r.buildings.items():
 try:
  outer=list(polygonize([member_lines[ref] for typ,ref,role in members if typ=='w' and role!='inner']))
  inner=list(polygonize([member_lines[ref] for typ,ref,role in members if typ=='w' and role=='inner']))
  if not outer:errors['unassembledBuildingRelations']+=1;continue
  building('r'+str(rid),tags,make_valid(unary_union(outer).difference(unary_union(inner))),True)
 except KeyError:errors['missingBuildingRelationWays']+=1
for k in scopes:
 files[k].close();s=stats[k];s['occupied512Cells']=len(s.pop('tile512'));s['geometryJsonBytes']=rawsizes[k];path=out/(k+'.ndjson.gz');s['geometryGzipBytes']=path.stat().st_size;s['extractSha256']=hashlib.sha256(path.read_bytes()).hexdigest();s['maskAreaKm2IncludingWater']=scopes[k].area/1e6
 for field in ['roadKm','mainRoadKm','serviceRoadKm','restrictedRoadKm']:s[field]=round(s[field],3)
 s['byHighwayKm']={a:round(b,3) for a,b in sorted(s['byHighwayKm'].items())}
reader=osmium.io.Reader(args.pbf);header=reader.header();reader.close()
report={'source':'https://download.geofabrik.de/europe/greece-latest.osm.pbf','downloadDate':'2026-10-15','pbfBytes':Path(args.pbf).stat().st_size,'pbfSha256':hashlib.file_digest(open(args.pbf,'rb'),'sha256').hexdigest(),'replicationTimestamp':header.get('osmosis_replication_timestamp'),'projection':{'lat0':lat0,'lon0':lon0,'mlat':mlat,'mlon':mlon},'masks':{'a_south':A,'b_basin':B,'c_attica':{'osmRelation':957716}},'scope':stats,'errors':dict(errors),'elapsedSeconds':round(time.time()-start,1)}
(out/'osm-census.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
# Preserve measured mask geometry, in projected metres, for exact reproducibility.
(out/'scope-masks.json').write_text(json.dumps({'type':'FeatureCollection','features':[{'type':'Feature','properties':{'id':k,'coordinateSystem':'local tangent metres; see census'},'geometry':mapping(v)} for k,v in scopes.items()]},separators=(',',':'))+'\n')
print(json.dumps(report,indent=2),flush=True)
