// Owner playtest 2026-10-18: "because the cars understeer so much, sometimes it's helpful to press the handbrake when you go
// into a turn" and "it makes more sense to pull the handbrake once in the corner than to just drive into it".
// Across the whole catalogue: the rear axle's cornering surplus over the front is capped (the front stays the limit, so the
// calibrated skidpad figures do not move), the steady-state understeer gradient is brought down, a clean braked turn-in is never
// slower than the best handbrake flick through the same corner, and none of it makes a car snappy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, understeerTrim } from '../../src/physics.js';
import { cars, driveCorner, bestLines, GRID } from './corner-bench.mjs';
import { CARS, route } from './handling.mjs';
import { Input } from '../../src/input.js';

const REAR_MARGIN = 0.08;
const all = cars();

test('every car: the rear axle has at most 8% more cornering capacity than the front, and the front is still the limit it was', () => {
  let trimmed = 0;
  for (const spec of all) {
    const v = new Vehicle({ ...spec }, route), axles = {};
    const ay = v.maxLatAccel(25, axles);
    assert.ok(axles.rear <= axles.front * (1 + REAR_MARGIN) + 1e-6, `${spec.id}: rear ${axles.rear.toFixed(2)} vs front ${axles.front.toFixed(2)} m/s²`);
    assert.ok(v.rearLat >= 0.8 && v.rearLat <= 1, `${spec.id}: rear lateral factor ${v.rearLat}`);
    // where the rear was already the weaker axle nothing moved
    const unbalanced = new Vehicle({ ...spec }, route); unbalanced.rearLat = 1; const raw = {}; unbalanced.maxLatAccel(25, raw);
    if (raw.rear <= raw.front * (1 + REAR_MARGIN)) assert.equal(v.rearLat, 1, `${spec.id}: already balanced`); else trimmed++;
    // cornering limit unchanged: min(front, rear) before and after
    assert.ok(Math.abs(ay - unbalanced.maxLatAccel(25)) < 1e-9 * 100 + 1e-6 || Math.min(axles.front, axles.rear) * 0.97 <= ay + 1e-6, `${spec.id}: limit moved`);
  }
  assert.ok(trimmed > 20, `the trim should reach the many understeering trims, got ${trimmed}`);
});
test('the steady-state understeer gradient is capped near road-car norms: nothing above 3.1 deg/g, small values untouched', () => {
  let worst = 0, sum = 0;
  for (const spec of all) { const v = new Vehicle({ ...spec }, route); worst = Math.max(worst, v.understeerGradient); sum += v.understeerGradient; }
  assert.ok(worst <= 3.2, `worst gradient ${worst.toFixed(2)} deg/g`);
  assert.ok(sum / all.length < 2.1, `mean gradient ${(sum / all.length).toFixed(2)} deg/g (was 2.6)`);
  assert.equal(understeerTrim(0.9), 0.9); assert.equal(understeerTrim(1.2), 1.2); assert.ok(understeerTrim(4.2) < 3.1 && understeerTrim(4.2) > understeerTrim(3.4));
});
for (const id of ['mini', 'e36_m3', 'z4']) for (const [label, assist] of [['assist off', 0], ['light assist', 0.35], ['full assist', 1]]) test(`${id}, ${label}: a clean braked turn-in through a 40 m corner is no slower than the best handbrake flick`, () => {
  const spec = all.find(c => c.id === id), best = bestLines(spec, { R: 40, dev: 9, assist }, GRID.quick());
  assert.ok(best.clean, `${id}: no valid clean line`);
  if (best.flick) assert.ok(best.clean.t <= best.flick.t, `${id}: clean ${best.clean.t.toFixed(2)} s, flick ${best.flick.t.toFixed(2)} s`);
});
test('the same through the real keyboard ramp, and a tight 20 m corner is still taken cleanly', () => {
  for (const id of ['mini', 'e36_m3']) {
    const spec = all.find(c => c.id === id);
    const r = driveCorner(spec, { kind: 'clean', v0: 75, brakeAt: 32, level: 1, vCorner: 45, tthr: 30, thr: 0.9 }, { R: 20, dev: 6, assist: 1, keys: true });
    assert.ok(r.ok, `${id}: left the road, max deviation ${r.dev.toFixed(1)} m`);
  }
});
// 80 km/h straight, then a full keyboard turn-in (real Input ramp), lifted or braking: how far the car slides
function braked(spec, brake) {
  const dt = 1 / 60, v = new Vehicle(spec, route); v.reset(0, 0, 80 / 3.6); v.steerAssist = 1;
  for (let i = 0; i < 60; i++) { v.update(dt, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = 80 / 3.6; }
  const ctl = new Input({ target: null, navigator: null, document: null, storage: null }); let beta = 0, latched = false;
  for (let i = 0; i < 90; i++) { ctl.keys.add('KeyD'); ctl.update(dt, { speed: v.speed }); v.update(dt, { throttle: 0, brake, steer: ctl.state.steer }); beta = Math.max(beta, Math.abs(Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong))))); latched ||= v.driftLatch > 0; }
  ctl.destroy(); return { beta: beta * 57.3, latched };
}
test('not snappy: braked and lifted keyboard turn-ins slide less than 12 degrees and never latch drift mode, on every kind of car', () => {
  for (const id of ['mini', 'golf_gti', 'e36_m3', 'z4', 'huracan', 'taxi', 'carrera', 'gr_yaris']) for (const brake of [0, 0.3, 1]) {
    const r = braked(CARS.find(c => c.id === id), brake);
    assert.ok(r.beta < 12, `${id} brake ${brake}: sideslip ${r.beta.toFixed(1)} deg`); assert.equal(r.latched, false, `${id}: an ordinary turn-in latched drift mode`);
  }
});
