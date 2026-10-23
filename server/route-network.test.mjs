import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../tools/fixtures/routes/fixture.mjs';
import { compileRoute } from '../src/route-compile.js';
import { edgeLength } from '../src/route-geometry.js';
import { RouteRuntime } from '../src/route-runtime.js';
import { routeEvent } from '../src/route-events.js';
import { resolve } from '../src/events.js';
import { routeNetworkIdentity, sameRouteIdentity } from '../src/route-network.js';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { createGameCore } from './core.mjs';
import { onlineLeaderboardResult } from './leaderboard-online.mjs';
import { resultContext, validResult, boardKey } from './leaderboard-policy.mjs';
const socket = () => ({ readyState: 1, messages: [], send(bytes) { this.messages.push(JSON.parse(bytes)); }, close() { this.readyState = 3; } });
async function setup(t, { circuit = false } = {}) {
  const f = fixture();
  if (!circuit) {
    f.contacts.eligible = key => ['0,0', '1,0', '0,1'].includes(key);
    for (const { value: edge } of f.graph.edges.values()) if (edge.layer === 0) for (const p of edge.points) p[1] = (500 - p[2]) * .03 + p[0] * .005;
    const contact = f.contacts.contact; f.contacts.contact = (x, z, options) => ({ ...contact(x, z, options), y: options.layer === 1 ? 12 : (500 - z) * .03 + x * .005 });
    f.definition.lengthM = edgeLength(f.graph.edges.get('a').value) - 100 + edgeLength(f.graph.edges.get('b').value) + 250;
  }
  if (circuit) {
    f.graph.edges.clear(); f.graph.outgoing.clear();
    const points = [[100, 0, 400], [100, 0, 100], [400, 0, 100], [400, 0, 400], [100, 0, 400]];
    for (let i = 0; i < 4; i++) { const e = { id: 'abcd'[i], from: 'n' + i, to: 'n' + ((i + 1) % 4), points: [points[i], points[i + 1]], surface: 'circuit', layer: 0, flags: 1 }; f.graph.edges.set(e.id, { value: e }); f.graph.outgoing.set(e.from, new Set([e.id])); }
    f.contacts.contact = () => ({ y: 0, flags: 1, layer: 0, surfaceId: 'circuit' }); f.contacts.surfaceAllowed = () => true;
    Object.assign(f.definition, { id: 'fixture-circuit', kind: 'circuit', lengthM: 1200, laps: 2, path: { edges: ['a', 'b', 'c', 'd', 'a'] }, start: { edgeId: 'a', offsetM: 80, lateralM: 0, yawRad: 0 }, finish: { edgeId: 'a', offsetM: 80, lateralM: 0, yawRad: 0 }, sectorsM: [300, 600, 900] });
  }
  const c = await compileRoute(f.definition, f.graph, f.contacts), geometry = new RouteRuntime(c), routeIdentity = routeNetworkIdentity(c, 'd'.repeat(64));
  const event = { ...routeEvent(c), ...resolve(routeEvent(c), { route: geometry, marks: [] }), mapId: c.id };
  const gridPose = slot => ({ ...geometry.point(-8 * (slot + 1)), s: -8 * (slot + 1), yaw: geometry.frame(0).yaw, slot });
  const map = { id: c.id, name: c.id, routeIdentity, geometry, track: { start: 0, finish: c.lengthM, version: c.routeHash + ':' + routeIdentity.onlineGridHash, routeIdentity }, definitions: new Map([[event.id, event]]), gridPose };
  const maps = new Map([['riviera', { track: { version: 'old' }, definitions: new Map() }], [c.id, map]]); maps.routeConfig = { online: true }; maps.routes = new Map([[c.id, c]]);
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const submitted = [], opts = { maps, cars: new Set(['mini']), carSpecs: { mini: { width: 2, length: 4 } }, leaderboard: { submit: async result => submitted.push(result) }, countdownMs: 0 };
  let core = createGameCore(opts); const a = socket(), b = socket();
  const send = (ws, message) => core.message(ws, JSON.stringify(message));
  for (const [i, ws] of [a, b].entries()) core.connect(ws, String(i), { protocol: MULTIPLAYER_PROTOCOL });
  send(a, { type: 'create', mapId: c.id, eventId: event.id }); const lobby = [...core.lobbies.values()][0];
  assert.ok(lobby, JSON.stringify(a.messages)); send(b, { type: 'join', code: lobby.code });
  const packet = message => ({ mapId: c.id, routeIdentity, generation: lobby.generation, raceId: lobby.raceId, ...message });
  const ready = () => { for (const ws of [a, b]) send(ws, packet({ type: 'ready', ready: true, version: map.track.version })); send(a, { type: 'start' }); core.tick(); };
  const pose = s => { const f = geometry.frame(s); return { ...geometry.point(s), s, u: 0, yaw: f.yaw, layer: f.layer, surfaceId: f.surfaceId, edgeId: f.edgeId, vLong: 25, vLat: 0, steer: 0, rpm: 3000, gear: 2, recordMeta: { tc: true, abs: true, steering: 'off', gearbox: 'auto' } }; };
  return { c, geometry, event, map, maps, a, b, send, packet, ready, pose, lobby, opts, submitted, get core() { return core; }, advance(ms = 100) { now += ms; }, restore(saved) { core = createGameCore(opts); core.restore(saved); } };
}
test('strict route identity rejects short, missing, stale and cross-grid hashes', async () => {
  const f = fixture(), c = await compileRoute(f.definition, f.graph, f.contacts), a = routeNetworkIdentity(c, 'd'.repeat(64));
  assert.ok(sameRouteIdentity(a, { ...a }));
  for (const key of Object.keys(a)) { assert.equal(sameRouteIdentity(a, { ...a, [key]: undefined }), false, key); assert.equal(sameRouteIdentity(a, { ...a, [key]: 'stale' }), false, key); }
  assert.equal(sameRouteIdentity(a, { ...a, onlineGridHash: 'e'.repeat(64) }), false);
  assert.throws(() => routeNetworkIdentity({ ...c, routeHash: 'short' }));
});
test('loaded, ready, single/batch motion and recovery reject spoofed map/tuple before mutation', async t => {
  const x = await setup(t), { a, send, packet, map, core, ready, pose, lobby } = x;
  send(a, packet({ type: 'loaded', loaded: true, version: map.track.version, routeIdentity: { ...map.routeIdentity, routeHash: 'e'.repeat(64) } })); assert.equal(core.clientData(a).loaded, false);
  send(a, packet({ type: 'ready', ready: true, version: map.track.version, mapId: 'athens' })); assert.equal(core.clientData(a).ready, false);
  ready(); x.advance(); send(a, packet({ type: 'state', state: pose(2.5) })); assert.equal(core.clientData(a).state.layer, 0);
  const before = JSON.stringify(core.clientData(a).state);
  for (const m of [{ mapId: 'other' }, { routeIdentity: { ...map.routeIdentity, geometryHash: 'f'.repeat(64) } }, { generation: lobby.generation - 1 }]) {
    x.advance(); send(a, packet({ type: 'state', state: pose(5), ...m }));
    send(a, packet({ type: 'states', states: [pose(5), pose(7.5)], ...m }));
    assert.equal(JSON.stringify(core.clientData(a).state), before);
    send(a, packet({ type: 'recover', motionEpoch: 1, ...m })); assert.equal(core.clientData(a).recovery, null);
  }
});
for (const circuit of [false, true]) test(`server world course finishes every split and ${circuit ? 'two continuous laps' : '3D sprint'} exactly once`, async t => {
  const x = await setup(t, { circuit }); x.ready();
  for (let s = 0; s <= x.event.s1 + 5; s += 2.5) { x.advance(); x.send(x.a, x.packet({ type: 'state', state: x.pose(s) })); }
  const driver = x.core.clientData(x.a); assert.ok(driver.finish > 0); assert.equal(driver.course.markTimes.filter(Number.isFinite).length, x.event.sectors.length); assert.equal(x.submitted.length, 1);
  assert.ok(driver.course.reached >= x.event.s1); assert.equal(x.submitted[0].routeId, x.c.id); assert.equal(x.submitted[0].mapId, 'athens'); assert.equal(x.submitted[0].setup.traffic, x.lobby.config.traffic);
  const record = onlineLeaderboardResult(driver, x.lobby, x.event); assert.ok(validResult(record, resultContext(record, new Map(), '', x.maps).event, new Set(['mini'])));
  for (const other of [{ ...record, setup: { ...record.setup, weather: 'rain' } }, { ...record, routeHash: 'b'.repeat(64) }, { ...record, worldSetRevision: 'c'.repeat(64) }, { ...record, geometryHash: 'e'.repeat(64) }]) assert.notEqual(boardKey(record), boardKey(other));
  if (!circuit) assert.ok(x.geometry.frame(100).y !== x.geometry.frame(200).y, 'timing uses contact-conformed 3D stations');
});
test('teleport, fabricated station and bridge deck cannot finish or buy course distance', async t => {
  const x = await setup(t); x.ready(); x.advance(); x.send(x.a, x.packet({ type: 'state', state: x.pose(2.5) }));
  const earned = x.core.clientData(x.a).course.reached;
  for (const state of [x.pose(940), { ...x.pose(5), s: 940 }, { ...x.pose(5), layer: 1, y: 12, surfaceId: 'bridge' }]) { x.advance(); x.send(x.a, x.packet({ type: 'state', state })); assert.equal(x.core.clientData(x.a).course.reached, earned); assert.equal(x.core.clientData(x.a).finish, null); }
});
test('resume/persistence retains exact tuple, race generation and grid slot; drift invalidates race state', async t => {
  const x = await setup(t); x.ready(); x.advance(); x.send(x.a, x.packet({ type: 'state', state: x.pose(2.5) }));
  const prior = x.core.clientData(x.a), saved = structuredClone(x.core.exportState()); x.restore(saved);
  const fresh = socket(); x.core.connect(fresh, 'new', { protocol: MULTIPLAYER_PROTOCOL });
  x.send(fresh, { type: 'resume', token: prior.token }); assert.equal(x.core.clientData(fresh).id === prior.id, false);
  x.send(fresh, x.packet({ type: 'resume', token: prior.token })); const resumed = x.core.clientData(fresh);
  assert.equal(resumed.id, prior.id); assert.equal(resumed.gridSlot, prior.gridSlot); assert.equal(resumed.course.reached, prior.course.reached); assert.equal([...x.core.lobbies.values()][0].generation, x.lobby.generation);
  x.map.routeIdentity = { ...x.map.routeIdentity, worldSetRevision: 'b'.repeat(64) }; x.restore(saved);
  assert.equal(x.core.lobbies.size, 0); const invalid = x.core.sessions.get(prior.token); assert.equal(invalid.loaded, false); assert.equal(invalid.state, null);
});
test('all eight slots are unique and a replacement reuses the empty slot', async t => {
  const x = await setup(t), sockets = [x.a, x.b];
  for (let i = 2; i < 8; i++) { const ws = socket(); sockets.push(ws); x.core.connect(ws, String(i), { protocol: MULTIPLAYER_PROTOCOL }); x.send(ws, { type: 'join', code: x.lobby.code }); }
  assert.deepEqual([...x.lobby.players.values()].map(p => p.gridSlot), [0, 1, 2, 3, 4, 5, 6, 7]);
  x.send(sockets[3], { type: 'leave' }); const ws = socket(); x.core.connect(ws, 'replace', { protocol: MULTIPLAYER_PROTOCOL }); x.send(ws, { type: 'join', code: x.lobby.code }); assert.equal(x.core.clientData(ws).gridSlot, 3);
});
