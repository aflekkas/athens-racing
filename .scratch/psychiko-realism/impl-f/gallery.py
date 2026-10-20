from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,math
p=Path(__file__).resolve().parent;rows=json.loads((p/'game-capture.json').read_text())['gallery'];f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',21)
im=Image.new('RGB',(1600,math.ceil(len(rows)/3)*375),'#172128');dr=ImageDraw.Draw(im)
for i,r in enumerate(rows):
 shot=Image.open(p/r['path']);assert shot.size==(1600,1000)
 x=i%3*533;y=i//3*375;im.paste(shot.resize((533,333)),(x,y+36));dr.text((x+8,y+7),r['name'].split('-',1)[1].replace('-',' ').title(),font=f,fill='white')
im.save(p/'screenshots-contact-sheet.webp','WEBP',quality=86,method=6)
(p/'screenshots/index.json').write_text(json.dumps(rows,indent=2)+'\n')
# Self-contained local review uses image paths; no remote requests or reference inputs.
html='<meta charset="utf-8"><title>Psychiko review F</title><style>body{background:#172128;color:#eee;font:16px system-ui;margin:30px}img{width:100%;height:auto}a{color:#91d4ce}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}figure{margin:0}figcaption{padding:8px}</style><h1>Psychiko · Faros, houses and parking</h1><p>39 comparisons use the e99e37c1 baseline and the same panorama positions/headings. Street View © Google · reference only.</p><div class="gallery">'
for r in rows:html+=f'<figure><a href="{r["path"]}"><img loading="lazy" src="{r["path"]}"></a><figcaption>{r["name"]}</figcaption></figure>'
html+='</div><h2>Observed parking</h2><img src="parking-coverage-map.webp"><h2>Before / After / Street View</h2>'
for r in json.loads((p/'comparisons.json').read_text()):html+=f'<p>{r["id"]}</p><a href="{r["path"]}"><img loading="lazy" src="{r["path"]}"></a>'
(p/'review.html').write_text(html)
