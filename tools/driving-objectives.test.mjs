import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDrivingRoutes, createObjectiveState, stepObjectives, objectiveSnapshot, objectiveTarget, objectiveResult, drivingModeDefinition, resolveDrivingMode } from '../src/driving-objectives.js';
import { DrivingModeRun, drivingModeHud, drivingModeResults } from '../src/driving-modes.js';
import { TYPES, resolve, getEvent, rivalCount, targetLabels, freeRoam, EventRun, events } from '../src/events.js';
import { setupFields, applySetup } from '../src/race-setup.js';
const route = { step: 2, x: Array.from({ length: 3001 }, (_, i) => i * 2), z: Array(3001).fill(0), y: Array(3001).fill(10), lanes: Array(3001).fill(1), div: Array(3001).fill(0), length: 6000, start: 20, finish: 5900, from: 'ATHENS', to: 'COAST' };
const ctx = { route, marks: [] }, trips = buildDrivingRoutes(ctx, 'taxi');
const poseAt = target => ({ ...target, kmh: 0, vLong: 0, vLat: 0 });
function stop(state, target, from, seconds = 1.7) { const out = []; for (let t = from; t <= from + seconds + 1e-7; t += .1) out.push(...stepObjectives(state, trips, t, poseAt(target))); return out; }

test('real public-road itineraries are deterministic, on tarmac and longer for getaway', () => {
  for (const path of ['data/map.json', 'data/maps/penteli/map.json']) {
    const data = JSON.parse(readFileSync(path)), taxi = buildDrivingRoutes(data, 'taxi'), getaway = buildDrivingRoutes(data, 'getaway');
    assert.deepEqual(taxi, buildDrivingRoutes(data, 'taxi')); assert.notDeepEqual(taxi, buildDrivingRoutes(data, 'taxi', { seed: 2 }));
    assert.ok(getaway[0].distance > taxi[0].distance * 1.5);
    for (const trip of [...taxi, ...getaway]) for (const p of [trip.pickup, trip.dropoff]) {
      assert.ok(p.s >= data.route.start && p.s <= data.route.finish); assert.ok([p.x, p.y, p.z, p.u].every(Number.isFinite));
      const i = Math.round(p.s / data.route.step), dx = p.x - data.route.x[i], dz = p.z - data.route.z[i];
      assert.ok(Math.abs(Math.hypot(dx, dz) - Math.abs(p.u)) < 1e-6); assert.ok(Math.abs(p.u) >= 1.3);
    }
    assert.match(getaway[0].pickup.label, /FICTIONAL/);
  }
  assert.throws(() => buildDrivingRoutes({ route: { ...route, closed: true } }, 'taxi'), /public roads/);
  assert.throws(() => buildDrivingRoutes({ route: { ...route, finish: 200 } }, 'taxi'), /too short/);
});
test('pickup then dropoff requires continuous low-speed dwell, counts once and cools down', () => {
  const s = createObjectiveState({ mode: 'taxi' });
  assert.deepEqual(stop(s, trips[0].dropoff, 0), []); assert.equal(s.completed, 0); assert.equal(s.phase, 'pickup');
  const picked = stop(s, trips[0].pickup, 2); assert.equal(picked.filter(e => e.kind === 'objective-pickup').length, 1); assert.equal(s.phase, 'dropoff');
  const dropped = stop(s, trips[0].dropoff, 4); assert.equal(dropped.filter(e => e.kind === 'objective-complete').length, 1); assert.equal(s.completed, 1); assert.equal(s.phase, 'cooldown');
  stop(s, trips[0].dropoff, 6); assert.equal(s.completed, 1);
  stepObjectives(s, trips, 9, poseAt(trips[0].dropoff)); assert.equal(s.phase, 'pickup'); assert.equal(s.routeIndex, 1); assert.equal(s.holdSeconds, 0);
});
test('distance, height, velocity, leaving target and stale samples reset dwell', () => {
  for (const bad of [{ x: trips[0].pickup.x + 11 }, { y: 16 }, { kmh: 9 }, { kmh: -9 }, { x: NaN }]) {
    const s = createObjectiveState({ mode: 'taxi' }); stop(s, trips[0].pickup, 0, .9);
    stepObjectives(s, trips, 1, { ...poseAt(trips[0].pickup), ...bad }); assert.equal(s.holdSeconds, 0);
    assert.equal(stop(s, trips[0].pickup, 1.1, 1).filter(e => e.kind === 'objective-pickup').length, 0);
  }
  const s = createObjectiveState({ mode: 'taxi' }); stop(s, trips[0].pickup, 0, .9);
  stepObjectives(s, trips, 2, poseAt(trips[0].pickup)); assert.equal(s.holdSeconds, 0); assert.equal(s.phase, 'pickup');
  stepObjectives(s, trips, 2.1, { ...trips[0].pickup, vLong: 0, vLat: 3 }); assert.equal(s.holdSeconds, 0);
});
test('duplicate/out-of-order receipt clocks and client counts cannot advance state', () => {
  const s = createObjectiveState({ mode: 'taxi', roundId: 'round-2' });
  stepObjectives(s, trips, 1, poseAt(trips[0].pickup));
  for (let i = 0; i < 30; i++) stepObjectives(s, trips, 1, { ...poseAt(trips[0].pickup), completed: 900 });
  assert.equal(s.holdSeconds, 0); const prev = structuredClone(s); stepObjectives(s, trips, .5, poseAt(trips[0].pickup)); assert.deepEqual(s, prev);
  assert.equal(objectiveSnapshot(s).roundId, 'round-2'); assert.equal(s.completed, 0);
});
test('coordinator timer ticks preserve fresh pose dwell without crediting it and clear stale dwell', () => {
  const s = createObjectiveState({ mode: 'taxi' });
  for (let i = 0; i <= 16; i++) {
    const now = i / 10; stepObjectives(s, trips, now, poseAt(trips[0].pickup));
    const held = s.holdSeconds; stepObjectives(s, trips, now + .05, null); assert.equal(s.holdSeconds, held);
  }
  assert.equal(s.phase, 'dropoff'); assert.equal(s.completed, 0);
  const stale = createObjectiveState({ mode: 'taxi' }); stop(stale, trips[0].pickup, 0, .9);
  stepObjectives(stale, trips, 2, null); assert.equal(stale.holdSeconds, 0); assert.equal(stale.wasStopped, false);
  assert.equal(stale.lastAt < 1, true); stop(stale, trips[0].pickup, 2.1, 1); assert.equal(stale.phase, 'pickup');
});
test('deadline wins over coincident delivery and expires exactly once', () => {
  const s = createObjectiveState({ mode: 'taxi', duration: 30 }); stop(s, trips[0].pickup, 0);
  stop(s, trips[0].dropoff, 28.5, 1.4); assert.equal(s.completed, 0);
  assert.deepEqual(stepObjectives(s, trips, 30, poseAt(trips[0].dropoff)), [{ kind: 'timeup', completed: 0 }]);
  assert.equal(s.phase, 'finished'); assert.equal(s.remaining, 0); assert.equal(s.elapsed, 30);
  assert.deepEqual(stepObjectives(s, trips, 31, poseAt(trips[0].dropoff)), []);
  assert.equal(objectiveTarget(s, trips), null); assert.equal(objectiveResult(s).completed, 0);
});
test('duration bounded and fresh rounds discard prior progress/dwell', () => {
  assert.equal(createObjectiveState({ mode: 'taxi', duration: -1 }).remaining, 30);
  assert.equal(createObjectiveState({ mode: 'getaway', duration: 9999 }).remaining, 900);
  const s = createObjectiveState({ mode: 'taxi' }); stop(s, trips[0].pickup, 0);
  const fresh = createObjectiveState({ mode: 'taxi', startedAt: 100 }); assert.equal(fresh.phase, 'pickup'); assert.equal(fresh.completed, 0); assert.equal(fresh.holdSeconds, 0);
  stepObjectives(fresh, trips, 99, poseAt(trips[0].pickup)); assert.equal(fresh.lastAt, null);
});
test('new definitions resolve through existing setup/lookup without race medals/laps/AI', () => {
  for (const mode of ['taxi', 'getaway']) {
    const def = drivingModeDefinition(mode), fields = setupFields(def);
    assert.ok(TYPES[mode]); assert.equal(getEvent(def.id).type, mode); assert.equal(rivalCount(def), 0);
    assert.ok(fields.some(f => f.key === 'police')); assert.ok(fields.some(f => f.key === 'traffic'));
    assert.equal(fields.some(f => ['laps', 'reverse', 'rivals'].includes(f.key)), false);
    assert.deepEqual(resolve(def, ctx).checkpoints, []); assert.deepEqual(targetLabels(def, resolve(def, ctx), String), []);
    assert.equal(applySetup(def, { police: true }).rules.police, true); assert.equal(applySetup(def, { police: false }).rules.police, false);
    assert.throws(() => resolveDrivingMode(def, { ...ctx, route: { ...route, closed: true } }), /public roads/);
    assert.equal(def.car, undefined); assert.equal(def.targets.gold, undefined);
  }
  const run = new EventRun(freeRoam(), ctx); run.start(); assert.deepEqual(run.update(300, { s: 9999, t: 900 }), []); assert.equal(run.t, 0);
});
test('playable adapter ignores race boundaries/penalties and produces session result once', () => {
  const run = new DrivingModeRun({ ...drivingModeDefinition('taxi'), sessionDuration: 30 }, ctx, { car: 'mini' }); let finishes = 0;
  const off = events.on('finish', () => finishes++); run.start();
  for (let i = 0; i < 120; i++) run.update(.25, { ...poseAt(run.routes[0].dropoff), s: 100000, t: 5000 });
  assert.equal(run.state.completed, 0); assert.equal(run.state.phase, 'finished'); assert.equal(run.t, 30);
  const res = run.finish({ time: 5000 }); assert.equal(res.time, 30); assert.equal(res.valid, false); assert.equal(res.record, null); assert.equal(res.laps, 0); assert.equal(finishes, 1);
  assert.equal(run.finish(), res); assert.equal(finishes, 1); off();
  run.reset(); assert.equal(run.state.phase, 'pickup'); assert.equal(run.state.completed, 0); assert.equal(run.t, 0);
  run.start(); run.update(.2, poseAt(run.target));
  const retired = run.finish({ retired: true }); assert.equal(retired.done, true); assert.equal(retired.phase, 'finished'); assert.equal(run.target, null);
});
test('HUD and result describe objective counts and stops without fake race positions', () => {
  const s = createObjectiveState({ mode: 'getaway' }), routes = buildDrivingRoutes(ctx, 'getaway');
  const html = drivingModeHud(objectiveSnapshot(s), routes, poseAt(routes[0].pickup));
  assert.match(html, /0 MISSIONS/); assert.match(html, /5:00/); assert.match(html, /REACH BANK PICKUP/); assert.match(html, /STOP BELOW 8 KM\/H/);
  assert.doesNotMatch(html, /LAP|POINTS|XP/);
  assert.match(drivingModeHud(objectiveSnapshot(s), routes, { x: 0, z: 0, s: routes[0].pickup.s + 80 }), /FOLLOW THE MARKED ROAD/);
  const results = drivingModeResults({ type: 'taxi' }, { completed: 2, time: 300, bestTrip: 40 }, String);
  assert.equal(results.title, '2 FARES COMPLETED'); assert.equal(results.field, null); assert.equal(results.splits, null);
});
