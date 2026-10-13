#!/usr/bin/env python3
"""Compose the foliage card atlases from the photographed leaf scans (assets/tex/leaves_*.webp, CC0 Poly Haven)
plus procedurally drawn needles / fronds / flowers.   python3 -I tools/make_foliage.py
  foliage_atlas.webp (1024x1024 RGBA): [citrus twig | oleander spray w/ flowers]
                                       [pine needle tufts | lentisk (maquis) sprigs]
  palm_frond.webp    (256x1024 RGBA): a pinnate Canary-palm frond, rachis along the vertical centre."""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, '..', 'assets', 'tex')
R = random.Random(7)
SS = 2  # supersampling

narrow = Image.open(os.path.join(TEX, 'leaves_narrow.webp')).convert('RGBA')
broad = Image.open(os.path.join(TEX, 'leaves_broad.webp')).convert('RGBA')
# lanceolate leaves in the narrow scan (x0, y0, x1, y1), base of the leaf at the bottom
NARROW = [(535, 325, 637, 870), (700, 415, 815, 845), (843, 368, 965, 840), (728, 36, 806, 425), (862, 32, 928, 390), (176, 296, 314, 885), (340, 415, 418, 808)]
# leaflet sprigs in the jacaranda scan
SPRIGS = [(330, 20, 1010, 480), (0, 330, 440, 720), (250, 600, 1024, 1024)]


def leaf_sprite(rect, w_scale=1.0, tint=(1, 1, 1), bright=1.0):
    x0, y0, x1, y1 = rect
    im = narrow.crop(rect)
    if w_scale != 1.0:
        im = im.resize((max(4, int(im.width * w_scale)), im.height), Image.LANCZOS)
    r, g, b, a = im.split()
    r = r.point(lambda v: min(255, int(v * tint[0] * bright)))
    g = g.point(lambda v: min(255, int(v * tint[1] * bright)))
    b = b.point(lambda v: min(255, int(v * tint[2] * bright)))
    a = a.point(lambda v: 255 if v > 150 else 0)
    return Image.merge('RGBA', (r, g, b, a))


def paste_rot(dst, spr, x, y, ang_deg, length):
    """paste sprite so that its base (bottom centre) sits at (x,y) pointing at ang (deg, 0=up)"""
    s = length / spr.height
    spr = spr.resize((max(2, int(spr.width * s)), max(2, int(spr.height * s))), Image.LANCZOS)
    # pad so the base is the rotation centre
    pad = Image.new('RGBA', (spr.width, spr.height * 2), (0, 0, 0, 0))
    pad.paste(spr, (0, 0))
    rot = pad.rotate(-ang_deg, resample=Image.BICUBIC, expand=True)
    dst.alpha_composite(rot, (int(x - rot.width / 2), int(y - rot.height / 2)))


def stem(d, pts, w, col):
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=col, width=w)


def citrus(size):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k in range(3):
        bx, by = size * (0.3 + 0.2 * k) + R.uniform(-20, 20), size * 0.98
        ang0 = R.uniform(-25, 25)
        pts = []
        for i in range(14):
            t = i / 13
            a = math.radians(ang0 + math.sin(t * 3 + k) * 12)
            pts.append((bx + math.sin(a) * t * size * 0.8, by - math.cos(a) * t * size * 0.85))
        stem(d, pts, 3 * SS // 2 + 2, (92, 84, 52, 255))
        for i in range(2, 14):
            x, y = pts[i]
            side = 1 if i % 2 else -1
            spr = leaf_sprite(R.choice(NARROW), w_scale=1.9, tint=(0.62, 0.85, 0.5), bright=R.uniform(0.75, 1.05))
            paste_rot(im, spr, x, y, ang0 + side * R.uniform(40, 70), size * R.uniform(0.17, 0.24) * (1.15 - 0.5 * i / 14))
        # a couple of bitter oranges are added as instanced spheres in-game; here just leaves
    return im


def flower(d, x, y, r, col):
    for p in range(5):
        a = p / 5 * math.tau + R.uniform(-0.2, 0.2)
        cx, cy = x + math.cos(a) * r * 0.55, y + math.sin(a) * r * 0.55
        d.ellipse([cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55], fill=col)
    d.ellipse([x - r * 0.22, y - r * 0.22, x + r * 0.22, y + r * 0.22], fill=(235, 225, 190, 255))


def oleander(size):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k in range(4):
        bx, by = size * (0.2 + 0.2 * k) + R.uniform(-15, 15), size * 0.99
        ang0 = R.uniform(-20, 20) + (k - 1.5) * 8
        top = None
        pts = []
        for i in range(10):
            t = i / 9
            a = math.radians(ang0)
            pts.append((bx + math.sin(a) * t * size * 0.75, by - math.cos(a) * t * size * 0.75))
        stem(d, pts, 4, (80, 92, 50, 255))
        for i in range(1, 10, 2):  # whorls of three leaves
            x, y = pts[i]
            for w in range(3):
                spr = leaf_sprite(R.choice(NARROW), w_scale=0.75, tint=(0.55, 0.78, 0.5), bright=R.uniform(0.62, 0.9))
                paste_rot(im, spr, x, y, ang0 + (w - 1) * 55 + R.uniform(-10, 10), size * R.uniform(0.22, 0.3))
        top = pts[-1]
        # terminal flower cluster (white: tinted per bush in the shader)
        for f in range(9):
            fx, fy = top[0] + R.uniform(-0.09, 0.09) * size, top[1] + R.uniform(-0.07, 0.05) * size
            flower(d, fx, fy, size * R.uniform(0.028, 0.04), (248, 246, 244, 255))
    return im


def needles(size):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k in range(5):
        bx, by = size * R.uniform(0.25, 0.75), size * 0.98
        ang = math.radians(R.uniform(-30, 30))
        L = size * R.uniform(0.6, 0.85)
        tx, ty = bx + math.sin(ang) * L, by - math.cos(ang) * L
        d.line([(bx, by), (tx, ty)], fill=(88, 70, 50, 255), width=5)
        n = 70
        for i in range(n):
            t = 0.15 + 0.85 * i / n
            x, y = bx + (tx - bx) * t, by + (ty - by) * t
            for j in range(2):
                a = ang + R.uniform(-1.3, 1.3) * (1.1 - t * 0.4)
                nl = size * R.uniform(0.09, 0.15) * (1.2 - 0.4 * t)
                g = R.randint(85, 130)
                col = (int(g * 0.62), int(g * 0.9), int(g * 0.45), 255)
                d.line([(x, y), (x + math.sin(a) * nl, y - math.cos(a) * nl)], fill=col, width=2)
        # tip tuft
        for j in range(40):
            a = ang + R.uniform(-0.8, 0.8)
            nl = size * R.uniform(0.08, 0.14)
            g = R.randint(95, 140)
            d.line([(tx, ty), (tx + math.sin(a) * nl, ty - math.cos(a) * nl)], fill=(int(g * 0.6), g, int(g * 0.4), 255), width=2)
    return im


def lentisk(size):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for k in range(5):
        rect = R.choice(SPRIGS)
        spr = broad.crop(rect)
        r, g, b, a = spr.split()
        a = a.point(lambda v: 255 if v > 150 else 0)
        spr = Image.merge('RGBA', (r.point(lambda v: int(v * 0.62)), g.point(lambda v: int(v * 0.74)), b.point(lambda v: int(v * 0.5)), a))
        s = size * R.uniform(0.55, 0.8) / max(spr.width, spr.height)
        spr = spr.resize((int(spr.width * s), int(spr.height * s)), Image.LANCZOS).rotate(R.uniform(0, 360), expand=True, resample=Image.BICUBIC)
        im.alpha_composite(spr, (int(R.uniform(0, size - spr.width)) if spr.width < size else 0, int(R.uniform(0, size - spr.height)) if spr.height < size else 0))
    return im


def frond(w, h):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = w / 2
    d.line([(cx, h), (cx, 4)], fill=(150, 140, 80, 255), width=7)
    y = h - 30
    i = 0
    while y > 10:
        t = 1 - y / h  # 0 at base, 1 at tip
        L = (w / 2 - 4) * (math.sin(math.pi * min(1, t * 1.1 + 0.1)) ** 0.55)
        for side in (-1, 1):
            ang = math.radians(R.uniform(42, 58))
            ex, ey = cx + side * L * math.sin(ang), y - L * math.cos(ang) * 0.9
            g = R.randint(95, 140)
            yell = 1.0 + 0.25 * (1 - t) * R.random()
            col = (int(g * 0.62 * yell), int(g * 0.85), int(g * 0.34), 255)
            wid = max(4, int(15 * (1 - 0.55 * t)))
            # leaflet: narrow lens shape
            mx, my = (cx + ex) / 2, (y + ey) / 2
            nx, ny = -(ey - y), (ex - cx)
            nl = math.hypot(nx, ny) or 1
            nx, ny = nx / nl * wid / 2, ny / nl * wid / 2
            d.polygon([(cx + side * 3, y), (mx + nx, my + ny), (ex, ey), (mx - nx, my - ny)], fill=col)
            d.line([(cx + side * 3, y), (ex, ey)], fill=(int(col[0] * 0.8), int(col[1] * 0.8), int(col[2] * 0.8), 255), width=1)
        y -= R.uniform(6, 8)
        i += 1
    return im


atlas = Image.new('RGBA', (1024 * SS // SS, 1024), (0, 0, 0, 0))
atlas.alpha_composite(citrus(512), (0, 0))
atlas.alpha_composite(oleander(512), (512, 0))
atlas.alpha_composite(needles(512), (0, 512))
atlas.alpha_composite(lentisk(512), (512, 512))
# bleed colour into transparent texels so mipmaps don't fringe dark
rgb = atlas.convert('RGB')
blur = rgb.filter(ImageFilter.GaussianBlur(6))
a = atlas.getchannel('A')
base = Image.composite(rgb, blur, a)
out = base.copy(); out.putalpha(a)
out.save(os.path.join(TEX, 'foliage_atlas.webp'), 'WEBP', quality=86, method=6)
fr = frond(256, 1024)
rgb = fr.convert('RGB'); a = fr.getchannel('A')
base = Image.composite(rgb, rgb.filter(ImageFilter.GaussianBlur(5)), a)
# give background the leaf colour
bg = Image.new('RGB', fr.size, (70, 90, 40))
base = Image.composite(base, bg, a.point(lambda v: 255 if v > 0 else 0))
base.putalpha(a)
base.save(os.path.join(TEX, 'palm_frond.webp'), 'WEBP', quality=86, method=6)
print('ok')
