# Existing municipal survey transport; no API key, browser or shipped image inputs.
import importlib.util,json,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('survey','.scratch/psychiko-realism/streetview/fetch.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
s.ROOT=Path('.scratch/psychiko-realism/impl-d/references');s.ROOT.mkdir(exist_ok=True)
for folder in ['records','metadata','views']:(s.ROOT/folder).mkdir(exist_ok=True)
points=[('faros',38.00512,23.77551,214),('plateia-a',38.00786,23.77414,270),('plateia-b',38.01324,23.77196,320),('paraschou',38.01841,23.77176,337),('vyzaniou',38.01938,23.78136,233),('kalari',38.01314,23.77647,119),('elikonos',38.01009,23.77978,121)]
rows=[]
for id,lat,lon,heading in points:
 r=s.fetch(dict(id=id,lat=lat,lon=lon,heading=heading,fovH=90));rows.append(r);print(id,r['status'],r.get('snapDistanceM'),flush=True)
(s.ROOT/'stations.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
