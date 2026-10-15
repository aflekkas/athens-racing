#!/usr/bin/env python3
"""Freeze Psychiko's primary OSM roads, buildings, vegetation and street furniture.
Try Overpass first; the OSM API map extract is the documented fallback.
"""
import gzip, json, pathlib, urllib.request, xml.etree.ElementTree as ET
OUT = pathlib.Path(__file__).resolve().parent / 'raw/osm.json.gz'
S,W,N,E = 37.992,23.758,38.027,23.799
query = f'[out:json][timeout:90];(way({S},{W},{N},{E});node({S},{W},{N},{E}););(._;>;);out body;'
headers = {'User-Agent':'AthensStreetRacers-Psychiko/1.0'}
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
