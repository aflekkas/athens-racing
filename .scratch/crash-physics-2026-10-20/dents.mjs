// node dents.mjs <old .scratch/damage dir> <new .scratch/damage dir> out.webp : same Z4 crash, dent depth before vs after the damage model (tools/damage-visual.mjs frames)
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/home/dev/projects/paraliaki-racing/node_modules/sharp');
const [oldDir, newDir, out] = process.argv.slice(2);
const rows = [['front30', '30 km/h head-on'], ['front60', '60 km/h head-on'], ['side50', '50 km/h side hit']];
const W = 640, H = 400, L = { left: 300, top: 290, width: 700, height: 400 }, top = 44, gap = 8;
const cell = async (dir, id) => sharp(`${dir}/z4-${id}-after.png`).extract(L).resize(W, H).toBuffer();
const layers = [];
for (const [i, [id]] of rows.entries()) {
  layers.push({ input: await cell(oldDir, id), left: 0, top: top + i * (H + gap) });
  layers.push({ input: await cell(newDir, id), left: W + gap, top: top + i * (H + gap) });
}
const total = top + rows.length * (H + gap);
const label = (x, y, t, c, sz = 22) => `<text x="${x}" y="${y}" fill="${c}" font-family="sans-serif" font-size="${sz}" font-weight="600">${t}</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * W + gap}" height="${total}">${label(12, 30, 'BEFORE: old dents', '#e5594f')}${label(W + gap + 12, 30, 'AFTER: dents show sooner and deeper', '#3fb97a')}` +
  rows.map(([, t], i) => label(12, top + i * (H + gap) + H - 14, t, '#1b2b36', 20)).join('') + '</svg>';
await sharp({ create: { width: 2 * W + gap, height: total, channels: 3, background: '#0e151b' } }).composite([...layers, { input: Buffer.from(svg), left: 0, top: 0 }]).webp({ quality: 82 }).toFile(out);
