"""Task-local guarded harness. Default authenticates/prints only, no solver imports."""
import argparse,hashlib,json,os,subprocess,time,signal,base64
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');RSS=512*1024**2;CAP=1024**2
CASES=[(name,mode)for name in ['bound-active','degenerate-scaled','terrain','terrain-bound-duplicate']for mode in ['on','off']]

def authenticate(manifest_path,expected_sha):
 with Path(manifest_path).open('rb')as f:raw=f.read(1024**2+1)
 if len(raw)>1024**2:raise RuntimeError('bounded manifest size')
 if not expected_sha or hashlib.sha256(raw).hexdigest()!=expected_sha:raise RuntimeError('manifest authentication failed')
 ready=json.loads(raw);captured={}
 code=ready.get('codeSHA256',{});tools=ready.get('expectedToolPins',{})
 if {Path(p).name for p in code}!={'rowdual-tiny.py','rowdual-tiny-check.mjs','rowdual-tiny-supervisor.py','rowdual-supervisor-control.py','test-rowdual-supervisor-control.py'}or len(code)!=5:raise RuntimeError('code closure binding mismatch')
 if {Path(p).name for p in tools}!={'model.py','verify.mjs','_linprog_highs.py','_highs_wrapper.py','_core.cpython-312-x86_64-linux-gnu.so','_highs_options.cpython-312-x86_64-linux-gnu.so'}or len(tools)!=6:raise RuntimeError('tool/transitive closure binding mismatch')
 for path,h in {**code,**tools}.items():
  # One bounded read; validation and subsequent custom-code execution use these bytes.
  with Path(path).open('rb')as f:data=f.read(64*1024**2+1)
  if len(data)>64*1024**2 or hashlib.sha256(data).hexdigest()!=h:raise RuntimeError('closure authentication failed '+path)
  captured[path]=data
 return ready,captured

def by_name(captured,name):
 return next(data for path,data in captured.items()if Path(path).name==name)

def execute_captured(data,filename):
 ns={'__name__':'rowdual_verified_dependency','__file__':filename};exec(compile(data,filename,'exec'),ns);return ns

def main(ready,captured):
 controls=execute_captured(by_name(captured,'rowdual-supervisor-control.py'),'verified-control');sample=controls['sample_owned_child'];stop=controls['stop_owned_child'];Guard=controls['GuardFailure'];signal.signal(signal.SIGTERM,lambda sig,frame:(_ for _ in()).throw(Guard('external deadline/interrupt')));signal.signal(signal.SIGINT,lambda sig,frame:(_ for _ in()).throw(Guard('interrupt')));started=time.monotonic();handles=[];report={'schema':'rowdual-tiny-supervisor-1','source':ready,'started':started,'ownedPIDs':[],'cases':[],'status':'RUNNING','realComponents':0,'fullKKTClaim':False,'historicalOffFullKKTFailure':'247d all-zero bound-marginal exports; preserved, not repaired','rowOnlyAllFixturesAccepted':False,'rssPeak':0,'outputBytes':0,'caps':{'externalSeconds':10,'internalSeconds':9,'solverSeconds':1,'rssBytes':RSS,'outputBytes':CAP},'availableBefore':available()};worker=None;log=None
 def save():
  report['seconds']=time.monotonic()-started;(T/'rowdual-run-report.json').write_text(json.dumps(report,indent=2)+'\n')
 def guard():
  if time.monotonic()-started>=9:raise Guard('internal9s deadline')
  if available()<6*1024**3:raise Guard('system available below6GiB')
  total=0
  for h in handles:
   m=sample(h,lambda pid:Path('/proc',str(pid),'status').read_text())
   if m['state']=='running':total+=m['rss']
  report['rssPeak']=max(report['rssPeak'],total)
  report['outputBytes']=sum(p.stat().st_size for p in T.glob('rowdual-tiny-*.json'))+sum(p.stat().st_size for p in T.glob('rowdual-run-*')if p.is_file())
  if total>RSS or report['outputBytes']>CAP:raise Guard('RSS/output cap')
 def launch(cmd,stdout,stdin=None):
  h=subprocess.Popen(cmd,stdout=stdout,stderr=subprocess.STDOUT,stdin=stdin,text=True,env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1','PYTHONDONTWRITEBYTECODE':'1'});handles.append(h);report['ownedPIDs'].append(h.pid);save();return h
 try:
  if any((T/f'rowdual-tiny-{name}-{mode}.json').exists()for name,mode in CASES):raise Guard('Prior tiny output exists; no silent overwrite/retry')
  worker_bootstrap="import base64;__name__='__main__';__file__='verified-rowdual-worker';__ROWDUAL_CAPTURED_MODEL__=base64.b64decode("+repr(base64.b64encode(by_name(captured,'model.py')).decode())+");exec(compile(base64.b64decode("+repr(base64.b64encode(by_name(captured,'rowdual-tiny.py')).decode())+"),'verified-worker','exec'))"
  guard();log=(T/'rowdual-run-worker.log').open('w');worker=launch([str(T/'scipy-venv/bin/python'),'-c',worker_bootstrap,'--run','--sequence'],log,subprocess.PIPE)
  for name,mode in CASES:
   guard();case={'name':name,'mode':mode,'status':'RUNNING'};report['cases'].append(case);save();target=T/f'rowdual-tiny-{name}-{mode}.json';phase=time.monotonic();worker.stdin.write(json.dumps({'fixture':name,'mode':mode})+'\n');worker.stdin.flush()
   while not target.exists():
    guard()
    if worker.poll()is not None:raise Guard('worker nonzero/missing export '+str(worker.returncode))
    if time.monotonic()-phase>2.5:raise Guard('worker export phase2.5s deadline')
    time.sleep(.01)
   case['exportSHA256']=hashlib.sha256(target.read_bytes()).hexdigest();out=T/f'rowdual-run-check-{name}-{mode}.log'
   with out.open('w')as f:
    check=launch(['node','--max-old-space-size=128','--input-type=module','-e',by_name(captured,'rowdual-tiny-check.mjs').decode(),'verified-checker','--export',str(target),'--manifest',ARGS.manifest,'--manifest-sha',ARGS.manifest_sha],f);phase=time.monotonic()
    while check.poll()is None:
     guard()
     if time.monotonic()-phase>1:raise Guard('independent verifier1s deadline')
     time.sleep(.01)
   if hashlib.sha256(target.read_bytes()).hexdigest()!=case['exportSHA256']:raise Guard('export changed during verification')
   if check.returncode!=0:raise Guard('independent checker exit '+str(check.returncode))
   result=json.loads(out.read_text())
   if not result.get('rowOnlyCertificateAccepted'):raise Guard('row-only certificate rejected')
   case.update(status='VERIFIED ROW-ONLY',verification=result);save()
  worker.stdin.close();worker.wait(timeout=.25)
  if worker.returncode!=0:raise Guard('worker final status '+str(worker.returncode))
  guard();report['status']='ALL TINY ROW-ONLY FIXTURES VERIFIED';report['rowOnlyAllFixturesAccepted']=True
 except BaseException as e:report['status']='FAIL CLOSED';report['error']=str(e)
 finally:
  for h in reversed(handles):
   try:stop(h,subprocess.TimeoutExpired)
   except BaseException as e:report.setdefault('cleanupErrors',[]).append(str(e))
  if log:log.close()
  report['childExitCodes']=[h.returncode for h in handles];report['allOwnedChildrenReaped']=all(h.poll()is not None for h in handles);report['availableAfter']=available();save()
 return 0 if report['rowOnlyAllFixturesAccepted']and report['allOwnedChildrenReaped']and not report.get('cleanupErrors')else 1

def available():return next(int(s.split()[1])*1024 for s in Path('/proc/meminfo').read_text().splitlines()if s.startswith('MemAvailable:'))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--run',action='store_true');p.add_argument('--fake-controls',action='store_true');p.add_argument('--manifest',default=str(T/'rowdual-source-ready.json'));p.add_argument('--manifest-sha',required=True);ARGS=p.parse_args()
 ready,captured=authenticate(ARGS.manifest,ARGS.manifest_sha)
 if ARGS.run:raise SystemExit(main(ready,captured))
 if ARGS.fake_controls:
  controls=execute_captured(by_name(captured,'rowdual-supervisor-control.py'),'verified-control');tests=execute_captured(by_name(captured,'test-rowdual-supervisor-control.py'),'verified-fake-tests');tests['run_controls'](controls)
 else:print(json.dumps({'status':'SOURCE ONLY; no solve authorization','source':ready,'authenticatedBeforeExecution':True,'cases':CASES}))
