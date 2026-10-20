"""Extend the existing keyless, HTTP-only municipal survey; imagery stays research-only."""
import importlib.util,json,concurrent.futures as cf
from pathlib import Path
spec=importlib.util.spec_from_file_location('survey','.scratch/psychiko-realism/streetview/fetch.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
s.ROOT=Path('.scratch/psychiko-realism/impl-e/references');s.ROOT.mkdir(exist_ok=True)
for f in ['records','metadata','views']:(s.ROOT/f).mkdir(exist_ok=True)
rows=json.loads(Path('.scratch/psychiko-realism/impl-e/stations-requested.json').read_text());results=[]
with cf.ThreadPoolExecutor(max_workers=8) as pool:
 for r in pool.map(s.fetch,rows):
  results.append(r);print(r['id'],r['status'],r.get('snapDistanceM'),flush=True)
(s.ROOT/'stations.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Finished',len(results),sum(bool(r['views']) for r in results))
