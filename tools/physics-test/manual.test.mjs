import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vehicle } from '../../src/physics.js';
const route = { GR: null, frame: (s, o) => Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }), point: (s, u) => ({ x: u, z: -s, y: 0 }), y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project: (x, z) => ({ s: -z, u: x }) };
const spec = { id: 'manual-test', mass: 1500, power: 250, torque: 500, redline: 7000, idle: 800, gears: [3.8, 2.4, 1.7, 1.3, 1.05, 0.85], final: 3.4, wheelR: 0.33, wheelbase: 2.6, length: 4.4, width: 1.85, cdA: 0.65, vmax: 250, grip: 1.1, steer: 0.6, brake: 1.05, body: 'test', frontW: 0.5, hcg: 0.5, track: 1.58, rsF: 0.55, susHz: 1.9, susZ: 0.5, alphaPk: 0.11, mfC: 1.5, tc: 0, esc: 0, edl: 0, lsd: 0, shiftT: 0.15, bias: 0.65, steerRate: 1, ebrake: 0.15, engine: 'turbo6', drive: 'rwd' };
const drive = { throttle: 1, brake: 0, steer: 0 };
const run = (v, n, input = drive) => { for (let i = 0; i < n; i++) v.update(1 / 60, input); };

test('manual shifts complete sequentially; reject bounds, cooldown and unsafe downshifts', () => {
  const v = new Vehicle({ ...spec, manual: true }, route); assert.equal(v.manual, true);
  assert.equal(v.shiftManual(-1), false); assert.equal(v.shiftManual(1), true); assert.equal(v.pendingGear, 2); assert.equal(v.shiftManual(1), false);
  run(v, 45, { throttle: 0, brake: 0, steer: 0 }); assert.equal(v.gear, 2);
  assert.equal(v.shiftManual(-1), true); run(v, 45); assert.equal(v.gear, 1);
  v.gear = spec.gears.length; assert.equal(v.shiftManual(1), false);
  v.reset(0, 0, 70); v.gear = 2; v.syncWheels(); assert.equal(v.shiftManual(-1), false); assert.equal(v.pendingGear, 0);
  v.setManual(false); assert.equal(v.shiftManual(1), false);
});

test('manual holds gear against auto up/down shifts and cuts torque at the limiter', () => {
  const v = new Vehicle(spec, route); v.setManual(true); v.reset(0, 0, 24); v.gear = 1; v.syncWheels();
  v.update(1 / 240, drive); assert.equal(v.limiter, true); assert.ok(v.engT <= 0); assert.equal(v.pendingGear, 0);
  run(v, 120); assert.equal(v.gear, 1); assert.equal(v.pendingGear, 0);
  v.reset(0, 0, 8); v.gear = 4; run(v, 60, { throttle: 0, brake: 0.4, steer: 0 }); assert.equal(v.gear, 4);
});

test('explicit automatic mode is bit-identical to the default and resumes auto shifting', () => {
  const a = new Vehicle(spec, route), b = new Vehicle(spec, route); b.setManual(false);
  const baseline = new Map(JSON.parse(readFileSync(new URL('./auto-input-baseline.json', import.meta.url), 'utf8')));
  for (let i = 0; i < 900; i++) {
    const input = { throttle: i < 600 ? 1 : 0.2, brake: i > 750 ? 0.6 : 0, steer: Math.sin(i / 40) * 0.15 };
    a.update(1 / 60, input); b.update(1 / 60, input);
    assert.deepEqual([a.vLong, a.vLat, a.w, a.rpm, a.gear, a.pendingGear, a.shiftT], [b.vLong, b.vLat, b.w, b.rpm, b.gear, b.pendingGear, b.shiftT]);
    if (baseline.has(i)) assert.deepEqual([a.x, a.z, a.vLong, a.vLat, a.w, a.rpm, a.gear, a.pendingGear, a.shiftT], baseline.get(i), 'frozen automatic trajectory at frame ' + i);
  }
  b.reset(0, 0, 30); b.setManual(true); b.syncWheels(); run(b, 30); assert.equal(b.gear, 1);
  b.setManual(false); run(b, 90); assert.ok(b.gear > 1);
});

test('manual-only player ignores auto preference, holds the limiter and emits shift animation events', () => {
  const v = new Vehicle({ ...spec, transmission: 'manual' }, route);
  assert.equal(v.setManual(false), true);
  v.reset(0, 0, 24); v.syncWheels(); v.update(1 / 240, drive);
  assert.equal(v.limiter, true); assert.ok(v.engT <= 0);
  let cuts = 0, firing = 0, low = Infinity, high = 0;
  for (let i = 0; i < 600; i++) {
    v.update(1 / 60, drive); cuts += +v.limiter; firing += +!v.limiter;
    if (i > 120) { low = Math.min(low, v.rpm); high = Math.max(high, v.rpm); }
    assert.equal(v.gear, 1); assert.equal(v.pendingGear, 0);
  }
  assert.ok(cuts > 0 && firing > 0 && high > low + 100, 'fuel-cut limiter cycles rather than upshifting');
  assert.equal(v.shiftManual(1), true);
  assert.deepEqual({ ...v.gearChangeEvent, serial: 1 }, { serial: 1, from: 1, to: 2, direction: 1, duration: spec.shiftT, manual: true });
  const serial = v.gearChangeEvent.serial; v.shiftEvent = 0; run(v, 45);
  assert.equal(v.gear, 2); assert.equal(v.gearChangeEvent.serial, serial);
  v.setManual(false); assert.equal(v.manual, true);
});

test('auto-only rejects the M toggle and manual preference, but accepts safe paddle shifts', async () => {
  const { toggleTransmission } = await import('../../src/transmission.js');
  const v = new Vehicle({ ...spec, transmission: 'auto' }, route);
  assert.equal(v.setManual(true), false);
  const gear = v.gear; assert.equal(toggleTransmission(v).locked, true);
  assert.equal(v.manual, false); assert.equal(v.gear, gear);
  assert.equal(v.shiftManual(1), true); run(v, 45, { throttle: 0, brake: 0, steer: 0 });
  assert.equal(v.gear, 2); assert.equal(v.manual, false);
});

test('AI driving a manual-only chassis is identical to the existing automatic box', () => {
  const ai = new Vehicle({ ...spec, transmission: 'manual' }, route), auto = new Vehicle(spec, route);
  assert.equal(ai.manual, false); assert.equal(ai.setManual(true, { ai: true }), false);
  for (let i = 0; i < 360; i++) {
    ai.update(1 / 60, drive); auto.update(1 / 60, drive);
    assert.deepEqual([ai.vLong, ai.rpm, ai.gear, ai.pendingGear], [auto.vLong, auto.rpm, auto.gear, auto.pendingGear]);
  }
  assert.ok(ai.gear > 1);
});

test('choice mode toggles; switching chassis reapplies locks; HUD cue respects reverse and top gear', async () => {
  const { carTransmission, toggleTransmission, gearFeedback } = await import('../../src/transmission.js');
  const v = new Vehicle(spec, route); v.setManual(false);
  assert.equal(carTransmission(spec), 'both'); assert.equal(toggleTransmission(v).locked, false); assert.equal(v.manual, true);
  v.setSpec({ ...spec, transmission: 'auto' }); assert.equal(v.manual, false);
  v.setSpec({ ...spec, transmission: 'manual' }); assert.equal(v.manual, true);
  const st = { manual: true, rpm: 6900, redline: 7000, gearLabel: '1', canUpshift: true };
  assert.equal(gearFeedback(st).band, 'red'); assert.equal(gearFeedback(st).upshift, true);
  assert.equal(gearFeedback({ ...st, gearLabel: 'R' }).upshift, false);
  assert.equal(gearFeedback({ ...st, canUpshift: false }).upshift, false);
  assert.equal(gearFeedback({ ...st, rpm: 5500 }).band, 'green');
});
