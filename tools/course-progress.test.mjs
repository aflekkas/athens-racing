// Invisible route progress (owner decision 2026-10-18: no checkpoints). Only continuous on-road movement
// counts; a shortcut buys nothing; the finish needs the whole route; recovery returns to the latest valid pose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse, observeCourse, roadFrame, courseComplete, courseHeld, courseProgress, courseRecoveryPose, restartCourseAt } from '../src/course.js';
import { EventRun } from '../src/events.js';
const straight = { step: 20, x: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200], z: Array(11).fill(0), y: Array(11).fill(0), lanes: Array(11).fill(1), div: Array(11).fill(0) };
// An L: east for 100 m, then south for 100 m. The corner can be cut straight across the grass.
const corner = { step: 20, x: [0, 20, 40, 60, 80, 100, 100, 100, 100, 100, 100], z: [0, 0, 0, 0, 0, 0, 20, 40, 60, 80, 100], y: Array(11).fill(0), lanes: Array(11).fill(1), div: Array(11).fill(0) };
const event = { s0: 0, s1: 200, dir: 1, sectors: [{ d: 100 }] };
const onStraight = (s, u = 0) => ({ s, u, x: s, z: u, y: 0 });
const along = (route, s, u = 0) => ({ s, u, x: s <= 100 ? s : 100, z: s <= 100 ? u : s - 100, y: 0 });
function drive(course, route, from, to, { step = 6, t0 = 0, speed = 30, pose = onStraight } = {}) {
  let t = t0;
  for (let s = from; s <= to + 1e-9; s += step) { t += step / speed; observeCourse(course, pose(s), t, { route }); }
  return t;
}
test('driving the whole route on the road completes it, with interpolated sector and finish times', () => {
  const course = buildCourse(event, straight);
  observeCourse(course, onStraight(0), 0, { route: straight });
  drive(course, straight, 6, 210, { t0: 0 });
  assert.equal(courseComplete(course), true);
  assert.ok(Math.abs(course.markTimes[0] - 100 / 30) < .25, 'sector time interpolated at the line');
  assert.ok(Math.abs(course.finishedAt - 200 / 30) < .25);
  assert.equal(courseHeld(course), false);
});
test('a shortcut across the corner earns no progress and cannot finish', () => {
  const course = buildCourse(event, corner); let t = 0;
  observeCourse(course, along(corner, 0), 0, { route: corner });
  t = drive(course, corner, 6, 60, { pose: s => along(corner, s) });
  const held = course.reached;
  // Straight across the grass from (60,0) towards (100,60): 72 m driven, 100 m of route skipped.
  for (let k = 1; k <= 10; k++) { t += .24; observeCourse(course, { s: 60 + 10 * k, u: 0, x: 60 + 4 * k, z: 6 * k, y: 0 }, t, { route: corner }); }
  observeCourse(course, along(corner, 160), t += .2, { route: corner });
  drive(course, corner, 166, 220, { t0: t, pose: s => along(corner, s) });
  assert.ok(course.reached <= held + 6, `shortcut must not advance progress (reached ${course.reached})`);
  assert.equal(courseComplete(course), false);
  assert.equal(courseHeld(course), true);
});
test('a chord that cuts a bend between two on-road poses is not progress either', () => {
  const course = buildCourse(event, corner);
  observeCourse(course, along(corner, 0), 0, { route: corner });
  const t = drive(course, corner, 6, 60, { pose: s => along(corner, s) });
  const before = course.reached;
  observeCourse(course, along(corner, 140), t + .4, { route: corner }); // (60,0) -> (100,40): 56 m across grass
  assert.ok(course.reached <= before + 6);
  assert.equal(course.onRoute, false);
});
test('a brief excursion that comes straight back costs nothing', () => {
  const course = buildCourse(event, straight);
  observeCourse(course, onStraight(0), 0, { route: straight });
  let t = drive(course, straight, 6, 60);
  for (const [s, u] of [[66, 12], [72, 14], [78, 12], [84, 0]]) observeCourse(course, onStraight(s, u), t += .2, { route: straight });
  assert.equal(courseHeld(course), false);
  drive(course, straight, 90, 210, { t0: t });
  assert.equal(courseComplete(course), true);
});
test('teleporting forward is never movement', () => {
  const course = buildCourse(event, straight);
  observeCourse(course, onStraight(0), 0, { route: straight });
  observeCourse(course, onStraight(200), .1, { route: straight });
  assert.equal(course.reached, 0); assert.equal(courseComplete(course), false);
  observeCourse(course, onStraight(205), .2, { route: straight });
  assert.equal(courseComplete(course), false);
});
test('reversing and going again counts the route once; reverse direction races work', () => {
  const course = buildCourse(event, straight);
  observeCourse(course, onStraight(0), 0, { route: straight });
  let t = drive(course, straight, 6, 80);
  for (let s = 74; s >= 40; s -= 6) observeCourse(course, onStraight(s), t += .2, { route: straight });
  assert.ok(courseProgress(course) < course.reached && course.reached >= 78);
  drive(course, straight, 46, 210, { t0: t });
  assert.equal(courseComplete(course), true);
  const reverse = buildCourse({ s0: 200, s1: 0, dir: -1 }, straight);
  observeCourse(reverse, onStraight(200), 0, { route: straight });
  for (let s = 194, t2 = 0; s >= -10; s -= 6) observeCourse(reverse, onStraight(s), t2 += .2, { route: straight });
  assert.equal(courseComplete(reverse), true);
});
test('closed circuits count every lap on the unwrapped station', () => {
  const ring = { step: 20, closed: true, x: [0, 100, 100, 0, 0], z: [0, 0, 100, 100, 0], y: Array(5).fill(0), lanes: Array(5).fill(1), div: Array(5).fill(0) };
  const lap = (ring.x.length - 1) * ring.step, course = buildCourse({ s0: 0, s1: 2 * lap, dir: 1 }, ring);
  const pose = s => { const f = roadFrame(ring, s); return { s, u: 0, x: f.x, y: f.y, z: f.z }; };
  observeCourse(course, pose(0), 0, { route: ring });
  let t = 0;
  for (let s = 4; s <= lap + 10; s += 4) observeCourse(course, pose(s), t += .1, { route: ring });
  assert.equal(courseComplete(course), false, 'one lap of two is not the race');
  for (let s = lap + 14; s <= 2 * lap + 10; s += 4) observeCourse(course, pose(s), t += .1, { route: ring });
  assert.equal(courseComplete(course), true);
});
test('tow / recovery anchor is always the latest valid on-road pose', () => {
  const course = buildCourse(event, straight);
  observeCourse(course, onStraight(0), 0, { route: straight });
  let t = drive(course, straight, 6, 90);
  assert.equal(courseRecoveryPose(course).s, 90);
  // Drive off the road ahead of the departure point: the anchor stays at the last on-road pose.
  for (const s of [96, 102, 108, 114]) observeCourse(course, onStraight(s, 30), t += .2, { route: straight });
  assert.equal(courseRecoveryPose(course).s, 90, 'off-road poses never move the anchor');
  restartCourseAt(course, courseRecoveryPose(course), t);
  assert.equal(course.onRoute, true); assert.equal(courseHeld(course), false); assert.equal(courseProgress(course), 90);
  drive(course, straight, 96, 210, { t0: t });
  assert.equal(courseComplete(course), true);
});
test('solo run: timing sectors and the finish come from tracked progress, never from skipped ground', () => {
  const route = { start: 0, finish: 200, length: 200, frame(s, out) { return Object.assign(out, { x: s, y: 0, z: 0, tx: 1, tz: 0 }); }, edge() { return 4; } };
  const run = new EventRun({ id: 'test', type: 'sprint', from: 'start', to: 'finish' }, { route, marks: [{ id: 'mid', name: 'Mid', s: 100 }] }, { storage: { getItem() { return null; } } });
  run.start();
  const kinds = [];
  run.update(2, { ...onStraight(60), t: 2 });
  run.update(3, { ...onStraight(60, 40), t: 5 });
  kinds.push(...run.update(3, { ...onStraight(110, 40), t: 8 }).map(e => e.kind));
  assert.deepEqual(kinds, [], 'jumping across a gap while off the road awards no split and no finish');
  assert.equal(run.sectorIdx, 0);
  let t = 8;
  for (let s = 60; s <= 206; s += 6) for (const e of run.update(.2, { ...onStraight(s), t: t += .2 })) kinds.push(e.kind);
  assert.ok(kinds.includes('split') && kinds.includes('finish'));
});
