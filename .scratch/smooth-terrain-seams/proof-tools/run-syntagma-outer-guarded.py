import hashlib,json,os,signal,subprocess,time
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');S=T/'syntagma-component-e4b';PY=T/'scipy-venv/bin/python';INPUT=T/'min-gradient-input.json';SHA='e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281';MODEL=S/'tools/terrain-lp/model.py';VERIFY=S/'tools/terrain-lp/components.mjs';LIMIT=1024**3
started=time.monotonic();deadline=started+54;active=None;report={'status':'bounded diagnostic running','sourceCommit':'556aa6704a1dfa1ff83001550058e0549c3189b1','rssLimitBytes':LIMIT,'minimumAvailableBytes':6*1024**3,'deadlineSeconds':174,'phases':[],'emittedCells':0,'adopted':False}
env=os.environ.copy();env.update(OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1',PYTHONDONTWRITEBYTECODE='1')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def available():return next(int(s.split()[1])*1024 for s in Path('/proc/meminfo').read_text().splitlines() if s.startswith('MemAvailable:'))
def save(): (T/'syntagma-outer-run-report.json').write_text(json.dumps(report,indent=2)+'\n')
def stop():
 global active
 if active is not None and active.poll() is None:
  active.terminate()
  try:active.wait(timeout=2)
  except subprocess.TimeoutExpired:active.kill();active.wait()
def interrupted(sig,frame):
 stop();raise RuntimeError('External deadline/interrupt received')
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
def run(name,cmd,seconds):
 global active
 if available()<6*1024**3:raise RuntimeError('Available-memory guard before '+name)
 if deadline-time.monotonic()<3:raise RuntimeError('Total deadline before '+name)
 log=T/(name+'.log');row={'phase':name,'command':list(map(str,cmd)),'startedSeconds':time.monotonic()-started,'rssPeak':0,'minimumAvailable':available(),'maximumThreads':0}
 with log.open('w') as out:
  active=subprocess.Popen(list(map(str,cmd)),stdout=out,stderr=subprocess.STDOUT,env=env)
  row['ownedPID']=active.pid;report['phases'].append(row);save();print(json.dumps({'BEGIN':name,'ownedPID':active.pid}),flush=True)
  phase_deadline=min(deadline,time.monotonic()+seconds)
  try:
   while active.poll() is None:
    mem=available();row['minimumAvailable']=min(row['minimumAvailable'],mem)
    try:
     st=Path('/proc')/str(active.pid)/'status';lines=st.read_text().splitlines();rss=next((int(s.split()[1])*1024 for s in lines if s.startswith('VmRSS:')),0);threads=next((int(s.split()[1])for s in lines if s.startswith('Threads:')),0)
    except FileNotFoundError:rss=threads=0
    row['rssPeak']=max(row['rssPeak'],rss);row['maximumThreads']=max(row['maximumThreads'],threads)
    if sum(q.stat().st_size for q in T.glob('syntagma-outer-*') if q.is_file())>10*1024**2:raise RuntimeError('Reduced output budget exceeded')
    if rss>LIMIT:raise RuntimeError('Own-child RSS guard '+name)
    if mem<6*1024**3:raise RuntimeError('Available-memory guard '+name)
    if time.monotonic()>=phase_deadline:raise RuntimeError('External phase/total deadline '+name)
    time.sleep(.1)
  except BaseException:
   stop();raise
  row['exitCode']=active.returncode;row['endedSeconds']=time.monotonic()-started;active=None;save();print(json.dumps({'END':name,'exitCode':row['exitCode'],'rssPeak':row['rssPeak'],'seconds':row['endedSeconds']-row['startedSeconds']}),flush=True)
 return row['exitCode']
report={'status':'OUTER necessary relaxation running','sourceCommit':'e4b7bf2ea6a6f71f21806480f19591c87de083a4','componentId':'-32,608','phases':[],'rssLimitBytes':LIMIT,'minimumAvailableBytes':6*1024**3,'externalDeadlineSeconds':60,'internalDeadlineSeconds':54,'emittedCells':0,'adopted':False,'physicalFeasibilityClaimed':False}
try:
 pin=json.loads((T/'syntagma-e4b-pin.json').read_text());assert sha(INPUT)==SHA==pin['inputSHA256'];assert sha(T/'scipy-tool-receipt.json')==pin['toolReceiptSHA256']
 for path,h in pin['files'].items():assert sha(S/path)==h
 for q in json.loads((T/'scipy-tool-receipt.json').read_text())['installedProbe']['sourceFiles']:assert sha(q['path'])==q['sha256']
 inner=T/'syntagma-e4b-result.json';assert sha(inner)=='915062513c75851e76dfa73bdddfa0731c17c2d7d0a50ef031120ef46ccaca82';report['savedInnerCertificateSHA256']=sha(inner)
 report['pin']=pin;report['availableBefore']=available();report['dfBefore']=subprocess.check_output(['df','-h','/'],text=True)
 if available()<6*1024**3:raise RuntimeError('Immediate 6GiB preflight failed')
 cert=T/'syntagma-outer-result.json';code=run('syntagma-outer-ipm',[PY,S/'tools/terrain-lp/components.py',INPUT,'--sha256',SHA,'--mode','outer','--component=-32,608','--solve','--method','highs-ipm','--seconds','40','--memory-bytes',str(LIMIT),'--output',cert],46)
 if code:raise RuntimeError('Outer component invocation failed')
 result=json.loads(cert.read_text());report['solver']={k:v for k,v in result.items()if k not in ('values','dual','globalVariables')};report['certificateSHA256']=sha(cert)
 if result['solverStatus']!=0:
  report['status']='NO RESULT: nonoptimal/timeout; independent verifier skipped';report['verifierSkipped']=True
 else:
  code=run('syntagma-outer-independent',['node','--max-old-space-size=512',VERIFY,INPUT,cert,SHA],12)
  v=json.loads((T/'syntagma-outer-independent.log').read_text().strip());report['independentVerification']=v;report['verifierExitCode']=code
  numbers=['gradientVariable','maxRowViolation','maxSag','maxAdjustment','maxProfileCorrection','dualityGap','maxEuclideanGradient','conservativeDualBound']
  import math
  if not all(isinstance(v.get(k),(int,float)) and math.isfinite(v[k])for k in numbers):raise RuntimeError('Nonfinite/malformed outer verifier report')
  linear=v['gradientVariable']>=0 and v['maxRowViolation']<=1e-7 and v['maxSag']<=.5+1e-7 and v['maxAdjustment']<=.75+1e-8 and v['maxProfileCorrection']<=1e-8
  if v.get('mode')!='outer' or v.get('stage')!='gradient' or v.get('componentId')!='-32,608' or not v.get('dualPassed') or not linear or not -1e-7<=v['dualityGap']<=1e-6:raise RuntimeError('Outer semantic dual/finite-facet check rejected')
  if code not in (0,1) or (code==0)!=bool(v.get('primalPassed')):raise RuntimeError('Verifier return semantics mismatch')
  if code==1 and not v['maxEuclideanGradient']>v['gradientVariable']+1e-8:raise RuntimeError('Verifier rejected for reason beyond expected exact-norm excess')
  report['finiteFacetRelaxationPassed']=True;report['necessaryGradientLowerBound']=v['conservativeDualBound'];report['status']='Validated OUTER necessary relaxation lower bound ONLY; no physical/whole-field acceptance'
 report['secondarySkipped']=True
except BaseException as error:
 report['status']='Stopped fail closed';report['error']=str(error)
finally:
 stop();report['seconds']=time.monotonic()-started;report['availableAfter']=available();report['dfAfter']=subprocess.check_output(['df','-h','/'],text=True);report['outputBytes']=sum(q.stat().st_size for q in T.glob('syntagma-outer-*')if q.is_file());save();print(json.dumps(report),flush=True)
