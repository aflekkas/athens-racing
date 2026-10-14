import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingGuidance, curvature, brakingDistance, routeLineU } from '../src/driving-guidance.js';
import { gripFeedback, damageFeedback } from '../src/driving-feedback-model.js';

const spec = { grip: 1, brake: 1, vmax: 250 };
const car = (s = 50, speed = 25) => ({ s, u: 1.75, vLong: speed, spec });
const straight = (grade = 0) => ({ length: 1000, closed: false, edge: () => 7, medHalf: () => .2, laneU: (_, lane) => 1.75 + lane * 3.5, lanes: () => 2,
  point: (s, u, out) => out.set(u, grade * s, s) });
// Known 20m-radius circular hairpin after 150m straight; constant arc length parametrization.
const hairpin = (grade = 0) => ({ ...straight(grade), edge: () => 3.5, lanes: () => 1,
  point(s, u, out) {
    if (s < 150) return out.set(u, grade * s, s);
    const angle = (s - 150) / 20, r = 20 - u;
    return out.set(20 - r * Math.cos(angle), grade * s, 150 + r * Math.sin(angle));
  } });

test('grip mapping preserves front breakaway when force utilization falls', () => {
  const a = { contact: true, utilization: .65, slipDemand: 1.8, saturated: true, sliding: true };
  const feedback = gripFeedback({ front: a, rear: { ...a, utilization: .5, sliding: false, saturated: false }, understeer: true });
  assert.equal(feedback.front.percent, 65); assert.equal(feedback.front.state, 'SLIDING');
  assert.match(feedback.message, /Front grip exceeded.*ease steering/);
  assert.equal(gripFeedback(null).available, false);
  assert.equal(gripFeedback({ front: { ...a, contact: false }, rear: a }).front.state, 'NO CONTACT');
});
test('damage explains actual power loss, cause and remapped recovery action', () => {
  const impaired = { engineDamage: .65, engHealth: .35, coolantTemp: 100 };
  const m = damageFeedback(impaired, { towLabel: 'RB', repairAvailable: true, towCost: 'free in roam' });
  assert.match(m.cause, /wear/); assert.equal(m.effect, '35% engine power available');
  assert.equal(m.repairAction, 'RB · Tow and repair · free in roam');
  assert.match(damageFeedback({ ...impaired, engineFailureReason: 'mechanical_overrev' }).cause, /Unsafe downshift/);
  assert.equal(damageFeedback({ ...impaired, engineStalled: true }).effect, 'No engine power');
  assert.match(damageFeedback(impaired, { spectating: true, repairAvailable: true }).repairAction, /their choice/);
  assert.equal(damageFeedback(null).visible, false); assert.equal(damageFeedback({ engHealth: 1, coolantTemp: 90 }).visible, false);
});
test('known curvature and braking distance retain physical units', () => {
  assert.equal(curvature({ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 20 }), 0);
  assert.ok(Math.abs(curvature({ x: 20, z: 0 }, { x: 0, z: 20 }, { x: -20, z: 0 }) - .05) < 1e-8);
  assert.equal(brakingDistance(20, 10, 5, 0), 30); assert.equal(brakingDistance(10, 20, 5), 0);
});
test('straight is green; hairpin advice changes with speed, weather and car grip', () => {
  const g = new DrivingGuidance();
  assert.equal(g.update(car(), straight()).tone, 'go');
  const fast = g.update(car(100, 30), hairpin()), dryTarget = fast.targetSpeed;
  assert.equal(fast.tone, 'brake'); assert.ok(dryTarget > 10 && dryTarget < 14);
  const wet = g.update(car(100, 30), hairpin(), { wetGrip: .65 }); assert.ok(wet.targetSpeed < dryTarget);
  assert.equal(g.update(car(100, 8), hairpin()).tone, 'go');
  const stronger = g.update({ ...car(100, 30), spec: { ...spec, grip: 1.5 } }, hairpin()); assert.ok(stronger.targetSpeed > dryTarget);
});
test('line stays inside actual width and retains grade, reverse lane/direction', () => {
  const route = straight(.12), g = new DrivingGuidance();
  const reverse = g.update(car(500, 25), route, { dir: -1 });
  assert.ok(reverse.nodes[1].s < reverse.nodes[0].s); assert.ok(reverse.nodes[0].u < 0);
  for (const n of reverse.nodes.slice(0, reverse.count)) { assert.ok(Math.abs(n.u) < route.edge(n.s)); assert.ok(Math.abs(n.y - .065 - n.s * .12) < 1e-7); }
  assert.ok(routeLineU({ ...route, edge: () => 1 }, 500, -1) >= -1);
  const fwdTarget = g.update(car(210, 20), hairpin()).targetSpeed;
  const revTarget = g.update(car(210, 20), hairpin(), { dir: -1 }).targetSpeed;
  assert.ok(revTarget > fwdTarget); // reverse uses outer/opposite lane radius, never the forward lane.
});
test('downhill and reaction margin move braking earlier; buffers reused and lifecycle unavailable is explicit', () => {
  const g = new DrivingGuidance(), original = g.nodes, originalNode = g.nodes[0];
  const up = g.update(car(90, 25), hairpin(.15)).allowedSpeed;
  const down = g.update(car(90, 25), hairpin(-.15)).allowedSpeed;
  assert.ok(down < up);
  assert.equal(g.nodes, original); assert.equal(g.nodes[0], originalNode);
  assert.equal(g.update({ ...car(), _network: {} }, straight()).available, false);
  assert.equal(g.update({ ...car(), u: 100 }, straight()).available, false);
  assert.equal(g.update(null, straight()).available, false);
  assert.equal(g.update(car(998), straight()).available, false);
});
test('closed circuit wraps and clamps surveyed racing line without terrain chords', () => {
  const length = 2 * Math.PI * 30, route = { closed: true, length, wrap: s => (s % length + length) % length, edge: () => 3,
    racingU: () => 10, point: (s, u, out) => out.set((30-u)*Math.cos(s/30), 12+u*.03, (30-u)*Math.sin(s/30)) };
  const g = new DrivingGuidance(), r = g.update(car(length - 8, 15), route);
  assert.equal(r.available, true); assert.ok(r.nodes[3].s < 8);
  for (const n of r.nodes.slice(0, r.count)) { assert.ok(Math.abs(n.u) <= 2.4); assert.ok(Math.abs(Math.hypot(n.x, n.z) - 27.6) < 1e-6); }
});
