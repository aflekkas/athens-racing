// Real Vehicle integration with flat CPU fixture; no renderer or fabricated tyre dynamics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Vehicle } from '../../src/physics.js';
import { ENGINE_ABUSE, predictedGearRpm, updateMechanicalOverrev } from '../../src/engine-abuse.js';
const evidence = {};
const catalogueSource = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const cars = Function('return ' + catalogueSource.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const route = { GR: null, frame: (s, o) => Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }), point: (s, u) => ({ x: u, z: -s, y: 0 }), y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project: (x, z) => ({ s: -z, u: x }) };
const coast = { throttle: 0, brake: 0, steer: 0 };
function mk(id = 'mini', kmh = 0, gear = 2, player = true) {
  const v = new Vehicle(cars.find(c => c.id === id), route);
  if (player) v.setManual(true); else v.setManual(true, { ai: true });
  v.reset(0, 0, kmh / 3.6); v.gear = gear; v.syncWheels(); v.rpm = predictedGearRpm(v, gear);
  return v;
}
function run(v, seconds, input = coast) { for (let i = 0; i < Math.ceil(seconds * 60); i++) v.update(1 / 60, input); }
function thermal(v, seconds, { rpm = v.spec.redline, pedal = 1, speed = 0 } = {}) {
  v.rpm = rpm; v.engineThrottle = pedal; v.vLong = speed;
  let peak = v.coolantTemp;
  for (let i = 0; i < Math.ceil(seconds * 20); i++) { v.damageFx(0.05); peak = Math.max(peak, v.coolantTemp); }
  return peak;
}

test('catalogue reproduction: no fixed 4000rpm lock; driven-wheel prediction decides automatic protection', () => {
  const mini = mk('mini', 60), taxi = mk('taxi', 60);
  assert.ok(Math.abs(predictedGearRpm(mini, 1) - 7087.83) < 1);
  assert.ok(Math.abs(predictedGearRpm(taxi, 1) - 7346.75) < 1);
  const v = mk('mini', 0, 3), wheel = 4000 * 2 * Math.PI / 60 * v.spec.wheelR / v.ratio(3);
  for (const c of v.corners) c.vw = wheel;
  assert.ok(predictedGearRpm(v, 2) < v.spec.redline);
  assert.equal(v.shiftManual(-1), true); assert.equal(v.shiftFeedback.unsafe, false);
  evidence.calibration = { miniFirstAt60Rpm: predictedGearRpm(mini, 1), miniRedline: mini.spec.redline, taxiFirstAt60Rpm: predictedGearRpm(taxi, 1), taxiRedline: taxi.spec.redline, miniThirdAt4000ToSecondRpm: predictedGearRpm(v, 2) };
});

test('MINI first at 60kmh is selectable: small overshoot grace, real engagement and no silent high-gear lock', () => {
  const v = mk('mini', 60); assert.equal(v.shiftManual(-1), true);
  assert.equal(v.engineDamage, 0, 'button press cannot damage an unengaged engine');
  assert.equal(v.shiftFeedback.reason, 'mechanical_overrev'); assert.equal(v.shiftFeedback.unsafe, true);
  run(v, (v.powertrain?.shiftTime ?? .2) + .1); assert.equal(v.gear, 1); assert.equal(v.engineDamage, 0); assert.equal(v.engineStalled, false);
  v.reset(0, 0, 5); v.gear = 6; v.syncWheels();
  for (let g = 5; g >= 1; g--) { assert.equal(v.shiftManual(-1), true); run(v, 0.8); assert.equal(v.gear, g); }
});

test('a money shift can damage and destroy the engine, remains finite and reports failure', () => {
  const v = mk('mini', 110), predicted = predictedGearRpm(v, 1);
  assert.equal(v.shiftManual(-1), true); assert.equal(v.engineDamage, 0);
  run(v, (v.powertrain?.shiftTime ?? .2) + .1); assert.equal(v.gear, 1); assert.ok(v.engineDamage > 0.9);
  assert.equal(v.engineStalled, true); assert.equal(v.engHealth, 0);
  assert.equal(v.engineFailureReason, 'mechanical_overrev');
  assert.ok(v.rpm <= v.spec.redline * ENGINE_ABUSE.displayRatio);
  assert.ok([v.x, v.z, v.vLong, v.vLat, v.rpm, v.engineDamage, v.coolantTemp].every(Number.isFinite));
  assert.ok(predicted > v.spec.redline * 1.8);
  evidence.moneyShift = { predictedRpm: predicted, actualGear: v.gear, engineDamage: v.engineDamage, engHealth: v.engHealth, engineFailureReason: v.engineFailureReason, shiftFeedback: v.shiftFeedback };
});

test('one shift applies engagement shock once; subsequent wear is time-based and stops with the clutch open', () => {
  const v = mk('golf_gtd', 75); assert.equal(v.shiftManual(-1), true);
  for (let i = 0; i < 120 && v.pendingGear; i++) v.update(1 / 240, coast);
  assert.equal(v.pendingGear, 0);
  const shock = v.engineDamage; assert.ok(shock > 0.1);
  v.update(1 / 240, coast); const wear = v.engineDamage - shock;
  assert.ok(wear >= 0 && wear < 0.01, 'the engagement shock must not repeat every physics substep');
  assert.equal(v._unsafeShift, null);
  const paused = v.engineDamage; updateMechanicalOverrev(v, 1 / 240, predictedGearRpm(v, 1), false);
  assert.equal(v.engineDamage, paused);
});

test('moderate abuse impairs torque but can be escaped by upshifting; shift-time braking avoids damage', () => {
  const v = mk('golf_gtd', 65); assert.equal(v.shiftManual(-1), true); run(v, (v.powertrain?.shiftTime ?? .2) + .1);
  assert.ok(v.engineDamage > 0 && v.engineDamage < 1); assert.ok(v.engHealth > 0 && v.engHealth < 1);
  run(v, 0.6); assert.equal(v.shiftManual(1), true); run(v, 0.5);
  const damage = v.engineDamage; run(v, 1); assert.equal(v.engineDamage, damage);
  const avoiding = mk('mini', 110); assert.equal(avoiding.shiftManual(-1), true);
  avoiding.vLong = 0; avoiding.syncWheels(); run(avoiding, (avoiding.powertrain?.shiftTime ?? .2) + .1);
  assert.equal(avoiding.engineDamage, 0, 'damage uses actual RPM at engagement rather than request RPM');
});

test('a safe request that becomes unsafe during the shift reports the original gear and actual engagement RPM', () => {
  const v = mk('mini', 50); assert.equal(v.shiftManual(-1), true); assert.equal(v.shiftFeedback.unsafe, false);
  v.vLong = 100 / 3.6; v.syncWheels(); run(v, (v.powertrain?.shiftTime ?? .2) + .1);
  assert.equal(v.shiftFeedback.reason, 'mechanical_overrev'); assert.equal(v.shiftFeedback.unsafe, true);
  assert.equal(v.shiftFeedback.from, 2); assert.equal(v.shiftFeedback.to, 1);
  assert.ok(v.shiftFeedback.predictedRpm > v.spec.redline); assert.ok(v.engineDamage > 0);
});

test('cooldown/bounds/reverse explain themselves; auto paddles reject only the unsafe target', () => {
  const v = mk('mini', 60);
  assert.equal(v.shiftManual(-1), true); const serial = v.shiftFeedback.serial;
  assert.equal(v.shiftManual(-1), false); assert.equal(v.shiftFeedback.reason, 'cooldown');
  assert.ok(v.shiftFeedback.serial > serial); run(v, 0.8);
  assert.equal(v.shiftManual(-1), false); assert.equal(v.shiftFeedback.reason, 'bounds');
  v.reverse = true; assert.equal(v.shiftManual(1), false); assert.equal(v.shiftFeedback.reason, 'reverse');
  v.reset(0, 0, 0); v.gear = 2;
  assert.equal(v.shiftManual(NaN), false); assert.equal(v.shiftFeedback.reason, 'bounds'); assert.equal(v.gear, 2);
  const auto = mk('superb', 100); auto.setManual(false); assert.equal(auto.manual, false);
  assert.equal(auto.shiftManual(-1), false); assert.equal(auto.shiftFeedback.reason, 'overrev_protection');
  auto.reset(0, 0, 8); auto.gear = 2; auto.syncWheels(); assert.equal(auto.shiftManual(-1), true);
  const choice = new Vehicle(v.spec, route);
  assert.equal(choice.shiftManual(1), true); assert.equal(choice.manual, false);
  assert.equal(choice.autoOverride, 3);
});

test('brief ordinary limiter use has no mechanical damage; sustained low-airflow abuse overheats', () => {
  const ordinary = mk('mini', 60, 1); run(ordinary, 15, { throttle: 1, brake: 0, steer: 0 });
  assert.equal(ordinary.gear, 1); assert.equal(ordinary.engineDamage, 0); assert.equal(ordinary.engineStalled, false);
  const normal = mk('mini', 0, 1); thermal(normal, 10);
  assert.equal(normal.engineDamage, 0); assert.equal(normal.engineStalled, false); assert.equal(normal.engHealth, 1);
  const hot = mk('mini', 0, 1); const peak = thermal(hot, 180);
  assert.ok(peak >= 142); assert.equal(hot.engineFailureReason, 'overheating');
  assert.equal(hot.engineStalled, true); assert.equal(hot.engHealth, 0);
  evidence.thermal = { peakCelsius: peak, afterCoolingCelsius: hot.coolantTemp, failed: hot.engineStalled, reason: hot.engineFailureReason };
  const moving = mk('mini', 0, 1); thermal(moving, 60, { speed: 30 });
  assert.ok(moving.coolantTemp < peak); assert.equal(moving.engineStalled, false);
});

test('easing off and airflow cool the engine; heat impairment recovers but mechanical wear remains', () => {
  const v = mk('mini'); v.coolantTemp = 120; v.engineDamage = 0.2; v.damageFx(); const weak = v.engHealth;
  thermal(v, 90, { rpm: v.spec.idle, pedal: 0, speed: 30 });
  assert.ok(v.coolantTemp < 92); assert.equal(v.engineDamage, 0.2); assert.ok(v.engHealth > weak);
  assert.ok(Math.abs(v.engHealth - 0.8) < 0.01);
});

test('tow/reset clears every abuse consequence and pending shift feedback without changing manual policy', () => {
  const v = mk('mini', 110); v.shiftManual(-1); run(v, (v.powertrain?.shiftTime ?? .2) + .1); const serial = v.shiftFeedback.serial;
  v.radiatorDamage = 1; v.drivetrainBroken = true; v.coolantTemp = 145; v.reset(80, 2, 0);
  assert.equal(v.manual, true); assert.equal(v.engineDamage, 0); assert.equal(v.engineStalled, false);
  assert.equal(v.engineFailureReason, null); assert.equal(v.drivetrainBroken, false); assert.equal(v.coolantTemp, 90);
  assert.equal(v.engHealth, 1); assert.equal(v.radiatorDamage, 0); assert.equal(v.shiftFeedback, null);
  assert.equal(v.mechanicalOverrevRpm, 0); assert.equal(v.shiftManual(1), true); assert.ok(v.shiftFeedback.serial > serial);
});

test('AI and automatic retain clean cooling and never gain manual abuse wear', () => {
  for (const v of [mk('mini', 0, 1, false), mk('z4', 0, 1)]) {
    if (v.spec.id === 'z4') v.setManual(false);
    thermal(v, 180); assert.equal(v.coolantTemp, 90); assert.equal(v.engineDamage, 0); assert.equal(v.engHealth, 1);
    run(v, 6, { throttle: 1, brake: 0, steer: 0 }); assert.equal(v.engineDamage, 0); assert.ok(v.gear > 1);
  }
});

test.after(() => { mkdirSync('.scratch/gearbox-abuse-v2', { recursive: true }); writeFileSync('.scratch/gearbox-abuse-v2/engine-proof.json', JSON.stringify(evidence, null, 2)); });
