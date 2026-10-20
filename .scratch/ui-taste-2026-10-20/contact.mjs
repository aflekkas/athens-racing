// node contact.mjs <before|after> : every <screen>/<phase>-1280x800.webp in a labelled 5-column grid -> contact-<phase>.webp
import { readdirSync, existsSync } from 'node:fs';
const sharp = (await import('/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs')).default;
const here = new URL('.', import.meta.url).pathname, phase = process.argv[2] || 'after';
const order = 'title signin account mode maps map-confirm spawn setup garage car-detail leaderboards settings-audio settings-video settings-driving settings-controls mp-browse mp-host mp-lobby pause results hud loading credits whats-new gate'.split(' ');
const shots = order.filter(s => existsSync(`${here}${s}/${phase}-1280x800.webp`));
const W = 480, H = 300, L = 30, C = 5, G = 12, rows = Math.ceil(shots.length / C);
const comp = [];
for (const [i, s] of shots.entries()) {
  const x = G + (i % C) * (W + G), y = G + Math.floor(i / C) * (H + L + G);
  comp.push({ input: await sharp(`${here}${s}/${phase}-1280x800.webp`).resize(W, H).toBuffer(), left: x, top: y + L });
  comp.push({ input: Buffer.from(`<svg width="${W}" height="${L}"><text x="0" y="21" font-family="sans-serif" font-size="17" fill="#c9d4dc">${s}</text></svg>`), left: x, top: y });
}
await sharp({ create: { width: G + C * (W + G), height: G + rows * (H + L + G), channels: 3, background: '#05080b' } }).composite(comp).webp({ quality: 80 }).toFile(`${here}contact-${phase}.webp`);
console.log(`contact-${phase}.webp`, shots.length);
