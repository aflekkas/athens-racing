// Renders the favicon / app icons from assets/icon.svg (the ASR mark) and writes assets/manifest.webmanifest.
//   node tools/build-favicons.mjs        (needs `sharp`, which wrangler already installs under node_modules)
// Outputs: assets/icon-16.png, icon-32.png, apple-touch-icon.png (180, square: iOS rounds it), icon-192.png, icon-512.png,
// icon-maskable-192.png and icon-maskable-512.png (square, the glyph inside the maskable safe zone).
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../assets/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');
const square = svg.replace(/<rect([^>]*?) rx="14"/, '<rect$1');            // full-bleed background
const maskable = square.replace(/<path /g, '<path transform="translate(6.4 6.4) scale(.8)" '); // 80% safe zone
const out = async (src, size, name) => {
  await sharp(Buffer.from(src), { density: Math.max(72, 72 * size / 64 * 4) }).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(name, dir).pathname);
  console.log(name, size);
};
await out(svg, 16, 'icon-16.png');
await out(svg, 32, 'icon-32.png');
await out(square, 180, 'apple-touch-icon.png');
await out(svg, 192, 'icon-192.png');
await out(svg, 512, 'icon-512.png');
await out(maskable, 192, 'icon-maskable-192.png');
await out(maskable, 512, 'icon-maskable-512.png');
writeFileSync(new URL('manifest.webmanifest', dir), JSON.stringify({
  id: '/', name: 'ATHENS RACING', short_name: 'ATHENS RACING', description: 'Race real Greek roads: the Athens Riviera, the Megara circuit and the Penteli hill climb.',
  lang: 'en', categories: ['games', 'sports'], start_url: '../', scope: '../', display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'landscape',
  background_color: '#07090c', theme_color: '#07090c',
  icons: [
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');
console.log('manifest.webmanifest');
