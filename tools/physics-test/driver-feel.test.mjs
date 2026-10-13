import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS, driveCorner, routes } from './driver-feel.mjs';

for (const { def, route } of routes) test(`${def.id}: real keyboard corners, all six cars at 60/90/120 km/h`, () => {
  for (const spec of CARS) for (const kmh of [60, 90, 120]) {
    const r = driveCorner(spec, route, kmh);
    const label = `${spec.id} at ${kmh} km/h`;
    assert.ok(r.input90 <= 0.18, `${label}: delayed full-keyboard request`);
    assert.ok(r.yaw90 <= (kmh === 60 ? 0.28 : 0.20), `${label}: slow yaw response ${r.yaw90}`);
    assert.ok(r.maxG >= 0.88 && r.maxG <= 1.3, `${label}: reachable grip ${r.maxG}`);
    assert.ok(r.radiusRatio < 1.15, `${label}: ploughs beyond the actual corner radius`);
    assert.ok(r.trace.every(t => Number.isFinite(t.pathG) && Math.abs(t.betaDeg) < 20), `${label}: unstable dry-road grip`);
  }
});

test('held W+steer stays gripped on every car at 60/90/120 km/h', () => {
  for (const spec of CARS) for (const kmh of [60, 90, 120]) {
    const power = driveCorner(spec, routes[0].route, kmh, { throttle: 1, seconds: 4 });
    const heldSpeed = driveCorner(spec, routes[0].route, kmh);
    const label = `${spec.id} at ${kmh}`;
    assert.ok(power.trace.every(t => Math.abs(t.betaDeg) < 8), `${label}: W+steer spins or slides`);
    assert.ok(power.trace.every(t => t.driftLatch === 0), `${label}: ordinary throttle entered drift mode`);
    assert.ok(power.maxG >= 0.9, `${label}: attainable sustained lateral g ${power.maxG}`);
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
