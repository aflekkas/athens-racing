// Every playable map must finish a race through the authoritative server, in both directions and at several lines, and a
// recovery on a circuit must stay on the leg the car was on. Megara's two straights pass 36 m apart (s 218 and s 1018): a
// car towed from the infield side of one used to be placed on the other, 800 m round the lap, where the course froze its
// progress and the race could never be finished ("the track ends halfway through").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameCore } from './core.mjs';
import { resolveMap } from './map-definitions.mjs';
import { getMap } from '../src/map-catalog.js';
import { PLAYABLE_MAPS } from '../src/enabled-maps.js';
import { effectiveEvent } from './mp-lifecycle.mjs';
import { courseProgress, courseComplete } from '../src/course.js';
import { routeTowAdapter } from '../src/road-recovery.js';
import { rawRoute, planTow } from '../src/tow-placement.js';
import { Route } from '../src/map.js';
import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
const socket = () => ({ readyState: 1, messages: [], send(d) { this.messages.push(JSON.parse(d)); }, close() {} });
const load = id => resolveMap(getMap(id), JSON.parse(readFileSync(new URL(id === 'riviera' ? '../data/map.json' : `../data/maps/${id}/map.json`, import.meta.url))));
// Open roads are driven in their legal lane (twin tunnel bores have no axis); circuits are driven on and beside the axis.
for (const id of PLAYABLE_MAPS) for (const reverse of [false, true]) for (const offset of load(id).closed ? [0, 2.5, -2.5] : [0]) test(`${id} ${reverse ? 'reverse' : 'forward'}, ${offset} m off the axis: the server finishes the race at the full distance`, t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const map = load(id), def = [...map.definitions.values()].find(e => e.type === 'sprint'), event = effectiveEvent(def, { reverse });
  const core = createGameCore({ maps: new Map([['riviera', map], [id, map]]), defaultMap: id, cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 0, raceLimitMs: 2000000 });
  const [a, b] = [socket(), socket()], send = (ws, m) => core.message(ws, JSON.stringify(m));
  for (const ws of [a, b]) core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL });
  send(a, { type: 'create', mapId: id, name: 'A' }); send(b, { type: 'join', code: a.messages.findLast(m => m.type === 'lobby').lobby.code, name: 'B' });
  if (reverse) send(a, { type: 'options', config: { reverse: true } });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: map.track.version });
  send(a, { type: 'start' }); core.tick();
  const lobby = a.messages.findLast(m => m.type === 'lobby').lobby;
  const cd = () => core.clientData(a);
  const route = new Route(map.geometry, { corridors: map.geometry.corridors });
  const pose = d => {
    const s = event.s0 + event.dir * d, u = event.closed ? offset : event.dir * route.laneU(s, 0), f = route.point(s, u), t = route.frame(s, {});
    return { s, u, x: f.x, y: f.y, z: f.z, yaw: Math.atan2(-t.tx, -t.tz) + (event.dir < 0 ? Math.PI : 0), vLong: 40, vLat: 0, steer: 0, rpm: 3000, gear: 3, sampleTime: now, motionEpoch: 1 };
  };
  let lapsSeen = 0;
  for (let d = 0; d < event.len + 30 && cd().finish === null; d += 4) {
    now += 100; send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: pose(d) });
    assert.ok(Math.abs(courseProgress(cd().course) - d) < 12, `${id}: progress stalled at ${d.toFixed(0)} m of ${event.len.toFixed(0)} m (${courseProgress(cd().course).toFixed(0)})`);
    if (event.closed && courseProgress(cd().course) >= (lapsSeen + 1) * event.lapLength) lapsSeen++;
    if (cd().finish === null) assert.equal(courseComplete(cd().course), false, 'the course never completes early');
  }
  assert.notEqual(cd().finish, null, `${id}: finished`);
  assert.ok(courseProgress(cd().course) >= event.len - 1e-6 && courseProgress(cd().course) < event.len + 12, 'finish needs the whole distance');
  if (event.closed) assert.ok(lapsSeen >= event.laps - 1, 'every lap line was crossed in order');
});
// (A car 30+ m out is within a car's width of the other straight's tarmac, and is on that road.)
test('Megara: a tow from the infield side of one straight stays on that straight, on every lap', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/maps/megara/map.json', import.meta.url))).route, route = rawRoute(raw), f = route.centre(218);
  for (const lap of [0, 1, 2]) for (const side of [-1, 1]) for (const off of [8, 16, 20, 24, 28]) {
    const ref = 218 + lap * raw.length, x = f.x - f.tz * side * off, z = f.z + f.tx * side * off;
    const tow = planTow({ x, z, yaw: Math.atan2(-f.tx, -f.tz), route, index: null, course: { s0: 0, dir: 1, floor: ref, ref }, dir: 1 });
    assert.ok(Math.abs(tow.s - ref) < 40, `lap ${lap + 1}, ${side * off} m off: towed to s ${tow.s.toFixed(0)}, not near ${ref.toFixed(0)}`);
  }
});
test('Megara: the client tow adapter keeps the same leg as the server', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/maps/megara/map.json', import.meta.url))).route, route = new Route(raw), adapter = routeTowAdapter(route), f = route.frame(218, {});
  for (const side of [-1, 1]) for (const off of [20, 24, 28]) {
    const x = f.x - f.tz * side * off, z = f.z + f.tx * side * off, ref = 218 + raw.length;
    const tow = planTow({ x, z, yaw: Math.atan2(-f.tx, -f.tz), route: adapter, index: null, course: { s0: 0, dir: 1, floor: ref, ref }, dir: 1 });
    assert.ok(Math.abs(tow.s - ref) < 40, `${side * off} m off: towed to s ${tow.s.toFixed(0)}, not near ${ref.toFixed(0)}`);
  }
});
