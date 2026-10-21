"""Offline authoritative Psychiko survey enrichment of the basin, never a runtime contact overlay.

The converter freezes street classes/corrected CCW rings and plane fits from Vas-Per's
reduced source. Heights use the same sigma-20 m Copernicus field. One field supplies
terrain, roads, graph and anchors; the unchanged outer band permits exact seam reuse.
"""
import gzip,json,math
from pathlib import Path
from functools import lru_cache
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
class Psychiko:
 def __init__(self,path):
  self.data=json.loads(Path(path).read_text());self.P=self.data['projection'];self.spec=self.data['height'];self.ways={}
  for w in self.data['ways']:self.ways.setdefault('w'+str(w['id']),[]).append(w)
  raw=json.loads(gzip.decompress((ROOT/self.spec['source']).read_bytes()));W=raw['windows'];self.dlon=W[0]['dlon'];self.dlat=W[0]['dlat'];self.lon0=min(g['lon0'] for g in W);self.lat0=max(g['lat0'] for g in W)
  nx=round((max(g['lon0']+(g['nx']-1)*self.dlon for g in W)-self.lon0)/self.dlon)+1;nz=round((min(g['lat0']+(g['nz']-1)*self.dlat for g in W)-self.lat0)/self.dlat)+1
  A=np.empty((nz,nx))
  for j in range(nz):
   for i in range(nx):
    values=[]
    for g in W:
     u=round((self.lon0+i*self.dlon-g['lon0'])/self.dlon);v=round((self.lat0+j*self.dlat-g['lat0'])/self.dlat);a=max(0,min(g['nx']-1,u));b=max(0,min(g['nz']-1,v));values.append(((u-a)**2+(v-b)**2,g['cm'][b*g['nx']+a]/100))
    A[j,i]=min(values,key=lambda p:p[0])[1]
  for axis,metres in ((1,self.dlon*self.P['mlon']),(0,-self.dlat*self.P['mlat'])):
   R=math.ceil(3*self.spec['sigmaM']/metres);k=np.exp(-(np.arange(-R,R+1)*metres)**2/(2*self.spec['sigmaM']**2));k/=sum(k)
   A=np.apply_along_axis(lambda row:np.convolve(np.pad(row,(R,R),mode='edge'),k,'valid'),axis,A)
  self.H=A
 def weight(self,x,z):
  a,b,c,d=self.spec['bounds'];distance=min(x-a,c-x,z-b,d-z)
  t=max(0.,min(1.,distance/self.spec['fadeM']));return t*t*(3-2*t)
 @lru_cache(maxsize=65536)
 def height(self,x,z):
  P=self.P;u=max(0.,min(self.H.shape[1]-1.000001,(P['lon0']+x/P['mlon']-self.lon0)/self.dlon));v=max(0.,min(self.H.shape[0]-1.000001,(P['lat0']-z/P['mlat']-self.lat0)/self.dlat));i,j=math.floor(u),math.floor(v);a,b=u-i,v-j
  h=(self.H[j,i]*(1-a)+self.H[j,i+1]*a)*(1-b)+(self.H[j+1,i]*(1-a)+self.H[j+1,i+1]*a)*b
  for q in self.spec['planes']:
   d=math.hypot(x-q['cx'],z-q['cz'])
   if d>q['R']+20:continue
   t=max(0.,min(1.,(d-q['R'])/20));t=t*t*(3-2*t);h=h*t+(q['h']+q['gx']*(x-q['cx'])+q['gz']*(z-q['cz']))*(1-t)
  return float(h)
 def blend(self,x,z,baseline):
  w=self.weight(x,z)
  return baseline if w==0 else baseline*(1-w)+self.height(x,z)*w
 def section(self,road):
  choices=[s for w in self.ways.get(road['way'],[]) for s in w['samples']]
  if not choices:return
  x,z=road['points'][len(road['points'])//2];s=min(choices,key=lambda s:(s[0]-x)**2+(s[1]-z)**2)
  # Never extend a surveyed class to an unrelated distant part of the same long way.
  if math.hypot(s[0]-x,s[1]-z)>180:return
  section=road['section'];section['width']=s[2];section['widthSource']='psychiko-survey:'+s[4];section['surveyClass']=s[4];section['sidewalk']={'left':s[3],'right':s[3]};road['width']=s[2];road['widthSource']=section['widthSource']
 def legal(self,edge):
  # Only the two reviewed Eleftherias rim pieces change direction. Existing
  # OSM roundabouts (including self-loop fragments) keep their emitted graph.
  way=int(edge['id'].split(':')[2]);a=edge['fromNode'].removeprefix('osm:node:');b=edge['toNode'].removeprefix('osm:node:')
  for closing in self.data['corrections']['closing']:
   if way!=closing['way']:continue
   start,end=map(str,closing['ccw'])
   if {a,b}=={start,end}:return a==start and b==end
  return True
