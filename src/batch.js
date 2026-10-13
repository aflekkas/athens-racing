// Static batching: merges the many small, never-moving meshes of the world (signs, shop boards, kiosks,
// bus stops, signal masts, domes...) into one mesh per material per map cell, to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const sig = (m) => [m.type, m.color?.getHexString(), m.emissive?.getHexString(), m.emissiveIntensity, m.roughness, m.metalness, m.map?.uuid, m.emissiveMap?.uuid,
  m.transparent, m.opacity, m.side, m.vertexColors, m.alphaTest, m.clearcoat, m.toneMapped, !!m.onBeforeCompile && m.onBeforeCompile.toString().length].join('|');

export function batchStatic(root, cell = 450) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const center = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.dynamic || Array.isArray(o.material) || !o.visible) return;
    const g = o.geometry; if (!g.attributes.position || g.morphAttributes.position) return;
    if (o.material.vertexColors || g.attributes.color) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    center.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const key = sig(o.material) + `#${Math.floor(center.x / cell)},${Math.floor(center.z / cell)}#${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}#${o.layers.mask}#${o.renderOrder}`;
    let list = groups.get(key); if (!list) { list = []; groups.set(key, list); }
    list.push(o);
  });
  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length;
    if (list.length < 2) { after++; continue; }
    const geos = [];
    for (const o of list) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(o.matrixWorld);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) { after += list.length; continue; }
    merged.computeBoundingSphere();
    const m0 = list[0];
    const mesh = new THREE.Mesh(merged, m0.material);
    mesh.castShadow = m0.castShadow; mesh.receiveShadow = m0.receiveShadow; mesh.layers.mask = m0.layers.mask; mesh.renderOrder = m0.renderOrder;
    root.add(mesh);
    for (const o of list) o.parent.remove(o);
    after++;
  }
  return { before, after };
}
