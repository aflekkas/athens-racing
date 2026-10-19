from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,math
ROOT=Path('.scratch/psychiko-realism/impl-d');H=ROOT/'harness'
fontpath='/System/Library/Fonts/Supplemental/Arial.ttf'
def font(n):
 try:return ImageFont.truetype(fontpath,n)
 except:return ImageFont.load_default()
# North-up OSM/route overlay, wholly from the shipped geometry, no downloaded base image.
d=json.loads(Path('data/maps/psychiko/map.json').read_text());r=d['route'];p=r['x'];q=r['z'];margin=100;scale=min(1050/(max(p)-min(p)+margin*2),1120/(max(q)-min(q)+margin*2));cx=(max(p)+min(p))/2;cz=(max(q)+min(q))/2
xy=lambda x,z:(600+(x-cx)*scale,690+(z-cz)*scale)
im=Image.new('RGB',(1720,1380),'#152129');dr=ImageDraw.Draw(im)
for road in d['roadNetwork']['roads']:
 points=[xy(*road['p'][i:i+2]) for i in range(0,len(road['p']),2)];dr.line(points,fill='#536268' if road.get('h')=='primary' else '#33444b',width=2)
for ring in d['roadNetwork']['roundabouts']:
 if ring['id'] in [25053095,25053533]:dr.line([xy(*pt) for pt in ring['p']+[ring['p'][0]]],fill='#74cbb9',width=8)
dr.line([xy(x,z) for x,z in zip(p,q)],fill='#efcc75',width=5)
for i in range(70,len(p)-5,95):
 x,z=xy(p[i],q[i]);a,b=xy(p[i-4],q[i-4]);dx,dz=x-a,z-b;L=math.hypot(dx,dz) or 1;dx/=L;dz/=L;dr.polygon([(x+dx*8,z+dz*8),(x-dx*6-dz*5,z-dz*6+dx*5),(x-dx*6+dz*5,z-dz*6-dx*5)],fill='#fff3ce')
anchors=[('1 Faros start / finish',0),('2 A square',310),('3 B square',970),('4 Paraschou descent',1760),('5 Venizelou / 25is Martiou',2550),('6 Georgiou Stavrou',2970),('7 Bizaniou sharp right',3130),('8 Benaki / Areaki',3810),('9 Michalakopoulou',4050),('10 Kalari / park',4480),('11 Elikonos light',5055)]
for n,(label,s) in enumerate(anchors):
 i=min(len(p)-1,round(s/r['step']));x,z=xy(p[i],q[i]);dr.ellipse((x-12,z-12,x+12,z+12),fill='#eff7ef',outline='#142128',width=2);dr.text((x-7,z-10),str(n+1),font=font(15),fill='#142128')
 dr.text((1210,260+n*48),label,font=font(22),fill='#dce6df')
dr.text((44,34),'PSYCHIKO · FAROS CIRCUIT',font=font(36),fill='#ffffff');dr.text((44,86),f'{d["length"]/1000:.3f} km / lap · forward only · north up',font=font(25),fill='#efcc75')
dr.text((1210,850),'Gold: timed racing line',font=font(20),fill='#efcc75');dr.text((1210,882),'Mint: complete A / B rings',font=font(20),fill='#74cbb9');dr.text((1210,914),'Grey: free-roam surface roads',font=font(20),fill='#a2b4b6')
dr.text((44,1320),'Map data © OpenStreetMap contributors · ODbL · Geometry from the final shipped bundle',font=font(20),fill='#a2b4b6');im.save(ROOT/'route-overlay.webp','WEBP',quality=83,method=6)
# Matched evidence panes once headless captures exist.
if (H/'evidence.json').exists():
 ev=json.loads((H/'evidence.json').read_text())
 for row in ev['rows']:
  a=Image.open(H/(row['id']+'.png')).convert('RGB');b=Image.open(H/row['reference']).convert('RGB');a.thumbnail((800,400));b.thumbnail((800,400));im=Image.new('RGB',(1600,454),'#152129');im.paste(a,(0,44));im.paste(b,(800,44));dr=ImageDraw.Draw(im);dr.text((12,10),row['id']+' · Game · High',font=font(23),fill='white');dr.text((812,10),'Street View © Google',font=font(23),fill='white');dr.text((12,426),f'{row["lat"]:.7f}, {row["lon"]:.7f} · heading {row["heading"]}° · horizontal FOV 90° · approx. eye height 2.5 m',font=font(16),fill='#cdd6d5');im.save(ROOT/('sbs-'+row['id']+'.webp'),'WEBP',quality=78,method=6)
 frames=ev['frames'];im=Image.new('RGB',(1920,410*math.ceil(len(frames)/3)),'#152129');dr=ImageDraw.Draw(im)
 for i,f in enumerate(frames):
  x=(i%3)*640;y=(i//3)*410;im.paste(Image.open(H/f'lap-{i}.webp').convert('RGB'),(x,y));dr.text((x+8,y+368),f'AI {f["t"]:.0f} s · {f["s"]:.0f} m',font=font(22),fill='white')
 im.save(ROOT/'onboard-frame-strip.webp','WEBP',quality=76,method=6)
