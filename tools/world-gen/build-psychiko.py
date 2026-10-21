"""Rebuild only Psychiko's affected cells plus the seam halo from the shared source cache.

Outputs NDJSON for the existing AWT packer. No source database copies, network,
publication, or cell files in Git. The caller must audit the reused outer seams.
"""
import argparse,hashlib,json,math,shutil,sys,time
from pathlib import Path
from multiprocessing import Pool
import areas
from tiles import bake
from psychiko import Psychiko
from ingest import sha,encode
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--workers',type=int,default=2);p.add_argument('--cells',help='Semicolon-separated bounded audit subset');args=p.parse_args()
c=args.cache;spec=Path(__file__).parent/'overrides/psychiko.json';override=Psychiko(spec);baseline=json.loads(args.baseline.read_text());a,b,d,e=override.spec['bounds']
# Height influence is zero on the bounds; a complete 512 m seam halo also contains all surveyed-width junction influences.
keys=sorted(k for k in baseline['tiles'] if a-512<=int(k.split(',')[0])*512<=d+512 and b-512<=int(k.split(',')[1])*512<=e+512)
if args.cells:keys=args.cells.split(';')
paths={k:c/v for k,v in areas.load('east')['sources'].items()};dems=[c/'attica-n37-e023.tif',c/'attica-n38-e023.tif'];extent=areas.extent([tuple(map(int,k.split(','))) for k in baseline['tiles']]);plan=json.loads((Path(__file__).parent/'areas/east.structures.json').read_text())
inputs={'baseline':baseline['revision'],'override':sha(spec),'sourceMap':sha(Path(__file__).resolve().parents[2]/'data/maps/psychiko/map.json'),'code':{f.name:sha(f) for f in sorted(Path(__file__).parent.glob('*.py'))},'sources':{k:sha(v) for k,v in paths.items()}}
revision=hashlib.sha256(encode(inputs).encode()).hexdigest();print(encode({'revision':revision,'keys':keys,'inputs':inputs}),file=sys.stderr,flush=True)
def one(key):
 usage=shutil.disk_usage('/')
 if math.ceil(100*usage.used/(usage.used+usage.free))>=83:raise ValueError('Shared disk hard stop at 83%')
 cell=tuple(map(int,key.split(',')));start=time.monotonic()
 tile,audit=bake(paths['profiles'],paths['source'],paths['graph'],paths['turns'],cell,dems,baseline['world'],revision,True,paths['vegetation'],paths['osm'],paths['sections'],extent,plan,paths['details'],paths['street_nodes'],override)
 return encode(tile),encode({'cell':cell,'seconds':time.monotonic()-start,**audit})
if __name__=='__main__':
 with Pool(max(1,min(4,args.workers))) as pool:
  for tile,audit in pool.imap(one,keys,chunksize=1):print(tile,flush=True);print(audit,file=sys.stderr,flush=True)
