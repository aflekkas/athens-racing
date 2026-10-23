def run_controls(M):
 sample=M['sample_owned_child'];Guard=M['GuardFailure'];stop=M['stop_owned_child']
 class Fake:
  pid=123
  def __init__(self,codes):self.codes=iter(codes);self.calls=[]
  def poll(self):self.calls.append('poll');return next(self.codes)
  def terminate(self):self.calls.append('terminate')
  def kill(self):self.calls.append('kill')
  def wait(self,timeout):self.calls.append(('wait',timeout))
 def raises(fn):
  try:fn()
  except Guard:return
  raise AssertionError('missing guard failure')
 assert sample(Fake([None]),lambda pid:'VmRSS:\t123 kB\n')['rss']==123*1024
 assert sample(Fake([0]),lambda pid:(_ for _ in()).throw(AssertionError()))['state']=='exited'
 assert sample(Fake([None,1]),lambda pid:'State: Z (zombie)\n')['exitCode']==1
 assert sample(Fake([None,0]),lambda pid:(_ for _ in()).throw(FileNotFoundError()))['state']=='exited'
 raises(lambda:sample(Fake([None,None]),lambda pid:'State: R\n'))
 raises(lambda:sample(Fake([None]),lambda pid:'VmRSS: bad kB\n'))
 raises(lambda:sample(Fake([None]),lambda pid:'VmRSS: 10 MB\n'))
 f=Fake([0]);stop(f,TimeoutError);assert f.calls==['poll']
 f=Fake([None]);stop(f,TimeoutError);assert f.calls==['poll','terminate',('wait',.25)]
 class Escalate(Fake):
  def wait(self,timeout):
   self.calls.append(('wait',timeout))
   if 'kill'not in self.calls:raise TimeoutError()
 f=Escalate([None]);stop(f,TimeoutError);assert f.calls==['poll','terminate',('wait',.25),'kill',('wait',.25)]
 print('10/10 pure fake supervisor tests PASS; no subprocess or solver launched')

if __name__=='__main__':raise SystemExit('Use authenticated supervisor --fake-controls; no unverified dependency execution')
