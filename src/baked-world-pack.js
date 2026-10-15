// Shared lossless serializer for build-time baking and the first-visit generation worker.
import { encodeGeometryPack } from './baked-geometry.js';

export function packGroup(group, metadata, initial = [], chooseShuffling = () => []) {
  const arrays = [...initial], add = a => { arrays.push(a); return arrays.length - 1; };
  const meshes = group.children.map(m => {
    if (!m.isMesh || m.children.length || m.position.lengthSq() || m.rotation.x || m.rotation.y || m.rotation.z || m.scale.x !== 1 || m.scale.y !== 1 || m.scale.z !== 1) throw new Error('Bake expects flat, world-space meshes');
    return { name: m.name, material: m.userData.coarseTerrain ? 1 : 0,
      receiveShadow: m.receiveShadow, castShadow: m.castShadow, layers: m.layers.mask, renderOrder: m.renderOrder,
      userData: m.userData, meshSphere: !!m.boundingSphere,
      bounds: m.userData.terrainDecode ? { box: [...m.geometry.boundingBox.min.toArray(), ...m.geometry.boundingBox.max.toArray()], sphere: [...m.geometry.boundingSphere.center.toArray(), m.geometry.boundingSphere.radius] } : null,
      attributes: Object.fromEntries(Object.entries(m.geometry.attributes).map(([key, a]) => [key, { array: add(a.array), itemSize: a.itemSize, normalized: a.normalized }])),
      drawRange: { start: m.geometry.drawRange.start, count: Number.isFinite(m.geometry.drawRange.count) ? m.geometry.drawRange.count : null },
      index: m.geometry.index ? add(m.geometry.userData.terrainLodSource || m.geometry.index.array) : null };
  });
  const shuffled = chooseShuffling(arrays);
  return encodeGeometryPack({ ...metadata, name: group.name, meshes }, arrays, shuffled);
}
