#!/usr/bin/env python3
"""Measure the browser offline renders and all shipping clips with FFmpeg."""
from pathlib import Path
import subprocess,json,re
root=Path(__file__).resolve().parents[1];out=root/'.scratch/voice';results={}
for p in sorted(out.glob('crash-*m-*.wav')):
 text=subprocess.run(['ffmpeg','-hide_banner','-i',str(p),'-af','loudnorm=I=-20:TP=-4:LRA=7:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
 (out/(p.stem+'-loudness.txt')).write_text(text)
 measurements=json.loads(re.search(r'\{\s*"input_i"[\s\S]+?\}',text).group())
 results[p.stem]=measurements
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(p),'-lavfi','showspectrumpic=s=800x360:legend=1:scale=log','-frames:v','1',str(out/(p.stem+'-spectrum.png'))],check=True)
(out/'loudness.json').write_text(json.dumps(results,indent=2)+'\n')
clips=[]
for p in sorted((root/'assets/audio/voice').glob('*.ogg')):
 duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
 assert .49<=duration<=2.51,(p.name,duration)
 clips.append(dict(file=p.name,duration=duration,bytes=p.stat().st_size))
(out/'asset-audit.json').write_text(json.dumps(clips,indent=2)+'\n')
print(json.dumps(results,indent=2));print('Clips',len(clips),'bytes',sum(c['bytes'] for c in clips),'duration',min(c['duration'] for c in clips),max(c['duration'] for c in clips))
