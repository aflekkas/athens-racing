import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.r = mulberry32((seed | 0) * 9301 + 49297); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.r()); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
}

export function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') {
  _e.set(rx, ry, rz, order); _q.setFromEuler(_e);
  _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Merge many transformed template geometries (with vertex colours) into one BufferGeometry. */
export class GeoBatch {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.extra = null; }
  add(geo, matrix, color, uvOverride) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const c = color instanceof THREE.Color ? color : new THREE.Color(color ?? 0xffffff);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      if (n) { w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); this.nor.push(w.x, w.y, w.z); } else this.nor.push(0, 1, 0);
      this.col.push(c.r, c.g, c.b);
      if (uvOverride) this.uv.push(uvOverride[0], uvOverride[1]);
      else if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
    }
    if (g !== geo) g.dispose();
    return this;
  }
  get count() { return this.pos.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/**
 * Instanced props bucketed into spatial cells so frustum culling (and the shadow pass) can skip
 * whole cells. add(x,y,z, ry, scale, color?) then build(scene).
 */
export class CellInstances {
  constructor(geo, mat, { cell = 400, shadow = true, receive = true, colors = false, far = 1400, near = 0 } = {}) {
    this.geo = geo; this.mat = mat; this.cell = cell; this.cells = new Map(); this.shadow = shadow; this.receive = receive; this.colors = colors; this.far = far; this.near = near;
    this.meshes = [];
  }
  add(matrix, color) {
    const e = matrix.elements;
    const k = Math.floor(e[12] / this.cell) * 10007 + Math.floor(e[14] / this.cell);
    let c = this.cells.get(k); if (!c) { c = []; this.cells.set(k, c); }
    c.push([matrix, color]);
  }
  addTRS(x, y, z, ry, sx, sy = sx, sz = sx, color, rx = 0, rz = 0) { this.add(M(x, y, z, rx, ry, rz, sx, sy, sz, 'YXZ'), color); }
  build(parent) {
    if (!this.geo.boundingSphere) this.geo.computeBoundingSphere();
    const r0 = this.geo.boundingSphere.radius;
    const tmp = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
    for (const list of this.cells.values()) {
      const m = new THREE.InstancedMesh(this.geo, this.mat, list.length);
      const box = new THREE.Box3();
      let maxS = 1;
      list.forEach(([mat, col], i) => {
        m.setMatrixAt(i, mat);
        mat.decompose(tmp, q, sc); box.expandByPoint(tmp); maxS = Math.max(maxS, sc.x, sc.y, sc.z);
        if (this.colors) m.setColorAt(i, col instanceof THREE.Color ? col : new THREE.Color(col ?? 0xffffff));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      const sph = new THREE.Sphere(); box.getBoundingSphere(sph); sph.radius += r0 * maxS;
      m.boundingSphere = sph;
      m.castShadow = this.shadow; m.receiveShadow = this.receive;
      m.userData.far = this.far; m.userData.near = this.near; // distance culling / LOD (see main.js)
      parent.add(m); this.meshes.push(m);
    }
    return this;
  }
}

export function canvasTex(w, h, draw, { srgb = true, repeat = false, mips = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.generateMipmaps = mips;
  if (!mips) t.minFilter = THREE.LinearFilter;
  return t;
}

export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function polyBounds(p) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  return { x0, x1, z0, z1 };
}
export function polyArea(p) { let a = 0; const n = p.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) a += (p[j * 2] + p[i * 2]) * (p[j * 2 + 1] - p[i * 2 + 1]); return a / 2; }

export const frameYield = () => new Promise((r) => setTimeout(r, 0));
