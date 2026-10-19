import sys,json,hashlib,os
sys.path.insert(0,'/home/dev/data/athens-world-cache/w4/app/tools/world-gen')
os.chdir('/home/dev/data/athens-world-cache/w4/app/tools/world-gen')
from pathlib import Path
import areas
from tiles import bake
from ingest import encode
area=areas.load(sys.argv[1]);extent=areas.extent(area['cells']);c=Path('/home/dev/data/athens-world-cache')
paths={k:c/v for k,v in area['sources'].items()};dems=[c/'attica-n37-e023.tif',c/'attica-n38-e023.tif']
plan=json.loads((areas.AREAS/f'{sys.argv[1]}.structures.json').read_text())
out=open(sys.argv[2],'w')
for v in sys.argv[3:]:
    cell=tuple(map(int,v.split(',')))
    tile,audit=bake(paths['profiles'],paths['source'],paths['graph'],paths['turns'],cell,dems,area['world'],'dbg',True,paths['vegetation'],paths['osm'],paths['sections'],extent,plan)
    out.write(encode(tile)+'\n');print(cell,audit['triangles'],file=sys.stderr)
