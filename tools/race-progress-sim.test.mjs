import './physics-test/register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const { Vehicle } = await import('../src/physics.js');
const { Route } = await import('../src/map.js');
const catalogue = readFileSync(new URL('../src/cars.js', import.meta.url), 'utf8');
const CARS = Function('return ' + catalogue.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
import { buildCourse, observeCourse, courseProgress, courseComplete, courseTowLimits } from '../src/course.js';
import { requestRecovery } from '../server/race-recovery.mjs';
import { rankDrivers, restoreVehicleState } from '../src/race-lifecycle.js';
import { EventRun, registerMapEvents, getEvents, freeRoam, resolve } from '../src/events.js';
import { applySetup } from '../src/race-setup.js';
import { DrivingGuidance, travelDirection } from '../src/driving-guidance.js';
import { raceGridSlot, soloStartPosition } from '../src/start-placement.js';
import { routeTowAdapter } from '../src/road-recovery.js';
import { planTow } from '../src/tow-placement.js';
import { RivalAI } from '../src/rival-ai.js';
const spec = CARS.find(c => c.id === 'mini');
const road = { length: 2400, closed: false, edge: () => 5, medHalf: () => 0, lanes: () => 1, laneU: () => 2, curv: () => 0,
  urban: () => 0, district: () => 'test', y: () => 0, surfaceY: () => 0, GR: null, TX: 'TX', TZ: 'TZ', lin: a => a === 'TZ' ? -1 : 0,
  frame: (s, out) => Object.assign(out, { x: 0, y: 0, z: -s, tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }),
  point: (s, u, out = {}) => Object.assign(out, { x: u, y: 0, z: -s }), project: (x, z) => ({ s: -z, u: x }) };
for (const dir of [1, -1]) test(`actual Vehicle acceleration/overtake/retreat and earned recovery (${dir})`, t => {
  const event = { s0: dir > 0 ? 100 : 2000, s1: dir > 0 ? 2100 : 0, dir, len: 2000 };
  const cars = ['human', 'AI', 'third'].map((id, i) => {
    const vehicle = new Vehicle(spec, road); vehicle.reset(event.s0 + dir * [0, 16, 8][i], dir * (i === 1 ? -2 : 2), [15, 8, 5][i]);
    if (dir < 0) vehicle.yaw += Math.PI;
    return { id, vehicle, course: buildCourse(event, road), finish: null };
  });
  let previous = '', changes = [];
  for (let tick = 1; tick <= 1200; tick++) {
    const now = tick / 60;
    for (const car of cars) {
      car.vehicle.update(1 / 60, { throttle: car.id === 'human' ? .8 : .12, brake: 0, steer: 0 });
      observeCourse(car.course, car.vehicle, now, { route: road });
    }
    const ranked = rankDrivers(cars, c => courseProgress(c.course)), order = ranked.map(c => c.id).join(' > ');
    if (order !== previous) { changes.push({ now, order, metres: ranked.map(c => courseProgress(c.course)) }); previous = order; }
  }
  assert.equal(changes[0].order.split(' > ')[0], 'AI');
  assert.equal(changes.at(-1).order.split(' > ')[0], 'human');
  assert.ok(cars.every(c => courseProgress(c.course) > 80 && c.course.reached > 0));
  const car = cars[0], earned = courseProgress(car.course), safeS = car.vehicle.s;
  // An inverted car/off-road projection onto another lap must recover nearby.
  car.vehicle.bodyDynamic = true; car.vehicle.rigid = { q: [1, 0, 0, 0] };
  car.vehicle.s -= dir * 6000;
  // The tow puts the car on the nearest road, where it physically is; never before its latest valid pose.
  const placement = planTow({ x: car.vehicle.x, z: car.vehicle.z, yaw: car.vehicle.yaw, route: routeTowAdapter(road), dir, course: courseTowLimits(car.course) });
  const target = placement.s; assert.equal(placement.kind, 'route'); assert.ok((target - (event.s0 + dir * earned)) * dir > -1e-6, 'never before the latest valid on-road pose');
  car.vehicle.reset(placement.s, placement.u); car.vehicle.yaw = placement.yaw;
  assert.ok(Math.abs(car.vehicle.s - safeS) < .5); assert.equal(car.vehicle.bodyDynamic, false); assert.equal(car.vehicle.rigid, null); assert.equal(car.vehicle.sus.fresh, true);
  for (let i = 0; i < 90; i++) car.vehicle.update(1 / 60, { throttle: .6, brake: 0, steer: 0 });
  assert.ok(car.vehicle.vLong > 1, 'upright recovery settles suspension and accepts throttle');
  const driver = { recoveryRace: 'race', course: structuredClone(car.course), state: {
    s: target, u: 2, x: car.vehicle.x, y: 0, z: car.vehicle.z, yaw: dir > 0 ? 0 : Math.PI, motionEpoch: 1,
    bodyDynamic: true, bodyQ: [1,0,0,0], engineStalled: true, engineDamage: 1, engHealth: 0,
  } };
  requestRecovery(driver, event, 'race', 2, 1000, { route: road });
  const resumed = restoreVehicleState(new Vehicle(spec, road), driver.state);
  assert.equal(resumed.bodyDynamic, false); assert.equal(resumed.rigid, null); assert.equal(resumed.engineStalled, false);
  assert.equal(resumed.engHealth, 1); assert.equal(travelDirection(resumed, road), dir);
  for(let i=0;i<90;i++)resumed.update(1/60,{throttle:.6,brake:0,steer:0});
  assert.ok(resumed.vLong>1,'resume immediately after acknowledgement is upright, repaired and drivable');
  const backwardS = car.vehicle.s - dir * 40;
  observeCourse(car.course, { ...road.point(backwardS, 2), s: backwardS, u: 2 }, 23, { route: road });
  assert.ok(courseProgress(car.course) < earned, 'earned history does not keep a reversing car ahead');
  mkdirSync(new URL('../.scratch/recovery-progress/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../.scratch/recovery-progress/driven-${dir}.json`, import.meta.url), JSON.stringify({ kind: 'actual Vehicle.update at 60Hz on synthetic road; no pose changes before overtake', changes, earned, towStation: target }, null, 2));
  t.diagnostic(JSON.stringify(changes));
});
const data = JSON.parse(readFileSync(new URL('../data/maps/psychiko/map.json', import.meta.url)));
registerMapEvents('psychiko', data.events);
for (const type of ['sprint', 'timetrial']) for (const toggle of [false, true]) test(`Psychiko ${type}: default/toggle=${toggle}, full laps, grid, AI direction and guidance`, () => {
  const route = new Route(data.route), base = getEvents('psychiko').find(e => e.type === type), def = applySetup(base, { reverse: toggle }, { closed: true });
  const run = new EventRun(def, { route, marks: data.marks }, { storage: { getItem() { return null; }, setItem() {} } }); run.start();
  // One-way streets and roundabouts: a reverse toggle (stale saved setup) still runs Psychiko forwards.
  const dir = 1; assert.equal(run.r.dir, dir); assert.notEqual(def.reverse, true); assert.equal(run.r.laps, type === 'sprint' ? 2 : 1);
  const slots = [0, 1, 2].map(i => raceGridSlot(route, run.r.s0, dir, i, spec.length));
  assert.ok(slots.every(slot => (slot.s - run.r.s0) * dir <= 0));
  const vehicle = new Vehicle(spec, route); vehicle.reset(slots[0].s, slots[0].u); vehicle.yaw = slots[0].yaw;
  assert.equal(travelDirection(vehicle, route), dir);
  const ai = new RivalAI(route, vehicle, { dir }); assert.ok(Number.isFinite(ai.update(1/60, { traffic: [], racers: [] }).steer));
  const guidance = new DrivingGuidance().update(vehicle, route, { dir }); assert.equal(guidance.available, true);
  const expected = route.point(vehicle.s + dir * 4, 0);
  assert.ok(Math.hypot(guidance.nodes[1].x - expected.x, guidance.nodes[1].z - expected.z) < .1);
  const spawn = type === 'sprint' ? slots[2] : soloStartPosition(route, run.r.s0, dir);
  const startD = (spawn.s - run.r.s0) * dir;
  let finish;
  for (let d = startD; d <= run.r.len + 2; d += 2) {
    const s = run.r.s0 + dir * d, p = route.point(s, 0), out = run.update(.05, { ...p, s, u: 0, t: (d - startD + 2) / 40 });
    finish = out.find(e => e.kind === 'finish'); if (finish) break;
  }
  assert.ok(finish, 'the whole route is tracked to a finish'); assert.equal(run.lapTimes.length, run.r.laps); assert.equal(courseComplete(run.course), true);
  assert.ok(Math.abs(finish.time - (run.r.len - startD + 2) / 40) < .1);
});
test('Psychiko free roam spawns and guides along the route direction without changing geometry', () => {
  const route = new Route(data.route), resolved = resolve(freeRoam('psychiko'), { route, marks: data.marks });
  assert.equal(resolved.dir, 1); const start = soloStartPosition(route, resolved.s0, resolved.dir, true);
  const v = new Vehicle(spec, route); v.reset(start.s, start.u);
  assert.equal(travelDirection(v, route), 1); const guide = new DrivingGuidance().update(v, route);
  assert.equal(guide.available, true); assert.ok(Math.abs(guide.nodes[1].s - route.wrap(v.s + 4)) < .01);
  assert.equal(route.X[0], Math.fround(data.route.x[0])); assert.equal(route.Z[1], Math.fround(data.route.z[1]));
});
