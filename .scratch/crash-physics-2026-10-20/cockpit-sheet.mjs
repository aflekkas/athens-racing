// node cockpit-sheet.mjs <shots dir> out.webp : the cockpit view after a 60 km/h head-on and a 60 km/h door hit, before vs after the cockpit shows the damage
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/home/dev/projects/paraliaki-racing/node_modules/sharp');
const [dir, out] = process.argv.slice(2);
const rows = [['clean', 'undamaged (the same view both times)'], ['front60', '60 km/h head-on'], ['side60', '60 km/h door hit, driver side']], W = 640, H = 400, top = 38, gap = 6, lab = 28;
const layers = [];
for (const [r, [name]] of rows.entries()) for (const [c, tag] of ['before', 'after'].entries()) layers.push({ input: await sharp(`${dir}/${tag}-${name}-cockpit-1280.png`).resize(W, H).toBuffer(), left: c * (W + gap), top: top + r * (H + lab + gap) + lab });
const t = (x, y, s, c, z = 16) => `<text x="${x}" y="${y}" fill="${c}" font-family="sans-serif" font-size="${z}" font-weight="600">${s}</text>`;
const total = top + rows.length * (H + lab + gap);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * W + gap}" height="${total}">${t(8, 26, 'BEFORE: the cockpit ignores the crash', '#e5594f', 18)}${t(W + gap + 8, 26, 'AFTER: bonnet, pillar, glass and mirror show it', '#3fb97a', 18)}` + rows.map(([, l], r) => t(8, top + r * (H + lab + gap) + 20, l, '#b9c6cf')).join('') + '</svg>';
await sharp({ create: { width: 2 * W + gap, height: total, channels: 3, background: '#0e151b' } }).composite([...layers, { input: Buffer.from(svg), left: 0, top: 0 }]).webp({ quality: 85 }).toFile(out);
