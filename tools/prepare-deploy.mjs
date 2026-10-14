// An allowlist keeps server code, tools, credentials and scratch files off the CDN.
import './check-browser-imports.mjs';
import { readdir, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { MAPS } from '../src/map-catalog.js';
import { readCarCapabilities } from '../server/car-capabilities.mjs';
import { resolveMap } from '../server/map-definitions.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, '.deploy/assets');
await rm(resolve(root, '.deploy'), { recursive: true, force: true });
await mkdir(out, { recursive: true });
let count = 0, bytes = 0, largest = { size: 0, path: '' };
async function copy(path) {
  const info = await stat(path), rel = relative(root, path);
  if (info.isDirectory()) { for (const entry of await readdir(path, { withFileTypes: true })) if (!entry.name.startsWith('.') && !entry.isSymbolicLink()) await copy(resolve(path, entry.name)); return; }
  if (/\.orig$|\.test\.[cm]?js$|(?:^|\/)chain\.pid$/.test(rel)) return;
  if (info.size > 25 * 1024 * 1024) throw new Error(`Cloudflare asset exceeds 25 MiB: ${rel}`);
  const dest = resolve(out, rel); await mkdir(resolve(dest, '..'), { recursive: true }); await copyFile(path, dest);
  count++; bytes += info.size; if (info.size > largest.size) largest = { path: rel, size: info.size };
}
for (const path of ['index.html', 'style.css', 'robots.txt', 'sitemap.xml', 'src', 'assets', 'data']) await copy(resolve(root, path));
await writeFile(resolve(out, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/share/*\n  Cache-Control: public, max-age=86400, stale-while-revalidate=604800\n  Content-Type: image/jpeg\n');
const maps = [];
for (const def of MAPS) {
  let data;
  try { data = JSON.parse(await readFile(resolve(root, def.dataUrl), 'utf8')); }
  catch (e) { if (def.id === 'riviera' || e.code !== 'ENOENT') throw e; console.warn(`Map ${def.id} unavailable: ${def.dataUrl}; skipping.`); continue; }
  const map = resolveMap(def, data);
  maps.push({ ...map, definitions: [...map.definitions] });
}
const catalogue = await readFile(resolve(root, 'src/cars.js'), 'utf8');
const { cars, nitrousCars } = readCarCapabilities(catalogue);
await writeFile(resolve(root, '.deploy/catalogue.json'), JSON.stringify({ maps, cars, nitrousCars }));
console.log(JSON.stringify({ assets: count, bytes, largest, maps: maps.map(m => ({ id: m.id, version: m.track.version, events: m.definitions.length })) }, null, 2));
