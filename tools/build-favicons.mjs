// Renders the favicon PNGs from assets/icon.svg (the ASR mark).
//   node tools/build-favicons.mjs        (needs `sharp`, which wrangler already installs under node_modules)
// Outputs: assets/icon-16.png and icon-32.png. (The web app manifest and its install icons went with phone support, 2026-10-19.)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const dir = new URL('../assets/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');
const out = async (src, size, name) => {
  await sharp(Buffer.from(src), { density: Math.max(72, 72 * size / 64 * 4) }).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(name, dir).pathname);
  console.log(name, size);
};
await out(svg, 16, 'icon-16.png');
await out(svg, 32, 'icon-32.png');
