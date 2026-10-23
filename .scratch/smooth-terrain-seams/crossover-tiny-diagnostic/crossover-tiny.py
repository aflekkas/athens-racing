import os,time,json,hashlib,warnings,runpy,subprocess,resource,traceback
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');S=T/'syntagma-component-e4b/tools/terrain-lp';report={'status':'RUNNING','phases':[],'realComponents':0,'passed':0,'inconclusive':0,'failed':0};start=time.monotonic()
def save():
 report['seconds']=time.monotonic()-start;report['maxRSS']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024;(T/'crossover-tiny-report.json').write_text(json.dumps(report,indent=2)+'\n')
def check(ok,msg):
 if not ok:raise ValueError(msg)
try:
 for p,h in [(T/'scipy-venv/lib/python3.12/site-packages/scipy/optimize/_linprog_highs.py','32999bba42521a001d08bd9a1a02ca663b8b7eb93b6f799f37438e062484c89a'),(T/'scipy-venv/lib/python3.12/site-packages/scipy/optimize/_highspy/_highs_wrapper.py','c15a943a0985bf716d84b93719d0b2f572e698373655ab0258614b4b2ab67303'),(S/'model.py','3ff95a6b102cf17c23c793ad2a4fe6a414e9adc2a0b2471656df32354f9f70d1'),(S/'verify.mjs','acdaede9ca9ad9d49d3d4325a47c0f5ad0a522d9cb807509b176919674cf0481')]:check(hashlib.sha256(p.read_bytes()).hexdigest()==h,'source pin '+str(p))
 import numpy as np
 from scipy.optimize import linprog,OptimizeWarning
 from scipy.optimize._highspy import _core as core,_highs_options as hop
 from scipy.optimize._highspy._highs_wrapper import check_option
 h=core._Highs();status,kind=h.getOptionType('run_crossover');s,default=h.getOptionValue('run_crossover');check(status==core.HighsStatus.kOk and kind==core.HighsOptionType.kString and s==core.HighsStatus.kOk,'option type/default')
 check(check_option(h,'run_crossover','off')[0]==0,'actual option validation');check(h.setOptionValue('run_crossover','off')==core.HighsStatus.kOk,'option set');check(h.getOptionValue('run_crossover')[1]=='off','option roundtrip')
 report['option']={'type':str(kind),'default':default,'roundtrip':'off','validated':True};report['passed']+=1;save()
 def solve(name,c,A,b,bounds,mode):
  phase={'name':name,'mode':mode};report['phases'].append(phase);save()
  options={'time_limit':1.,'threads':1,'presolve':False,'run_crossover':mode}
  expected="Unrecognized options detected: {'threads': 1, 'run_crossover': '"+mode+"'}. These will be passed to HiGHS verbatim."
  with warnings.catch_warnings(record=True)as ws:
   warnings.simplefilter('always');r=linprog(c,A_ub=A,b_ub=b,bounds=bounds,method='highs-ipm',options=options)
  phase.update(status=int(r.status),message=r.message,nit=r.nit,crossover=r.crossover_nit,warnings=[str(w.message)for w in ws]);save()
  check(len(ws)==1 and type(ws[0].message)is OptimizeWarning and str(ws[0].message)==expected,'unexpected or missing warning')
  check(r.success and r.status==0,'nonoptimal result');check(mode!='off' or r.crossover_nit==0,'off ignored')
  c=np.asarray(c);A=np.asarray(A);b=np.asarray(b);x=np.asarray(r.x);y=np.asarray(r.ineqlin.marginals);lo=np.asarray(r.lower.marginals);up=np.asarray(r.upper.marginals)
  check(x.shape==c.shape and y.shape==b.shape and lo.shape==c.shape and up.shape==c.shape and all(np.isfinite(v).all() for v in [x,y,lo,up]),'missing/malformed exports')
  L=np.array([v[0] for v in bounds]);U=np.array([np.inf if v[1]is None else v[1] for v in bounds]);slack=b-A@x;station=c-A.T@y-lo-up
  boundres=max(float(np.max(L-x)),float(np.max(x-U)));rowres=float(np.max(A@x-b));stat=float(np.max(abs(station)));comp=max(float(np.max(abs(y*slack))),float(np.max(abs(lo*(x-L)))),float(np.max(abs(up[np.isfinite(U)]*(U-x)[np.isfinite(U)]))))
  q=c-A.T@y;lower=float(b@y)+sum(float(min(qi*l,qi*u))if np.isfinite(u)else float(qi*l) for qi,l,u in zip(q,L,U));gap=float(c@x-lower)
  phase.update(rowResidual=rowres,boundResidual=boundres,stationarity=stat,complementarity=comp,conservativeRowDualLower=lower,dualityGap=gap,objective=float(c@x),primal=x.tolist(),rowDual=y.tolist(),lowerDual=lo.tolist(),upperDual=up.tolist());save()
  check(rowres<=1e-7 and boundres<=1e-8 and (y<=1e-8).all()and(lo>=-1e-8).all()and(up<=1e-8).all()and stat<=1e-7 and comp<=1e-7 and abs(gap)<=1e-6,'independent KKT/full rows/dual rejected')
  check(r.nit>0,'inconclusive: no IPM iterations');report['passed']+=1;save();return r
 c=[-2,3,1,1];A=[[-1,0,0,-1]];b=[-3];bounds=[(1,2),(-2,3),(.5,.5),(0,10)]
 for mode in ['on','off']:
  r=solve('active-nonzero-bounds',c,A,b,bounds,mode);check(abs(r.fun+8.5)<=1e-7,'analytic optimum')
 for mode in ['on','off']:
  r=solve('degenerate-scaled-flat-face',[1,1,0],[[-1,-1,0],[-2,-2,0],[-.5,-.5,0]],[ -1,-2,-.5],[(0,2),(0,2),(-1,1)],mode);check(abs(r.fun-1)<=1e-7,'degenerate analytic optimum')
 coords={}
 for x,z in [(-8,0),(0,0),(8,0)]:
  for dx in range(-32,33,8):
   for dz in range(-32,33,8):
    if dx*dx+dz*dz<=1024:coords[(x+dx,z+dz)]={'x':x+dx,'z':z+dz,'free':x+dx==0 and z+dz==0}
 data={'schema':'terrain-lp-input-1','sourceRevision':'tiny-only','chords':[{'id':'straight','a':{'x':-8,'z':0},'b':{'x':0,'z':0},'c':{'x':8,'z':0},'signedSag':1}],'nodes':list(coords.values()),'geography':{'fixedSamples':[{'id':'summit','kind':'summit','x':0,'z':8,'sourceY':100,'sourceSHA256':'a'*64},{'id':'profile','kind':'profile','x':8,'z':8,'sourceY':99,'sourceSHA256':'a'*64}]}}
 P=runpy.run_path(str(S/'model.py'))['Problem'](data);rows=list(P.rows());A=np.zeros((len(rows),len(P.bounds)));b=[]
 for i,(terms,rhs)in enumerate(rows):
  for j,v in terms:A[i,j]+=v
  b.append(rhs)
 certs=[]
 for mode in ['on','off']:
  r=solve('synthetic-terrain',P.objective,A,b,P.bounds,mode);certs.append({'schema':'terrain-lp-certificate-1','inputSHA256':'a'*64,'mode':'inner','stage':'gradient','facets':16,'values':r.x.tolist(),'dual':[[i,float(y)]for i,y in enumerate(r.ineqlin.marginals)if y!=0]})
 payload={'data':data,'certificates':certs};(T/'crossover-tiny-terrain.json').write_text(json.dumps(payload))
 code="import{readFileSync}from'node:fs';import{verifyTerrainLPCertificate}from'"+str(S/'verify.mjs')+"';const p=JSON.parse(readFileSync(process.argv[1]));for(const c of p.certificates){const v=verifyTerrainLPCertificate(p.data,c,{inputSHA256:'a'.repeat(64)});if(!v.primalPassed||!v.dualPassed||v.dualityGap>1e-6)throw Error('semantic reject');let bad=structuredClone(c);bad.values[bad.values.length-1]=0;if(verifyTerrainLPCertificate(p.data,bad,{inputSHA256:'a'.repeat(64)}).primalPassed)throw Error('negative accepted');bad=structuredClone(c);bad.dual=[];if(verifyTerrainLPCertificate(p.data,bad,{inputSHA256:'a'.repeat(64)}).dualityGap<1e-6)throw Error('bad dual accepted');}console.log('semantic2 positives4 negatives PASS');"
 node=subprocess.Popen(['node','--max-old-space-size=128','--input-type=module','-e',code,str(T/'crossover-tiny-terrain.json')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);report['ownedNodePID']=node.pid;save()
 try:out,err=node.communicate(timeout=1)
 except BaseException:node.terminate();node.wait();raise
 check(node.returncode==0,'JS verifier '+err);report['semantic']=out;report['passed']+=6;report['status']='PASS tiny API/export only'
except BaseException as e:
 report['status']='FAIL CLOSED';report['failed']+=1;report['error']=str(e);report['trace']=traceback.format_exc()
finally:save();print(json.dumps({k:v for k,v in report.items()if k!='phases'}))
raise SystemExit(0 if report['failed']==0 else 1)
