import subprocess,time,os,json
from pathlib import Path
T=Path('/tmp/athens-terrain.uKVC');start=time.monotonic();env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1','PYTHONDONTWRITEBYTECODE':'1'}
with (T/'crossover-tiny.log').open('w')as f:
 p=subprocess.Popen([str(T/'scipy-venv/bin/python'),str(T/'crossover-tiny.py')],stdout=f,stderr=subprocess.STDOUT,env=env);(T/'crossover-tiny.pid').write_text(str(p.pid));peak=0
 while p.poll()is None:
  try:rss=next(int(x.split()[1])*1024 for x in Path('/proc',str(p.pid),'status').read_text().splitlines()if x.startswith('VmRSS:'));peak=max(peak,rss)
  except FileNotFoundError:pass
  if peak>512*1024**2 or time.monotonic()-start>9:
   p.terminate();p.wait(timeout=.5);break
  time.sleep(.02)
 (T/'crossover-tiny-supervisor.json').write_text(json.dumps({'ownedPID':p.pid,'exitCode':p.returncode,'rssPeak':peak,'seconds':time.monotonic()-start}));print('FULLEND',p.returncode,peak,time.monotonic()-start)
