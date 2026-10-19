// node sheet.mjs <out.webp> <tileW> <cols> label=file label=file ...  : a labelled contact sheet of images
import sharp from 'sharp';
const [out, tw, cols, ...items] = process.argv.slice(2), W = +tw, lh = 26;
const tiles = [];
for (const it of items) { const i = it.indexOf('='), label = it.slice(0, i), file = it.slice(i + 1); const img = sharp(file).resize({ width: W }); const meta = await img.clone().toBuffer({ resolveWithObject: true }); tiles.push({ label, buf: meta.data, h: meta.info.height }); }
const H = Math.max(...tiles.map(t => t.h)) + lh, rows = Math.ceil(tiles.length / +cols);
await sharp({ create: { width: W * +cols, height: H * rows, channels: 3, background: '#000' } }).composite(tiles.flatMap((t, i) => [
  { input: t.buf, left: (i % +cols) * W, top: Math.floor(i / +cols) * H + lh },
  { input: Buffer.from(`<svg width="${W}" height="${lh}"><text x="8" y="19" font-size="15" font-family="monospace" fill="#fff">${t.label}</text></svg>`), left: (i % +cols) * W, top: Math.floor(i / +cols) * H }])).webp({ quality: 88 }).toFile(out);
console.log('wrote', out);
