#!/usr/bin/env python3
"""Fetch primary OSM XML and merge it into Overpass-compatible JSON. No API key.
OSM API bounds are west,south,east,north. Dense quadrants can exceed its limit;
failures are explicit and route.mjs will reject missing/disconnected route nodes.
"""
import gzip,json,pathlib,time,urllib.request,xml.etree.ElementTree as ET
OUT=pathlib.Path(__file__).resolve().parent/'raw/osm.json'
BOXES=[(23.867,38.068,23.935,38.115),(23.85,38.0825,23.92,38.14),(23.92,38.0825,23.99,38.14),(23.92,38.025,23.99,38.0825),(23.885,38.045,23.942,38.083)]
all_elements={};failures=[]
for bbox in BOXES:
 url='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str,bbox))
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'ParaliakiRacing-PenteliMap/1.0'})
  with urllib.request.urlopen(req,timeout=90) as res:root=ET.fromstring(res.read())
 except Exception as exc:
  failures.append({'bbox':bbox,'error':str(exc)});print('FAILED',bbox,exc,flush=True);continue
 for e in root:
  if e.tag not in ['node','way','relation']:continue
  q={'type':e.tag,'id':int(e.get('id'))};tags={t.get('k'):t.get('v') for t in e.findall('tag')}
  if tags:q['tags']=tags
  if e.tag=='node':q.update(lat=float(e.get('lat')),lon=float(e.get('lon')))
  if e.tag=='way':q['nodes']=[int(n.get('ref')) for n in e.findall('nd')]
  if e.tag=='relation':q['members']=[{'type':n.get('type'),'ref':int(n.get('ref')),'role':n.get('role','')} for n in e.findall('member')]
  all_elements[(e.tag,q['id'])]=q
 print('Fetched',bbox,len(all_elements),'elements',flush=True);time.sleep(1)
if not all_elements:raise SystemExit('No OSM data fetched')
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({'version':.6,'generator':'Paraliaki Penteli OSM XML converter','osm3s':{'copyright':'© OpenStreetMap contributors, ODbL','bounding_boxes':BOXES,'failures':failures},'elements':list(all_elements.values())},ensure_ascii=False,separators=(',',':')))
if failures:print('Some scenery coverage missing; inspect failures and route completeness before shipping.')
print(OUT)

with gzip.GzipFile(str(OUT)+'.gz','wb',mtime=0) as f:f.write(OUT.read_bytes())
