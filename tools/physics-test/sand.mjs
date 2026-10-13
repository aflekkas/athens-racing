// Stuck-in-the-sand scenarios: node --import ./tools/physics-test/register.mjs tools/physics-test/sand.mjs [carId]
// A stub ground puts every wheel on soft beach sand (SURF.sand), optionally on a slope up towards the road, and
// replays what a player does: drive gently, floor it and dig in, rock it back out.
import { readFileSync } from 'node:fs';
const { Vehicle } = await import('../../src/physics.js');
const src = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
const CARS = new Function('return ' + arr.slice(0, end))();
const gsrc = readFileSync(new URL('../../src/ground.js', import.meta.url), 'utf8');
const SAND = new Function('return ' + gsrc.match(/sand: (\{[^}]*\})/)[1])();
const DEEP = new Function('return ' + gsrc.match(/deepsand: (\{[^}]*\})/)[1])();

const route = {
  GR: null, frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); },
  point(s, u) { return { x: u, z: -s, y: 0 }; }, y: () => 0, surfaceY: () => 0, urban: () => 0, edge: () => 900, lin: () => 0,
  project(x, z) { return { s: -z, u: x }; },
};
const sandGround = (slope, S = SAND) => ({ resolve(v) { v.s = -v.z; v.u = v.x; v.y = 0; v.grade = v.gradeG = slope; v.bank = 0; v.offroad = 1; v.surf = 'sand'; v.surfMu = S.mu; v.surfDrag = S.drag; v.surfRes = S.res; v.surfSoft = S.soft; v.surfBow = S.bow || 0; } });
const dt = 1 / 60;
const car = (spec, slope = 0, kmh = 0, S = SAND) => { const v = new Vehicle(spec, route); v.ground = sandGround(slope, S); v.reset(0, 0, kmh / 3.6); v.ground.resolve(v); return v; };
const run = (v, secs, inp) => { const s0 = -v.z; let maxDig = 0; for (let t = 0; t < secs; t += dt) { v.update(dt, typeof inp === 'function' ? inp(t, v) : inp); maxDig = Math.max(maxDig, v.dig); } return { d: -v.z - s0, kmh: v.vLong * 3.6, dig: v.dig, maxDig }; };
const GAS = (x) => ({ throttle: x, brake: 0, steer: 0 });
// keyboard pedals ramp like main.js readInput: W / S held or not
const pedals = { throttle: 0, brake: 0, steer: 0 };
const keys = (w, s) => { const p = pedals; p.throttle = w ? Math.min(1, p.throttle + dt * (p.throttle < 0.6 ? 6 : 3)) : Math.max(0, p.throttle - dt * 10); p.brake = s ? Math.min(1, p.brake + dt * (p.brake < 0.7 ? 7 : 3.5)) : Math.max(0, p.brake - dt * 12); return p; };
const f = (r) => `${r.d.toFixed(1)}m ${r.kmh.toFixed(0)}km/h dig ${r.dig.toFixed(2)}${r.maxDig > r.dig + 0.05 ? ' (max ' + r.maxDig.toFixed(2) + ')' : ''}`;
// a patient driver: feathers the throttle to keep the wheels just short of spinning
const feather = (t, v) => { const spin = v.wheelspin > 0.05; feather.x = Math.max(0.15, Math.min(0.8, (feather.x ?? 0.4) + (spin ? -1.5 : 0.4) * dt)); return GAS(feather.x); };
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('   FAIL: ' + msg); } };
const only = process.argv[2];
for (const spec of CARS) {
  if (only && spec.id !== only) continue;
  console.log(`${spec.id} (${spec.drive}, tc ${spec.tc ?? 0.5})`);
  // no traction control (the classic, or driver aids off): W held digs it in; the way out is a light foot (tapping S / W)
  const noAids = spec.tc === 0;
  const tapS = (t) => keys(false, (t % 0.5) < 0.2), tapW = (t) => keys((t % 0.5) < 0.2, false);
  // 1. arriving off the road at 50 km/h, lift: sand scrubs the speed off within a few car lengths
  { const v = car(spec, 0, 50); const r = run(v, 4, GAS(0)); console.log(`  coast in at 50, lift:     ${f(r)}`); check(r.kmh < 35, 'sand should scrub speed'); }
  // 2. feathered throttle from rest on flat sand: drives off without digging
  { feather.x = undefined; const v = car(spec); const r = run(v, 10, feather); console.log(`  feathered from rest:      ${f(r)}`); check(r.d > (noAids ? 10 : 15) && r.maxDig < 0.5, 'gentle throttle should drive on flat sand'); }
  // 3. W held from rest on flat sand: the wheels spin and dig, the car only crawls
  { pedals.throttle = pedals.brake = 0; const v = car(spec); const r = run(v, 8, () => keys(true, false)); console.log(`  W held 8 s, flat:         ${f(r)}`); if (!noAids) check(r.d > 3, 'spinning should still crawl on flat sand'); }
  // 4. W held from rest on a sandy bank rising 14% (SLOPE=) towards the road: STUCK, wheels spinning
  pedals.throttle = pedals.brake = 0;
  const v = car(spec, +(process.env.SLOPE || 0.14)); const r4 = run(v, 8, () => keys(true, false)); console.log(`  W held 8 s, steep slope:    ${f(r4)}`);
  const r5 = run(v, 6, () => keys(true, false)); console.log(`  ... W held 6 s more:      ${f(r5)}`);
  console.log(r4.d + r5.d < 3 ? '     -> STUCK (wheels spinning): the escape is below' : '     -> crawls up it');
  // 5. lift off: the sand holds the car on the slope, it doesn't roll back
  { const r = run(v, 3, () => keys(false, false)); console.log(`  lift 3 s on the slope:    ${f(r)}`); check(r.d > -0.3, 'sand should hold the car on a slope, not roll it back'); }
  // 6. S held: always backs out of the ruts, the way you came
  { const r = run(v, 4, () => keys(false, true)); console.log(`  S held 4 s (back out):    ${f(r)}`); check(r.d < -3, 'reverse should back out of the ruts'); }
  // 8. the sand traps (deepsand): W held from rest on the flat, then on the dune's bank (~35%)
  { pedals.throttle = pedals.brake = 0; const w = car(spec, 0, 0, DEEP); const r = run(w, 8, () => keys(true, false)); console.log(`  TRAP flat, W held 8 s:   ${f(r)}${r.d < 4 ? '  STUCK' : ''}`);
    w.vLong = 0;
    if (!noAids) { const b = run(w, 4, () => keys(false, true)); console.log(`  TRAP flat, S held 4 s:   ${f(b)}`); check(b.d < -2, 'reverse should back out of a sand trap'); }
    else { const c = run(w, 6, tapS); console.log(`  TRAP flat, tap S 6 s:    ${f(c)}`); const d = run(w, 8, tapW); console.log(`  TRAP flat, tap W 8 s:    ${f(d)}`); console.log(c.d < -1.5 && d.d > 3 ? '     -> rocked out' : '     -> dug in for good without TC: T for the tow'); } }
  { pedals.throttle = pedals.brake = 0; const w = car(spec, 0.35, 0, DEEP); const r = run(w, 6, () => keys(true, false)); console.log(`  DUNE bank, W held 6 s:   ${f(r)}${r.d < 2 ? '  STUCK' : ''}`); check(r.d < 3, 'nothing climbs a loose dune bank from rest');
    const b = run(w, 3, () => keys(false, true)); console.log(`  DUNE bank, S held 3 s:   ${f(b)}`); check(r.d + b.d < -2, 'ends up back down the bank'); }
  // 7. dug in on the flat, back out, then W held again: drives off
  { pedals.throttle = pedals.brake = 0; const w = car(spec); run(w, 6, () => keys(true, false)); w.vLong = 0; const dug = w.dig; run(w, 3, () => keys(false, true)); const r = run(w, 8, () => keys(true, false)); console.log(`  flat: dug ${dug.toFixed(2)}, S 3 s, W 8 s: ${f(r)}`); if (!noAids) check(r.d > 5, 'should drive off after backing out'); }
}
console.log(fails ? `${fails} FAILED` : 'all sand scenarios pass');
process.exitCode = fails ? 1 : 0;
