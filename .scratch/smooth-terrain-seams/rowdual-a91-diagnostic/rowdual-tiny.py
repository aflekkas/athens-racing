"""Task-local experiment. Import is inert; --run requires separate runtime grant."""
import argparse,hashlib,json,os,time,warnings,resource,sys
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');S=T/'syntagma-component-e4b/tools/terrain-lp'
PINS={str(S/'model.py'):'3ff95a6b102cf17c23c793ad2a4fe6a414e9adc2a0b2471656df32354f9f70d1',str(S/'verify.mjs'):'acdaede9ca9ad9d49d3d4325a47c0f5ad0a522d9cb807509b176919674cf0481'}
SITE=T/'scipy-venv/lib/python3.12/site-packages/scipy/optimize'
PINS.update({str(SITE/'_linprog_highs.py'):'32999bba42521a001d08bd9a1a02ca663b8b7eb93b6f799f37438e062484c89a',str(SITE/'_highspy/_highs_wrapper.py'):'c15a943a0985bf716d84b93719d0b2f572e698373655ab0258614b4b2ab67303',str(SITE/'_highspy/_core.cpython-312-x86_64-linux-gnu.so'):'33fb5a6a86b8fb914b26e69f8f046274b0b043d202511109365d3fde180c540d',str(SITE/'_highspy/_highs_options.cpython-312-x86_64-linux-gnu.so'):'116ed72be9accceafcdeb58d5d02308e5023b9bc98118303a79d3bc24fe171d6'})
def require(ok,msg):
 if not ok:raise ValueError(msg)
def authenticate():
 captured={}
 for path,h in PINS.items():
  raw=globals().get('__ROWDUAL_CAPTURED_MODEL__')if path==str(S/'model.py')else None
  if raw is None:raw=Path(path).read_bytes()
  require(hashlib.sha256(raw).hexdigest()==h,'pin failure '+path);captured[path]=raw
 return captured

def generic(name):
 if name=='bound-active':return dict(c=[-2,3,1,1],A=[[-1,0,0,-1]],b=[-3],bounds=[[1,2],[-2,3],[.5,.5],[0,10]])
 if name=='degenerate-scaled':return dict(c=[1,1,0],A=[[-1,-1,0],[-2,-2,0],[-.5,-.5,0]],b=[-1,-2,-.5],bounds=[[0,2],[0,2],[-1,1]])
 raise ValueError('unknown generic fixture')
def terrain(bound_active):
 coords={}
 for x,z in [(-8,0),(0,0),(8,0)]:
  for dx in range(-32,33,8):
   for dz in range(-32,33,8):
    if dx*dx+dz*dz<=1024:coords[x+dx,z+dz]=dict(x=x+dx,z=z+dz,free=x+dx==0 and z+dz==0)
 chord=dict(id='straight',a=dict(x=-8,z=0),b=dict(x=0,z=0),c=dict(x=8,z=0),signedSag=1.25 if bound_active else 1)
 return dict(schema='terrain-lp-input-1',sourceRevision='tiny-original-synthetic',chords=[chord,dict(chord,id='duplicate')] if bound_active else [chord],nodes=list(coords.values()),geography=dict(fixedSamples=[dict(id='summit',kind='summit',x=0,z=8,sourceY=100,sourceSHA256='a'*64),dict(id='profile',kind='profile',x=8,z=8,sourceY=99,sourceSHA256='a'*64)]))

def execute():
 # No real observation/cell/atlas path is read. All numerical imports stay behind --run.
 captured=authenticate()
 import numpy as np
 from scipy.optimize import linprog,OptimizeWarning
 from scipy.optimize._highspy import _core as core
 from scipy.optimize._highspy._highs_wrapper import check_option
 from scipy.sparse import coo_matrix
 h=core._Highs();status,kind=h.getOptionType('run_crossover');code,default=h.getOptionValue('run_crossover')
 require(status==core.HighsStatus.kOk and kind==core.HighsOptionType.kString and code==core.HighsStatus.kOk,'option type/default')
 require(check_option(h,'run_crossover','off')[0]==0,'option validation');require(h.setOptionValue('run_crossover','off')==core.HighsStatus.kOk,'option set');require(h.getOptionValue('run_crossover')[1]=='off','option roundtrip')
 result=dict(schema='rowdual-tiny-export-1',pins=PINS,option=dict(type=str(kind),default=default,roundtrip='off'),fixtures=[],realComponents=0,fullKKTClaim=False)
 # Supervisor invokes one fixture/pair at a time with --fixture/--mode; checker gates next.
 name=ARGS.fixture;mode=ARGS.mode
 data=None
 if name.startswith('terrain'):
  data=terrain(name=='terrain-bound-duplicate');model_ns={'__name__':'verified_model','__file__':str(S/'model.py')};exec(compile(captured[str(S/'model.py')],str(S/'model.py'),'exec'),model_ns);problem=model_ns['Problem'](data);rr=[];cc=[];vv=[];rhs=[]
  for row,terms in enumerate(problem.rows()):
   entries,bound=terms;rhs.append(bound)
   for col,value in entries:rr.append(row);cc.append(col);vv.append(value)
  A=coo_matrix((vv,(rr,cc)),shape=(len(rhs),len(problem.bounds))).tocsr();c=problem.objective;b=rhs;bounds=problem.bounds
 else:
  f=generic(name);c=f['c'];A=f['A'];b=f['b'];bounds=f['bounds']
 opts=dict(time_limit=1.,threads=1,presolve=False,run_crossover=mode)
 expected="Unrecognized options detected: {'threads': 1, 'run_crossover': '"+mode+"'}. These will be passed to HiGHS verbatim."
 with warnings.catch_warnings(record=True)as caught:
  warnings.simplefilter('always');r=linprog(c,A_ub=A,b_ub=b,bounds=bounds,method='highs-ipm',options=opts)
 require(len(caught)==1 and type(caught[0].message)is OptimizeWarning and str(caught[0].message)==expected,'unexpected/invalid/missing warning')
 require(r.success and r.status==0,'nonoptimal/timeout');require(r.nit>0,'inconclusive: no IPM iterations');require(mode!='off' or r.crossover_nit==0,'off ignored')
 arrays=[r.x,r.ineqlin.marginals,r.lower.marginals,r.upper.marginals]
 require(all(np.isfinite(a).all() for a in arrays),'nonfinite actual export');require(len(r.x)==len(c)and len(r.ineqlin.marginals)==len(b)and len(r.lower.marginals)==len(c)and len(r.upper.marginals)==len(c),'export dimensions')
 record=dict(name=name,mode=mode,options=opts,status=int(r.status),success=bool(r.success),iterations=int(r.nit),crossover=int(r.crossover_nit),warnings=[str(w.message)for w in caught],values=list(map(float,r.x)),rowDual=[[i,float(y)]for i,y in enumerate(r.ineqlin.marginals)if y!=0],rowCount=len(b),lowerMarginals=list(map(float,r.lower.marginals)),upperMarginals=list(map(float,r.upper.marginals)),fullKKTClaim=False)
 if data is not None:record['data']=data
 result['fixtures']=[record];result['maxRSS']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
 target=T/f'rowdual-tiny-{name}-{mode}.json';temporary=target.with_suffix('.partial');temporary.write_text(json.dumps(result));temporary.replace(target);print(json.dumps(dict(status='EXPORTED UNVERIFIED',name=name,mode=mode)),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--run',action='store_true');p.add_argument('--sequence',action='store_true');p.add_argument('--fixture',choices=['bound-active','degenerate-scaled','terrain','terrain-bound-duplicate']);p.add_argument('--mode',choices=['on','off']);ARGS=p.parse_args()
 if not ARGS.run:print(json.dumps(dict(status='SOURCE ONLY',pins=PINS,realImports=0,realSolves=0)))
 elif ARGS.sequence:
  for line in sys.stdin:
   command=json.loads(line);require(set(command)=={'fixture','mode'},'command shape');ARGS.fixture=command['fixture'];ARGS.mode=command['mode'];require(ARGS.fixture in ('bound-active','degenerate-scaled','terrain','terrain-bound-duplicate')and ARGS.mode in ('on','off'),'command scope');execute()
 else:
  require(ARGS.fixture and ARGS.mode,'explicit tiny fixture/mode required');execute()
