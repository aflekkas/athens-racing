from pathlib import Path
import json, math, base64, gzip
from PIL import Image, ImageDraw, ImageFont
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).parent
plt.rcParams.update({'font.size':10,'figure.dpi':140})
def available(path):
 return path.exists() or Path(str(path)+'.gz').exists()
def read(path):
 return json.loads(path.read_text() if path.exists() else gzip.decompress(Path(str(path)+'.gz').read_bytes()))
def plot_pair(a,b,title,path):
 fig,axs=plt.subplots(3,1,figsize=(10,7),sharex=True)
 for rows,label,color in [(a,'before','#d35b47'),(b,'after','#167f9b')]:
  for ax,key,scale,unit in zip(axs,['pitch','roll','heave'],[180/math.pi,180/math.pi,100],['deg','deg','cm']):
   ax.plot([r['t'] for r in rows],[r[key]*scale for r in rows],label=label,color=color,lw=1.2)
   ax.set_ylabel(f'{key} ({unit})');ax.grid(alpha=.22)
 axs[0].legend(ncol=2);axs[0].set_title(title);axs[-1].set_xlabel('Time (s)')
 fig.tight_layout();fig.savefig(path);plt.close(fig)
controlled={p:read(root/f'{p}-controlled.json') for p in ['before','after']}
for scenario in ['drop','step-steer','lane-change','kerb','brake']:
 a,b=[next(r['trace'] for r in controlled[p] if r['id']=='bus' and r['type']==scenario) for p in ['before','after']]
 plot_pair(a,b,'Citaro — '+scenario+' — identical controlled input',root/f'controlled-{scenario}.png')
if available(root/'after/telemetry.json') and available(root/'before/telemetry.json'):
 allrows={p:read(root/p/'telemetry.json') for p in ['before','after']}
 for cam in ['chase','cockpit']:
  for scenario in ['launch','cruise50','cruise80','braking','lane-change','junction-turn','kerb','bump']:
   a,b=[[r for r in allrows[p] if r['cam']==cam and r['scenario']==scenario] for p in ['before','after']]
   plot_pair(a,b,f'Riviera · {cam} · {scenario} (full runs)',root/f'riviera-{cam}-{scenario}.png')
 if available(root/'matched-before/telemetry.json'):
  a=read(root/'matched-before/telemetry.json');b=[r for r in allrows['after'] if r['cam']=='chase' and r['scenario']=='kerb']
  plot_pair(a,b,'Riviera kerb · same world, dry daylight, original vs corrected solver',root/'riviera-matched-kerb.png')
  for p,rows in [('matched-before',a),('after',b)]:
   fig,axs=plt.subplots(3,1,figsize=(10,7),sharex=True)
   for i,label in enumerate(['FL','FR','RL','RR']):
    axs[0].plot([r['t'] for r in rows],[100*r['compression'][i] for r in rows],label=label)
    axs[1].plot([r['t'] for r in rows],[r['load'][i]/1000 for r in rows],label=label)
    axs[2].step([r['t'] for r in rows],[i+.8*int(r['contact'][i]) for r in rows],where='post',label=label)
   axs[0].set_ylabel('compression (cm)');axs[1].set_ylabel('normal load (kN)');axs[2].set_ylabel('contact (1 / 0 per row)');axs[2].set_xlabel('Time (s)')
   axs[0].legend(ncol=4);axs[0].set_title('Riviera kerb per-wheel telemetry · '+p)
   for ax in axs:ax.grid(alpha=.2)
   fig.tight_layout();fig.savefig(root/f'riviera-{p}-wheel-telemetry.png');plt.close(fig)
  font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
  sheet=Image.new('RGB',(1152,552),'#17202a');d=ImageDraw.Draw(sheet)
  for row,(p,label) in enumerate([('matched-before','Before'),('after','After')]):
   y=row*276;d.text((10,y+5),f'{label} · Riviera · Low · 1 s / 3 s / 6 s',fill='white',font=font)
   for col,block in enumerate([0,2,5]):
    frame=root/p/f'kerb-{block}.png'
    if not frame.exists():frame=frame.with_suffix('.webp')
    im=Image.open(frame).convert('RGB').resize((384,240),Image.Resampling.LANCZOS);sheet.paste(im,(col*384,y+36))
  sheet.save(root/'bus-riviera-kerb-strip.webp',quality=90)
  sheet.save(root/'bus-riviera-kerb-strip.png')
 print('Built real-game plots and matched frame strip')
