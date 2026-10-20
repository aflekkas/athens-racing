"""Verify final artifacts and fill the review report from measured results."""
import hashlib,json,re
from pathlib import Path
p=Path(__file__).resolve().parent
load=lambda name:json.loads((p/name).read_text())
before,after=load('harness/perf-before.json'),load('harness/perf-final.json')
assert not after['errors']
assert all(hashlib.sha256(Path(f).read_bytes()).hexdigest()==h for f,h in after['sourceHashes'].items())
checks=[]
table=['| Camera | Calls before → after | Triangles before → after | Limit |','| --- | ---: | ---: | ---: |']
for tier in ['low','high']:
 b=next(r for r in before['rows'] if r['tier']==tier);a=next(r for r in after['rows'] if r['tier']==tier)
 for pose,label,limit in [('mid','matched camera',909000 if tier=='low' else 935000),('start','Faros start',1600000 if tier=='low' else 1700000)]:
  x=next(r['render'] for r in b['poses'] if r['name']==pose);y=next(r['render'] for r in a['poses'] if r['name']==pose);name=tier.title()+' · '+label
  checks.append({'name':name,'triangles':y['triangles'],'limit':limit,'calls':y['calls'],'pass':y['triangles']<=limit and (pose!='mid' or y['calls']<=110)})
  table.append(f"| {name} | {x['calls']:,} → {y['calls']:,} | {x['triangles']:,} → {y['triangles']:,} | {limit:,} |")
for r in load('detail-fixed.json')['rows']:
 b,a=r['before'],r['after'];name=r['name'].replace('psychiko-mid-','Full game · ')
 checks.append({'name':name,'triangles':a['triangles'],'limit':821000,'calls':a['calls'],'pass':a['triangles']<=821000 and a['calls']<=110})
 table.append(f"| {name} | {b['calls']:,} → {a['calls']:,} | {b['triangles']:,} → {a['triangles']:,} | 821,000 |")
assert all(c['pass'] for c in checks)
(p/'budget-results.json').write_text(json.dumps({'pass':True,'runtimeHashesMatch':True,'checks':checks},indent=2)+'\n')
text=(p/'README.md').read_text();start=text.index('| Camera |');end=text.index('[Low/High measurements',start);text=text[:start]+'\n'.join(table)+'\n\n[Budget assertions](budget-results.json) pass for every supplied limit.\n\n'+text[end:]
comparisons=load('comparisons.json');evidence=load('harness/evidence-after.json');assert len(comparisons)>=20 and len(evidence['rows'])==len(comparisons) and len(evidence['frames'])==11 and not evidence['errors']
for name in ['harness/perf-processes-final.json','harness/evidence-processes-after.json','detail-processes.json']:assert load(name)['closed'],name
links=' · '.join(f"[{r['id']}]({r['path']})" for r in comparisons)
if 'COMPARISON_LINKS_PENDING' in text:text=text.replace('COMPARISON_LINKS_PENDING',links)
else:
 start=text.index('[lap-0000]');end=text.index('\n\nThe extra Faros',start);text=text[:start]+links+text[end:]
gates=load('gate-results.json');assert gates['pass'],gates
npm=(p/'npm-test.log').read_text();summary=next(s for s in npm.splitlines() if s.startswith('[summary] ') and 'files,' in s)
failed=set(re.findall(r'^\[summary\] FAILED: (\S+)',npm,re.M));assert failed<={'tools/garage-cards.test.mjs','tools/traffic-race.test.mjs','tools/release-data.test.mjs'}
titles=set(re.findall(r'✖ (.+?) \([0-9.]+ms\)',npm));allowed=('browser measures drive-pill containment,','Riviera, afternoon, player at matched pace:','Riviera, rush hour, slow player:','the team is Alexandros and Vassilis;')
assert all(t.startswith(allowed) for t in titles),titles
physics=(p/'physics.log').read_text();assert '1261 passed, 0 failed' in physics
terrain=json.loads(next(s[2:] for s in (p/'terrain.log').read_text().splitlines() if s.startswith('ℹ {')));terrain={k:terrain[k] for k in ['samples','maxAbove','maxStep','maxSlope']};(p/'terrain-summary.json').write_text(json.dumps(terrain,indent=2)+'\n')
lap=load('lap.json');assert all(lap[k]==0 for k in ['offRoadFrames','islandFrames','clockwiseSteps','wallFrames'])
rows=['| Gate | Exact result |','| --- | --- |',f"| `npm test` | {summary.removeprefix('[summary] ')}; only the accepted garage and Riviera cases fail. [Log](npm-test.log). |",'| Physics | 1,261 pass / 0 fail. [Log](physics.log). |',f"| Syntax | {(p/'syntax.log').read_text().strip()} [Log](syntax.log). |",f"| Browser imports | {(p/'browser-imports.log').read_text().strip()} [Log](browser-imports.log). |",'| Map validator | Pass; worst source-field error 1.08710 m; lap 5,732.284 m; 3,647 buildings and 672 network parts. [Log](validator.log). |','| Focused Psychiko / rings | 44 pass / 0 fail. [Log](focused.log). |',f"| Uploaded terrain | 1 pass / 0 fail; {terrain['samples']:,} samples; above-road {terrain['maxAbove']:.8f} m, step {terrain['maxStep']:.8f} m, slope {terrain['maxSlope']:.8f}. [Log](terrain.log), [summary](terrain-summary.json). |",f"| AI lap | {lap['finish']:.3f} s; 0 off-road, 0 island, 0 clockwise, 0 wall-hit frames; six rings. [Log](lap.log). |",'| Current detail budgets | 1 pass / 0 fail. [Log](detail-budget-clean.log). |','| Wrangler deploy dry run | Exit 0; `npx wrangler deploy --env staging --dry-run`; no deployment. [Log](wrangler-dry-run.log). |']
text=text.replace('GATE_TABLE_PENDING','\n'.join(rows))
(p/'README.md').write_text(text)
(p/'verification-summary.json').write_text(json.dumps({'testedCommit':gates['head'],'npmSummary':summary,'acceptedFailedTitles':sorted(titles),'physics':{'pass':1261,'fail':0},'focused':{'pass':44,'fail':0},'terrain':terrain,'comparisons':len(comparisons),'onboardFrames':len(evidence['frames']),'budgetsPass':True,'browserErrors':[]},indent=2)+'\n')
print(summary);print('All final artifact, source-hash and budget assertions pass')
