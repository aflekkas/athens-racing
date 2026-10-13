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
    assert.ok(r.tcCut < 0.1, `${label}: TC interrupts ordinary turn-in`);
  }
});

test('default light gamepad assist retains front grip at full stick without suppressing assist-off', () => {
  const route = routes[0].route;
  for (const spec of CARS) {
    const keyboard = driveCorner(spec, route, 90);
    const stick = driveCorner(spec, route, 90, { device: 'gamepad' });
    const raw = driveCorner(spec, route, 90, { device: 'gamepad', assist: 0 });
    assert.ok(stick.achievedG >= keyboard.achievedG * 0.93, `${spec.id}: light assist scrubs away grip`);
    assert.ok(stick.frontDeg < spec.alphaPk * 180 / Math.PI * 1.35, `${spec.id}: fronts over-driven`);
    assert.ok(raw.frontDeg > stick.frontDeg + 2, `${spec.id}: assist-off no longer exposes the rack`);
  }
});

test('keyboard turn-in develops useful force during a 150 ms corner-entry tap', () => {
  for (const spec of CARS) {
    const r = driveCorner(spec, routes[0].route, 90);
    assert.ok(r.trace[8].lateralG >= 0.55, `${spec.id}: the input ramp swallows the steering tap`);
  }
});
