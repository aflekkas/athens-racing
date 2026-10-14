// Deterministic physics regression tests (no dependencies, no browser):
//   node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
// PHYS=../../path/to/physics.js swaps the module under test (relative to this file).
// The handling tests use one controlled chassis and change only spec.drive (and the diff), so any FWD / RWD
// difference comes from where the torque goes, not from tuning. Assists (TC / ESC / EDL) are off unless stated.
import './register.mjs';
import { readFileSync } from 'node:fs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');

// flat straight endless road along -z: s = -z, u = x (right)
const route = {
  GR: null,
  frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); },
  point(s, u) { return { x: u, z: -s, y: 0 }; },
  y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0,
  project(x, z) { return { s: -z, u: x }; },
};
// controlled chassis: 50/50 roadster-like, 250 kW, open diff, no assists
const BASE = {
  id: 'test', mass: 1500, power: 250, torque: 500, redline: 7000, idle: 800, gears: [3.8, 2.4, 1.7, 1.3, 1.05, 0.85], final: 3.4, wheelR: 0.33,
  wheelbase: 2.6, length: 4.4, width: 1.85, cdA: 0.65, vmax: 250, grip: 1.1, steer: 0.6, yawI: 1, drift: 1, brake: 1.05, body: 'test',
  frontW: 0.5, hcg: 0.5, track: 1.58, rsF: 0.55, susHz: 1.9, susZ: 0.5, alphaPk: 0.11, mfC: 1.5, loadSens: 0.15, clA: 0,
  tc: 0, esc: 0, edl: 0, lsd: 0, shiftT: 0.15, bias: 0.65, steerRate: 1, ebrake: 0.15, engine: 'turbo6', turbo: 1,
};
const mk = (o = {}) => { const v = new Vehicle({ ...BASE, ...o }, route); return v; };
// per-wheel normalised slip ratio (falls back to the axle summary for the pre-audit 2-wheel model)
const sxOf = (v, i) => (v.corners ? v.corners[i].sx : v.wheel[i >> 1].sx);
const finite = (v) => [v.x, v.z, v.yaw, v.vLong, v.vLat, v.w, ...(v.corners || v.wheel).map((c) => c.vw)].every(Number.isFinite);
const kappa = (v) => v.w / Math.max(1, Math.hypot(v.vLong, v.vLat)); // path curvature (1/m), + = right
const overAng = (v) => -Math.atan2(v.vLat, Math.abs(v.vLong)) * Math.sign(v.w || 1); // > 0: tail out (oversteer)
const DT = 1 / 60;

let fails = 0, passes = 0;
const results = [];
function check(name, ok, info = '') { (ok ? passes++ : fails++); results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  [' + info + ']' : ''}`); }
const f3 = (x) => (+x).toFixed(3), f2 = (x) => (+x).toFixed(2), f1 = (x) => (+x).toFixed(1);

/** settle into a steady corner on constant steer and part throttle, then apply phase 2 inputs */
function corner(drive, phase2, o = {}) {
  const v = mk({ drive, ...o }); v.reset(0, 0, o.v0 ?? 60 / 3.6); v.gear = o.gear ?? 2;
  // a fixed steering-wheel angle (raw rack, no keyboard steering assist): these check the chassis, not the driver aid
  v.steerAssist = 0;
  const st = o.steer ?? 0.3;
  for (let i = 0; i < 240; i++) v.update(DT, { throttle: o.thr0 ?? 0.25, brake: 0, steer: st });
  const before = { k: kappa(v), b: overAng(v), w: v.w, ay: v.ay };
  let maxB = before.b, minK = before.k, maxK = before.k, n = phase2.n ?? 90;
  const tr = { innerSpin: 0, outerSpin: 0 };
  for (let i = 0; i < n; i++) {
    v.update(DT, { throttle: phase2.thr, brake: phase2.brk ?? 0, steer: st });
    maxB = Math.max(maxB, overAng(v)); minK = Math.min(minK, kappa(v)); maxK = Math.max(maxK, kappa(v));
    // right-hand corner: right wheels are the inner ones
    const ax = drive === 'rwd' ? 2 : 0;
    tr.innerSpin = Math.max(tr.innerSpin, sxOf(v, ax + 1)); tr.outerSpin = Math.max(tr.outerSpin, sxOf(v, ax));
  }
  return { v, before, after: { k: kappa(v), b: overAng(v) }, maxB, minK, maxK, ...tr };
}

// ------------------------------------------------------------------ 1. determinism
{
  const run = () => { const v = mk({ drive: 'rwd', tc: 0.5, esc: 0.4 }); v.reset(0, 0, 20); for (let i = 0; i < 400; i++) v.update(DT, { throttle: i < 200 ? 1 : 0, brake: i > 300 ? 1 : 0, steer: Math.sin(i * 0.05) }); return [v.x, v.z, v.yaw, v.vLong, v.vLat, v.w, v.rpm].join(','); };
  check('determinism: identical runs give bit-identical state', run() === run());
}

// ------------------------------------------------------------------ 2. straight-line launch, traction limited
{
  const t50 = {};
  const slip = {};
  for (const d of ['fwd', 'rwd']) {
    const v = mk({ drive: d }); v.reset(0, 0, 0); let t = 0; slip[d] = 0;
    while (v.kmh < 50 && t < 20) { v.update(DT, { throttle: 1, brake: 0, steer: 0 }); t += DT; const ax = d === 'fwd' ? 0 : 2; slip[d] = Math.max(slip[d], sxOf(v, ax)); }
    t50[d] = t;
  }
  check('launch: RWD gets to 50 km/h first on a 50/50 chassis (weight moves onto the driven rear)', t50.rwd < t50.fwd * 0.97, `fwd ${f2(t50.fwd)} s, rwd ${f2(t50.rwd)} s`);
  check('launch: FWD driven wheels slip harder than RWD (less load on them)', slip.fwd > slip.rwd, `peak normalised slip fwd ${f2(slip.fwd)}, rwd ${f2(slip.rwd)}`);
}

// ------------------------------------------------------------------ 3. power-on in a steady corner
{
  const F = corner('fwd', { thr: 1, n: 90 }), R = corner('rwd', { thr: 1, n: 90 });
  check('steady corner: identical before power (same chassis)', Math.abs(F.before.k - R.before.k) < 0.15 * Math.abs(F.before.k), `k fwd ${f3(F.before.k)} rwd ${f3(R.before.k)} 1/m, ay ${f2(F.before.ay / 9.81)} g`);
  check('power-on: FWD runs wide (path curvature drops, understeer)', F.minK < F.before.k * 0.8, `k ${f3(F.before.k)} -> min ${f3(F.minK)}`);
  check('power-on: FWD tail stays put', F.maxB < F.before.b + 0.05, `tail-out ${f1(F.before.b * 57.3)} -> max ${f1(F.maxB * 57.3)} deg`);
  check('power-on: RWD tail steps out (oversteer)', R.maxB > R.before.b + 0.1, `tail-out ${f1(R.before.b * 57.3)} -> max ${f1(R.maxB * 57.3)} deg`);
  check('power-on: RWD tightens its line relative to FWD', R.maxK > F.maxK * 1.15, `max k rwd ${f3(R.maxK)} vs fwd ${f3(F.maxK)}`);
  check('open diff: unloaded inner driven wheel spins more than the outer (FWD)', F.innerSpin > F.outerSpin + 0.3, `inner ${f2(F.innerSpin)} outer ${f2(F.outerSpin)}`);
  const L = corner('fwd', { thr: 1, n: 90 }, { lsd: 0.6 });
  check('LSD: locking evens out inner / outer spin', (L.innerSpin - L.outerSpin) < 0.6 * (F.innerSpin - F.outerSpin), `open d ${f2(F.innerSpin - F.outerSpin)}, lsd d ${f2(L.innerSpin - L.outerSpin)}`);
  const E = corner('fwd', { thr: 1, n: 90 }, { edl: 0.8 });
  check('EDL: braking the spinning wheel lets the open-diff axle drive harder', E.v.vLong > F.v.vLong, `exit speed edl ${f1(E.v.kmh)} vs open ${f1(F.v.kmh)} km/h`);
}

// ------------------------------------------------------------------ 4. lift-off mid-corner
{
  const o = { thr0: 0.45, steer: 0.32, v0: 70 / 3.6, gear: 2 };
  const F = corner('fwd', { thr: 0, n: 60 }, o), R = corner('rwd', { thr: 0, n: 60 }, o);
  check('lift-off: FWD tucks in (curvature rises)', F.maxK > F.before.k * 1.04, `k ${f3(F.before.k)} -> ${f3(F.maxK)}`);
  check('lift-off: RWD tucks in (curvature rises)', R.maxK > R.before.k * 1.04, `k ${f3(R.before.k)} -> ${f3(R.maxK)}`);
  check('lift-off: RWD rotates at least as much as FWD (engine braking on the rear axle)', R.maxB - R.before.b >= F.maxB - F.before.b - 0.005, `d tail fwd ${f1((F.maxB - F.before.b) * 57.3)} rwd ${f1((R.maxB - R.before.b) * 57.3)} deg`);
  check('lift-off: no spin (stays below 25 deg) without assists', Math.max(F.maxB, R.maxB) < 0.44 && finite(F.v) && finite(R.v));
}

// ------------------------------------------------------------------ 5. straight braking 100-0 with ABS
{
  const d = {};
  for (const dr of ['fwd', 'rwd']) {
    const v = mk({ drive: dr }); v.reset(0, 0, 100 / 3.6); const z0 = v.z; let abs = 0, t = 0;
    while (v.kmh > 0.3 && t < 15) { v.update(DT, { throttle: 0, brake: 1, steer: 0 }); t += DT; if (v.absOn) abs++; }
    d[dr] = { dist: Math.abs(v.z - z0), yaw: Math.abs(v.yaw), u: Math.abs(v.x), t, abs, stop: v.vLong };
  }
  const ideal = (100 / 3.6) ** 2 / (2 * BASE.grip * 9.81);
  for (const dr of ['fwd', 'rwd']) {
    check(`braking ${dr}: stops straight`, d[dr].yaw < 0.01 && d[dr].u < 0.2, `yaw ${f3(d[dr].yaw)} rad, drift ${f3(d[dr].u)} m`);
    check(`braking ${dr}: distance near mu-limited ideal (${f1(ideal)} m)`, d[dr].dist > ideal * 0.95 && d[dr].dist < ideal * 1.35, `${f1(d[dr].dist)} m, ABS frames ${d[dr].abs}`);
    // (holding the brake at a standstill selects reverse by design, so the clock stops at rest)
    check(`braking ${dr}: comes to rest without rolling backwards`, d[dr].t < 15 && d[dr].stop > -0.05 && d[dr].stop < 0.09, `v ${f3(d[dr].stop)} m/s after ${f2(d[dr].t)} s`);
  }
  check('braking: FWD and RWD within 5% (drivetrain barely matters)', Math.abs(d.fwd.dist - d.rwd.dist) < 0.05 * d.fwd.dist);
}

// ------------------------------------------------------------------ 6. reverse and parking-speed manoeuvres
for (const dr of ['fwd', 'rwd']) {
  const v = mk({ drive: dr, tc: 0.5, esc: 0.4 }); v.reset(0, 0, 0);
  for (let i = 0; i < 30; i++) v.update(DT, { throttle: 0, brake: 1, steer: 0 });
  const rev = v.reverse;
  let maxBack = 0, maxBeta = 0, signOk = true, wOk = true;
  for (let i = 0; i < 300; i++) {
    v.update(DT, { throttle: 0, brake: 1, steer: 0.6 });
    maxBack = Math.max(maxBack, -v.vLong);
    if (Math.abs(v.vLong) > 1) { maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong)))); const wk = v.vLong * Math.tan(v.steer) / v.wb; if (Math.sign(v.w) !== Math.sign(wk)) signOk = false; if (Math.abs(v.w) > Math.abs(wk) * 1.5 + 0.05) wOk = false; }
  }
  check(`reverse ${dr}: engages from standstill on the brake pedal`, rev);
  check(`reverse ${dr}: speed capped (~25 km/h) and moving backwards`, maxBack > 3 && maxBack < 8, `${f1(maxBack * 3.6)} km/h`);
  // kinematic body slip alone is atan(b tan(delta) / wb) ~ 0.2 rad at this lock, so allow 0.35
  check(`reverse ${dr}: yaw follows steering kinematics, no snap`, signOk && wOk && maxBeta < 0.35 && finite(v), `max beta ${f1(maxBeta * 57.3)} deg`);
  // full-lock parking turn forwards at walking pace
  const p = mk({ drive: dr }); p.reset(0, 0, 0); let ok = true;
  for (let i = 0; i < 300; i++) { p.update(DT, { throttle: 0.12, brake: 0, steer: 1 }); if (!finite(p) || Math.abs(p.vLat) > 1) ok = false; }
  check(`parking ${dr}: full-lock crawl is stable`, ok, `v ${f1(p.kmh)} km/h, R ${f1(Math.abs(p.vLong / (p.w || 1e-9)))} m`);
}

// ------------------------------------------------------------------ 7. engine braking direction
{
  const v = mk({ drive: 'rwd' }); v.reset(0, 0, -2); v.gear = 1; (v.corners || v.wheel).forEach((c) => (c.vw = -2));
  let maxBack = 2;
  for (let i = 0; i < 120; i++) { v.update(DT, { throttle: 0, brake: 0, steer: 0 }); maxBack = Math.max(maxBack, -v.vLong); }
  check('engine braking never pushes a car rolling backwards in a forward gear faster', maxBack <= 2.0001, `peak ${f2(maxBack)} m/s`);
  const c = mk({ drive: 'fwd' }); c.reset(0, 0, 80 / 3.6); c.gear = 3; const v0 = c.vLong;
  for (let i = 0; i < 60; i++) c.update(DT, { throttle: 0, brake: 0, steer: 0 });
  const decel = (v0 - c.vLong) / 1;
  check('engine braking: coasting in 3rd decelerates moderately (0.05-0.35 g)', decel > 0.05 * 9.81 && decel < 0.35 * 9.81, `${f2(decel / 9.81)} g`);
}

// ------------------------------------------------------------------ 8. time-step convergence
{
  const script = (t) => ({ throttle: t < 4 ? 1 : t < 6 ? 0.4 : 0, brake: t > 7 ? 0.8 : 0, steer: t > 3 && t < 7 ? 0.25 * Math.sin((t - 3) * 1.2) : 0 });
  for (const dr of ['fwd', 'rwd']) {
    const out = [];
    for (const fdt of [1 / 30, 1 / 60, 1 / 144, 1 / 240]) {
      const v = mk({ drive: dr, tc: 0.5, esc: 0.4, edl: 0.5 }); v.reset(0, 0, 5);
      let t = 0, ok = true;
      while (t < 9) { v.update(fdt, script(t)); t += fdt; if (!finite(v)) { ok = false; break; } }
      out.push({ fdt, x: v.x, z: v.z, yaw: v.yaw, ok });
    }
    const ref = out[3];
    const dev = Math.max(...out.map((o) => Math.hypot(o.x - ref.x, o.z - ref.z)));
    const dyaw = Math.max(...out.map((o) => Math.abs(o.yaw - ref.yaw)));
    const path = Math.hypot(ref.x, ref.z);
    check(`time step ${dr}: 30/60/144/240 Hz frames agree`, out.every((o) => o.ok) && dev < 0.02 * path && dyaw < 0.05, `max pos dev ${f2(dev)} m over ${f1(path)} m, yaw dev ${f3(dyaw)} rad`);
  }
}

// ------------------------------------------------------------------ 9. wheel speeds for the meshes
{
  const v = mk({ drive: 'fwd' }); v.reset(0, 0, 25);
  for (let i = 0; i < 60; i++) v.update(DT, { throttle: 0.3, brake: 0, steer: 0 });
  check('wheel[0].vw / wheel[1].vw track road speed when rolling', Math.abs(v.wheel[0].vw - v.vLong) < 0.6 && Math.abs(v.wheel[1].vw - v.vLong) < 0.3, `front ${f2(v.wheel[0].vw)} rear ${f2(v.wheel[1].vw)} car ${f2(v.vLong)}`);
}

{
  // an outside velocity change (crash) resyncs each wheel to ITS free-rolling speed (yaw rate x lever arm, steer):
  // no slip spike on any corner afterwards
  const v = mk({ drive: 'rwd' }); v.reset(0, 0, 15); v.gear = 2;
  for (let i = 0; i < 120; i++) v.update(DT, { throttle: 0.15, brake: 0, steer: 0.5 });
  v.vLong -= 4;
  v.update(1 / 2000, { throttle: 0.15, brake: 0, steer: 0.5 }); // one tiny substep: before the tyres can repair it
  const sxMax = Math.max(...v.corners.map((c) => Math.abs(c.sx)));
  const spreadR = v.corners[2].vw - v.corners[3].vw, expR = -v.w * (v.cy[2] - v.cy[3]);
  check('wheel resync after an impact: per-corner rolling speed, no slip spike', sxMax < 0.03 && Math.abs(spreadR - expR) < 0.15,
    `max |sx| ${f3(sxMax)}, rear L-R ${f3(spreadR)} vs yaw ${f3(expR)}`);
}

// ------------------------------------------------------------------ 10. damage
if (!Vehicle.prototype.addDamage) check('damage: Vehicle.addDamage exists', false);
else {
  const v = mk({ drive: 'fwd' }); v.reset(0, 0, 0);
  check('damage: separating contact (dv <= 0) does nothing', v.addDamage('front', -5, { kind: 'bump' }) === 0 && v.addDamage('front', 0, {}) === 0 && v.damage.front === 0);
  check('damage: bumper absorbs a 7 km/h tap', v.addDamage('front', 2.0, { kind: 'wall' }) === 0);
  const a = mk({ drive: 'fwd' }), b = mk({ drive: 'fwd' });
  a.addDamage('front', 10, { kind: 'wall' }); b.addDamage('front', 20, { kind: 'crash', car: { mass: BASE.mass } });
  check('damage: equal-mass car at 2 dv equals a barrier at dv (EBS = dv / 2)', Math.abs(a.damage.front - b.damage.front) < 1e-9, `${f3(a.damage.front)} vs ${f3(b.damage.front)}`);
  const h = mk({ drive: 'fwd' }); h.addDamage('front', 20, { kind: 'crash', car: { mass: 15000 }, heavy: true });
  check('damage: a lorry hurts more than a car at the same closing speed', h.damage.front > b.damage.front);
  const w = mk({ drive: 'fwd' }); w.addDamage('front', 85 / 3.6, { kind: 'wall' });
  check('damage: heavy frontal crash -> crush and cooling damage, gradual power loss before steam', w.damage.front === 1 && w.radiatorDamage > 0.3 && !w.smoke && w.engHealth > 0.3 && w.engHealth < 0.7, `engHealth ${f2(w.engHealth)}`);
  let steamPeak = 0; for (let i = 0; i < 600; i++) { w.damageFx(DT); steamPeak = Math.max(steamPeak, w.steamAmount); }
  check('damage: ruptured cooling system heats gradually with no immediate white plume', w.coolantTemp > 90 && w.coolantTemp < 104 && !w.smoke && steamPeak === 0, `coolant ${f1(w.coolantTemp)} C`);
  const s = mk({ drive: 'fwd' }); s.reset(0, 0, 25); s.addDamage('front', 70 / 3.6, { kind: 'wall', localPoint: { x: -s.track / 2, y: .4, z: -s.a } });
  for (let i = 0; i < 300; i++) s.update(DT, { throttle: 0.3, brake: 0, steer: 0 });
  const c = mk({ drive: 'fwd' }); c.reset(0, 0, 25);
  for (let i = 0; i < 300; i++) c.update(DT, { throttle: 0.3, brake: 0, steer: 0 });
  check('damage: a large off-centre frontal hit pulls towards its struck wheel', s.x < -0.5 && Math.abs(c.x) < 0.05, `drift damaged ${f2(s.x)} m, clean ${f3(c.x)} m in 5 s`);
  // in-gear 80-130 km/h (not traction limited, so it isolates the engine loss)
  const pull = (wreck) => { const q = mk({ drive: 'rwd' }); q.reset(0, 0, 80 / 3.6); q.gear = 4; if (wreck) q.addDamage('front', 85 / 3.6, { kind: 'wall' }); let t = 0; while (q.kmh < 130 && t < 30) { q.update(DT, { throttle: 1, brake: 0, steer: 0 }); t += DT; } return t; };
  const before = pull(false), after = pull(true);
  check('damage: serious frontal substantially slows acceleration while car remains driveable', after > before * 1.25 && after < before * 3, `80-130 ${f2(before)} -> ${f2(after)} s`);
  w.reset(0, 0, 0);
  check('damage: reset() repairs the car', w.damage.front === 0 && !w.smoke && w.engHealth === 1);
  // traffic.js events carry sev = closing speed and dv = this car's |delta-v| from the impulse. Reproduce its
  // impulse for a centred head-on between equal cars (restitution 0.15, as traffic.collide uses):
  //   j = (1 + e) vc / (1/m1 + 1/m2), dv = j / m1 = vc (1 + e) / 2
  {
    const m = BASE.mass, rest = 0.15, vc = 20, j = (1 + rest) * vc / (1 / m + 1 / m), dvA = j / m;
    const ev = { kind: 'crash', sev: vc, zone: 'front', dv: dvA, car: { mass: m }, dvCar: j / m };
    const t = mk({}), ref = mk({});
    t.addDamage(ev.zone, ev.dv, ev);                 // exactly how main.js forwards it
    ref.addDamage('front', vc / 2, { kind: 'wall' }); // equal cars: EBS = vc / 2
    check('damage: traffic event is sized by closing speed e.sev, not the impulse delta-v e.dv', Math.abs(t.damage.front - ref.damage.front) < 1e-9 && t.lastDamage.ebs === vc / 2,
      `sev ${vc} dv ${f2(dvA)} -> EBS ${f2(t.lastDamage?.ebs)} (dv-as-closing would give ${f2(dvA / 2)})`);
    const sepA = mk({}), sepB = mk({});
    const a0 = sepA.addDamage('front', dvA, { ...ev, sev: 0 });      // separating / resting: impulse() reports vn 0
    const b0 = sepB.addDamage('front', 0, { ...ev });                 // no impulse acted (j <= 0)
    const c0 = sepB.addDamage('front', dvA, { ...ev, sev: -3 });
    check('damage: separating or impulse-free traffic contact does nothing', a0 === 0 && b0 === 0 && c0 === 0 && sepA.damage.front === 0 && sepB.damage.front === 0);
  }
  const d1 = mk({}), d2 = mk({}); for (const q of [d1, d2]) { q.addDamage('rear', 9, { kind: 'bump', car: { mass: 1200 } }); q.addDamage('right', 7, { kind: 'scrape' }); }
  check('damage: deterministic', JSON.stringify(d1.damage) === JSON.stringify(d2.damage));
}

// ------------------------------------------------------------------ 11. catalogue cars: sanity only (tuning-tolerant)
{
  let CARS = [];
  try {
    const src = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
    const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
    let depth = 0, end = 0;
    for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
    CARS = new Function('return ' + arr.slice(0, end))();
  } catch (err) { check('catalogue: parse src/cars.js', false, err.message); }
  for (const spec of CARS) {
    if(spec.torqueCurve){
      const engine=new Vehicle(spec,route);engine.boost=1;
      const torque=engine.torqueMax(spec.peakTorqueRpm),power=engine.torqueMax(spec.peakPowerRpm)*spec.peakPowerRpm*Math.PI/30/1000;
      check(`catalogue ${spec.id}: sourced torque and power anchors`,Math.abs(torque-spec.torque)<.2&&Math.abs(power-spec.power)<.1,`${f1(torque)} Nm, ${f1(power)} kW`);
      check(`catalogue ${spec.id}: curve rpm strictly ascending`,spec.torqueCurve.every((p,i)=>p[1]>=0&&(!i||p[0]>spec.torqueCurve[i-1][0])));
    }
    if(spec.drive==='awd'){
      const awd=new Vehicle(spec,route);awd.reset(0,0,12);awd.gear=2;
      for(let i=0;i<90;i++)awd.update(DT,{throttle:1,brake:0,steer:0});
      check(`catalogue ${spec.id}: both axles transmit drive torque`,awd.shareR===spec.awdRear&&awd.corners[0].Fx+awd.corners[1].Fx>100&&awd.corners[2].Fx+awd.corners[3].Fx>100);
    }
    if(spec.engineZone==='rear'){
      const rear=new Vehicle(spec,route),front=new Vehicle(spec,route);rear.addDamage('rear',16,{kind:'wall'});front.addDamage('front',16,{kind:'wall'});
      check(`catalogue ${spec.id}: rear-engine cars still isolate cosmetic rear hits from frontal mechanical damage`,rear.engHealth===1&&front.engHealth<1&&front.radiatorDamage===0&&!front.smoke);
    }
    const v = new Vehicle(spec, route); v.reset(0, 0, 0); let t = 0, t100 = null, ok = true;
    while (t < 60) { v.update(DT, { throttle: 1, brake: 0, steer: 0 }); t += DT; if (!t100 && v.kmh >= 100) t100 = t; if (!finite(v)) { ok = false; break; } }
    const b = new Vehicle(spec, route); b.reset(0, 0, 100 / 3.6); const z0 = b.z;
    for (let i = 0; i < 900 && b.kmh > 0.3; i++) b.update(DT, { throttle: 0, brake: 1, steer: 0 });
    const bd = Math.abs(b.z - z0);
    check(`catalogue ${spec.id} (${spec.drive}): finite, plausible acceleration, top near vmax, 100-0 28-50 m`, ok && t100 > (spec.zeroTo100 ? spec.zeroTo100*.70 : 3) && t100 < (spec.zeroTo100 ? spec.zeroTo100*1.40 : 14) && v.kmh > spec.vmax * 0.85 && v.kmh < spec.vmax * 1.05 && bd > 28 && bd < 50,
      `0-100 ${t100 && f2(t100)} s, top ${f1(v.kmh)} / ${spec.vmax}, 100-0 ${f1(bd)} m, wb ${v.wb} halfL ${v.halfL} halfW ${v.halfW}`);
  }
}

// Playtest 3: neutral steering stability, progressive power breakaway and driver recovery.
{
  const { stabilityScenarios } = await import('./stability.mjs');
  for (const r of stabilityScenarios()) {
    const label = `${r.car} ${r.wet ? 'wet' : 'dry'} TC ${r.aids ? 'on' : 'off'}`;
    if (r.scenario === 'straight') check(`straight stability: ${label}`, r.peakBeta < 1 && Math.abs(r.finalBeta) < 0.1 && r.heading < 0.5 && r.offset < 1 && (r.aids || r.cut === 0),
      `peak ${f2(r.peakBeta)} deg, heading ${f2(r.heading)} deg, offset ${f2(r.offset)} m`);
    if (r.scenario === 'recovery') {
      const limit = r.aids ? 15 : r.car === 'huracan' ? 20 : r.wet ? 55 : 30;
      check(`power/lift/countersteer recovery: ${label}`, r.peakBeta < limit && Math.abs(r.finalBeta) < 1 && r.latch === 0 && r.kmh > 30 && (r.aids || r.cut === 0),
        `peak ${f1(r.peakBeta)} deg, final ${f2(r.finalBeta)} deg, latch ${f2(r.latch)}, exit ${f1(r.kmh)} km/h`);
    }
    if (r.scenario === 'uturn') check(`walking-speed U-turn/unwind: ${label}`, r.turn >= 180 && r.turn < 215 && Math.abs(r.yawRate) < 0.1 && Math.abs(r.finalBeta) < 1 && r.latch === 0,
      `turn ${f1(r.turn)} deg, final yaw rate ${f3(r.yawRate)}`);
    if (r.scenario === 'halfBrake' && r.car === 'carrera') check(`911 half-pedal braking authority: ${label}`, r.distance < 54 && r.kmh < 0.3, `100-0 ${f1(r.distance)} m`);
    if (r.scenario === 'brake') check(`catalogue braking in ${label}`, r.distance < (r.wet ? 55 : 40) && r.kmh < 0.3,
      `100-0 ${f1(r.distance)} m`);
  }
}
// Exercise recovery on every real road, both race directions, including tunnel axes and narrow circuits.
{
  const { Route } = await import('../../src/map.js');
  const { MAPS } = await import('../../src/map-catalog.js');
  const { RIVIERA_TUNNELS } = await import('../../src/maps/riviera-tunnels.js');
  const { roadRecoveryPose } = await import('../../src/road-recovery.js');
  for (const def of MAPS) {
    const data = JSON.parse(readFileSync(new URL('../../' + def.dataUrl, import.meta.url)));
    const road = new Route(data.route, { corridors: def.id === 'riviera' ? RIVIERA_TUNNELS : [] });
    let count=0, bad=0, worst=0;
    for (let s=0; s<road.length; s+=73) for (const dir of [-1,1]) for (const side of [-1,1]) {
      const p=road.point(s,side*(road.edge(s)+12));
      const pose=roadRecoveryPose(road,{...p,s:s-200},dir);
      const v=new Vehicle({...BASE,drive:'rwd'},road);v.reset(pose.s,pose.u);v.yaw=pose.yaw;
      const f=road.contactFrame(pose.s,pose.u,{}),dot=(-Math.sin(v.yaw)*f.tx-Math.cos(v.yaw)*f.tz)*dir;
      const edge=road.edge(pose.s),median=road.closed?0:road.medHalf(pose.s);
      worst=Math.max(worst,Math.abs(Math.abs(pose.u)-(road.closed?0:(edge+median)/2)));
      if (!finite(v) || Math.abs(pose.u)+v.halfW>edge || !road.closed && Math.abs(pose.u)-v.halfW<median || dot<.999) bad++;
      const anchored=roadRecoveryPose(road,p,dir,s);if(Math.abs(anchored.s-s)>1e-9)bad++;
      count++;
    }
    check(`reset placement ${def.id}: road centreline, whole car on road, race direction, server anchor retained`, bad===0 && worst<1e-9, `${count} off-road samples, ${bad} invalid`);
  }
}

console.log(results.join('\n'));
console.log(`\n${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
