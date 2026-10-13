// Sustained-drift bench: node --import ./tools/physics-test/register.mjs tools/physics-test/drift.mjs [carId]
// Requirement: once a slide starts, steady throttle + counter-steer holds |beta| in 0.3..0.6 rad for 5+ s, and
// drifts are easy to start (handbrake flick, power-over, lift-off feint). The "driver" here only counter-steers
// (PD on sideslip + yaw-rate damping); throttle is held constant after the entry.
import { readFileSync } from 'node:fs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');

const src = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
const CARS = new Function('return ' + arr.slice(0, end))();
for (const [id, o] of Object.entries(JSON.parse(process.env.SPEC || '{}'))) Object.assign(CARS.find((c) => c.id === id), o);

const route = {
  frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); },
  point(s, u) { return { x: u, z: -s, y: 0 }; },
  y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0,
  project(x, z) { return { s: -z, u: x }; },
};
const dt = 1 / 60;
const B = (c) => Math.atan2(c.vLat, Math.max(2, Math.abs(c.vLong)));     // sideslip, rad (same as physics.js)
const kmh = (c) => Math.hypot(c.vLong, c.vLat) * 3.6;
const rolling = (spec, v) => { const c = new Vehicle(spec, route); c.reset(0, 0, v / 3.6); for (let i = 0; i < 90; i++) { c.update(dt, { throttle: 0.25, brake: 0, steer: 0 }); c.vLong = v / 3.6; } return c; };

// counter-steering driver: holds |sideslip| at tgt on whichever side the slide started (side = sign of beta)
function hold(c, side, tgt, kS, kW, thr, T, trace) {
  let run = 0, best = 0, minV = 1e9, sumB = 0, n = 0, spun = false, tIn = null;
  for (let i = 0; i < T / dt; i++) {
    const b = B(c), err = b * side - tgt;                                    // > 0: too much angle
    const steer = Math.max(-1, Math.min(1, side * kS * err - kW * c.w)); // counter-steer harder when over-angled
    c.update(dt, { throttle: thr, brake: 0, steer, handbrake: false });
    const ab = Math.abs(B(c));
    if (Math.abs(B(c)) > 1.4) spun = true;
    if (tIn === null && ab >= 0.3) tIn = i * dt;
    if (ab >= 0.3 && ab <= 0.6 && Math.sign(B(c)) === side && kmh(c) > 20) { run += dt; best = Math.max(best, run); minV = Math.min(minV, kmh(c)); sumB += ab; n++; } else run = 0;
    if (trace && i % 30 === 0) trace.push(`${(i * dt).toFixed(1)}:b${(B(c) * 57.3).toFixed(0)} ${kmh(c).toFixed(0)}k st${steer.toFixed(2)} g${c.gear}`);
  }
  return { best, minV, avgB: n ? sumB / n : 0, spun, tIn };
}

// entries: each returns the car mid-slide (or not) and the side the tail went
const ENTRIES = {
  handbrake(spec) { const c = rolling(spec, 70); for (let i = 0; i < 24; i++) c.update(dt, { throttle: 0, brake: 0, steer: 0.6, handbrake: i < 21 }); return c; },
  powerOver(spec) { const c = rolling(spec, 45); for (let i = 0; i < 60; i++) c.update(dt, { throttle: 0.3, brake: 0, steer: 0.55 }); for (let i = 0; i < 48; i++) c.update(dt, { throttle: 1, brake: 0, steer: 0.75 }); return c; },
  feint(spec) { const c = rolling(spec, 80); for (let i = 0; i < 24; i++) c.update(dt, { throttle: 0.5, brake: 0, steer: -0.7 }); for (let i = 0; i < 36; i++) c.update(dt, { throttle: 0, brake: 0, steer: 0.9 }); return c; },
};

const only = process.argv[2];
let allOk = true;
for (const spec of CARS) {
  if (only && spec.id !== only) continue;
  const lines = [];
  let hbBest = null;
  for (const [name, entry] of Object.entries(ENTRIES)) {
    const e0 = entry(spec), b0 = B(e0);
    // which way the tail is going: sideslip if it's already there, else opposite to the yaw rate
    const side = Math.abs(b0) > 0.05 ? Math.sign(b0) : -Math.sign(e0.w), started = true;
    let best = null;
    if (started) for (const thr of [0.5, 0.7, 0.9]) for (const kS of [1.5, 3]) for (const kW of [0, 0.2, 0.5]) for (const tgt of [0.4, 0.5]) {
      const c = entry(spec), r = hold(c, side, tgt, kS, kW, thr, 8);
      if (!best || r.best > best.best) best = { ...r, thr, kS, kW, tgt };
    }
    // power-over needs a driven rear axle: a FWD car pushes wide on the power (it's entered by handbrake / feint)
    const na = name === 'powerOver' && spec.drive === 'fwd';
    const ok = started && best && best.best >= 5;
    if (!na) allOk &&= ok;
    if (name === 'handbrake' && best) hbBest = best;
    lines.push(`  ${na ? 'n/a ' : ok ? 'PASS' : 'FAIL'} ${name.padEnd(9)} entry b ${(b0 * 57.3).toFixed(0)}°` + (best ? `  0.3 rad after ${best.tIn === null ? '-' : best.tIn.toFixed(2) + ' s'}, held ${best.best.toFixed(1)} s in 0.3-0.6 rad, avg ${(best.avgB * 57.3).toFixed(0)}°, min ${best.minV === 1e9 ? '-' : best.minV.toFixed(0)} km/h${best.spun ? ' (spun in some runs)' : ''}  [thr ${best.thr} kS ${best.kS} kW ${best.kW} tgt ${best.tgt}]` : '  (no slide)'));
  }
  // transition: handbrake drift one way for 3 s, then the driver swaps the target side (flick into the next bend);
  // the car should swing through into the opposite drift and hold it
  { let r = null;
    for (const thr of [0.7, 0.9, 1]) for (const kS of [1.5, 3]) for (const kW of [0, 0.5]) {
      const c = ENTRIES.handbrake(spec), b0 = B(c), side = Math.abs(b0) > 0.05 ? Math.sign(b0) : -Math.sign(c.w);
      hold(c, side, 0.4, kS, kW, thr, 3);
      const q = hold(c, -side, 0.4, kS, kW, thr, 5);
      if (!r || (q.best - (q.spun ? 9 : 0)) > (r.best - (r.spun ? 9 : 0))) r = { ...q, thr, kS, kW };
    }
    const ok = r.best >= 2.5 && !r.spun; allOk &&= ok;
    lines.push(`  ${ok ? 'PASS' : 'FAIL'} transition into the opposite drift: held ${r.best.toFixed(1)} s, avg ${(r.avgB * 57.3).toFixed(0)}°, min ${r.minV === 1e9 ? '-' : r.minV.toFixed(0)} km/h${r.spun ? ' SPUN' : ''}  [thr ${r.thr} kS ${r.kS} kW ${r.kW}]`); }
  // no false drift: keyboard slalom on the throttle at 100 km/h (full-lock taps every 0.5 s) stays gripped
  // (compared with the same run with the drift latch forced off: a full-lock slalom has ~10 deg of slip on its own)
  { const run = (noLatch) => { const c = rolling(spec, 100); let mb = 0;
      for (let i = 0; i < 240; i++) { if (noLatch) c.driftLatch = 0; const st = Math.floor(i / 30) % 2 ? -1 : 1; c.update(dt, { throttle: 0.6, brake: 0, steer: st * Math.min(1, (i % 30) / 8), handbrake: false }); mb = Math.max(mb, Math.abs(B(c))); }
      return mb; };
    const mb = run(false), m0 = run(true), ok = mb < m0 + 0.035 && mb < 0.3; allOk &&= ok;
    lines.push(`  ${ok ? 'PASS' : 'FAIL'} keyboard slalom @100 on throttle stays gripped: max beta ${(mb * 57.3).toFixed(1)}° (latch off ${(m0 * 57.3).toFixed(1)}°)`); }
  console.log(`== ${spec.id} (${spec.drive})\n${lines.join('\n')}`);
}
process.exitCode = allOk ? 0 : 1;
