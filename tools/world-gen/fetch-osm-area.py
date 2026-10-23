#!/usr/bin/env python3
"""Fetch a bounded official OSM map, subdividing only the API's node-limit error.

Whole way node order is retained. Conflicting versions fail closed. Missing
restriction member ways are fetched whole; all other unresolved members are
explicitly reported, never interpreted as an empty relation.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

API = 'https://api.openstreetmap.org/api/0.6/'
KINDS = ('node', 'way', 'relation')


def merge(objects, root):
    for element in root:
        if element.tag not in KINDS:
            continue
        key = (element.tag, element.attrib['id'])
        prior = objects.get(key)
        # Element ordering and tags are semantic data; do not rewrite nd/member order.
        if prior is not None and ET.tostring(prior) != ET.tostring(element):
            raise ValueError('OSM snapshot conflict: ' + ':'.join(key))
        objects[key] = element


def unresolved(objects):
    missing_nodes = []
    missing_members = []
    for (kind, identifier), element in objects.items():
        if kind == 'way':
            missing_nodes.extend(dict(way=identifier, node=n.attrib['ref']) for n in element.findall('nd') if ('node', n.attrib['ref']) not in objects)
        if kind == 'relation':
            restriction = any(t.attrib == {'k': 'type', 'v': 'restriction'} for t in element.findall('tag'))
            missing_members.extend(dict(relation=identifier, restriction=restriction, **m.attrib) for m in element.findall('member') if (m.attrib['type'], m.attrib['ref']) not in objects)
    return missing_nodes, missing_members


def fetch_area(bounds, output, request=None):
    output = Path(output)
    if output.exists() or output.with_suffix('.source.json').exists():
        raise ValueError('Never overwrite an existing source snapshot')
    output.parent.mkdir(parents=True, exist_ok=True)
    objects, responses, failures = {}, [], []
    def read(endpoint):
        url = API + endpoint
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            if request:
                body = request(url)
            else:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'AthensRacing-world-gen/1'}), timeout=90) as response:
                    body = response.read()
        except urllib.error.HTTPError as error:
            text = error.read().decode(errors='replace')
            failures.append(dict(url=url, timeUTC=started, status=error.code, body=text))
            if error.code == 400 and 'too many nodes' in text:
                return False
            raise
        responses.append(dict(url=url, timeUTC=started, status=200, bytes=len(body), sha256=hashlib.sha256(body).hexdigest()))
        merge(objects, ET.fromstring(body))
        return True
    def tile(box, depth=0):
        if read('map?bbox=' + ','.join(f'{v:.7f}' for v in box)):
            return
        if depth >= 5:
            raise ValueError('OSM node limit after bounded subdivision')
        w, s, e, n = box
        if (e-w)*.79 >= n-s:
            mid = (w+e)/2
            tile([w,s,mid,n],depth+1); tile([mid,s,e,n],depth+1)
        else:
            mid = (s+n)/2
            tile([w,s,e,mid],depth+1); tile([w,mid,e,n],depth+1)
    try:
        tile(bounds)
        # A map response includes complete ways, but restriction members may
        # extend outside the box. Close those ways without broad relation fetches.
        missing_nodes, members = unresolved(objects)
        ways = sorted({m['ref'] for m in members if m['restriction'] and m['type']=='way'}, key=int)
        if len(ways)>64:
            raise ValueError('Restriction way closure exceeds bounded 64-way budget')
        for identifier in ways:
            read('way/'+identifier+'/full')
        missing_nodes, members = unresolved(objects)
        root=ET.Element('osm',version='0.6',generator='AthensRacing bounded official-source assembly',copyright='OpenStreetMap and contributors',attribution='https://www.openstreetmap.org/copyright',license='https://opendatacommons.org/licenses/odbl/1-0/')
        for key in sorted(objects,key=lambda k:(KINDS.index(k[0]),int(k[1]))):root.append(objects[key])
        body=ET.tostring(root,encoding='utf-8',xml_declaration=True)
        output.write_bytes(body)
        record=dict(bounds=bounds,algorithm='official-map-subdivide-node-limit-v1',attribution='© OpenStreetMap contributors (ODbL 1.0)',sha256=hashlib.sha256(body).hexdigest(),bytes=len(body),responses=responses,failedRequests=failures,counts={kind:sum(k[0]==kind for k in objects) for kind in KINDS},missingWayNodes=missing_nodes,unresolvedRelationMembers=members,restrictionClosureComplete=not any(m['restriction'] for m in members),wholeWays=True)
        output.with_suffix('.source.json').write_text(json.dumps(record,indent=2)+'\n')
        if missing_nodes or not record['restrictionClosureComplete']:
            raise ValueError('Incomplete road/restriction closure; inspect source report')
        return record
    except Exception as error:
        output.with_suffix('.failure.json').write_text(json.dumps(dict(error=str(error),responses=responses,failedRequests=failures),indent=2)+'\n')
        raise


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);parser.add_argument('--bounds',nargs=4,type=float,required=True)
    args=parser.parse_args();r=fetch_area(args.bounds,args.output)
    print(json.dumps({k:v for k,v in r.items() if k not in ('responses','failedRequests','unresolvedRelationMembers','missingWayNodes')}))
