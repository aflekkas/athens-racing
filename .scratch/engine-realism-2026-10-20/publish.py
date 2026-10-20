"""One combined before/after spectrogram per car, with original-level short clips."""
import pathlib,subprocess,json,sys,shutil
root=pathlib.Path(__file__).resolve().parent;raw=pathlib.Path(sys.argv[1]);feed=pathlib.Path('/home/dev/data/agent-feed/sound-design/engines');feed.mkdir(parents=True,exist_ok=True)
cars=json.loads((root/'cars.json').read_text());targets=json.loads((root/'targets.json').read_text());changes=json.loads((root/'changes.json').read_text())
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for car in cars:
 id=car['id'];after=raw/('after-'+id+'.f32')
 if not after.exists():continue
 before=raw/('before-'+id+'.f32');image=feed/(id+'.webp')
 if image.exists() and image.stat().st_mtime>after.stat().st_mtime:continue
 inputs=[]
 for p in [before,after]:inputs+=['-f','f32le','-ar','44100','-ac','2','-i',str(p)]
 graph=[]
 for i,label in [(0,'BEFORE'),(1,'AFTER')]:
  graph.append(f'[{i}:a]asplit=2[s{i}][w{i}];[s{i}]showspectrumpic=s=960x240:legend=1:scale=log:fscale=log:color=intensity[sp{i}];[sp{i}]scale=1008:300[ss{i}];[w{i}]showwavespic=s=1008x80:split_channels=0:colors=77c6ee[wa{i}];[ss{i}][wa{i}]vstack=inputs=2,pad=1008:414:0:34:color=0x101823,drawtext=fontfile={font}:text={label} - {id}:x=15:y=8:fontsize=18:fontcolor=white[v{i}]')
 graph.append('[v0][v1]vstack=inputs=2[out]')
 subprocess.run(['ffmpeg','-v','error',*inputs,'-filter_complex',';'.join(graph),'-map','[out]','-frames:v','1','-c:v','libwebp','-quality','75','-y',str(image)],check=True)
 for phase in ['before','after']:
  clip=root/(phase+'-'+id+'.ogg')
  if not clip.exists() or clip.stat().st_mtime<(raw/(phase+'-'+id+'.f32')).stat().st_mtime:
   subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar','44100','-ac','2','-i',str(raw/(phase+'-'+id+'.f32')),'-c:a','libvorbis','-q:a','3','-y',str(clip)],check=True)
  shutil.copyfile(clip,feed/clip.name)
 (feed/(id+'.txt')).write_text(f"{car['name']} — {changes[id]} Before/after at identical mix; idle 0–3s, pull/limiter 3–11s, lift 11–14s, cruise 14–18s, blip 18–21s (EV: steady motor).\n")
 print(id,flush=True)
