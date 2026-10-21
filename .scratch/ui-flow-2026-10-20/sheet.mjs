// node sheet.mjs OUT.webp label=dir/prefix ... : one row of step thumbnails per flow, labelled with its press count
import { readdirSync } from 'node:fs';
const sharp = (await import('/home/dev/projects/paraliaki-racing/node_modules/sharp/dist/index.cjs')).default;
const [out, ...rows] = process.argv.slice(2), W = 240, H = 150, G = 8, L = 220;
const list = rows.map(r => { const [label, path] = r.split('='), dir = path.slice(0, path.lastIndexOf('/')), prefix = path.slice(path.lastIndexOf('/') + 1);
  return { label, files: readdirSync(dir).filter(f => new RegExp(`^${prefix}-\\d\\d\\.png$`).test(f)).sort().map(f => dir + '/' + f) }; });
const cols = Math.max(...list.map(r => r.files.length)), comp = [];
for (const [y, r] of list.entries()) {
  comp.push({ input: Buffer.from(`<svg width="${L}" height="${H}"><text x="8" y="70" font-family="sans-serif" font-size="17" fill="#e4effa">${r.label}</text><text x="8" y="96" font-family="sans-serif" font-size="14" fill="#8fa3b3">${r.files.length - 1} presses</text></svg>`), left: 0, top: G + y * (H + G) });
  for (const [x, f] of r.files.entries()) comp.push({ input: await sharp(f).resize(W, H).toBuffer(), left: L + x * (W + G), top: G + y * (H + G) });
}
await sharp({ create: { width: L + cols * (W + G), height: G + list.length * (H + G), channels: 3, background: '#05080b' } }).composite(comp).webp({ quality: 78 }).toFile(out);
console.log(out, list.map(r => `${r.label}:${r.files.length - 1}`).join(' '));
