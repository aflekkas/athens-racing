import sys,time,importlib.util,hashlib,struct,json
from pathlib import Path
sys.path.insert(0,'/tmp/athens-world-generator/tools/world-gen')
from elevation import Elevation
spec=importlib.util.spec_from_file_location('before','/tmp/athens-world-cache/elevation-before.py');before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before)
paths=[Path('/tmp/athens-world-cache/attica-n37-e023.tif'),Path('/tmp/athens-world-cache/attica-n38-e023.tif')]
points=[(2000+(i*17.317)%12000,8000+(i*13.717)%12000) for i in range(10000)];out={};values=[]
for name,Class in [('before',before.Elevation),('after',Elevation)]:
 dem=Class(paths);started=time.process_time();heights=[dem.height(x,z) for x,z in points];seconds=time.process_time()-started;dem.close()
 data=b''.join(struct.pack('<d',v) for v in heights);values.append(data);out[name]={'cpuSeconds':seconds,'samples':len(points),'sha256':hashlib.sha256(data).hexdigest()}
assert values[0]==values[1]
out['exactFloat64Equality']=True
Path('/tmp/athens-world-generator/.scratch/athens-world/elevation-cache-benchmark.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
