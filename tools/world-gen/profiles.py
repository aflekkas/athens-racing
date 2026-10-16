#!/usr/bin/env python3
"""Disk-backed shared road profiles, with explicit grade/clearance constraints.

No layer-derived heights. DEM seeds the solve; physical crossing clearances and
shared OSM nodes constrain it. This is a geometry input, not a conformance pass.
"""
import argparse
import collections
from functools import lru_cache
import hashlib
import heapq
import json
import math
from pathlib import Path
import resource
import sqlite3
import time
import numpy as np
from shapely.geometry import LineString, Point, shape
from elevation import Elevation
from ingest import encode,sha


def solve_constraints(heights,a,b,gaps,minimum,max_iterations=2000,tolerance=.002):
    """Solve difference bounds with balanced upper/lower height envelopes.

    Each grade supplies two directed upper bounds. A clearance supplies one
    negative-cost bound. Queue relaxation supports those negative costs and
    rejects negative cycles. Averaging two feasible envelopes stays feasible;
    unlike local diffusion it does not stall on long steep road chains.
    """
    n=len(heights);grade=~minimum
    src=np.concatenate((a[grade],b[grade],a[minimum])).astype(np.int64)
    dst=np.concatenate((b[grade],a[grade],b[minimum])).astype(np.int64)
    cost=np.concatenate((gaps[grade],gaps[grade],-gaps[minimum]))
    target=np.asarray(heights).copy();relaxations=0
    def envelope(initial,source,destination):
        nonlocal relaxations
        values=initial.copy();order=np.argsort(source,kind='stable')
        neighbours=destination[order];weights=cost[order]
        offsets=np.concatenate(([0],np.cumsum(np.bincount(source,minlength=n))))
        bad=values[source]+cost<values[destination]-1e-10
        queue=[(float(values[i]),int(i)) for i in np.unique(source[bad])];heapq.heapify(queue)
        path_length=np.zeros(n,dtype=np.int64);work=0
        while queue:
            value,u=heapq.heappop(queue)
            if value!=values[u]:continue
            for k in range(int(offsets[u]),int(offsets[u+1])):
                v=int(neighbours[k]);proposed=value+weights[k]
                if proposed>=values[v]-1e-10:continue
                values[v]=proposed;path_length[v]=path_length[u]+1;work+=1;relaxations+=1
                if path_length[v]>=n:return None,'negative-cycle'
                if work>max_iterations*max(1,len(source)):return None,'work-budget'
                heapq.heappush(queue,(float(proposed),v))
        return values,None
    upper,error=envelope(target,src,dst)
    lower=None
    if error is None:lower,error=envelope(-target,dst,src)
    if error is None:heights[:]=(upper-lower)*.5
    maximum=0
    for start in range(0,len(a),65536):
        diff=heights[a[start:start+65536]]-heights[b[start:start+65536]]
        g=gaps[start:start+65536];lower_bound=minimum[start:start+65536]
        violations=np.where(lower_bound,np.maximum(0,g-diff),np.maximum(0,np.abs(diff)-g))
        if len(violations):maximum=max(maximum,float(violations.max()))
    return dict(algorithm='difference-envelopes-1',iterations=2,relaxations=relaxations,
                maxViolation=maximum,pass_=error is None and maximum<=tolerance,error=error,
                maxAdjustment=float(np.max(np.abs(heights-target))) if len(target) else 0)


def build(source,output,stage,dems):
    started=time.monotonic();output=Path(output)
    code=b''.join(Path(__file__).with_name(n).read_bytes() for n in ('profiles.py','elevation.py','model.py','appearance.py'))
    inputs=dict(sourceSha256=sha(source),stage=stage,dem=[dict(name=Path(p).name,sha256=sha(p)) for p in sorted(dems)],codeSha256=hashlib.sha256(code).hexdigest())
    if output.exists():
        if output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Corrupt profile cache')
        with sqlite3.connect(output) as db:record=json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
        if record['inputs']!=inputs:raise ValueError('Profile inputs changed; use a new output')
        return record
    partial=output.with_suffix('.partial.sqlite')
    if partial.exists():raise ValueError('Inspect/remove interrupted profile database')
    source_db=sqlite3.connect(f'file:{source}?mode=ro',uri=True)
    manifest=json.loads(source_db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    if manifest['masks'][stage] is None:raise ValueError('Missing stage land mask')
    mask=shape(manifest['masks'][stage]).buffer(128)
    db=sqlite3.connect(partial);db.executescript('''PRAGMA cache_size=-32768; PRAGMA temp_store=FILE;
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE roads(rowid INTEGER PRIMARY KEY,id TEXT UNIQUE,data TEXT);
      CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);
      CREATE TABLE crossings(a INTEGER,b INTEGER,sa REAL,sb REAL,PRIMARY KEY(a,b,sa,sb));
      CREATE TABLE points(rowid INTEGER PRIMARY KEY,key TEXT UNIQUE,x REAL,z REAL,target REAL,y REAL);
      CREATE TABLE samples(road INTEGER,station REAL,point INTEGER,PRIMARY KEY(road,station));
      CREATE TABLE constraints(a INTEGER,b INTEGER,gap REAL,lower INTEGER);
    ''')
    x,z,xx,zz=mask.bounds
    for (data,) in source_db.execute("SELECT o.data FROM objects o JOIN spatial s USING(rowid) WHERE o.kind='road' AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? ORDER BY o.id",(xx,x,zz,z)):
        road=json.loads(data);line=LineString(road['points'])
        if not mask.intersects(line):continue
        # Complete roads are retained to avoid inventing stage-boundary nodes.
        row=db.execute('INSERT INTO roads(id,data) VALUES(?,?)',(road['id'],data)).lastrowid
        a,b,c,d=line.bounds;db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(row,a,c,b,d))
    db.commit();source_db.close()
    # Actual planar centerline intersections establish vertical constraints.
    # Same-node connections are portals/junctions, not grade-separated crossings.
    for row,data in db.execute('SELECT rowid,data FROM roads ORDER BY rowid'):
        road=json.loads(data)
        if not (road['bridge'] or road['tunnel']):continue
        line=LineString(road['points']);x,z,xx,zz=line.bounds
        for other,otherdata in db.execute('SELECT r.rowid,r.data FROM roads r JOIN spatial s USING(rowid) WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? AND r.rowid!=? ORDER BY r.rowid',(xx,x,zz,z,row)):
            q=json.loads(otherdata)
            if road['layer']==q['layer'] or set(road['nodeRefs'])&set(q['nodeRefs']):continue
            # Ordering comes from OSM layer; elevation magnitude never does.
            top,bottom=(row,other) if road['layer']>q['layer'] else (other,row)
            otherline=LineString(q['points']);cross=line.intersection(otherline)
            points=list(cross.geoms) if hasattr(cross,'geoms') else [cross]
            for p in points:
                if p.is_empty:continue
                if p.geom_type!='Point':raise ValueError('Overlapping layered centerlines need explicit clearance constraints')
                s,t=round(line.project(p),6),round(otherline.project(p),6)
                db.execute('INSERT OR IGNORE INTO crossings VALUES(?,?,?,?)',(top,bottom,s if top==row else t,t if top==row else s))
    db.commit();elevation=Elevation(dems)
    @lru_cache(maxsize=32768)
    def seed(x,z):
        # A modest spatial mean reduces DSM rooftop/vegetation bias, without
        # claiming that a 30 m DSM becomes surveyed road-level elevation.
        return sum(elevation.height(x+dx,z+dz)*weight for dx,dz,weight in ((0,0,4),(-8,0,1),(8,0,1),(0,-8,1),(0,8,1)))/8
    for row,data in db.execute('SELECT rowid,data FROM roads ORDER BY rowid'):
        road=json.loads(data);line=LineString(road['points']);length=line.length
        stations={0.,round(length,6),*(float(s) for s in range(8,math.ceil(length),8))}
        stations.update(s for (s,) in db.execute('SELECT sa FROM crossings WHERE a=? UNION SELECT sb FROM crossings WHERE b=?',(row,row)))
        previous=None
        for station in sorted(stations):
            p=line.interpolate(min(station,length));x,z=round(p.x,3),round(p.y,3)
            key=('n:'+road['fromNode']) if station==0 else ('n:'+road['toNode']) if station==round(length,6) else road['id']+':'+str(station)
            existing=db.execute('SELECT rowid,x,z FROM points WHERE key=?',(key,)).fetchone()
            if existing:
                point=existing[0]
                if math.dist((x,z),existing[1:])>.005:raise ValueError('Shared OSM node position mismatch')
            else:
                y=seed(x,z);point=db.execute('INSERT INTO points(key,x,z,target,y) VALUES(?,?,?,?,?)',(key,x,z,y,y)).lastrowid
            db.execute('INSERT INTO samples VALUES(?,?,?)',(row,station,point))
            if previous:
                oldstation,oldpoint=previous;db.execute('INSERT INTO constraints VALUES(?,?,?,0)',(oldpoint,point,.20*(station-oldstation)))
            previous=(station,point)
        if row%1000==0:db.commit()
    elevation.close();seed.cache_clear()
    for a,b,sa,sb in db.execute('SELECT * FROM crossings ORDER BY a,b,sa,sb'):
        aa=db.execute('SELECT point FROM samples WHERE road=? AND station=?',(a,sa)).fetchone()[0]
        bb=db.execute('SELECT point FROM samples WHERE road=? AND station=?',(b,sb)).fetchone()[0]
        db.execute('INSERT INTO constraints VALUES(?,?,?,1)',(aa,bb,5.0))
    db.commit()
    # Only compact numeric solve vectors are resident, not regional geometry.
    count=db.execute('SELECT count(*) FROM points').fetchone()[0]
    solve_path=output.with_suffix('.heights.bin');constraint_path=output.with_suffix('.constraints.bin')
    values=np.memmap(solve_path,mode='w+',shape=(count+1,),dtype=np.float64)
    for row,y in db.execute('SELECT rowid,y FROM points'):values[row]=y
    n=db.execute('SELECT count(*) FROM constraints').fetchone()[0]
    if not n or count>=2**32:raise ValueError('Empty/oversize profile constraint set')
    constraints=np.memmap(constraint_path,mode='w+',shape=(n,),dtype=[('a','u4'),('b','u4'),('gap','f8'),('lower','?')])
    for i,row in enumerate(db.execute('SELECT a,b,gap,lower FROM constraints ORDER BY rowid')):constraints[i]=tuple(row)
    result=solve_constraints(values,constraints['a'],constraints['b'],constraints['gap'],constraints['lower'])
    db.executemany('UPDATE points SET y=? WHERE rowid=?',((float(y),i) for i,y in enumerate(values) if i))
    del values,constraints
    solve_path.unlink();constraint_path.unlink()
    result['pass']=result.pop('pass_')
    result.update(points=count,roads=db.execute('SELECT count(*) FROM roads').fetchone()[0],crossings=db.execute('SELECT count(*) FROM crossings').fetchone()[0])
    record=dict(inputs=inputs,validation=result,releaseReady=False,remaining=['surface triangulation conformance','deck/rail/bore geometry','full footprint clearance','Riviera join validation'])
    db.execute('INSERT INTO metadata VALUES(?,?)',('manifest',encode(record)));db.commit();db.close()
    if not result['pass']:raise ValueError('Road profile constraints did not converge; partial database retained for diagnosis')
    partial.rename(output);output.with_suffix('.sha256').write_text(sha(output)+'\n')
    output.with_suffix('.metrics.json').write_text(encode(dict(generationSeconds=time.monotonic()-started,peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024))+'\n')
    print(encode(record));return record


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--stage',default='a_south');p.add_argument('--dem',nargs='+',type=Path,required=True)
    a=p.parse_args();build(a.source,a.output,a.stage,a.dem)
