// Low-poly models of the Athens landmarks, built once from procedural boxes, prisms and fans (no assets): the Acropolis with the
// Parthenon, Erechtheion and Propylaia, the Parliament, the Zappeion, the Panathenaic Stadium, the Temple of Olympian Zeus, the
// Arch of Hadrian and the chapel on Lycabettus. Each model is one non-indexed BufferGeometry (position + colour) in the site's own
// frame: origin on the ground, local +x along the footprint's long axis, y up. Lighting is baked into the colours (unlit look):
// roofs full, walls shaded from the same fixed NW sun as the facade shader (`wallShade`), so a model reads as lit without a light.
import * as THREE from 'three';
import { LANDMARK_SITES as S } from './athens-landmark-data.js';

const level = n => { // display-space brightness of a face with unit normal n (walls .75 +- .10 of the NW sun, roofs 1), as linear
  const wall = .75 + .10 * (n[0] * -.6 + n[2] * -.8), l = n[1] > 0 ? wall + (1 - wall) * Math.min(1, n[1] * 1.25) : wall * (1 + n[1] * .3);
  return l <= .04045 ? l / 12.92 : ((l + .055) / 1.055) ** 2.4;
};
const rgb = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/** Accumulates flat-shaded triangles in a stack of local frames. */
export class ModelBuilder {
  constructor() { this.p = []; this.c = []; this.frames = [{ x: 0, y: 0, z: 0, a: 0 }]; }
  get frame() { return this.frames[this.frames.length - 1]; }
  /** Run `fn` inside a frame at (x, y, z) turned by `yaw` (three.js rotation.y) inside the current one. */
  at(x, y, z, yaw, fn) {
    const f = this.frame, cos = Math.cos(f.a), sin = Math.sin(f.a);
    this.frames.push({ x: f.x + x * cos + z * sin, y: f.y + y, z: f.z - x * sin + z * cos, a: f.a + yaw });
    fn(); this.frames.pop();
  }
  w(x, y, z) { const f = this.frame, cos = Math.cos(f.a), sin = Math.sin(f.a); return [f.x + x * cos + z * sin, f.y + y, f.z - x * sin + z * cos]; }
  /** One triangle (counter-clockwise seen from outside); the colour is multiplied by the face shade. */
  tri(a, b, c, colour, flat = false) {
    const A = this.w(...a), B = this.w(...b), C = this.w(...c), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1; n = n.map(k => k / len);
    const k = flat ? 1 : level(n), [r, g, bl] = rgb(colour);
    for (const P of [A, B, C]) { this.p.push(...P); this.c.push(r * k, g * k, bl * k); }
  }
  quad(a, b, c, d, colour, flat) { this.tri(a, b, c, colour, flat); this.tri(a, c, d, colour, flat); }
  /** Axis-aligned box in the current frame: centre (cx, cz), base y0, size w (x) h (y) d (z). Underside left out. */
  box(cx, y0, cz, w, h, d, colour, { top = true } = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], colour); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], colour); // -x
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colour);
  }
  /** Tapered column / drum: `sides` sides, radius r0 at y0 and r1 at y0+h; no caps. */
  column(cx, cz, y0, h, r0, r1, sides, colour) {
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad([cx + c0 * r0, y0, cz + s0 * r0], [cx + c1 * r0, y0, cz + s1 * r0], [cx + c1 * r1, y0 + h, cz + s1 * r1], [cx + c0 * r1, y0 + h, cz + s0 * r1], colour);
    }
  }
  /** Flat lid of a drum (a fan), facing up. */
  disc(cx, cz, y, r, sides, colour) {
    for (let i = 0; i < sides; i++) { const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2; this.tri([cx, y, cz], [cx + Math.sin(a0) * r, y, cz + Math.cos(a0) * r], [cx + Math.sin(a1) * r, y, cz + Math.cos(a1) * r], colour); }
  }
  /** Gable roof over the box (cx, cz, w along x, d along z), eaves at y, ridge `rise` higher along x. */
  gable(cx, y, cz, w, d, rise, colour, wallColour = colour) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y + rise, cz], [x0, y + rise, cz], colour);
    this.quad([x1, y, z0], [x0, y, z0], [x0, y + rise, cz], [x1, y + rise, cz], colour);
    this.tri([x0, y, z0], [x0, y, z1], [x0, y + rise, cz], wallColour); this.tri([x1, y, z1], [x1, y, z0], [x1, y + rise, cz], wallColour);
  }
  /** Hipped roof, ridge `ridge` m shorter than the box at each end. */
  hip(cx, y, cz, w, d, rise, colour, ridge = d / 2) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, r0 = cx - Math.max(0, w / 2 - ridge), r1 = cx + Math.max(0, w / 2 - ridge), yt = y + rise;
    this.quad([x0, y, z1], [x1, y, z1], [r1, yt, cz], [r0, yt, cz], colour); this.quad([x1, y, z0], [x0, y, z0], [r0, yt, cz], [r1, yt, cz], colour);
    this.tri([x0, y, z0], [x0, y, z1], [r0, yt, cz], colour); this.tri([x1, y, z1], [x1, y, z0], [r1, yt, cz], colour);
  }
  /** A triangular pediment standing on a beam along z (width d): front face toward +x, `thick` deep. */
  pediment(cx, y, cz, d, rise, thick, colour, tympanum) {
    const z0 = cz - d / 2, z1 = cz + d / 2, xf = cx + thick / 2, xb = cx - thick / 2;
    this.tri([xf, y, z1], [xf, y, z0], [xf, y + rise, cz], tympanum);
    this.tri([xb, y, z0], [xb, y, z1], [xb, y + rise, cz], tympanum);
    this.quad([xb, y, z1], [xf, y, z1], [xf, y + rise, cz], [xb, y + rise, cz], colour);
    this.quad([xf, y, z0], [xb, y, z0], [xb, y + rise, cz], [xf, y + rise, cz], colour);
  }
  /** A flat dark window / opening on a wall: `origin` is its lower-left corner, u and v unit axes (in the current frame), w and h its size. */
  decal(origin, u, v, w, h, colour) {
    const o = origin, a = [o[0] + u[0] * w, o[1] + u[1] * w, o[2] + u[2] * w], c = [a[0] + v[0] * h, a[1] + v[1] * h, a[2] + v[2] * h], d = [o[0] + v[0] * h, o[1] + v[1] * h, o[2] + v[2] * h];
    this.quad(o, a, c, d, colour, true);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
  get triangles() { return this.p.length / 9; }
}

/** The yaw that points a site's local +z (the front of a model) toward a world point: the footprint's long axis has no direction of its own. */
export function faceToward(site, target) {
  const front = [Math.sin(site.yaw), Math.cos(site.yaw)], to = [target[0] - site.x, target[1] - site.z];
  return front[0] * to[0] + front[1] * to[1] < 0 ? site.yaw + Math.PI : site.yaw;
}
export const FACING = Object.freeze({ parliament: [421, 501], zappeion: [613, 527] });  // the Parliament looks over Syntagma Square; the Zappeion toward the Parliament
const MARBLE = '#d9ccb0', MARBLE_DARK = '#b9aa8b', MARBLE_LIGHT = '#e8dfca', LIMESTONE = '#a89d84', ROCK = '#837a66', TOP = '#c4b89c';

/** Fluted-looking Doric peristyle: `nx` columns along x, `nz` along z, on a stylobate of the given size, with entablature and pediments. */
function peristyle(b, L, W, { nx, nz, base, h, r, solid = true, pediments = true, cellaH = 9, ruin = 0 }) {
  const dx = (L - 2 * r - .4) / (nx - 1), dz = (W - 2 * r - .4) / (nz - 1), x0 = -L / 2 + r + .2, z0 = -W / 2 + r + .2, top = base + h;
  const skip = new Set();
  if (ruin) for (let i = 0; i < nx; i++) for (const j of [0, nz - 1]) if (i > 1 && i < nx - 2 && ((i * 7 + j * 3) % 11) < ruin) skip.add(i * 100 + j);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
    if (skip.has(i * 100 + j)) continue;
    b.column(x0 + i * dx, z0 + j * dz, base, h, r, r * .78, 6, MARBLE);
    b.box(x0 + i * dx, top - .25, z0 + j * dz, r * 2.5, .5, r * 2.5, MARBLE_LIGHT);
  }
  // entablature (architrave + frieze + cornice) on the four sides, then the cella behind the columns
  const e = 2.9;
  b.box(0, top, -W / 2 + r + .2, L - .2, e, r * 2.3, MARBLE); b.box(0, top, W / 2 - r - .2, L - .2, e, r * 2.3, MARBLE);
  b.box(-L / 2 + r + .2, top, 0, r * 2.3, e, W - .2, MARBLE); b.box(L / 2 - r - .2, top, 0, r * 2.3, e, W - .2, MARBLE);
  if (pediments) for (const s of [1, -1]) b.at(s * (L / 2 - r - .2), top + e, 0, s > 0 ? 0 : Math.PI, () => b.pediment(0, 0, 0, W - .3, 3.4, 1.4, MARBLE, MARBLE_DARK));
  if (solid) { b.box(0, base, 0, L - 2 * (r * 2 + 2.2), cellaH, W - 2 * (r * 2 + 1.6), MARBLE_DARK); }
}

/** The Acropolis: rock plateau with a retaining wall, Parthenon, Erechtheion, Propylaia and the bastion of Athena Nike, in a frame at the Parthenon. */
export function buildAcropolis() {
  const b = new ModelBuilder(), P = S.parthenon, E = S.erechtheion, Q = S.propylaia, top = 0.3;
  const rel = s => ({ x: s.x - P.x, z: s.z - P.z });
  // plateau: a 28-gon (WNW-ESE ellipse) with a retaining wall of limestone over rock, buried 50 m so any slope hides its foot
  const cx = -33, cz = -30, ax = 142, az = 74, tilt = -.2, N = 28, ring = [];
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, wob = 1 + .06 * Math.sin(a * 5 + 1) + .04 * Math.sin(a * 3); ring.push([cx + (Math.cos(a) * ax * Math.cos(tilt) - Math.sin(a) * az * Math.sin(tilt)) * wob, cz + (Math.cos(a) * ax * Math.sin(tilt) + Math.sin(a) * az * Math.cos(tilt)) * wob]); }
  const mid = -9, foot = -55;
  for (let i = 0; i < N; i++) {
    const a = ring[i], c = ring[(i + 1) % N];
    b.quad([a[0], top, a[1]], [c[0], top, c[1]], [c[0], mid, c[1]], [a[0], mid, a[1]], LIMESTONE);
    b.quad([a[0], mid, a[1]], [c[0], mid, c[1]], [c[0] * 1.02, foot, c[1] * 1.02], [a[0] * 1.02, foot, a[1] * 1.02], ROCK);
    b.tri([cx, top, cz], [c[0], top, c[1]], [a[0], top, a[1]], TOP);
  }
  const p = rel(P);
  b.at(p.x, top, p.z, P.yaw, () => {
    b.box(0, 0, 0, P.length + 4.6, .5, P.width + 4.6, MARBLE_DARK); b.box(0, .5, 0, P.length + 2.8, .5, P.width + 2.8, MARBLE); b.box(0, 1, 0, P.length + .8, .6, P.width + .8, MARBLE_LIGHT);
    peristyle(b, P.length, P.width, { nx: 17, nz: 8, base: 1.6, h: 10.4, r: .95, cellaH: 9.5 });
  });
  const e = rel(E);
  b.at(e.x, top, e.z, E.yaw, () => { // Erechtheion: asymmetrical hall with the Caryatid porch (south) and the north porch
    b.box(0, 0, 0, E.length + 1.2, .8, E.width + 1.2, MARBLE_DARK);
    b.box(-2, .8, 0, E.length - 7, 8.2, E.width - 9, MARBLE); b.gable(-2, 9, 0, E.length - 7, E.width - 9, 3.2, '#8a7c66', MARBLE_DARK);
    b.box(E.length / 2 - 4.5, .8, -E.width / 2 + 3, 9, 5, 6, MARBLE_LIGHT); // Caryatid porch: a low box on four slim piers
    for (const i of [0, 1, 2, 3]) b.column(E.length / 2 - 7 + i * 2.6, -E.width / 2 + 5.8, .8, 5, .45, .4, 5, MARBLE_LIGHT);
    for (const z of [-1, 1]) b.column(-E.length / 2 + 4, z * 4.6, .8, 8.2, .6, .5, 6, MARBLE_LIGHT);
  });
  const q = rel(Q);
  b.at(q.x, top, q.z, Q.yaw, () => { // Propylaia: gate hall with a six-column front, two wings
    b.box(0, 0, 0, Q.length + 1.2, .6, Q.width + 1.2, MARBLE_DARK);
    b.box(0, .6, 0, Q.length - 8, 8, Q.width - 5, MARBLE); b.box(0, .6, Q.width / 2 - 4, Q.length - 2, 6.5, 8, MARBLE_DARK);
    for (let i = 0; i < 6; i++) b.column(-Q.length / 2 + 3 + i * (Q.length - 6) / 5, -Q.width / 2 + 1.8, .6, 9.3, .8, .65, 6, MARBLE);
    b.box(0, 9.9, -Q.width / 2 + 1.8, Q.length - 3, 2.2, 2.2, MARBLE); b.at(0, 12.1, -Q.width / 2 + 1.8, Math.PI / 2, () => b.pediment(0, 0, 0, Q.length - 3, 2.6, 1.2, MARBLE, MARBLE_DARK));
  });
  b.at(q.x + 14, top, q.z - 24, 0.4, () => { b.box(0, 0, 0, 10, 6.5, 9, MARBLE_DARK); b.box(0, 6.5, 0, 10.4, .6, 9.4, MARBLE_LIGHT); }); // bastion of Athena Nike
  return b;
}

/** Temple of Olympian Zeus: the platform and its fifteen standing columns (the survivors of the south-east corner), in the polygon's frame. */
export function buildOlympieion() {
  const b = new ModelBuilder(), O = S.olympieion, L = O.length, W = O.width;
  b.at(0, 0, 0, O.yaw, () => {
    b.box(0, -14, 0, L + 4, 14.4, W + 4, ROCK); b.box(0, .4, 0, L - 3, .5, W - 3, '#c0b497'); b.box(0, .9, 0, L - 7, .5, W - 7, TOP);
    const gap = 8.3, ox = L / 2 - 8, oz = W / 2 - 7; // 13 columns in three rows at the south-east, two more on the north side of the group
    const spots = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) spots.push([ox - i * gap, oz - row * 5.6]);
    spots.push([ox + gap - 38, oz - 2 * 5.6], [ox - 4 * gap, oz - 2 * 5.6]);
    spots.slice(0, 15).forEach(([x, z], k) => {
      const h = 16.8 + (k % 3) * .2;
      b.column(x, z, 1.4, h, 1.15, .92, 8, MARBLE); b.box(x, 1.4 + h, z, 2.9, 1.7, 2.9, MARBLE_LIGHT); b.box(x, 1.4 + h + 1.7, z, 3.1, .35, 3.1, MARBLE);
    });
    for (let i = 0; i < 3; i++) b.box(ox - i * gap - gap / 2, 1.4 + 18.4, oz, gap - 2.5, 1.4, 2.6, MARBLE_DARK); // architraves still spanning the front row
    b.column(ox - 5 * gap, oz - 4, 1.4, 1.6, 1.15, 1.15, 8, MARBLE_DARK); b.column(ox - 5 * gap + 2.4, oz - 4.3, 1.4, 1.6, 1.15, 1.15, 8, MARBLE_DARK); // drums of the column that fell in 1852
  });
  return b;
}

/** Arch of Hadrian: two piers, an attic with a smaller order over the opening. */
export function buildHadrian() {
  const b = new ModelBuilder(), H = S.hadrian;
  b.at(0, 0, 0, H.yaw, () => {
    const L = 14, d = 2.6;
    b.box(0, -6, 0, L + 6, 6.2, d + 6, '#a89d84'); b.box(-L / 2 + 2, 0, 0, 4, 9, d, MARBLE); b.box(L / 2 - 2, 0, 0, 4, 9, d, MARBLE); b.box(0, 6.6, 0, L, 2.6, d, MARBLE); b.box(0, 9.2, 0, L - 3, 6, d * .9, MARBLE_LIGHT);
    for (const x of [-4, -1.3, 1.3, 4]) b.column(x, 0, 9.2, 5.6, .35, .3, 5, MARBLE); b.box(0, 15.2, 0, L - 2, .5, d, MARBLE);
  });
  return b;
}

function windows(b, w, h, floors, floorH, bays, sign, z, y0 = 2.4) { // dark window openings on the +z (sign 1) or -z face of a box of width w
  const bw = w / bays;
  for (let f = 0; f < floors; f++) for (let k = 0; k < bays; k++) {
    const cx = -w / 2 + bw * (k + .5), y = y0 + f * floorH;
    b.decal([cx - 0.55, y, z + sign * .06], [1, 0, 0], [0, 1, 0], 1.1, floorH * .55, '#262d33');
  }
}

/** The Hellenic Parliament (Old Royal Palace): a long three-floor neoclassical block with a hexastyle portico. */
export function buildParliament() {
  const b = new ModelBuilder(), P = S.parliament, L = P.length, W = P.width * .78, H = 17;
  b.at(0, 0, 0, faceToward(P, FACING.parliament), () => {
    // terrace on the ground it stands on, a paved forecourt level with the street (thick, so a falling street never shows its underside) and the steps up to the portico
    b.box(0, -14, 0, L + 10, 14.2, W + 8, '#b3aa91'); b.box(0, -4, W / 2 + 15, 64, 4.2, 22, '#bdbbb4'); b.box(0, 0, 0, L - 1, 2.2, W - 1, '#b9ab87');
    for (let k = 0; k < 4; k++) b.box(0, -3, W / 2 + 7.5 + k * .9, 44 - k * 2, 3 + 1.65 - k * .55, .9, k % 2 ? '#d8cfb6' : '#cfc6ad');
    b.box(0, 2.2, 0, L - 1, H, W - 1, '#d9c690'); b.box(0, H + 2.2, 0, L, .9, W, '#e2d6b0');
    b.hip(0, H + 3.1, 0, L - 4, W - 4, 3.2, '#77716a', (W - 4) / 2);
    // central portico facing +z: six columns, entablature and pediment; wings step forward at both ends
    b.box(0, 2.2, W / 2 + 3.5, 38, .6, 7, '#cdbf9a');
    for (let i = 0; i < 6; i++) b.column(-15 + i * 6, W / 2 + 5.6, 2.8, 13, .85, .7, 6, '#efe6cf');
    b.box(0, 15.8, W / 2 + 3.5, 38, 2.4, 6.4, '#e6dcc0'); b.at(0, 18.2, W / 2 + 3.5, -Math.PI / 2, () => b.pediment(0, 0, 0, 38, 4.2, 1.4, '#e6dcc0', '#c9b98e'));
    for (const s of [-1, 1]) { b.box(s * (L / 2 - 8), 2.2, W / 2 + 1.5, 16, H, 3, '#d9c690'); b.box(s * (L / 2 - 8), H + 2.2, W / 2 + 1.5, 16.6, .8, 3.6, '#e2d6b0'); }
    windows(b, L - 6, H, 3, 4.6, Math.round((L - 6) / 4.6), 1, W / 2 - .5, 3.4); windows(b, L - 6, H, 3, 4.6, Math.round((L - 6) / 4.6), -1, -(W / 2 - .5), 3.4);
  });
  return b;
}

/** The Zappeion: a neoclassical hall with a hexastyle Ionic portico around a circular peristyle courtyard. */
export function buildZappeion() {
  const b = new ModelBuilder(), Z = S.zappeion, L = Z.length, W = Z.width * .8, H = 13;
  b.at(0, 0, 0, faceToward(Z, FACING.zappeion), () => {
    b.box(0, -12, 0, L + 8, 12.2, W + 8, '#b3aa91'); b.box(0, -4, W / 2 + 10, 50, 4.2, 14, '#d6ccb2'); b.box(0, 0, 0, L - 1, 1.6, W - 1, '#cfc4a8');
    for (let k = 0; k < 3; k++) b.box(0, -3, W / 2 + 4.9 + k * .8, 30 - k * 2, 3 + 1.1 - k * .55, .8, k % 2 ? '#e0d7be' : '#d6ccb2');
    for (const s of [-1, 1]) { b.box(s * (L / 2 - 14), 1.6, 0, 26, H, W - 4, '#e6dcc2'); b.box(s * (L / 2 - 14), H + 1.6, 0, 27, .8, W - 3, '#efe6cf'); b.hip(s * (L / 2 - 14), H + 2.4, 0, 26, W - 4, 2.4, '#8a6f5c', (W - 4) / 2); }
    b.box(0, 1.6, 0, L - 52, H - 3, W - 4, '#e6dcc2');
    b.column(0, 0, 1.6, H + 1, 14, 14, 18, '#e0d6bc'); b.disc(0, 0, H + 2.6, 14, 18, '#7d8b8d'); // the rotunda drum under its low glazed roof
    b.column(0, 0, H + 2.6, 2.4, 11, 7, 18, '#cdbfa0'); b.disc(0, 0, H + 5, 7, 18, '#8fa4a8');
    for (let i = 0; i < 6; i++) b.column(-12.5 + i * 5, W / 2 + 3.4, 1.6, 10.4, .7, .6, 6, '#f1e9d5');
    b.box(0, 12, W / 2 + 3.4, 30, 1.8, 4.2, '#eee5cf'); b.at(0, 13.8, W / 2 + 3.4, -Math.PI / 2, () => b.pediment(0, 0, 0, 30, 3.2, 1.2, '#eee5cf', '#cfc2a0'));
    windows(b, L - 10, H, 2, 5, 14, 1, W / 2 - 1.9, 3.6); windows(b, L - 10, H, 2, 5, 14, -1, -(W / 2 - 1.9), 3.6);
  });
  return b;
}

/** The Panathenaic Stadium: the white-marble horseshoe, ring by ring, from the field barrier up to the crown, open at one end. */
export function buildStadium() {
  const b = new ModelBuilder(), T = S.stadium, L = T.length, Wo = T.width / 2, Wi = 41, curve = T.heavy, arcR = Wo;
  const rings = [[Wi, 1.6], [Wi + 3, 1.6], [Wi + 3, 3.6], [Wi + 8, 3.6], [Wi + 8, 6.4], [Wi + 14, 6.4], [Wi + 14, 10], [Wi + 20, 10], [Wi + 20, 14.4], [Wi + 26, 14.4], [Wi + 26, 19.6], [Wo, 19.6], [Wo, 0]];
  const cxArc = curve * (L / 2 - arcR), xOpen = -curve * L / 2, segs = 20;
  // a ring of half-width w is: the open-end foot of one side, the straight to the arc, the arc, the other side back to the open end
  const path = w => {
    const pts = [[xOpen, w]];
    pts.push([cxArc, w]);
    for (let i = 1; i < segs; i++) { const a = Math.PI * i / segs; pts.push([cxArc + curve * Math.sin(a) * w * (arcR / Wo), Math.cos(a) * w]); }
    pts.push([cxArc, -w], [xOpen, -w]); return pts;
  };
  const tread = '#ece7da', riser = '#cfc9b8';
  b.at(0, 0, 0, T.yaw, () => {
    for (let r = 0; r < rings.length - 1; r++) {
      const [w0, y0] = rings[r], [w1, y1] = rings[r + 1], A = path(w0), B = path(w1);
      for (let i = 0; i < A.length - 1; i++) {
        const a0 = [A[i][0], y0, A[i][1]], a1 = [A[i + 1][0], y0, A[i + 1][1]], b0 = [B[i][0], y1, B[i][1]], b1 = [B[i + 1][0], y1, B[i + 1][1]];
        // oriented so the face looks up (treads) or toward the field (risers); DoubleSide material, flat shading from the actual normal
        if (y0 === y1) b.quad(a0, b0, b1, a1, tread); else b.quad(a0, a1, b1, b0, riser);
      }
    }
    // the sand floor of the arena and its track, so the ground never shows through the horseshoe
    const floor = path(Wi), nf = floor.length;
    for (let j = 0; j < Math.floor(nf / 2); j++) b.quad([floor[j][0], 1.7, floor[j][1]], [floor[j + 1][0], 1.7, floor[j + 1][1]], [floor[nf - 2 - j][0], 1.7, floor[nf - 2 - j][1]], [floor[nf - 1 - j][0], 1.7, floor[nf - 1 - j][1]], '#d8ceb4');
    // outer wall down to the ground
    const [wo, yo] = rings[rings.length - 2], A = path(wo);
    for (let i = 0; i < A.length - 1; i++) b.quad([A[i][0], yo, A[i][1]], [A[i + 1][0], yo, A[i + 1][1]], [A[i + 1][0], -40, A[i + 1][1]], [A[i][0], -40, A[i][1]], '#d6d0c0');
    // the crown: the closing colonnade of the sphendone, 12 columns
    for (let i = 1; i < 12; i++) { const a = Math.PI * i / 12; b.column(cxArc + curve * Math.sin(a) * (Wo - 1.5) * (arcR / Wo), Math.cos(a) * (Wo - 1.5), 19.6, 4.2, .4, .36, 5, '#f1ecdd'); }
  });
  return b;
}

/** The chapel of Agios Georgios on the summit of Lycabettus: a white chapel with a red-tile roof and a bell tower on a terrace. */
export function buildLycabettus() {
  const b = new ModelBuilder();
  b.box(0, -8, 0, 36, 8.4, 24, '#b7b0a0'); b.box(0, 0, 0, 30, .5, 18, '#d6cfc0');
  b.at(0, .5, 0, .35, () => {
    b.box(0, 0, 0, 14, 5.6, 7.5, '#f3f1ea'); b.gable(0, 5.6, 0, 14.6, 8.2, 3.2, '#b0553a', '#f3f1ea');
    b.box(9.4, 0, 1.2, 3.6, 12, 3.6, '#f7f5ee'); b.hip(9.4, 12, 1.2, 4, 4, 2.4, '#b0553a', 2);
    b.box(-9.5, 0, 0, 5, 3.4, 6, '#f3f1ea'); b.hip(-9.5, 3.4, 0, 5.4, 6.4, 1.6, '#b0553a', 2.2);
    b.decal([-3.6, 1.6, 3.82], [1, 0, 0], [0, 1, 0], .9, 1.8, '#3a4650'); b.decal([.5, 1.6, 3.82], [1, 0, 0], [0, 1, 0], .9, 1.8, '#3a4650');
  });
  return b;
}

/** Every landmark: the site (x, z, ground y), its builder and how far it matters. `near` is the radius inside which the tile under it must be loaded. */
export const LANDMARKS = Object.freeze([
  { id: 'acropolis', site: S.parthenon, build: buildAcropolis, hide: [...S.parthenon.hide, ...S.erechtheion.hide, ...(S.propylaia.hide || [])] },
  { id: 'olympieion', site: S.olympieion, build: buildOlympieion, hide: S.olympieion.hide, fit: 'max' },
  { id: 'hadrian', site: S.hadrian, build: buildHadrian, hide: S.hadrian.hide, fit: 'max', margin: 6 },
  { id: 'parliament', site: S.parliament, build: buildParliament, hide: S.parliament.hide || [], fit: 'front', depth: .78, clear: 90, forecourt: { half: 44, from: 4, to: 58 } },
  { id: 'zappeion', site: S.zappeion, build: buildZappeion, hide: S.zappeion.hide || [], fit: 'front', depth: .8, clear: 36, forecourt: { half: 26, from: 4, to: 34 } },
  { id: 'stadium', site: S.stadium, build: buildStadium, hide: S.stadium.hide, fit: 'median' },
  { id: 'lycabettus', site: S.lycabettus, build: buildLycabettus, hide: [], fit: 'max' },
]);
/** Ids (the OSM part of a building row's id) whose flat box the landmark models replace; the tile builder keeps them out of the visible buildings while World detail is on. */
export const LANDMARK_HIDDEN = Object.freeze(new Set(LANDMARKS.flatMap(l => l.hide)));
