# Side-by-side evidence: headless game render (left) vs the matching Street View reference (right, labelled © Google).
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
H = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.dirname(H); tag = sys.argv[1]
OLD = '/Users/vassilisperrotis/.t3/worktrees/athens-street-racers/psychiko-realism/.scratch/psychiko-streetview/img'
NEW = os.path.join(OUT, '..', 'streetview', 'views')
try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 17)
except Exception: font = ImageFont.load_default()
for st in json.load(open(os.path.join(H, 'stations.json'))):
    game = Image.open(os.path.join(H, f"{tag}-{st['id']}.png")).convert('RGB')
    if st['id'].startswith('S'): ref = Image.open(os.path.join(OLD, st['id'] + '.png')).convert('RGB').crop((0, 48, 1024, 815))
    else: ref = Image.open(os.path.join(NEW, f"{st['id']}-{st['heading']:03d}.webp")).convert('RGB')
    w = 800; h = round(game.height * w / game.width)
    canvas = Image.new('RGB', (2 * w, h + 30), '#111'); canvas.paste(game.resize((w, h)), (0, 30)); canvas.paste(ref.resize((w, h)), (w, 30))
    d = ImageDraw.Draw(canvas)
    d.text((8, 6), f"Game (headless, High) · {st['id']} {st['label']} · heading {st['heading']}°", fill='#fff', font=font)
    d.text((w + 8, 6), "Street View © Google · reference only, not shipped", fill='#fff', font=font)
    canvas.save(os.path.join(OUT, f"sbs-{st['id']}.webp"), quality=72)
    print('wrote', f"sbs-{st['id']}.webp")
