import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AthensGround } from '../../src/athens-ground.js';
import { fixture } from '../../tools/fixtures/routes/fixture.mjs';
import { compileRoute } from '../../src/route-compile.js';
import { RouteRuntime } from '../../src/route-runtime.js';
import { routeNetworkIdentity } from '../../src/route-network.js';
import { createGameCore } from '../../server/core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../../src/multiplayer-protocol.js';
const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const telemetry = main.split('\n').find(line => line.startsWith('const networkState ='));
const produce = Function('worldSession', 'multiplayer', 'traffic', 'police', 'settings', 'steeringAssistChoice', 'activeInputDevice', 'input', 'spectatorState', 'player', telemetry + ';return networkState;')({}, { active: true }, {}, {}, {}, () => 'full', () => 'keyboard', { brake: 0 }, () => ({}), { model: { paintColor: '#123456' } });
function vehicle(route, s = 0) {
  const f = route.frame(s);
  return { ...route.point(s), s, u: 0, yaw: f.yaw, halfW: 1, halfL: 2, a: 1, b: 1, track: 1.5, wb: 2, spec: { name: 'test' }, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1, nitro: 0, damage: { front: 0, rear: 0, left: 0, right: 0 }, resolveBodyContact() {} };
}
async function routeFixture() {
  const f = fixture(), compiled = await compileRoute(f.definition, f.graph, f.contacts), route = new RouteRuntime(compiled);
  route.contactAllowed = (q, p) => q.layer === p.layer && ['road-a', 'road-b', 'road-c'].includes(p.surfaceId);
  return { route, compiled };
}
function resolveContact(route, v, surfaceId, layer) {
  const frame = route.frame(v.s), ground = new AthensGround({ contact: () => ({ y: frame.y, layer: layer ?? frame.layer, surfaceId, flags: surfaceId ? 1 : 0, nx: 0, nz: 0 }) }, route, { resolve: () => false }, { contact: () => null });
  ground.begin(v); ground.resolve(v, 1 / 60); return produce(v);
}
test('streamed lobby transition reveals the game canvas before either ground branch', () => {
  const body = main.slice(main.indexOf('function onlineWait() {'), main.indexOf('/** MP police:', main.indexOf('function onlineWait() {')));
  const removed = [], G = { run: null, userCam: 'cockpit' }, v = {};
  const run = Function('world','player','multiplayer','document','worldSession','hideGrid','clearDriveInput','hud','G','applyCamMode','traffic','inFreeRoam','placeOnlineVehicle', body + ';return onlineWait;')({}, { veh: v }, { loaded: true, me: null }, { body: { classList: { remove: name => removed.push(name) } } }, {}, () => {}, () => {}, { hideMenu() {}, count() {} }, G, () => {}, { configure() {} }, () => false, () => {});
  G.ev = { def: { rules: {} } }; run();
  assert.equal(removed[0], 'menu-backdrop'); assert.equal(G.state, 'lobby');
});
test('production ground and network producer reach actual strict authority; terrain stays unearned', async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const { route, compiled } = await routeFixture(), identity = routeNetworkIdentity(compiled, 'd'.repeat(64));
  const map = { id: 'riviera', name: 'native telemetry', routeIdentity: identity, geometry: route, gridPose: () => ({ ...route.point(0), ...route.frame(0), s: 0, u: 0 }), track: { start: 0, finish: route.length, version: 'v1' }, definitions: new Map([['quick', { id: 'quick', type: 'sprint', s0: 0, s1: route.length, dir: 1, len: route.length }]]) };
  const maps = new Map([[map.id, map]]); maps.onlineMapIds = new Set([map.id]);
  const core = createGameCore({ maps, carSpecs: { mini: { width: 1.8, length: 4 } }, cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 0 });
  const socket = () => ({ readyState: 1, messages: [], send(bytes) { this.messages.push(JSON.parse(bytes)); }, close() {} });
  const a = socket(), b = socket(); for (const ws of [a, b]) core.connect(ws, 'native', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, packet) => core.message(ws, JSON.stringify({ mapId: map.id, routeIdentity: identity, ...packet }));
  send(a, { type: 'create', mapId: map.id }); const code = a.messages.findLast(m => m.type === 'lobby')?.lobby.code; assert.ok(code, JSON.stringify(a.messages.at(-1)));
  send(b, { type: 'join', code }); for (const ws of [a, b]) { send(ws, { type: 'loaded', loaded: true, version: 'v1' }); send(ws, { type: 'ready', ready: true, version: 'v1' }); }
  send(a, { type: 'start' }); core.tick(); const lobby = a.messages.findLast(m => m.type === 'lobby').lobby; assert.equal(lobby.status, 'race');
  for (const s of [0, 2, 4, 6, 8]) { now += 200; const v = vehicle(route, s), state = resolveContact(route, v, route.frame(s).surfaceId); assert.equal(typeof state.edgeId, 'string'); send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state }); core.tick(); }
  const accepted = core.clientData(a); assert.ok(accepted.state, JSON.stringify({state:resolveContact(route,vehicle(route,8),route.frame(8).surfaceId),last:a.messages.slice(-2),accepted})); assert.ok(accepted.course.reached > 6); assert.ok(b.messages.some(m => m.type === 'snapshot' && m.players.some(p => p.state?.edgeId)));
  const earned = accepted.course.reached;
  for (const s of [10, 12, 14]) { now += 200; const state = resolveContact(route, vehicle(route, s), null); assert.equal(state.surfaceId, ''); send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state }); core.tick(); }
  assert.equal(core.clientData(a).state.surfaceId, ''); assert.equal(core.clientData(a).course.reached, earned, 'unknown terrain displays but earns no road progress');
  now += 200; send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: resolveContact(route, vehicle(route, 16), route.frame(16).surfaceId) });
  assert.equal(core.clientData(a).course.reached, earned, 'returning ahead cannot convert unknown distance into earned progress');
  for (const s of [8, 10, 12]) { now += 200; send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: resolveContact(route, vehicle(route, s), route.frame(s).surfaceId) }); }
  assert.equal(core.clientData(a).course.reached, 12, 'real return at earned station resumes normal progress');
  now += 200; send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: { ...resolveContact(route, vehicle(route, 14), route.frame(14).surfaceId), edgeId: 'fabricated' } });
  assert.equal(core.clientData(a).course.reached, 12, 'nearby mismatched edge cannot earn progress through kerb grace');
  assert.equal(core.clientData(a).course.onRoute, false);
  const prior = core.clientData(a).state; now += 200; send(a, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: { ...prior, x: prior.x + 5000, edgeId: 'fabricated' } }); assert.deepEqual(core.clientData(a).state, prior, 'spoofed edge cannot authorize a teleport');
});

test('wrong-deck emitted contact stays truthful and finite without borrowing a route edge', async () => {
  const { route } = await routeFixture(), state = resolveContact(route, vehicle(route, 8), 'physical-bridge', 1);
  assert.equal(state.layer, 1); assert.equal(state.surfaceId, 'physical-bridge'); assert.equal(state.edgeId, '');
  assert.ok(Number.isFinite(state.s) && Number.isFinite(state.u));
});

test('explicit unknown emitted contact never borrows stale vehicle road identifiers', () => {
  const state = produce({ spec: {}, damage: {}, layer: 0, surfaceId: 'stale-road', edgeId: 'stale-edge', routeContact: { layer: 0, surfaceId: null, edgeId: null } });
  assert.equal(state.surfaceId, ''); assert.equal(state.edgeId, '');
});
