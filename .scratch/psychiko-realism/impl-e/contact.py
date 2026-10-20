from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,math
p=Path('.scratch/psychiko-realism/impl-e');rows=json.loads((p/'references/stations.json').read_text())
f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
for start in range(0,len(rows),24):
 rr=rows[start:start+24];im=Image.new('RGB',(2048,320*math.ceil(len(rr)/2)),'#172128');dr=ImageDraw.Draw(im)
 for i,r in enumerate(rr):
  for k,v in enumerate(r['views']):
   x=(i%2)*1024+k*512;y=(i//2)*320;a=Image.open(p/'references'/v['path']);a=a.resize((512,256));im.paste(a,(x,y+44));dr.text((x+5,y+4),f'{r["id"]} {v["heading"]}° Street View © Google',font=f,fill='white')
  dr.text(((i%2)*1024+5,(i//2)*320+300),r.get('street','Faros across'),font=f,fill='white')
 im.save(p/f'survey-{start//24+1:02}.webp','WEBP',quality=80)
print('Sheets',math.ceil(len(rows)/24))
