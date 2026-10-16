"""Station-preserving directed graph clipping for the offline AWT emitter."""
import math,struct

def f32(v):return struct.unpack('<f',struct.pack('<f',v))[0]

def chunks(points):
    """Partition [x,y,z,station] segments once at all global 512 m grid lines.

    Graph centre lines lying on a boundary belong to the positive-side cell.
    Physical ribbons still clip into both cells separately. No tile-local
    intersection arithmetic or independently rounded portal heights is used.
    """
    result=[]
    for a,b in zip(points,points[1:]):
        cuts={0.,1.}
        for axis in (0,2):
            delta=b[axis]-a[axis]
            if abs(delta)<1e-12:continue
            low,high=sorted((a[axis],b[axis]))
            for grid in range(math.floor(low/512)+1,math.ceil(high/512)):
                t=(grid*512-a[axis])/delta
                if 0<t<1:cuts.add(t)
        cuts=sorted(cuts)
        for start,end in zip(cuts,cuts[1:]):
            center=[a[k]+(b[k]-a[k])*(start+end)/2 for k in (0,2)]
            cell=tuple(math.floor(v/512) for v in center)
            vertices=[]
            for t in (start,end):
                p=[a[k]+(b[k]-a[k])*t for k in range(4)]
                p[0]=round(p[0],3);p[2]=round(p[2],3);p[1]=f32(p[1]);p[3]=round(p[3],6)
                vertices.append(p)
            if result and result[-1]['cell']==cell and result[-1]['points'][-1]==vertices[0]:result[-1]['points'].append(vertices[1])
            else:result.append(dict(cell=cell,points=vertices))
    return result

def portal(road,point,end_station):
    station=point[3]
    if abs(station)<1e-6:return 'osm:node:'+str(road['fromNode'])
    if abs(station-end_station)<1e-6:return 'osm:node:'+str(road['toNode'])
    return f"portal:{road['id']}:{station:.6f}"

def directed(road,points):
    end=points[-1][3];segments=chunks(points)
    for serial,part in enumerate(segments):
        cell=part['cell'];ps=part['points'];a=portal(road,ps[0],end);b=portal(road,ps[-1],end)
        for direction,exists,public,speed in [('f',road['forward'],road['publicForward'],road.get('speedForward') or road.get('speed')),('b',road['backward'],road['publicBackward'],road.get('speedBackward') or road.get('speed'))]:
            if not exists:continue
            flags=int(road['oneway']!=0)|(int(road['bridge'])<<1)|(int(road['tunnel'])<<2)|(int(not public)<<3)
            way,segment=road['id'].split(':')
            yield dict(id=f'osm:way:{way[1:]}:{segment}-{serial}:{direction}:{cell[0]}:{cell[1]}',fromNode=a if direction=='f' else b,toNode=b if direction=='f' else a,cell=cell,points=ps if direction=='f' else list(reversed(ps)),flags=flags,layer=road['layer'],speedKph=round(speed) if speed else 0,surface='surface:'+road['id'])


def build(profiles,output):
    """Stream clipped graph into SQLite; contact/turn validation remains downstream."""
    import hashlib,json,sqlite3,time
    from pathlib import Path
    from ingest import sha,encode
    started=time.monotonic();profiles=Path(profiles);output=Path(output)
    fingerprint={'profileSha256':sha(profiles),'codeSha256':sha(Path(__file__))}
    if output.exists():
        db=sqlite3.connect(f'file:{output}?mode=ro',uri=True)
        manifest=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]);db.close()
        if manifest['inputs']!=fingerprint or output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Graph cache mismatch')
        return manifest
    temporary=output.with_suffix('.partial.sqlite')
    if temporary.exists():raise ValueError('Inspect incomplete graph cache before retrying')
    source=sqlite3.connect(f'file:{profiles}?mode=ro',uri=True);db=sqlite3.connect(temporary)
    db.executescript('PRAGMA cache_size=-16384; CREATE TABLE edges(id TEXT PRIMARY KEY,tx INTEGER,tz INTEGER,data TEXT); CREATE INDEX cells ON edges(tx,tz); CREATE TABLE nodes(id TEXT PRIMARY KEY,x REAL,y REAL,z REAL); CREATE TABLE metadata(value TEXT);')
    count=0;cells=set()
    for row,data in source.execute('SELECT rowid,data FROM roads ORDER BY id'):
        road=json.loads(data)
        points=[[x,y,z,station] for station,x,y,z in source.execute('SELECT s.station,p.x,p.y,p.z FROM samples s JOIN points p ON p.rowid=s.point WHERE s.road=? ORDER BY s.station',(row,))]
        if len(points)<2:raise ValueError('Missing profile samples: '+road['id'])
        for edge in directed(road,points):
            edge.update(name=road['name'],source=road['id'],width=road['width'])
            tx,tz=edge['cell'];cells.add((tx,tz));db.execute('INSERT INTO edges VALUES(?,?,?,?)',(edge['id'],tx,tz,encode(edge)));count+=1
            for key,point in ((edge['fromNode'],edge['points'][0]),(edge['toNode'],edge['points'][-1])):
                position=tuple(point[:3]);prior=db.execute('SELECT x,y,z FROM nodes WHERE id=?',(key,)).fetchone()
                if prior is not None and prior!=position:raise ValueError('Portal/node mismatch: '+key)
                db.execute('INSERT OR IGNORE INTO nodes VALUES(?,?,?,?)',(key,*position))
        if count%1000==0:db.commit()
    manifest={'inputs':fingerprint,'edges':count,'cells':len(cells),'nodes':db.execute('SELECT COUNT(*) FROM nodes').fetchone()[0],'releaseReady':False,'validation':{'portalIdentity':'pass','contactCoverage':'not-run','turnRestrictions':'not-run'}}
    db.execute('INSERT INTO metadata VALUES(?)',(encode(manifest),));db.commit();db.close();source.close();temporary.replace(output)
    output.with_suffix('.sha256').write_text(sha(output)+'\n');output.with_suffix('.metrics.json').write_text(encode(dict(manifest,seconds=time.monotonic()-started,bytes=output.stat().st_size))+'\n')
    return manifest

if __name__=='__main__':
    import argparse,json
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('profiles');parser.add_argument('output');args=parser.parse_args()
    print(json.dumps(build(args.profiles,args.output),sort_keys=True))
