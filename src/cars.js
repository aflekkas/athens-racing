// Car catalogue + procedural car models (lofted bodies), traffic vehicles, the curly-haired driver.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, smoothstep, RNG, canvasTex, damp } from './util.js';
import { trimMat } from './cockpit.js';
import { buildDetailedCar, animateDetailedCar, makePlateMaterial, trafficDetailedModel } from './vehicle-models.js';
import { fleetModel } from './traffic-fleet.js';
export { Driver } from './driver.js';
import { savedPaint, setPaint } from './vehicle-paint.js';
export { setPaint } from './vehicle-paint.js';

// ------------------------------------------------------------------ catalogue (player-selectable)
export const CARS = [
  {
    id: 'mini', trafficWeight: 2, name: 'MINI COOPER S CABRIO', short: 'MINI', tag: 'Open skies. Short wheelbase. Front-wheel drive.', color: '#bd1626', accent: '#f1efe7',
    mass: 1320, power: 141, torque: 280, redline: 6800, idle: 850, gears: [3.92, 2.43, 1.43, 1.0, 0.81, 0.67], final: 3.59, wheelR: 0.316,
    wheelbase: 2.495, length: 3.85, width: 1.727, cdA: 0.68, vmax: 230, grip: 1.08, steer: 0.6, yawI: 1.0, drift: 1.0, brake: 1.0, cyl: 4, pitch: 1.0, convertible: true, body: 'mini', drive: 'fwd',
    frontW: 0.61, hcg: 0.50, track: 1.485, rsF: 0.59, susHz: 1.85, susZ: 0.55, rollK: 1.0, pitchK: 1.0, alphaPk: 0.115, mfC: 1.45, loadSens: 0.16, clA: 0.02, tc: 0.65, esc: 0.45, shiftT: 0.22, bias: 0.74, steerRate: 1.15, ebrake: 0.16, engine: 'turbo4', turbo: 1,
    stats: { speed: 0.58, accel: 0.56, handling: 0.88, drift: 0.38 },
  },
  {
    id: 'z4', trafficWeight: 0.4, name: 'BMW Z4 M40i', short: 'Z4 M40i', tag: 'Straight-six roadster. Rear-wheel drive.', color: '#22679d', accent: '#b7bdc5',
    mass: 1610, power: 250, torque: 500, redline: 7000, idle: 750, gears: [5.25, 3.36, 2.17, 1.72, 1.32, 1.0, 0.82, 0.64], final: 3.154, wheelR: 0.335,
    wheelbase: 2.47, length: 4.324, width: 1.864, cdA: 0.64, vmax: 250, grip: 1.18, gripRear: 1.05, steer: 0.57, yawI: 1.06, drift: 1.0, brake: 1.12, cyl: 6, pitch: 0.94, convertible: true, body: 'z4', drive: 'rwd',
    frontW: 0.50, hcg: 0.46, track: 1.60, rsF: 0.53, susHz: 1.75, susZ: 0.6, rollK: 0.7, pitchK: 0.7, alphaPk: 0.105, mfC: 1.5, loadSens: 0.14, clA: 0.05, tc: 0.45, esc: 0.3, shiftT: 0.15, bias: 0.64, steerRate: 1.15, ebrake: 0.14, engine: 'turbo6', turbo: 1.15, lsd: 0.45,
    stats: { speed: 0.82, accel: 0.93, handling: 0.94, drift: 0.91 },
  },
  {
    id: 'taxi', trafficWeight: 20, name: 'ŠKODA OCTAVIA TAXI', short: 'OCTAVIA', tag: 'Athens yellow. 2.0 TDI. Front-wheel drive.', color: '#eebd19', accent: '#c7cbd0',
    mass: 1460, power: 110, torque: 360, redline: 5000, idle: 800, gears: [14.91, 8.59, 5.24, 3.70, 2.82, 2.26, 1.75], final: 1, wheelR: 0.323,
    wheelbase: 2.686, length: 4.689, width: 1.829, cdA: 0.57, vmax: 227, grip: 1.02, steer: 0.58, yawI: 1.15, drift: 0.8, brake: 1.0, cyl: 4, pitch: 0.72, body: 'octavia', taxi: true, drive: 'fwd',
    frontW: 0.60, hcg: 0.53, track: 1.54, rsF: 0.57, usGrad: 2.5, rollGrad: 4.8, susHz: 1.55, susZ: 0.5, rollK: 1.3, pitchK: 1.3, alphaPk: 0.125, mfC: 1.42, loadSens: 0.15, clA: 0, tc: 0.8, esc: 0.65, shiftT: 0.28, bias: 0.72, steerRate: 0.95, ebrake: 0.18, engine: 'diesel', turbo: 0.8, driftAngle: 0.46,
    stats: { speed: 0.5, accel: 0.42, handling: 0.64, drift: 0.25 },
  },
  {
    id: 'carrera', trafficWeight: 0.15, name: 'PORSCHE 911 CARRERA', short: '911 CARRERA', tag: '991.1 · Rear-engine flat-six. Seven-speed manual.', color: '#c6c9cb', accent: '#a7acb2',
    mass: 1380, power: 257, torque: 390, redline: 7800, idle: 800, gears: [3.91, 2.29, 1.55, 1.30, 1.08, 0.88, 0.71], final: 3.44, wheelR: 0.331,
    torqueCurve: [[0,170],[800,190],[2000,270],[3500,340],[4500,370],[5600,390],[6500,370],[7400,331.65],[7800,302],[8500,260]], peakTorqueRpm: 5600, peakPowerRpm: 7400,
    wheelbase: 2.45, length: 4.491, width: 1.808, cdA: 0.58, vmax: 289, grip: 1.14, gripRear: 1.08, steer: 0.55, yawI: 1.1, drift: 1, brake: 1.08, cyl: 6, pitch: 1, body: 'carrera', drive: 'rwd', engine: 'flat6', engineZone: 'rear', transmission: 'manual',
    tyres: ['235/40 ZR19','285/30 ZR19'], frontW: 0.39, hcg: 0.45, track: 1.525, rsF: 0.48, susHz: 2.0, susZ: 0.56, rollK: 0.8, pitchK: 0.8, alphaPk: 0.11, mfC: 1.47, loadSens: 0.15, clA: 0.02, tc: 0.5, esc: 0.4, shiftT: 0.27, bias: 0.60, steerRate: 1.08, ebrake: 0.15, lsd: 0,
    stats: { speed: 0.96, accel: 0.91, handling: 0.94, drift: 0.78 },
  },
  {
    id: 'gr_yaris', trafficWeight: 2, name: 'TOYOTA GR YARIS', short: 'GR YARIS', tag: 'GR-FOUR · Rally-bred AWD. Turbocharged triple.', color: '#e7e8e3', accent: '#be1c27',
    mass: 1280, power: 206, torque: 390, redline: 7200, idle: 850, gears: [13.943258, 8.820958, 6.050435, 4.580642, 3.62135, 3.0217], final: 1, wheelR: 0.319,
    torqueCurve: [[0,130],[850,155],[1800,220],[2500,305],[3250,390],[4600,390],[5500,350],[6500,302.64],[7200,260],[7900,210]], peakTorqueRpm: 4000, peakPowerRpm: 6500,
    wheelbase: 2.56, length: 3.995, width: 1.805, cdA: 0.70, vmax: 230, grip: 1.14, steer: 0.59, yawI: 0.95, drift: 1, brake: 1.08, cyl: 3, pitch: 1, body: 'gr_yaris', drive: 'awd', awdRear: 0.47, engine: 'turbo3', turbo: 1, transmission: 'manual',
    tyres: ['225/40 ZR18','225/40 ZR18'], frontW: 0.60, hcg: 0.49, track: 1.554, rsF: 0.59, rollGrad: 2.8, susHz: 2.05, susZ: 0.58, rollK: 0.8, pitchK: 0.85, alphaPk: 0.115, mfC: 1.45, loadSens: 0.15, clA: 0.01, tc: 0.5, esc: 0.4, shiftT: 0.27, bias: 0.72, steerRate: 1.2, ebrake: 0.16, lsd: 0.35,
    stats: { speed: 0.59, accel: 0.84, handling: 0.93, drift: 0.63 },
  },
  {
    id: 'gtv', trafficWeight: 2, name: 'ALFA ROMEO 2000 GTV', short: '2000 GTV', tag: 'Bertone classic · Twin-cam four. Rear-wheel drive.', color: '#b52125', accent: '#bf9160',
    mass: 1040, power: 97, torque: 182, redline: 6500, idle: 850, gears: [3.304, 1.988, 1.355, 1, 0.791], final: 4.10, wheelR: 0.313,
    torqueCurve: [[0,72],[850,86],[1800,130],[3000,165],[4000,180],[4200,182],[5000,177],[5500,168.42],[6000,150],[6500,125],[7100,100]], peakTorqueRpm: 4200, peakPowerRpm: 5500,
    wheelbase: 2.35, length: 4.10, width: 1.58, cdA: 0.70, vmax: 195, grip: 0.99, gripRear: 1.08, steer: 0.62, yawI: 1.15, drift: 1, brake: 0.96, cyl: 4, pitch: 1, body: 'gtv', drive: 'rwd', engine: 'na4', transmission: 'manual',
    // Optional game aids keep W+steer gripped; disabling aids restores the classic's unassisted response.
    tyres: ['165 HR14','165 HR14'], frontW: 0.54, hcg: 0.48, track: 1.30, rsF: 0.58, rollGrad: 4.8, susHz: 1.65, susZ: 0.49, rollK: 1.15, pitchK: 1.15, alphaPk: 0.14, mfC: 1.4, loadSens: 0.16, clA: 0, tc: 0.5, esc: 0.3, edl: 0, shiftT: 0.38, bias: 0.66, steerRate: 0.98, ebrake: 0.14, lsd: 0.25,
    stats: { speed: 0.39, accel: 0.45, handling: 0.69, drift: 0.67 },
  },
  // VW Golf VII press kit (2012), 1.4 TSI ACT: 103 kW, 250 Nm, 212 km/h.
  // https://www.volkswagen-newsroom.com/en/the-new-golf-powertrain-structure-engines-and-gearboxes-2835
  {
    id: 'golf', trafficWeight: 26, name: 'VOLKSWAGEN GOLF 1.4 TSI', short: 'GOLF TSI', tag: 'Athens everyday. Turbo four. Six-speed manual.', color: '#526a83', accent: '#bdc5ca',
    mass: 1270, power: 103, torque: 250, redline: 6500, idle: 800, gears: [3.615, 1.955, 1.281, .973, .778, .646], final: 3.647, wheelR: .315,
    torqueCurve: [[0,95],[800,110],[1500,250],[3500,250],[4500,215],[5000,196.7],[6000,164],[6500,140]], peakTorqueRpm: 2500, peakPowerRpm: 5000,
    wheelbase: 2.637, length: 4.255, width: 1.799, cdA: .62, vmax: 212, grip: 1.02, steer: .60, yawI: 1.02, drift: 1, brake: 1, cyl: 4, pitch: 1, body: 'golf', fleet: 'hatch', drive: 'fwd', engine: 'turbo4', turbo: .8, transmission: 'manual',
    tyres: ['205/55 R16','205/55 R16'], frontW: .60, hcg: .51, track: 1.549, rsF: .59, susHz: 1.65, susZ: .54, rollK: 1.1, pitchK: 1.1, alphaPk: .125, mfC: 1.43, loadSens: .17, clA: 0, tc: .65, esc: .45, shiftT: .28, bias: .72, steerRate: 1.10, ebrake: .16, lsd: 0,
    stats: { speed: .46, accel: .44, handling: .76, drift: .34 },
  },
  // Toyota European Corolla saloon (2019) 1.6 Valvematic: 97 kW at 6400 rpm,
  // 159 Nm at 4400 rpm; six-speed manual, 200 km/h. Kerb mass varies by trim.
  // https://media.toyota.co.uk/toyota-reveals-the-all-new-corolla-saloon/
  {
    id: 'corolla', trafficWeight: 20, name: 'TOYOTA COROLLA 1.6', short: 'COROLLA', tag: 'Naturally aspirated. Six-speed manual. Athens saloon.', color: '#d2d5d3', accent: '#ae3c35',
    mass: 1280, power: 97, torque: 159, redline: 6800, idle: 800, gears: [3.538, 1.913, 1.31, .971, .818, .7], final: 4.214, wheelR: .318,
    torqueCurve: [[0,60],[800,70],[1800,111],[3000,140],[4400,159],[5500,153],[6400,144.73],[6800,124]], peakTorqueRpm: 4400, peakPowerRpm: 6400,
    wheelbase: 2.70, length: 4.630, width: 1.780, cdA: .60, vmax: 200, grip: 1.0, steer: .60, yawI: 1.08, drift: 1, brake: 1, cyl: 4, pitch: 1.05, body: 'corolla', fleet: 'sedan', drive: 'fwd', engine: 'na4', transmission: 'manual',
    tyres: ['205/55 R16','205/55 R16'], frontW: .59, hcg: .51, track: 1.53, rsF: .60, susHz: 1.60, susZ: .53, rollK: 1.15, pitchK: 1.15, alphaPk: .13, mfC: 1.42, loadSens: .17, clA: 0, tc: .7, esc: .5, shiftT: .30, bias: .71, steerRate: 1.08, ebrake: .16, lsd: 0,
    stats: { speed: .40, accel: .34, handling: .71, drift: .31 },
  },
  // Superb III 2.0 TSI DSG (2015): 162 kW, 350 Nm, 245 km/h; 1505 kg
  // representative DIN kerb mass. Ratios expressed as overall ratios for split final drives.
  // https://www.skoda-storyboard.com/en/press-kits/skoda-superb-press-kit/technical-data/
  {
    id: 'superb', trafficWeight: 5, name: 'ŠKODA SUPERB 2.0 TSI', short: 'SUPERB TSI', tag: 'Long-wheelbase liftback. 220 PS. Six-speed DSG.', color: '#25475b', accent: '#bec7cf',
    mass: 1505, power: 162, torque: 350, redline: 6500, idle: 800, gears: [13.80, 8.20, 5.79, 4.28, 3.27, 2.65], final: 1, wheelR: .330,
    torqueCurve: [[0,120],[800,145],[1500,350],[4400,350],[5000,309],[6200,249.5],[6500,220]], peakTorqueRpm: 3000, peakPowerRpm: 6200,
    wheelbase: 2.841, length: 4.861, width: 1.864, cdA: .62, vmax: 245, grip: 1.05, steer: .57, yawI: 1.17, drift: 1, brake: 1.04, cyl: 4, pitch: .92, body: 'superb', fleet: 'taxi_superb', drive: 'fwd', engine: 'turbo4', turbo: 1,
    tyres: ['215/55 R17','215/55 R17'], frontW: .60, hcg: .53, track: 1.584, rsF: .60, susHz: 1.6, susZ: .55, rollK: 1.15, pitchK: 1.15, alphaPk: .125, mfC: 1.44, loadSens: .17, clA: 0, tc: .7, esc: .5, shiftT: .20, bias: .72, steerRate: 1.02, ebrake: .16, lsd: 0,
    stats: { speed: .69, accel: .61, handling: .70, drift: .31 },
  },
  // Octavia IV 1.5 TSI 6MT: 110 kW / 250 Nm, 230 km/h. Fictional police
  // equipment adds 70 kg to a representative 1338 kg DIN kerb mass.
  // https://cdn.skoda-storyboard.com/2019/12/Nova-Skoda_Octavia_technickeudaje.pdf
  {
    id: 'police_octavia', trafficWeight: 0, name: 'ŠKODA OCTAVIA POLICE', short: 'OCTAVIA POLICE', tag: 'Ελληνική Αστυνομία livery. 1.5 TSI. Six-speed manual.', color: '#eceee9', accent: '#194c87',
    mass: 1408, power: 110, torque: 250, redline: 6500, idle: 800, gears: [3.615, 1.955, 1.281, .973, .778, .646], final: 3.647, wheelR: .323,
    torqueCurve: [[0,95],[800,115],[1500,250],[3500,250],[4500,230],[5000,210.1],[6000,175],[6500,150]], peakTorqueRpm: 2500, peakPowerRpm: 5000,
    wheelbase: 2.686, length: 4.689, width: 1.829, cdA: .58, vmax: 230, grip: 1.04, steer: .58, yawI: 1.12, drift: 1, brake: 1.04, cyl: 4, pitch: .96, body: 'police_octavia', fleet: 'taxi', police: true, drive: 'fwd', engine: 'turbo4', turbo: .9, transmission: 'manual',
    tyres: ['205/55 R17','205/55 R17'], frontW: .60, hcg: .54, track: 1.543, rsF: .59, susHz: 1.70, susZ: .57, rollK: 1.05, pitchK: 1.05, alphaPk: .125, mfC: 1.44, loadSens: .17, clA: 0, tc: .65, esc: .45, shiftT: .28, bias: .72, steerRate: 1.08, ebrake: .16, lsd: 0,
    stats: { speed: .58, accel: .45, handling: .75, drift: .34 },
  },

];

for (const car of CARS) car.trafficWeight ??= defaultTrafficWeight(car);

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
export function defaultTrafficWeight(car) {
  const category = String(car.trafficClass || car.class || '').toLowerCase();
  if (car.police) return 0;
  if (car.taxi) return 20;
  if (/shitbox|economy|normal|city|compact/.test(category)) return 18;
  if (/supercar|exotic/.test(category) || car.power >= 350) return .15;
  if (/sport|performance/.test(category) || car.power >= 200) return 1;
  return car.power <= 110 ? 18 : car.power <= 165 ? 8 : 3;
}
export function catalogueTrafficTypes(cars) {
  return cars.filter(car => !car.police).map(car => ({
    id: car.id, name: car.name, model: car.body, catalogueCar: car,
    w: Math.max(0, car.trafficWeight ?? defaultTrafficWeight(car)),
    shape: car.trafficShape || (car.length < 4.4 ? 'hatch' : 'sedan'),
    len: car.length, wid: car.width, taxi: !!car.taxi,
    colors: car.taxi ? [car.color] : ['#f2f2f0', '#c9ccd1', '#1d1f24', '#7d8288', car.color],
  }));
}
export const TRAFFIC_TYPES = [
  { id:'police', name:'Škoda Octavia · ΕΛ.ΑΣ.', police:true, w:0, model:'octavia', shape:'sedan', len:4.689, wid:1.829, colors:['#f0f1ed'] },
  { id:'police_moto', name:'BMW R 1250 RT · ΔΙ.ΑΣ.', police:true, scooter:true, moto:true, w:0, len:2.222, wid:.990, colors:['#f0f1ed'] },
  // w = share of the mix; colours lean on what you actually see in Athens: white, silver, grey, black, a few blues and reds
  { id: 'van', name: 'Fiat Ducato L2H2', model: 'ducato', w: 6, shape: 'van', len: 5.413, wid: 2.05, colors: ['#f4f4f2', '#f4f4f2', '#d8d4c8', '#c9ccd1'] },
  { id: 'truck', name: 'Isuzu NPR delivery truck', model: 'npr', w: 3, shape: 'van', len: 6.40, wid: 2.30, colors: ['#f2f2ec', '#d9dce0', '#477ca0'] },
  { id: 'bus', name: 'Mercedes-Benz Citaro · ΟΣΥ', model: 'citaro', w: 3, shape: 'bus', len: 12, wid: 2.55, colors: ['#f4f4f2'], bus: true },
  { id: 'delivery', name: 'Honda SH150i delivery', model: 'sh150', w: 11, scooter: true, box: true, len: 2.030, wid: .740, colors: ['#f2f2f0', '#c3121c', '#1d1f24', '#2a6fb8', '#e8c33a'] },
  { id: 'scooter', name: 'Piaggio Beverly 300', model: 'beverly', w: 6, scooter: true, len: 2.125, wid: .800, colors: ['#f2f2f0', '#c3121c', '#1d1f24', '#2a6fb8', '#9ad0c2', '#f0a0b0'] },
  { id: 'moto', name: 'Yamaha Tracer 900', model: 'tracer', w: 3, scooter: true, moto: true, len: 2.160, wid: .850, colors: ['#1d1f24', '#c3121c', '#f2f2f0', '#e86a10'] },
  ...catalogueTrafficTypes(CARS),
];
export function trafficModel(type, color, rng, opts = {}) {
  return fleetModel(type, color, rng, opts);
}
