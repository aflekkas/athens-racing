// node --import ./tools/physics-test/register.mjs .scratch/handling-opus/bench.mjs [ids]   (PHYS / CARSFILE select a baseline; OUT writes JSON)
import { route, skidpad } from '../../tools/physics-test/handling.mjs';
import { CARS } from './cars.mjs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const dt = 1 / 60, G = 9.81;
const ids = (process.argv[2] || 'huracan,aventador_svj,z4,carrera,e36_m3,golf_gti,mini,bus').split(',');
const mk = (spec, kmh, assist = 1) => { const c = new Vehicle(spec, route); c.reset(0, 0, kmh / 3.6); c.steerAssist = assist; for (let i = 0; i < 60; i++) { c.update(dt, { throttle: 0.2, brake: 0, steer: 0 }); c.vLong = kmh / 3.6; } return c; };
function brake(spec, kbd = false) {
  const c = mk(spec, 100); let x0 = c.s, t = 0, peak = 0, abs = 0, n = 0, b = 0, vPrev = c.vLong, aSm = 0;
  while (c.vLong > 0.05 && t < 15) { b = kbd ? Math.min(1, b + dt * (b < 0.7 ? 7 : 3.5)) : 1; c.update(dt, { throttle: 0, brake: b, steer: 0 }); const a = (vPrev - c.vLong) / dt; vPrev = c.vLong; aSm += (a - aSm) * 0.5; if (t > 0.1) peak = Math.max(peak, aSm); abs += c.absOn ? 1 : 0; n++; t += dt; }
  return { d: c.s - x0, peak: peak / G, mean: (100 / 3.6) ** 2 / 2 / (c.s - x0) / G, abs: abs / n, t };
}
// step steer at v: keyboard ramp (input.js) or gamepad (instant-ish full stick, light assist)
function step(spec, kmh, dev, thr = 0.3, brk = 0) {
  const c = mk(spec, kmh, dev === 'pad' ? 0.35 : 1); let raw = 0; const out = []; let pathYaw = 0, minR = 1e9;
  for (let i = 0; i < 120; i++) {
    const base = 1 / (1 + c.speed / 22);
    if (dev === 'pad') raw = Math.min(1, raw + dt / 0.05); else raw = Math.min(1, raw + dt * (5 + 2 * base));
    const s = dev === 'pad' ? raw : Math.pow(raw, 1.1);
    c.update(dt, { throttle: thr, brake: brk, steer: s });
    out.push({ t: (i + 1) * dt, w: c.w, ay: c.ay / G, v: c.speed, beta: Math.atan2(c.vLat, c.vLong), d: c.steer, sf: c.wheel[0].sN, sr: c.wheel[1].sN });
  }
  const at = (t) => out[Math.round(t / dt) - 1];
  const wss = out.slice(54, 72).reduce((a, o) => a + o.w, 0) / 18; // ~0.9-1.2 s
  const t90 = (out.find((o) => o.w > 0.9 * wss) || { t: 9 }).t;
  const R = (o) => o.v / Math.max(1e-3, o.w);
  return { w150: at(0.15).w, ay150: at(0.15).ay, w300: at(0.3).w, ay300: at(0.3).ay, wss, t90, R1: R(at(1.0)), ay1: at(1.0).ay, v1: at(1).v * 3.6, sf1: at(1).sf, sr1: at(1).sr, beta1: at(1).beta * 57.3 };
}
function sbend(spec) {
  const c = mk(spec, 80); let raw = 0, tgt = 1, mb = 0, latch = 0, minAy = 9;
  for (let i = 0; i < 150; i++) { if (i * dt > 0.6) tgt = -1; const rate = Math.sign(tgt) !== Math.sign(raw) && raw !== 0 ? 10 : 6; raw += Math.max(-rate * dt, Math.min(rate * dt, tgt - raw));
    c.update(dt, { throttle: 0, brake: 0, steer: Math.sign(raw) * Math.abs(raw) ** 1.1 }); mb = Math.max(mb, Math.abs(Math.atan2(c.vLat, c.vLong))); latch = Math.max(latch, c.driftLatch); if (i > 80) minAy = Math.min(minAy, -c.ay / G); }
  return { maxBeta: mb * 57.3, latch, minAy };
}
function brakeTurn(spec) {
  const c = mk(spec, 80); let raw = 0, ay = 0, ax = 0, n = 0;
  for (let i = 0; i < 60; i++) { raw = Math.min(1, raw + dt * 6); c.update(dt, { throttle: 0, brake: 1, steer: raw ** 1.1 }); if (i >= 24) { ay += c.ay / G; ax -= c.ax / G; n++; } }
  return { ay: ay / n, ax: ax / n };
}
const f = (x, n = 2) => (+x).toFixed(n);
const rows = [];
for (const id of ids) {
  const spec = CARS.find((c) => c.id === id);
  const sk = skidpad(spec), B = brake(spec), BK = brake(spec, true);
  const k = step(spec, 80, 'kbd'), p = step(spec, 80, 'pad'), kb = step(spec, 80, 'kbd', 0, 0.4);
  const sb = sbend(spec), bt = brakeTurn(spec);
  const r = { id, skid: sk.maxG, K: sk.K, d100: B.d, peak: B.peak, mean: B.mean, abs: B.abs, d100k: BK.d, k, p, kb, sb, bt };
  console.log(`   S-bend max beta ${f(sb.maxBeta, 1)} latch ${f(sb.latch)} min ay ${f(sb.minAy)} | full brake+steer ay ${f(bt.ay)} decel ${f(bt.ax)}`);
  rows.push(r);
  console.log(`${id.padEnd(14)} skid ${f(sk.maxG)}g K ${f(sk.K)} | 100-0 ${f(B.d, 1)}m (kbd ${f(BK.d, 1)}) peak ${f(B.peak)}g mean ${f(B.mean)}g abs ${f(B.abs)}`);
  for (const [n, s] of [['kbd', k], ['pad', p], ['kbd+brk.4', kb]]) console.log(`   ${n.padEnd(10)} w150 ${f(s.w150, 3)} ay150 ${f(s.ay150)} w300 ${f(s.w300, 3)} ay300 ${f(s.ay300)} wss ${f(s.wss, 3)} t90 ${f(s.t90)} | 1s: R ${f(s.R1, 1)}m ay ${f(s.ay1)} v ${f(s.v1, 0)} sNf ${f(s.sf1)} sNr ${f(s.sr1)} beta ${f(s.beta1, 1)}`);
}
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(rows, null, 1));
