// Owner decision 2026-10-18: "we just want to tow back onto the road". A tow, reset or recovery puts the car on the
// nearest drivable road to where it is, centred in a lane, facing the direction closest to its heading. In a race the
// route wins within 40 m, a tow never lands before the latest valid on-road pose, and it never grants progress.
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameCore } from '../server/core.mjs';
import { resolveMap } from '../server/map-definitions.mjs';
import { Route } from '../src/map.js';
import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { routeTowAdapter } from '../src/road-recovery.js';
import { planTow, rawRoute, RoadIndex, roadSegments, segmentPose, ROUTE_PREFERENCE } from '../src/tow-placement.js';
const load = async file => JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
const riviera = await load('data/map.json'), psychiko = await load('data/maps/psychiko/map.json');
const forward = yaw => [-Math.sin(yaw), -Math.cos(yaw)];
const headingOf = (dx, dz) => Math.atan2(-dx, -dz);
function world(data, corridors = []) {
  const route = new Route(data.route, { corridors }), segments = roadSegments(data.roadNetwork.roads), index = new RoadIndex(segments);
  return { data, route, segments, index, client: routeTowAdapter(route), server: rawRoute({ ...data.route, corridors }) };
}
const R = world(riviera, RIVIERA_TUNNELS), P = world(psychiko);
const routeDistance = (w, x, z) => { const q = w.route.project(x, z, null); return Math.hypot(x - w.route.frame(q.s, {}).x, z - w.route.frame(q.s, {}).z) - w.route.edge(q.s); };
// A street point of two-way, car-width tarmac whose distance from the race route is in [lo, hi] metres.
function streetPoint(w, lo, hi, { oneway = false, skip = 0, stations = [0, Infinity], isolated = 0 } = {}) {
  let n = 0;
  for (const g of w.segments) {
    if (g.L < 3 || !!g.road.oneway !== oneway || g.hw * 2 < 5) continue;
    const x = g.ax + g.dx / 2, z = g.az + g.dz / 2, d = routeDistance(w, x, z);
    // On a street that is clear of crossing streets, so the nearest road is unambiguous.
    const at = w.route.project(x, z, null).s;
    if (d < lo || d > hi || at < stations[0] || at > stations[1]) continue;
    // Isolated: no other road within `isolated` metres of either side, so the nearest road is unambiguous.
    if (isolated && [1, -1].some(side => w.index.near(x - g.dz / g.L * side * isolated, z + g.dx / g.L * side * isolated, 12, isolated).some(c => c.seg.road !== g.road))) continue;
    if (n++ >= skip) return { g, x, z, d };
  }
  throw new Error('no street in range');
}
// A point beside the route, `away` metres beyond its edge, with no street nearer than the route.
function fieldBesideRoute(w, away, from = 500) {
  for (let s = from; s < w.route.length - 100; s += 97) {
    const side = s % 2 ? 1 : -1, p = w.route.point(s, side * (w.route.edge(s) + away));
    if (w.index.near(p.x, p.z, 1)[0].edge > away + 20 && !(w.route.localLayout?.contains(s))) return { s, side, x: p.x, z: p.z };
  }
  throw new Error('no field');
}
const lateral = (g, x, z) => (x - g.ax) * -g.dz / g.L + (z - g.az) * g.dx / g.L;

test('free roam: a car 30 m off into a field is towed to the nearest road, lane-centred, facing its heading', () => {
  for (const w of [R, P]) {
    const f = fieldBesideRoute(w, 30), tangent = w.route.frame(f.s, {});
    for (const d of [1, -1]) {
      const yaw = headingOf(tangent.tx * d, tangent.tz * d) + .3 * d;
      for (const adapter of [w.client, w.server]) {
        const plan = planTow({ x: f.x, z: f.z, yaw, route: adapter, index: w.index });
        assert.equal(plan.kind, 'route'); assert.ok(plan.distance > 24 && plan.distance < 50, `towed ${plan.distance} m`);
        const at = w.route.frame(plan.s, {}), [fx, fz] = forward(plan.yaw);
        assert.ok(fx * at.tx * d + fz * at.tz * d > .99, 'faces the direction closest to the heading');
        const centre = w.route.closed ? 0 : d * (w.route.medHalf(plan.s) + w.route.edge(plan.s)) / 2;
        assert.ok(Math.abs(plan.u - centre) < .6, `lane centre ${plan.u} vs ${centre}`);
        assert.ok(Math.abs(plan.u) + 1 <= w.route.edge(plan.s), 'the whole car is on the carriageway');
      }
    }
  }
});

test('free roam: the nearest road may be a side street: on its tarmac, lane-centred, facing along it by heading', () => {
  for (const [w, lo] of [[R, 90], [P, 120]]) {
    const { g, x, z } = streetPoint(w, lo, 5000, { isolated: 16 }), nx = -g.dz / g.L, nz = g.dx / g.L;
    for (const d of [1, -1]) {
      const car = { x: x + nx * 14, z: z + nz * 14 }, yaw = headingOf(g.dx / g.L * d, g.dz / g.L * d) + .2;
      const plan = planTow({ ...car, yaw, route: w.client, index: w.index });
      assert.equal(plan.kind, 'road'); assert.ok(plan.distance < 14 + g.hw + 2, `towed ${plan.distance} m`);
      const [fx, fz] = forward(plan.yaw);
      assert.ok(fx * g.dx / g.L * d + fz * g.dz / g.L * d > .95, 'faces the direction closest to the heading');
      // Right-hand traffic: the lane centre is half the half-width right of the axis for the way it faces
      // (lateral > 0 is right of the segment direction).
      assert.ok(Math.abs(Math.abs(lateral(g, plan.x, plan.z)) - g.hw / 2) < .4, 'lane-centred');
      assert.ok(Math.sign(lateral(g, plan.x, plan.z)) === d, 'the right-hand lane for the facing direction');
      assert.ok(Math.abs(plan.u) >= w.route.edge(plan.s) + 2.5, 'the whole car is off the route surface');
    }
  }
  const one = streetPoint(R, 90, 5000, { oneway: true, isolated: 14 }), g = one.g;
  for (const d of [1, -1]) {
    const plan = planTow({ x: one.x - g.dz / g.L * 12, z: one.z + g.dx / g.L * 12, yaw: headingOf(g.dx / g.L * d, g.dz / g.L * d), route: R.client, index: R.index });
    assert.equal(plan.kind, 'road'); const [fx, fz] = forward(plan.yaw);
    assert.ok(fx * g.dx / g.L + fz * g.dz / g.L > .999, 'a one-way street is faced the way it flows');
  }
});

test('race: the route wins within 40 m, otherwise the nearest road; never before the latest valid pose', () => {
  const near = streetPoint(P, 18, 30), far = streetPoint(P, 120, 5000);
  const q = P.route.project(near.x, near.z, null), course = { s0: 0, dir: 1, floor: 0, ref: q.s };
  // On a side street 25 m from the route: free roam keeps the car on the street, a race puts it back on the route.
  const yaw = headingOf(near.g.dx / near.g.L, near.g.dz / near.g.L);
  assert.equal(planTow({ x: near.x, z: near.z, yaw, route: P.client, index: P.index }).kind, 'road');
  const race = planTow({ x: near.x, z: near.z, yaw, route: P.client, index: P.index, course });
  assert.equal(race.kind, 'route'); assert.ok(race.distance <= near.d + 25);
  for (const adapter of [P.client, P.server]) assert.ok(Math.abs(planTow({ x: near.x, z: near.z, yaw, route: adapter, index: P.index, course }).s - race.s) < 1.5, 'client and server agree');
  // The preference radius is exactly the 40 m the owner asked for.
  assert.equal(ROUTE_PREFERENCE, 40);
  // Far from the route the nearest road is the street the car is on, race or not.
  const faryaw = headingOf(far.g.dx / far.g.L, far.g.dz / far.g.L), fq = P.route.project(far.x, far.z, null);
  const away = planTow({ x: far.x, z: far.z, yaw: faryaw, route: P.client, index: P.index, course: { s0: 0, dir: 1, floor: 0, ref: fq.s } });
  assert.equal(away.kind, 'road'); assert.ok(away.distance < far.g.hw + 3);
  // Never before the latest valid on-road pose: a floor ahead of the nearest route point moves the placement forward.
  for (const dir of [1, -1]) {
    const ref = dir > 0 ? q.s : -q.s, floor = Math.max(0, dir * ref) + 60;
    const held = planTow({ x: near.x, z: near.z, yaw, route: P.server, index: P.index, dir, course: { s0: 0, dir, floor, ref } });
    assert.equal(held.kind, 'route'); assert.ok(held.s * dir >= floor - 1e-6, `placed at ${held.s}, floor ${floor}`);
  }
});

test('a tow clears traffic and obstacles by sliding along the road', () => {
  const f = fieldBesideRoute(R, 30), tangent = R.route.frame(f.s, {}), yaw = headingOf(tangent.tx, tangent.tz);
  const first = planTow({ x: f.x, z: f.z, yaw, route: R.client, index: R.index });
  const blocked = planTow({ x: f.x, z: f.z, yaw, route: R.client, index: R.index, clear: p => Math.hypot(p.x - first.x, p.z - first.z) > 5 });
  assert.equal(blocked.clear, true); assert.ok(Math.hypot(blocked.x - first.x, blocked.z - first.z) > 5 && blocked.kind === 'route');
  assert.ok(Math.abs(Math.abs(blocked.u) - Math.abs(first.u)) < .6, 'still lane-centred on the same road');
  // Nothing clear: the nearest spot is still returned, marked blocked, rather than no tow at all.
  const nowhere = planTow({ x: f.x, z: f.z, yaw, route: R.client, index: R.index, clear: () => false });
  assert.equal(nowhere.clear, false); assert.ok(Math.hypot(nowhere.x - first.x, nowhere.z - first.z) < .01);
  // In a race the slide never goes before the floor.
  const q = R.route.project(f.x, f.z, null), floor = q.s;
  const raced = planTow({ x: f.x, z: f.z, yaw, route: R.client, index: R.index, course: { s0: 0, dir: 1, floor, ref: q.s }, clear: p => Math.hypot(p.x - first.x, p.z - first.z) > 5 });
  assert.ok(raced.s >= floor - 1e-6);
});

test('client and server plan the same pose from the same car (Psychiko, both adapters)', () => {
  let compared = 0;
  for (let s = 40; s < P.route.length; s += 83) for (const away of [8, 25, 70]) for (const yaw of [0, 1.9, 4]) {
    const side = s % 2 ? 1 : -1, p = P.route.point(s, side * (P.route.edge(s) + away));
    const a = planTow({ x: p.x, z: p.z, yaw, route: P.client, index: P.index }), b = planTow({ x: p.x, z: p.z, yaw, route: P.server, index: P.index });
    assert.equal(a.kind, b.kind); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .6, `agree at ${s}/${away}: ${Math.hypot(a.x - b.x, a.z - b.z)}`);
    assert.ok(Math.abs(a.yaw - b.yaw) < .05 || Math.abs(Math.abs(a.yaw - b.yaw) - 2 * Math.PI) < .05); compared++;
  }
  assert.ok(compared > 100);
});

// The authoritative server, with real Psychiko geometry and its street network.
const socket = () => ({ readyState: 1, messages: [], send(d) { this.messages.push(JSON.parse(d)); }, close() { this.readyState = 3; } });
const map = resolveMap({ id: 'psychiko' }, psychiko), event = map.definitions.get('psychiko-race'), route = P.route;
function race(t) {
  let now = 1e6; t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps: new Map([['riviera', map], ['psychiko', map]]), defaultMap: 'psychiko', cars: new Set(['mini']), leaderboard: { submit: async () => ({}) }, countdownMs: 100 });
  const ws = socket(), other = socket(), send = m => core.message(ws, JSON.stringify(m));
  core.connect(ws, 'driver', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(other, 'other', { protocol: MULTIPLAYER_PROTOCOL });
  send({ type: 'create', mapId: 'psychiko', eventId: 'psychiko-race' });
  const lobby = [...core.lobbies.values()][0]; core.message(other, JSON.stringify({ type: 'join', code: lobby.code }));
  send({ type: 'start', force: true }); now += 100; core.tick();
  let epoch = 1, last = null;
  const api = {
    core, ws, lobby, send, get now() { return now; }, advance(ms) { now += ms; },
    // One accepted state at (x, z) facing `yaw`, with route coordinates as the client physics reports them.
    state(x, z, yaw, { stopped = false } = {}) {
      const q = route.project(x, z, last?.s ?? 0, 8), f = route.frame(q.s, {});
      last = { x, y: f.y, z, yaw, s: q.s, u: q.u, vLong: stopped ? 0 : 20, vLat: 0, steer: 0, rpm: 3000, gear: 3, sampleTime: now, motionEpoch: epoch };
      send({ type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: last }); return last;
    },
    // A straight run from the car's last place to (x, z), in 6 m samples of .3 s.
    runTo(x, z) {
      const from = last, n = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / 6)), yaw = headingOf((x - from.x) / (n * 6 || 1), (z - from.z) / (n * 6 || 1));
      for (let i = 1; i <= n; i++) { now += 300; api.state(from.x + (x - from.x) * i / n, from.z + (z - from.z) * i / n, yaw); }
    },
    tow() { epoch++; send({ type: 'recover', raceId: lobby.raceId, generation: lobby.generation, motionEpoch: epoch }); return ws.messages.at(-1); },
    get course() { return core.clientData(ws).course; }, get driver() { return core.clientData(ws); },
    stopped(x, z, yaw) { epoch = Math.max(epoch, 1); return api.state(x, z, yaw, { stopped: true }); },
  };
  api.begin = s => { const p = route.point(s, 2), f = route.frame(s, {}); last = null; now += 300; api.state(p.x, p.z, headingOf(f.tx, f.tz)); };
  return api;
}
const driveRoute = (r, from, to) => { for (let s = from; s <= to; s += 6) { const p = route.point(s, 2), f = route.frame(s, {}); r.advance(300); r.state(p.x, p.z, headingOf(f.tx, f.tz)); } };
test('server (b): 20 m into a side street in a race, a tow lands back on the route at the nearest point, not earlier', t => {
  const r = race(t), street = streetPoint(P, 18, 26, { skip: 5, stations: [300, 3000] }), q = route.project(street.x, street.z, null);
  r.advance(500); r.begin(0); driveRoute(r, 6, q.s);
  const left = r.course.lastRoad.s, start = route.point(q.s, 2);
  // Leave the route for the street through the off-route chord.
  r.runTo(street.x, street.z);
  const before = { progress: r.course.validProgress, reached: r.course.reached };
  const ack = r.tow();
  assert.equal(ack.type, 'recovered'); assert.equal(ack.kind, 'route', 'the route is within 40 m');
  assert.ok(ack.s >= left - 1e-6, `never earlier than where the car left the route (${ack.s} < ${left})`);
  assert.ok(Math.hypot(ack.x - street.x, ack.z - street.z) < 45, 'at the nearest point of the route');
  assert.equal(r.course.validProgress, before.progress); assert.equal(r.course.reached, before.reached, 'the tow granted nothing');
  assert.ok(Math.abs(route.project(ack.x, ack.z, null).u) < route.edge(ack.s), 'on the carriageway');
});
test('server (c): 300 m down a non-route road, a tow lands on the nearest road there and progress is unchanged', t => {
  const r = race(t), target = streetPoint(P, 250, 600, { stations: [300, 3000] }), q = route.project(target.x, target.z, null);
  r.advance(500); r.begin(0); driveRoute(r, 6, q.s);
  const before = { progress: r.course.validProgress, reached: r.course.reached };
  r.runTo(target.x, target.z);
  const ack = r.tow();
  assert.equal(ack.type, 'recovered'); assert.equal(ack.kind, 'road', 'the nearest road is the street, not a route 300 m away');
  assert.ok(Math.hypot(ack.x - target.x, ack.z - target.z) < target.g.hw + 3, 'where the car is');
  assert.ok(Math.abs(Math.abs(lateral(target.g, ack.x, ack.z)) - target.g.hw / 2) < .6 || target.g.road.oneway, 'lane-centred');
  assert.equal(r.course.validProgress, before.progress); assert.equal(r.course.reached, before.reached);
  assert.equal(r.course.onRoute, false, 'off the route, so the invisible rules still count nothing');
  // The hold keeps the car where the server put it; a claimed pose on the route is ignored.
  r.advance(100); const claimed = route.point(ack.s, 2); r.state(claimed.x, claimed.z, ack.yaw, { stopped: true });
  assert.ok(Math.hypot(r.driver.state.x - ack.x, r.driver.state.z - ack.z) < .01, 'a pose elsewhere is rejected during the hold');
  r.advance(100); r.stopped(ack.x, ack.z, ack.yaw); assert.ok(Math.hypot(r.driver.state.x - ack.x, r.driver.state.z - ack.z) < 3);
  r.advance(400); r.state(ack.x, ack.z, ack.yaw);
  assert.equal(r.course.reached, before.reached, 'driving on from the side street still earns nothing');
});
test('server (d): a tow cannot advance race progress, whatever the client claims', t => {
  const r = race(t), near = streetPoint(P, 18, 26, { skip: 8, stations: [300, 2000] }), q = route.project(near.x, near.z, null);
  r.advance(500); r.begin(0); driveRoute(r, 6, q.s);
  const claim = route.point(2800, 2);
  r.runTo(near.x, near.z);
  const earned = r.course.reached;
  r.send({ type: 'recover', raceId: r.lobby.raceId, generation: r.lobby.generation, motionEpoch: 2, s: 2800, x: claim.x, z: claim.z });
  const ack = r.ws.messages.at(-1); assert.equal(ack.type, 'recovered');
  assert.ok(Math.hypot(ack.x - near.x, ack.z - near.z) < 45, 'placed from the server\'s own last pose, not the claim');
  assert.ok(Math.abs(ack.s - 2800) > 500);
  assert.equal(r.course.reached, earned, 'reached did not move'); assert.ok(r.course.validProgress <= earned);
  // Repeated tows, even chained, creep nowhere: each starts from the server's last accepted pose.
  r.advance(1500); r.stopped(ack.x, ack.z, ack.yaw); r.advance(300);
  r.send({ type: 'recover', raceId: r.lobby.raceId, generation: r.lobby.generation, motionEpoch: 3 });
  const again = r.ws.messages.at(-1); assert.equal(again.type, 'recovered');
  assert.ok(Math.hypot(again.x - ack.x, again.z - ack.z) < 12, 'a second tow stays where the first put the car');
  // Driving on from the placement earns only what driving to that point on the route would have: never the claim.
  assert.ok(r.course.reached - earned <= near.d + 10 && r.course.reached < 2000, `reached ${r.course.reached} vs ${earned}`);
});
test('server free roam: no course, nearest road, facing the heading', t => {
  let now = 1e6; t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps: new Map([['riviera', map], ['psychiko', map]]), defaultMap: 'psychiko', cars: new Set(['mini']), leaderboard: { submit: async () => ({}) }, countdownMs: 100 });
  const ws = socket(), other = socket(), send = m => core.message(ws, JSON.stringify(m));
  core.connect(ws, 'driver', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(other, 'other', { protocol: MULTIPLAYER_PROTOCOL });
  send({ type: 'create', mapId: 'psychiko', eventId: 'free:psychiko' });
  const lobby = [...core.lobbies.values()][0]; core.message(other, JSON.stringify({ type: 'join', code: lobby.code }));
  send({ type: 'start', force: true }); now += 100; core.tick();
  const { g, x, z } = streetPoint(P, 120, 600, { isolated: 18 }), car = { x: x - g.dz / g.L * 16, z: z + g.dx / g.L * 16 }, yaw = headingOf(g.dx / g.L, g.dz / g.L) + .1;
  now += 300; send({ type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: { ...car, y: 0, yaw, s: 0, u: 16, vLong: 1, vLat: 0, steer: 0, rpm: 900, gear: 1, motionEpoch: 1 } });
  send({ type: 'recover', raceId: lobby.raceId, generation: lobby.generation, motionEpoch: 2 });
  const ack = ws.messages.at(-1); assert.equal(ack.type, 'recovered'); assert.equal(ack.kind, 'road');
  assert.ok(Math.hypot(ack.x - x, ack.z - z) < 20); const [fx, fz] = forward(ack.yaw); assert.ok(fx * g.dx / g.L + fz * g.dz / g.L > .99);
});
