"""Pure proposed controls. No process launch, SciPy import or signal on import."""
class GuardFailure(RuntimeError):pass

def sample_owned_child(child,read_status):
 """Caller supplies its recorded Popen handle and status reader; never discovers PID."""
 code=child.poll()
 if code is not None:return {'state':'exited','exitCode':code,'rss':None}
 try:text=read_status(child.pid)
 except FileNotFoundError:text=''
 fields={line.split(':',1)[0]:line.split(':',1)[1].strip()for line in text.splitlines()if ':'in line}
 if 'VmRSS' not in fields:
  code=child.poll() # reap a just-exited/zombie child using its own handle
  if code is not None:return {'state':'exited','exitCode':code,'rss':None}
  raise GuardFailure('Owned live child RSS unavailable; stop diagnostic, never assume zero')
 try:
  value,unit=fields['VmRSS'].split();rss=int(value)*1024
  if unit!='kB' or rss<0:raise ValueError()
 except (ValueError,TypeError):raise GuardFailure('Malformed owned child RSS')
 return {'state':'running','exitCode':None,'rss':rss}

def stop_owned_child(child,timeout_type):
 if child.poll()is not None:return
 child.terminate()
 try:child.wait(timeout=.25)
 except timeout_type:child.kill();child.wait(timeout=.25)
