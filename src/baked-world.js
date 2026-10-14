// Production terrain and OSM strips come from the same generators, run by prepare-deploy.
// Dev, missing/corrupt assets and ?nobake retain the runtime path.
import * as THREE from 'three';
import { decodeGeometryPack } from './baked-geometry.js';
import { terrainMaterial, sampleH } from './terrain.js';
import { roadNetworkMaterial } from './road-network.js';

export async function loadBakedWorld(map, network) {
  const def = map.data.bakedWorld;
  if (!def || def.version !== 1 || new URLSearchParams(location.search).has('nobake') || !network) return null;
  try {
    const packs = await Promise.all([def.terrain, def.roads].map(async url => {
      const r = await fetch(url); if (!r.ok) throw new Error(`Baked world HTTP ${r.status}`);
      if (def.compression !== 'gzip' || typeof DecompressionStream === 'undefined') throw new Error('Baked compression unsupported');
      const buffer = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return decodeGeometryPack(buffer);
    }));
    for (const p of packs) if (p.metadata.map !== map.id || p.metadata.grid !== map.terrain.GX * map.terrain.GZ) throw new Error('Baked world belongs to a different map');
    if (packs[0].arrays[packs[0].metadata.height].length !== packs[0].metadata.grid || packs[0].arrays[packs[0].metadata.source].length !== packs[0].metadata.grid) throw new Error('Invalid baked height grid');
    // Validate every geometry before installing any state, so fallback never sees half a bake.
    for (const p of packs) for (const m of p.metadata.meshes) {
      for (const a of Object.values(m.attributes)) if (!p.arrays[a.array] || !a.itemSize || p.arrays[a.array].length % a.itemSize) throw new Error('Invalid baked attribute');
      if (m.index != null && !p.arrays[m.index]) throw new Error('Invalid baked index');
    }
    return { terrain: packs[0], roads: packs[1] };
  } catch (e) { console.warn('Baked world unavailable; generating:', e.message); return null; }
}
function restoreGroup(pack, materials) {
  const group = new THREE.Group(); group.name = pack.metadata.name;
  for (const m of pack.metadata.meshes) {
    const g = new THREE.BufferGeometry();
    for (const [key, a] of Object.entries(m.attributes)) g.setAttribute(key, new THREE.BufferAttribute(pack.arrays[a.array], a.itemSize, a.normalized));
    if (m.index != null) g.setIndex(new THREE.BufferAttribute(pack.arrays[m.index], 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials[m.material]);
    Object.assign(mesh, { name: m.name, receiveShadow: m.receiveShadow, castShadow: m.castShadow, renderOrder: m.renderOrder, userData: m.userData });
    mesh.layers.mask = m.layers;
    if (m.meshSphere) mesh.boundingSphere = g.boundingSphere;
    group.add(mesh);
  }
  return group;
}
export function restoreBakedTerrain(pack, terrain, network, scene, options) {
  const mat = terrainMaterial(options), coarse = mat.clone();
  coarse.onBeforeCompile = mat.onBeforeCompile; coarse.customProgramCacheKey = mat.customProgramCacheKey;
  Object.assign(coarse, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
  const group = restoreGroup(pack, [mat, coarse]); scene.add(group);
  terrain.Hc = pack.arrays[pack.metadata.height]; network.source = pack.arrays[pack.metadata.source];
  return { group, material: mat, heightC: (x, z) => sampleH(terrain, terrain.Hc, x, z) };
}
export function restoreBakedRoads(pack, network, scene) {
  const group = restoreGroup(pack, [roadNetworkMaterial()]); scene.add(group);
  network.installSurface(group.children.map(m => ({ positions: m.geometry.attributes.position.array, col: m.geometry.attributes.color.array })));
  Object.assign(network.stats, pack.metadata.stats);
  return group;
}
