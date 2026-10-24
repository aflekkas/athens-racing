// Build a self-contained local browser root. Network access is never used here.
import { cp, mkdir, readFile, writeFile, rm, stat, lstat, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bundleBrowser } from '../../tools/bundle-browser.mjs';
import { MAPS } from '../../src/map-catalog.js';
import { publishReleaseData } from '../../tools/release-data.mjs';

export function desktopHTML(html) {
  return html.replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*/g, '')
    .replace('</head>', '<meta name="asr-desktop" content="1">\n<meta name="asr-environment" content="production">\n<link rel="stylesheet" href="/assets/fonts/desktop.css">\n</head>');
}
export async function assertPlayableMaps(root) {
  for (const map of MAPS) for (const name of [map.dataUrl, map.terrainUrl, map.preview]) {
    try { if (!(await stat(resolve(root, name))).isFile()) throw Error('not a file'); }
    catch { throw Error(`Offline package requires ${map.name}: missing ${name}`); }
  }
}
export async function assertGameOutput(root, out) {
  root = resolve(root); out = resolve(out);
  if (out === root || !out.startsWith(root + sep) || !relative(root, out).split(sep).join('/').startsWith('.desktop/')) throw Error('Game output must be inside the task .desktop/ directory');
  let current = root;
  for (const part of relative(root, out).split(sep)) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('Game output may not traverse symbolic links'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
export async function prepareGame({ root = resolve(import.meta.dirname, '../..'), out = resolve(root, '.desktop/game'), worldRelease, onlineRelease = resolve(root, '.desktop/online-release') } = {}) {
  root = resolve(root); out = resolve(out);
  await assertGameOutput(root, out);
  // Verify the complete immutable import before replacing any previous build.
  // The import cache is separate so rebuilds never erase the downloaded world.
  const { verifyWorldRelease } = await import('./export-world.mjs');
  const { resolveEffectiveWorldRelease } = await import('./repair-world.mjs');
  worldRelease ??= await resolveEffectiveWorldRelease({ root });
  let baseInventory, onlineInventory;
  try { baseInventory = await verifyWorldRelease(worldRelease); }
  catch (cause) { throw Error('A verified complete offline world release is required. Run npm run desktop:export-world first; no hosted world proxy is allowed at runtime.', { cause }); }
  for (const path of ['catalogue.json', 'route-config.json', 'data/athens/manifest.json']) {
    if (!(await stat(resolve(worldRelease, path))).isFile()) throw Error(`Offline world release is incomplete: ${path}`);
  }
  const { verifyOnlineOverlay } = await import('../server/prepare-online.mjs');
  try { onlineInventory = await verifyOnlineOverlay({ release: worldRelease, out: onlineRelease }); }
  catch (cause) { throw Error('A verified LAN overlay is required. Run npm run desktop:prepare-online after exporting and repairing the world.', { cause }); }
  const routeConfig = JSON.parse(await readFile(resolve(onlineRelease, 'route-config.json'), 'utf8'));
  if (routeConfig.online !== true || !routeConfig.routes?.length || routeConfig.routes.some(route => !route.onlineGrid || !route.recovery)) throw Error('LAN certification is required. Run npm run desktop:prepare-online after exporting the world, then prepare again.');
  await assertPlayableMaps(root);
  await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
  for (const name of ['index.html', 'style.css', 'src', 'assets', 'data']) {
    await cp(resolve(root, name), resolve(out, name), { recursive: true, filter: name => !/(?:^|\/)(?:raw|validation)(?:\/|$)|\.test\.[cm]?js$/.test(name) });
  }
  // Copy authenticated entries only; unlisted files in an import directory must
  // never override executable source or become part of the installed product.
  for (const [directory, inventory] of [[worldRelease, baseInventory], [onlineRelease, onlineInventory]]) for (const entry of inventory.files) {
    const target = resolve(out, entry.path); await mkdir(resolve(target, '..'), { recursive: true }); await cp(resolve(directory, entry.path), target);
  }
  await writeFile(resolve(out, 'index.html'), desktopHTML(await readFile(resolve(out, 'index.html'), 'utf8')));
  await cp(resolve(root, 'apps/game/fonts'), resolve(out, 'assets/fonts'), { recursive: true });
  await bundleBrowser(root, out, { three: 'bundled', sourceMapsDir: resolve(root, '.desktop/sourcemaps') });
  // The server parses its authoritative car data from this file, independently
  // from the browser's split/minified catalogue.
  await cp(resolve(root, 'src/cars.js'), resolve(out, 'src/cars.js'));
  const files = {};
  async function inventory(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name); if (item.isDirectory()) await inventory(path);
      else { const data = await readFile(path); files[relative(out, path).split(sep).join('/')] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; }
    }
  }
  await inventory(out);
  const build = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  await publishReleaseData(root, out, { build });
  await inventory(out); // Include generated version, release notes and credits in the file inventory.
  const manifest = { schemaVersion: 1, build, maps: MAPS.map(map => map.id), fullAthens: true, routes: JSON.parse(await readFile(resolve(out, 'route-config.json'), 'utf8')).routes.map(route => route.id), runtimeNetwork: 'loopback and selected LAN host only', files };
  await writeFile(resolve(out, 'desktop-manifest.json'), JSON.stringify(manifest));
  console.log(`Offline game ready: ${out}; ${Object.keys(files).length} files; maps: ${manifest.maps.join(', ')}`);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareGame();
