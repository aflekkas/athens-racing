from pathlib import Path
import json,math,gzip
root=Path(__file__).parent

def read(p):return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def summarize(rows):
 out=[]
 for cam in dict.fromkeys(r['cam'] for r in rows):
  for scenario in dict.fromkeys(r['scenario'] for r in rows):
   a=[r for r in rows if r['cam']==cam and r['scenario']==scenario]
   if not a:continue
   lost=maximum=0
   for r in a:
    lost=lost+1 if not all(r['contact']) else 0;maximum=max(maximum,lost)
   out.append({'camera':cam,'scenario':scenario,'samples':len(a),'speed_kmh':[min(r['speed'] for r in a),max(r['speed'] for r in a)],'pitch_deg':max(abs(r['pitch'])*180/math.pi for r in a),'roll_deg':max(abs(r['roll'])*180/math.pi for r in a),'heave_cm':max(abs(r['heave'])*100 for r in a),'unloaded_frames':sum(not all(r['contact']) for r in a),'longest_unloaded_seconds':maximum/60,'max_compression_cm':max(max(r['compression'])*100 for r in a),'heading_change_deg':(a[0]['yaw']-a[-1]['yaw'])*180/math.pi})
 return out
for phase in ['before','after','matched-before']:
 rows=read(root/phase/'telemetry.json');summary=summarize(rows)
 (root/phase/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 if phase!='matched-before':
  assert len(rows)==5760 and len(summary)==16 and all(r['samples']==360 for r in summary)
  report=read(root/phase/'report.json');assert not report['errors'] and report['recovery']['triggered'] and all(f>1 for f in report['final']['load'])
# Camera rendering cannot change physical response in the two bug-triggering maneuvers.
rows=read(root/'after/telemetry.json');checks={}
for scenario in ['junction-turn','kerb']:
 a=[r for r in rows if r['cam']=='chase' and r['scenario']==scenario];b=[r for r in rows if r['cam']=='cockpit' and r['scenario']==scenario]
 checks[scenario]=all(all(x[k]==y[k] for k in ['pitch','roll','heave','compression','load']) for x,y in zip(a,b))
assert all(checks.values())
(root/'camera-independence.json').write_text(json.dumps(checks,indent=2)+'\n')
print('All 16 maneuvers per version, tow placement, and camera independence verified')
