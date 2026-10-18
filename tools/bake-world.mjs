// Run the existing deterministic generators in Node using exactly the browser's three.js version.
import * as THREE from 'three';
import { encodeMeshoptPack } from './meshopt-pack.mjs';
import { writeWorldDownload } from './world-download-assets.mjs';
import { readFile, writeFile, mkdir, copyFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadMap } from '../src/map.js';
import { buildTerrain } from '../src/terrain.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { buildRoadNetwork } from '../src/road-network.js';
import { packGroup } from '../src/baked-world-pack.js';
import { MAPS } from '../src/map-catalog.js';
import { bakeCacheDir, bakeCacheEnabled, bakeCodeKey, bakeMapKey, lookupEntry, publishEntry, pruneEntries, DEFAULT_MAX_BYTES } from './bake-cache.mjs';

function chooseShuffling(arrays) {
  // Pick raw or byte planes per attribute: roads contain adjacent repeated vertices that raw gzip handles better.
  return arrays.map(a => {
    if (a.BYTES_PER_ELEMENT === 1) return false;
    const raw = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), planes = new Uint8Array(a.byteLength);
    for (let byte = 0; byte < a.BYTES_PER_ELEMENT; byte++) for (let n = 0; n < a.length; n++) planes[byte * a.length + n] = raw[n * a.BYTES_PER_ELEMENT + byte];
    return gzipSync(planes).length < gzipSync(raw).length;
  });
}
export async function generateMapBake(root, id, reads = []) {
  const originalFetch = globalThis.fetch, originalLocation = globalThis.location;
  // loadMap uses fetch in the browser; here its input is the clean build's local map bundle. `reads` lists those files:
  // the bake cache (tools/bake-cache.mjs) keys on them and fails the bake if it ever reads one it does not hash.
  globalThis.fetch = async url => { const path = resolve(root, String(url)); reads.push(path); return new Response(await readFile(path)); };
  globalThis.location = { search: '' };
  try {
    const map = await loadMap(undefined, './', id), network = new RoadNetwork(map), scene = new THREE.Group();
    map.roadNetwork = network;
    const ter = buildTerrain(map.terrain, map.route, [], scene, { coastal: id === 'riviera', farmland: id === 'megara', gardens: id === 'psychiko', network, beachAreas: map.data.areas?.beach || [] });
    const terrain = packGroup(ter.group, { map: id, grid: map.terrain.GX * map.terrain.GZ, height: 0, source: 1 }, [map.terrain.Hc, network.source], chooseShuffling);
    const roads = buildRoadNetwork(network, scene);
    return { map, network, terrain, roads: packGroup(roads, { map: id, grid: map.terrain.GX * map.terrain.GZ, stats: { triangles: network.stats.triangles, tiles: network.stats.tiles } }, [], chooseShuffling), terrainGroup: ter.group, roadsGroup: roads };
  } finally { globalThis.fetch = originalFetch; if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation; }
}
// Bakes one map into `staged`: baked/* (the CDN downloads), data.json (the map data file with its bakedWorld field) and meta.json.
export async function bakeMapEntry(root, id, staged) {
  const def = MAPS.find(m => m.id === id);
  if (!def) throw new Error(`Unknown map ${id}`);
  const dir = resolve(staged, 'baked'); await mkdir(dir, { recursive: true });
  const t = performance.now(), reads = [], bake = await generateMapBake(root, id, reads), paths = {}, meshopt = {}, assets = {}, downloadBytes = {}, meshoptDownloadBytes = {};
  const declared = new Set([def.dataUrl, def.terrainUrl].map(url => resolve(root, url)));
  const undeclared = reads.filter(path => !declared.has(path));
  if (undeclared.length) throw new Error(`Bake of ${id} read files the bake cache does not hash: ${undeclared.join(', ')}. Add them to bakeMapKey in tools/bake-cache.mjs.`);
  let legacyBytes = 0, compactBytes = 0, meshoptViews = 0;
  for (const kind of ['terrain', 'roads']) {
    const bytes = gzipSync(new Uint8Array(bake[kind]), { level: 9 });
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16), name = `${id}-${kind}-${hash}.bin.gz`;
    paths[kind] = await writeWorldDownload(dir, name, bytes, assets);
    downloadBytes[kind] = bytes.length;
    console.log(`Baked ${id} ${kind}: ${bytes.length} bytes`);
    const compact = await encodeMeshoptPack(bake[kind]);
    const jsonSize = new DataView(compact.buffer).getUint32(4, true);
    meshoptViews += JSON.parse(new TextDecoder().decode(compact.subarray(12, 12 + jsonSize))).views.filter(v => v.codec === 'ATTRIBUTES').length;
    const compressed = gzipSync(compact, { level: 9 });
    legacyBytes += bytes.length; compactBytes += compressed.length;
    const digest = createHash('sha256').update(compressed).digest('hex').slice(0, 16);
    const compactName = `${id}-${kind}-${digest}.meshopt.gz`;
    meshopt[kind] = await writeWorldDownload(dir, compactName, compressed, assets);
    meshoptDownloadBytes[kind] = compressed.length;
    console.log(`Meshopt ${id} ${kind}: ${compressed.length} bytes`);
  }
  const data = JSON.parse(await readFile(resolve(root, def.dataUrl), 'utf8'));
  // Reserve 32 KiB for decoder startup; compressed textures additionally need
  // Basis JS/WASM plus their measured image-to-KTX transfer expansion (~1 MiB reserve).
  const savedBytes = legacyBytes - compactBytes;
  const validated = ['riviera', 'penteli', 'megara'].includes(id); // New maps stay legacy until paired startup validation.
  const policy = { geometry: validated && savedBytes > (meshoptViews ? 32 * 1024 : 0), textures: validated && savedBytes > 1024 * 1024, savedBytes, meshoptViews };
  meshopt.enabled = policy.geometry; meshopt.downloadBytes = meshoptDownloadBytes;
  data.bakedWorld = { version: 1, compression: 'gzip', ...paths, meshopt, downloadBytes, assets };
  await writeFile(resolve(staged, 'data.json'), JSON.stringify(data));
  await writeFile(resolve(staged, 'meta.json'), JSON.stringify({ id, policy, files: Object.keys(assets).length }));
  console.log(`Baked ${id} in ${Math.round(performance.now() - t)} ms`);
  bake.terrainGroup.traverse(m => m.geometry?.dispose()); bake.roadsGroup.traverse(m => m.geometry?.dispose());
}
function bakeInChild(root, id, staged) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--bake-entry', root, id, staged], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const text = log.split('\n').filter(Boolean).map(line => `[bake ${id}] ${line}`).join('\n');
      if (text) console.log(text);
      code === 0 ? resolveRun() : reject(new Error(`Bake of ${id} failed (${signal || `exit ${code}`})`));
    });
  });
}
async function pool(items, limit, task) {
  const queue = [...items], run = async () => { while (queue.length) await task(queue.shift()); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
}
/**
 * Bake `ids` into `out`. Each map comes from the content-addressed bake cache when its inputs are unchanged (tools/bake-cache.mjs);
 * misses bake in parallel child processes (ASR_BAKE_JOBS, default min(3, CPUs)) and are cached for the next build.
 */
export async function bakeWorlds(root, out, ids, { cacheDir = bakeCacheEnabled() ? bakeCacheDir() : null, jobs = Number(process.env.ASR_BAKE_JOBS) || Math.min(3, availableParallelism()) } = {}) {
  const dir = resolve(out, 'data/baked'); await mkdir(dir, { recursive: true });
  const t0 = performance.now(), { key: codeKey } = await bakeCodeKey(root), plans = [];
  for (const id of ids) {
    const def = MAPS.find(m => m.id === id);
    if (!def) throw new Error(`Unknown map ${id}`);
    const { key } = await bakeMapKey(root, codeKey, def);
    plans.push({ id, def, key, entry: cacheDir ? await lookupEntry(cacheDir, key) : null, scratch: null });
  }
  const misses = plans.filter(plan => !plan.entry);
  for (const plan of plans) if (plan.entry) console.log(`Bake cache hit ${plan.id} (${plan.key.slice(0, 12)})`);
  const scratchRoot = cacheDir || tmpdir();
  await mkdir(scratchRoot, { recursive: true });
  try {
    await pool(misses, jobs, async plan => {
      console.log(`Bake cache miss ${plan.id} (${plan.key.slice(0, 12)}): baking`);
      const staged = await mkdtemp(resolve(scratchRoot, `.stage-${plan.id}-`));
      try { await bakeInChild(root, plan.id, staged); } catch (e) { await rm(staged, { recursive: true, force: true }); throw e; }
      if (cacheDir) plan.entry = await publishEntry(cacheDir, plan.key, staged); else { plan.entry = staged; plan.scratch = staged; }
    });
    const policy = {};
    for (const plan of plans) {
      const baked = resolve(plan.entry, 'baked');
      for (const file of await readdir(baked)) await copyFile(resolve(baked, file), resolve(dir, file));
      await copyFile(resolve(plan.entry, 'data.json'), resolve(out, plan.def.dataUrl));
      policy[plan.id] = JSON.parse(await readFile(resolve(plan.entry, 'meta.json'), 'utf8')).policy;
    }
    await writeFile(resolve(root, 'src/asset-codec-policy.js'), '// Generated by tools/bake-world.mjs. Startup budgets gate codecs per map.\nexport const MAP_CODEC_POLICY = ' + JSON.stringify(policy, null, 2) + ';\n');
    console.log(`Worlds ready in ${Math.round(performance.now() - t0)} ms (${plans.length - misses.length} cached, ${misses.length} baked)`);
  } finally {
    for (const plan of plans) if (plan.scratch) await rm(plan.scratch, { recursive: true, force: true });
  }
  if (cacheDir) await pruneEntries(cacheDir, { maxBytes: Number(process.env.ASR_CACHE_MAX_BYTES) || DEFAULT_MAX_BYTES, minAgeMs: 10 * 60 * 1000 });
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--bake-entry') {
  const [, , , root, id, staged] = process.argv;
  await bakeMapEntry(root, id, staged);
}
