// Production terrain and OSM strips come from the same generators, run by prepare-deploy.
// Dev, missing/corrupt assets and ?nobake retain the runtime path.
import * as THREE from 'three';
import { installTerrainLods } from './terrain-lod.js';
import { restoreTerrainLayout } from './terrain-layout.js';
import { loadBakedWorldData } from './baked-world-data.js';
import { terrainMaterial, sampleH } from './terrain.js';
import { installTerrainRefinement } from './terrain-refinement.js';
import { roadNetworkMaterial } from './road-network.js';

export async function loadBakedWorld(map, network) {
  return network ? (map.bakedWorld ?? loadBakedWorldData(map)) : null;
}
function restoreGroup(pack, materials) {
  const group = new THREE.Group(); group.name = pack.metadata.name;
  for (const m of pack.metadata.meshes) {
    const g = new THREE.BufferGeometry();
    for (const [key, a] of Object.entries(m.attributes)) g.setAttribute(key, new THREE.BufferAttribute(pack.arrays[a.array], a.itemSize, a.normalized));
    if (m.index != null) g.setIndex(new THREE.BufferAttribute(pack.arrays[m.index], 1));
    if (m.drawRange) g.setDrawRange(m.drawRange.start, m.drawRange.count ?? Infinity);
    if (m.bounds) {
      g.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(m.bounds.box), new THREE.Vector3().fromArray(m.bounds.box, 3));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(m.bounds.sphere), m.bounds.sphere[3]);
    } else if (!m.userData.terrainDecode) g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials[m.material]);
    Object.assign(mesh, { name: m.name, receiveShadow: m.receiveShadow, castShadow: m.castShadow, renderOrder: m.renderOrder, userData: m.userData });
    mesh.layers.mask = m.layers;
    restoreTerrainLayout(mesh);
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
  installTerrainRefinement(terrain,group);
  installTerrainLods(terrain,group);
  terrain.Hc = pack.arrays[pack.metadata.height]; network.source = pack.arrays[pack.metadata.source];
  return { group, material: mat, heightC: (x, z) => sampleH(terrain, terrain.Hc, x, z) };
}
export function restoreBakedRoads(pack, network, scene) {
  const group = restoreGroup(pack, [roadNetworkMaterial(network.route.streetCircuit)]); scene.add(group);
  network.installSurface(group.children.map(m => ({ positions: m.geometry.attributes.position.array, col: m.geometry.attributes.color.array })));
  Object.assign(network.stats, pack.metadata.stats);
  return group;
}
