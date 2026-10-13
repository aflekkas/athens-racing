#!/usr/bin/env node
// Checks how closely the race route hugs the Saronic Gulf shoreline (data/map.json).
//   node tools/coast_check.mjs [--svg out.svg]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'map.json'), 'utf8'));
const r = d.route, N = r.x.length, st = r.step;
const segs = [];
for (const c of d.coast) for (let i = 0; i + 3 < c.length; i += 2) segs.push([c[i], c[i + 1], c[i + 2], c[i + 3]]);
function cd(x, z) {
  let bd = 1e18, side = 0;
  for (const s of segs) {
    const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - s[0]) * dx + (z - s[1]) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const px = s[0] + dx * t, pz = s[1] + dz * t, q = (x - px) ** 2 + (z - pz) ** 2;
    if (q < bd) { bd = q; side = [px, pz]; }
  }
  return [Math.sqrt(bd), side];
}
const rows = []; let worst = 0, sum = 0, n = 0;
for (let s = r.start; s <= r.finish; s += 100) {
  const i = Math.round(s / st); const x = r.x[i], z = r.z[i];
  const tx = r.x[Math.min(N - 1, i + 1)] - r.x[Math.max(0, i - 1)], tz = r.z[Math.min(N - 1, i + 1)] - r.z[Math.max(0, i - 1)];
  const [dd, p] = cd(x, z);
  // side of nearest shore point: + right of travel
  const rx = -tz, rz = tx; const sideR = ((p[0] - x) * rx + (p[1] - z) * rz) > 0 ? 'R' : 'L';
  rows.push(`${String(s - r.start).padStart(6)} m  shore ${dd.toFixed(0).padStart(5)} m  (${sideR})`);
  worst = Math.max(worst, dd); sum += dd; n++;
}
console.log(rows.join('\n'));
console.log(`race ${(r.finish - r.start)} m  mean shore distance ${(sum / n).toFixed(0)} m  worst ${worst.toFixed(0)} m`);
const si = process.argv.indexOf('--svg');
if (si > 0) {
  const xs = r.x.slice(Math.round(r.start / st), Math.round(r.finish / st)), zs = r.z.slice(Math.round(r.start / st), Math.round(r.finish / st));
  const x0 = Math.min(...xs) - 600, x1 = Math.max(...xs) + 600, z0 = Math.min(...zs) - 600, z1 = Math.max(...zs) + 600;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" width="900" height="${Math.round(900 * (z1 - z0) / (x1 - x0))}" style="background:#cfe3f0">`;
  for (const c of d.coast) { let p = ''; for (let i = 0; i < c.length; i += 2) p += `${c[i]},${c[i + 1]} `; svg += `<polyline points="${p}" fill="none" stroke="#a0662a" stroke-width="12"/>`; }
  let p = ''; for (let i = 0; i < xs.length; i += 5) p += `${xs[i]},${zs[i]} `; svg += `<polyline points="${p}" fill="none" stroke="#e01b1b" stroke-width="18"/>`;
  svg += '</svg>';
  fs.writeFileSync(process.argv[si + 1], svg);
}
