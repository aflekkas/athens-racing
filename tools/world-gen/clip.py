#!/usr/bin/env python3
"""Three-pass reference-complete bbox extraction with disk-backed selected IDs.

No country-sized location index or dense ID bitset. The bbox uses the standard
node-in-bbox way selection rule; complete referenced ways/nodes are retained.
Input entities must be sorted by ID within each type, as in Geofabrik PBFs.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import resource
import time
import osmium
from fetch import sha


def clip(source,destination,bounds,resume_write=False,drop_incomplete=False):
    started=time.time();manifest=destination.with_suffix('.source.json')
    inputs=dict(sourceSha256=sha(source),bounds=bounds,algorithm='sqlite-bbox-complete-ways-v2',pyosmium='4.3.1',dropIncomplete=drop_incomplete)
    if destination.exists():
        previous=json.loads(manifest.read_text())
        if previous['inputs']!=inputs or sha(destination)!=previous['sha256']:raise ValueError('Extract cache mismatch')
        return previous
    index=destination.with_suffix('.selection.sqlite')
    if index.exists() and not resume_write:raise ValueError('Partial selection index exists; --resume-write only after references phase completed')
    if resume_write and not index.exists():raise ValueError('No selection index to resume')
    db=sqlite3.connect(index)
    db.executescript('PRAGMA journal_mode=OFF; PRAGMA cache_size=-16384; PRAGMA temp_store=FILE;')
    if resume_write:
        record=json.loads(db.execute("SELECT value FROM metadata WHERE key='resume'").fetchone()[0])
        previous=dict(record['inputs']);previous['dropIncomplete']=drop_incomplete
        if previous!=inputs or record['phase']!='references':raise ValueError('Resume provenance mismatch')
        record['inputs']=inputs;db.execute("UPDATE metadata SET value=? WHERE key='resume'",(json.dumps(record),));db.commit()
        started=record['started']
    else:
        db.executescript('''CREATE TABLE inside(id INTEGER PRIMARY KEY);
          CREATE TABLE ways(id INTEGER PRIMARY KEY); CREATE TABLE nodes(id INTEGER PRIMARY KEY);
          CREATE TABLE relations(id INTEGER PRIMARY KEY); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
        ''')
        west,south,east,north=bounds;batch=[]
        def flush():
            db.executemany('INSERT OR IGNORE INTO inside VALUES(?)',batch);batch.clear()
        class Select(osmium.SimpleHandler):
            def node(self,node):
                if west<=node.lon<=east and south<=node.lat<=north:
                    batch.append((node.id,))
                    if len(batch)>=10000:flush()
            def way(self,way):
                if batch:flush()
                refs=[n.ref for n in way.nodes]
                for i in range(0,len(refs),500):
                    chunk=refs[i:i+500]
                    if chunk and db.execute('SELECT 1 FROM inside WHERE id IN ('+','.join('?'*len(chunk))+') LIMIT 1',chunk).fetchone():
                        db.execute('INSERT OR IGNORE INTO ways VALUES(?)',(way.id,));break
            def relation(self,relation):
                tags=relation.tags
                if relation.id!=957716 and tags.get('type') not in ('multipolygon','restriction'):return
                members=[m for m in relation.members if relation.id!=957716 or m.role in ('outer','inner','')]
                if relation.id==957716 or any(m.type=='w' and db.execute('SELECT 1 FROM ways WHERE id=?',(m.ref,)).fetchone() for m in members):
                    if any(m.type=='r' for m in members):raise ValueError(f'Nested selected relation {relation.id}: explicit expansion required')
                    db.execute('INSERT INTO relations VALUES(?)',(relation.id,))
                    db.executemany('INSERT OR IGNORE INTO ways VALUES(?)',((m.ref,) for m in members if m.type=='w'))
                    db.executemany('INSERT OR IGNORE INTO nodes VALUES(?)',((m.ref,) for m in members if m.type=='n'))
        Select().apply_file(str(source));flush();db.commit()
        print(json.dumps(dict(phase='select',seconds=round(time.time()-started,1))),flush=True)
        class References(osmium.SimpleHandler):
            def way(self,way):
                if db.execute('SELECT 1 FROM ways WHERE id=?',(way.id,)).fetchone():
                    db.executemany('INSERT OR IGNORE INTO nodes VALUES(?)',((n.ref,) for n in way.nodes))
        References().apply_file(str(source))
        record=dict(inputs=inputs,phase='references',started=started)
        db.execute('INSERT INTO metadata VALUES(?,?)',('resume',json.dumps(record)));db.commit()
        print(json.dumps(dict(phase='references',seconds=round(time.time()-started,1))),flush=True)
    counts=dict(nodes=0,ways=0,relations=0)
    cursors={k:iter(db.execute('SELECT id FROM '+k+' ORDER BY id')) for k in counts}
    wanted={k:next(c,None) for k,c in cursors.items()};last={k:-1 for k in counts}
    missing={k:set() for k in counts};omitted={k:set() for k in counts}
    def absent(kind,identifier):
        if not drop_incomplete:raise ValueError(f'Missing referenced {kind} ID {identifier}; use --drop-incomplete to report and exclude invalid objects')
        missing[kind].add(identifier)
        if len(missing[kind])>100000:raise ValueError('Too many missing references; input selection needs inspection')
    def finish(kind):
        while wanted[kind] is not None:
            absent(kind,wanted[kind][0]);wanted[kind]=next(cursors[kind],None)
    def selected(kind,identifier):
        if identifier<=last[kind]:raise ValueError('Input IDs must be strictly ascending within each type')
        last[kind]=identifier;row=wanted[kind]
        while row is not None and row[0]<identifier:
            absent(kind,row[0]);row=next(cursors[kind],None);wanted[kind]=row
        if row is None or row[0]!=identifier:return False
        wanted[kind]=next(cursors[kind],None);return True
    temporary=destination.with_name(destination.stem+'.partial.osm.pbf')
    if resume_write and temporary.exists():temporary.unlink()
    with osmium.SimpleWriter(str(temporary)) as writer:
        class Write(osmium.SimpleHandler):
            def node(self,node):
                if selected('nodes',node.id):writer.add_node(node);counts['nodes']+=1
            def way(self,way):
                finish('nodes')
                if selected('ways',way.id):
                    if any(n.ref in missing['nodes'] for n in way.nodes):omitted['ways'].add(way.id)
                    else:writer.add_way(way);counts['ways']+=1
            def relation(self,relation):
                finish('ways')
                if selected('relations',relation.id):
                    members=[m for m in relation.members if relation.id!=957716 or m.role in ('outer','inner','')]
                    if any(m.type=='n' and m.ref in missing['nodes'] or m.type=='w' and (m.ref in missing['ways'] or m.ref in omitted['ways']) for m in members):
                        omitted['relations'].add(relation.id);return
                    if relation.id==957716:
                        relation=osmium.osm.mutable.Relation(relation,members=[(m.type,m.ref,m.role) for m in members])
                    writer.add_relation(relation);counts['relations']+=1
        Write().apply_file(str(source))
    for kind in counts:finish(kind)
    expected={k:db.execute('SELECT count(*) FROM '+k).fetchone()[0] for k in counts}
    if any(counts[k]+len(missing[k])+len(omitted[k])!=expected[k] for k in counts):raise ValueError('Reference accounting mismatch')
    discarded=dict(missing={k:sorted(map(str,v)) for k,v in missing.items()},incomplete={k:sorted(map(str,v)) for k,v in omitted.items()})
    db.close();index.unlink();os.replace(temporary,destination)
    result=dict(inputs=inputs,sha256=sha(destination),bytes=destination.stat().st_size,selected=counts,requested=expected,discarded=discarded,
                generationSeconds=round(time.time()-started,3),peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
    manifest.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n');return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('destination',type=Path)
    parser.add_argument('--bounds',nargs=4,type=float,default=[22.8,37.4,24.7,38.6]);parser.add_argument('--resume-write',action='store_true');parser.add_argument('--drop-incomplete',action='store_true');args=parser.parse_args()
    print(json.dumps(clip(args.source,args.destination,args.bounds,args.resume_write,args.drop_incomplete)),flush=True)
