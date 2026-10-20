// The landmark layer of the streamed Athens world (models: src/athens-landmark-models.js, sites: tools/world-gen/landmarks.py from OSM).
//
// A landmark is drawn only where it can stand: while the cell under it is streamed in, or, when it is beyond the camera's far plane, as a
// distant icon. A distant one keeps its direction and apparent size by being moved to just inside the far plane and scaled down by the
// same ratio (a perspective camera cannot tell), so the Acropolis stays on the skyline above the roofs although no cell, and no fog-free
// geometry, reaches it. It carries a light haze that grows with distance (the aerial perspective). One draw call per landmark in view.
// World detail Off hides everything here.
import * as THREE from 'three';
import { LANDMARKS, FACING, faceToward } from './athens-landmark-models.js';
import { LANDMARK_SITES } from './athens-landmark-data.js';

export const LANDMARK_CELL = 512;
/** Ground heights sampled under a footprint (a 5 x 5 grid over its rectangle, grown by `margin`), reduced to the height the model stands on:
 * `max` stands it on a terrace over the highest ground (its plinth and skirts bury the lower side), `median` follows the middle of the ground. */
export function fitHeight(site, spec, groundAt) {
  if (spec.fit === 'front') { // stands level with the street it faces: the median of the ground along three rows in front of the entrance
    const a = faceToward(site, FACING[spec.id]), L = site.length || 24, W = (site.width || 24) * spec.depth, cos = Math.cos(a), sin = Math.sin(a), ys = [];
    for (const row of [4, 12, 20]) for (let i = 0; i < 5; i++) {
      const lx = (i / 4 - .5) * L * .5, lz = W / 2 + row, y = groundAt(site.x + lx * cos + lz * sin, site.z - lx * sin + lz * cos, site.y);
      if (Number.isFinite(y)) ys.push(y);
    }
    if (ys.length < 8) return null;
    ys.sort((x, y) => x - y); return ys[Math.floor(ys.length / 2)];
  }
  const L = (site.length || 24) + (spec.margin || 0), W = (site.width || 24) + (spec.margin || 0), cos = Math.cos(site.yaw || 0), sin = Math.sin(site.yaw || 0), ys = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const lx = (i / 4 - .5) * L, lz = (j / 4 - .5) * W, y = groundAt(site.x + lx * cos + lz * sin, site.z - lx * sin + lz * cos, site.y);
    if (Number.isFinite(y)) ys.push(y);
  }
  if (ys.length < 8) return null; // not enough of the ground is streamed in yet
  ys.sort((a, b) => a - b);
  return spec.fit === 'max' ? ys[ys.length - 1] : ys[Math.floor(ys.length / 2)];
}
/** True where a street prop would stand inside a landmark's footprint (grown by its `clear` margin): monuments and fountains of OSM that its model replaces. */
export function insideLandmark(x, z) {
  for (const spec of LANDMARKS) {
    const pad = spec.clear; if (!pad) continue;
    const { site } = spec, dx = x - site.x, dz = z - site.z, cos = Math.cos(site.yaw || 0), sin = Math.sin(site.yaw || 0), lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    if (Math.abs(lx) < (site.length || 24) / 2 + pad && Math.abs(lz) < (site.width || 24) / 2 + pad) return true;
  }
  return false;
}
/** The paved forecourts in front of the landmarks that have one, as plaza outlines (flat x, z pairs in metres, with bounds and area) for src/athens-plazas.js:
 * a rectangle in the model's frame in front of its entrance, laid over the ground like any plaza instead of standing on a slab. */
export function forecourtPlazas() {
  const out = [];
  for (const spec of LANDMARKS) {
    const f = spec.forecourt; if (!f) continue;
    const { site } = spec, a = faceToward(site, FACING[spec.id]), cos = Math.cos(a), sin = Math.sin(a), W = (site.width || 24) * spec.depth, p = new Float32Array(8);
    [[-f.half, W / 2 + f.from], [f.half, W / 2 + f.from], [f.half, W / 2 + f.to], [-f.half, W / 2 + f.to]].forEach(([lx, lz], i) => { p[i * 2] = site.x + lx * cos + lz * sin; p[i * 2 + 1] = site.z - lx * sin + lz * cos; });
    out.push({ p, x0: Math.min(p[0], p[2], p[4], p[6]), x1: Math.max(p[0], p[2], p[4], p[6]), z0: Math.min(p[1], p[3], p[5], p[7]), z1: Math.max(p[1], p[3], p[5], p[7]), area: 2 * f.half * (f.to - f.from) });
  }
  return out;
}
/** Fraction of the camera's far plane at which a distant landmark is drawn. */
export const FAR_FRACTION = .96;
export const HAZE = Object.freeze({ nearStart: 250, nearAmount: .5, farAmount: .74, farFull: 9000 });
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Haze (0..1 toward the fog colour) of a landmark at distance d from the camera. Less than the world's own fog: landmarks stay legible. */
export function landmarkHaze(d, far) {
  const edge = far * FAR_FRACTION;
  if (d <= edge) return HAZE.nearAmount * smooth(HAZE.nearStart, edge, d);
  return HAZE.nearAmount + (HAZE.farAmount - HAZE.nearAmount) * smooth(edge, HAZE.farFull, d);
}
/** Where and how big a landmark at (dx, dy, dz) from the camera is drawn: its true place inside the far plane, otherwise the same direction at FAR_FRACTION of it. */
export function landmarkPlacement(dx, dy, dz, far) {
  const d = Math.hypot(dx, dy, dz), edge = far * FAR_FRACTION, k = d > edge ? edge / d : 1;
  return { d, scale: k, dx: dx * k, dy: dy * k, dz: dz * k, far: d > edge };
}

function hazeMaterial(uniforms) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  m.customProgramCacheKey = () => 'athens-landmark-haze-v1';
  m.onBeforeCompile = sh => {
    sh.uniforms.uHaze = uniforms.uHaze; sh.uniforms.uHazeColour = uniforms.uHazeColour;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHaze;uniform vec3 uHazeColour;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb=mix(gl_FragColor.rgb,uHazeColour,uHaze);');
  };
  return m;
}

export class AthensLandmarks {
  /** `parent` is the group in absolute world metres (the rebased detail root); `fog` the scene's THREE.Fog (the haze colour). */
  constructor(parent, fog, { enabled = true, groundAt = null } = {}) {
    this.groundAt = groundAt;
    this.parent = parent; this.fog = fog; this.enabled = enabled; this.keys = new Set(); this.items = []; this.stats = { visible: 0, far: 0, triangles: 0 };
    this.group = new THREE.Group(); this.group.name = 'athens-landmarks'; this.group.visible = enabled; parent.add(this.group);
    for (const spec of LANDMARKS) {
      const model = spec.build(), geometry = model.geometry(), uniforms = { uHaze: { value: 0 }, uHazeColour: { value: new THREE.Color('#9caeae') } };
      const mesh = new THREE.Mesh(geometry, hazeMaterial(uniforms)); mesh.name = 'landmark:' + spec.id; mesh.visible = false; mesh.matrixAutoUpdate = true;
      // every model is built in its own frame (footprint yaw included), so the mesh itself is never turned
      const cell = `${Math.floor(spec.site.x / LANDMARK_CELL)},${Math.floor(spec.site.z / LANDMARK_CELL)}`;
      this.group.add(mesh); this.items.push({ spec, mesh, uniforms, cell, triangles: model.triangles, ground: spec.site.y, fitted: !spec.fit });
    }
  }
  /** The cells that are streamed in; a near landmark needs the one under it. */
  addTile(key) { this.keys.add(key); }
  removeTile(key) { this.keys.delete(key); for (const it of this.items) if (it.cell === key && it.spec.fit) { it.fitted = false; it.ground = it.spec.site.y; } }
  setEnabled(on) { this.enabled = on; this.group.visible = on; }
  /** `ax, ay, az`: the camera's absolute world position; `far`: its far plane. */
  update(ax, ay, az, far) {
    if (!this.enabled) return;
    const fogColour = this.fog?.color; let visible = 0, farCount = 0, triangles = 0;
    for (const it of this.items) {
      const { site } = it.spec;
      // a model that stands on streamed ground takes its height from the ground the cell actually has (the DEM is smoothed toward roads in the bake)
      if (!it.fitted && this.groundAt && this.keys.has(it.cell)) { const y = fitHeight(site, it.spec, this.groundAt); if (y !== null) { it.ground = y; it.fitted = true; } }
      const place = landmarkPlacement(site.x - ax, it.ground - ay, site.z - az, far), shown = place.far || this.keys.has(it.cell);
      it.mesh.visible = shown; if (!shown) continue;
      it.mesh.position.set(ax + place.dx, ay + place.dy, az + place.dz); it.mesh.scale.setScalar(place.scale);
      it.uniforms.uHaze.value = landmarkHaze(place.d, far); if (fogColour) it.uniforms.uHazeColour.value.copy(fogColour);
      visible++; if (place.far) farCount++; triangles += it.triangles;
    }
    this.stats = { visible, far: farCount, triangles };
  }
  /** Compile the one shared program before the first frame it is wanted (a hitch otherwise). */
  warm(renderer, scene, camera) {
    const was = this.items.map(i => i.mesh.visible), g = this.group.visible; this.group.visible = true; for (const i of this.items) i.mesh.visible = true;
    try { renderer.compile(scene, camera); } finally { this.items.forEach((i, k) => { i.mesh.visible = was[k]; }); this.group.visible = g; }
  }
  dispose() { this.group.removeFromParent(); for (const { mesh } of this.items) { mesh.geometry.dispose(); mesh.material.dispose(); } this.items = []; }
}
export { LANDMARK_SITES };
