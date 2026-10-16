#!/usr/bin/env python3
"""Measure source stages, without mislabelling intermediate bytes as AWT tiles."""
import argparse
import collections
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import sqlite3
import time
from shapely import prepare
from shapely.geometry import LineString, Polygon, Point, shape, box
from shapely.ops import unary_union
from model import PROJECTION, unproject
from ingest import encode, sha


def kilometres(geometry):
    if geometry.is_empty:return 0
    if hasattr(geometry,'geoms'):return sum(kilometres(g) for g in geometry.geoms)
    if geometry.geom_type!='LineString':return 0
    total=0
    for a,b in zip(list(geometry.coords),list(geometry.coords)[1:]):
        lon,lat=unproject(*a);lon2,lat2=unproject(*b)
        p,q=math.radians(lat),math.radians(lat2)
        h=math.sin((q-p)/2)**2+math.cos(p)*math.cos(q)*math.sin(math.radians(lon2-lon)/2)**2
        total+=6371.0088*2*math.asin(min(1,math.sqrt(h)))
    return total


def measure(database,output,stages=None):
    output.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(f'file:{database}?mode=ro',uri=True)
    manifest=json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0]);results={}
    for name,geometry in manifest['masks'].items():
        if stages and name not in stages:continue
        if geometry is None:
            results[name]=dict(status='blocked',reason='No closed mainland coastline mask');continue
        mask=shape(geometry);prepare(mask);start=time.monotonic();counts=collections.Counter();cells=set();roadkm=0;publickm=0;maxtri=0;maxawt=0
        x,z,xx,zz=mask.bounds;file=output/(name+'.ndjson.gz');partial=file.with_suffix(file.suffix+'.partial')
        with partial.open('wb') as raw, gzip.GzipFile(fileobj=raw,mode='wb',filename='',mtime=0,compresslevel=9) as stream:
            rows=db.execute('SELECT o.kind,o.data FROM objects o JOIN spatial s USING(rowid) WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id',(xx,x,zz,z))
            for kind,data in rows:
                value=json.loads(data)
                if kind=='road':
                    feature=LineString(value['points'])
                    # Intersection dissolves repeated traversals: preserve that behavior.
                    clipped=feature if feature.is_simple and mask.covers(feature) else feature.intersection(mask)
                    length=kilometres(clipped)
                    if length<=0:continue
                    roadkm+=length
                    if value['public']:publickm+=length
                    occupancy=clipped
                elif kind=='building':
                    footprint=unary_union([Polygon(p['footprint']) for p in value['parts']])
                    if not mask.covers(Point(value['centroid'])):continue
                    occupancy=footprint;maxtri=max(maxtri,value['triangles']);maxawt=max(maxawt,value['awtTriangles'])
                else:continue
                counts[kind]+=1;stream.write((data+'\n').encode())
                a,b,c,d=occupancy.bounds
                for tx in range(math.floor(a/512),math.floor(c/512)+1):
                    for tz in range(math.floor(b/512),math.floor(d/512)+1):
                        if occupancy.intersects(box(tx*512,tz*512,(tx+1)*512,(tz+1)*512)):cells.add((tx,tz))
        partial.replace(file)
        rejected=sum(1 for rx,rz in db.execute('SELECT x,z FROM rejected WHERE x>=? AND x<=? AND z>=? AND z<=?',(x,xx,z,zz)) if mask.covers(Point(rx,rz)))
        results[name]=dict(status='intermediate-only',rejectedBuildings=rejected,sourceBuildingCount=counts['building']+rejected,roadKm=round(roadkm,3),publicRoadKm=round(publickm,3),buildingCount=counts['building'],
                           roadEdges=counts['road'],occupiedSourceCells=len(cells),intermediateBytesCompressed=file.stat().st_size,
                           intermediateSha256=sha(file),maxBuildingTriangles=maxtri,maxAwtBuildingTriangles=maxawt,
                           generationSeconds=round(time.monotonic()-start,3),tileCount=None,largestTile=None,
                           validation=dict(buildingBudget='pass' if maxtri<=40 and maxawt<=40 else 'fail',seams='not-run',conformance='not-run',contactCoverage='not-run'))
        (output/(name+'.metrics.json')).write_text(json.dumps(results[name],sort_keys=True,indent=2)+'\n')
        print(encode({name:results[name]}),flush=True)
    result=dict(format='athens-source-1',releaseReady=False,projection=PROJECTION,stages=results,
                rejectedBuildings=manifest['rejected'],sourceWarnings=manifest['sourceWarnings'],note='Source coverage/bytes are not playable AWT tile metrics. B is A union basin; C excludes islands using the closed OSM mainland coast.')
    (output/'metrics.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n');return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('database',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--stage',action='append',choices=['a_south','b_basin','c_attica_mainland'])
    args=parser.parse_args();measure(args.database,args.output,args.stage)
