// The far mountain ring of the streamed Athens world: Hymettus, Penteli, Parnitha, Aigaleo and the hills of the city are always on the
// horizon, although the streamed cells (and the camera's far plane) end well short of them. One draw call, one small data file.
//
// `assets/athens/horizon.bin` (tools/world-gen/horizon.py) is a coarse max-pooled height grid of the whole Attica basin. From the camera,
// every azimuth is walked across it; the steepest elevation angle in each of three distance bands is that band's silhouette. The bands are
// three triangle strips on a cylinder around the camera (far first, painter's order), each fading to the scene's fog colour at its foot
// and tinted bluer the farther it is, which is the aerial perspective. The strips are drawn at the far plane like the sky (gl_Position.xyww):
// anything the world draws is nearer and covers them, and no depth is written. The ring rebuilds every few hundred metres of driving.
// Locked look: unlit colour only. World detail Off hides it.
import * as THREE from 'three';

export const HORIZON_AZIMUTHS = 1440;
/** Distance bands (metres) of the three silhouettes, nearest first, with the ray step, the colour of their rock and how much haze lies on them. */
export const HORIZON_BANDS = Object.freeze([
  { from: 1100, to: 6000, step: 200, rock: '#5a6d6c', top: '#869889', haze: .16 },
  { from: 6000, to: 16000, step: 400, rock: '#6f879b', top: '#94a9b8', haze: .30 },
  { from: 16000, to: 60000, step: 800, rock: '#8aa2b8', top: '#b0c3d3', haze: .48 },
]);
export const HORIZON_RADIUS = 1000;
export const HORIZON_FOOT = -.5;             // radians below the horizon where each strip ends: solid fog colour, so the unstreamed ground beyond the far plane is haze, never a dark void
export const HORIZON_BASE = -.012;           // the strips' bodies stand on the horizon itself
export const HORIZON_REBUILD_METRES = 250;
const EARTH = 6371000 * 1.15;                 // effective radius with refraction: the ring dips with distance, as the real horizon does

/** Parse horizon.bin: { nx, nz, x0, z0, step, quantum, heights } */
export function parseHorizon(buffer) {
  const h = new Int32Array(buffer.slice(0, 32)), [nx, nz, x0, z0, step, quantum] = h, heights = new Uint8Array(buffer, 32, nx * nz);
  if (heights.length !== nx * nz) throw new Error('Truncated horizon grid');
  return { nx, nz, x0, z0, step, quantum, heights };
}
/** Bilinear height in metres at world (x, z); 0 outside the grid (open sea). */
export function horizonHeight(g, x, z) {
  const fx = (x - g.x0) / g.step - .5, fz = (z - g.z0) / g.step - .5, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, h = g.heights, nx = g.nx, nz = g.nz, q = g.quantum;
  if (ix < -1 || iz < -1 || ix >= nx || iz >= nz) return 0;
  const a = ix >= 0 && iz >= 0 && ix < nx && iz < nz ? h[iz * nx + ix] : 0, b = ix + 1 < nx && iz >= 0 && ix + 1 >= 0 && iz < nz ? h[iz * nx + ix + 1] : 0;
  const c = ix >= 0 && iz + 1 < nz && ix < nx && iz + 1 >= 0 ? h[(iz + 1) * nx + ix] : 0, d = ix + 1 < nx && iz + 1 < nz && ix + 1 >= 0 && iz + 1 >= 0 ? h[(iz + 1) * nx + ix + 1] : 0;
  return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) * q;
}
/** tan(elevation) of the highest terrain in each band along azimuth `a` (0 = north, clockwise: east is +x, north is -z), seen from (x, y, z). */
export function bandSlopes(g, x, y, z, a, out = []) {
  const dx = Math.sin(a), dz = -Math.cos(a);
  for (let k = 0; k < HORIZON_BANDS.length; k++) {
    const b = HORIZON_BANDS[k]; let best = -1;
    for (let d = b.from; d <= b.to; d += b.step) {
      const slope = (horizonHeight(g, x + dx * d, z + dz * d) - y - d * d / (2 * EARTH)) / d;
      if (slope > best) best = slope;
    }
    out[k] = best;
  }
  return out;
}
const lin = hex => new THREE.Color(hex);

const VERTEX = `attribute vec3 color;varying vec3 vCol;
void main(){vCol=color;gl_Position=(projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.)).xyww;}`;
const FRAGMENT = `varying vec3 vCol;void main(){gl_FragColor=vec4(vCol,1.);}`;

export class AthensHorizon {
  /** `fog` is the scene's THREE.Fog (the strips fade to its colour). Call `load(url)` once, then `update(camera)` each frame. */
  constructor(parent, fog, { enabled = true } = {}) {
    this.fog = fog; this.grid = null; this.enabled = enabled; this.last = { x: Infinity, z: Infinity }; this.stats = { rebuilds: 0, ms: 0 };
    const A = HORIZON_AZIMUTHS, bands = HORIZON_BANDS.length, vertsPerBand = (A + 1) * 4, positions = new Float32Array(bands * vertsPerBand * 3), colours = new Float32Array(bands * vertsPerBand * 3), index = new Uint32Array(bands * A * 18);
    let k = 0;
    for (let slot = 0; slot < bands; slot++) for (let i = 0; i < A; i++) { const v = (bands - 1 - slot) * vertsPerBand + i * 4; index.set([v, v + 1, v + 4, v + 4, v + 1, v + 5, v + 1, v + 2, v + 5, v + 5, v + 2, v + 6, v + 2, v + 3, v + 6, v + 6, v + 3, v + 7], k); k += 18; }
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(positions, 3); this.colour = new THREE.BufferAttribute(colours, 3);
    this.position.setUsage(THREE.DynamicDrawUsage); this.colour.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position); geometry.setAttribute('color', this.colour); geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.name = 'athens-horizon'; this.mesh.frustumCulled = false; this.mesh.renderOrder = -999; this.mesh.visible = enabled;
    this.rock = HORIZON_BANDS.map(b => [lin(b.rock), lin(b.top)]); this.group = parent; parent.add(this.mesh);
  }
  async load(url) { const r = await fetch(url); if (!r.ok) throw new Error('Athens horizon data is not hosted on this server'); this.setGrid(parseHorizon(await r.arrayBuffer())); }
  setGrid(grid) { this.grid = grid; this.last.x = Infinity; }
  setEnabled(on) { this.enabled = on; this.mesh.visible = on && !!this.grid; }
  /** Rebuild when the camera has moved far enough. `x`, `y`, `z` are absolute world metres (the scene may be rebased); the strips are placed at `camera`. */
  update(camera, x, y, z) {
    this.mesh.visible = this.enabled && !!this.grid; if (!this.mesh.visible) return;
    this.mesh.position.copy(camera.position);
    if (Math.hypot(x - this.last.x, z - this.last.z) >= HORIZON_REBUILD_METRES || Math.abs(y - (this.last.y ?? 1e9)) > 40) this.rebuild(x, y, z);
  }
  rebuild(x, y, z) {
    const t0 = performance.now(), A = HORIZON_AZIMUTHS, g = this.grid, P = this.position.array, C = this.colour.array, fog = this.fog?.color || lin('#9caeae'), R = HORIZON_RADIUS;
    const foot = Math.tan(HORIZON_FOOT) * R, base = Math.tan(HORIZON_BASE) * R, tmp = new THREE.Color(), tmp2 = new THREE.Color(), slopes = [], half = A / 2, samples = Array.from({ length: half + 1 }, () => []);
    const put = (v, px, py, pz, colour) => { P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz; C[v * 3] = colour.r; C[v * 3 + 1] = colour.g; C[v * 3 + 2] = colour.b; };
    // the ray walk runs at half the column count; the crest between samples is interpolated and then roughened with ridge noise
    for (let i = 0; i <= half; i++) bandSlopes(g, x, y, z, (i % half) / half * Math.PI * 2, samples[i]);
    const crests = HORIZON_BANDS.map((_, b) => { const out = new Float32Array(A + 3); for (let i = -1; i <= A + 1; i++) { const f = (((i % A) + A) % A) / 2, i0 = Math.floor(f), t = f - i0, c0 = Math.max(0, samples[i0][b]), c1 = Math.max(0, samples[Math.min(half, i0 + 1)][b]), h = c0 * (1 - t) + c1 * t; out[i + 1] = h > 0 ? h * R * (1 + ridgeNoise(i, b)) : 0; } return out; });
    for (let i = 0; i <= A; i++) {
      const a = (i % A) / A * Math.PI * 2, sx = Math.sin(a) * R, sz = -Math.cos(a) * R;
      for (let b = 0; b < HORIZON_BANDS.length; b++) {
        const v = (b * (A + 1) + i) * 4, band = HORIZON_BANDS[b], [body, ridge] = this.rock[b], c = crests[b], crest = c[i + 1], covered = crest > base + 1;
        put(v, sx, foot, sz, fog); put(v + 1, sx, base, sz, fog);
        if (!covered) { put(v + 2, sx, base, sz, fog); put(v + 3, sx, base, sz, fog); continue; }
        // faces that look toward the sun's side of the sky are lit, the others in shade: the ridge's slope along the azimuth gives the facet; hash gullies break it up
        const slope = (c[Math.min(A + 2, i + 8)] - c[Math.max(0, i - 6)]) / 14, facet = Math.max(-1, Math.min(1, slope / Math.max(1.5, crest * .03))), shade = 1 + .2 * facet + .03 * (hash(Math.floor(i / 9) * 7 + b) - .5);
        tmp.copy(body).multiplyScalar(shade * .94).lerp(fog, Math.min(1, band.haze + .3)); put(v + 2, sx, base + (crest - base) * .5, sz, tmp);
        tmp2.copy(ridge).multiplyScalar(shade).lerp(fog, band.haze); put(v + 3, sx, crest, sz, tmp2);
      }
    }
    this.position.needsUpdate = true; this.colour.needsUpdate = true; this.last = { x, y, z };
    this.stats = { rebuilds: this.stats.rebuilds + 1, ms: performance.now() - t0 };
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
/** Ridge roughness: peaks and saddles along the skyline (value noise over the azimuth column, three octaves), relative to the crest height. */
function ridgeNoise(i, b) { const o = (period, amp, seed) => { const f = i / period + seed + b * 31.7, i0 = Math.floor(f), t = f - i0, s = t * t * (3 - 2 * t); return amp * ((hash(i0) * (1 - s) + hash(i0 + 1) * s) - .5) * 2; }; return o(46, .09, 1.1) + o(15, .055, 7.3) + o(5, .03, 3.9) + o(2.2, .012, 5.1); }
function hash(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }
