"""Contact sheets and readable audit table from the browser audit JSON."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
out=Path('.scratch/pov-camera'); fixture='--fixture' in sys.argv
rows=json.loads((out/('mask-audit.json' if fixture else 'audit.json')).read_text())
if fixture:
 for r in rows:
  for phase in ['before','after']:
   r[phase]={**r[phase], **r[phase]['geometryAudit']}
prefix='fixture-' if fixture else ''; suffix='-image' if fixture else ''
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
for start in range(0,len(rows),4):
 sheet=Image.new('RGB',(1280,4*430),(18,22,26));draw=ImageDraw.Draw(sheet)
 for j,row in enumerate(rows[start:start+4]):
  for k,phase in enumerate(['before','after']):
   im=Image.open(out/f'{phase}-{row["id"]}{suffix}.png').convert('RGB');im.thumbnail((640,400));sheet.paste(im,(k*640,j*430+30));a=row[phase]
   draw.text((k*640+8,j*430+5),f'{row["id"]} · {phase} · clear {a["windscreenPercent"]:.1f}%',font=font,fill='white')
 sheet.save(out/f'{prefix}contact-{start//4+1:02}.webp',quality=88)
lines=['| Config | Windscreen % before → after | Eye Y before → after (m) | Road % before → after | Rim occlusion % | Telltales blocked | Horizon % from top | Header intrusion % | Flags |','|---|---:|---:|---:|---:|---:|---:|---:|---|']
for r in rows:
 b,a=r['before'],r['after'];lines.append(f'| {r["id"]} | {b["windscreenPercent"]:.2f} → {a["windscreenPercent"]:.2f} | {b["eye"][1]:.3f} → {a["eye"][1]:.3f} | {b["roadVisible"]:.1f} → {a["roadVisible"]:.1f} | {a["rimOcclusion"]:.1f} | {a["telltalesBlocked"]} | {a["horizonFromTop"]:.1f} | {a["headerIntrusion"]:.1f} | {", ".join(a["flags"]) or "pass"} |')
(out/f'{prefix}audit-table.md').write_text('\n'.join(lines)+'\n')
