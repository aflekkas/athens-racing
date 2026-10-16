from pathlib import Path
import sqlite3,json,collections
from shapely import from_wkb
c=Path('/tmp/athens-world-cache');db=sqlite3.connect(f'file:{c}/source.sqlite?mode=ro',uri=True);counts=collections.Counter();examples=[]
for identifier,wkb,refs in db.execute("SELECT id,geometry,refs FROM features WHERE kind='road'"):
 refs=json.loads(refs);points=list(from_wkb(wkb).coords)
 for i in range(1,len(refs)):
  if refs[i]==refs[i-1]:counts['sameRefRepeat']+=1
  elif points[i]==points[i-1]:
   counts['distinctRefsCoincident']+=1
   uses=[db.execute('SELECT uses FROM node_use WHERE id=?',(n,)).fetchone()[0] for n in refs[i-1:i+1]]
   if max(uses)>1:counts['sharedCoincident']+=1
   examples.append(dict(way=identifier,refs=refs[i-1:i+1],uses=uses))
result=dict(purpose='Source topology audit: distinct coincident nodes need explicit handling before public graph activation.',counts=dict(counts),examples=examples,releaseReady=False)
Path('/tmp/athens-world-generator/.scratch/athens-world/coincident-nodes-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='examples'}))
