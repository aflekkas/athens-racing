// The trees of the streamed Athens world: bitter oranges along the quiet streets (src/world-tile-trees.js), palms and cypresses among them, and the
// bake's own tree rows and park candidates drawn as Aleppo pines (flat umbrella crowns), cypresses, oleander bushes and orange-style broadleaves.
// One low-poly vertex-colour model per species, drawn instanced near the camera (one draw call per species in view) with a soft contact shadow under
// each tree (one more, alpha-blended): the crowns are lit from the top and darker underneath in their vertex colours (the locked unlit look),
// and the instance tint varies the green. Replaces the box and billboard trees of src/world-detail.js, which only drew with World detail On anyway.
import * as THREE from 'three';
import { TREE } from './world-tile-trees.js';

export { TREE };
export const TREE_LIMITS = Object.freeze({ capacity: 420, near: 170, rebuildMetres: 8 });
const CAPACITY = { [TREE.orange]: 360, [TREE.pine]: 160, [TREE.cypress]: 140, [TREE.palm]: 90, [TREE.oleander]: 120 };
const NEAR = { [TREE.orange]: 150, [TREE.pine]: 190, [TREE.cypress]: 170, [TREE.palm]: 170, [TREE.oleander]: 80 };
/** Height in metres of the model as built: instance scale is height / this. */
const BASE = { [TREE.orange]: 4.3, [TREE.pine]: 8, [TREE.cypress]: 9, [TREE.palm]: 8.5, [TREE.oleander]: 1.7 };

class Geo {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, ca, cb, cc) { for (const [v, col] of [[a, ca], [b, cb], [c, cc]]) { this.p.push(...v); this.c.push(col.r, col.g, col.b); } }
  quad(a, b, c, d, ca, cb, cc, cd) { this.tri(a, b, c, ca, cb, cc); this.tri(a, c, d, ca, cc, cd); }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3)); g.computeBoundingSphere(); return g; }
  get triangles() { return this.p.length / 9; }
  /** Tapered prism, `sides` sides, no caps. */
  trunk(x, z, y0, h, r0, r1, sides, c0, c1) { for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2; this.quad([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(b) * r0, y0, z + Math.sin(b) * r0], [x + Math.cos(b) * r1, y0 + h, z + Math.sin(b) * r1], [x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1], c0, c0, c1, c1); } }
  /** Low-poly ellipsoid: `rings` bands of `sides` quads closed by a cap fan at the top and a flat bottom, shaded dark below to light on top and a little toward the NW sun; `speckle` (hash 0..1) tints some vertices. */
  blob(cx, cy, cz, rx, ry, rz, sides, rings, dark, light, { speckle = 0, tint = null, seed = 1 } = {}) {
    const col = (u, v, k, key) => { const c = dark.clone().lerp(light, Math.min(1, Math.max(0, u * .95 + (v * -.6 + k * -.8) * .3 - .08)) ** 1.35); if (speckle && tint && u > .2 && u < .95) { const sv = Math.sin((key * 12.9898 + seed * 78.233)) * 43758.5453; if (sv - Math.floor(sv) < speckle) c.lerp(tint, .65); } return c; };
    const ringPts = r => { const t = r / rings, phi = -Math.PI / 2 + Math.PI * t * (rings / (rings + 0)), y = Math.sin(phi), w = Math.cos(phi); return Array.from({ length: sides }, (_, i) => { const a = i / sides * Math.PI * 2 + r * .5; return { p: [cx + Math.cos(a) * w * rx, cy + y * ry, cz + Math.sin(a) * w * rz], n: [Math.cos(a) * w, y, Math.sin(a) * w] }; }); };
    const bands = []; for (let r = 0; r <= rings; r++) bands.push(ringPts(r));
    for (let r = 0; r < rings; r++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, A = bands[r][i], B = bands[r][j], Cc = bands[r + 1][j], D = bands[r + 1][i], u = r / rings, u1 = (r + 1) / rings;
      this.quad(A.p, B.p, Cc.p, D.p, col(u, A.n[0], A.n[2], r * 31 + i), col(u, B.n[0], B.n[2], r * 31 + j), col(u1, Cc.n[0], Cc.n[2], (r + 1) * 31 + j), col(u1, D.n[0], D.n[2], (r + 1) * 31 + i));
    }
  }
}
const C = hex => new THREE.Color(hex);
function orangeTree() { // a bitter orange: 3 to 5 m, a short trunk and a round crown
  const g = new Geo(); g.trunk(0, 0, 0, 1.5, .14, .1, 5, C('#6b5338'), C('#7a6045'));
  g.blob(0, 2.7, 0, 1.75, 1.55, 1.75, 10, 4, C('#0d2415'), C('#74a64a'));
  return g;
}
function pineTree() { // Aleppo pine: a long bare trunk, a flat umbrella of two layers
  const g = new Geo(); g.trunk(0, 0, 0, 6.6, .3, .19, 6, C('#7a553b'), C('#8d6a49'));
  g.blob(.3, 7.0, 0, 3.7, .9, 3.5, 9, 2, C('#1f3a22'), C('#62854a'), { speckle: .12, tint: C('#97ab5d') });
  g.blob(-.5, 8.0, .4, 2.3, .8, 2.2, 7, 2, C('#375b30'), C('#6f9a49'));
  return g;
}
function cypressTree() { // narrow flame
  const g = new Geo(); g.trunk(0, 0, 0, .8, .14, .14, 5, C('#5a4733'), C('#5a4733'));
  g.blob(0, 4.6, 0, .95, 4.4, .95, 7, 4, C('#1f3a24'), C('#3f6a3a'));
  return g;
}
function palmTree() {
  const g = new Geo(); g.trunk(0, 0, 0, 7.4, .3, .2, 6, C('#8a7860'), C('#a28f72'));
  const dark = C('#2f5a2e'), light = C('#6c9a45');
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), up = i % 2 ? 7.9 : 8.3;
    g.tri([0, 7.7, 0], [c * 2.9 - s * .55, up - .9, s * 2.9 + c * .55], [c * 2.9 + s * .55, up - .9, s * 2.9 - c * .55], dark, light, light);
    g.tri([0, 7.7, 0], [c * 2.9 + s * .55, up - .9, s * 2.9 - c * .55], [c * 2.9 - s * .55, up - .9, s * 2.9 + c * .55], dark, light, light); }
  return g;
}
function oleander() {
  const g = new Geo();
  g.blob(0, .75, 0, 1.15, .8, 1.0, 6, 2, C('#2d5230'), C('#6b9a48'), { speckle: .22, tint: C('#e06f98') });
  g.blob(.7, .55, .3, .7, .55, .65, 5, 2, C('#2f5a33'), C('#78a54f'), { speckle: .25, tint: C('#f0a0b8'), seed: 4 });
  return g;
}
const BUILD = { [TREE.orange]: orangeTree, [TREE.pine]: pineTree, [TREE.cypress]: cypressTree, [TREE.palm]: palmTree, [TREE.oleander]: oleander };
export const treeTriangles = species => BUILD[species]().triangles;

/** Species of a bake row: 0 tree, 1 tree row, 2 park candidate, by its seed. */
export function speciesOfBakeRow(kind, seed) {
  const r = seed % 10;
  if (kind === 2) return r < 4 ? TREE.pine : r < 6 ? TREE.cypress : r < 8 ? TREE.orange : TREE.oleander;
  return r < 5 ? TREE.orange : r < 7 ? TREE.pine : r === 7 ? TREE.cypress : r === 8 ? TREE.palm : TREE.orange;
}
const GREENS = ['#ffffff', '#f2fbe8', '#e3f0d4', '#fbf6e2', '#d8e8c8'];

export class AthensTrees {
  /** `parent`: the group in absolute world metres (the rebased detail root). */
  constructor(parent, { enabled = true } = {}) {
    this.enabled = enabled; this.tiles = new Map(); this.near = []; this.last = { x: Infinity, z: Infinity }; this.stats = { instances: 0, drawCalls: 0, triangles: 0, rebuilds: 0 };
    this.group = new THREE.Group(); this.group.name = 'athens-trees'; this.group.visible = enabled; parent.add(this.group);
    this.meshes = new Map(); this.tris = {};
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const species of Object.values(TREE)) {
      const model = BUILD[species](), cap = CAPACITY[species], mesh = new THREE.InstancedMesh(model.geometry(), material, cap);
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.name = 'athens-trees:' + species; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh); this.meshes.set(species, { mesh, cap }); this.tris[species] = model.triangles;
    }
    const disc = new THREE.CircleGeometry(1, 9); disc.rotateX(-Math.PI / 2);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x0c0f08, transparent: true, opacity: .3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.shadow = new THREE.InstancedMesh(disc, shadowMaterial, TREE_LIMITS.capacity); this.shadow.count = 0; this.shadow.visible = false; this.shadow.frustumCulled = false; this.shadow.name = 'athens-tree-shadows'; this.shadow.renderOrder = 2; this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(this.shadow);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }
  /** Read a decoded tile: the bake's vegetation rows and the derived street trees (`worldDetail.streetTrees`). */
  addTile(key, packet) {
    this.removeTile(key);
    const ext = packet.metadata.extensions?.worldDetail, o = packet.metadata.origin, records = [];
    const veg = ext?.vegetation;
    if (veg) { const p = packet.arrays[veg.positionHeight], k = packet.arrays[veg.kind], seed = packet.arrays[veg.seed];
      for (let i = 0; i < k.length; i++) records.push({ species: speciesOfBakeRow(k[i], seed[i]), x: p[i * 4] + o[0], y: p[i * 4 + 1], z: p[i * 4 + 2] + o[2], height: Math.min(10, Math.max(3, p[i * 4 + 3])), yaw: (seed[i] % 628) / 100, variant: seed[i] % 8 }); }
    if (ext?.streetTrees != null) { const r = packet.arrays[ext.streetTrees];
      for (let i = 0; i < r.length; i += 5) { const code = r[i + 4] | 0, species = code >> 3, v = code & 7; records.push({ species, x: r[i] + o[0], y: r[i + 1], z: r[i + 2] + o[2], height: BASE[species] * (species === TREE.orange ? .72 + v * .06 : .85 + v * .04), yaw: r[i + 3], variant: v }); } }
    this.tiles.set(key, records); this.last.x = Infinity;
  }
  removeTile(key) { if (this.tiles.delete(key)) this.last.x = Infinity; }
  setEnabled(on) { if (this.enabled === on) return; this.enabled = on; this.group.visible = on; this.last.x = Infinity; }
  update(camera) {
    if (!this.enabled) return; const p = camera.position || camera;
    if (Math.hypot(p.x - this.last.x, p.z - this.last.z) >= TREE_LIMITS.rebuildMetres) this.rebuild(p.x, p.z);
  }
  rebuild(x, z) {
    const out = []; for (const records of this.tiles.values()) for (const r of records) { const d = Math.hypot(r.x - x, r.z - z); if (d < NEAR[r.species]) out.push({ r, d }); }
    out.sort((a, b) => a.d - b.d); if (out.length > TREE_LIMITS.capacity) out.length = TREE_LIMITS.capacity;
    const M = this._m, Q = this._q, E = this._e, V = this._p, S = this._s, Cc = this._c, used = new Map(); let n = 0, tris = 0;
    for (const { r } of out) {
      const slot = this.meshes.get(r.species), k = used.get(r.species) || 0; if (k >= slot.cap) continue; used.set(r.species, k + 1);
      const s = r.height / BASE[r.species], w = s * (r.species === TREE.cypress ? .9 + (r.variant & 3) * .05 : 1);
      M.compose(V.set(r.x, r.y, r.z), Q.setFromEuler(E.set(0, r.yaw, 0)), S.set(w, s, w)); slot.mesh.setMatrixAt(k, M); slot.mesh.setColorAt(k, Cc.set(GREENS[r.variant % GREENS.length]));
      const radius = (r.species === TREE.cypress ? 1.2 : r.species === TREE.oleander ? 1.5 : r.species === TREE.pine ? 3.4 : r.species === TREE.palm ? 2.2 : 1.9) * w;
      M.compose(V.set(r.x + radius * .15, r.y + .05, r.z + radius * .1), Q.identity(), S.set(radius, 1, radius)); this.shadow.setMatrixAt(n++, M); tris += this.tris[r.species];
    }
    let calls = 0;
    for (const [species, { mesh }] of this.meshes) { const c = used.get(species) || 0; mesh.count = c; mesh.visible = c > 0; if (c) { calls++; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; } }
    this.shadow.count = n; this.shadow.visible = n > 0; if (n) { calls++; this.shadow.instanceMatrix.needsUpdate = true; }
    this.last = { x, z }; this.stats = { instances: n, drawCalls: calls, triangles: tris, rebuilds: this.stats.rebuilds + 1 };
  }
  dispose() { this.group.removeFromParent(); const material = [...this.meshes.values()][0].mesh.material; for (const { mesh } of this.meshes.values()) { mesh.geometry.dispose(); mesh.dispose(); } material.dispose(); this.shadow.geometry.dispose(); this.shadow.material.dispose(); this.shadow.dispose(); this.tiles.clear(); }
}
