import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS, driveCorner, routes } from './driver-feel.mjs';

for (const { def, route } of routes) test(`${def.id}: real keyboard corners, all six cars at 60/90/120 km/h`, () => {
  for (const spec of CARS) for (const kmh of [60, 90, 120]) {
    const r = driveCorner(spec, route, kmh);
    const label = `${spec.id} at ${kmh} km/h`;
    assert.ok(r.input90 <= 0.18, `${label}: delayed full-keyboard request`);
    assert.ok(r.yaw90 <= (kmh === 60 ? 0.28 : 0.20), `${label}: slow yaw response ${r.yaw90}`);
    assert.ok(r.maxG >= 0.88 - 1e-3 && r.maxG <= 1.3, `${label}: reachable grip ${r.maxG}`);
    assert.ok(r.radiusRatio < 1.15, `${label}: ploughs beyond the actual corner radius`);
    assert.ok(r.trace.every(t => Number.isFinite(t.pathG) && Math.abs(t.betaDeg) < 20), `${label}: unstable dry-road grip`);
  }
});

test('held W+steer permits bounded RWD rotation and preserves FWD/AWD grip', () => {
  for (const spec of CARS) for (const kmh of [60, 90, 120]) {
    const power = driveCorner(spec, routes[0].route, kmh, { throttle: 1, seconds: 4 });
    const heldSpeed = driveCorner(spec, routes[0].route, kmh);
    const label = `${spec.id} at ${kmh}`;
    assert.ok(power.trace.every(t => Math.abs(t.betaDeg) < (spec.drive === 'rwd' ? 11 : 8)), `${label}: W+steer escapes the aided slip envelope`);
    assert.ok(power.trace.every(t => t.driftLatch === 0), `${label}: ordinary throttle entered drift mode`);
    assert.ok(power.maxG >= (spec.power / spec.mass < .10 ? .88 : .9), `${label}: attainable sustained lateral g ${power.maxG}`);
    if (spec.drive === 'fwd') assert.ok(power.pathRadius < heldSpeed.pathRadius * 1.15, `${label}: power radius ${power.pathRadius} vs held-speed ${heldSpeed.pathRadius}`);
  }
});

test('TC never builds a cut below 0.9 of combined-slip peak', async () => {
  const { Vehicle } = await import('../../src/physics.js');
  for (const spec of CARS) {
    const v = new Vehicle(spec, routes[0].route); v.reset(1704, 0, 25);
    for (let i = 0; i < 90; i++) { v.update(1 / 60, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = 25; }
    let checked = 0;
    for (let i = 0; i < 960; i++) {
      const previous = v.tcCut;
      v.update(1 / 240, { throttle: i < 240 ? 0.2 : i < 720 ? 1 : 0.2, brake: 0, steer: Math.sin(i / 80) * 0.2 });
      const combined = Math.max(...v.corners.map((c, j) => (j < 2 ? 1 - v.shareR : v.shareR) > 0 ? c.sN : 0));
      if (combined <= 0.9) { checked++; assert.ok(v.tcCut <= previous + 1e-12, `${spec.id}: false TC below tyre peak`); }
    }
    assert.ok(checked > 10, `${spec.id}: no below-peak control samples`);
  }
});

test('default light gamepad assist retains front grip at full stick without suppressing assist-off', () => {
  const route = routes[0].route;
  for (const spec of CARS) {
    const keyboard = driveCorner(spec, route, 90);
    const stick = driveCorner(spec, route, 90, { device: 'gamepad' });
    const withBeta = driveCorner(spec, route, 90, { device: 'gamepad', initialBeta: 0.03 });
    const raw = driveCorner(spec, route, 90, { device: 'gamepad', assist: 0 });
    assert.ok(stick.achievedG >= keyboard.achievedG * 0.93, `${spec.id}: light assist scrubs away grip`);
    assert.ok(stick.frontDeg < spec.alphaPk * 180 / Math.PI * 1.35, `${spec.id}: fronts over-driven`);
    assert.ok(withBeta.achievedG >= keyboard.achievedG * 0.93, `${spec.id}: small initial sideslip defeats the guard`);
    assert.ok(withBeta.frontDeg < spec.alphaPk * 180 / Math.PI * 1.35, `${spec.id}: initial sideslip over-drives the fronts`);
    assert.ok(raw.frontDeg > stick.frontDeg + 2, `${spec.id}: assist-off no longer exposes the rack`);
  }
});

test('FWD full-throttle mid-corner preserves a normal road line at 60 and 90 km/h', () => {
  for (const spec of CARS.filter(c => c.drive === 'fwd')) for (const kmh of [60, 90]) {
    const r = driveCorner(spec, routes[0].route, kmh, { throttle: 1, powerAt: 0.75, cornerG: 0.65 });
    assert.ok(r.radiusRatio < 0.9, `${spec.id} at ${kmh}: insufficient turn authority for the actual road bend`);
    assert.ok(r.achievedG > 0.8, `${spec.id} at ${kmh}: drive slip consumes front cornering grip`);
    assert.ok(r.tcCut > 0.3 && r.escCut < 0.3, `${spec.id} at ${kmh}: cornering TC should reserve front grip`);
    assert.ok(r.trace.every(t => t.driftLatch === 0), `${spec.id} at ${kmh}: ordinary FWD exit entered drift mode`);
  }
});

test('keyboard turn-in develops useful force during a 150 ms corner-entry tap', () => {
  for (const spec of CARS) {
    const r = driveCorner(spec, routes[0].route, 90);
    assert.ok(r.trace[8].lateralG >= 0.55, `${spec.id}: the input ramp swallows the steering tap`);
  }
});

// The revised product contract permits RWD rear slip beyond peak without
// latching the sustained-drift aids. FWD/AWD keep their lateral reserve.
test('RWD second-gear power-on stays controlled; sports engines can exceed rear grip', () => {
  for (const { def, route } of routes.filter(r => r.def.id !== 'megara')) {
    const s = def.id === 'penteli' ? 1106 : 1577;
    const bend = { s, k: route.curv(s), radius: 1 / Math.abs(route.curv(s)) };
    for (const spec of CARS.filter(c => c.drive === 'rwd')) for (const kmh of [50, 60, 70]) {
      const r = driveCorner(spec, route, kmh, { bend, gear: 2, throttle: 1, powerAt: 0.75, seconds: 4 });
      const powered = r.trace.filter(t => t.t >= 1.2 && t.t <= 2);
      const mean = key => powered.reduce((s, r) => s + r[key], 0) / powered.length;
      // A 97 kW classic with physical flywheel inertia need not spin the rear
      // at every road speed. The higher-output sports cars retain the power-slip gate.
      const sportsPower = spec.power / spec.mass > .12;
      if (sportsPower) assert.ok(Math.max(...r.trace.filter(t => t.t > 0.75).map(t => t.rearSlip)) > 1.05, `${def.id}/${spec.id}/${kmh}: rear never reaches power slip`);
      else assert.ok(mean('engineTorque') > 0 && r.achievedG > .7, 'classic still drives through the bend');
      assert.ok(Math.max(...r.trace.map(t => Math.abs(t.betaDeg))) < 11, `${def.id}/${spec.id}/${kmh}: power rotation spins`);
      assert.ok(r.trace.every(t => t.driftLatch === 0), 'aided power rotation must not latch sustained drift');
      if (sportsPower) assert.ok(mean('tcCut') > 0, 'TC must cap sports-car power slip');
    }
  }
});

test('low-gear lift transfers more load and gives more rotation than a low-rev lift', async () => {
  const { liftOff } = await import('./lift-off.mjs');
  for (const spec of CARS) {
    const gear = spec.gears.findIndex(g => 60 / 3.6 / spec.wheelR * g * spec.final * 30 / Math.PI < spec.redline * 0.94) + 1;
    const high = liftOff(spec, gear), low = liftOff(spec, 4), disconnected = liftOff(spec, gear, { declutch: true });
    assert.equal(high.before.kmh, low.before.kmh, 'matched speed/chassis before the lift');
    assert.ok(high.mean.torque < low.mean.torque * 1.4, `${spec.id}: rev-dependent drag torque`);
    assert.ok(high.mean.ax < low.mean.ax - 0.15, `${spec.id}: gearing must multiply engine drag`);
    assert.ok(high.mean.frontLoad > low.mean.frontLoad + 30, `${spec.id}: missing forward load transfer`);
    assert.ok(high.mean.rearLoad < low.mean.rearLoad - 30, `${spec.id}: rear must unload`);
    assert.ok(high.mean.yaw > low.mean.yaw, `${spec.id}: high-rev lift should tighten the line`);
    assert.ok(Math.abs(disconnected.mean.torque) < 1e-9, 'clutch-open engine must not brake the wheels');
    assert.ok(high.trace.every(t => t.latch === 0 && Math.abs(t.beta) < 11), 'ordinary lift is controlled and does not enter drift');
  }
});

// Keep the six-car Megara steering contract in the regular npm test gate.
import './handling-audit.test.mjs';
