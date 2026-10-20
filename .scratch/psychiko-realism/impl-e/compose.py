"""Evidence only: before / final production world / Street View © Google, in lap order."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
rows = json.loads((root / 'capture-stations.json').read_text())
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 24)
small = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 18)
comparisons = []
for row in rows:
    name = row['id']
    canvas = Image.new('RGB', (2400, 448), '#172128')
    draw = ImageDraw.Draw(canvas)
    paths = [root / f'harness/before-{name}.webp', root / f'harness/after-{name}.webp', root / 'references' / row['view']['path']]
    labels = ['Before · c4df524e', 'After · surveyed Psychiko', 'Street View © Google · reference only']
    for i, (path, label) in enumerate(zip(paths, labels)):
        canvas.paste(Image.open(path).convert('RGB').resize((800, 400)), (i * 800, 44))
        draw.text((i * 800 + 12, 9), label, fill='white', font=font)
    dest = f'sbs-{name}.webp'
    canvas.save(root / dest, 'WEBP', quality=84, method=6)
    comparisons.append({'id':name, 'path':dest, 's':row.get('s'), 'reference':row['view']['mapsUrl']})

sheet = Image.new('RGB', (1800, math.ceil(len(comparisons) / 2) * 194), '#172128')
draw = ImageDraw.Draw(sheet)
for i, row in enumerate(comparisons):
    x, y = i % 2 * 900, i // 2 * 194
    sheet.paste(Image.open(root / row['path']).resize((900, 168)), (x, y+24))
    draw.text((x+8,y+2), row['id']+' · Before / After / Street View © Google', font=small, fill='white')
sheet.save(root/'contact-sheet.webp', 'WEBP', quality=83, method=6)

frames = json.loads((root/'harness/evidence-after.json').read_text())['frames']
strip = Image.new('RGB', (1920, math.ceil(len(frames)/3)*390), '#172128')
draw = ImageDraw.Draw(strip)
for i, frame in enumerate(frames):
    x,y=i%3*640,i//3*390
    strip.paste(Image.open(root/f'harness/lap-{i}.webp').resize((640,360)),(x,y+28))
    draw.text((x+9,y+3),f"AI onboard · {frame['t']:.0f} s · {frame['s']:.0f} m",font=small,fill='white')
strip.save(root/'onboard-frame-strip.webp','WEBP',quality=83,method=6)
(root/'comparisons.json').write_text(json.dumps(comparisons,indent=2)+'\n')
print(f'{len(comparisons)} comparisons; {len(frames)} physical AI lap frames')
(root/'captures-complete.json').write_text(json.dumps({'comparisons':len(comparisons),'frames':len(frames),'complete':True})+'\n')
