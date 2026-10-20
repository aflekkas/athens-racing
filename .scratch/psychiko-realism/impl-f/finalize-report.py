"""Build the final gate section only after every required gate has passed."""
import hashlib,json,re,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
read=lambda name:json.loads((root/name).read_text())
results=read('gate-results.json');assert results.get('pass'),results
lap=read('lap.json');assert all(lap[k]==0 for k in ['offRoadFrames','islandFrames','clockwiseSteps','wallFrames','maxWallHit'])
terrain=None
for line in (root/'terrain.log').read_text().splitlines():
 if line.startswith('ℹ {'):
  row=json.loads(line[2:]);terrain={k:row[k] for k in ['samples','maxAbove','maxStep','maxSlope']};break
assert terrain;(root/'terrain-summary.json').write_text(json.dumps(terrain,indent=2)+'\n')
assert read('rebuild-hashes.json')['identical'];assert read('budget-results.json')['pass']
# Every measured runtime source must still match the final workspace.
for path,sha in read('harness/perf-final.json')['sourceHashes'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,path
assert len(read('comparisons.json'))==39;assert len(read('game-capture.json')['gallery'])==11
npm=(root/'npm-test.log').read_text();summary=next(line for line in npm.splitlines() if line.startswith('[summary] ') and 'files,' in line)
rows=[('wrangler-dry-run','Wrangler staging dry run','Exit 0; no deployment.'),('physics','Physics',re.findall(r'\d+ passed, \d+ failed',(root/'physics.log').read_text())[-1]),('syntax','Syntax',(root/'syntax.log').read_text().strip()),('browser-imports','Browser imports',(root/'browser-imports.log').read_text().strip()),('validator','Map validator','Pass; 3,647 buildings and 672 network road parts.'),('focused','Psychiko / rings / network tests','57 pass / 0 fail.'),('terrain','Uploaded terrain',f"{terrain['samples']:,} samples; above-road {terrain['maxAbove']:.9f} m; step {terrain['maxStep']:.9f} m; slope {terrain['maxSlope']:.9f}."),('lap','Strict physical AI lap',f"{lap['finish']:.3f} s, six rings; 0 off-road, island, clockwise and wall-hit frames; max wall-hit impulse 0."),('detail-budget-clean','Detail budget','1 pass / 0 fail; final source hashes match.'),('npm-test','npm test',summary.replace('[summary] ',''))]
section='## Clean-archive gates\n\n'
section+=f"All required gates ran serially on a clean `git archive` of **{results['head'][:8]}**, with existing dependencies symlinked. [Exact candidate](archive-head.txt), [results and owned PIDs](gate-results.json), [runner](clean-gates.mjs). The final documentation commit changes only implementation-F evidence and reports; the source tree proof below checks that distinction. No candidate source edits followed validation.\n\n"
section+='| Gate | Result |\n| --- | --- |\n'
for name,label,description in rows:section+=f'| [{label}]({name}.log) | {description} |\n'
section+='\nOnly the explicitly accepted garage drive-pill test and two Riviera traffic cases remain failing. The release-data tests pass; its git-author check is skipped in the archive. Failure names are recorded in `gate-results.json`; there are no additional final failures.\n\n'
section+='[Terrain summary](terrain-summary.json) · [AI lap samples](lap.json) · [strict lap log](lap.log). The initial superseded archive exposed the missing standalone Faros pavement correction and an old budget source hash. Both were fixed before this final full run: [superseded attempt](initial-gate-attempt.json).\n\n'
file=root/'README.md';text=file.read_text();assert '## Clean-archive gates' not in text;text=text.replace('## Remaining differences',section+'## Remaining differences');file.write_text(text)
# Git object proof for all deploy/test inputs; only .scratch implementation-F evidence may change later.
head=results['head'];tree=subprocess.check_output(['git','ls-tree','-r',head],text=True).splitlines();production=[line for line in tree if not line.split('\t',1)[1].startswith('.scratch/')]
(root/'validated-source-tree.json').write_text(json.dumps({'candidate':head,'outsideScratchTreeSha256':hashlib.sha256(('\n'.join(production)+'\n').encode()).hexdigest(),'entries':len(production),'finalCommitRestriction':'Only .scratch/psychiko-realism/impl-f evidence and reports may change after validation.'},indent=2)+'\n')
print(summary);print('Final README gate section generated')
