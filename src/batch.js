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

/** Static world content never moves: compute its matrices once and take it out of three's per-frame matrix update
 * (by default every object is recomposed and re-multiplied every frame; the Riviera has ~13k of them).
 * Sprites keep updating (signal halos scale with distance). Nothing under these roots may be moved afterwards. */
export function freezeStatic(roots) {
  let frozen = 0;
  // A node whose whole subtree is frozen is also skipped by three's per-frame matrix walk (matrixWorldAutoUpdate):
  // the scene graph has ~13k static nodes, and visiting them every frame cost more than drawing some of them.
  const prune = (o) => {
    let still = !(o.isSprite || o.isBone || o.isSkinnedMesh);
    if (still) { o.matrixAutoUpdate = false; frozen++; }
    for (const c of o.children) if (!prune(c)) still = false;
    return still;
  };
  for (const root of roots) {
    root.updateMatrixWorld(true);
    for (const c of root.children) if (prune(c)) c.matrixWorldAutoUpdate = false;
    if (!root.isSprite && !root.isBone && !root.isSkinnedMesh) { root.matrixAutoUpdate = false; frozen++; }
  }
  return frozen;
}

const updateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;
function updateVisibleMatrixWorld(force) { if (this.visible) updateMatrixWorld.call(this, force); }
/** Pooled models (the traffic fleet) spend most of their life hidden, and three still recomposes every node of a
 * hidden subtree each frame. Skip them: a node shown again recomputes its world matrix on that frame's update
 * (an auto-updating node always flags itself), and nothing draws or reads a hidden pooled model meanwhile. */
export function skipHiddenMatrices(root) {
  root.traverse((o) => { o.updateMatrixWorld = updateVisibleMatrixWorld; });
  return root;
}

// small or cabin-only parts of a detailed car: sub-pixel or behind glass beyond ~60 m
const CABIN = /interior|dashboard|seat|caliper|seal|pedal|steering|driver|helmet|wiper|badge|exhaust/i, LIT = /lamp|light|led|tail|head|indicator|beacon/i;
/** Racing cars carry hundreds of parts at full detail at any distance; hide the small and cabin-only ones beyond
 * `far` m (back at `near`). Lamps and damage parts are never touched; only parts this hid are shown again. */
export class DistanceDetail {
  constructor(root, { radius = 0.2, near = 55, far = 65 } = {}) {
    Object.assign(this, { near, far, hidden: false, off: [] });
    root.updateMatrixWorld(true);
    const named = (o) => { for (let p = o; p && p !== root; p = p.parent) if (CABIN.test(p.name)) return true; return false; };
    this.parts = [];
    root.traverse((o) => {
      if (!o.isMesh || o.parent?.isLOD || o.userData.damagePart || LIT.test(o.name) || o.material?.emissiveIntensity > 0.05) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() < radius || named(o)) this.parts.push(o);
    });
  }
  update(distance) {
    const hide = this.hidden ? distance > this.near : distance > this.far;
    if (hide === this.hidden) return;
    this.hidden = hide;
    if (hide) { this.off = this.parts.filter((o) => o.visible); for (const o of this.off) o.visible = false; }
    else { for (const o of this.off) o.visible = true; this.off = []; }
  }
}
