#!/usr/bin/env python3
"""Deterministic optional building detail records; base geometry stays unchanged."""
import argparse,json,sqlite3,time
from pathlib import Path
from ingest import encode,sha


def fnv1a(text):
    value=2166136261
    for byte in text.encode('utf-8'):value=((value^byte)*16777619)&0xffffffff
    return value


def building_details(identifier,tags):
    if identifier[0] not in 'wr' or not identifier[1:].isdigit():raise ValueError('Expected source OSM way/relation ID')
    source=('way/' if identifier[0]=='w' else 'relation/')+identifier[1:]
    seed=fnv1a(source);kind=tags.get('building','')
    if kind in ('industrial','warehouse','manufacture','hangar','garages'):style=7
    elif kind in ('office','commercial') or tags.get('office'):style=5
    elif tags.get('shop') not in (None,'no') or kind=='retail':style=4
    elif kind in ('apartments','residential'):style=1+seed%3
    elif tags.get('building:material') in ('stone','brick'):style=6
    else:style=0
    # roofPropSeed is a source alias until the AWT extension names are final.
    return dict(facadeStyle=style,detailSeed=seed,roofPropSeed=seed,source=source)


def build(source,clean,output):
    source,clean,output=map(Path,(source,clean,output));started=time.monotonic()
    fingerprint={'sourceSha256':sha(source),'cleanSha256':sha(clean),'codeSha256':sha(Path(__file__))}
    if output.exists():
        db=sqlite3.connect(f'file:{output}?mode=ro',uri=True);meta=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0]);db.close()
        if meta['inputs']!=fingerprint or output.with_suffix('.sha256').read_text().strip()!=sha(output):raise ValueError('Detail cache mismatch')
        return meta
    temporary=output.with_suffix('.partial.sqlite')
    if temporary.exists():raise ValueError('Inspect partial detail cache before retrying')
    db=sqlite3.connect(temporary);db.executescript('PRAGMA cache_size=-16384; CREATE TABLE buildings(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE metadata(value TEXT);')
    db.execute('ATTACH DATABASE ? AS source',(f'file:{source}?mode=ro',));db.execute('ATTACH DATABASE ? AS clean',(f'file:{clean}?mode=ro',));count=0
    for identifier,tags in db.execute("SELECT c.id,s.tags FROM clean.objects c JOIN source.features s ON s.id=c.id AND s.kind='building' WHERE c.kind='building' ORDER BY c.id"):
        db.execute('INSERT INTO buildings VALUES(?,?)',(identifier,encode(building_details(identifier,json.loads(tags)))));count+=1
    expected=db.execute("SELECT count(*) FROM clean.objects WHERE kind='building'").fetchone()[0]
    if count!=expected:raise ValueError('Missing building source detail record')
    meta={'inputs':fingerprint,'buildings':count,'renderEnabled':False,'awtExtensionEmitted':False};db.execute('INSERT INTO metadata VALUES(?)',(encode(meta),));db.commit();db.close();temporary.replace(output)
    output.with_suffix('.sha256').write_text(sha(output)+'\n');output.with_suffix('.metrics.json').write_text(encode(dict(meta,seconds=time.monotonic()-started,bytes=output.stat().st_size))+'\n');return meta

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('clean');p.add_argument('output');a=p.parse_args();print(encode(build(a.source,a.clean,a.output)))
