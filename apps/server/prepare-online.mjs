// Build-time physical certification. Installed games never generate proofs or
// contact the network: they consume the authenticated catalogue produced here.
import { readFile, writeFile, mkdir, mkdtemp, rm, cp, readdir, open, rename, lstat, statfs } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeOnlineGrid } from '../../tools/build-online-grids.mjs';
import { buildParallelRecovery } from './recovery-pool.mjs';
import { validateOnlineRouteRelease, bindOnlineRouteRelease } from '../../tools/online-route-release.mjs';
import { canonicalJSON, sha256 } from '../../src/route-definition.js';
import { verifyWorldRelease } from '../game/export-world.mjs';
import { recoveryCellDescriptor } from '../../server/recovery-manifest-wire.mjs';
import { openProofWorkspace, physicalProofSemanticHash, checkpointSignature } from './proof-checkpoint.mjs';
import { resolveEffectiveWorldRelease } from '../game/repair-world.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));

const overlayPath = value => typeof value === 'string' && /^(?:catalogue\.json|route-config\.json|data\/routes\/(?:index|online-release)\.json|data\/routes\/[a-z][a-z0-9-]{2,63}\.online-grid\.[a-f0-9]{64}\.json|world\/recovery\/(?:manifest|-?\d+,-?\d+)\.[a-f0-9]{64}\.json)$/.test(value);
const noSymlinks = async (root, relative = '') => { let path = root; for (const part of ['', ...relative.split('/')]) { path = resolve(path, part); if ((await lstat(path)).isSymbolicLink()) throw Error('Online overlay symlink rejected.'); } };

export async function verifyOnlineOverlay({ release, out = resolve('.desktop/online-release') } = {}) {
  release = release ? resolve(release) : await resolveEffectiveWorldRelease(); out = resolve(out);
  await verifyWorldRelease(release);
  await noSymlinks(out, 'offline-online-inventory.json');
  const inventory = await json(resolve(out, 'offline-online-inventory.json'));
  if (inventory.schemaVersion !== 1 || inventory.sourceInventoryHash !== hash(await readFile(resolve(release, 'offline-world-inventory.json'))) || !Array.isArray(inventory.files) || !inventory.files.length || inventory.files.length > 20000) throw Error('Online overlay does not match the verified world export.');
  const files = new Map(); let total = 0;
  for (const entry of inventory.files) {
    if (!overlayPath(entry.path) || entry.path.startsWith('/') || entry.path.split('/').some(part => part === '..' || part === '.') || files.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 8 * 1024 ** 2) throw Error('Invalid online overlay inventory.');
    await noSymlinks(out, entry.path);
    const bytes = await readFile(resolve(out, entry.path)); total += bytes.length;
    if (total > 2 * 1024 ** 3 || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('Online overlay asset corrupted: ' + entry.path);
    files.set(entry.path, entry);
  }
  const required = async path => { if (typeof path !== 'string' || path.startsWith('//')) throw Error('Invalid online overlay descriptor path.'); const key = path.replace(/^\//, ''); if (!overlayPath(key)) throw Error('Invalid online overlay descriptor path.'); if (!files.has(key)) throw Error('Online overlay closure missing: ' + key); return json(resolve(out, key)); };
  const original = await json(resolve(release, 'catalogue.json')), catalogue = await required('catalogue.json'), config = await required('route-config.json'), manifest = await json(resolve(release, 'world-flat.json'));
  if (canonicalJSON(catalogue.routes) !== canonicalJSON(original.routes) || canonicalJSON(config) !== canonicalJSON(catalogue.routeConfig) || config.online !== true) throw Error('Online overlay changed compiled routes or has inconsistent activation.');
  const proof = await required('data/routes/online-release.json');
  const validated = await validateOnlineRouteRelease(proof, { compiled: catalogue.routes, manifest });
  if (canonicalJSON(validated.routeGrids) !== canonicalJSON(catalogue.routeGrids) || canonicalJSON(validated.routeRoads) !== canonicalJSON(catalogue.routeRoads) || canonicalJSON(validated.recoveryWorld) !== canonicalJSON(catalogue.recoveryWorld)) throw Error('Online overlay catalogue proof mismatch.');
  const expectedConfig = { ...bindOnlineRouteRelease(original.routeConfig, validated, { enable: true }), onlineAvailable: true };
  if (canonicalJSON(config) !== canonicalJSON(expectedConfig)) throw Error('Online overlay changed the enabled route set or competitive tuple.');
  const index = await required('data/routes/index.json');
  const originalIndex = await json(resolve(release, 'data/routes/index.json'));
  const expectedIndex = { ...originalIndex, routes: originalIndex.routes.map(entry => { const descriptors = config.routes.find(route => route.id === entry.id); return descriptors ? { ...entry, onlineGrid: descriptors.onlineGrid, recovery: descriptors.recovery } : entry; }) };
  if (canonicalJSON(index) !== canonicalJSON(expectedIndex)) throw Error('Online overlay picker changed the enabled route set or competitive tuple.');
  for (const entry of config.routes) {
    const matched = validated.routes.find(route => route.id === entry.id), picker = index.routes.find(route => route.id === entry.id);
    if (!matched || !picker || canonicalJSON(entry.onlineGrid) !== canonicalJSON(matched.onlineGrid) || canonicalJSON(entry.recovery) !== canonicalJSON(matched.recovery) || canonicalJSON(picker.onlineGrid) !== canonicalJSON(matched.onlineGrid) || canonicalJSON(picker.recovery) !== canonicalJSON(matched.recovery)) throw Error('Online overlay route descriptors mismatch.');
    for (const descriptor of [entry.onlineGrid, entry.recovery]) if (await sha256(await required(descriptor.url)) !== descriptor.hash) throw Error('Online overlay proof hash mismatch.');
  }
  for (const key of Object.keys(validated.routeRoads[0].body.cells)) { const cell = recoveryCellDescriptor(validated.routeRoads[0].body, key); if (!cell.empty) for (const hash of cell.parts || [cell.hash]) if (await sha256(await required(`/world/recovery/${key}.${hash}.json`)) !== hash) throw Error('Online overlay recovery hash mismatch.'); }
  return { ...inventory, bytes: total };
}

export async function prepareOnlineRelease({ release, out = resolve('.desktop/online-release'), log = console.log } = {}) {
  release = release ? resolve(release) : await resolveEffectiveWorldRelease(); out = resolve(out);
  if (out === release || out.startsWith(release + '/')) throw Error('Online output must be separate from immutable source export.');
  await mkdir(dirname(out), { recursive: true });
  if (process.platform === 'win32') {
    const disk = await statfs(dirname(out));
    if (!disk.blocks || 1 - Number(disk.bavail) / Number(disk.blocks) >= .85) throw Error('Disk is at or above 85%; clean owned artifacts first.');
    log(JSON.stringify({ phase: 'disk', freeBytes: Number(disk.bavail) * Number(disk.bsize) }));
  } else {
    const disk = spawnSync('df', ['-h', '/'], { encoding: 'utf8' });
    if (disk.status !== 0) throw Error('Could not check disk before certification.');
    log(disk.stdout.trim());
    const capacity = disk.stdout.trim().split('\n').at(-1).match(/\s(\d+)%\s/);
    if (!capacity || Number(capacity[1]) >= 85) throw Error('Disk is at or above 85%; clean owned artifacts first.');
  }
  const lockPath = out + '.lock';
  const lock = await open(lockPath, 'wx').catch(error => { throw Error('Online certification already running, or release unavailable: ' + error.message); });
  let temp, workspace;
  try {
    await verifyWorldRelease(release);
    const sourceInventoryHash = hash(await readFile(resolve(release, 'offline-world-inventory.json')));
    workspace = await openProofWorkspace({ out, sourceInventoryHash, semanticHash: await physicalProofSemanticHash() });
    temp = workspace.candidate;
    log(JSON.stringify({ phase: 'start', temp: workspace.directory, workers: 4 }));
    const catalogue = await json(resolve(release, 'catalogue.json'));
    const world = resolve(release, 'world-flat.json'), cells = resolve(release, 'world/cells');
    const manifest = await json(world), compiled = catalogue.routes;
    if (!Array.isArray(compiled) || !compiled.length || compiled.length !== catalogue.routeConfig.routes.length) throw Error('Complete compiled route catalogue required for LAN certification.');
    const routeGrids = [], entries = [], started = Date.now();
    for (const c of compiled) {
      const grid = await writeOnlineGrid(c, { world, cells, out: resolve(temp, 'data/routes') });
      routeGrids.push({ hash: grid.hash, body: grid.body });
      entries.push({ id: c.id, routeHash: c.routeHash, onlineGrid: grid.descriptor });
      log(JSON.stringify({ phase: 'grid', route: c.id, slots: grid.body.poses.length, elapsedMs: Date.now() - started }));
    }
    const recovery = await buildParallelRecovery({ world, cells, out: resolve(temp, 'world/recovery'), checkpoint: workspace, onCell: progress => {
      if (progress.cells <= 4 || progress.cells % 25 === 0 || progress.cells === Object.keys(manifest.tiles).length) log(JSON.stringify({ phase: 'recovery', ...progress, elapsedMs: Date.now() - started, rssMB: Math.round(process.memoryUsage().rss / 1024 ** 2) }));
    } });
    const proof = { schemaVersion: 1, routes: entries.map(entry => ({ ...entry, recovery: recovery.descriptor })), routeGrids, routeRoads: [{ hash: recovery.hash, body: recovery.body }], recoveryWorld: recovery.recoveryWorld };
    await writeFile(resolve(workspace.directory, 'root.json'), JSON.stringify({ proof, signature: checkpointSignature(workspace.key, workspace.binding, proof) }), { mode: 0o600 });
    const validated = await validateOnlineRouteRelease(proof, { compiled, manifest });
    const routeConfig = { ...bindOnlineRouteRelease(catalogue.routeConfig, validated, { enable: true }), onlineAvailable: true };
    const nextCatalogue = { ...catalogue, routeConfig, routeGrids: validated.routeGrids, routeRoads: validated.routeRoads, recoveryWorld: validated.recoveryWorld };
    await writeFile(resolve(temp, 'catalogue.json'), JSON.stringify(nextCatalogue));
    await writeFile(resolve(temp, 'route-config.json'), JSON.stringify(routeConfig));
    await writeFile(resolve(temp, 'data/routes/online-release.json'), canonicalJSON(proof));
    const index = await json(resolve(release, 'data/routes/index.json'));
    await writeFile(resolve(temp, 'data/routes/index.json'), JSON.stringify({ ...index, routes: index.routes.map(entry => { const descriptors = routeConfig.routes.find(route => route.id === entry.id); return descriptors ? { ...entry, onlineGrid: descriptors.onlineGrid, recovery: descriptors.recovery } : entry; }) }));
    const changed = new Map();
    const collect = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = resolve(dir, entry.name); if (entry.isDirectory()) await collect(path); else { const name = relative(temp, path).split(sep).join('/'); if (name === 'offline-online-inventory.json') continue; const bytes = await readFile(path); changed.set(name, { path: name, bytes: bytes.length, sha256: hash(bytes) }); } } };
    await collect(temp);
    await writeFile(resolve(temp, 'offline-online-inventory.json'), JSON.stringify({ schemaVersion: 1, sourceInventoryHash, worldSetRevision: manifest.revision, routes: compiled.map(c => c.id), files: [...changed.values()].sort((a, b) => a.path.localeCompare(b.path)) }));
    const verified = await verifyOnlineOverlay({ release, out: temp });
    // Publish the separate generated overlay atomically; keep the immutable
    // source export and any previous verified overlay intact on a failed build.
    const previous = out + '.previous';
    const publish = async source => {
      let movedPrevious = false;
      try { await readFile(resolve(out, 'offline-online-inventory.json')); await rename(out, previous); movedPrevious = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(source, out); } catch (error) { if (movedPrevious) await rename(previous, out); throw error; }
      if (movedPrevious) await rm(previous, { recursive: true, force: true });
    };
    try { await publish(temp); temp = undefined; }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      // The immutable source and checkpoint remain intact during a cross-device
      // copy. Verify an output-parent stage before touching the old release.
      const stage = await workspace.publicationStage();
      try {
        await cp(temp, stage, { recursive: true, errorOnExist: true, force: false });
        await verifyOnlineOverlay({ release, out: stage });
        await publish(stage); await rm(temp, { recursive: true, force: true }); temp = undefined;
      } finally { await workspace.clearPublication(); }
    }
    await workspace.cleanup(); workspace = undefined;
    log(JSON.stringify({ phase: 'complete', routes: routeGrids.length, cells: Object.keys(recovery.body.cells).length, recoveryBytes: recovery.totalBytes, overlayBytes: verified.bytes, elapsedMs: Date.now() - started }));
    return { routes: routeGrids.length, recoveryBytes: recovery.totalBytes, overlayBytes: verified.bytes };
  } catch (error) { if (workspace) log(JSON.stringify({ phase: 'retained-checkpoint', path: workspace.directory, reason: error.message })); throw error; }
  finally { await lock.close(); await rm(lockPath, { force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareOnlineRelease({ release: process.argv[2] || undefined }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
