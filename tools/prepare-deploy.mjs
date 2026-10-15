// An allowlist keeps server code, tools, credentials and scratch files off the CDN.
import './check-browser-imports.mjs';
import { readdir, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { MAPS } from '../src/map-catalog.js';
import { readCarCapabilities } from '../server/car-capabilities.mjs';
import { resolveMap } from '../server/map-definitions.mjs';
import { PLAYABLE_MAPS } from '../src/enabled-maps.js';
import { bundleBrowser } from './bundle-browser.mjs';
import { bakeWorlds } from './bake-world.mjs';
import { buildRelease, publishRelease, CACHE_HEADERS } from './release-cache.mjs';
import { publishReleaseData } from './release-data.mjs';
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
await bakeWorlds(root, out, PLAYABLE_MAPS);
// Explicit Wrangler build commands set ASR_BUILD_ENV; unknown deployment IDs remain visibly staging.
const buildEnvironment = process.env.ASR_BUILD_ENV || process.env.CLOUDFLARE_ENV || 'staging';
const indexPath = resolve(out, 'index.html');
await writeFile(indexPath, (await readFile(indexPath, 'utf8')).replace('</head>', `<meta name="asr-environment" content="${buildEnvironment === 'production' ? 'production' : 'staging'}">\n</head>`));
await bundleBrowser(root, out);
await writeFile(resolve(out, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/share/*\n  Cache-Control: public, max-age=86400, stale-while-revalidate=604800\n  Content-Type: image/jpeg\n' + CACHE_HEADERS);
const maps = [];
for (const def of MAPS) {
  let data;
  try { data = JSON.parse(await readFile(resolve(root, def.dataUrl), 'utf8')); }
  catch (e) { if (def.id === 'riviera' || e.code !== 'ENOENT') throw e; console.warn(`Map ${def.id} unavailable: ${def.dataUrl}; skipping.`); continue; }
  const map = resolveMap(def, data);
  maps.push({ ...map, definitions: [...map.definitions] });
}
// Content-addressed assets remain cached on demand. Installation only fetches the menu shell;
// map data, generated worlds, textures and sounds must wait for a committed session.
const release = await buildRelease(out, { core: ['/src/', '/style.css', '/assets/icons/', '/assets/maps/'] });
const swBytes = await publishRelease(root, out, release);
// After the content build id exists, so the version, notes and credits never change it (see tools/release-data.mjs).
const version = await publishReleaseData(root, out, { build: release.build });
if (version.unreleased) console.warn(`CHANGELOG.md still has ${version.unreleased} Unreleased bullet(s): before promoting to prod, move them under a dated version (deploy/README.md, Release notes).`);
if (version.unlistedAuthors.length) console.warn(`Git authors missing from CREDITS.md: ${version.unlistedAuthors.join(', ')} (listed as contributors for now).`);
count = 0; bytes = 0; largest = { size: 0, path: '' };
async function inventory(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await inventory(path);
    else { const info = await stat(path); count++; bytes += info.size; if (info.size > largest.size) largest = { path: relative(out, path), size: info.size }; }
  }
}
await inventory(out);
const catalogue = await readFile(resolve(root, 'src/cars.js'), 'utf8');
const { cars, nitrousCars, specs: carSpecs } = readCarCapabilities(catalogue);
await writeFile(resolve(root, '.deploy/catalogue.json'), JSON.stringify({ maps, cars, nitrousCars, carSpecs }));
console.log(JSON.stringify({ assets: count, bytes, largest, release: { version: version.version, sha: version.sha, build: release.build, files: Object.keys(release.files).length, copies: release.copies, swBytes }, maps: maps.map(m => ({ id: m.id, version: m.track.version, events: m.definitions.length })) }, null, 2));
