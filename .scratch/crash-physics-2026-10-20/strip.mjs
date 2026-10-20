// node strip.mjs <dir with path-{before,after}-{wall-glance30,wall-headon}.json> out.webp : before/after hit strips drawn from bench traces
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/home/dev/projects/paraliaki-racing/node_modules/sharp');
const [dir, out] = process.argv.slice(2);
const load = (w, t) => JSON.parse(readFileSync(`${dir}/path-${w}-${t}.json`)).find(r => r.contact);
const COL = { before: '#e5594f', after: '#3fb97a' };
function top(r, W, H, ox, oy, col, title, note) {
  const [hl, hw] = r.dims, f = r.firstFrame, fr = [f - 12, f, f + 8, f + 16, f + 28, f + 44, f + 60].filter(i => i >= 0 && i < r.path.length);
  const pts = fr.map(i => r.path[i]);
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), pad = 4;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
  const s = Math.min((W - 40) / (x1 - x0), (H - 90) / (z1 - z0)), X = x => ox + 20 + (x - x0) * s, Z = z => oy + 60 + (z - z0) * s;
  let g = `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" rx="8" fill="#18202b"/><text x="${ox + 16}" y="${oy + 28}" fill="#fff" font-size="19" font-weight="bold">${title}</text><text x="${ox + 16}" y="${oy + 48}" fill="#9ab" font-size="14">${note}</text><clipPath id="c${ox}${oy}"><rect x="${ox}" y="${oy + 82}" width="${W}" height="${H - 82}"/></clipPath><g clip-path="url(#c${ox}${oy})">`;
  // wall: 30 degrees to the path, through (0.8, -60)
  const a = 30 * Math.PI / 180, t = [Math.sin(a), -Math.cos(a)], L = 80;
  g += `<line x1="${X(0.8 - t[0] * L)}" y1="${Z(-60 - t[1] * L)}" x2="${X(0.8 + t[0] * L)}" y2="${Z(-60 + t[1] * L)}" stroke="#aab" stroke-width="5"/>`;
  fr.forEach((i, k) => {
    const p = r.path[i], [x, z, yaw] = p, c = Math.cos(yaw), sn = Math.sin(yaw);
    const corner = (a, b) => [X(x - sn * a + c * b), Z(z - c * a - sn * b)];
    const poly = [corner(hl, -hw), corner(hl, hw), corner(-hl, hw), corner(-hl, -hw)].map(q => q.join(',')).join(' ');
    g += `<polygon points="${poly}" fill="${col}" fill-opacity="${0.18 + 0.7 * (k + 1) / fr.length}" stroke="#fff" stroke-opacity="0.5"/>`;
    const n = corner(hl, 0), m = corner(hl * 0.55, 0); g += `<line x1="${m[0]}" y1="${m[1]}" x2="${n[0]}" y2="${n[1]}" stroke="#fff" stroke-width="2"/>`;
  });
  const last = r.path[fr.at(-1)]; g += `</g><text x="${ox + 16}" y="${oy + 72}" fill="${col}" font-size="17" font-weight="bold">${(r.path[f - 1][6] * 3.6).toFixed(0)} km/h in, ${(last[6] * 3.6).toFixed(0)} km/h 1 s later</text>`;
  return g;
}
function side(r, W, H, ox, oy, col, title, note) {
  const [hl] = r.dims, f = r.firstFrame, idx = []; for (let i = Math.max(0, f - 6); i < Math.min(r.path.length, f + 75); i += 5) idx.push(i);
  const zs = idx.map(i => r.path[i][1]), z0 = Math.min(...zs) - 5, z1 = Math.max(-60, ...zs) + 3, ymax = Math.max(1.8, ...idx.map(i => r.path[i][3] + 1.6));
  const s = Math.min((W - 40) / (z1 - z0), (H - 125) / ymax), X = z => ox + 20 + (z1 - z) * s, Y = y => oy + H - 30 - y * s;
  let g = `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" rx="8" fill="#18202b"/><text x="${ox + 16}" y="${oy + 28}" fill="#fff" font-size="19" font-weight="bold">${title}</text><text x="${ox + 16}" y="${oy + 48}" fill="#9ab" font-size="14">${note}</text><clipPath id="s${ox}${oy}"><rect x="${ox}" y="${oy + 82}" width="${W}" height="${H - 82}"/></clipPath><g clip-path="url(#s${ox}${oy})">`;
  g += `<line x1="${ox + 10}" y1="${Y(0)}" x2="${ox + W - 10}" y2="${Y(0)}" stroke="#667" stroke-width="2"/><rect x="${X(-60) - 4}" y="${Y(ymax)}" width="8" height="${Y(0) - Y(ymax)}" fill="#aab"/>`;
  let top = 0;
  idx.forEach((i, k) => {
    const [x, z, yaw, y, pitch] = r.path[i]; top = Math.max(top, y);
    const cx = X(z), cy = Y(y + 0.75), w = 2 * hl * s, h = 1.4 * s, ang = (-pitch * 180 / Math.PI);
    g += `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="6" fill="${col}" fill-opacity="${0.12 + 0.6 * (k + 1) / idx.length}" stroke="#fff" stroke-opacity="0.4" transform="rotate(${ang} ${cx} ${cy})"/>`;
  });
  g += `</g><text x="${ox + 16}" y="${oy + 72}" fill="${col}" font-size="17" font-weight="bold">car rises ${top.toFixed(2)} m off the road</text>`;
  return g;
}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" font-family="DejaVu Sans, sans-serif"><rect width="1280" height="800" fill="#10151c"/><text x="40" y="46" fill="#fff" font-size="28" font-weight="bold">Same crash, 100 km/h Z4, before (left) and after (right)</text>`;
for (const [k, w] of [[0, 'before'], [1, 'after']]) {
  const ox = 40 + k * 620;
  svg += top(load(w, 'wall-glance30'), 580, 330, ox, 70, COL[w], `${w}: 30° glance on a wall (top view)`, 'car outlines every ~0.15-0.25 s, brighter = later; white line = nose');
  svg += side(load(w, 'wall-headon'), 580, 350, ox, 420, COL[w], `${w}: head-on into a wall (side view)`, 'car body every 5 frames (1/12 s), brighter = later');
}
svg += '</svg>';
await sharp(Buffer.from(svg)).webp({ quality: 80 }).toFile(out);
