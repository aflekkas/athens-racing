// node hud-sheet.mjs <ui-shots dir> out.webp : the crash-damage lane card, before vs after the fix, at 1280x800, 1440x900 and 1920x1080 (crop of the top-left corner, 1:1)
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/home/dev/projects/paraliaki-racing/node_modules/sharp');
const [dir, out] = process.argv.slice(2);
const cols = [['before', 'hit60-chase', 'BEFORE: after a 60 km/h hit'], ['after', 'hit60-chase', 'AFTER: after a 60 km/h hit (quiet: dial label only)'], ['before', 'stalled-chase', 'BEFORE: engine stopped'], ['after', 'stalled-tow-chase', 'AFTER: engine stopped']];
const sizes = [1280, 1440, 1920], W = 420, H = 400, top = 40, rowLabel = 30, gap = 6;
const layers = [];
for (const [r, w] of sizes.entries()) for (const [c, [tag, name]] of cols.entries()) layers.push({ input: await sharp(`${dir}/${tag}-${name}-${w}.png`).extract({ left: 0, top: 0, width: W, height: H }).toBuffer(), left: c * (W + gap), top: top + r * (H + rowLabel + gap) + rowLabel });
const label = (x, y, t, c = '#e8eef2', s = 18) => `<text x="${x}" y="${y}" fill="${c}" font-family="sans-serif" font-size="${s}" font-weight="600">${t}</text>`;
const total = top + sizes.length * (H + rowLabel + gap);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols.length * (W + gap)}" height="${total}">` + cols.map(([t, , l], c) => label(c * (W + gap) + 8, 27, l, t === 'before' ? '#e5594f' : '#3fb97a', 15)).join('') + sizes.map((w, r) => label(8, top + r * (H + rowLabel + gap) + 21, `${w} x ${w === 1280 ? 800 : w === 1440 ? 900 : 1080}`, '#b9c6cf', 15)).join('') + '</svg>';
await sharp({ create: { width: cols.length * (W + gap), height: total, channels: 3, background: '#0e151b' } }).composite([...layers, { input: Buffer.from(svg), left: 0, top: 0 }]).webp({ quality: 85 }).toFile(out);
