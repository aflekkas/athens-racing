#!/usr/bin/env python3
"""Reduce authenticated OSM vegetation provenance for scenery-only cell updates.

Geometry is projected source geometry, not a claim of surveyed tree positions.
No heights, collision records, or physics data are produced here.
"""
import argparse,hashlib,json,sqlite3
from pathlib import Path
from shapely import wkb
from shapely.geometry import mapping
from model import PROJECTION
from ingest import sha,encode


def source_exclusions(source):
    """Conservative explicit paving, structures and water; never residential style."""
    import osmium
    from shapely.geometry import shape,LineString
    from shapely.ops import transform
    from model import project
    out=[];errors={};factory=osmium.geom.GeoJSONFactory()
    def append(key,g,tags):
        if not g.is_empty and g.is_valid:out.append({'source':key,'geometry':mapping(g),'tags':tags})
    class Handler(osmium.SimpleHandler):
        def way(self,way):
            tags=dict(way.tags)
            if tags.get('highway') not in ('footway','pedestrian','steps','cycleway','path'):return
            try:
                width=min(20,max(1,float(tags.get('width','2'))))
            except ValueError:width=2
            try:append('osm:way:'+str(way.id),LineString([project(n.lon,n.lat) for n in way.nodes]).buffer(width/2),tags)
            except (osmium.InvalidLocationError,ValueError):errors['invalidPath']=errors.get('invalidPath',0)+1
        def area(self,area):
            tags=dict(area.tags)
            if not (tags.get('building') or tags.get('natural')=='water' or tags.get('leisure') in ('swimming_pool','pitch') or tags.get('amenity')=='parking' or tags.get('surface') in ('asphalt','concrete','paved','paving_stones','cobblestone','sett')):return
            try:append('osm:'+('way:' if area.from_way() else 'relation:')+str(area.orig_id()),transform(lambda x,y,z=None:project(x,y),shape(json.loads(factory.create_multipolygon(area)))),tags)
            except (RuntimeError,ValueError):errors['invalidExclusion']=errors.get('invalidExclusion',0)+1
    Handler().apply_file(str(source),locations=True)
    return sorted(out,key=lambda r:r['source']),errors


def reduce_scenery(cache,source_record,osm_source=None):
    source=json.loads(Path(source_record).read_text())
    if osm_source is not None and sha(Path(osm_source))!=source['sha256']:raise ValueError('OSM source integrity failure')
    exclusions,exclusion_errors=source_exclusions(osm_source) if osm_source is not None else ([],{})
    db=sqlite3.connect(f'file:{Path(cache)}?mode=ro',uri=True)
    try:
        metadata=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0])
        if metadata['inputs']['pbfSha256']!=source['sha256']:raise ValueError('Scenery source/cache hash mismatch')
        if metadata['inputs']['projection']!=PROJECTION:raise ValueError('Scenery projection mismatch')
        if source.get('missingWayNodes') or not source.get('wholeWays'):raise ValueError('Scenery requires complete way nodes')
        if Path(cache).with_suffix('.sha256').read_text().strip()!=sha(Path(cache)):raise ValueError('Scenery cache integrity failure')
        areas=[{'source':identifier,'geometry':mapping(wkb.loads(blob)),'tags':json.loads(tags)}
               for identifier,blob,tags in db.execute('SELECT id,geometry,tags FROM areas ORDER BY id')]
        points=[{'id':identifier,'source':parent,'inference':{'tree':'mapped-tree-node','tree_row':'sampled-tree-row','park_candidate':'sampled-green-area'}[kind],
                 'kind':{'tree':0,'tree_row':1,'park_candidate':2}[kind],'x':x,'z':z,'seed':seed,'tags':json.loads(tags)}
                for identifier,parent,kind,x,z,seed,tags in db.execute("SELECT id,source,kind,x,z,seed,tags FROM points ORDER BY CASE kind WHEN 'tree' THEN 0 WHEN 'tree_row' THEN 1 ELSE 2 END,id")]
    finally:db.close()
    return {'version':1,'projection':PROJECTION,'attribution':source['attribution'],'source':{
        'sha256':source['sha256'],'bytes':source['bytes'],'bounds':source['bounds'],
        'responses':source['responses'],'missingWayNodes':0,'wholeWays':True,
        'restrictionClosureComplete':source['restrictionClosureComplete'],
        'unresolvedRelationMembers':len(source['unresolvedRelationMembers'])},
        'cacheSha256':sha(Path(cache)),'extractor':metadata['inputs']['codeSha256'],
        'counts':metadata['counts'],'errors':metadata['errors'],'areas':areas,'points':points,
        'exclusions':exclusions,'exclusionErrors':exclusion_errors,'clearanceEvidenceReady':osm_source is not None,
        'placementValidated':False,'limits':'Partial extract: unresolved relations remain. Area and row samples are inferred; private gardens may be unmapped. Requires full crown, paving, ground, building and authored-site clearance before rendering.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache');p.add_argument('source_record');p.add_argument('output');p.add_argument('--osm-source');a=p.parse_args()
    output=Path(a.output)
    if output.exists():raise ValueError('Refusing to overwrite existing scenery reduction')
    data=encode(reduce_scenery(a.cache,a.source_record,a.osm_source))+'\n';output.write_text(data)
    print(encode({'sha256':hashlib.sha256(data.encode()).hexdigest(),'bytes':len(data.encode())}))
