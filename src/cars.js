// Car catalogue + procedural car models (lofted bodies), traffic vehicles, the curly-haired driver.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, smoothstep, RNG, canvasTex, damp } from './util.js';
import { trimMat } from './cockpit.js';

// ------------------------------------------------------------------ catalogue (player-selectable)
export const CARS = [
  {
    id: 'mini', name: 'MINI COOPER S CABRIO', short: 'MINI', tag: 'Red, roof down, curls out', color: '#c3121c', accent: '#f3f3f0',
    mass: 1280, power: 150, torque: 320, redline: 6900, idle: 850, gears: [3.4, 2.15, 1.55, 1.2, 0.98, 0.82], final: 3.6, wheelR: 0.31,
    cdA: 0.66, vmax: 255, grip: 1.18, steer: 0.6, yawI: 1.0, drift: 1.15, brake: 1.0, cyl: 4, pitch: 1.0, convertible: true, body: 'mini', drive: 'fwd',
    // chassis: nose-heavy, short and darty; FWD pushes wide on power, tucks in when you lift
    frontW: 0.62, hcg: 0.52, track: 1.50, rsF: 0.6, susHz: 1.9, susZ: 0.5, rollK: 1.0, pitchK: 1.0, alphaPk: 0.115, mfC: 1.45, loadSens: 0.16, clA: 0.05, tc: 0.75, esc: 0.6, shiftT: 0.22, bias: 0.68, steerRate: 1.15, ebrake: 0.16, engine: 'turbo4', turbo: 1,
    stats: { speed: 0.55, accel: 0.55, handling: 0.95, drift: 0.65 },
  },
  {
    id: 'kastro', name: 'KASTRO RS RALLY', short: 'KASTRO RS', tag: 'AWD hot hatch, born sideways', color: '#f2c318', accent: '#1d1d1f',
    mass: 1250, power: 235, torque: 430, redline: 7400, idle: 950, gears: [3.3, 2.2, 1.62, 1.27, 1.04, 0.88], final: 3.9, wheelR: 0.32,
    cdA: 0.74, vmax: 255, grip: 1.12, steer: 0.62, yawI: 0.9, drift: 1.35, brake: 1.05, cyl: 5, pitch: 0.9, body: 'hatch', drive: 'awd',
    // soft rally set-up: lots of body movement, rear-biased AWD that rotates on the brakes and slides on the power
    frontW: 0.6, hcg: 0.55, track: 1.55, rsF: 0.5, susHz: 1.55, susZ: 0.42, rollK: 1.5, pitchK: 1.4, alphaPk: 0.125, mfC: 1.5, loadSens: 0.14, clA: 0.1, tc: 0.3, esc: 0.25, shiftT: 0.12, bias: 0.6, steerRate: 1.15, ebrake: 0.2, awdRear: 0.62, engine: 'turbo5', turbo: 1.3,
    stats: { speed: 0.68, accel: 0.8, handling: 0.8, drift: 1.0 },
  },
  {
    id: 'riviera', name: 'RIVIERA GT3 COUPE', short: 'GT3', tag: 'Rear-engined, flat-six, track scalpel', color: '#f1f1ee', accent: '#c8102e',
    mass: 1430, power: 380, torque: 470, redline: 9000, idle: 1000, gears: [3.75, 2.38, 1.72, 1.34, 1.1, 0.92, 0.79], final: 3.6, wheelR: 0.34,
    cdA: 0.6, vmax: 318, grip: 1.36, steer: 0.55, yawI: 1.1, drift: 0.85, brake: 1.25, cyl: 6, pitch: 1.25, body: 'coupe', drive: 'rwd',
    // stiff, low, rear-engined: huge traction and brakes, aero grip at speed, but lift mid-corner and the tail comes round
    frontW: 0.39, hcg: 0.45, track: 1.6, rsF: 0.58, susHz: 2.6, susZ: 0.6, rollK: 0.5, pitchK: 0.55, alphaPk: 0.09, mfC: 1.62, loadSens: 0.12, clA: 0.85, aeroF: 0.42, tc: 0.5, esc: 0.3, shiftT: 0.07, bias: 0.62, steerRate: 1.25, ebrake: 0.13, engine: 'flat6', turbo: 0,
    stats: { speed: 0.84, accel: 0.86, handling: 1.0, drift: 0.6 },
  },
  {
    id: 'poseidon', name: 'POSEIDON V12 HYPER', short: 'V12', tag: 'Sea-blue wedge, 800 hp, no mercy', color: '#0c5c8a', accent: '#e6e6e6',
    mass: 1620, power: 590, torque: 720, redline: 8700, idle: 1000, gears: [3.2, 2.2, 1.65, 1.3, 1.08, 0.9, 0.76], final: 3.3, wheelR: 0.35,
    cdA: 0.64, vmax: 345, grip: 1.26, steer: 0.5, yawI: 1.25, drift: 1.15, brake: 1.2, cyl: 12, pitch: 1.1, body: 'wedge', drive: 'awd',
    // heavy, wide and planted; lazy to change direction (yaw inertia), monstrous straight-line shove, big downforce
    frontW: 0.43, hcg: 0.44, track: 1.68, rsF: 0.56, susHz: 2.3, susZ: 0.6, rollK: 0.55, pitchK: 0.6, alphaPk: 0.095, mfC: 1.55, loadSens: 0.13, clA: 1.05, aeroF: 0.45, tc: 0.6, esc: 0.45, shiftT: 0.09, bias: 0.62, steerRate: 0.95, ebrake: 0.12, awdRear: 0.7, engine: 'v12', turbo: 0,
    stats: { speed: 1.0, accel: 1.0, handling: 0.72, drift: 0.85 },
  },
  {
    id: 'taxi', name: 'ATHENS TAXI', short: 'TAXI', tag: 'Diesel, yellow, fears nothing', color: '#f2c418', accent: '#1d1d1f',
    mass: 1560, power: 125, torque: 330, redline: 5200, idle: 800, gears: [3.9, 2.3, 1.5, 1.1, 0.85, 0.7], final: 3.2, wheelR: 0.33,
    cdA: 0.74, vmax: 212, grip: 0.98, steer: 0.58, yawI: 1.2, drift: 0.85, brake: 0.9, cyl: 4, pitch: 0.72, body: 'sedan', taxi: true, drive: 'rwd',
    // soft and wallowy on old dampers, slow steering, early-shifting slushbox, diesel clatter; RWD so it will hang the tail out
    frontW: 0.53, hcg: 0.58, track: 1.52, rsF: 0.62, susHz: 1.25, susZ: 0.32, rollK: 2.0, pitchK: 1.9, alphaPk: 0.135, mfC: 1.42, loadSens: 0.2, clA: 0.0, tc: 0.9, esc: 0.75, shiftT: 0.4, bias: 0.7, steerRate: 0.75, ebrake: 0.2, engine: 'diesel', turbo: 0.8,
    stats: { speed: 0.4, accel: 0.35, handling: 0.5, drift: 0.8 },
  },
];

// body shape presets: key stations along the length (t: -1 rear .. +1 front), top heights; cabin from cabin[0]..cabin[1]
const SHAPES = {
  hatch: { L: 4.15, W: 1.82, H: 1.44, wb: 2.55, belt: 0.92, roofT: [-0.82, 0.18], ws: [0.18, 0.48], rw: [-0.95, -0.82], nose: 0.66, tail: 0.98, bottom: 0.2, track: 0.78, tumble: 0.8 },
  sedan: { L: 4.75, W: 1.8, H: 1.46, wb: 2.78, belt: 0.95, roofT: [-0.5, 0.2], ws: [0.2, 0.5], rw: [-0.78, -0.5], nose: 0.72, tail: 0.86, bottom: 0.2, track: 0.78, tumble: 0.8 },
  coupe: { L: 4.5, W: 1.85, H: 1.29, wb: 2.45, belt: 0.82, roofT: [-0.42, 0.1], ws: [0.1, 0.46], rw: [-0.9, -0.42], nose: 0.6, tail: 0.84, bottom: 0.14, track: 0.8, tumble: 0.75, fastback: true },
  wedge: { L: 4.7, W: 2.0, H: 1.14, wb: 2.7, belt: 0.74, roofT: [-0.32, 0.04], ws: [0.04, 0.52], rw: [-0.72, -0.32], nose: 0.42, tail: 0.86, bottom: 0.12, track: 0.86, tumble: 0.68, fastback: true },
  suv: { L: 4.6, W: 1.9, H: 1.7, wb: 2.75, belt: 1.08, roofT: [-0.85, 0.22], ws: [0.22, 0.5], rw: [-0.96, -0.85], nose: 0.9, tail: 1.08, bottom: 0.3, track: 0.8, tumble: 0.85 },
  van: { L: 5.0, W: 2.0, H: 2.15, wb: 3.1, belt: 1.15, roofT: [-0.98, 0.5], ws: [0.5, 0.72], rw: [-1.0, -0.98], nose: 1.0, tail: 2.1, bottom: 0.3, track: 0.85, tumble: 0.95, flatEnds: true },
  bus: { L: 12, W: 2.5, H: 3.1, wb: 6.0, belt: 1.25, roofT: [-0.99, 0.97], ws: [0.97, 0.995], rw: [-1.0, -0.99], nose: 1.25, tail: 3.0, bottom: 0.35, track: 1.0, tumble: 0.98, flatEnds: true },
};

function profileTop(sh, t) {
  // centre-line height of the top surface at station t
  const { belt, H, roofT, ws, rw, nose, tail } = sh;
  if (t > ws[1]) { const k = (t - ws[1]) / (1 - ws[1]); return lerp(belt + 0.04, nose, Math.pow(k, 1.8)); }
  if (t > ws[0]) { const k = (t - ws[0]) / (ws[1] - ws[0]); return lerp(H, belt + 0.04, smoothstep(0, 1, k) * 0.9 + k * 0.1); }
  if (t > roofT[0]) return H + 0.015 * Math.sin(Math.PI * (t - roofT[0]) / (roofT[1] - roofT[0]));
  if (t > rw[0]) { const k = (roofT[0] - t) / (roofT[0] - rw[0]); return lerp(H, sh.fastback ? belt + 0.06 : tail, sh.fastback ? Math.pow(k, 0.9) : smoothstep(0, 1, k)); }
  const k = (rw[0] - t) / (1 + rw[0] + 1e-6); return lerp(sh.fastback ? belt + 0.06 : tail, sh.fastback ? belt - 0.02 : tail - 0.06, k);
}

/** Lofted car body: paint + glass + black trim in one geometry with groups. */
export function buildBodyGeo(sh) {
  const N = 72, half = sh.L / 2, W = sh.W / 2;
  const rings = [];
  const glassFlags = [];
  for (let i = 0; i < N; i++) {
    const t = -1 + 2 * i / (N - 1);
    const s = t * half;
    const e = clamp((Math.abs(t) - 0.8) / 0.2, 0, 1);
    let f = Math.sqrt(Math.max(0, 1 - e * e * (t > 0 ? 0.92 : 0.85)));
    if (sh.flatEnds) f = Math.max(f, t > 0 ? 0.9 : 0.97);
    const w = W * (0.88 + 0.12 * f) * (t > 0.9 ? f * 0.3 + 0.7 : 1);
    const yb = sh.bottom + (t > 0.85 || t < -0.88 ? 0.08 * e : 0);
    let top = profileTop(sh, t);
    const belt = Math.min(top, sh.belt + (t > 0 ? -0.02 : 0.03) * Math.abs(t));
    const c = Math.max(0, top - belt);
    const k = smoothstep(0.02, 0.12, c);
    const mid = lerp(yb, belt, 0.55);
    const tb = sh.tumble;
    const pts = [
      [0, yb], [w * 0.86, yb], [w, yb + 0.14], [w * 1.0, mid], [w * 0.985, belt - 0.04], [w * 0.95, belt + 0.005],
      [lerp(w * 0.82, w * 0.92, 1 - k), belt + lerp(0.015, 0.03, k)],
      [lerp(w * 0.6, w * tb, k), lerp(belt + 0.04, belt + c * 0.86, k)],
      [lerp(w * 0.36, w * (tb - 0.1), k), lerp(belt + 0.05, belt + c * 0.98, k)],
      [0, lerp(belt + 0.06, top + 0.02, k)],
    ];
    const ring = [];
    const full = pts.concat(pts.slice(1, pts.length - 1).reverse().map(([x, y]) => [-x, y]));
    const ym = (yb + top) / 2;
    for (const [x, y] of full) ring.push(new THREE.Vector3(x * (0.25 + 0.75 * f), ym + (y - ym) * (0.35 + 0.65 * f), -s));
    rings.push(ring);
    glassFlags.push({ c, t, top });
  }
  const R = rings[0].length;
  const pos = [], idxP = [], idxG = [], idxB = [];
  for (const r of rings) for (const v of r) pos.push(v.x, v.y, v.z);
  const nHalf = 10;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < R; j++) {
    const j2 = (j + 1) % R;
    const a = i * R + j, b = i * R + j2, c = (i + 1) * R + j, d = (i + 1) * R + j2;
    const rj = j < nHalf - 1 ? j : R - 1 - j; // segment index on the right half
    const g0 = glassFlags[i], g1 = glassFlags[i + 1];
    let list = idxP;
    if (rj === 6 && g0.c > 0.12 && g1.c > 0.12 && Math.abs(g0.t) < 0.98) list = idxG; // side windows
    if ((rj === 7 || rj === 8) && g0.c > 0.06 && g1.c > 0.06) {
      const slope = Math.abs(g1.top - g0.top) / (sh.L / (N - 1));
      if (slope > 0.22) list = idxG; // windscreen / rear window
    }
    if (rj <= 1) list = idxB; // sills / underside
    list.push(a, c, b, b, c, d);
  }
  // end caps
  const capF = [], capR = [];
  for (let j = 1; j < R - 1; j++) { capR.push(0, j + 1, j); const o = (N - 1) * R; capF.push(o, o + j, o + j + 1); }
  if (sh.flatEnds) { // flat panels at both ends, wound both ways so they always render
    const rev = (c) => { const o = []; for (let i = 0; i < c.length; i += 3) o.push(c[i], c[i + 2], c[i + 1]); return o; };
    idxP.push(...capR, ...rev(capR), ...capF, ...rev(capF));
  } else { idxB.push(...capR); idxP.push(...capF); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const idx = idxP.concat(idxG, idxB);
  g.setIndex(idx);
  g.addGroup(0, idxP.length, 0); g.addGroup(idxP.length, idxG.length, 1); g.addGroup(idxP.length + idxG.length, idxB.length, 2);
  g.computeVertexNormals();
  // the loft winds inward in this frame: flip if a side normal points to -x
  const nrm = g.attributes.normal;
  if (nrm.getX(Math.floor(N / 2) * R + 3) < 0) {
    for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  return g;
}

// ------------------------------------------------------------------ the Mini (hand-tuned loft, convertible)
const ML2 = 1.91, MWHEELS = [1.22, -1.24], MARCH = 0.375, MWY = 0.31;
function miniProfile(s) {
  let W = 0.86;
  if (s > 1.0) W -= (s - 1.0) * 0.07;
  if (s < -1.3) W -= (-1.3 - s) * 0.06;
  let yb = 0.24;
  for (const ws of MWHEELS) { const d = s - ws; if (Math.abs(d) < MARCH) yb = Math.max(yb, MWY + Math.sqrt(MARCH * MARCH - d * d) * 0.97); }
  let yt;
  if (s >= 0.62) { const t = (s - 0.62) / (ML2 - 0.62); yt = 0.985 - 0.15 * Math.pow(t, 1.5); }
  else if (s >= -1.2) yt = 0.985 + (0.62 - s) * 0.008;
  else { const t = (-1.2 - s) / (ML2 - 1.2); yt = 1.0 - t * t * 0.13; }
  const c = smoothstep(-1.17, -1.11, s) * (1 - smoothstep(0.47, 0.53, s));
  return { W, yb, yt, c, yf: 0.44 };
}
function buildMiniBody(paintHex, stripeHex) {
  const N = 150;
  const innerFracs = [0.79, 0.70, 0.58, 0.48, 0.40, 0.315, 0.25, 0.19, 0.135, 0.093, 0.045, 0];
  const K = innerFracs.length;
  const rings = [], info = [];
  for (let i = 0; i < N; i++) {
    const s = -ML2 + (2 * ML2) * i / (N - 1);
    const { W, yb, yt, c, yf } = miniProfile(s);
    const ys = lerp(yb, yt, 0.5);
    const crown = s > 0.62 ? 0.04 : 0.02;
    const right = [[0, yb], [W * 0.5, yb], [W - 0.1, yb], [W - 0.03, yb + 0.025], [W, yb + 0.09], [W + 0.005, Math.max(ys, yb + 0.12)], [W - 0.012, lerp(ys, yt, 0.55)], [W - 0.045, yt - 0.06], [W - 0.085, yt - 0.015], [W - 0.13, yt]];
    const cock = [[W - 0.16, yt + 0.004], [W - 0.19, yt - 0.03], [W - 0.2, yt - 0.12], [W - 0.2, lerp(yt, yf, 0.45)], [W - 0.21, lerp(yt, yf, 0.85)], [W - 0.25, yf], [0.48, yf], [0.38, yf], [0.28, yf], [0.18, yf], [0.09, yf], [0, yf]];
    for (let k = 0; k < K; k++) { const x = innerFracs[k] * W; const ny = yt + crown * (1 - (x / W) * (x / W)); right.push([lerp(x, cock[k][0], c), lerp(ny, cock[k][1], c)]); }
    const R = s > 0 ? 0.3 : 0.24;
    const e = clamp((Math.abs(s) - (ML2 - R)) / R, 0, 1);
    const f = Math.sqrt(Math.max(0, 1 - e * e));
    const ym = (yb + yt) * 0.5;
    const full = right.concat(right.slice(1, right.length - 1).reverse().map(([x, y]) => [-x, y]));
    rings.push(full.map(([x, y]) => new THREE.Vector3(x * f, ym + (y - ym) * (0.3 + 0.7 * f), -s)));
    info.push({ s, c });
  }
  const R = rings[0].length, nRight = 10 + K;
  const pos = []; for (const r of rings) for (const v of r) pos.push(v.x, v.y, v.z);
  const red = new THREE.Color(paintHex), white = new THREE.Color(stripeHex);
  const outer = [], inner = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < R; j++) {
    const j2 = (j + 1) % R;
    const a = i * R + j, b = i * R + j2, c = (i + 1) * R + j, d = (i + 1) * R + j2;
    const rj = j < nRight - 1 ? j : R - 1 - j;
    const cc = Math.max(info[i].c, info[i + 1].c);
    const interior = rj >= 10 && cc > 0.5;
    let col = red;
    if (!interior && (rj === 16 || rj === 18) && info[i].s > 0.68 && info[i + 1].s < 1.86) col = white;
    (interior ? inner : outer).push([a, c, b, col], [b, c, d, col]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const all = []; for (const t of outer.concat(inner)) all.push(t[0], t[1], t[2]);
  g.setIndex(all); g.computeVertexNormals();
  const nrm = g.attributes.normal;
  if (nrm.getX(Math.floor(N / 2) * R + 5) < 0) { for (const t of outer.concat(inner)) { const q = t[1]; t[1] = t[2]; t[2] = q; } const ai = []; for (const t of outer.concat(inner)) ai.push(t[0], t[1], t[2]); g.setIndex(ai); g.computeVertexNormals(); }
  const expand = (list, withColor) => {
    const P = [], Nn = [], Cc = [];
    for (const t of list) for (let k = 0; k < 3; k++) { const vi = t[k]; P.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]); Nn.push(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi)); if (withColor) Cc.push(t[3].r, t[3].g, t[3].b); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    if (withColor) geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    return geo;
  };
  return { outer: expand(outer, true), inner: expand(inner, false) };
}

// ------------------------------------------------------------------ shared materials / bits
function tireMaterial() {
  // rubber: tread grooves on the running surface, moulded lettering band on the sidewall
  const m = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.88 });
  m.customProgramCacheKey = () => 'tire6';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float rr = length(vTP.yz), a = atan(vTP.y, vTP.z);
          float tread = step(0.95, rr) * (0.8 + 0.2 * step(0.5, fract(a * 18.0))) * (1.0 - 0.35 * step(abs(vTP.x), 0.12) * step(0.5, fract(a * 40.0)));
          float side = step(rr, 0.93) * step(0.7, rr);
          float letters = side * step(0.6, fract(a * 9.0 + 0.3)) * step(0.78, rr) * step(rr, 0.86) * step(0.5, fract(a * 70.0));
          diffuseColor.rgb *= (rr > 0.95 ? tread : 1.0);
          diffuseColor.rgb += letters * 0.035;
        }`);
  };
  return m;
}
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const plateTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#1446a0'; g.fillRect(0, 0, 70, h);
    g.fillStyle = '#ffd200'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.arc(35 + Math.cos(a) * 18, 44 + Math.sin(a) * 18, 3, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = '700 30px Arial'; g.textAlign = 'center'; g.fillText('GR', 35, 108);
    g.fillStyle = '#111'; g.font = '700 84px "Arial Narrow", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('YKH 2026', 290, 68);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
  SHARED = {
    tire: tireMaterial(),
    rim: envd(new THREE.MeshStandardMaterial({ color: '#b4b8bd', metalness: 1, roughness: 0.22 })),
    rimDark: envd(new THREE.MeshStandardMaterial({ color: '#2b2d30', metalness: 0.85, roughness: 0.3 })),
    black: envd(new THREE.MeshStandardMaterial({ color: '#0c0c0d', roughness: 0.5 })),
    chrome: envd(new THREE.MeshStandardMaterial({ color: '#f2f2f2', metalness: 1, roughness: 0.06 })),
    glassDark: envd(new THREE.MeshPhysicalMaterial({ color: '#06090b', metalness: 0, roughness: 0.02, specularIntensity: 1, ior: 1.52, envMapIntensity: 1.2 })),
    glassClear: envd(new THREE.MeshPhysicalMaterial({ color: '#c9dde8', roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false })),
    head: envd(new THREE.MeshPhysicalMaterial({ color: '#d9e0e4', metalness: 0.7, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#fff4e4', emissiveIntensity: 0.45 })),
    plate: new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }),
    interior: new THREE.MeshStandardMaterial({ color: '#25211e', roughness: 0.8 }),
    tireGeo: (() => { const g = new THREE.LatheGeometry([new THREE.Vector2(0.62, -0.5), new THREE.Vector2(0.9, -0.52), new THREE.Vector2(0.98, -0.42), new THREE.Vector2(1, -0.2), new THREE.Vector2(1, 0.2), new THREE.Vector2(0.98, 0.42), new THREE.Vector2(0.9, 0.52), new THREE.Vector2(0.62, 0.5)], 24); g.rotateZ(Math.PI / 2); return g; })(),
    rimGeo: (() => { const g = new THREE.CylinderGeometry(0.64, 0.64, 0.8, 20); g.rotateZ(Math.PI / 2); return g; })(),
    spokeGeo: new THREE.BoxGeometry(0.12, 1.1, 0.16),
  };
  return SHARED;
}
// reflections of the real surroundings: a cube probe that follows the player (see main.js) feeds every car material
export const CAR_ENV = { tex: null };
const envd = (m) => { if (CAR_ENV.tex) m.envMap = CAR_ENV.tex; return m; };
export function setCarEnv(tex) { CAR_ENV.tex = tex; if (SHARED) for (const m of Object.values(SHARED)) if (m && m.isMaterial) m.envMap = tex; }
export function paintMaterial(hex, metallic = 0.4) {
  // two-layer car paint: metallic base coat under a glossy clear coat
  return envd(new THREE.MeshPhysicalMaterial({ color: hex, metalness: metallic, roughness: 0.42 - metallic * 0.2, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0 }));
}
function tailMaterial() { return envd(new THREE.MeshPhysicalMaterial({ color: '#4a0303', emissive: '#ff1a0a', emissiveIntensity: 1.2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 })); }

function addWheels(car, sh, r, width, spokes = 5, dark = false) {
  const S = shared();
  car.wheels = [];
  const zs = [sh.wb / 2, -sh.wb / 2];
  for (const z of zs) for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * sh.track * sh.W / 2 * 1.02, r, -z);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = new THREE.Mesh(S.tireGeo, S.tire); t.scale.set(width, r, r); t.castShadow = true; spin.add(t);
    const rim = new THREE.Mesh(S.rimGeo, dark ? S.rimDark : S.rim); rim.scale.set(width * 0.9, r, r); spin.add(rim);
    for (let k = 0; k < spokes; k++) { const sp = new THREE.Mesh(S.spokeGeo, dark ? S.rimDark : S.rim); sp.scale.set(width * 0.5, r * 0.95, r * 0.7); sp.position.x = sx * width * 0.42; sp.rotation.x = k / spokes * Math.PI * 2; spin.add(sp); }
    car.root.add(pivot);
    car.wheels.push({ pivot, spin, front: z > 0, r });
  }
}

// ------------------------------------------------------------------ player / rival car model
export class CarModel {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    const S = shared();
    this.paint = paintMaterial(spec.color, spec.id === 'riviera' ? 0.15 : 0.45);
    this.tail = tailMaterial();
    if (spec.body === 'mini') this.buildMini(); else this.buildGeneric();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.wheelSpin = 0;
    // contact shadow
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(this.dims.W * 1.25, this.dims.L * 1.15), blobMaterial());
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.renderOrder = 1; blob.castShadow = false; this.root.add(blob);
  }
  buildMini() {
    const S = shared();
    const { outer, inner } = buildMiniBody(this.spec.color, this.spec.accent);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.paint = paint;
    this.body.add(new THREE.Mesh(outer, paint));
    const solid = paintMaterial(this.spec.color, 0.3);
    const frameMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(this.spec.color).multiplyScalar(0.55), roughness: 0.55, metalness: 0.2, clearcoat: 0.2 });
    const im = new THREE.Mesh(inner, S.interior.clone()); im.material.side = THREE.DoubleSide; this.body.add(im);
    const sh = { wb: 2.46, W: 1.72, track: 0.88 };
    addWheels(this, sh, 0.31, 0.21, 7);
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); this.body.add(m); return m; };
    // windscreen frame + glass
    const wsBase = new THREE.Vector3(0, 0.985, -0.6), wsTop = new THREE.Vector3(0, 1.38, -0.18);
    const wsLen = wsBase.distanceTo(wsTop), wsAng = Math.atan2(wsTop.z - wsBase.z, wsTop.y - wsBase.y);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.32, wsLen), S.glassClear); glass.position.copy(wsBase).add(wsTop).multiplyScalar(0.5); glass.rotation.x = wsAng; this.body.add(glass); this.windscreen = glass;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.045, wsLen + 0.04, 0.06), frameMat); p.position.set(sx * 0.68, (wsBase.y + wsTop.y) / 2, (wsBase.z + wsTop.z) / 2); p.rotation.x = wsAng; p.rotation.z = sx * 0.06; this.body.add(p); }
    add(new RoundedBoxGeometry(1.4, 0.045, 0.06, 2, 0.015), frameMat, 0, 1.385, -0.19, wsAng);
    // roll hoops, folded roof, seats
    const leather = new THREE.MeshStandardMaterial({ color: '#c79a6c', roughness: 0.5 });
    for (const sx of [-1, 1]) {
      add(new RoundedBoxGeometry(0.52, 0.16, 0.52, 3, 0.06), leather, sx * 0.36, 0.5, 0.04);
      add(new RoundedBoxGeometry(0.5, 0.62, 0.14, 3, 0.06), leather, sx * 0.36, 0.85, 0.33, 0.18);
      add(new RoundedBoxGeometry(0.28, 0.17, 0.1, 3, 0.04), leather, sx * 0.36, 1.26, 0.41, 0.12);
      add(new THREE.TorusGeometry(0.16, 0.022, 8, 18, Math.PI), S.chrome, sx * 0.33, 1.2, 1.12);
    }
    add(new RoundedBoxGeometry(1.2, 0.5, 0.14, 3, 0.06), leather, 0, 0.86, 1.02, 0.22);
    add(new RoundedBoxGeometry(1.44, 0.17, 0.46, 3, 0.07), new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9 }), 0, 1.04, 1.42);
    // lights, grille, bumpers, mirrors
    for (const sx of [-1, 1]) {
      const hl = new THREE.Group(); hl.position.set(sx * 0.5, 0.74, -1.8); hl.rotation.set(-0.2, sx * 0.3, 0); this.body.add(hl);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.14, 24).rotateX(Math.PI / 2), solid); c.position.z = 0.07; hl.add(c);
      hl.add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 24), S.chrome));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), S.head); lens.rotation.y = Math.PI; lens.position.z = -0.01; hl.add(lens);
      const tl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).rotateX(Math.PI / 2), this.tail); tl.position.set(sx * 0.6, 0.82, 1.79); tl.scale.set(1.1, 1.45, 1); this.body.add(tl);
      add(new THREE.BoxGeometry(0.03, 0.05, 0.08), S.black, sx * 0.8, 1.0, -0.56);
      const mc = add(new THREE.SphereGeometry(0.5, 14, 10), solid, sx * 0.9, 1.04, -0.52); mc.scale.set(0.16, 0.09, 0.09);
      this['mirror' + (sx > 0 ? 'R' : 'L')] = add(new THREE.PlaneGeometry(0.13, 0.065), new THREE.MeshStandardMaterial({ color: '#cfe3ef', metalness: 1, roughness: 0.05 }), sx * 0.9, 1.04, -0.472);
    }
    const hex = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 6); hex.rotateX(Math.PI / 2);
    const gr = add(hex, S.black, 0, 0.58, -1.86, 0.25); gr.scale.set(0.9, 0.42, 1);
    const grc = add(hex, S.chrome, 0, 0.58, -1.845, 0.25); grc.scale.set(0.96, 0.47, 0.6);
    add(new RoundedBoxGeometry(1.4, 0.16, 0.18, 2, 0.05), S.black, 0, 0.3, -1.8);
    add(new RoundedBoxGeometry(1.5, 0.2, 0.2, 2, 0.06), S.black, 0, 0.33, 1.78);
    add(new THREE.PlaneGeometry(0.52, 0.11), S.plate, 0, 0.3, -1.9, 0, Math.PI, 0);
    add(new THREE.PlaneGeometry(0.52, 0.11), S.plate, 0, 0.53, 1.912, -0.05);
    for (const sx of [-0.12, 0.12]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12).rotateX(Math.PI / 2), S.chrome, sx, 0.27, 1.88);
    this.dims = { L: 3.82, W: 1.72, H: 1.4 };
    this.seat = new THREE.Vector3(-0.36, 1.13, 0.27); // driver's eye (local)
    this.dash = { y: 0.98, z: -0.48, w: 1.36, wheelZ: -0.28, wheelY: 0.97, wheelR: 0.18, x: -0.36 };
    this.exhaust = [new THREE.Vector3(-0.12, 0.27, 1.95), new THREE.Vector3(0.12, 0.27, 1.95)];
  }
  buildGeneric() {
    const S = shared();
    const sh = SHAPES[this.spec.body];
    this.shape = sh;
    const geo = buildBodyGeo(sh);
    const mesh = new THREE.Mesh(geo, [this.paint, S.glassDark, S.black]);
    this.body.add(mesh); this.bodyMesh = mesh;
    const r = this.spec.wheelR;
    addWheels(this, sh, r, sh.W * 0.13, this.spec.id === 'kastro' ? 6 : 5, this.spec.id === 'poseidon');
    const L2 = sh.L / 2;
    const add = (geo2, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo2, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); this.body.add(m); return m; };
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(sh.W * 0.2, 0.08, 0.06), S.head, sx * sh.W * 0.34, sh.nose - 0.06, -L2 + 0.06, -0.3);
      add(new THREE.BoxGeometry(sh.W * 0.22, 0.07, 0.05), this.tail, sx * sh.W * 0.33, (sh.fastback ? sh.belt : sh.tail) - 0.08, L2 - 0.03);
      add(new THREE.BoxGeometry(0.05, 0.1, 0.16), S.black, sx * sh.W * 0.5, sh.belt + 0.08, -sh.L * 0.12);
      this['mirror' + (sx > 0 ? 'R' : 'L')] = add(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshStandardMaterial({ color: '#cfe3ef', metalness: 1, roughness: 0.05 }), sx * sh.W * 0.53, sh.belt + 0.1, -sh.L * 0.12 + 0.081);
    }
    add(new THREE.BoxGeometry(sh.W * 0.92, 0.18, 0.16), S.black, 0, sh.bottom + 0.12, -L2 + 0.04);
    add(new THREE.BoxGeometry(sh.W * 0.92, 0.2, 0.14), S.black, 0, sh.bottom + 0.14, L2 - 0.04);
    add(new THREE.PlaneGeometry(0.52, 0.11), S.plate, 0, sh.bottom + 0.22, -L2 - 0.03, 0, Math.PI, 0);
    add(new THREE.PlaneGeometry(0.52, 0.11), S.plate, 0, sh.bottom + 0.3, L2 + 0.03);
    if (this.spec.id === 'riviera' || this.spec.id === 'poseidon') {
      // rear wing
      add(new THREE.BoxGeometry(sh.W * 0.9, 0.04, 0.32), S.black, 0, sh.belt + 0.32, L2 - 0.3, 0.08);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.3, 0.16), S.black, sx * 0.5, sh.belt + 0.17, L2 - 0.3);
    }
    if (this.spec.id === 'kastro') {
      // rally stripes + roof vent + mud flaps
      add(new THREE.BoxGeometry(0.34, 0.012, sh.L * 0.62), new THREE.MeshStandardMaterial({ color: this.spec.accent, roughness: 0.4 }), 0, sh.H + 0.012, -0.2);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.28, 0.24, 0.02), new THREE.MeshStandardMaterial({ color: '#d32f2f', roughness: 0.8 }), sx * 0.7, 0.2, sh.wb / 2 - 0.5);
    }
    if (this.spec.taxi) addTaxiSign(this.body, sh);
    this.dims = { L: sh.L, W: sh.W, H: sh.H };
    this.seat = new THREE.Vector3(-sh.W * 0.21, sh.belt + (sh.H - sh.belt) * 0.62, -sh.L * 0.02 + (this.spec.body === 'wedge' ? 0.2 : 0));
    this.dash = { y: sh.belt + 0.06, z: -sh.L * 0.13, w: sh.W * 0.9, wheelZ: -sh.L * 0.13 + 0.32, wheelY: sh.belt + 0.04, wheelR: 0.18, x: -sh.W * 0.21 };
    this.exhaust = [new THREE.Vector3(-0.35, sh.bottom + 0.1, L2 + 0.05), new THREE.Vector3(0.35, sh.bottom + 0.1, L2 + 0.05)];
    this.windscreen = null;
  }
  update(dt, speed, steer, brake, pose) {
    this.wheelSpin -= speed / (this.wheels[0]?.r || 0.32) * dt;
    for (const w of this.wheels) { w.spin.rotation.x = this.wheelSpin; w.pivot.rotation.y = w.front ? steer : 0; }
    this.tail.emissiveIntensity = brake ? 7 : 1.2;
    if (pose) { this.body.position.y = pose.heave; this.body.rotation.set(pose.pitch, 0, pose.roll, 'YXZ'); }
  }
}
function addTaxiSign(parent, sh) {
  const tex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#f7f3e6'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = '800 46px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', w / 2, h / 2 + 2); });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.22), [new THREE.MeshStandardMaterial({ color: '#f7f3e6' }), new THREE.MeshStandardMaterial({ color: '#f7f3e6' }), new THREE.MeshStandardMaterial({ color: '#f7f3e6' }), new THREE.MeshStandardMaterial({ color: '#f7f3e6' }), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4 }), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4 })]);
  m.rotation.y = Math.PI / 2; m.position.set(0, sh.H + 0.1, -0.15); parent.add(m);
}
let BLOB = null;
function blobMaterial() {
  if (BLOB) return BLOB;
  const t = canvasTex(64, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, h / 2); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { srgb: false });
  BLOB = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  return BLOB;
}

// ------------------------------------------------------------------ traffic models (shared geometry per type)
export const TRAFFIC_TYPES = [
  // w = share of the mix; colours lean on what you actually see in Athens: white, silver, grey, black, a few blues and reds
  { id: 'city', w: 16, shape: 'hatch', scale: 0.88, len: 3.65, wid: 1.6, colors: ['#f2f2f0', '#c9ccd1', '#b8282a', '#e9e2c9', '#2f6db0', '#9fb3a0', '#f4b9c0', '#7d8288'] },
  { id: 'hatch', w: 26, shape: 'hatch', len: 4.15, wid: 1.82, colors: ['#f2f2f0', '#c9ccd1', '#1d1f24', '#2e4c6a', '#8fa3b8', '#a33a2c', '#e8d9a8', '#3f5e4a', '#7d8288', '#5d6b78'] },
  { id: 'sedan', w: 15, shape: 'sedan', len: 4.75, wid: 1.8, colors: ['#f2f2f0', '#26292e', '#7d8288', '#c9ccd1', '#41505e', '#6b1f24'] },
  { id: 'taxi', w: 13, shape: 'sedan', len: 4.75, wid: 1.8, colors: ['#f2c418'], taxi: true },
  { id: 'suv', w: 13, shape: 'suv', len: 4.6, wid: 1.9, colors: ['#f2f2f0', '#1d1f24', '#7d8288', '#5b2a2a', '#c9ccd1', '#2c3b4d', '#8a7a5c'] },
  { id: 'van', w: 6, shape: 'van', len: 5.0, wid: 2.0, colors: ['#f4f4f2', '#f4f4f2', '#d8d4c8', '#c9ccd1'] },
  { id: 'bus', w: 3, shape: 'bus', len: 12, wid: 2.5, colors: ['#f4f4f2'], bus: true },
  { id: 'delivery', w: 11, scooter: true, box: true, len: 1.9, wid: 0.7, colors: ['#f2f2f0', '#c3121c', '#1d1f24', '#2a6fb8', '#e8c33a'] },
  { id: 'scooter', w: 6, scooter: true, len: 1.9, wid: 0.7, colors: ['#f2f2f0', '#c3121c', '#1d1f24', '#2a6fb8', '#9ad0c2', '#f0a0b0'] },
  { id: 'moto', w: 3, scooter: true, moto: true, len: 2.1, wid: 0.8, colors: ['#1d1f24', '#c3121c', '#f2f2f0', '#e86a10'] },
];
const TRAFFIC_GEO = {};
export function trafficModel(type, color, rng) {
  const S = shared();
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const paint = paintMaterial(color, type.taxi || type.bus ? 0.1 : 0.4);
  const tail = tailMaterial();
  const wheels = [];
  if (type.scooter) {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.5, 1.4, 2, 0.15), paint); frame.position.set(0, 0.62, 0.1); body.add(frame);
    const shield = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.8, 0.12, 2, 0.05), paint); shield.position.set(0, 0.85, -0.55); shield.rotation.x = -0.2; body.add(shield);
    for (const z of [-0.65, 0.62]) { const w = new THREE.Mesh(S.tireGeo, S.tire); w.scale.set(0.11, 0.24, 0.24); w.position.set(0, 0.24, z); body.add(w); wheels.push({ spin: w, pivot: w, front: z < 0, r: 0.24 }); }
    // rider (helmet), often with a food-delivery box
    const shirt = new THREE.MeshStandardMaterial({ color: rng.pick(['#2c3e50', '#c0392b', '#ecf0f1', '#27ae60', '#f39c12']), roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), shirt); torso.position.set(0, 1.25, 0.15); torso.rotation.x = -0.2; body.add(torso);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: rng.pick(['#111', '#f2f2f2', '#c3121c', '#1e5aa8']), roughness: 0.3, metalness: 0.2 })); helmet.position.set(0, 1.72, 0.05); body.add(helmet);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 6), new THREE.MeshStandardMaterial({ color: '#2b2d42' })); leg.position.set(sx * 0.17, 0.85, -0.05); leg.rotation.x = 1.2; body.add(leg); }
    if (type.box) { const box = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.45, 0.45, 2, 0.05), new THREE.MeshStandardMaterial({ color: rng.pick(['#e4002b', '#e4002b', '#00a8e8', '#ff8000', '#ffcc00']), roughness: 0.5 })); box.position.set(0, 1.1, 0.75); body.add(box); }
    if (type.moto) { frame.scale.set(0.8, 0.8, 1.15); shield.visible = false; }
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), S.head); hl.position.set(0, 1.05, -0.62); hl.rotation.y = Math.PI; body.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.03), tail); tl.position.set(0, 0.8, 0.82); body.add(tl);
  } else {
    const sh = SHAPES[type.shape];
    if (!TRAFFIC_GEO[type.shape]) TRAFFIC_GEO[type.shape] = buildBodyGeo(sh);
    const mesh = new THREE.Mesh(TRAFFIC_GEO[type.shape], [paint, S.glassDark, S.black]); body.add(mesh);
    const car = { root, wheels: [] };
    addWheels(car, sh, type.bus ? 0.5 : type.shape === 'suv' || type.shape === 'van' ? 0.36 : 0.31, sh.W * (type.bus ? 0.14 : 0.12), 0);
    mesh.userData.mainBody = true;
    wheels.push(...car.wheels);
    const L2 = sh.L / 2;
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(sh.W * 0.18, 0.08, 0.05), S.head); h.position.set(sx * sh.W * 0.33, sh.nose - 0.08, -L2 + 0.05); body.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(sh.W * 0.2, 0.08, 0.05), tail); t.position.set(sx * sh.W * 0.34, (sh.fastback ? sh.belt : sh.tail) - 0.1, L2); body.add(t);
    }
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), S.plate); pl.position.set(0, sh.bottom + 0.3, L2 + 0.03); body.add(pl);
    if (type.taxi) addTaxiSign(body, sh);
    if (sh.flatEnds) { // rear window(s) on the flat back panel
      const rw = new THREE.Mesh(new THREE.PlaneGeometry(sh.W * (type.bus ? 0.78 : 0.34), type.bus ? 0.95 : 0.55), S.glassDark);
      if (type.bus) { rw.position.set(0, sh.H - 0.75, L2 + 0.02); body.add(rw); }
      else for (const sx of [-1, 1]) { const w = rw.clone(); w.position.set(sx * sh.W * 0.2, sh.H - 0.62, L2 + 0.02); body.add(w); }
    }
    if (type.bus) {
      const blue = new THREE.MeshStandardMaterial({ color: '#1f5fae', roughness: 0.45 });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(sh.W + 0.02, 0.8, sh.L * 0.985), blue); stripe.position.y = 0.78; body.add(stripe);
      const band = new THREE.Mesh(new THREE.BoxGeometry(sh.W + 0.03, 0.12, sh.L * 0.95), blue); band.position.y = sh.H - 0.08; body.add(band);
      const dest = labelMesh(rng.pick(['A2 · VOULIAGMENI', '122 · SARONIDA', '149 · VARKIZA', 'E22 · SARONIDA']), 2.0, 0.28); dest.position.set(0, sh.H - 0.25, -L2 - 0.02); dest.rotation.y = Math.PI; body.add(dest);
    }
    if (type.id === 'van') { const lab = labelMesh(rng.pick(['ATHENS BAKERY', 'RIVIERA FLOWERS', 'FRESH FISH · VARI', 'COURIER EXPRESS']), 3.0, 0.42, '#f4f4f2', '#1d3557'); for (const sx of [-1, 1]) { const l = lab.clone(); l.position.set(sx * (sh.W / 2 + 0.02), 1.5, 0.3); l.rotation.y = sx * Math.PI / 2; body.add(l); } }
  }
  if (type.scale) body.scale.setScalar(type.scale);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = !!o.userData.mainBody || !!type.scooter; o.receiveShadow = true; } });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(type.wid * 1.25, type.len * 1.12), blobMaterial()); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.castShadow = false; root.add(blob);
  return { root, body, wheels, tail, paint };
}
function labelMesh(text, w, h, bg = '#101418', fg = '#ffb000') {
  const t = canvasTex(512, Math.round(512 * h / w), (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.font = `800 ${Math.round(H * 0.72)}px "Barlow Condensed", Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + 2); });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.25 }));
}

// ------------------------------------------------------------------ the driver: big curly hair with spring physics
export class Driver {
  constructor({ hair = true, shirt = '#f6f4ee', skin = '#c98b62', helmet = false } = {}) {
    const root = this.root = new THREE.Group();
    const skinM = trimMat(skin, { rough: 0.5, scale: 0.025, nk: 0.22, sheen: 0.18 });
    const shirtM = trimMat(shirt, { rough: 0.92, scale: 0.018, nk: 0.55, sheen: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: '#e0b04a', metalness: 1, roughness: 0.25 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
    this.torso = add(new THREE.CapsuleGeometry(0.17, 0.32, 6, 14), shirtM, 0, -0.28, 0.06, -0.18, 0, 0, 1.12, 1, 0.8);
    add(new THREE.TorusGeometry(0.06, 0.005, 6, 20), gold, 0, -0.07, -0.06, 1.25, 0, 0);
    const neck = this.neck = new THREE.Group(); neck.position.set(0, 0, 0); root.add(neck);
    add(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 12), skinM, 0, 0.03, 0, 0, 0, 0, 1, 1, 1, neck);
    const head = this.head = new THREE.Group(); head.position.set(0, 0.17, 0); neck.add(head);
    add(new THREE.SphereGeometry(0.115, 24, 18), skinM, 0, 0, 0, 0, 0, 0, 0.95, 1.12, 1.0, head);
    add(new THREE.ConeGeometry(0.022, 0.06, 8), skinM, 0, -0.01, -0.12, -Math.PI / 2 + 0.3, 0, 0, 1, 1, 1, head);
    add(new THREE.BoxGeometry(0.07, 0.016, 0.02), dark, 0, -0.045, -0.108, 0, 0, 0, 1, 1, 1, head);
    for (const sx of [-1, 1]) {
      add(new THREE.SphereGeometry(0.034, 14, 10), new THREE.MeshStandardMaterial({ color: '#1a1410', metalness: 0.6, roughness: 0.05 }), sx * 0.045, 0.025, -0.105, 0, 0, 0, 1.1, 0.9, 0.35, head);
      add(new THREE.TorusGeometry(0.034, 0.004, 6, 16), gold, sx * 0.045, 0.025, -0.108, 0, 0, 0, 1.1, 0.9, 1, head);
    }
    // arms (beams updated each frame to reach the wheel)
    const armGeo = new THREE.CapsuleGeometry(0.5, 1, 4, 10);
    this.arms = [];
    // driving gloves (perforated leather) closed around the rim; linen sleeves rolled to the forearm
    const glove = trimMat('#2b1d14', { rough: 0.55, scale: 0.04, nk: 0.9 });
    const fistGeo = new THREE.SphereGeometry(0.05, 16, 12); fistGeo.scale(0.82, 0.7, 1.15);
    const thumbGeo = new THREE.CapsuleGeometry(0.014, 0.04, 4, 8); thumbGeo.rotateX(Math.PI / 2); thumbGeo.translate(0.03, 0.022, -0.01);
    for (const sx of [-1, 1]) {
      const up = new THREE.Mesh(armGeo, shirtM), fo = new THREE.Mesh(armGeo, skinM);
      const hand = new THREE.Group(); hand.add(new THREE.Mesh(fistGeo, glove)); const th = new THREE.Mesh(thumbGeo, glove); th.scale.x = sx; hand.add(th);
      root.add(up, fo, hand); this.arms.push({ sx, up, fo, hand });
    }
    if (helmet) {
      add(new THREE.SphereGeometry(0.17, 18, 14), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.25, metalness: 0.3 }), 0, 0.02, 0.01, 0, 0, 0, 1, 1, 1, head);
      this.curls = []; return;
    }
    // hair
    const hairCol = new THREE.Color('#5a3219');
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.2, 22, 16), new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.7 }));
    base.scale.set(1.08, 0.95, 0.95); base.position.set(0, 0.13, 0.13); base.castShadow = true; head.add(base); this.hairBase = base;
    const curlGeo = new THREE.TorusKnotGeometry(0.5, 0.24, 20, 4, 2, 3);
    const curlMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, sheen: 1.0, sheenColor: new THREE.Color('#c08a5a'), sheenRoughness: 0.4 });
    const rng = new RNG(1234);
    const curls = [];
    const center = new THREE.Vector3(0, 0.08, 0.035), radii = new THREE.Vector3(0.27, 0.25, 0.27);
    for (let tries = 0; curls.length < 380 && tries < 5000; tries++) {
      const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      if (dir.lengthSq() > 1 || dir.lengthSq() < 0.05) continue;
      dir.normalize();
      if (dir.z < -0.25 && dir.y < 0.35) continue;
      if (dir.y < -0.45 && dir.z < 0.5) continue;
      if (dir.y < -0.75) continue;
      const layer = rng.next(); const r = 0.82 + layer * 0.32;
      curls.push({ rest: new THREE.Vector3(dir.x * radii.x * r, dir.y * radii.y * r, dir.z * radii.z * r).add(center), off: new THREE.Vector3(), vel: new THREE.Vector3(), dir,
        w: (0.35 + layer * 0.9) * (0.7 + 0.3 * Math.max(0, dir.y + 0.3)), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6))),
        s: rng.range(0.052, 0.08) * (0.85 + layer * 0.35), ph: rng.range(0, 6.28), f: rng.range(9, 16) });
    }
    const inst = new THREE.InstancedMesh(curlGeo, curlMat, curls.length); inst.castShadow = true;
    const cc = new THREE.Color();
    curls.forEach((c, i) => { cc.copy(hairCol).multiplyScalar(rng.range(0.7, 1.5)); inst.setColorAt(i, cc); });
    inst.instanceColor.needsUpdate = true; head.add(inst);
    this.curls = curls; this.curlMesh = inst;
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.hw = { x: 0, vx: 0, z: 0, vz: 0 };
  }
  impulse(strength, dx = 0, dz = 0) {
    for (const c of this.curls) { c.vel.x += (Math.random() - 0.5) * strength * 2 + dx * strength * 2; c.vel.y += Math.random() * strength * 2.5; c.vel.z += (Math.random() - 0.5) * strength * 2 + dz * strength * 2; }
    if (this.hw) { this.hw.vx += (Math.random() - 0.3) * strength * 30; this.hw.vz += dx * strength * 30; }
  }
  /** wheel: {pos: Vector3 (in driver-parent space), angle, euler}; acc: local acceleration */
  update(dt, t, speed, acc, wheel, steer, heaveV = 0) {
    // arms to the wheel rim
    if (wheel) {
      for (const a of this.arms) {
        const shoulder = new THREE.Vector3(a.sx * 0.19, -0.1, 0.05);
        const ang = (a.sx > 0 ? 0.25 : Math.PI - 0.25) + wheel.angle;
        const hand = new THREE.Vector3(Math.cos(ang) * wheel.r, Math.sin(ang) * wheel.r, 0).applyEuler(wheel.euler).add(wheel.pos).sub(this.root.position);
        const elbow = shoulder.clone().lerp(hand, 0.5).add(new THREE.Vector3(a.sx * 0.1, -0.12, 0.05));
        beam(a.up, shoulder, elbow, 0.105); beam(a.fo, elbow, hand, 0.08); a.hand.position.copy(hand);
        // fist wraps the rim: long axis along the rim tangent, knuckles facing out
        const tan = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0).applyEuler(wheel.euler);
        const out = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0).applyEuler(wheel.euler);
        const zz = tan.normalize(), xx = out.normalize(), yy = new THREE.Vector3().crossVectors(zz, xx);
        a.hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz));
      }
    }
    if (!this.curls.length) return;
    const hw = this.hw;
    hw.vx += (-hw.x * 90 - hw.vx * 7 + acc.z * 0.012) * dt;
    hw.vz += (-hw.z * 90 - hw.vz * 7 - acc.x * 0.012) * dt;
    hw.x = clamp(hw.x + hw.vx * dt, -0.5, 0.5); hw.z = clamp(hw.z + hw.vz * dt, -0.5, 0.5);
    this.neck.rotation.x = hw.x * 0.6; this.neck.rotation.z = hw.z * 0.6;
    this.head.rotation.y = Math.sin(t * 0.5) * 0.1 - steer * 0.5;
    const v = Math.abs(speed);
    const windF = Math.min(1.8, v * v * 0.0009), flut = Math.min(1.4, v * 0.018);
    const h = dt / 2;
    for (let k = 0; k < 2; k++) for (const c of this.curls) {
      const w = c.w;
      const fx = -acc.x * 0.0025 * w + Math.sin(t * c.f + c.ph) * 0.06 * flut * w;
      const fy = -acc.y * 0.002 * w - heaveV * 0.6 * w + Math.sin(t * c.f * 1.3 + c.ph) * 0.05 * flut * w + windF * 0.03 * w * Math.max(0, c.dir.z);
      const fz = -acc.z * 0.0025 * w + windF * 0.12 * w * (0.4 + Math.max(0, c.dir.y)) + Math.cos(t * c.f * 0.8 + c.ph) * 0.05 * flut * w;
      c.vel.x += (-c.off.x * 160 - c.vel.x * 6 + fx * 60) * h; c.vel.y += (-c.off.y * 160 - c.vel.y * 6 + fy * 60) * h; c.vel.z += (-c.off.z * 160 - c.vel.z * 6 + fz * 60) * h;
      c.off.addScaledVector(c.vel, h);
      const L = c.off.length(); if (L > 0.09) c.off.multiplyScalar(0.09 / L);
    }
    let ax = 0, ay = 0, az = 0;
    this.curls.forEach((c, i) => { this._v.copy(c.rest).add(c.off); ax += c.off.x; ay += c.off.y; az += c.off.z; this._s.setScalar(c.s); this._m.compose(this._v, c.rot, this._s); this.curlMesh.setMatrixAt(i, this._m); });
    const n = this.curls.length;
    this.hairBase.position.set(ax / n * 0.6, 0.13 + ay / n * 0.6, 0.13 + az / n * 0.6);
    this.curlMesh.instanceMatrix.needsUpdate = true;
  }
}
const _up = new THREE.Vector3(0, 1, 0);
function beam(mesh, a, b, thick) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, d.normalize());
  mesh.scale.set(thick, len * 0.5, thick);
}
