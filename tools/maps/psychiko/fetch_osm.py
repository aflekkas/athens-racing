#!/usr/bin/env python3
"""Freeze Psychiko's primary OSM roads, buildings, vegetation and street furniture.
Try Overpass first; the OSM API map extract is the documented fallback.

--relations writes raw/relations.json: the multipolygon relations (buildings with courtyards, parks,
stadium/track, woods, land use) whose member ways the frozen raw/osm.json.gz already holds. The way/node
snapshot never requested relations. --relations-from <map.json.gz> reuses an already fetched OSM API
map extract (the 2026-10-19 coverage audit fallback) instead of downloading.
"""
import argparse, gzip, json, pathlib, sys, urllib.request, xml.etree.ElementTree as ET
OUT = pathlib.Path(__file__).resolve().parent / 'raw/osm.json.gz'
S,W,N,E = 37.992,23.758,38.027,23.799
query = f'[out:json][timeout:90];(way({S},{W},{N},{E});node({S},{W},{N},{E}););(._;>;);out body;'
headers = {'User-Agent':'AthensStreetRacers-Psychiko/1.0'}
KINDS = ('building', 'leisure', 'landuse', 'natural')
def relations(source=None):
    if source:
        payload, provenance = json.loads(gzip.open(source).read()), {'source': 'OSM API 0.6 map extract (four bbox quadrants), coverage audit 2026-10-19', 'file': pathlib.Path(source).name}
    else:
        q = f'[out:json][timeout:90];rel({S},{W},{N},{E})[type=multipolygon];out body;'
        req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=q.encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=110) as res: payload = json.loads(res.read())
        provenance = {'source': 'https://overpass-api.de/api/interpreter', 'query': q}
    ways = {e['id'] for e in json.loads(gzip.open(OUT).read())['elements'] if e['type'] == 'way'}
    keep = []
    for e in payload['elements']:
        t = e.get('tags', {})
        if e['type'] != 'relation' or t.get('type') != 'multipolygon' or not any(k in t for k in KINDS): continue
        members = [{'ref': m['ref'], 'role': m.get('role', '')} for m in e['members'] if m['type'] == 'way']
        # Keep relations whose outer members are all in the frozen snapshot; assembly drops rings it cannot close.
        if any(m['ref'] in ways for m in members if m['role'] != 'inner'):
            keep.append({'type': 'relation', 'id': e['id'], 'tags': t, 'members': members})
    keep.sort(key=lambda e: e['id'])
    out = OUT.parent / 'relations.json'
    out.write_text(json.dumps({**provenance, 'bbox': [S, W, N, E], 'copyright': '© OpenStreetMap contributors, ODbL', 'elements': keep}, ensure_ascii=False, separators=(',', ':')))
    print(out, len(keep), flush=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--relations', action='store_true')
parser.add_argument('--relations-from')
args = parser.parse_args()
if args.relations or args.relations_from:
    relations(args.relations_from); sys.exit(0)
try:
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=query.encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=110) as res: payload=json.loads(res.read())
    payload['source_url']='https://overpass-api.de/api/interpreter'
except Exception as exc:
    print('Overpass unavailable:',exc,flush=True)
    url=f'https://api.openstreetmap.org/api/0.6/map?bbox={W},{S},{E},{N}'
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=90) as res: root=ET.fromstring(res.read())
    elements=[]
    for e in root:
        if e.tag not in ('node','way','relation'): continue
        q={'type':e.tag,'id':int(e.get('id'))}
        tags={t.get('k'):t.get('v') for t in e.findall('tag')}
        if tags:q['tags']=tags
        if e.tag=='node':q.update(lat=float(e.get('lat')),lon=float(e.get('lon')))
        if e.tag=='way':q['nodes']=[int(n.get('ref')) for n in e.findall('nd')]
        if e.tag=='relation':q['members']=[{'type':n.get('type'),'ref':int(n.get('ref')),'role':n.get('role','')} for n in e.findall('member')]
        elements.append(q)
    payload={'version':.6,'elements':elements,'source_url':url,'overpass_failure':str(exc)}
payload['bbox']=[S,W,N,E]
payload['fetched']='2026-10-14'
payload['copyright']='© OpenStreetMap contributors, ODbL'
OUT.parent.mkdir(parents=True,exist_ok=True)
with gzip.GzipFile(str(OUT),'wb',mtime=0) as f:f.write(json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode())
print(OUT,len(payload['elements']),flush=True)
