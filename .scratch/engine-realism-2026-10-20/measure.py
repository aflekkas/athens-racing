"""Offline float captures -> small Vorbis evidence + per-phase EBU R128/FFT metrics."""
import numpy as np,pathlib,json,sys,subprocess,re
prefix,raw=sys.argv[1:3];only=sys.argv[3] if len(sys.argv)>3 else None;root=pathlib.Path(__file__).resolve().parent;raw=pathlib.Path(raw)
phases={'idle':(0,3),'pull':(3,11),'overrun':(11,14),'cruise':(14,18),'blip':(18,21)}
rows=json.loads((root/(prefix+'-metrics.json')).read_text()) if only else []
for file in sorted(raw.glob(prefix+'-*.f32')):
 name=file.stem[len(prefix)+1:]
 if only and not re.search(only,name):continue
 x=np.fromfile(file,np.float32).reshape(-1,2);sr=44100;at=np.flatnonzero(np.max(abs(x),axis=1)>.001);row={'car':name,'firstAboveMinus60Sec':float(at[0]/sr) if len(at) else None,'phases':{}}
 for phase,(s,e) in phases.items():
  y=x[int(s*sr):int(e*sr)];mono=y.mean(axis=1);n=4096
  spect=np.array([abs(np.fft.rfft(mono[i:i+n]*np.hanning(n)))**2 for i in range(0,len(mono)-n,11025)]).sum(axis=0);hz=np.fft.rfftfreq(n,1/sr);tot=spect.sum()
  log=subprocess.run(['ffmpeg','-v','info','-f','f32le','-ar',str(sr),'-ac','2','-i','pipe:0','-af','ebur128=peak=true','-f','null','-'],input=y.tobytes(),capture_output=True,check=True).stderr.decode()
  lufs=re.findall(r'I:\s+(-?[\d.]+) LUFS',log);tp=re.findall(r'Peak:\s+(-?[\d.]+) dBFS',log)
  row['phases'][phase]={'lufs':float(lufs[-1]) if lufs else None,'truePeakDb':float(tp[-1]) if tp else None,'peakDb':round(float(20*np.log10(max(1e-9,abs(y).max()))),2),'centroid':round(float((spect*hz).sum()/tot)) if tot else 0,'above6kPercent':round(float(100*spect[hz>6000].sum()/tot),2) if tot else 0,'lowMidPercent':round(float(100*spect[(hz>80)&(hz<800)].sum()/tot),2) if tot else 0,'maxStep':round(float(np.max(abs(np.diff(y,axis=0)))),5)}
 subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(sr),'-ac','2','-i',str(file),'-c:a','libvorbis','-q:a','3','-y',str(root/(prefix+'-'+name+'.ogg'))],check=True)
 rows=[r for r in rows if r['car']!=name];rows.append(row);print(name,row['phases']['pull'],flush=True)
(root/(prefix+'-metrics.json')).write_text(json.dumps(rows,indent=2))
