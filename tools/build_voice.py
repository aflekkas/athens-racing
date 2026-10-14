#!/usr/bin/env python3
"""Offline CPU renderer. Install piper-tts scipy; supply .scratch/voice/models/*.onnx.
Run one model per process: build_voice.py rapunzelina|chreece|espeak|mms [--final].
All evaluation WAVs and measurements stay in .scratch/voice; final Ogg only in assets.
"""
import os
os.environ.update(OMP_NUM_THREADS='2', MKL_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', TOKENIZERS_PARALLELISM='false')
import json, sys, time, resource, wave, subprocess
from pathlib import Path
import numpy as np
from scipy.io import wavfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.scratch/voice'; ASSETS=ROOT/'assets/audio/voice'
TEST=['Ρε μαλάκα!', 'Τι κάνεις ρε;', 'Πρόσεχε ρε!', 'Παναγία μου!', 'Τράβα δεξιά!']
model=sys.argv[1]; final='--final' in sys.argv
out=OUT/model; out.mkdir(parents=True,exist_ok=True)
t0=time.perf_counter(); cpu0=time.process_time()
if model in ['rapunzelina','chreece']:
 import onnxruntime as ort
 from piper import PiperVoice, SynthesisConfig
 # Piper defaults to all cores; override the session options to respect the shared CPU.
 original=ort.InferenceSession
 def limited(*args,**kwargs):
  opts=ort.SessionOptions(); opts.intra_op_num_threads=2; opts.inter_op_num_threads=1
  kwargs['sess_options']=opts
  return original(*args,**kwargs)
 ort.InferenceSession=limited
 voice=PiperVoice.load(OUT/'models'/f'{model}.onnx')
 def render(text,path):
  with wave.open(str(path),'wb') as f: voice.synthesize_wav(text,f,syn_config=SynthesisConfig(length_scale=.94))
elif model=='mms':
 import torch
 from transformers import VitsModel, AutoTokenizer
 torch.set_num_threads(2); torch.set_num_interop_threads(1); torch.manual_seed(1729)
 voice=VitsModel.from_pretrained('facebook/mms-tts-ell'); tokenizer=AutoTokenizer.from_pretrained('facebook/mms-tts-ell')
 def render(text,path):
  with torch.inference_mode(): x=voice(**tokenizer(text,return_tensors='pt')).waveform[0].numpy()
  wavfile.write(path,voice.config.sampling_rate,x)
elif model=='espeak':
 def render(text,path): subprocess.run(['espeak-ng','-v','el','-s','175','-w',str(path),text],check=True)
else: raise ValueError(model)
load=time.perf_counter()-t0; c0=time.process_time(); w0=time.perf_counter()
for i,text in enumerate(TEST): render(text,out/f'test-{i+1}.wav')
result=dict(model=model,load_seconds=load,five_wall_seconds=time.perf_counter()-w0,five_cpu_seconds=time.process_time()-c0,peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
if model=='espeak': result['child_cpu_seconds']=resource.getrusage(resource.RUSAGE_CHILDREN).ru_utime+resource.getrusage(resource.RUSAGE_CHILDREN).ru_stime
(out/'metrics.json').write_text(json.dumps(result,indent=2)+'\n');print(result,flush=True)
if final:
 data=json.loads((ASSETS/'lines.json').read_text()); records=[]
 for line in data['lines']:
  raw=out/(line['id']+'.wav');render(line['text'],raw)
  for p in data['profiles']:
   if p['model']!=model:continue
   filename=f"{line['id']}-{p['id']}.ogg"
   sr,x=wavfile.read(raw)
   # Trim initial/final silence only (retain pauses inside words/phrases).
   if x.dtype.kind!='f': x=x.astype(np.float32)/32768
   active=np.flatnonzero(np.abs(x)>.008)
   if not len(active): raise RuntimeError(f'Empty {line["id"]}')
   x=x[max(0,active[0]-int(sr*.02)):min(len(x),active[-1]+int(sr*.05))]
   trimmed=out/'trimmed.wav';wavfile.write(trimmed,sr,x)
   # Rate and pitch independently varied. Time-compress long lines, never truncate words.
   tempo=max(p['rate']/p['pitch'],len(x)/sr/p['pitch']/2.48)
   filt=f"asetrate={sr*p['pitch']},aresample=24000,atempo={tempo},apad=pad_dur=0.5,atrim=duration={max(.5,len(x)/sr/p['pitch']/tempo)},loudnorm=I=-20:TP=-4:LRA=7,afade=t=in:d=0.008,areverse,afade=t=in:d=0.025,areverse"
   subprocess.run(['ffmpeg','-v','error','-y','-threads','1','-i',str(trimmed),'-af',filt,'-ar','24000','-ac','1','-c:a','libvorbis','-q:a','1',str(ASSETS/filename)],check=True)
   records.append(dict(file=filename,model=model,profile=p['id'],bytes=(ASSETS/filename).stat().st_size))
 (out/'rendered.json').write_text(json.dumps(records,indent=2)+'\n')
 print(f'Rendered {len(records)} clips, {sum(r["bytes"] for r in records)} bytes',flush=True)
