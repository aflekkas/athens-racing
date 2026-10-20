// Road marks of the streamed Athens world: yellow kerb paint on the approaches to junctions and on some runs between them (no parking), red and white blocks of paint at bus stops,
// manhole covers and patches of repaired asphalt, as thin decals lying 3 cm over the road (src/world-tile-street-art.js derives the rows, the road's own width measured from
// its asphalt). One dynamic mesh of vertex-coloured triangles near the camera, one draw call, rebuilt every 30 m of driving. World detail Off hides it.
import * as THREE from 'three';

export const MARK_LIMITS = Object.freeze({ near: 140, rebuildMetres: 30, triangles: 16000 });
const KERB = ['#e5b92a', '#e8e8e2', '#c3302b'], MANHOLE = ['#2f2e2c', '#5d5f61'], PATCH = ['#22262a', '#4d555c'];
export const KERB_WIDTH = .32;

export class AthensMarks {
  constructor(parent, { enabled = true } = {}) {
    this.enabled = enabled; this.tiles = new Map(); this.last = { x: Infinity, z: Infinity }; this.stats = { triangles: 0, rows: 0, rebuilds: 0, ms: 0 };
    this.position = new THREE.BufferAttribute(new Float32Array(MARK_LIMITS.triangles * 9), 3); this.colour = new THREE.BufferAttribute(new Float32Array(MARK_LIMITS.triangles * 9), 3);
    this.position.setUsage(THREE.DynamicDrawUsage); this.colour.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', this.position); g.setAttribute('color', this.colour); g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.mesh.name = 'athens-marks'; this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 1; parent.add(this.mesh);
    this.palette = { kerb: KERB.map(c => new THREE.Color(c)), manhole: MANHOLE.map(c => new THREE.Color(c)), patch: PATCH.map(c => new THREE.Color(c)) };
  }
  addTile(key, packet) {
    this.removeTile(key); const ext = packet.metadata.extensions?.worldDetail; if (ext?.roadMarks == null) return;
    this.tiles.set(key, { rows: packet.arrays[ext.roadMarks], o: packet.metadata.origin }); this.last.x = Infinity;
  }
  removeTile(key) { if (this.tiles.delete(key)) this.last.x = Infinity; }
  setEnabled(on) { if (this.enabled === on) return; this.enabled = on; this.mesh.visible = on && this.stats.triangles > 0; this.last.x = Infinity; }
  update(camera) { if (!this.enabled) return; const p = camera.position || camera; if (Math.hypot(p.x - this.last.x, p.z - this.last.z) >= MARK_LIMITS.rebuildMetres) this.rebuild(p.x, p.z); }
  rebuild(x, z) {
    const t0 = performance.now(), P = this.position.array, C = this.colour.array, R = MARK_LIMITS.near; let tri = 0, rows = 0;
    const push = (a, b, c, col) => { if (tri >= MARK_LIMITS.triangles) return; const o = tri * 9; P[o] = a[0]; P[o + 1] = a[1]; P[o + 2] = a[2]; P[o + 3] = b[0]; P[o + 4] = b[1]; P[o + 5] = b[2]; P[o + 6] = c[0]; P[o + 7] = c[1]; P[o + 8] = c[2]; for (let i = 0; i < 3; i++) { C[o + i * 3] = col.r; C[o + i * 3 + 1] = col.g; C[o + i * 3 + 2] = col.b; } tri++; };
    const quad = (a, b, c, d, col) => { push(a, b, c, col); push(a, c, d, col); };
    for (const { rows: r, o } of this.tiles.values()) for (let i = 0; i < r.length; i += 7) {
      const type = r[i], px = r[i + 1] + o[0], py = r[i + 2], pz = r[i + 3] + o[2]; if (Math.abs(px - x) > R || Math.abs(pz - z) > R || Math.hypot(px - x, pz - z) > R) continue; rows++;
      if (type === 0) { const qx = r[i + 4] + o[0], qz = r[i + 5] + o[2], dx = qx - px, dz = qz - pz, l = Math.hypot(dx, dz) || 1, nx = -dz / l * KERB_WIDTH / 2, nz = dx / l * KERB_WIDTH / 2; quad([px - nx, py, pz - nz], [px + nx, py, pz + nz], [qx + nx, py, qz + nz], [qx - nx, py, qz - nz], this.palette.kerb[r[i + 6] | 0]); }
      else if (type === 1) { const rad = r[i + 4], col = this.palette.manhole[r[i + 6] | 0], n = 10; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2; push([px, py, pz], [px + Math.cos(a0) * rad, py, pz + Math.sin(a0) * rad], [px + Math.cos(a1) * rad, py, pz + Math.sin(a1) * rad], col); } }
      else { const yaw = r[i + 4], len = r[i + 5] / 2, c = r[i + 6], tone = c >= 10 ? 1 : 0, wid = (c - tone * 10) / 2, tx = Math.sin(yaw), tz = Math.cos(yaw), nx = tz, nz = -tx; quad([px - tx * len - nx * wid, py, pz - tz * len - nz * wid], [px + tx * len - nx * wid, py, pz + tz * len - nz * wid], [px + tx * len + nx * wid, py, pz + tz * len + nz * wid], [px - tx * len + nx * wid, py, pz - tz * len + nz * wid], this.palette.patch[tone]); }
    }
    this.position.needsUpdate = true; this.colour.needsUpdate = true; this.mesh.geometry.setDrawRange(0, tri * 3); this.mesh.visible = this.enabled && tri > 0;
    this.last = { x, z }; this.stats = { triangles: tri, rows, rebuilds: this.stats.rebuilds + 1, ms: performance.now() - t0 };
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tiles.clear(); }
}
