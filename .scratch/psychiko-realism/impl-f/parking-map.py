"""Overhead map authored from OSM/lap geometry and the numeric parking survey, never reference imagery."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,math
p=Path(__file__).resolve().parent;d=json.load(open('data/maps/psychiko/map.json'));survey=json.load(open('tools/maps/psychiko/raw/parked-cars.json'));r=d['route'];W,H=1400,1350
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',21);small=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17);title=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',32)
x0,x1=min(r['x']),max(r['x']);z0,z1=min(r['z']),max(r['z']);k=min((W-240)/(x1-x0),(H-280)/(z1-z0));cx=(x0+x1)/2;cz=(z0+z1)/2
xy=lambda x,z:(int(W/2+(x-cx)*k),int(H/2+50+(z-cz)*k))
im=Image.new('RGB',(W,H),'#18242c');dr=ImageDraw.Draw(im)
for road in d['roadNetwork']['roads']:
 pts=[xy(x,z) for x,z in zip(road['p'][::2],road['p'][1::2])]
 if len(pts)>1:dr.line(pts,fill='#32454c',width=2)
route=[xy(x,z) for x,z in zip(r['x'],r['z'])];dr.line(route,fill='#a4adb0',width=5)
# Offset runs 10 map pixels so both kerbs remain legible at this scale.
for run in survey['runs']:
 pts=[];side=-1 if run['side']=='left' else 1
 for s in range(math.ceil(run['s0']),math.floor(run['s1'])+1,2):
  i=min(len(r['x'])-2,round(s/r['step']));j=(i+2)%(len(r['x'])-1);a=(i-2)%(len(r['x'])-1);tx=r['x'][j]-r['x'][a];tz=r['z'][j]-r['z'][a];L=math.hypot(tx,tz) or 1
  pts.append(xy(r['x'][i]-tz/L*side*10/k,r['z'][i]+tx/L*side*10/k))
 if len(pts)>1:dr.line(pts,fill='#73dbbe' if side<0 else '#f2bc72',width=2+round(run['density']*4))
for name,s,dx,dy in [('Faros',0,-80,5),('Proti Plateia',355,-140,0),('Diamantidou',800,20,0),('Paraschou',1770,-120,-30),('College wall',3320,18,0),('Benaki',3730,12,-25),('Michalakopoulou',4074,18,0),('Kallari park',4500,15,-20),('Kifisias',5240,10,10)]:
 i=round(s/r['step']);x,y=route[i];dr.ellipse((x-5,y-5,x+5,y+5),fill='#fff0d5');dr.text((x+dx,y+dy),name,font=font,fill='white',stroke_width=3,stroke_fill='#18242c')
dr.rectangle((0,0,W,135),fill='#18242c');dr.text((34,22),'PSYCHIKO · OBSERVED KERB PARKING',font=title,fill='white');dr.text((34,70),'Green = lap left    Amber = lap right    Line weight = estimated density',font=font,fill='#d0d7d7');dr.text((34,102),'Empty kerbs have no coloured run. Junction/crossing clearance trims the generated cars further.',font=small,fill='#acbcbe')
dr.rectangle((0,H-90,W,H),fill='#18242c');dr.text((34,H-78),'206 stations / 412 panes · 217 positive lap intervals · five queued cars on the opposite Faros approach',font=font,fill='white');dr.text((34,H-45),'Positions and occupancy are approximate. Map data © OpenStreetMap contributors / ODbL. No Google imagery.',font=small,fill='#acbcbe');dr.text((W-60,155),'N ↑',font=font,fill='white')
im.save(p/'parking-coverage-map.webp','WEBP',quality=88,method=6)
(p/'parking-coverage.json').write_text(json.dumps({'stations':len(survey['observations']),'panes':sum(len(r['views']) for r in survey['observations']),'lapRuns':len(survey['runs']),'positiveKerbMetres':round(sum(q['s1']-q['s0'] for q in survey['runs']),1),'sideRoads':survey['sideRoads'],'method':'Numeric manual observations with empty kerbs retained; map lines show positive candidate intervals, before geometry clearance.'},indent=2)+'\n')
