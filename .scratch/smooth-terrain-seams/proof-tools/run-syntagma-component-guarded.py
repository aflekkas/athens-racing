import hashlib,json,os,signal,subprocess,time
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');S=T/'syntagma-component-e4b';PY=T/'scipy-venv/bin/python';INPUT=T/'min-gradient-input.json';SHA='e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281';MODEL=S/'tools/terrain-lp/model.py';VERIFY=S/'tools/terrain-lp/components.mjs';LIMIT=1024**3
started=time.monotonic();deadline=started+84;active=None;report={'status':'bounded diagnostic running','sourceCommit':'556aa6704a1dfa1ff83001550058e0549c3189b1','rssLimitBytes':LIMIT,'minimumAvailableBytes':6*1024**3,'deadlineSeconds':174,'phases':[],'emittedCells':0,'adopted':False}
env=os.environ.copy();env.update(OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1',PYTHONDONTWRITEBYTECODE='1')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def available():return next(int(s.split()[1])*1024 for s in Path('/proc/meminfo').read_text().splitlines() if s.startswith('MemAvailable:'))
def save(): (T/'syntagma-run-report.json').write_text(json.dumps(report,indent=2)+'\n')
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
    if sum(q.stat().st_size for q in T.glob('syntagma-*') if q.is_file())>10*1024**2:raise RuntimeError('Reduced output budget exceeded')
    if rss>LIMIT:raise RuntimeError('Own-child RSS guard '+name)
    if mem<6*1024**3:raise RuntimeError('Available-memory guard '+name)
    if time.monotonic()>=phase_deadline:raise RuntimeError('External phase/total deadline '+name)
    time.sleep(.1)
  except BaseException:
   stop();raise
  row['exitCode']=active.returncode;row['endedSeconds']=time.monotonic()-started;active=None;save();print(json.dumps({'END':name,'exitCode':row['exitCode'],'rssPeak':row['rssPeak'],'seconds':row['endedSeconds']-row['startedSeconds']}),flush=True)
 return row['exitCode']
report={'status':'single Syntagma diagnostic running','sourceCommit':'e4b7bf2ea6a6f71f21806480f19591c87de083a4','componentId':'-32,608','phases':[],'rssLimitBytes':LIMIT,'minimumAvailableBytes':6*1024**3,'externalDeadlineSeconds':90,'internalDeadlineSeconds':84,'emittedCells':0,'adopted':False}
try:
 pin=json.loads((T/'syntagma-e4b-pin.json').read_text());assert sha(INPUT)==SHA==pin['inputSHA256'];assert sha(T/'scipy-tool-receipt.json')==pin['toolReceiptSHA256']
 for path,h in pin['files'].items():assert sha(S/path)==h
 for q in json.loads((T/'scipy-tool-receipt.json').read_text())['installedProbe']['sourceFiles']:assert sha(q['path'])==q['sha256']
 report['pin']=pin;report['availableBefore']=available();report['dfBefore']=subprocess.check_output(['df','-h','/'],text=True)
 if available()<6*1024**3:raise RuntimeError('Immediate 6GiB preflight failed')
 cert=T/'syntagma-e4b-result.json';code=run('syntagma-ipm',[PY,S/'tools/terrain-lp/components.py',INPUT,'--sha256',SHA,'--mode','inner','--component=-32,608','--solve','--method','highs-ipm','--seconds','60','--memory-bytes',str(LIMIT),'--output',cert],70)
 if code:raise RuntimeError('Component invocation failed')
 result=json.loads(cert.read_text());report['solver']={k:v for k,v in result.items()if k not in ('values','dual','globalVariables')};report['certificateSHA256']=sha(cert)
 if result['solverStatus']==0:
  code=run('syntagma-independent',['node','--max-old-space-size=512',VERIFY,INPUT,cert,SHA],14)
  verification=json.loads((T/'syntagma-independent.log').read_text().strip());report['independentVerification']=verification
  report['status']='Partial source component verified; no whole-field/geographic/physical acceptance' if code==0 else 'Component independent verification rejected'
 else:
  report['status']='NO RESULT: solver stopped without a verified primal/certificate';report['verifierSkipped']=True
 report['secondarySkipped']=True
except BaseException as error:
 report['status']='Stopped fail closed';report['error']=str(error)
finally:
 stop();report['seconds']=time.monotonic()-started;report['availableAfter']=available();report['dfAfter']=subprocess.check_output(['df','-h','/'],text=True);report['outputBytes']=sum(q.stat().st_size for q in T.glob('syntagma-*')if q.is_file());save();print(json.dumps(report),flush=True)
