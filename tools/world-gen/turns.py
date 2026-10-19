#!/usr/bin/env python3
"""Compile OSM motorcar turns onto clipped graph IDs, with explicit fail-closed notes."""
import argparse,collections,json,sqlite3,time
from pathlib import Path
from ingest import encode,sha


def compile_turns(db,relations):
    db.executescript('CREATE TABLE turns(from_edge TEXT,via_node TEXT,to_edge TEXT,relation TEXT,PRIMARY KEY(from_edge,via_node,to_edge)); CREATE TABLE blocked(edge TEXT PRIMARY KEY,relation TEXT); CREATE TABLE audit(relation TEXT,mode TEXT);')
    counts=collections.Counter()
    def edges(way):return db.execute('SELECT id,a,b,way FROM edge_index WHERE way=? ORDER BY id',(way,)).fetchall()
    def outgoing(node):return db.execute('SELECT id,a,b,way FROM edge_index WHERE a=? ORDER BY id',(node,)).fetchall()
    def prohibit(incoming,target,relation):db.execute('INSERT OR IGNORE INTO turns VALUES(?,?,?,?)',(incoming[0],incoming[2],target[0],str(relation)))
    for rid,tags,members in relations:
        tags=json.loads(tags);members=json.loads(members)
        ways={'w'+str(ref) for kind,ref,role in members if kind=='w'}
        if not any(db.execute('SELECT 1 FROM edge_index WHERE way=? LIMIT 1',(w,)).fetchone() for w in ways):continue
        fromways={'w'+str(ref) for kind,ref,role in members if kind=='w' and role=='from'}
        toways={'w'+str(ref) for kind,ref,role in members if kind=='w' and role=='to'}
        vias=['osm:node:'+str(ref) for kind,ref,role in members if kind=='n' and role=='via']
        viaways={'w'+str(ref) for kind,ref,role in members if kind=='w' and role=='via'}
        mode='compiled-node'
        if {v.strip() for v in tags.get('except','').split(';')} & {'motorcar','motor_vehicle','vehicle'}:mode='except-motorcar'
        else:
            rule=next((tags[k] for k in ('restriction:motorcar','restriction:motor_vehicle','restriction:vehicle','restriction') if k in tags),None)
            uncertain=any('conditional' in k or 'lanes' in k for k in tags)
            if rule is None and not uncertain:mode='other-vehicle-class'
            elif viaways and rule and rule.startswith('no_') and not uncertain:
                # A chain `from -> via ways -> to` (typically a no_u_turn across a median crossover) cannot be written as a
                # node rule: the edge-state graph has no history. Forbid only the LAST step, entering a to-way from a via
                # way. The old rule forbade entering any via way from the from-way, which also banned driving straight
                # on when a via way is a stretch of the through road (one Poseidonos U-turn rule split the world's
                # strongly connected road network in two).
                for way in sorted(viaways):
                    for incoming in edges(way):
                        for target in outgoing(incoming[2]):
                            if target[3] in toways:prohibit(incoming,target,rid)
                mode='via-chain-exit'
            elif uncertain or len(vias)!=1 or viaways or not fromways or not toways or not rule or not rule.startswith(('no_','only_')):
                for way in sorted(fromways or ways):
                    db.executemany('INSERT OR IGNORE INTO blocked VALUES(?,?)',((e[0],str(rid)) for e in edges(way)))
                mode='unsupported-fail-closed'
            else:
                via=vias[0]
                for way in sorted(fromways):
                    for incoming in edges(way):
                        if incoming[2]!=via:continue
                        for target in outgoing(via):
                            matched=target[3] in toways
                            if rule in ('no_u_turn','only_u_turn'):matched=matched and target[2]==incoming[1]
                            elif rule.startswith('only_') and incoming[3] in toways and len(toways)==1:matched=matched and target[2]!=incoming[1]
                            if matched if rule.startswith('no_') else not matched:prohibit(incoming,target,rid)
        counts[mode]+=1;db.execute('INSERT INTO audit VALUES(?,?)',(str(rid),mode))
    return dict(counts)


def build(source,graph,output):
    source,graph,output=map(Path,(source,graph,output));started=time.monotonic()
    fingerprint={'sourceSha256':sha(source),'graphSha256':sha(graph),'codeSha256':sha(Path(__file__))}
    if output.exists():
        db=sqlite3.connect(f'file:{output}?mode=ro',uri=True);meta=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]);db.close()
        if meta['inputs']!=fingerprint or output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Turn cache mismatch')
        return meta
    partial=output.with_suffix('.partial.sqlite')
    if partial.exists():raise ValueError('Inspect partial turn cache before retrying')
    db=sqlite3.connect(partial);db.executescript('PRAGMA cache_size=-16384; CREATE TABLE edge_index(id TEXT PRIMARY KEY,a TEXT,b TEXT,way TEXT); CREATE TABLE metadata(value TEXT);')
    g=sqlite3.connect(f'file:{graph}?mode=ro',uri=True)
    for identifier,data in g.execute('SELECT id,data FROM edges ORDER BY id'):
        e=json.loads(data);db.execute('INSERT INTO edge_index VALUES(?,?,?,?)',(identifier,e['fromNode'],e['toNode'],e['source'].split(':')[0]))
    g.close();db.executescript('CREATE INDEX ways ON edge_index(way); CREATE INDEX outgoing ON edge_index(a);')
    source_db=sqlite3.connect(f'file:{source}?mode=ro',uri=True)
    audit=compile_turns(db,source_db.execute('SELECT id,tags,members FROM restrictions ORDER BY id'));source_db.close()
    meta={'inputs':fingerprint,'audit':audit,'prohibitedTransitions':db.execute('SELECT count(*) FROM turns').fetchone()[0],'blockedEdges':db.execute('SELECT count(*) FROM blocked').fetchone()[0],'releaseReady':False}
    db.execute('DROP TABLE edge_index');db.execute('INSERT INTO metadata VALUES(?)',(encode(meta),));db.commit();db.execute('VACUUM');db.close();partial.replace(output)
    output.with_suffix('.sha256').write_text(sha(output)+'\n');output.with_suffix('.metrics.json').write_text(encode(dict(meta,seconds=time.monotonic()-started,bytes=output.stat().st_size))+'\n');return meta

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('graph');p.add_argument('output');a=p.parse_args();print(encode(build(a.source,a.graph,a.output)))
