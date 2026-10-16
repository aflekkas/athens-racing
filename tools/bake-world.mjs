// Run the existing deterministic generators in Node using exactly the browser's three.js version.
import * as THREE from 'three';
import { encodeMeshoptPack } from './meshopt-pack.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadMap } from '../src/map.js';
import { buildTerrain } from '../src/terrain.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { buildRoadNetwork } from '../src/road-network.js';
import { packGroup } from '../src/baked-world-pack.js';

function chooseShuffling(arrays) {
  // Pick raw or byte planes per attribute: roads contain adjacent repeated vertices that raw gzip handles better.
  return arrays.map(a => {
    if (a.BYTES_PER_ELEMENT === 1) return false;
    const raw = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), planes = new Uint8Array(a.byteLength);
    for (let byte = 0; byte < a.BYTES_PER_ELEMENT; byte++) for (let n = 0; n < a.length; n++) planes[byte * a.length + n] = raw[n * a.BYTES_PER_ELEMENT + byte];
    return gzipSync(planes).length < gzipSync(raw).length;
  });
}
export async function generateMapBake(root, id) {
  const originalFetch = globalThis.fetch, originalLocation = globalThis.location;
  // loadMap uses fetch in the browser; here its input is the clean build's local map bundle.
  globalThis.fetch = async url => new Response(await readFile(resolve(root, String(url))));
  globalThis.location = { search: '' };
  try {
    const map = await loadMap(undefined, './', id), network = new RoadNetwork(map), scene = new THREE.Group();
    map.roadNetwork = network;
    const ter = buildTerrain(map.terrain, map.route, [], scene, { coastal: id === 'riviera', farmland: id === 'megara', network, beachAreas: map.data.areas?.beach || [] });
    const terrain = packGroup(ter.group, { map: id, grid: map.terrain.GX * map.terrain.GZ, height: 0, source: 1 }, [map.terrain.Hc, network.source], chooseShuffling);
    const roads = buildRoadNetwork(network, scene);
    return { map, network, terrain, roads: packGroup(roads, { map: id, grid: map.terrain.GX * map.terrain.GZ, stats: { triangles: network.stats.triangles, tiles: network.stats.tiles } }, [], chooseShuffling), terrainGroup: ter.group, roadsGroup: roads };
  } finally { globalThis.fetch = originalFetch; if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation; }
}
export async function bakeWorlds(root, out, ids) {
  const dir = resolve(out, 'data/baked'); await mkdir(dir, { recursive: true });
  const policy = {};
  for (const id of ids) {
    const t = performance.now(), bake = await generateMapBake(root, id), paths = {}, meshopt = {};
    let legacyBytes = 0, compactBytes = 0, meshoptViews = 0;
    for (const kind of ['terrain', 'roads']) {
      const bytes = gzipSync(new Uint8Array(bake[kind]), { level: 9 });
      if (bytes.length > 25 * 1024 * 1024) throw new Error(`Baked ${id}/${kind} exceeds Cloudflare's asset limit`);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16), name = `${id}-${kind}-${hash}.bin.gz`;
      await writeFile(resolve(dir, name), bytes); paths[kind] = `./data/baked/${name}`;
      console.log(`Baked ${id} ${kind}: ${bytes.length} bytes`);
      const compact = await encodeMeshoptPack(bake[kind]);
      const jsonSize = new DataView(compact.buffer).getUint32(4, true);
      meshoptViews += JSON.parse(new TextDecoder().decode(compact.subarray(12, 12 + jsonSize))).views.filter(v => v.codec === 'ATTRIBUTES').length;
      const compressed = gzipSync(compact, { level: 9 });
      legacyBytes += bytes.length; compactBytes += compressed.length;
      if (compressed.length > 25 * 1024 * 1024) throw new Error('Meshopt asset exceeds 25 MiB');
      const digest = createHash('sha256').update(compressed).digest('hex').slice(0, 16);
      const compactName = `${id}-${kind}-${digest}.meshopt.gz`;
      await writeFile(resolve(dir, compactName), compressed); meshopt[kind] = `./data/baked/${compactName}`;
      console.log(`Meshopt ${id} ${kind}: ${compressed.length} bytes`);
    }
    const path = resolve(out, bake.map.definition.dataUrl), data = JSON.parse(await readFile(path, 'utf8'));
    // Reserve 32 KiB for decoder startup; compressed textures additionally need
    // Basis JS/WASM plus their measured image-to-KTX transfer expansion (~1 MiB reserve).
    const savedBytes = legacyBytes - compactBytes;
    const validated = ['riviera', 'penteli', 'megara'].includes(id); // New maps stay legacy until paired startup validation.
    policy[id] = { geometry: validated && savedBytes > (meshoptViews ? 32 * 1024 : 0), textures: validated && savedBytes > 1024 * 1024, savedBytes, meshoptViews };
    meshopt.enabled = policy[id].geometry;
    data.bakedWorld = { version: 1, compression: 'gzip', ...paths, meshopt };
    await writeFile(path, JSON.stringify(data));
    console.log(`Baked ${id} in ${Math.round(performance.now() - t)} ms`);
    bake.terrainGroup.traverse(m => m.geometry?.dispose()); bake.roadsGroup.traverse(m => m.geometry?.dispose());
  }
  await writeFile(resolve(root, 'src/asset-codec-policy.js'), '// Generated by tools/bake-world.mjs. Startup budgets gate codecs per map.\nexport const MAP_CODEC_POLICY = ' + JSON.stringify(policy, null, 2) + ';\n');
}
