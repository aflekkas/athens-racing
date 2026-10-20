"""Rebuild only this round's small V8 assets. Requires numpy and ffmpeg.
Uses HTTP seeking, not full source downloads; run from the repo root.
The source URLs, trim ranges and licences are in the engine manifest.
"""
import json,pathlib,subprocess,hashlib,numpy as np
p=pathlib.Path('assets/audio/engines');j=json.loads((p/'sources.json').read_text());sr=16000
for a in j['assets']:
 if not a['source'].startswith('realism-'):continue
 s=j['sources'][a['source']];start,end=a['trim']
 raw=subprocess.check_output(['ffmpeg','-v','error','-rw_timeout','15000000','-ss',str(start),'-i',s['downloadUrl'],'-t',str(end-start),'-ac','1','-ar',str(sr),'-f','f32le','pipe:1'],timeout=60)
 x=np.frombuffer(raw,np.float32).copy()
 if a['kind']=='loop':
  rpm=a['rpm'];fund=rpm*a['cylinders']/120;win=min(4096,len(x)//2);freq=np.fft.rfftfreq(32768,1/sr);mask=(freq>fund*.88)&(freq<fund*1.12);times=[];hz=[]
  for i in range(0,len(x)-win,256):
   z=abs(np.fft.rfft(x[i:i+win]*np.hanning(win),32768));times.append((i+win/2)/sr);hz.append(freq[mask][np.argmax(z[mask])])
  ratio=np.interp(np.arange(len(x))/sr,times,hz)/fund;phase=np.cumsum(ratio);x=np.interp(np.arange(phase[0],phase[-1]),phase,x)
  x-=x.mean();n=min(round(3*120/rpm*sr),len(x)//4);w=np.linspace(0,1,n);x=np.r_[x[n:-n],x[-n:]*(1-w)+x[:n]*w]
  x*=min(.16/(np.sqrt(np.mean(x*x))+1e-9),.78/(abs(x).max()+1e-9));filters=['-af','highpass=f=35,lowpass=f=7200']
 else:
  x-=x.mean();x*=min(.14/np.sqrt(np.mean(x*x)),.78/abs(x).max());x[:128]*=np.linspace(0,1,128);x[-3200:]*=np.linspace(1,0,3200);filters=[]
 out=p/a['file'];subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(sr),'-ac','1','-i','pipe:0',*filters,'-c:a','pcm_s16le','-y',str(out)],input=x.astype(np.float32).tobytes(),check=True)
 a['duration']=round(len(x)/sr,5);a['sha256']=hashlib.sha256(out.read_bytes()).hexdigest();print(out)
(p/'sources.json').write_text(json.dumps(j,indent=2)+'\n')
