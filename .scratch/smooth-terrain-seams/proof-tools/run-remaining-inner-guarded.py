"""Plan B source/metadata supervisor. Default is --plan; --run needs a new grant.
Only recorded direct subprocess handles are ever signalled. No field or pack API.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import time
T=Path('/tmp/athens-terrain.uKVC');S=T/'syntagma-component-e4b';PY=T/'scipy-venv/bin/python';I=T/'min-gradient-input.json';V=S/'tools/terrain-lp/components.mjs';C=S/'tools/terrain-lp/components.py'
H='e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281';TOOL='048b493756127e3b5083601738b24838f1c5aa6519d9e3bed4d8e24269fa158d';INNER='915062513c75851e76dfa73bdddfa0731c17c2d7d0a50ef031120ef46ccaca82'
FILES={'tools/terrain-lp/prepare.mjs':'10f10c456babf23106641cbecbb410003c8f5c6e7b1fbdbd8a843e65cddc99cc','tools/terrain-lp/components.py':'43cb9ec215e41dfcfe223eda56e644575335888c09884f8e56a9e876357d2c0e','tools/terrain-lp/verify.mjs':'acdaede9ca9ad9d49d3d4325a47c0f5ad0a522d9cb807509b176919674cf0481','tools/terrain-lp/model.py':'3ff95a6b102cf17c23c793ad2a4fe6a414e9adc2a0b2471656df32354f9f70d1','tools/terrain-lp/components.mjs':'5377780622fe0201c561579ef36e7dc79c3ebc4fc56f79d41a7c20cfe0fbb305'}
COMPONENTS=[('-32,960',196,7208,23800,234881024),('992,-488',1958,68412,240584,268694698),('1200,-72',973,33698,120358,234881024),('2016,12856',4444,150460,541548,478897383),('4576,-3504',4488,153256,544324,480836228),('7136,-10680',4079,140478,495284,446585156)]
RSS=1024**3;AVAILABLE=6*1024**3;OUTPUT=10*1024**2;FULL_RESERVE=45;START_RESERVE=27+12+FULL_RESERVE
class StopDiagnostic(RuntimeError):pass

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def authenticate():
 if sha(I)!=H or sha(T/'scipy-tool-receipt.json')!=TOOL or sha(T/'syntagma-e4b-result.json')!=INNER:raise StopDiagnostic('Historical input/tool/certificate pin failure')
 for path,h in FILES.items():
  if sha(S/path)!=h:raise StopDiagnostic('Frozen source pin failure '+path)
 tool=json.loads((T/'scipy-tool-receipt.json').read_text())
 for entry in tool['installedProbe']['sourceFiles']:
  if sha(entry['path'])!=entry['sha256']:raise StopDiagnostic('Installed tool source pin failure')
 return {'sourceCommit':'e4b7bf2ea6a6f71f21806480f19591c87de083a4','inputSHA256':H,'toolReceiptSHA256':TOOL,'historicalCertificateSHA256':INNER,'sourceFiles':FILES,'controllerSHA256':sha(__file__)}
def solver_command(index,component):return list(map(str,[PY,C,I,'--sha256',H,'--mode','inner','--component='+component,'--solve','--method','highs-ipm','--seconds','20','--memory-bytes',RSS,'--output',T/f'inner-batch-component-{index}.json']))
def verifier_command(path):return list(map(str,['node','--max-old-space-size=512',V,I,path,H]))
def finite(report,keys):return all(type(report.get(k))in(int,float)and math.isfinite(report[k])for k in keys)
def validate_component(c,v,expected):
 if c.get('solverStatus')!=0:raise StopDiagnostic('Nonoptimal/timeout component '+expected)
 if c.get('schema')!='terrain-lp-component-1' or c.get('partitionVersion')!=1 or c.get('inputSHA256')!=H or c.get('componentId')!=expected or c.get('mode')!='inner' or c.get('stage')!='gradient' or c.get('facets')!=16 or c.get('fullRowCount')!=679034:raise StopDiagnostic('Component source/model/header mismatch')
 if v.get('componentId')!=expected or v.get('mode')!='inner' or v.get('stage')!='gradient' or v.get('completeModelVerified')is not False:raise StopDiagnostic('Component verifier identity mismatch')
 if not finite(v,['dualityGap','gradientVariable','maxEuclideanGradient','maxSag','maxAdjustment','maxProfileCorrection','maxRowViolation','conservativeDualBound']):raise StopDiagnostic('Nonfinite/malformed component verifier')
 if not v.get('primalPassed')or not v.get('dualPassed')or not -1e-7<=v['dualityGap']<=1e-6 or v['gradientVariable']<0 or v['maxEuclideanGradient']>v['gradientVariable']+1e-8 or v['maxSag']>.5+1e-7 or v['maxAdjustment']>.75+1e-8 or v['maxProfileCorrection']>1e-8 or v['maxRowViolation']>1e-7:raise StopDiagnostic('Component independent verification rejected '+expected)
def validate_full(v):
 if v.get('schema')!='terrain-lp-decomposition-verification-1' or v.get('inputSHA256')!=H or v.get('mode')!='inner' or v.get('stage')!='gradient':raise StopDiagnostic('Full verifier binding failure')
 if not v.get('fullPrimalPassed')or not v.get('fullDualPassed')or not v.get('optimumVerified'):raise StopDiagnostic('Full primal/dual/optimum rejected')
 if not finite(v,['dualityGap','gradientVariable','maxEuclideanGradient','maxSag','maxAdjustment','maxProfileCorrection','conservativeDualBound']):raise StopDiagnostic('Malformed full verifier report')
 if not -1e-7<=v['dualityGap']<=1e-6 or v['maxEuclideanGradient']>v['gradientVariable']+1e-8 or v['maxSag']>.5+1e-7 or v['maxAdjustment']>.75+1e-8 or v['maxProfileCorrection']>1e-8:raise StopDiagnostic('Full source residual rejection')

def sequence(engine):
 # No callback is invoked after the first failed status/verification/guard.
 saved,v=engine.saved();validate_component(saved,v,'-32,608');certificates=[saved]
 for index,meta in enumerate(COMPONENTS):
  if engine.remaining()<START_RESERVE:raise StopDiagnostic('Insufficient total time including reserved full verification')
  certificate,verification=engine.component(index,meta);validate_component(certificate,verification,meta[0]);certificates.append(certificate)
 if len({c['componentId']for c in certificates})!=7:raise StopDiagnostic('Incomplete membership; assembly blocked')
 if engine.remaining()<FULL_RESERVE:raise StopDiagnostic('Full verification time reserve exhausted')
 result=engine.assemble(certificates);validate_full(result);return result

def available():return next(int(s.split()[1])*1024 for s in Path('/proc/meminfo').read_text().splitlines()if s.startswith('MemAvailable:'))
class Engine:
 def __init__(self):
  self.started=time.monotonic();self.deadline=self.started+174;self.active=None
  self.env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1','PYTHONDONTWRITEBYTECODE':'1'}
  self.report={'status':'Plan B running','pin':authenticate(),'phases':[],'certificates':[],'rssGuard':RSS,'availableGuard':AVAILABLE,'outputGuard':OUTPUT,'externalDeadlineSeconds':180,'internalDeadlineSeconds':174,'fullVerificationReserveSeconds':FULL_RESERVE,'emittedCells':0,'fieldAdopted':False}
  self.report['availableBefore']=available();self.report['dfBefore']=subprocess.check_output(['df','-h','/'],text=True)
  self.pin_by_file={T/'syntagma-e4b-result.json':INNER}
 def remaining(self):return self.deadline-time.monotonic()
 def output_bytes(self):return sum(p.stat().st_size for p in T.glob('inner-batch-*')if p.is_file())
 def save(self):(T/'inner-batch-report.json').write_text(json.dumps(self.report,indent=2)+'\n')
 def stop(self):
  if self.active is not None and self.active.poll()is None:
   self.active.terminate()
   try:self.active.wait(timeout=2)
   except subprocess.TimeoutExpired:self.active.kill();self.active.wait()
 def interrupted(self,sig,frame):self.stop();raise StopDiagnostic('External total deadline/interrupt')
 def run(self,name,command,seconds):
  if available()<AVAILABLE:raise StopDiagnostic('Available-memory guard before '+name)
  phase={'name':name,'command':list(map(str,command)),'rssPeak':0,'minimumAvailable':available(),'maximumThreads':0,'startSeconds':time.monotonic()-self.started};log=T/f'inner-batch-{name}.log'
  with log.open('w')as out:
   self.active=subprocess.Popen(command,stdout=out,stderr=subprocess.STDOUT,env=self.env);phase['ownedPID']=self.active.pid;self.report['phases'].append(phase);self.save()
   print(json.dumps({'BEGIN':name,'ownedPID':self.active.pid}),flush=True);deadline=min(self.deadline,time.monotonic()+seconds)
   try:
    while self.active.poll()is None:
     mem=available();phase['minimumAvailable']=min(phase['minimumAvailable'],mem)
     try:
      lines=(Path('/proc')/str(self.active.pid)/'status').read_text().splitlines();rss=next((int(s.split()[1])*1024 for s in lines if s.startswith('VmRSS:')),0);threads=next((int(s.split()[1])for s in lines if s.startswith('Threads:')),0)
     except FileNotFoundError:rss=threads=0
     phase['rssPeak']=max(phase['rssPeak'],rss);phase['maximumThreads']=max(phase['maximumThreads'],threads)
     if rss>RSS or mem<AVAILABLE or self.output_bytes()>OUTPUT:raise StopDiagnostic('RSS/available/output guard '+name)
     if time.monotonic()>=deadline:raise StopDiagnostic('Phase/total deadline '+name)
     time.sleep(.1)
   except BaseException:self.stop();raise
   phase['exitCode']=self.active.returncode;phase['endSeconds']=time.monotonic()-self.started;self.active=None;self.save()
  if phase['exitCode']!=0:raise StopDiagnostic('Nonzero exit '+name)
 def verify(self,path,name):
  before=sha(path);self.run(name,verifier_command(path),12);raw=(T/f'inner-batch-{name}.log').read_text();report=json.loads(raw)
  if sha(path)!=before:raise StopDiagnostic('Certificate mutated during verification')
  return report
 def saved(self):
  path=T/'syntagma-e4b-result.json'
  if sha(path)!=INNER:raise StopDiagnostic('Historical certificate changed')
  c=json.loads(path.read_text());v=self.verify(path,'historical-verify');self.report['historicalVerification']=v;self.save();return c,v
 def component(self,index,meta):
  name=f'component-{index}';path=T/f'inner-batch-component-{index}.json';self.run(name,solver_command(index,meta[0]),27)
  c=json.loads(path.read_text())
  if c.get('solverStatus')!=0:raise StopDiagnostic('First nonoptimal/timeout '+meta[0])
  v=self.verify(path,name+'-verify');self.report['certificates'].append({'componentId':meta[0],'sha256':sha(path),'forecastBytes':meta[4],'solver':{k:x for k,x in c.items()if k not in('values','dual','globalVariables')},'verification':v});self.save();return c,v
 def assemble(self,certificates):
  bundle={'schema':'terrain-lp-decomposition-1','inputSHA256':H,'mode':'inner','stage':'gradient','facets':16,'components':certificates};path=T/'inner-batch-bundle.json';path.write_text(json.dumps(bundle)+'\n');self.report['bundleSHA256']=sha(path)
  self.run('full-verify',verifier_command(path),42);v=json.loads((T/'inner-batch-full-verify.log').read_text());self.report['fullVerification']={k:x for k,x in v.items()if k!='fullCertificate'};self.report['fullCertificateSHA256']=hashlib.sha256(json.dumps(v['fullCertificate']).encode()).hexdigest();self.save();return v

def plan():return {'status':'SOURCE/METADATA ONLY; no grant, matrix or solve','pin':authenticate(),'supervisedCommand':['timeout','--signal=TERM','--kill-after=2s','180s','python3',str(T/'plan-b-controller.py'),'--run'],'controls':{'totalExternalSeconds':180,'totalInternalSeconds':174,'eachSolverSeconds':20,'eachSolverPhaseSeconds':27,'componentVerificationSeconds':12,'fullVerificationReserveSeconds':45,'nextComponentMinimumRemaining':START_RESERVE,'rssBytes':RSS,'minimumAvailableBytes':AVAILABLE,'outputBytes':OUTPUT,'solverThreads':1},'historicalVerification':verifier_command(T/'syntagma-e4b-result.json'),'remaining':[{'id':c[0],'nodes':c[1],'rows':c[2],'nonzeros':c[3],'forecastBytes':c[4],'command':solver_command(k,c[0])}for k,c in enumerate(COMPONENTS)],'completeOnlyVerifier':verifier_command(T/'inner-batch-bundle.json'),'emittedCells':0}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');a=parser.parse_args()
 if not a.run:print(json.dumps(plan(),indent=2));return
 engine=None;success=False
 try:
  engine=Engine();signal.signal(signal.SIGTERM,engine.interrupted);signal.signal(signal.SIGINT,engine.interrupted)
  if available()<AVAILABLE:raise StopDiagnostic('Immediate available-memory guard')
  sequence(engine);engine.report['status']='Complete INNER source LP independently verified; no geography/physical/field adoption';success=True
 except BaseException as error:
  if engine:engine.report['status']='STOPPED fail closed; no complete accepted field';engine.report['error']=str(error)
  else:raise
 finally:
  if engine:engine.stop();engine.report['seconds']=time.monotonic()-engine.started;engine.report['availableAfter']=available();engine.report['dfAfter']=subprocess.check_output(['df','-h','/'],text=True);engine.report['outputBytes']=engine.output_bytes();engine.save();print(json.dumps(engine.report),flush=True)
 if not success:raise SystemExit(1)
if __name__=='__main__':main()
