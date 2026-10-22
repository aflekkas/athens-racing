import * as roundaboutHelpers from '../src/roundabouts.js';
import { impactTarget, LIFE, STEP } from '../src/impact-ragdoll.js';
// Deterministic 60 Hz decisions AND real Vehicle motion. No renderer/model mocks
// enter the rival controller. Traffic model construction is skipped, as in traffic-test.
// node --import ./tools/physics-test/register.mjs --test tools/ai-driving.test.mjs
import './physics-test/register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { Vehicle } = await import('../src/physics.js');
const { Route } = await import('../src/map.js');
import * as THREE from './physics-test/three-stub.mjs';
const { RNG, clamp, lerp, smoothstep } = await import('../src/util.js');
import { damageIncrement, equivalentBarrierSpeed } from '../src/damage-math.js';
const root = new URL('../', import.meta.url), artifacts = new URL('.scratch/ai-overtake/', root);
mkdirSync(artifacts, { recursive: true });
const baseline = process.env.AI_BASELINE === '1';
const aiSource = readFileSync(new URL(baseline ? '.scratch/ai-overtake/before-rival-ai.js' : 'src/rival-ai.js', root), 'utf8');
const { RivalAI } = await import('data:text/javascript,' + encodeURIComponent(aiSource.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>'from '+JSON.stringify(new URL(path,new URL('src/rival-ai.js',root)).href))));
const trafficSource = readFileSync(new URL(baseline ? '.scratch/ai-overtake/before-traffic.js' : 'src/traffic.js', root), 'utf8');
const { Traffic } = new Function('THREE', 'RNG', 'clamp', 'lerp', 'smoothstep', 'ROAD', 'LANE_W', 'damageIncrement', 'equivalentBarrierSpeed', 'impactTarget', 'LIFE', 'STEP', 'roundaboutHelpers',
  'const {circulatingPoint,roundaboutRange,entryYieldDistance,ringStation,ringPoint,polylinePoint,polylineStation,trafficRoundaboutRange,roundaboutYield}=roundaboutHelpers;\n'+trafficSource.replace(/^import .*;$/gm, '').replace(/^export /gm, '') + '\nreturn { Traffic };')(
  THREE, RNG, clamp, lerp, smoothstep, { gutter: 0.3 }, 3.5, damageIncrement, equivalentBarrierSpeed, impactTarget, LIFE, STEP, roundaboutHelpers);
const catalogue = readFileSync(new URL('src/cars.js', root), 'utf8');
const spec = Function('return ' + catalogue.split('export const CARS = ')[1].split('\n];')[0] + '\n];')().find(c => c.id === 'z4');
// A straight synthetic road has exactly zero curvature at any sampling spacing.
// Coarse planning nodes keep the harness quick; real Riviera uses production spacing.
const dt = 1 / 60;
function road({ divided = false, wide = false } = {}) {
  return { synthetic: true, length: 2400, closed: false, edge: () => wide ? 8 : 4.5, div: () => divided ? 1 : 0, medHalf: () => divided ? 1.2 : 0,
    lanes: () => wide ? 2 : 1, laneU: (_, lane) => divided ? 3 : 2.25 + lane * 3.5, curv: () => 0, y: () => 0, surfaceY: () => 0,
    urban: () => 1, district: () => 'town', TX: 'TX', TZ: 'TZ', lin: a => a === 'TZ' ? -1 : 0,
    frame: (_, o) => Object.assign(o, { x: 0, z: -_, tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }),
    point: (s, u, o = {}) => Object.assign(o, { x: u, y: 0, z: -s }), project: (x, z) => ({ s: -z, u: x }) };
}
function make(route, s = 500, u = 2.25, speed = 20, dir = 1, aggression = 0.8) {
  const veh = new Vehicle({ ...spec }, route); veh.reset(s, u, speed); if (dir < 0) veh.yaw += Math.PI;
  veh.nitro = 0;
  let teleports = 0; const reset = veh.reset.bind(veh); veh.reset = (...a) => { teleports++; return reset(...a); };
  const controller = new RivalAI(route, veh, { dir, spacing: route.synthetic ? 12 : 2, driver: { id: 'deterministic', aggression, mistakeRate: 0 } });
  return { veh, controller, get teleports() { return teleports; } };
}
const obstacle = (s, u, vs) => ({ active: true, s, u, vs, v: Math.abs(vs), dir: Math.sign(vs), hs: 2.2, hu: 0.92 });
function overlap(v, o, route) {
  const p = route.point(o.s, o.u), frame = route.frame(o.s, {}), yaw = Math.atan2(-frame.tx, -frame.tz);
  const f = [-Math.sin(v.yaw), -Math.cos(v.yaw)], r = [Math.cos(v.yaw), -Math.sin(v.yaw)];
  const of = [-Math.sin(yaw), -Math.cos(yaw)], or = [Math.cos(yaw), -Math.sin(yaw)];
  const delta = [p.x - v.x, p.z - v.z];
  for (const a of [f, r, of, or]) {
    const extent = (f, r, l, w) => Math.abs(a[0]*f[0]+a[1]*f[1])*l + Math.abs(a[0]*r[0]+a[1]*r[1])*w;
    if (Math.abs(delta[0]*a[0]+delta[1]*a[1]) >= extent(f,r,v.halfL,v.halfW)+extent(of,or,o.hs,o.hu)) return false;
  }
  return true;
}
const results = [];
function record(name, result, state) {
  results.push({ name, ...result });
  writeFileSync(new URL(`${baseline ? 'before' : 'after'}-${name}.json`, artifacts), JSON.stringify({ result, state }, null, 2));
}
function runPass(name, { incoming = false, divided = false, abort = false, dir = 1, racer = false, wide = false, aggression = 0.8, real = false } = {}) {
  const route = real ? new Route(JSON.parse(readFileSync(new URL('data/map.json', root))).route) : road({ divided, wide });
  if (real) { route.urban = () => 1; }
  const s0 = real ? 2320 : 500, bot = make(route, s0, dir * route.laneU(s0, 0), 20, dir, aggression);
  const leader = obstacle(s0 + dir * 40, bot.veh.u, dir * 11), cars = [leader];
  if (real) cars.push(obstacle(leader.s, dir * route.laneU(leader.s, 1), dir * 11));
  if (incoming) cars.push(obstacle(500 + dir * 320, -bot.veh.u, -dir * 18));
  let contacts = 0, contactFrames = 0, touching = false, offroadFrames = 0, wallFrames = 0, firstCross = null, passedAt = null, incomingPassedAt = null, abortAdded = false;
  const state = [];
  // Racers use actual fresh actor records, not the traffic adapter.
  const leaderVeh = racer ? make(route, leader.s, leader.u, 11, dir).veh : null;
  for (let step = 0; step < 36 / dt; step++) {
    const t = step * dt, v = bot.veh;
    const input = bot.controller.update(dt, { traffic: cars.filter(c => !racer || c !== leader), racers: leaderVeh ? [{ veh: leaderVeh }] : [] });
    if (abort && !abortAdded && v.u * dir < -0.4) { cars.push(obstacle(v.s + dir * 150, -dir * 2.25, -dir * 18)); abortAdded = true; }
    for (const c of cars) c.s += c.vs * dt;
    if (leaderVeh) { leaderVeh.s = leader.s; leaderVeh.z = -leader.s; }
    v.wallHit = 0; v.update(dt, input);
    const hit = cars.some(c => overlap(v, c, route)); contactFrames += hit ? 1 : 0; if (hit && !touching) contacts++; touching = hit;
    const frame = route.frame(v.s, {}), localYaw = v.yaw - Math.atan2(-frame.tx, -frame.tz);
    const lateralExtent = Math.abs(Math.cos(localYaw)) * v.halfW + Math.abs(Math.sin(localYaw)) * v.halfL;
    if (Math.abs(v.u) + lateralExtent > route.edge(v.s) || divided && v.u * dir - lateralExtent < route.medHalf(v.s)) offroadFrames++;
    if (v.wallHit > 0.01) wallFrames++;
    if (firstCross === null && v.u * dir < -0.5) firstCross = t;
    if (passedAt === null && (v.s - leader.s) * dir > v.halfL + leader.hs + 8) passedAt = t;
    if (incoming && incomingPassedAt === null && (cars[1].s - v.s) * dir < -v.halfL - cars[1].hs) incomingPassedAt = t;
    if (step % 6 === 0) state.push({ t, s: v.s, u: v.u, yaw: v.yaw, speed: v.vLong, input, debug: bot.controller.debug, cars: cars.map(c => ({ ...c })) });
  }
  const result = { contacts, contactFrames, offroadFrames, wallFrames, teleports: bot.teleports, firstCross, passedAt, incomingPassedAt, overtakes: bot.controller.overtakes ?? 0, abortedPasses: bot.controller.abortedPasses ?? 0, finalU: bot.veh.u, progress: (bot.veh.s - s0) * dir };
  record(name, result, state);
  if (!baseline) {
    assert.equal(contacts, 0, name + ' contacts'); assert.equal(offroadFrames, 0, name + ' offroad'); assert.equal(wallFrames, 0); assert.equal(bot.teleports, 0);
    if (divided) assert.equal(firstCross, null);
    else if (abort) { assert.ok(abortAdded); assert.ok(result.abortedPasses > 0); }
    else { assert.ok(firstCross !== null || wide, name + ' entered oncoming lane'); assert.ok(passedAt !== null, name + ' passed'); assert.ok(result.overtakes > 0, name + ' completed'); assert.ok(bot.veh.u * dir > 0.5, name + ' returned'); }
    if (incoming) assert.ok(firstCross > incomingPassedAt, 'waited until approaching traffic passed');
  }
}
for (const [name, options] of [ ['clear', {}], ['wait', { incoming: true }], ['divided', { divided: true }], ['abort', { abort: true }], ['reverse', { dir: -1 }], ['player-pass', { racer: true }], ['right-pass', { racer: true, wide: true }], ['cautious', { aggression: 0.35 }], ['riviera', { real: true }] ]) test(name, () => runPass(name, options));
for (const dir of [1, -1]) for (const wide of [true, false]) test(`rival-headon-${dir}${wide ? "" : "-narrow"}`, () => {
  const route = road({ wide }), bot = make(route, 500, dir * 2.25, 18, dir), player = make(route, 500 + dir * 110, dir * 2.25, 23, -dir).veh;
  const state = []; let sign = null, reversals = 0, contacts = 0, committed = false;
  for (let step = 0; step < 8 / dt; step++) {
    // Deliberately wobble the threat across the original centre line. New actor wrapper each frame.
    player.u = dir * 2.25 + Math.sin(step * 0.21) * 0.65; player.x = player.u;
    const input = bot.controller.update(dt, { racers: [{ veh: player }] }), e = bot.controller.evade;
    if (e) { committed = true; const s = Math.sign(bot.controller.debug.desiredU - dir * 2.25); if (sign !== null && s !== sign) reversals++; sign = s; }
    bot.veh.update(dt, input); player.s -= dir * 23 * dt; player.z = -player.s;
    if (overlap(bot.veh, { ...player, hs: player.halfL, hu: player.halfW }, route)) contacts++;
    if (step % 6 === 0) state.push({ t: step * dt, u: bot.veh.u, steer: input.steer, debug: bot.controller.debug });
  }
  record(`rival-headon-${dir}${wide ? "" : "-narrow"}`, { committed, reversals, contacts, side: sign }, state);
  if (!baseline) { assert.ok(committed); assert.equal(reversals, 0); assert.equal(sign, wide ? dir : -dir); assert.equal(contacts, 0); }
});
for (const dir of [1, -1]) test(`traffic-headon-${dir}`, () => {
  const T = Object.create(Traffic.prototype), route = road({ wide: true }), rng = new RNG(17);
  Object.assign(T, { route, rng, t: 0, cars: [], racers: [], objs: [], sites: [], wrecks: [], honks: [], sounds: [], roadSpeed: () => 20, maybeTask() {}, laneChange() {}, overtakeLogic() {} });
  const c = { id: 1, s: 500, u: dir * 2.25, dir, lane: 0, v: 18, len: 4.4, wid: 1.8, kind: 'sedan', type: {}, active: true, indL: {}, indR: {}, flash: {},
    drv: { arch: 'normal', agg: 0.3, rt: 0.4, freeze: 0, horn: 1, mirror: 0.35, indicate: 1, a: 1.6, b: 3, T: 1.2, s0: 2.2, vf: 1, latV: 1.5, patience: 40 } };
  T.initDrive(c); const player = {}, state = []; let sign = null, reversals = 0, velocityReversals = 0, committed = false, contacts = 0;
  let ps = 500 + dir * 110;
  for (let step = 0; step < 8 / dt; step++) {
    const R = { a: { veh: player }, kind: 'player', s: ps, u: dir * 2.25 + Math.sin(step * 0.21) * 0.65, vs: -dir * 23, vu: 0, hs: 2.2, hu: 0.9 };
    T.racers = [R]; T.objs = [R]; T.t += dt; T.drive(c, dt); ps -= dir * 23 * dt;
    if (c.evade) { committed = true; const s = Math.sign(c.evade.uT - dir * 2.25); if (sign !== null && s !== sign) reversals++; sign = s; if (c.uv * sign < -1e-6) velocityReversals++; }
    if (Math.abs(ps - c.s) < c.hs + R.hs && Math.abs(R.u - c.u) < c.hu + R.hu) contacts++;
    if (step % 6 === 0) state.push({ t: step * dt, u: c.u, uv: c.uv, target: c.uT, evading: !!c.evade });
  }
  record(`traffic-headon-${dir}`, { committed, reversals, velocityReversals, contacts, side: sign }, state);
  if (!baseline) { assert.ok(committed); assert.equal(reversals, 0); assert.equal(velocityReversals, 0); assert.equal(sign, dir); assert.equal(contacts, 0); }
});
test('seeded traffic races measure overtakes and contact rate', () => {
  const route = road(), races = [];
  for (let seed = 1; seed <= 6; seed++) {
    const rng = new RNG(seed), bot = make(route, 100, 2.25, 20, 1, rng.range(0.45, 0.95));
    const cars = [obstacle(145, 2.25, 10), obstacle(380, 2.25, 12), obstacle(720, 2.25, 14),
      obstacle(rng.range(800, 1200), -2.25, -rng.range(12, 20))];
    let contacts = 0, contactFrames = 0, touching = false, walls = 0, offroad = 0, finish = null;
    for (let step = 0; step < 240 / dt; step++) {
      const v = bot.veh, input = bot.controller.update(dt, { traffic: cars });
      for (const c of cars) c.s += c.vs * dt;
      v.wallHit = 0; v.update(dt, input);
      const hit = cars.some(c => overlap(v, c, route)); contactFrames += hit ? 1 : 0; if (hit && !touching) contacts++; touching = hit;
      if (v.wallHit > 0.01) walls++;
      if (Math.abs(v.u) + Math.abs(Math.cos(v.yaw))*v.halfW + Math.abs(Math.sin(v.yaw))*v.halfL > route.edge(v.s)) offroad++;
      if (v.s >= 2200) { finish = (step + 1) * dt; break; }
    }
    const overtakes = cars.slice(0,3).filter(c => bot.veh.s > c.s + bot.veh.halfL + c.hs + 8).length;
    races.push({ seed, overtakes, contacts, contactFrames, walls, offroad, teleports: bot.teleports, time: finish });
    if (!baseline) { assert.ok(finish); assert.ok(overtakes >= 1); assert.equal(contacts, 0); assert.equal(walls, 0); assert.equal(offroad, 0); assert.equal(bot.teleports, 0); }
  }
  record('traffic-races', { races, overtakesPerRace: races.reduce((n,r)=>n+r.overtakes,0)/races.length,
    crashRate: races.filter(r=>r.contacts>0).length/races.length }, []);
});
test('write reproducible metrics', () => {
  writeFileSync(new URL(`${baseline ? 'before' : 'after'}-metrics.json`, artifacts), JSON.stringify({ dt, physicsHash: createHash('sha256').update(readFileSync(new URL('src/physics.js', root))).digest('hex'), controllerHash: createHash('sha256').update(aiSource).digest('hex'), results }, null, 2));
});
// Playtest 2026-10-14c D1: dodging one player must never side-swipe another
// alongside. A threat comes head-on in our lane while a second car holds the
// lane beside us (the kerb-side escape). The rival brakes and keeps its gap.
for (const dir of [1, -1]) test(`no-side-swipe-${dir}`, () => {
  const route = road({ wide: true }), bot = make(route, 500, dir * 2.25, 18, dir);
  const oncoming = make(route, 500 + dir * 110, dir * 2.25, 23, -dir).veh, beside = make(route, 500, dir * 5.75, 18, dir).veh;
  let contacts = 0, minGap = Infinity, moved = false;
  for (let step = 0; step < 8 / dt; step++) {
    // The car beside matches our progress, so it is alongside for the whole run.
    beside.s = bot.veh.s + dir * 0.5; beside.z = -beside.s;
    // ...and, like the playtest, it moves over into the lane we just left.
    // A human stops short of the rival (0.6 m), so any contact is the rival's doing.
    if (bot.controller.evade || moved) {
      moved = true;
      const stop = dir > 0 ? Math.max(2.25, bot.veh.u + 2.44) : Math.min(-2.25, bot.veh.u - 2.44);
      beside.u += clamp(stop - beside.u, -2 * dt, 2 * dt); beside.x = beside.u;
    }
    const input = bot.controller.update(dt, { racers: [{ veh: oncoming }, { veh: beside }] });
    bot.veh.update(dt, input); oncoming.s -= dir * 23 * dt; oncoming.z = -oncoming.s;
    minGap = Math.min(minGap, Math.abs(beside.u - bot.veh.u) - beside.halfW - bot.veh.halfW);
  }
  record(`no-side-swipe-${dir}`, { contacts, minGap }, []);
  if (!baseline) { assert.equal(contacts, 0); assert.ok(minGap > 0.3, `kept ${minGap.toFixed(2)} m from the car alongside`); }
});
// Playtest 2026-10-14c D1 (online, traffic on): a civilian dodged one player,
// then cut back into the other player alongside. A second racer holds the
// lane beside the civilian; it must never be side-swiped.
for (const dir of [1, -1]) test(`traffic-no-side-swipe-${dir}`, () => {
  const T = Object.create(Traffic.prototype), route = road({ wide: true }), rng = new RNG(17);
  Object.assign(T, { route, rng, t: 0, cars: [], racers: [], objs: [], sites: [], wrecks: [], honks: [], sounds: [], roadSpeed: () => 20, maybeTask() {}, laneChange() {}, overtakeLogic() {} });
  const c = { id: 1, s: 500, u: dir * 2.25, dir, lane: 0, v: 18, len: 4.4, wid: 1.8, kind: 'sedan', type: {}, active: true, indL: {}, indR: {}, flash: {},
    drv: { arch: 'normal', agg: 0.3, rt: 0.4, freeze: 0, horn: 1, mirror: 0.35, indicate: 1, a: 1.6, b: 3, T: 1.2, s0: 2.2, vf: 1, latV: 1.5, patience: 40 } };
  T.initDrive(c);
  let ps = 500 + dir * 110, bu = dir * 5.75, contacts = 0, minGap = Infinity, evaded = false;
  for (let step = 0; step < 8 / dt; step++) {
    const A = { a: { veh: {} }, kind: 'player', s: ps, u: dir * 2.25, vs: -dir * 23, vu: 0, hs: 2.2, hu: 0.9 };
    // The second player rides alongside, then (like the playtest) steers toward
    // the lane the civilian left, stopping 0.6 m short of it.
    if (c.evade || evaded) { evaded = true; bu += clamp((dir > 0 ? Math.max(2.25, c.u + 2.4) : Math.min(-2.25, c.u - 2.4)) - bu, -2 * dt, 2 * dt); }
    const B = { a: { veh: {} }, kind: 'player', s: c.s + dir * 0.5, u: bu, vs: dir * c.v, vu: 0, hs: 2.2, hu: 0.9 };
    T.racers = [A, B]; T.objs = [A, B]; T.t += dt; T.drive(c, dt); ps -= dir * 23 * dt;
    if (Math.abs(B.s - c.s) < c.len / 2 + B.hs && Math.abs(B.u - c.u) < c.wid / 2 + B.hu) contacts++;
    minGap = Math.min(minGap, Math.abs(B.u - c.u) - c.wid / 2 - B.hu);
  }
  record(`traffic-no-side-swipe-${dir}`, { contacts, minGap }, []);
  if (!baseline) { assert.equal(contacts, 0); assert.ok(minGap > 0.3, `kept ${minGap.toFixed(2)} m`); }
});
// Live game, Riviera: a rival stopped nose-to-tail behind a parked-up civilian
// sat there for the rest of the race (a car cannot step sideways at rest). It
// must back off or creep out on lock and get past, touching nothing.
for (const gap of [1.2, 3]) test(`boxed-in-${gap}`, () => {
  const route = road({ wide: true }), bot = make(route, 500, 2.25, 0, 1);
  bot.controller.launchHoldDistance = 0; // mid-race, not on the grid
  const stopped = obstacle(500 + bot.veh.halfL + 2.2 + gap, 2.25, 0);
  let contacts = 0, passedAt = null, wall = 0, maxU = 0;
  for (let step = 0; step < 25 / dt; step++) {
    const v = bot.veh, input = bot.controller.update(dt, { traffic: [stopped] });
    v.wallHit = 0; v.update(dt, input); if (v.wallHit > 0.01) wall++; maxU = Math.max(maxU, Math.abs(v.u));
    if (overlap(v, stopped, route)) contacts++;
    if (passedAt === null && v.s - stopped.s > v.halfL + stopped.hs + 3) passedAt = step * dt;
  }
  record(`boxed-in-${gap}`, { contacts, passedAt, wall, maxU }, []);
  if (!baseline) { assert.equal(contacts, 0); assert.ok(passedAt !== null && passedAt < 20, `got past at ${passedAt}`); assert.ok(maxU < route.edge(0) - 0.9, `stayed on the road (max u ${maxU.toFixed(2)})`); }
});
// main.js integrates rivals far from the player at 120 Hz (Vehicle.subH): same driving, half the cost.
test('far-rival-substep', () => {
  const data = JSON.parse(readFileSync(new URL('data/maps/penteli/map.json', root)));
  const route = new Route(data.route); route.urban = () => 1;
  const run = (subH) => {
    const v = new Vehicle({ ...spec }, route); v.reset(100, 0, 0); v.subH = subH;
    const ai = new RivalAI(route, v, { perfect: true, closedRoad: true });
    let t = 0, beta = 0;
    for (; t < 60 && v.s < 1100; t += dt) { v.update(dt, ai.update(dt)); beta = Math.max(beta, Math.abs(Math.atan2(v.vLat, Math.max(2, v.vLong)))); }
    return { t, beta, ok: [v.x, v.z, v.vLong].every(Number.isFinite) };
  };
  const fine = run(0), coarse = run(1 / 120);
  record('far-rival-substep', { fine, coarse }, []);
  if (!baseline) { assert.ok(coarse.ok); assert.ok(Math.abs(coarse.t / fine.t - 1) < 0.01, `${coarse.t} vs ${fine.t}`); assert.ok(coarse.beta < fine.beta + 0.03); }
});
// Real-traffic finding: an oncoming civilian drifting toward us, our kerb side occupied by a car alongside.
// The old escape scored the far side of the oncoming car higher and drove across its path. Never cross it.
for (const dir of [1, -1]) test(`no-escape-across-oncoming-${dir}`, () => {
  const route = road({ wide: true }), bot = make(route, 500, dir * 2.4, 18, dir);
  const beside = make(route, 500, dir * 5.9, 18, dir).veh;
  const onc = obstacle(500 + dir * 80, -dir * 1.6, -dir * 12.5); onc.vu = dir * 1.5;
  let crossed = false, contacts = 0;
  for (let step = 0; step < 6 / dt; step++) {
    beside.s = bot.veh.s; beside.z = -beside.s;
    const input = bot.controller.update(dt, { racers: [{ veh: beside }], traffic: [onc] });
    bot.veh.update(dt, input); onc.s += onc.vs * dt; onc.u = dir > 0 ? Math.min(onc.u + onc.vu * dt, -0.3) : Math.max(onc.u + onc.vu * dt, 0.3); // drifts to the centre line
    if (Math.abs(onc.s - bot.veh.s) < 8 && Math.sign(bot.veh.u - onc.u) !== Math.sign(dir)) crossed = true;
    if (overlap(bot.veh, onc, route) || overlap(bot.veh, { ...beside, hs: beside.halfL, hu: beside.halfW }, route)) contacts++;
  }
  record(`no-escape-across-oncoming-${dir}`, { crossed, contacts }, []);
  if (!baseline) { assert.equal(crossed, false, 'escaped across the oncoming car'); assert.equal(contacts, 0); }
});


test('rivals brake at civilian bumper contact even if the civilian is being pushed at their speed',()=>{
  for(const dir of [1,-1])for(const speed of [.8,8]){
    const route=road({wide:true}),{veh,controller}=make(route,500,dir*2.25,speed,dir);
    controller.elapsed=5;
    const c=obstacle(500+dir*(veh.halfL+2.2-.1),veh.u,dir*speed);
    c.dir=dir;c.crash={vs:dir*speed,vu:0,yaw:0,w:0};
    const input=controller.update(dt,{traffic:[c]});
    assert.equal(input.throttle,0);assert.ok(input.brake>0);assert.equal(controller.debug.phase,'traffic-contact');
    if(speed<1)assert.ok(input.brake<=.45,'service brake must not select reverse');
  }
});
