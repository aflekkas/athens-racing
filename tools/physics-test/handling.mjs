// Handling bench: node --import ./tools/physics-test/register.mjs tools/physics-test/handling.mjs [carId]
// Per car: constant-radius skidpad (max lateral g, understeer gradient deg/g), what full keyboard lock delivers at
// speed (and which axle saturates), lift-off and trail-brake rotation. Flat endless road, specs from src/cars.js.
import { readFileSync } from 'node:fs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');

const src = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
export const CARS = new Function('return ' + arr.slice(0, end))();
for (const [id, o] of Object.entries(JSON.parse(process.env.SPEC || '{}'))) Object.assign(CARS.find((c) => c.id === id), o);

export const route = {
  frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); },
  point(s, u) { return { x: u, z: -s, y: 0 }; },
  y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0,
  project(x, z) { return { s: -z, u: x }; },
};
const dt = 1 / 60, G = 9.81, D = 57.2958;
const rolling = (spec, kmh) => { const c = new Vehicle(spec, route); c.reset(0, 0, kmh / 3.6); for (let i = 0; i < 90; i++) { c.update(dt, { throttle: 0.25, brake: 0, steer: 0 }); c.vLong = kmh / 3.6; } return c; };
const spd = (c) => Math.hypot(c.vLong, c.vLat);
// throttle PI to hold a speed
const speedCtl = (c, vT, st) => { const e = vT - spd(c); st.i = Math.max(-0.5, Math.min(0.8, (st.i ?? 0.2) + e * dt * 0.6)); return { throttle: Math.max(0, Math.min(1, st.i + e * 0.5)), brake: e < -2 ? Math.min(1, -e * 0.1) : 0 }; };

/** constant-radius skidpad R m: speed ramps slowly, steering holds yaw rate v / R (path curvature). Returns max
 *  steady lateral g, understeer gradient K (deg/g of road-wheel angle beyond Ackermann, fitted 0.1..0.5 g) and
 *  the axle slip balance at the limit. */
export function skidpad(spec, R = 40) {
  const c = rolling(spec, 25); const st = {}, pts = []; let s = 0.05, best = 0, bal = null;
  let vT = 25 / 3.6, hold = 0, lost = 0;
  for (let i = 0; i < 60 * 160; i++) {
    const curv = c.w / Math.max(1, spd(c)), e = 1 / R - curv;            // + : not turning tightly enough
    s = Math.max(-1, Math.min(1, s + e * 9 * dt * 60 * 0.02 + e * 0.0));
    const th = speedCtl(c, vT, st);
    c.update(dt, { ...th, steer: s, handbrake: false });
    const ay = Math.abs(c.ay) / G;
    if (Math.abs(e) < 0.0015 && Math.abs(spd(c) - vT) < 0.3) { hold += dt; if (hold > 0.6) { pts.push([ay, Math.abs(c.steer) * D - spec.wheelbase / R * D]); if (ay > best) { best = ay; bal = { f: Math.abs(c.wheel[0].sy), r: Math.abs(c.wheel[1].sy), beta: Math.atan2(c.vLat, Math.abs(c.vLong)) * D, input: s }; } } }
    else hold = 0;
    if (hold > 1.2 || (i % 60 === 0 && i > 600)) { vT += 0.25 * (hold > 1.2 ? 1 : 0.2); if (hold > 1.2) hold = 0.6; }
    lost = Math.abs(e) > 0.02 && i > 600 ? lost + dt : 0;
    if (lost > 1 || (Math.abs(s) >= 1 && Math.abs(e) > 0.01 && i > 600)) break; // lost the circle for good: past the limit
  }
  const fit = pts.filter((p) => p[0] > 0.1 && p[0] < 0.5);
  let K = NaN;
  if (fit.length > 5) { const n = fit.length, sx = fit.reduce((a, p) => a + p[0], 0), sy = fit.reduce((a, p) => a + p[1], 0), sxx = fit.reduce((a, p) => a + p[0] * p[0], 0), sxy = fit.reduce((a, p) => a + p[0] * p[1], 0); K = (n * sxy - sx * sy) / (n * sxx - sx * sx); }
  return { maxG: best, K, bal };
}

/** full keyboard lock at constant speed: steady lateral g and per-axle normalised slip (> 1: past the peak) */
export function fullLock(spec, kmh) {
  const c = rolling(spec, kmh); const st = {};
  let ay = 0, n = 0, f = 0, r = 0;
  for (let i = 0; i < 240; i++) {
    const th = speedCtl(c, kmh / 3.6, st); th.throttle = Math.min(0.5, th.throttle); // part throttle mid-corner
    c.update(dt, { ...th, steer: 1, handbrake: false });
    if (i > 150) { ay += Math.abs(c.ay) / G; f += Math.abs(c.wheel[0].sy); r += Math.abs(c.wheel[1].sy); n++; }
  }
  return { ay: ay / n, f: f / n, r: r / n, lock: c.lockAt(spd(c)) * D, kmh: spd(c) * 3.6 };
}

/** steady corner at ~0.6 of the skidpad limit, then lift (throttle 0) or trail-brake (brake 0.35): yaw-rate gain
 *  and peak sideslip change over 0.6 s (> 1: the car tucks in / rotates) */
export function transient(spec, kind, gLim) {
  const R = 60, vT = Math.sqrt(0.6 * gLim * G * R); const c = rolling(spec, vT * 3.6); const st = {}; let s = 0.05;
  for (let i = 0; i < 300; i++) { const e = 1 / R - c.w / Math.max(1, spd(c)); s = Math.max(-1, Math.min(1, s + e * 0.18)); c.update(dt, { ...speedCtl(c, vT, st), steer: s }); }
  const w0 = Math.abs(c.w), b0 = Math.atan2(c.vLat, Math.abs(c.vLong)) * D; let wMax = w0, bMax = Math.abs(b0), spun = false;
  for (let i = 0; i < 36; i++) {
    c.update(dt, { throttle: 0, brake: kind === 'trail' ? 0.35 : 0, steer: s });
    wMax = Math.max(wMax, Math.abs(c.w) / Math.max(0.3, spd(c)) * vT); bMax = Math.max(bMax, Math.abs(Math.atan2(c.vLat, Math.abs(c.vLong)) * D));
    if (bMax > 30) spun = true;
  }
  return { gain: wMax / Math.max(1e-3, w0), dBeta: bMax - Math.abs(b0), spun };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  for (const spec of CARS) {
    if (only && spec.id !== only) continue;
    const sk = skidpad(spec);
    const fl = [60, 100, 140].map((k) => fullLock(spec, k));
    const lo = transient(spec, 'lift', sk.maxG || 0.8), tb = transient(spec, 'trail', sk.maxG || 0.8);
    console.log(`== ${spec.id} (${spec.drive}, grip ${spec.grip}, frontW ${spec.frontW}, rsF ${spec.rsF})`);
    console.log(`  skidpad R40: max ${sk.maxG.toFixed(2)} g, understeer gradient ${sk.K.toFixed(2)} deg/g, at limit: front sy ${sk.bal?.f.toFixed(2)} rear sy ${sk.bal?.r.toFixed(2)} beta ${sk.bal?.beta.toFixed(1)}° input ${sk.bal?.input.toFixed(2)}`);
    console.log('  full keyboard lock: ' + fl.map((r) => `${r.kmh.toFixed(0)} km/h ${r.ay.toFixed(2)} g (lock ${r.lock.toFixed(1)}°, front sy ${r.f.toFixed(2)} rear ${r.r.toFixed(2)})`).join(' | '));
    console.log(`  lift-off: yaw gain ${lo.gain.toFixed(2)} dBeta ${lo.dBeta.toFixed(1)}°${lo.spun ? ' SPUN' : ''} | trail-brake: yaw gain ${tb.gain.toFixed(2)} dBeta ${tb.dBeta.toFixed(1)}°${tb.spun ? ' SPUN' : ''}`);
  }
}
