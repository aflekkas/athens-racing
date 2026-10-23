import os,time,json,math,resource,hashlib
from array import array
import numpy as np
from scipy.sparse import coo_matrix
from scipy.optimize import linprog
P='/tmp/athens-terrain.uKVC/'
start=time.monotonic();raw=open(P+'lp-observations.json','rb').read();d=json.loads(raw)
keys=[k for k,n in d['nodes']];idx={k:i for i,k in enumerate(keys)};N=len(keys);R=array('i');C=array('i');V=array('d');rhs=array('d')
def row(terms,b):
 r=len(rhs)
 for k,v in terms:
  if abs(v)>1e-14:R.append(r);C.append(k);V.append(v)
 rhs.append(b)
for c in d['chords']:
 ts=[(idx[t['key']],t['coefficient']) for t in c['terms']]
 row(ts+[(N,-1)],-c['signedSag']);row([(i,-v)for i,v in ts]+[(N,-1)],c['signedSag'])
facets=16;G=.06;cap=G if os.environ.get("LP_OUTER")=="1" else G*math.cos(math.pi/facets)
# Independently specified gradients on both right triangles of every touched square.
triangles=[]
for x,z in d['squares']:
 for ts in [[(x,z,-.125,-.125),(x+8,z,.125,0),(x,z+8,0,.125)],[(x+8,z+8,.125,.125),(x,z+8,-.125,0),(x+8,z,0,-.125)]]:
  t=[(idx.get(str(a)+','+str(b)),dx,dz)for a,b,dx,dz in ts];triangles.append(t)
  for j in range(facets):
   a=2*math.pi*j/facets;co=math.cos(a);si=math.sin(a)
   row([(i,dx*co+dz*si)for i,dx,dz in t if i is not None],cap)
forecast=max(1_200_000_000,12*(len(V)*32+len(rhs)*32+N*1024))
print(json.dumps({'phase':'matrix','rows':len(rhs),'nnz':len(V),'nodes':N,'conservativeFacets':facets,'gradientLimit':G,'facetCap':cap,'forecastBytes':forecast}),flush=True)
if forecast>int(os.environ.get('TERRAIN_LP_APPROVED_MEMORY_BYTES',str(1024**3))):raise RuntimeError('Calibrated solver forecast exceeds allocation; no solve permitted')
A=coo_matrix((np.asarray(V), (np.asarray(R),np.asarray(C))),shape=(len(rhs),N+1)).tocsr();b=np.asarray(rhs);del R,C,V,rhs
bounds=[(-.75,.75)if n['free']else(0,0)for k,n in d['nodes']]+[(0,None)]
cost=np.zeros(N+1);cost[N]=1
res=linprog(cost,A_ub=A,b_ub=b,bounds=bounds,method='highs',options={'time_limit':160,'presolve':True,'threads':1})
report={'facetMode':'outer necessary relaxation' if os.environ.get('LP_OUTER')=='1' else 'inner conservative restriction','status':'SOLVE ONLY; no field adoption, pack or geographic acceptance','sourceRevision':d['sourceRevision'],'observationsSHA256':hashlib.sha256(raw).hexdigest(),'solverStatus':res.status,'message':res.message,'seconds':time.monotonic()-start,'gradientLimit':G,'amplitudeLimit':.75,'supportMetres':32,'ownerSagLimit':.5,'facets':facets,'facetCap':cap,'rows':A.shape[0],'nnz':A.nnz,'emittedCells':0}
if res.x is not None:
 values=res.x[:N];sags=[abs(c['signedSag']+sum(t['coefficient']*values[idx[t['key']]]for t in c['terms']))for c in d['chords']]
 gradients=[math.hypot(sum(dx*values[i]for i,dx,dz in t if i is not None),sum(dz*values[i]for i,dx,dz in t if i is not None))for t in triangles]
 fixed=max([abs(values[i])for i,(k,n)in enumerate(d['nodes'])if not n['free']]+[0]);amp=float(np.max(np.abs(values)));sag=max(sags);grad=max(gradients)
 report.update(objective=float(res.fun),maxPredictedSag=sag,maxEuclideanGradient=grad,maxAdjustment=amp,protectedMaxAdjustment=float(fixed),maxMatrixViolation=float(np.max(A@res.x-b)),proxyPassed=bool(res.success and sag<=.5+1e-7 and grad<=G+1e-8 and amp<=.75+1e-8 and fixed<=1e-10),worstChords=[{'id':d['chords'][i]['id'],'before':d['chords'][i]['signedSag'],'afterAbs':sags[i]}for i in sorted(range(len(sags)),key=lambda i:-sags[i])[:10]])
 json.dump({keys[i]:float(v)for i,v in enumerate(values)if abs(v)>1e-12},open(P+('lp-outer-values.json' if os.environ.get('LP_OUTER')=='1' else 'lp-values.json'),'w'))
if res.success:
 y=res.ineqlin.marginals;lo=res.lower.marginals;hi=res.upper.marginals
 station=cost-A.T@y-lo-hi
 dual=float(b@y+sum(a*l+bv*h for (a,bv),l,h in zip(bounds,lo,hi) if a is not None and bv is not None))
 report.update(dualBound=dual,dualityGap=float(res.fun-dual),dualStationarityMax=float(np.max(np.abs(station))),dualSignsMax=float(max(np.max(y),np.max(-lo),np.max(hi))))
report['maxRSS']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
json.dump(report,open(P+('lp-outer-report.json' if os.environ.get('LP_OUTER')=='1' else 'lp-report.json'),'w'),indent=2);print(json.dumps(report),flush=True)
