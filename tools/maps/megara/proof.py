#!/usr/bin/env python3
"""Compose local factual reference comparisons; source images are never game assets.

Run after tools/maps-browser-test.mjs. Pillow is only needed for this optional
review artifact. SOURCES.md records provenance and camera-position uncertainty.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.scratch/megara'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
large = ImageFont.truetype(FONT, 23)
small = ImageFont.truetype(FONT, 16)
spots = [
    (260, '00', 'First left complex exit'),
    (510, '07', 'Western hairpin / pit sheds'),
    (700, '15', 'Northwest corner / back straight entry'),
    (1000, '22', 'Back straight'),
    (1290, '30', 'Eastern hairpin'),
    (1670, '40', 'Southwest approach / clubhouse'),
    (1900, '50', 'Final right / timing straight entry'),
    (0, '55', 'Timing and pit straight'),
]
# Reject a blank WebGL frame even when the HTML credit overlay rendered normally.
for station, _, _ in spots:
    with Image.open(OUT / f'ingame-{station}.png') as picture:
        w, h = picture.size
        scene = picture.convert('RGB').crop((w//10, h//10, w*9//10, h*9//10))
        if sum(ImageStat.Stat(scene).var) < 25:
            raise RuntimeError(f'Blank scene at {station} m; recapture before making comparisons')
thumbs = []
for index, (station, second, title) in enumerate(spots, 1):
    canvas = Image.new('RGB', (1640, 640), '#111b23')
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 14), f'{index:02}  MEGARA — {title} · approximately {station} m', font=large, fill='white')
    for x, source, label in [
        (20, OUT / f'references/onboard-{second}.jpg', f'REFERENCE · Ioannis Marinakis Racing · video 00:{second}'),
        (840, OUT / f'ingame-{station}.png', 'IN GAME · georeferenced route · camera height 1.65 m'),
    ]:
        draw.text((x, 58), label, font=small, fill='#b4c7d1')
        picture = ImageOps.contain(Image.open(source).convert('RGB'), (780, 488))
        canvas.paste(picture, (x + (780 - picture.width)//2, 86 + (488-picture.height)//2))
    draw.text((20, 592), 'Matching track sections, not matched telemetry: rider lean, field of view and season differ.', font=small, fill='#b4c7d1')
    draw.text((20, 617), 'Reference: youtube.com/watch?v=DTiXBVgxxuY · geometry: OSM way 70043234 · limitations: tools/maps/megara/SOURCES.md', font=small, fill='#b4c7d1')
    path = OUT / f'comparison-{index:02}.png'
    canvas.save(path)
    thumbs.append(ImageOps.contain(canvas, (820, 320)))
contact = Image.new('RGB', (1640, 1280), '#111b23')
for index, thumb in enumerate(thumbs):
    contact.paste(thumb, ((index % 2)*820, (index//2)*320))
contact.save(OUT / 'comparison-contact.png')
print(f'Wrote {len(spots)} paired comparisons and comparison-contact.png in {OUT}')
