// Car catalogue + procedural car models (lofted bodies), traffic vehicles, the curly-haired driver.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, smoothstep, RNG, canvasTex, damp } from './util.js';
import { trimMat } from './cockpit.js';
import { buildDetailedCar, animateDetailedCar, makePlateMaterial, trafficDetailedModel } from './vehicle-models.js';
import { policeModel } from './police-models.js';
import { savedPaint, setPaint } from './vehicle-paint.js';
export { setPaint } from './vehicle-paint.js';

// ------------------------------------------------------------------ catalogue (player-selectable)
export const CARS = [
  {
    id: 'mini', name: 'MINI COOPER S CABRIO', short: 'MINI', tag: 'Open skies. Short wheelbase. Front-wheel drive.', color: '#bd1626', accent: '#f1efe7',
    mass: 1320, power: 141, torque: 280, redline: 6800, idle: 850, gears: [3.92, 2.43, 1.43, 1.0, 0.81, 0.67], final: 3.59, wheelR: 0.316,
    wheelbase: 2.495, length: 3.85, width: 1.727, cdA: 0.68, vmax: 230, grip: 1.08, steer: 0.6, yawI: 1.0, drift: 1.0, brake: 1.0, cyl: 4, pitch: 1.0, convertible: true, body: 'mini', drive: 'fwd',
    frontW: 0.61, hcg: 0.50, track: 1.485, rsF: 0.59, susHz: 1.85, susZ: 0.55, rollK: 1.0, pitchK: 1.0, alphaPk: 0.115, mfC: 1.45, loadSens: 0.16, clA: 0.02, tc: 0.65, esc: 0.45, shiftT: 0.22, bias: 0.74, steerRate: 1.15, ebrake: 0.16, engine: 'turbo4', turbo: 1,
    stats: { speed: 0.58, accel: 0.56, handling: 0.88, drift: 0.38 },
  },
  {
    id: 'z4', name: 'BMW Z4 M40i', short: 'Z4 M40i', tag: 'Straight-six roadster. Rear-wheel drive.', color: '#22679d', accent: '#b7bdc5',
    mass: 1610, power: 250, torque: 500, redline: 7000, idle: 750, gears: [5.25, 3.36, 2.17, 1.72, 1.32, 1.0, 0.82, 0.64], final: 3.154, wheelR: 0.335,
    wheelbase: 2.47, length: 4.324, width: 1.864, cdA: 0.64, vmax: 250, grip: 1.18, steer: 0.57, yawI: 1.06, drift: 1.0, brake: 1.12, cyl: 6, pitch: 0.94, convertible: true, body: 'z4', drive: 'rwd',
    frontW: 0.50, hcg: 0.46, track: 1.60, rsF: 0.53, susHz: 2.1, susZ: 0.6, rollK: 0.7, pitchK: 0.7, alphaPk: 0.105, mfC: 1.5, loadSens: 0.14, clA: 0.05, tc: 0.45, esc: 0.3, shiftT: 0.15, bias: 0.64, steerRate: 1.15, ebrake: 0.14, engine: 'turbo6', turbo: 1.15, lsd: 0.45,
    stats: { speed: 0.82, accel: 0.93, handling: 0.94, drift: 0.91 },
  },
  {
    id: 'taxi', name: 'ŠKODA OCTAVIA TAXI', short: 'OCTAVIA', tag: 'Athens yellow. 2.0 TDI. Front-wheel drive.', color: '#eebd19', accent: '#c7cbd0',
    mass: 1460, power: 110, torque: 360, redline: 5000, idle: 800, gears: [14.91, 8.59, 5.24, 3.70, 2.82, 2.26, 1.75], final: 1, wheelR: 0.323,
    wheelbase: 2.686, length: 4.689, width: 1.829, cdA: 0.57, vmax: 227, grip: 1.0, steer: 0.58, yawI: 1.15, drift: 0.8, brake: 1.0, cyl: 4, pitch: 0.72, body: 'octavia', taxi: true, drive: 'fwd',
    frontW: 0.60, hcg: 0.53, track: 1.54, rsF: 0.6, susHz: 1.55, susZ: 0.5, rollK: 1.3, pitchK: 1.3, alphaPk: 0.125, mfC: 1.42, loadSens: 0.18, clA: 0, tc: 0.8, esc: 0.65, shiftT: 0.28, bias: 0.72, steerRate: 0.95, ebrake: 0.18, engine: 'diesel', turbo: 0.8,
    stats: { speed: 0.5, accel: 0.42, handling: 0.64, drift: 0.25 },
  },
  {
    id: 'carrera', name: 'PORSCHE 911 CARRERA', short: '911 CARRERA', tag: '991.1 · Rear-engine flat-six. Seven-speed manual.', color: '#c6c9cb', accent: '#a7acb2',
    mass: 1380, power: 257, torque: 390, redline: 7800, idle: 800, gears: [3.91, 2.29, 1.55, 1.30, 1.08, 0.88, 0.71], final: 3.44, wheelR: 0.331,
    torqueCurve: [[0,170],[800,190],[2000,270],[3500,340],[4500,370],[5600,390],[6500,370],[7400,331.65],[7800,302],[8500,260]], peakTorqueRpm: 5600, peakPowerRpm: 7400,
    wheelbase: 2.45, length: 4.491, width: 1.808, cdA: 0.58, vmax: 289, grip: 1.14, steer: 0.55, yawI: 1.1, drift: 1, brake: 1.08, cyl: 6, pitch: 1, body: 'carrera', drive: 'rwd', engine: 'flat6', engineZone: 'rear', transmission: 'manual',
    tyres: ['235/40 ZR19','285/30 ZR19'], frontW: 0.39, hcg: 0.45, track: 1.525, rsF: 0.48, susHz: 2.0, susZ: 0.56, rollK: 0.8, pitchK: 0.8, alphaPk: 0.11, mfC: 1.47, loadSens: 0.15, clA: 0.02, tc: 0.5, esc: 0.4, shiftT: 0.27, bias: 0.60, steerRate: 1.08, ebrake: 0.15, lsd: 0,
    stats: { speed: 0.96, accel: 0.91, handling: 0.94, drift: 0.78 },
  },
  {
    id: 'gr_yaris', name: 'TOYOTA GR YARIS', short: 'GR YARIS', tag: 'GR-FOUR · Rally-bred AWD. Turbocharged triple.', color: '#e7e8e3', accent: '#be1c27',
    mass: 1280, power: 206, torque: 390, redline: 7200, idle: 850, gears: [13.943258, 8.820958, 6.050435, 4.580642, 3.62135, 3.0217], final: 1, wheelR: 0.319,
    torqueCurve: [[0,130],[850,155],[1800,220],[2500,305],[3250,390],[4600,390],[5500,350],[6500,302.64],[7200,260],[7900,210]], peakTorqueRpm: 4000, peakPowerRpm: 6500,
    wheelbase: 2.56, length: 3.995, width: 1.805, cdA: 0.70, vmax: 230, grip: 1.14, steer: 0.59, yawI: 0.95, drift: 1, brake: 1.08, cyl: 3, pitch: 1, body: 'gr_yaris', drive: 'awd', awdRear: 0.47, engine: 'turbo3', turbo: 1, transmission: 'manual',
    tyres: ['225/40 ZR18','225/40 ZR18'], frontW: 0.60, hcg: 0.49, track: 1.554, rsF: 0.59, susHz: 2.05, susZ: 0.58, rollK: 0.8, pitchK: 0.85, alphaPk: 0.115, mfC: 1.45, loadSens: 0.15, clA: 0.01, tc: 0.5, esc: 0.4, shiftT: 0.27, bias: 0.72, steerRate: 1.2, ebrake: 0.16, lsd: 0.35,
    stats: { speed: 0.59, accel: 0.84, handling: 0.93, drift: 0.63 },
  },
  {
    id: 'gtv', name: 'ALFA ROMEO 2000 GTV', short: '2000 GTV', tag: 'Bertone classic · Twin-cam four. Rear-wheel drive.', color: '#b52125', accent: '#bf9160',
    mass: 1040, power: 97, torque: 182, redline: 6500, idle: 850, gears: [3.304, 1.988, 1.355, 1, 0.791], final: 4.10, wheelR: 0.313,
    torqueCurve: [[0,72],[850,86],[1800,130],[3000,165],[4000,180],[4200,182],[5000,177],[5500,168.42],[6000,150],[6500,125],[7100,100]], peakTorqueRpm: 4200, peakPowerRpm: 5500,
    wheelbase: 2.35, length: 4.10, width: 1.58, cdA: 0.70, vmax: 195, grip: 0.91, steer: 0.62, yawI: 1.02, drift: 1, brake: 0.96, cyl: 4, pitch: 1, body: 'gtv', drive: 'rwd', engine: 'na4', transmission: 'manual',
    tyres: ['165 HR14','165 HR14'], frontW: 0.54, hcg: 0.48, track: 1.30, rsF: 0.54, susHz: 1.65, susZ: 0.49, rollK: 1.15, pitchK: 1.15, alphaPk: 0.14, mfC: 1.4, loadSens: 0.16, clA: 0, tc: 0, esc: 0, edl: 0, shiftT: 0.38, bias: 0.66, steerRate: 0.98, ebrake: 0.14, lsd: 0.25,
    stats: { speed: 0.39, accel: 0.45, handling: 0.69, drift: 0.67 },
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
    this.paint = paintMaterial(savedPaint(spec), spec.id === 'gtv' ? 0.15 : 0.45);
    this.tail = tailMaterial();
    buildDetailedCar(this, spec.body, { plate: opts.plate || ({mini:'ΙΚΑ 1920',z4:'ΙΒΜ 4040',taxi:'ΤΑΑ 2150',carrera:'ΙΡΑ 0911',gr_yaris:'ΙΤΥ 0400',gtv:'ΙΡΟ 2000'}[spec.id]) });
    setPaint(this, savedPaint(spec));
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.wheelSpin = 0;
    // contact shadow
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(this.dims.W * 1.25, this.dims.L * 1.15), blobMaterial());
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.renderOrder = 1; blob.castShadow = false; this.root.add(blob);
  }
  update(dt, speed, steer, brake, pose, axles = null, yawRate = 0) {
    animateDetailedCar(this, dt, speed, steer, brake, pose, axles, yawRate);
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
  { id:'police', police:true, w:0, model:'octavia', shape:'sedan', len:4.689, wid:1.829, colors:['#f0f1ed'] },
  { id:'police_moto', police:true, scooter:true, moto:true, w:0, len:2.20, wid:.92, colors:['#f0f1ed'] },
  // w = share of the mix; colours lean on what you actually see in Athens: white, silver, grey, black, a few blues and reds
  { id: 'city', w: 16, shape: 'hatch', scale: 0.88, len: 3.65, wid: 1.6, colors: ['#f2f2f0', '#c9ccd1', '#b8282a', '#e9e2c9', '#2f6db0', '#9fb3a0', '#f4b9c0', '#7d8288'] },
  { id: 'hatch', w: 26, shape: 'hatch', len: 4.15, wid: 1.82, colors: ['#f2f2f0', '#c9ccd1', '#1d1f24', '#2e4c6a', '#8fa3b8', '#a33a2c', '#e8d9a8', '#3f5e4a', '#7d8288', '#5d6b78'] },
  { id: 'sedan', w: 15, shape: 'sedan', len: 4.75, wid: 1.8, colors: ['#f2f2f0', '#26292e', '#7d8288', '#c9ccd1', '#41505e', '#6b1f24'] },
  { id: 'taxi', w: 10, model: 'octavia', shape: 'sedan', len: 4.689, wid: 1.829, colors: ['#efc31f', '#e3ae12', '#f4cc34'], taxi: true },
  { id: 'taxi_superb', w: 5, model: 'superb', shape: 'sedan', len: 4.869, wid: 1.864, colors: ['#e8b716', '#f5cd32', '#dbab18'], taxi: true },
  { id: 'byd_dolphin', w: 8, model: 'dolphin', shape: 'hatch', len: 4.29, wid: 1.77, colors: ['#81b9b9', '#eae9e3', '#597aab', '#9d9eaa', '#da9584'], electric: true },
  { id: 'byd_atto3', w: 7, model: 'atto3', shape: 'suv', len: 4.455, wid: 1.875, colors: ['#dce0df', '#356c9d', '#666d71', '#a94a49', '#192c39'], electric: true },
  { id: 'suv', w: 13, shape: 'suv', len: 4.6, wid: 1.9, colors: ['#f2f2f0', '#1d1f24', '#7d8288', '#5b2a2a', '#c9ccd1', '#2c3b4d', '#8a7a5c'] },
  { id: 'van', w: 6, shape: 'van', len: 5.0, wid: 2.0, colors: ['#f4f4f2', '#f4f4f2', '#d8d4c8', '#c9ccd1'] },
  { id: 'bus', w: 3, shape: 'bus', len: 12, wid: 2.5, colors: ['#f4f4f2'], bus: true },
  { id: 'delivery', w: 11, scooter: true, box: true, len: 1.9, wid: 0.7, colors: ['#f2f2f0', '#c3121c', '#1d1f24', '#2a6fb8', '#e8c33a'] },
  { id: 'scooter', w: 6, scooter: true, len: 1.9, wid: 0.7, colors: ['#f2f2f0', '#c3121c', '#1d1f24', '#2a6fb8', '#9ad0c2', '#f0a0b0'] },
  { id: 'moto', w: 3, scooter: true, moto: true, len: 2.1, wid: 0.8, colors: ['#1d1f24', '#c3121c', '#f2f2f0', '#e86a10'] },
];
const TRAFFIC_GEO = {};
export function trafficModel(type, color, rng, opts = {}) {
  if (type.police) return policeModel(type, color, rng, opts);
  if (type.model && !opts.parked) return trafficDetailedModel(type, color, rng);
  const plate = makePlateMaterial();
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
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), plate); pl.position.set(0, sh.bottom + 0.3, L2 + 0.03); body.add(pl);
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), plate); fp.position.set(0, sh.bottom + 0.26, -L2 - 0.03); fp.rotation.y = Math.PI; body.add(fp);
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
    this.hairBase.position.set(ax / n * 0.6, (this.hairY ?? 0.13) + ay / n * 0.6, 0.13 + az / n * 0.6);
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
