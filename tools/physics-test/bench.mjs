// Headless handling bench: node --import ./tools/physics-test/register.mjs tools/physics-test/bench.mjs [carId]
// Straight, flat, endless road; car specs are lifted from src/cars.js source (so it runs without three.js / models).
import { readFileSync } from 'node:fs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');

const src = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
const CARS = new Function('return ' + arr.slice(0, end))();
// SPEC='{"mini":{"bias":0.75}}' tries spec tweaks without touching cars.js
for (const [id, o] of Object.entries(JSON.parse(process.env.SPEC || '{}'))) Object.assign(CARS.find((c) => c.id === id), o);

// road along -z: s = -z, u = x
const route = {
  GR: null,
  frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); },
  point(s, u) { return { x: u, z: -s, y: 0 }; },
  y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0,
  project(x, z) { return { s: -z, u: x }; },
};

const dt = 1 / 60;
// start at speed in the gear the box would have picked: cruise for 1.5 s first
const rolling = (spec, kmh) => { const c = new Vehicle(spec, route); c.reset(0, 0, kmh / 3.6); for (let i = 0; i < 90; i++) { c.update(dt, { throttle: 0.25, brake: 0, steer: 0 }); c.vLong = kmh / 3.6; } return c; };
// rear driven-wheel surface speed (works for per-axle [front, rear] or per-wheel [fl, fr, rl, rr] layouts)
const rw = (c) => { const n = c.wheel.length, r = c.wheel.slice(n / 2); return r.reduce((a, w) => a + w.vw, 0) / r.length; };
const beta = (c) => Math.atan2(c.vLat, Math.abs(c.vLong)) * 57.3;
const only = process.argv[2];
for (const spec of CARS) {
  if (only && spec.id !== only) continue;
  const L = [];
  // launch: full throttle from rest
  const v = new Vehicle(spec, route); v.reset(0, 0, 0);
  let t = 0, marks = {}, spin = [], dist = 0, q = null;
  while (t < 60) {
    v.update(dt, { throttle: 1, brake: 0, steer: 0 }); t += dt; dist += v.vLong * dt;
    for (const k of [50, 100, 160, 200]) if (!marks[k] && v.kmh >= k) marks[k] = t.toFixed(2);
    if (!q && dist >= 402.3) q = `${t.toFixed(2)}s @ ${v.kmh.toFixed(0)}`;
    if (Math.abs(t * 4 - Math.round(t * 4)) < 1e-6 && t <= 4) spin.push(`${t.toFixed(2)}:${v.kmh.toFixed(0)}/${(rw(v) * 3.6).toFixed(0)}g${v.gear}${v.tcOn ? 'T' : ''}`);
  }
  L.push(`0-50 ${marks[50]}  0-100 ${marks[100]}  0-160 ${marks[160]}  0-200 ${marks[200]}  1/4mi ${q}  top ${v.kmh.toFixed(0)}`);
  L.push(`  launch (t:car/rearWheel kmh,gear,T=TC): ${spin.join(' ')}`);
  // 80-120 kickdown
  { const c = new Vehicle(spec, route); c.reset(0, 0, 80 / 3.6); c.gear = 4; let tt = 0; while (c.kmh < 120 && tt < 30) { c.update(dt, { throttle: 1, brake: 0, steer: 0 }); tt += dt; } L.push(`  80-120 ${tt.toFixed(2)}`); }
  // braking 100-0
  { const b = new Vehicle(spec, route); b.reset(0, 0, 100 / 3.6); const z0 = b.z; for (let i = 0; i < 1200 && b.kmh > 0.3; i++) b.update(dt, { throttle: 0, brake: 1, steer: 0 }); L.push(`  100-0 ${Math.abs(b.z - z0).toFixed(1)} m`); }
  // handbrake at 80: pull for 0.6 s with steer, then throttle + hold steer
  for (const [label, thr] of [['hb+steer', 0], ['hb+steer+thr', 0.6]]) {
    const h = rolling(spec, 80); const tr = [];
    for (let i = 0; i < 150; i++) {
      const pull = i < 36;
      h.update(dt, { throttle: pull ? 0 : thr, brake: 0, steer: pull ? 0.7 : 0.2, handbrake: pull });
      if (i % 15 === 14) tr.push(`${((i + 1) * dt).toFixed(2)}:b${beta(h).toFixed(0)}° w${(h.w * 57.3).toFixed(0)} ${h.kmh.toFixed(0)}k rw${(rw(h) * 3.6).toFixed(0)}${h.escOn ? 'E' : ''}`);
    }
    L.push(`  ${label}: ${tr.join(' ')}`);
  }
  // power-over at 40 km/h in a corner (RWD should step out)
  { const p = new Vehicle(spec, route); p.reset(0, 0, 40 / 3.6); let pb = 0; for (let i = 0; i < 120; i++) { p.update(dt, { throttle: i > 30 ? 1 : 0.2, brake: 0, steer: 0.6 }); pb = Math.max(pb, Math.abs(beta(p))); } L.push(`  power-on @40 max beta ${pb.toFixed(1)}°`); }
  // drift hold: handbrake entry at 70 km/h, then a simple driver counter-steers and modulates throttle to hold ~25-30 deg.
  // best over a small gain grid; reports how long the car stays in a 12..45 deg slide above 25 km/h (max 4 s)
  { let best = null;
    for (const kS of [1.5, 2.5, 4]) for (const kT of [1, 2.5]) for (const tgt of [0.4, 0.55]) for (const kW of [0.12, 0.4, 0.8]) {
      const c = rolling(spec, 70); let hold = 0, sumB = 0, minK = 99;
      for (let i = 0; i < 300; i++) {
        const t = i * dt, b = Math.atan2(c.vLat, Math.max(2, Math.abs(c.vLong)));
        let inp;
        if (t < 0.35) inp = { throttle: 0, brake: 0, steer: 0.65, handbrake: true };
        else { const err = b + tgt; inp = { throttle: Math.max(0, Math.min(1, 0.55 + kT * err)), brake: 0, steer: Math.max(-1, Math.min(1, kS * err - kW * c.w)), handbrake: false }; }
        c.update(dt, inp);
        const db = Math.abs(beta(c)), kmh = Math.hypot(c.vLong, c.vLat) * 3.6;
        if (t > 0.35 && db > 12 && db < 45 && kmh > 25) { hold += dt; sumB += db * dt; minK = Math.min(minK, kmh); }
      }
      if (!best || hold > best.hold) best = { hold, avgB: hold ? sumB / hold : 0, minK, kS, kT, tgt, kW };
    }
    L.push(`  drift-hold: ${best.hold.toFixed(2)}s avg ${best.avgB.toFixed(0)}° min ${best.minK.toFixed(0)}kmh (kS ${best.kS} kT ${best.kT} kW ${best.kW} tgt ${best.tgt})`); }
  console.log(`== ${spec.id} (${spec.drive}, ${spec.mass}kg ${spec.power}kW ${spec.torque}Nm ${spec.engine})\n` + L.join('\n'));
}
