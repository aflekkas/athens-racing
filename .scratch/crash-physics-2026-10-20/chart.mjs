// node chart.mjs before.json after.json out.webp "title" : bench before/after chart (SVG -> webp through sharp, no browser)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/home/dev/projects/paraliaki-racing/node_modules/sharp');
const [bf, af, out] = process.argv.slice(2), B = JSON.parse(readFileSync(bf)), A = JSON.parse(readFileSync(af));
const find = (rows, tag, kmh, car = 'z4') => rows.find(r => r.tag === tag && r.kmh === kmh && (r.car ?? car) === car && r.contact);
const SP = [60, 100, 160];
const panels = [
  { t: 'Head-on wall: lift off the ground (m)', f: r => r.liftM, tag: 'wall-headon', max: 8, fmt: v => v.toFixed(1) },
  { t: '30° wall glance: peak roll (°)', f: r => r.peakRollDeg, tag: 'wall-glance30', max: 180, fmt: v => v.toFixed(0) },
  { t: '30° wall glance: speed kept after 1 s (%)', f: r => 100 * r.speedAt1sKmh / r.entrySpeed, tag: 'wall-glance30', max: 100, fmt: v => v.toFixed(0) },
  { t: '30° bridge rail: speed kept after 1 s (%)', f: r => 100 * r.speedAt1sKmh / r.entrySpeed, tag: 'athens-rail-glance30', max: 100, fmt: v => v.toFixed(0) },
];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" font-family="DejaVu Sans, sans-serif"><rect width="1280" height="800" fill="#10151c"/>
<text x="40" y="52" fill="#fff" font-size="30" font-weight="bold">Crash bench, Z4 · before (prod 41895c7d) vs after</text>
<g font-size="16"><rect x="40" y="70" width="18" height="18" fill="#e5594f"/><text x="66" y="85" fill="#ddd">before</text><rect x="140" y="70" width="18" height="18" fill="#3fb97a"/><text x="166" y="85" fill="#ddd">after</text><text x="260" y="85" fill="#9ab">bars: 60 / 100 / 160 km/h per panel</text></g>`;
panels.forEach((p, i) => {
  const x0 = 40 + (i % 2) * 620, y0 = 120 + Math.floor(i / 2) * 340, w = 580, h = 290;
  svg += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="8" fill="#18202b"/><text x="${x0 + 16}" y="${y0 + 30}" fill="#fff" font-size="19" font-weight="bold">${p.t}</text>`;
  SP.forEach((kmh, k) => {
    const gx = x0 + 30 + k * 185, base = y0 + h - 40, top = y0 + 55, H = base - top;
    [[B, '#e5594f'], [A, '#3fb97a']].forEach(([rows, col], j) => {
      const r = find(rows, p.tag, kmh); const v = r ? p.f(r) : 0, bh = Math.max(2, H * Math.min(1, v / p.max));
      svg += `<rect x="${gx + j * 78}" y="${base - bh}" width="68" height="${bh}" fill="${col}" rx="3"/><text x="${gx + j * 78 + 34}" y="${base - bh - 6}" fill="#fff" font-size="16" text-anchor="middle">${p.fmt(v)}</text>`;
    });
    svg += `<text x="${gx + 73}" y="${base + 24}" fill="#9ab" font-size="16" text-anchor="middle">${kmh} km/h</text>`;
  });
});
svg += `</svg>`;
await sharp(Buffer.from(svg)).webp({ quality: 80 }).toFile(out);
