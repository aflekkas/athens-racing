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

/** Draw-call budget by performance class (graphics.js PERFORMANCE.chunk): merge the instanced prop chunks the world builders emit
 * (CellInstances, userData.staticCell) that share a geometry, material and distance range into coarser chunks of `cell` metres: one
 * draw call per kind and chunk instead of one per 240-600 m cell. Per-instance fades and culling are untouched (the fade works on each
 * instance's own position). Only instanced props are coarsened (a few dozen triangles per instance): merging the road, terrain and
 * building meshes into bigger chunks was tried first and cut 7% of the calls for 70% more triangles (bounding spheres that always
 * straddle the frustum). Runs on a finished world; `lod` is the scenery LOD list (scenery.js prepareSceneryLod), kept in step. */
export function mergeInstancedCells(root, cell = 1200, { lod = null } = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isInstancedMesh || !o.userData.staticCell || !o.parent || !o.boundingSphere || !o.matrix.equals(IDENTITY)) return;
    const u = o.userData, c = o.boundingSphere.center;
    const key = [o.parent.uuid, o.geometry.uuid, o.material.uuid, !!o.instanceColor, o.castShadow, o.receiveShadow, o.layers.mask, o.renderOrder, o.frustumCulled, u.far, u.near, JSON.stringify(u.impostor ?? null), o.name].join('|') + `#${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
    let list = groups.get(key); if (!list) groups.set(key, list = []);
    list.push(o);
  });
  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length; after++;
    if (list.length < 2) continue;
    const total = list.reduce((n, o) => n + o.count, 0), first = list[0];
    const merged = new THREE.InstancedMesh(first.geometry, first.material, total);
    if (first.instanceColor) merged.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    let at = 0; const sphere = first.boundingSphere.clone();
    for (const o of list) {
      merged.instanceMatrix.array.set(o.instanceMatrix.array.subarray(0, o.count * 16), at * 16);
      if (merged.instanceColor) merged.instanceColor.array.set(o.instanceColor.array.subarray(0, o.count * 3), at * 3);
      at += o.count; if (o !== first) sphere.union(o.boundingSphere);
    }
    merged.instanceMatrix.needsUpdate = true; if (merged.instanceColor) merged.instanceColor.needsUpdate = true;
    merged.boundingSphere = sphere; merged.userData = { ...first.userData }; merged.name = first.name;
    merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow; merged.layers.mask = first.layers.mask; merged.renderOrder = first.renderOrder; merged.frustumCulled = first.frustumCulled;
    merged.matrixAutoUpdate = false; merged.matrixWorldAutoUpdate = false; merged.updateMatrixWorld(true);
    first.parent.add(merged);
    if (lod) { const at = lod.indexOf(first); for (const o of list) { const i = lod.indexOf(o); if (i >= 0) lod.splice(i, 1); } lod.splice(Math.max(0, Math.min(at, lod.length)), 0, merged); }
    for (const o of list) { o.removeFromParent(); o.dispose(); }
  }
  return { before, after };
}
const IDENTITY = new THREE.Matrix4();
