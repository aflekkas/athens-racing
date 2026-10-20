"""Remove only this task's duplicate evidence and its single owned temporary directory."""
import json,shutil,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
read=lambda name:json.loads((root/name).read_text())
assert read('gate-results.json').get('pass')
for name in ['game-processes.json','harness/evidence-processes-after.json','harness/perf-processes-final.json']:
 assert read(name).get('closed'),name
records={}
for file in sorted(root.glob('*pid*.json'))+sorted(root.glob('*process*.json'))+sorted(root.glob('browser-slot-*.json'))+sorted((root/'harness').glob('*process*.json')):
 records[str(file.relative_to(root))]=json.loads(file.read_text())
records['finalArchive']=read('gate-results.json');records['supersededArchive']=read('initial-gate-attempt.json');records['manualSignals']=[]
(root/'owned-processes.json').write_text(json.dumps(records,indent=2)+'\n')
# Retain the scripts linked from the report, final test logs and selected image evidence.
unused=['author-survey.py','contact.py','implement-faros.py','finish-captures.py','commit.py','build.log','detail-build.log','evidence-before.log','evidence-after.log','finish-captures.log','focused-development.log','lap-development.json','lap-development.log','detail-budget-development.log','road-network-development.log','rebuild-1.log','rebuild-2.log','perf-final.log','game-capture.log','diagnostic.log','harness/diagnostic.mjs','harness/evidence-diagnostic.json']
removed=[]
for name in unused:
 file=root/name
 if file.is_file():removed.append({'path':name,'bytes':file.stat().st_size});file.unlink()
for file in root.rglob('__pycache__'):
 if file.is_dir():shutil.rmtree(file)
session=read('session.json');tmp=Path(session['temp']);assert tmp.parent==Path('/tmp') and tmp.name.startswith('athens-psychiko-f.')
size=sum(f.stat().st_size for f in tmp.rglob('*') if f.is_file() and not f.is_symlink())
diskBeforeRemoval=subprocess.check_output(['df','-h','/'],text=True);shutil.rmtree(tmp)
report={'tempRemoved':str(tmp),'tempBytesRemoved':size,'rawCaptureCleanup':read('removed-capture-files.json'),'additionalRemoved':removed,'duplicateComparisonRemoved':'sbs-lap-0018-extra.webp (126830 bytes)','ownedProcesses':'owned-processes.json','manualSignals':[],'allOwnedCaptureHandlesClosed':True,'allFinalGateChildrenExited':True,'continuationDiskBefore':session['continuationDiskBefore'],'diskBeforeCleanup':diskBeforeRemoval,'diskAfterCleanup':subprocess.check_output(['df','-h','/'],text=True),'evidenceBytes':sum(f.stat().st_size for f in root.rglob('*') if f.is_file())}
(root/'cleanup.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
