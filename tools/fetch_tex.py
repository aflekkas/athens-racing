#!/usr/bin/env python3
"""Download the CC0 PBR textures used by the game from Poly Haven (https://polyhaven.com, CC0) and
re-encode them as compact WebP into assets/tex/.  Run once:  python3 -I tools/fetch_tex.py
Staging happens in a temp dir; only the converted WebP files land in assets/tex."""
import json, os, sys, tempfile, urllib.request
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'tex')
STAGE = tempfile.mkdtemp(prefix='phtex-')
# id -> (maps, size)
TEX = {
    'asphalt_02': (['Diffuse', 'nor_gl', 'arm'], 1024),
    'floor_pavement': (['Diffuse', 'nor_gl', 'arm'], 1024),
    'concrete_floor_worn_001': (['Diffuse', 'nor_gl', 'arm'], 512),
    'painted_plaster_wall': (['Diffuse', 'nor_gl', 'arm'], 512),
    'dry_ground_01': (['Diffuse', 'nor_gl'], 512),
    'withered_grass': (['Diffuse', 'nor_gl'], 512),
    'coast_sand_01': (['Diffuse', 'nor_gl'], 512),
    'rock_face_03': (['Diffuse', 'nor_gl', 'arm'], 512),
    'palm_tree_bark': (['Diffuse', 'nor_gl'], 512),
    'pine_bark': (['Diffuse', 'nor_gl'], 512),
    'fabric_leather_02': (['nor_gl', 'arm'], 512),
}
# leaf atlases from model packs: (model id, diffuse key, alpha key)
LEAVES = {'leaves_broad': ('jacaranda_tree', 'leaves_diff', 'leaves_alpha'), 'leaves_narrow': ('shrub_02', 'Diffuse', 'Alpha')}
SHORT = {'Diffuse': 'diff', 'nor_gl': 'nor', 'arm': 'arm', 'Rough': 'rough'}

UA = {'User-Agent': 'paraliaki-asset-fetch/1.0'}
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return r.read()

def get(url, path):
    if not os.path.exists(path):
        open(path, 'wb').write(fetch(url))
    return path

def files(asset):
    return json.loads(fetch('https://api.polyhaven.com/files/' + asset))

os.makedirs(OUT, exist_ok=True)
for asset, (maps, size) in TEX.items():
    f = files(asset)
    for m in maps:
        url = f[m]['1k']['jpg']['url']
        src = get(url, os.path.join(STAGE, f'{asset}_{m}.jpg'))
        im = Image.open(src).convert('RGB')
        if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
        dst = os.path.join(OUT, f'{asset}_{SHORT[m]}.webp')
        im.save(dst, 'WEBP', quality=88 if m == 'nor_gl' else 82, method=6)
        print(dst, os.path.getsize(dst))
for name, (asset, dk, ak) in LEAVES.items():
    f = files(asset)
    d = Image.open(get(f[dk]['1k']['jpg']['url'], os.path.join(STAGE, f'{asset}_{dk}.jpg'))).convert('RGB')
    a = Image.open(get(f[ak]['1k']['jpg']['url'], os.path.join(STAGE, f'{asset}_{ak}.jpg'))).convert('L')
    d.putalpha(a)
    dst = os.path.join(OUT, f'{name}.webp')
    d.save(dst, 'WEBP', quality=85, method=6)
    print(dst, os.path.getsize(dst))
# water normals (three.js examples, MIT)
src = get('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/waternormals.jpg', os.path.join(STAGE, 'waternormals.jpg'))
Image.open(src).convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'waternormals.webp'), 'WEBP', quality=90, method=6)
print('done', STAGE)
