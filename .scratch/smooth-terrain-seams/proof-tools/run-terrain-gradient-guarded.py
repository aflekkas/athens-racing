import hashlib,json,os,signal,subprocess,time
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');S=T/'min-gradient-556';PY=T/'scipy-venv/bin/python';INPUT=T/'min-gradient-input.json';SHA='e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281';MODEL=S/'tools/terrain-lp/model.py';VERIFY=S/'tools/terrain-lp/verify.mjs';LIMIT=int(2.5*1024**3)
started=time.monotonic();deadline=started+174;active=None;report={'status':'bounded diagnostic running','sourceCommit':'556aa6704a1dfa1ff83001550058e0549c3189b1','rssLimitBytes':LIMIT,'minimumAvailableBytes':6*1024**3,'deadlineSeconds':174,'phases':[],'emittedCells':0,'adopted':False}
env=os.environ.copy();env.update(OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1',PYTHONDONTWRITEBYTECODE='1')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def available():return next(int(s.split()[1])*1024 for s in Path('/proc/meminfo').read_text().splitlines() if s.startswith('MemAvailable:'))
def save(): (T/'min-gradient-run-report.json').write_text(json.dumps(report,indent=2)+'\n')
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
    if rss>LIMIT:raise RuntimeError('Own-child RSS guard '+name)
    if mem<6*1024**3:raise RuntimeError('Available-memory guard '+name)
    if time.monotonic()>=phase_deadline:raise RuntimeError('External phase/total deadline '+name)
    time.sleep(.1)
  except BaseException:
   stop();raise
  row['exitCode']=active.returncode;row['endedSeconds']=time.monotonic()-started;active=None;save();print(json.dumps({'END':name,'exitCode':row['exitCode'],'rssPeak':row['rssPeak'],'seconds':row['endedSeconds']-row['startedSeconds']}),flush=True)
 return row['exitCode']
try:
 pin=json.loads((T/'min-gradient-run-pin.json').read_text());assert sha(INPUT)==SHA==pin['inputSHA256'];assert sha(T/'scipy-tool-receipt.json')==pin['toolReceiptSHA256']
 for p,h in pin['sourceSHA256'].items():assert sha(S/p)==h
 tool=json.loads((T/'scipy-tool-receipt.json').read_text())
 for p in tool['installedProbe']['sourceFiles']:assert sha(p['path'])==p['sha256']
 report['pin']=pin;report['availableBefore']=available()
 if report['availableBefore']<6*1024**3:raise RuntimeError('Preflight available memory')
 for mode,seconds in [('inner',50),('outer',40)]:
  cert=T/('min-gradient-'+mode+'.json');code=run('min-gradient-'+mode,[PY,MODEL,INPUT,'--sha256',SHA,'--mode',mode,'--solve','--seconds',str(seconds),'--memory-bytes',str(LIMIT),'--output',cert],seconds+12)
  if code:raise RuntimeError('Solver invocation failed '+mode)
  result=json.loads(cert.read_text());report[mode]={k:v for k,v in result.items()if k not in ('values','dual')};save()
  if result['solverStatus']==0:
   run('min-gradient-'+mode+'-verify',['node','--max-old-space-size=768',VERIFY,INPUT,cert,SHA],12)
   # Verifier emits only its JSON report; an outer primal may fail Euclidean bounds.
   verification=json.loads((T/('min-gradient-'+mode+'-verify.log')).read_text().strip());report[mode]['verification']=verification;save()
 inner=report['inner'];prior=inner.get('verification',{})
 if inner.get('solverStatus')==0 and prior.get('primalPassed') and prior.get('dualPassed') and prior.get('dualityGap',1)>1e-6:
  report['secondarySkipped']='Prior optimum not independently tight enough'
 elif inner.get('solverStatus')==0 and prior.get('primalPassed') and prior.get('dualPassed'):
  # Prior verification already ran as a separately guarded owned Node child.
  # Call the same exact556 Problem/solve directly to avoid an unmonitored nested verifier.
  wrapper=T/'run-secondary-556.py';wrapper.write_text("import runpy,json,hashlib,sys\nfrom pathlib import Path\nm=runpy.run_path(sys.argv[1]);raw=Path(sys.argv[2]).read_bytes();assert hashlib.sha256(raw).hexdigest()==sys.argv[3]\nv=json.loads(Path(sys.argv[4]).read_text());assert v['primalPassed'] and v['dualPassed'] and v['mode']=='inner' and v['stage']=='gradient' and v['dualityGap']<=1e-6\np=m['Problem'](json.loads(raw),'inner','correction',v['gradientVariable'],16)\nr=m['solve'](p,sys.argv[3],40,int(sys.argv[5]));Path(sys.argv[6]).write_text(json.dumps(r));print(json.dumps({k:a for k,a in r.items() if k not in ('values','dual')}))\n")
  report['secondaryWrapperSHA256']=sha(wrapper);cert=T/'min-gradient-secondary.json';code=run('min-gradient-secondary',[PY,wrapper,MODEL,INPUT,SHA,T/'min-gradient-inner-verify.log',str(LIMIT),cert],52)
  if code:raise RuntimeError('Secondary solve invocation failed')
  result=json.loads(cert.read_text());report['secondary']={k:v for k,v in result.items()if k not in ('values','dual')};save()
  if result['solverStatus']==0:
   run('min-gradient-secondary-verify',['node','--max-old-space-size=768',VERIFY,INPUT,cert,SHA,T/'min-gradient-inner.json'],15)
   report['secondary']['verification']=json.loads((T/'min-gradient-secondary-verify.log').read_text().strip())
 else:report['secondarySkipped']='No independently verified inner primal optimum'
 report['status']='Diagnostic complete; no pack/adoption/geographic acceptance'
except BaseException as error:
 report['status']='Stopped fail closed';report['error']=str(error)
finally:
 stop();report['seconds']=time.monotonic()-started;report['availableAfter']=available();save();print(json.dumps(report),flush=True)
