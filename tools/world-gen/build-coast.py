"""Stream the approved coastal extent to the AWT packer, one cell at a time.

No spool or source copies. The supervisor must stop this process if packing
fails. Every bake rechecks shared disk; 83% is the owner's hard stop.
"""
import argparse,hashlib,json,math,shutil,subprocess,sys,time
from pathlib import Path
from tiles import bake
from ingest import sha,encode
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);args=p.parse_args();c=args.cache
paths={k:c/v for k,v in dict(profiles='profiles-a.sqlite',source='clean.sqlite',graph='graph-a.sqlite',turns='turns-a.sqlite',vegetation='vegetation.sqlite',osm='source.sqlite').items()};dems=[c/'attica-n37-e023.tif',c/'attica-n38-e023.tif']
inputs={k:sha(v) for k,v in paths.items()};inputs['dem']=[sha(v) for v in dems];inputs['coastal']=True;inputs['code']={f.name:sha(f) for f in sorted([*Path(__file__).parent.glob('*.py'),Path(__file__).parent/'coast-exclusions.json'])};revision=hashlib.sha256(encode(inputs).encode()).hexdigest()
print(encode(dict(inputs=inputs,revision=revision)),file=sys.stderr,flush=True)
first=[(4,25),(5,25),(8,36),(6,29),(7,29),(7,30)];cells=first+[(x,z) for z in range(25,37) for x in range(10) if (x,z) not in first]+[(x,24) for x in range(2,8)]+[(10,31)]
for cell in cells:
 subprocess.run(['df','-h','/'],stdout=sys.stderr,check=True)
 usage=shutil.disk_usage('/');percent=math.ceil(100*usage.used/(usage.used+usage.free))
 if percent>=83:raise SystemExit('Shared disk hard stop: '+str(percent)+'%')
 start=time.monotonic();tile,audit=bake(paths['profiles'],paths['source'],paths['graph'],paths['turns'],cell,dems,'athens-coast-development',revision,True,paths['vegetation'],paths['osm'])
 print(encode(tile),flush=True);print(encode(dict(cell=cell,seconds=time.monotonic()-start,**audit)),file=sys.stderr,flush=True)
