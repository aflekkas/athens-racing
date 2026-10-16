#!/usr/bin/env python3
"""Recover isolated tagged trees omitted by a way-complete geometry extract.

Streams the pinned source without any node-location index. Output is only
Attica tree nodes, with a distinct source hash. Delete the full source after
successful completion; do not relabel this supplement as a complete OSM map.
"""
import argparse,json,time
from pathlib import Path
import osmium
from ingest import sha
from fetch import OSM

def extract(source,output):
    source,output=Path(source),Path(output);digest=sha(source)
    if digest!=OSM[2]:raise ValueError('Expected pinned Greece source hash')
    if output.exists():raise ValueError('Supplement already exists; verify its source record')
    partial=output.with_name(output.stem+'.partial.osm.pbf')
    if partial.exists():raise ValueError('Inspect partial supplement before retrying')
    started=time.monotonic();count=0;writer=osmium.SimpleWriter(str(partial))
    class Nodes(osmium.SimpleHandler):
        def node(self,node):
            nonlocal count
            if node.tags.get('natural')=='tree' and 22.8<=node.lon<=24.7 and 37.4<=node.lat<=38.6:
                writer.add_node(node);count+=1
    try:Nodes().apply_file(str(source))
    finally:writer.close()
    partial.replace(output)
    record={'sourceUrl':OSM[1],'sourceSha256':digest,'sha256':sha(output),'bytes':output.stat().st_size,'treeNodes':count,'bounds':[22.8,37.4,24.7,38.6],'seconds':time.monotonic()-started}
    output.with_suffix('.source.json').write_text(json.dumps(record,indent=2)+'\n');return record

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('output');a=p.parse_args();print(json.dumps(extract(a.source,a.output)))
