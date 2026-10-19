#!/usr/bin/env python3
"""Tagged street-furniture nodes (signals, signs, lamps, bus stops, benches, kiosks, fountains, monuments) from OSM.

Streams the pinned Attica extract (way-complete: it holds every node that belongs to a way, which is all of the signals and
stop signs) and, if given, a supplement of isolated nodes (the full source, as `vegetation-nodes.py` does for trees). Output is
a small sqlite cache in world metres; the generator reads it per cell and emits instanced props. Data only.
  python street_nodes.py attica.osm.pbf OUT.sqlite [supplement.osm.pbf ...]
"""
import argparse,json,sqlite3,time
from pathlib import Path
import osmium
from model import project
from ingest import sha,encode

BOUNDS=(22.8,37.4,24.7,38.6)
def classify(tags):
    """Kind of furniture a tagged node is, or None. One kind per node, most specific first."""
    h=tags.get('highway')
    if h=='traffic_signals':return 'signals'
    if h=='stop':return 'stop'
    if h=='give_way':return 'give_way'
    if h=='street_lamp':return 'lamp'
    if h=='crossing' and tags.get('crossing') not in ('no','unmarked'):return 'crossing'
    if h=='bus_stop' or (tags.get('public_transport')=='platform' and tags.get('bus')=='yes'):return 'bus_stop'
    if tags.get('barrier')=='bollard':return 'bollard'
    if tags.get('amenity')=='bench' or tags.get('leisure')=='picnic_table':return 'bench'
    if tags.get('shop')=='kiosk' or tags.get('amenity')=='kiosk':return 'kiosk'
    if tags.get('amenity')=='fountain':return 'fountain'
    if tags.get('historic') in ('monument','memorial') or tags.get('tourism')=='artwork' and tags.get('artwork_type')=='statue':return 'monument'
    return None
KEEP=('direction','traffic_signals:direction','shelter','bench','covered','bin','name','crossing','highway','lit','material')

def extract(sources,output):
    sources=[Path(s) for s in sources];output=Path(output);started=time.monotonic()
    if output.exists():raise ValueError('Street-node cache exists; delete it to rebuild')
    tmp=output.with_suffix('.partial.sqlite')
    if tmp.exists():raise ValueError('Inspect incomplete street-node cache before retrying')
    db=sqlite3.connect(tmp);db.executescript('CREATE TABLE nodes(id TEXT PRIMARY KEY,kind TEXT,x REAL,z REAL,tags TEXT); CREATE TABLE metadata(value TEXT);')
    counts={};seen=set()
    class Nodes(osmium.SimpleHandler):
        def node(self,node):
            if not len(node.tags) or not node.location.valid():return
            lon,lat=node.location.lon,node.location.lat
            if not(BOUNDS[0]<=lon<=BOUNDS[2] and BOUNDS[1]<=lat<=BOUNDS[3]):return
            kind=classify(node.tags)
            if not kind or node.id in seen:return
            seen.add(node.id);x,z=project(lon,lat);tags={k:node.tags[k] for k in KEEP if k in node.tags}
            db.execute('INSERT INTO nodes VALUES(?,?,?,?,?)',('n'+str(node.id),kind,round(x,2),round(z,2),encode(tags)));counts[kind]=counts.get(kind,0)+1
    for s in sources:Nodes().apply_file(str(s))
    db.execute('CREATE INDEX nodes_xz ON nodes(x,z)')
    meta=dict(inputs=[dict(path=s.name,sha256=sha(s)) for s in sources],codeSha256=sha(Path(__file__)),counts=counts,bounds=BOUNDS)
    db.execute('INSERT INTO metadata VALUES(?)',(encode(meta),));db.commit();db.close();tmp.replace(output)
    output.with_suffix('.sha256').write_text(sha(output)+'\n');output.with_suffix('.metrics.json').write_text(encode(dict(meta,seconds=time.monotonic()-started,bytes=output.stat().st_size))+'\n');return meta

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('pbf');p.add_argument('output');p.add_argument('supplements',nargs='*');a=p.parse_args();print(encode(extract([a.pbf,*a.supplements],a.output)))
