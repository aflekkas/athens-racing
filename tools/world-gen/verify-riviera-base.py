"""Prove immutable basin cells can be reused in the Riviera shared-boundary bake.

Read-only: compare normalized sources and global structure decisions, then
require the coast and every new-cell halo in the geometry rebuild set.
"""
import json,sqlite3,sys
from pathlib import Path
import areas


def verify(cache,rebuild):
 cache=Path(cache);report={}
 def same(name,table,columns):
  with sqlite3.connect(f'file:{cache}/{name}-riviera.sqlite?mode=ro',uri=True) as db:
   db.execute('ATTACH DATABASE ? AS old',(f'file:{cache}/{name}-ag.sqlite?mode=ro',))
   count=db.execute(f'SELECT count(*) FROM main.{table}').fetchone()[0]
   for a,b in [('main','old'),('old','main')]:
    if db.execute(f'SELECT {columns} FROM {a}.{table} EXCEPT SELECT {columns} FROM {b}.{table} LIMIT 1').fetchone():raise ValueError(f'Changed basin {name}.{table}; rebuild its affected geometry')
   report[f'{name}.{table}']=dict(records=count,changed=0)
 same('profiles','roads','id,data');same('profiles','points','key,x,z,y');same('graph','edges','id,data');same('sections','sections','id,data')
 old=json.loads((areas.AREAS/'east.structures.json').read_text());new=json.loads((areas.AREAS/'riviera.structures.json').read_text());groups={g['id']:g for g in new['groups']}
 for group in old['groups']:
  if groups.get(group['id'])!=group:raise ValueError('Changed basin structure group '+group['id'])
 if not set(old['unresolved'])<=set(new['unresolved']):raise ValueError('Changed unresolved basin structure decisions')
 for road,reason in old['excluded'].items():
  if new['excluded'].get(road)!=reason:raise ValueError('Changed basin structure exclusion '+road)
 union=set(areas.load('riviera')['cells']);base=set(areas.load('east')['cells']);rebuilt=set(map(tuple,rebuild));required=set(areas.load('coast')['cells'])|(union-base)
 required|={(x+dx,z+dz) for x,z in list(required) for dx in (-1,0,1) for dz in (-1,0,1)}&union
 if not required<=rebuilt:raise ValueError('Rebuild omits shared-boundary halo: '+str(sorted(required-rebuilt)))
 if not rebuilt<=union:raise ValueError('Rebuild escapes approved union')
 report.update(basinStructures=dict(groups=len(old['groups']),changed=0),newCells=len(union-base),rebuiltCells=len(rebuilt),reusedCells=len(union-rebuilt),totalCells=len(union))
 return report

if __name__=='__main__':print(json.dumps(verify(sys.argv[1],json.loads(Path(sys.argv[2]).read_text())),indent=2))
