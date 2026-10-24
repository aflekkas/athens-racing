// Build-time export only. Installed games never import this downloader.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, statfs, lstat, rename } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalWorldJSON, composeWorldManifest } from '../../src/world-manifest.js';
import { validateWorldManifest } from '../../src/world-tile-format.js';
import { routeGeometryHash } from '../../src/route-compile.js';
import { sha256 } from '../../src/route-definition.js';
import { buildRouteCatalogue } from '../../server/route-definitions.mjs';
import { recoveryCellDescriptor } from '../../server/recovery-manifest-wire.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_OBJECT = 8 * 1024 ** 2;
const MANIFEST = /^\/world\/manifests\/([a-f0-9]{64})\.json$/;
const CELL = /^\/world\/cells\/([a-f0-9]{64})\.bin\.gz$/;
const EXPORT_PATH = /^(?:catalogue\.json|route-config\.json|world-flat\.json|data\/athens\/manifest\.json|data\/routes\/(?:index\.json|[a-z][a-z0-9-]*\.(?:online-grid\.)?[a-f0-9]{64}\.json)|world\/(?:manifests\/[a-f0-9]{64}\.json|cells\/[a-f0-9]{64}\.bin\.gz|recovery\/(?:manifest|-?\d+,-?\d+)\.[a-f0-9]{64}\.json))$/;
const RECOVERY = /^\/world\/recovery\/(?:manifest|-?\d+,-?\d+)\.([a-f0-9]{64})\.json$/;
const fail = text => { throw Error('Offline world export: ' + text); };
async function noSymlinks(root, relative = '') {
  const paths = [root]; let at = root;
  for (const part of relative.split('/').filter(Boolean)) { at = resolve(at, part); paths.push(at); }
  for (const path of paths) { try { if ((await lstat(path)).isSymbolicLink()) fail('symlink output rejected'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function rootRelative(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) fail('asset URL must be root-relative');
  return value;
}
async function checkCompiledRoute(body, route, revision) {
  let rivalPlanHash;
  if (body.rivalPlan) {
    const { hash: expected, ...plan } = body.rivalPlan;
    if (!HEX.test(expected || '') || await sha256(plan) !== expected || plan.geometryHash !== body.geometryHash || plan.worldSetRevision !== revision) fail('rival plan hash mismatch');
    rivalPlanHash = expected;
  }
  if (body.id !== route.id || body.worldId !== 'athens' || body.worldSetRevision !== revision || body.routeHash !== route.routeHash || body.geometryHash !== route.geometryHash || await routeGeometryHash(body) !== route.geometryHash || await sha256({ definition: body.definition, geometryHash: body.geometryHash, worldSetRevision: body.worldSetRevision, ...(rivalPlanHash ? { rivalPlanHash } : {}) }) !== route.routeHash) fail('compiled route hash mismatch: ' + route.id);
}


function localPath(value, origin) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('%') || value.split('/').includes('..')) fail('unsafe asset URL');
  const url = new URL(value, origin);
  if (url.origin !== origin || url.search || url.hash || url.username || url.password || !/^\/(?:world|data)\/[A-Za-z0-9_.,/-]+$/.test(url.pathname)) fail('external or unsafe asset URL');
  return url.pathname;
}

export async function verifyWorldRelease(out) {
  out = resolve(out); await noSymlinks(out, 'offline-world-inventory.json');
  const inventory = json(await readFile(resolve(out, 'offline-world-inventory.json')));
  if (inventory.schemaVersion !== 1 || !HEX.test(inventory.worldSetRevision || '') || !Array.isArray(inventory.files) || !inventory.files.length || inventory.files.length > 20000) fail('invalid local inventory');
  const seen = new Set(); let bytes = 0;
  for (const entry of inventory.files) {
    if (typeof entry.path !== 'string' || !EXPORT_PATH.test(entry.path) || !/^[A-Za-z0-9_.,/-]+$/.test(entry.path) || entry.path.startsWith('/') || entry.path.split('/').some(p => p === '..' || p === '.') || seen.has(entry.path) || !HEX.test(entry.sha256 || '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_OBJECT) fail('invalid local file descriptor');
    seen.add(entry.path); bytes += entry.bytes;
    if (bytes > MAX_BYTES) fail('local inventory exceeds 2 GiB');
    await noSymlinks(out, entry.path);
    const body = await readFile(resolve(out, entry.path));
    if (body.length !== entry.bytes || hash(body) !== entry.sha256) fail('local asset corrupted: ' + entry.path);
  }
  for (const path of ['catalogue.json', 'route-config.json', 'data/routes/index.json', 'data/athens/manifest.json']) if (!seen.has(path)) fail('incomplete local release: ' + path);
  // Verify the dependency closure, not merely the files the inventory lists.
  const required = async (path, digest, length, canonical = false) => {
    rootRelative(path); const relative = ['/catalogue.json', '/route-config.json', '/world-flat.json'].includes(path) ? path.slice(1) : localPath(path, 'https://offline.invalid').slice(1);
    if (!seen.has(relative)) fail('unlisted dependency: ' + path);
    const raw = await readFile(resolve(out, relative));
    if (length !== undefined && raw.length !== length || digest && (canonical ? await sha256(json(raw)) : hash(raw)) !== digest) fail('dependency integrity mismatch: ' + path);
    return path.endsWith('.json') ? json(raw) : raw;
  };
  const root = await required('/data/athens/manifest.json'); let world;
  const sources = {};
  const checkDescriptors = manifest => {
    for (const entry of [...Object.values(manifest.tiles || {}), ...(manifest.regionalAssets || []), ...(manifest.enrichments || [])]) rootRelative(entry.url);
  };
  if (root.schemaVersion === 1 && root.tileVersion !== 1 && Array.isArray(root.regions)) {
    const { revision, ...content } = root;
    if (hash(Buffer.from(canonicalWorldJSON(content))) !== revision) fail('local world revision mismatch');
    for (const region of root.regions) {
      rootRelative(region.manifestUrl);
      if (MANIFEST.exec(region.manifestUrl)?.[1] !== region.manifestSha256) fail('local region binding mismatch');
      const manifest = await required(region.manifestUrl, region.manifestSha256); checkDescriptors(manifest);
      sources[region.id] = { url: 'https://offline.invalid' + region.manifestUrl, manifest };
    }
    world = composeWorldManifest(root, sources);
  } else { checkDescriptors(root); world = validateWorldManifest(root); }
  if (world.revision !== inventory.worldSetRevision) fail('inventory world revision mismatch');
  const flat = await required('/world-flat.json');
  const expectedFlat = { ...world, tiles: Object.fromEntries(Object.entries(world.tiles).map(([key, cell]) => [key, { ...cell, url: localPath(cell.url, 'https://offline.invalid') }])) };
  if (canonicalWorldJSON(flat) !== canonicalWorldJSON(expectedFlat)) fail('private flat world differs from authenticated manifests');
  for (const entry of [...Object.values(world.tiles), ...(world.regionalAssets || [])]) {
    const path = localPath(entry.url, 'https://offline.invalid');
    if (CELL.exec(path)?.[1] !== entry.sha256) fail('local cell binding mismatch');
    await required(path, entry.sha256, entry.bytes);
  }
  for (const entry of world.enrichments || []) {
    const path = rootRelative(entry.url), digest = MANIFEST.exec(path)?.[1];
    if (!digest) fail('enrichment lacks immutable content hash');
    const body = await required(path, digest); if (body.sourceMapSha256 !== entry.sourceMapSha256) fail('local enrichment source mismatch');
  }
  const config = await required('/route-config.json'), catalogue = await required('/catalogue.json'), index = await required('/data/routes/index.json');
  if (!config.routes?.length || canonicalWorldJSON(config) !== canonicalWorldJSON(catalogue.routeConfig)) fail('local route catalogue mismatch');
  for (const route of config.routes) {
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(route.id) || route.url !== `/data/routes/${route.id}.${route.routeHash}.json`) fail('local route URL binding mismatch');
    const body = await required(route.url); await checkCompiledRoute(body, route, world.revision);
    if (canonicalWorldJSON(body) !== canonicalWorldJSON(catalogue.routes?.find(r => r.id === route.id))) fail('local compiled catalogue mismatch');
    const item = index.routes?.find(r => r.id === route.id);
    if (!item || ['routeHash', 'geometryHash', 'worldSetRevision', 'url'].some(key => item[key] !== route[key])) fail('local picker catalogue mismatch');
    for (const [kind, list] of [['onlineGrid', 'routeGrids'], ['recovery', 'routeRoads']]) if (route[kind]) {
      const descriptor = route[kind], artifact = await required(rootRelative(descriptor.url), descriptor.hash, undefined, true);
      if (canonicalWorldJSON(artifact) !== canonicalWorldJSON(catalogue[list]?.find(r => r.hash === descriptor.hash)?.body)) fail('local online catalogue mismatch');
      if (kind === 'recovery') for (const key of Object.keys(artifact.cells || {})) {
        const cell = recoveryCellDescriptor(artifact, key);
        if (cell.sourceHash !== world.tiles[key]?.sha256) fail('local recovery source mismatch');
        if (cell.empty === true) continue;
        for (const hash of cell.parts || [cell.hash]) await required(`/world/recovery/${key}.${hash}.json`, hash, undefined, true);
      }
    }
  }
  return { ...inventory, bytes };
}

export async function exportWorldRelease({ out = resolve('.desktop/world-release'), origin = 'https://staging.athensracing.com', fetcher = fetch, concurrency = 6, maxBytes = MAX_BYTES, diskCheck = true, log = console.log } = {}) {
  out = resolve(out); origin = new URL(origin).origin;
  if (!origin.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(origin)) fail('export source must use HTTPS');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) fail('invalid resource bounds');
  // Windows may place the checkout on a different drive from TEMP. Keep its
  // single task directory beside the output so final publication is atomic.
  const tempRoot = process.platform === 'win32' ? dirname(out) : '/tmp';
  if (process.platform === 'win32') { await noSymlinks(tempRoot); await mkdir(tempRoot, { recursive: true }); }
  if (diskCheck) {
    const disk = await statfs(tempRoot);
    if (process.platform === 'win32') {
      const capacity = 100 * (Number(disk.blocks) - Number(disk.bavail)) / Number(disk.blocks);
      log(`Output volume usage: ${capacity.toFixed(1)}%; available ${Number(disk.bavail) * Number(disk.bsize)} bytes`);
      if (!Number.isFinite(capacity) || capacity >= 85) fail('disk is at or above 85%; clean owned artifacts first');
    } else {
      const result = spawnSync('df', ['-h', '/'], { encoding: 'utf8' });
      if (result.status !== 0) fail('could not check disk');
      log(result.stdout.trim());
      const capacity = result.stdout.trim().split('\n').at(-1).match(/\s(\d+)%\s/);
      if (!capacity || Number(capacity[1]) >= 85) fail('disk is at or above 85%; clean owned artifacts first');
    }
    if (Number(disk.bavail) * Number(disk.bsize) < MAX_BYTES + 512 * 1024 ** 2) fail('less than 2.5 GiB free for bounded export');
  }
  const temp = await mkdtemp(resolve(tempRoot, 'athens-world-export.'));
  const stage = resolve(temp, 'release'); await mkdir(stage);
  const files = new Map(), requested = new Map(); let total = 0;
  async function store(path, body) {
    if (!body.length || body.length > MAX_OBJECT) fail('invalid stored object length');
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const prior = files.get(relative);
    if (prior) { if (prior.sha256 !== hash(body)) fail('conflicting path: ' + path); return; }
    const file = resolve(stage, relative); if (!file.startsWith(stage + sep)) fail('unsafe output path');
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, body);
    files.set(relative, { path: relative, bytes: body.length, sha256: hash(body) });
  }
  async function download(path, expectedHash, expectedBytes, canonical = false) {
    path = localPath(path, origin);
    const prior = requested.get(path);
    if (prior) {
      if (expectedHash !== prior.expectedHash || expectedBytes !== prior.expectedBytes) fail('conflicting immutable identity');
      return prior.promise;
    }
    const promise = (async () => {
      const response = await fetcher(origin + path, { redirect: 'manual', credentials: 'omit', cache: 'no-store', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) fail(`HTTP ${response.status}: ${path}`);
      const declared = Number(response.headers.get('content-length'));
      const cap = expectedBytes ?? MAX_OBJECT;
      if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_OBJECT || declared > cap) fail('asset size exceeds descriptor: ' + path);
      if (!response.body) fail('empty response: ' + path);
      const chunks = []; let length = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length; total += value.length;
          if (length > cap || total > maxBytes) fail('download byte ceiling exceeded');
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (expectedBytes !== undefined && length !== expectedBytes) fail('asset byte length mismatch: ' + path);
      const computed = canonical ? await sha256(json(bytes)) : hash(bytes);
      if (expectedHash && computed !== expectedHash) fail('asset hash mismatch: ' + path);
      await store(path, bytes); return { bytes, body: path.endsWith('.json') ? json(bytes) : null };
    })();
    requested.set(path, { expectedHash, expectedBytes, promise }); return promise;
  }
  async function pool(items, work) {
    let next = 0, failed = false;
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length && !failed) { const item = items[next++]; try { await work(item); } catch (error) { failed = true; throw error; } }
    }));
    const rejected = outcomes.find(r => r.status === 'rejected'); if (rejected) throw rejected.reason;
  }
  try {
    // Resolve the mutable alias only once; all subsequent requests use immutable keys.
    const alias = await fetcher(origin + '/data/athens/manifest.json', { redirect: 'manual', credentials: 'omit', cache: 'no-store', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
    let rootPath;
    if ([301, 302, 303, 307, 308].includes(alias.status)) { rootPath = localPath(alias.headers.get('location'), origin); await alias.body?.cancel(); }
    else { await alias.body?.cancel(); fail('world alias must resolve to an immutable manifest'); }
    const rootHash = MANIFEST.exec(rootPath)?.[1]; if (!rootHash) fail('world alias is not immutable');
    const { body: root, bytes: rootBytes } = await download(rootPath, rootHash);
    let world;
    if (root.schemaVersion === 1 && Array.isArray(root.regions) && root.tileVersion !== 1) {
      const { revision, ...content } = root;
      if (!HEX.test(revision || '') || hash(Buffer.from(canonicalWorldJSON(content))) !== revision) fail('world set revision mismatch');
      const sources = {};
      await pool(root.regions, async region => {
        const path = localPath(rootRelative(region.manifestUrl), origin);
        if (MANIFEST.exec(path)?.[1] !== region.manifestSha256) fail('region hash binding mismatch');
        const { body } = await download(path, region.manifestSha256);
        for (const entry of [...Object.values(body.tiles || {}), ...(body.regionalAssets || []), ...(body.enrichments || [])]) rootRelative(entry.url);
        sources[region.id] = { url: origin + path, manifest: body };
      });
      world = composeWorldManifest(root, sources);
    } else world = validateWorldManifest(root);
    const assets = new Map();
    for (const entry of [...Object.values(world.tiles), ...(world.regionalAssets || [])]) {
      const path = localPath(entry.url, origin);
      if (CELL.exec(path)?.[1] !== entry.sha256 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) fail('cell descriptor invalid');
      const prior = assets.get(path); if (prior && (prior.sha256 !== entry.sha256 || prior.bytes !== entry.bytes)) fail('conflicting cell descriptor');
      assets.set(path, entry);
    }
    log(`Exporting ${Object.keys(world.tiles).length} cells (${[...assets.values()].reduce((n, a) => n + a.bytes, 0)} bytes), revision ${world.revision}`);
    const downloadCells = () => pool([...assets.entries()], async ([path, entry]) => { await download(path, entry.sha256, entry.bytes); });
    for (const enrichment of world.enrichments || []) {
      const path = localPath(enrichment.url, origin), digest = MANIFEST.exec(path)?.[1];
      if (!digest) fail('enrichment lacks immutable content hash');
      const { body } = await download(path, digest);
      if (body.sourceMapSha256 !== enrichment.sourceMapSha256) fail('enrichment source mismatch');
    }
    const configResponse = await fetcher(origin + '/api/routes', { redirect: 'manual', credentials: 'omit', cache: 'no-store', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
    if (!configResponse.ok) fail('route catalogue unavailable');
    const configReader = configResponse.body?.getReader(); if (!configReader) fail('empty route catalogue');
    const configChunks = []; let configLength = 0;
    try { for (;;) { const { done, value } = await configReader.read(); if (done) break; configLength += value.length; total += value.length; if (configLength > MAX_OBJECT || total > maxBytes) fail('route catalogue size exceeded'); configChunks.push(value); } }
    catch (error) { await configReader.cancel().catch(() => {}); throw error; }
    finally { configReader.releaseLock(); }
    const configBytes = Buffer.concat(configChunks);
    const config = json(configBytes);
    if (!Array.isArray(config.routes) || !config.routes.length || config.routes.length > 128 || !['staging', 'production'].includes(config.environment)) fail('route catalogue empty or invalid');
    const compiled = [], grids = [], roads = []; let recoveryWorld;
    const ids = new Set();
    for (const route of config.routes) {
      if (!/^[a-z][a-z0-9-]{2,63}$/.test(route.id) || ids.has(route.id) || !HEX.test(route.routeHash || '') || route.worldSetRevision !== world.revision || route.url !== `/data/routes/${route.id}.${route.routeHash}.json`) fail('route release binding mismatch');
      ids.add(route.id);
      const { body } = await download(route.url);
      await checkCompiledRoute(body, route, world.revision);
      for (const key of body.cells || []) if (!world.tiles[key]) fail('route references missing cell');
      compiled.push(body);
      if (route.onlineGrid) {
        const grid = route.onlineGrid;
        if (!HEX.test(grid.hash || '') || grid.url !== `/data/routes/${route.id}.online-grid.${grid.hash}.json`) fail('invalid online grid descriptor');
        const value = await download(grid.url, grid.hash, undefined, true); if (!grids.some(g => g.hash === grid.hash)) grids.push({ hash: grid.hash, body: value.body });
      }
      if (route.recovery) {
        const recovery = route.recovery;
        if (!HEX.test(recovery.hash || '') || RECOVERY.exec(localPath(recovery.url, origin))?.[1] !== recovery.hash) fail('invalid recovery descriptor');
        const value = await download(recovery.url, recovery.hash, undefined, true);
        if (!roads.some(r => r.hash === recovery.hash)) roads.push({ hash: recovery.hash, body: value.body });
        const cells = value.body.cells || {};
        recoveryWorld = { worldSetRevision: world.revision, sourceHashes: Object.entries(world.tiles).map(([key, cell]) => [key, cell.sha256]).sort(([a], [b]) => a.localeCompare(b)) };
        await pool(Object.keys(cells), async key => {
          const cell = recoveryCellDescriptor(value.body, key);
          if (!/^-?\d+,-?\d+$/.test(key) || cell.sourceHash !== world.tiles[key]?.sha256) fail('recovery source cell mismatch');
          if (cell.empty === true) return;
          for (const hash of cell.parts || [cell.hash]) {
            if (!HEX.test(hash || '')) fail('invalid recovery part descriptor');
            const path = `/world/recovery/${key}.${hash}.json`;
            await download(path, hash, undefined, true);
          }
        });
      }
    }
    await downloadCells();
    await store('/data/athens/manifest.json', rootBytes);
    await store('/route-config.json', Buffer.from(JSON.stringify(config)));
    await store('/data/routes/index.json', Buffer.from(JSON.stringify({ schemaVersion: 1, routes: buildRouteCatalogue(compiled).map(({ runtime, ...r }) => r) })));
    await store('/catalogue.json', Buffer.from(JSON.stringify({ routeConfig: config, routes: compiled, routeGrids: grids, routeRoads: roads, ...(recoveryWorld ? { recoveryWorld } : {}) })));
    // Flat composed view is private build input for offline grid/recovery proof builders.
    const flat = { ...world, tiles: Object.fromEntries(Object.entries(world.tiles).map(([key, cell]) => [key, { ...cell, url: localPath(cell.url, origin) }])) };
    await store('/world-flat.json', Buffer.from(JSON.stringify(flat)));
    const inventory = { schemaVersion: 1, origin, worldSetRevision: world.revision, cells: Object.keys(world.tiles).length, routes: compiled.map(c => c.id), files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
    await writeFile(resolve(stage, 'offline-world-inventory.json'), JSON.stringify(inventory));
    await verifyWorldRelease(stage);
    // Publish only a complete verified directory; preserve the old release on failure.
    await noSymlinks(dirname(out)); await noSymlinks(out);
    let existing = false;
    try { await lstat(out); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) await verifyWorldRelease(out);
    await mkdir(dirname(out), { recursive: true });
    const previous = resolve(temp, 'previous');
    if (existing) await rename(out, previous);
    try { await rename(stage, out); }
    catch (error) { if (existing) await rename(previous, out); throw error; }
    log(`Offline world export complete: ${inventory.files.length} files, ${total} downloaded bytes.`);
    return verifyWorldRelease(out);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await exportWorldRelease({ out: process.argv[2] || resolve('.desktop/world-release'), origin: process.env.ASR_WORLD_EXPORT_ORIGIN || 'https://staging.athensracing.com' });
}
