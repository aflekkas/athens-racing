// Owner decision 2026-10-18: no checkpoints. The server tracks every driver's progress invisibly along the
// route; only continuous on-road movement counts, so a shortcut or teleport cannot finish a race or a leaderboard run.
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameCore } from './core.mjs';
import { resolveMap } from './map-definitions.mjs';
import { Route } from '../src/map.js';
const socket = () => ({ readyState: 1, messages: [], send(d) { this.messages.push(JSON.parse(d)); }, close() { this.readyState = 3; } });
const data = JSON.parse(await readFile(new URL('../data/maps/psychiko/map.json', import.meta.url), 'utf8'));
const map = resolveMap({ id: 'psychiko' }, data), route = new Route(data.route), event = map.definitions.get('psychiko-race');
const pose = (s, u = 0) => { const p = route.point(s, u), f = route.frame(s, {}); return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-f.tx, -f.tz), s, u, vLong: 40, vLat: 0, steer: 0, rpm: 5000, gear: 4 }; };
// The sharpest street corner of the lap, and the straight chord across it.
const corner = (() => { let best = [0, 0]; for (let s = 60; s < route.length - 60; s += 4) { const a = route.frame(s - 40, {}), b = route.frame(s + 40, {}), turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz)); if (turn > best[1]) best = [s, turn]; } return best[0]; })();
function race(t) {
  let now = 1e6; t.mock.method(Date, 'now', () => now);
  const submitted = [], core = createGameCore({ maps: new Map([['riviera', map], ['psychiko', map]]), defaultMap: 'psychiko', cars: new Set(['mini']), leaderboard: { submit: async r => { submitted.push(r); return {}; } }, countdownMs: 100 });
  const honest = socket(), cutter = socket(), send = (ws, m) => core.message(ws, JSON.stringify(m));
  core.connect(honest, 'honest', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(cutter, 'cutter', { protocol: MULTIPLAYER_PROTOCOL });
  send(honest, { type: 'create', mapId: 'psychiko', eventId: 'psychiko-race' });
  const lobby = [...core.lobbies.values()][0]; send(cutter, { type: 'join', code: lobby.code });
  send(honest, { type: 'start', force: true }); now += 100; core.tick();
  return { core, honest, cutter, lobby, submitted, send, tick(ms = 150) { now += ms; core.tick(); } };
}
test('a shortcut across a street corner earns no progress and cannot finish the race or reach the leaderboard', t => {
  const r = race(t), arm = 40, a = corner - arm, b = corner + arm, end = event.len + 12;
  const cutterPath = [];
  for (let s = 0; s <= end; s += 6) {
    if (s > a && s < b) {
      // straight chord from the pose at `a` to the pose at `b`: both ends on the road, the middle across the block
      const t0 = pose(a), t1 = pose(b), f = (s - a) / (b - a);
      cutterPath.push({ ...pose(s), x: t0.x + (t1.x - t0.x) * f, y: t0.y + (t1.y - t0.y) * f, z: t0.z + (t1.z - t0.z) * f });
    } else cutterPath.push(pose(s));
  }
  let off = 0;
  cutterPath.forEach((state, i) => {
    r.tick();
    r.send(r.honest, { type: 'state', raceId: r.lobby.raceId, state: pose(i * 6) });
    r.send(r.cutter, { type: 'state', raceId: r.lobby.raceId, state });
    if (i * 6 > a && i * 6 < b) off++;
  });
  assert.ok(off > 4, 'the chord really leaves the road');
  const honest = r.core.clientData(r.honest), cutter = r.core.clientData(r.cutter);
  assert.ok(Number.isFinite(honest.finish), 'the driver who stayed on the route finishes');
  assert.equal(cutter.finish, null, 'the shortcut driver cannot finish');
  assert.ok(cutter.course.reached < a + 40, `the shortcut bought no progress (reached ${cutter.course.reached})`);
  assert.deepEqual(r.submitted.map(x => x.driverId ?? x.name).length, 1, 'only the legitimate run reaches the leaderboard');
  assert.equal(r.honest.messages.concat(r.cutter.messages).some(m => m.type === 'checkpoint'), false, 'nothing is announced about progress');
});
test('teleporting across the lap is discarded and finishes nothing', t => {
  const r = race(t);
  for (let s = 0; s <= 60; s += 6) { r.tick(); r.send(r.cutter, { type: 'state', raceId: r.lobby.raceId, state: pose(s) }); }
  r.tick(); r.send(r.cutter, { type: 'state', raceId: r.lobby.raceId, state: pose(event.len + 12) });
  const c = r.core.clientData(r.cutter);
  assert.equal(c.finish, null); assert.ok(c.course.reached <= 66);
});
