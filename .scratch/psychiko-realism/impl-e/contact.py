"""Reference-only contact sheets; raw Street View © Google downloads can be refetched with survey.py."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,math
p=Path(__file__).resolve().parent;rows=json.loads((p/'references/stations.json').read_text())
f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
def sheet(rows,name):
 im=Image.new('RGB',(2048,320*math.ceil(len(rows)/2)),'#172128');dr=ImageDraw.Draw(im)
 for i,r in enumerate(rows):
  for k,v in enumerate(r['views']):
   x=(i%2)*1024+k*512;y=(i//2)*320;im.paste(Image.open(p/'references'/v['path']).resize((512,256)),(x,y+44));dr.text((x+5,y+4),f'{r["id"]} {v["heading"]}° Street View © Google',font=f,fill='white')
  dr.text(((i%2)*1024+5,(i//2)*320+300),r.get('street','Faros across'),font=f,fill='white')
 im.save(p/name,'WEBP',quality=80)
regular=[r for r in rows if not r['id'].startswith('jct-')]
for start in range(0,len(regular),24):sheet(regular[start:start+24],f'survey-{start//24+1:02}.webp')
first=[r for r in rows if r['reason'].startswith('public lap junction')]
for start in range(0,len(first),14):sheet(first[start:start+14],f'junction-survey-{start//14+1:02}.webp')
last=[r for r in rows if r['reason'].startswith('public junction at source node')];sheet(last,'junction-survey-03.webp')
print(len(regular),len(first),len(last),'stations; all',sum(len(r['views']) for r in rows),'panes')
