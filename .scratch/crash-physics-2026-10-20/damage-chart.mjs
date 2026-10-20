// node damage-chart.mjs before.json after.json out.webp : seconds lost over a 1.5 km flat-out sprint after each crash, before vs after the damage model
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/home/dev/projects/paraliaki-racing/node_modules/sharp');
const [bf, af, out] = process.argv.slice(2);
const B = JSON.parse(readFileSync(bf)), A = JSON.parse(readFileSync(af)), rows = A.filter(r => r.scenario !== 'undamaged');
const W = 1120, rowH = 34, top = 96, left = 330, H = top + rows.length * rowH + 40, max = 9, sx = v => left + (W - left - 90) * Math.min(v, max) / max;
let s = `<rect width="${W}" height="${H}" fill="#0e151b"/><text x="20" y="34" fill="#e8eef2" font-family="sans-serif" font-size="22" font-weight="600">Time lost to a crash over the next 1.5 km (Z4, flat out, no tow)</text>`;
s += `<rect x="20" y="48" width="14" height="14" fill="#e5594f"/><text x="40" y="60" fill="#b9c6cf" font-family="sans-serif" font-size="14">before (old model; a tow or reset wiped everything, so the real old cost was only the tow itself)</text><rect x="20" y="68" width="14" height="14" fill="#3fb97a"/><text x="40" y="80" fill="#b9c6cf" font-family="sans-serif" font-size="14">after (lasting damage, kept through a tow or reset)</text>`;
rows.forEach((r, i) => { const b = B.find(x => x.scenario === r.scenario), y = top + i * rowH;
  s += `<text x="${left - 10}" y="${y + 20}" fill="#b9c6cf" font-family="sans-serif" font-size="14" text-anchor="end">${r.scenario}</text>`;
  s += `<rect x="${left}" y="${y + 2}" width="${Math.max(2, sx(b.lossS) - left)}" height="12" fill="#e5594f"/>${b.lossS > max ? `<text x="${sx(b.lossS) - 6}" y="${y + 13}" fill="#0e151b" font-family="sans-serif" font-size="12" text-anchor="end">${b.lossS.toFixed(1)} s: the old model wrecked the engine, a tow repaired it</text>` : `<text x="${sx(b.lossS) + 6}" y="${y + 13}" fill="#e5594f" font-family="sans-serif" font-size="12">${b.lossS.toFixed(1)} s</text>`}`;
  s += `<rect x="${left}" y="${y + 16}" width="${Math.max(2, sx(r.lossS) - left)}" height="12" fill="#3fb97a"/><text x="${sx(r.lossS) + 6}" y="${y + 27}" fill="#3fb97a" font-family="sans-serif" font-size="12">${r.lossS.toFixed(1)} s</text>`; });
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s}</svg>`)).webp({ quality: 82 }).toFile(out);
