"""Stream an approved area's cells to the AWT packer, one cell at a time (optionally several workers, order kept).

An area (areas/*.json) is the union of cells baked as ONE world, so every border is shared and checked. No spool or
source copies. The supervisor must stop this process if packing fails. Every bake rechecks shared disk; 83% is the
owner's hard stop.
"""
import argparse,hashlib,json,math,os,shutil,subprocess,sys,time
from multiprocessing import Pool
from pathlib import Path
from tiles import bake
from ingest import sha,encode
import areas
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);p.add_argument('--area',default='coast');p.add_argument('--workers',type=int,default=int(os.environ.get('ATHENS_WORKERS','1')));args=p.parse_args();c=args.cache
area=areas.load(args.area);extent=areas.extent(area['cells'])
PLAN_FILE=areas.AREAS/f'{args.area}.structures.json';plan=json.loads(PLAN_FILE.read_text()) if PLAN_FILE.exists() else None   # decided once for the whole area (plan-structures.py)
paths={k:c/v for k,v in area['sources'].items()};dems=[c/'attica-n37-e023.tif',c/'attica-n38-e023.tif']
inputs={k:sha(v) for k,v in paths.items()};inputs['dem']=[sha(v) for v in dems];inputs['coastal']=True
# The generator code, the exclusion list and every area file in the chain are part of the revision.
inputs['area']=dict(name=area['name'],cells=hashlib.sha256(json.dumps(area['cells']).encode()).hexdigest(),structures=sha(PLAN_FILE) if plan else None)
inputs['code']={f.name:sha(f) for f in sorted([*Path(__file__).parent.glob('*.py'),Path(__file__).parent/'coast-exclusions.json'])};revision=hashlib.sha256(encode(inputs).encode()).hexdigest()
print(encode(dict(inputs=inputs,revision=revision)),file=sys.stderr,flush=True)
cells=area['cells']
if os.environ.get('ATHENS_CELLS'):cells=[tuple(map(int,v.split(','))) for v in os.environ['ATHENS_CELLS'].split(';')]  # development subset; the full bake never sets this

KEEP_GOING=bool(os.environ.get('ATHENS_KEEP_GOING'))

def one(cell):
 try:return generate(cell)
 except Exception as e:
  if not KEEP_GOING:raise
  return None,encode(dict(failedCell=cell,error=(type(e).__name__+': '+str(e))[:500]))

def generate(cell):
 start=time.monotonic();tile,audit=bake(paths['profiles'],paths['source'],paths['graph'],paths['turns'],cell,dems,area['world'],revision,True,paths['vegetation'],paths['osm'],paths['sections'],extent,plan)
 return encode(tile),encode(dict(cell=cell,seconds=time.monotonic()-start,**audit))

def disk_check():
 subprocess.run(['df','-h','/'],stdout=sys.stderr,check=True)
 usage=shutil.disk_usage('/');percent=math.ceil(100*usage.used/(usage.used+usage.free))
 if percent>=83:raise SystemExit('Shared disk hard stop: '+str(percent)+'%')

if __name__=='__main__':
 workers=max(1,args.workers)
 if workers==1:results=map(one,cells)
 else:pool=Pool(workers);results=pool.imap(one,cells,chunksize=1)
 try:
  for cell,(tile,audit) in zip(cells,results):
   disk_check()
   if tile is not None:print(tile,flush=True)
   print(audit,file=sys.stderr,flush=True)
 finally:
  if workers>1:pool.terminate();pool.join()
