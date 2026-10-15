import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// MP session/host lifecycle + shared mode settings (owner: mp-session-modes).
// Unit coverage for server/mp-lifecycle.mjs + src/mp-setup.js, core-level
// (Worker-like, fake sockets) lifecycle coverage, and a real-WebSocket
// three-client create/edit race converging on one room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameCore } from './core.mjs';
import { createGameServer } from './index.mjs';
import {
  defaultConfig, sanitizeConfig, sanitizeOpaque, effectiveEvent, configInvalidates,
  nextGeneration, isStaleGeneration, cancelToWaiting, restartRace,
  registerTelemetryField, validateTelemetryExtra, clearTelemetryFields,
} from './mp-lifecycle.mjs';
import { configFromLobby, lobbyConfigToRaceSetup, trafficBoolToLevel, trafficLevelToBool, describeMode } from '../src/mp-setup.js';

const sprint = { id: 'quick', name: 'QUICK', type: 'sprint', s0: 0, s1: 15, dir: 1, len: 15, routeKey: '0>15', traffic: true, trafficLevel: 1, conditions: { time: 'sunset' }, police: false };
const pursuit = { id: 'chase', name: 'CHASE', type: 'pursuit', s0: 5, s1: 15, dir: 1, len: 10, routeKey: '5>15', traffic: true, trafficLevel: 0.9, conditions: null, police: true };
const defs = new Map([['quick', sprint], ['chase', pursuit]]);

test('default config follows the event; sanitize accepts shared setup keys only', () => {
  assert.deepEqual(defaultConfig(sprint), { rivals: 3, traffic: 1, time: 'sunset', weather: 'clear', reverse: false, police: false, sessionDuration: 300, enforcement: null });
  assert.equal(defaultConfig(pursuit).police, true);
  assert.deepEqual(sanitizeConfig(undefined), { config: null });
  assert.ok(sanitizeConfig(null).error);
  const { config, error } = sanitizeConfig({ rivals: 5, traffic: 0.5, time: 'night', weather: 'rain', reverse: true, police: true, sessionDuration: 120, enforcement: { zone: 'coast' }, taxi: { whatever: 1 } });
  assert.equal(error, undefined);
  assert.deepEqual(config, { rivals: 5, traffic: 0.5, time: 'night', weather: 'rain', reverse: true, police: true, sessionDuration: 120, enforcement: { zone: 'coast' } });
  for (const bad of [{ rivals: 12 }, { rivals: -1 }, { traffic: 3 }, { time: 'dusk' }, { weather: 'snow' }, { sessionDuration: 0 }, { enforcement: { a: 1, b: { c: { d: 1 } } } }, { enforcement: [1] }]) {
    assert.ok(sanitizeConfig(bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(sanitizeConfig({ enforcement: null }).config, { enforcement: null });
  assert.equal(sanitizeOpaque({ s: 'x'.repeat(281) }), undefined);
  assert.ok(sanitizeOpaque({ ok: 1, nested: { a: 'b' } }));
});

test('reverse mirrors the race geometry; readiness invalidates only when needed', () => {
  assert.equal(effectiveEvent(sprint, {}), sprint);
  assert.deepEqual(effectiveEvent(sprint, { reverse: true }), { ...sprint, s0: 15, s1: 0, dir: -1, routeKey: '15>0' });
  assert.equal(configInvalidates({}, {}), false);
  assert.equal(configInvalidates({ time: 'day' }, { time: 'night' }), false);
  assert.equal(configInvalidates({ weather: 'clear' }, { weather: 'rain' }), false);
  assert.equal(configInvalidates({ rivals: 3 }, { rivals: 0 }), false);
  assert.equal(configInvalidates({ sessionDuration: 300 }, { sessionDuration: 60 }), false);
  assert.equal(configInvalidates({ enforcement: null }, { enforcement: { zone: 'x' } }), false);
  assert.equal(configInvalidates({ traffic: 1 }, { traffic: 0 }), true);
  assert.equal(configInvalidates({ reverse: false }, { reverse: true }), true);
  assert.equal(configInvalidates({ police: false }, { police: true }), true);
});

test('generations bump on lifecycle transitions; stale gate ignores missing field', () => {
  const lobby = { generation: 0, status: 'race', raceId: 'r1', startAt: 1, players: new Map([['a', { ready: true, finish: 5, dnf: false, state: { s: 1 }, stateAt: 2 }]]) };
  assert.equal(nextGeneration(lobby), 1);
  assert.equal(isStaleGeneration(lobby, {}), false);
  assert.equal(isStaleGeneration(lobby, { generation: 1 }), false);
  assert.equal(isStaleGeneration(lobby, { generation: 0 }), true);
  cancelToWaiting(lobby);
  assert.equal(lobby.status, 'waiting'); assert.equal(lobby.raceId, null); assert.equal(lobby.generation, 2);
  assert.deepEqual([...lobby.players.values()].map(p => p.ready), [false]);
  restartRace(lobby, 'r2', 99);
  assert.equal(lobby.status, 'countdown'); assert.equal(lobby.raceId, 'r2'); assert.equal(lobby.startAt, 99);
  assert.equal(lobby.generation, 3); assert.equal(lobby.racers.size, 1);
});

test('telemetry registry stays bounded and only accepts finite in-range values', () => {
  clearTelemetryFields();
  assert.equal(registerTelemetryField('1bad', { min: 0, max: 1 }), false);
  assert.equal(registerTelemetryField('ok', { min: 1, max: 0 }), false);
  assert.equal(registerTelemetryField('boost_temp', { min: 0, max: 120 }), true);
  assert.equal(validateTelemetryExtra({}), null);
  assert.equal(validateTelemetryExtra({ boost_temp: 60 }), null);
  assert.ok(validateTelemetryExtra({ boost_temp: 121 }));
  assert.ok(validateTelemetryExtra({ boost_temp: NaN }));
  assert.equal(validateTelemetryExtra({ unknown_field: 999 }), null, 'unregistered fields are ignored');
  for (let i = 0; i < 16; i++) registerTelemetryField('f' + i, { min: 0, max: 1 });
  assert.equal(registerTelemetryField('overflow', { min: 0, max: 1 }), false);
  clearTelemetryFields();
});

test('client adapter maps lobby config to race-setup semantics', () => {
  assert.deepEqual(configFromLobby(null).rivals, 3);
  assert.deepEqual(configFromLobby({ config: { rivals: 0, time: 'night' } }), { rivals: 0, traffic: 1, time: 'night', weather: 'clear', reverse: false, police: false, sessionDuration: 300, enforcement: null });
  assert.deepEqual(lobbyConfigToRaceSetup({ rivals: 99, traffic: 9, time: 'dusk', weather: 'snow', reverse: 1, police: 1 }).rivals, 11);
  assert.deepEqual(lobbyConfigToRaceSetup({}), { rivals: 3, traffic: 1, reverse: false, time: 'afternoon', weather: 'clear', police: false });
  assert.equal(trafficBoolToLevel(true), 1); assert.equal(trafficBoolToLevel(false), 0);
  assert.equal(trafficLevelToBool(0.5), true); assert.equal(trafficLevelToBool(0), false);
  assert.equal(describeMode('sprint'), 'QUICK RACE'); assert.equal(describeMode('free'), 'FREE ROAM');
  assert.equal(describeMode('taxi'), 'UNAVAILABLE MODE'); assert.equal(describeMode(), 'QUICK RACE');
});

// ---------- core-level (Worker-like, fake sockets) ----------

const carSet = new Set(['mini', 'z4']);
const q = (id, type, extra = {}) => ({ id, mapId: 'riviera', type, name: id, s0: 0, s1: 15, dir: 1, len: 15, routeKey: '0>15', traffic: true, trafficLevel: 1, conditions: null, police: false, ...extra });
const taxiDef = { ...q('cab', 'taxi'), trafficLevel: 1, sessionDuration: 300 };
const fixtureMaps = () => new Map([
  ['riviera', { id: 'riviera', name: 'RIVIERA', track: { start: 0, finish: 15, version: 'coast' }, closed: false, trips: { taxi: [{ id: 'taxi-0', pickup: { x: 0, y: 0, z: 0, s: 1 }, dropoff: { x: 0, y: 0, z: 0, s: 9 } }], getaway: null }, definitions: new Map([['quick', q('quick', 'sprint')], ['chase', q('chase', 'pursuit', { s0: 5, s1: 15, len: 10, routeKey: '5>15' })], ['cab', taxiDef]]) }],
  ['megara', { id: 'megara', name: 'MEGARA', track: { start: 0, finish: 10, version: 'ring' }, closed: true, trips: { taxi: null, getaway: null }, definitions: new Map([['megara-race', { ...q('megara-race', 'sprint'), mapId: 'megara', s1: 10, len: 10, routeKey: '0>10' }]]) }],
  ['ring', { id: 'ring', name: 'RING', track: { start: 0, finish: 10, version: 'oval' }, closed: true, trips: { taxi: null, getaway: null }, definitions: new Map([['ring-taxi', { ...taxiDef, id: 'ring-taxi', mapId: 'ring', s1: 10, len: 10, routeKey: '0>10' }]]) }],
]);
const submissions = [];
function harness(t, opts = {}) {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps: fixtureMaps(), cars: carSet, leaderboard: { submit: async (r) => submissions.push(r) }, countdownMs: 100, raceLimitMs: 5000, reconnectGraceMs: 1000, ...opts });
  const socket = () => ({ readyState: 1, messages: [], send(d) { this.messages.push(JSON.parse(d)); }, close() { this.readyState = 3; } });
  const lobbyOf = (ws) => ws.messages.filter((m) => m.type === 'lobby').at(-1)?.lobby;
  const errOf = (ws) => ws.messages.filter((m) => m.type === 'error').at(-1)?.message;
  const hello = (ws) => ws.messages.find((m) => m.type === 'hello');
  return { core, socket, lobbyOf, errOf, hello, advance: (ms) => { now += ms; } };
}
const stateAt = (s, u = 0) => ({ x: s, y: 0, z: 0, yaw: 0, s, u, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2 });

test('create seeds configurable Quick Race; removed modes rejected and circuit enabled', (t) => {
  const { core, socket, lobbyOf, errOf, hello } = harness(t);
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  const a = socket(); core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL });
  assert.deepEqual(hello(a).maps.map((m) => m.id).sort(), ['megara', 'riviera']);
  assert.deepEqual(hello(a).events.filter(e => e.mapId === 'riviera').map(e => e.id), ['quick'], 'legacy objective/pursuit definitions are not advertised');
  send(a, { type: 'create', mapId: 'megara' });
  assert.equal(lobbyOf(a).mapId, 'megara');
  send(a, { type: 'leave' });
  for (const eventId of ['chase', 'cab']) {
    send(a, { type: 'create', eventId });
    assert.match(errOf(a), /Mode unavailable/);
    assert.equal(core.lobbies.size, 0);
  }
  send(a, { type: 'create', eventId: 'quick', config: { rivals: 11, traffic: 0.5, time: 'night', weather: 'rain', reverse: true, police: true } });
  const l = lobbyOf(a);
  assert.equal(l.mode, 'sprint');
  assert.deepEqual(l.config, { rivals: 11, traffic: 0.5, time: 'night', weather: 'rain', reverse: true, police: true, sessionDuration: 300, enforcement: null });
  assert.deepEqual([l.event.s0, l.event.s1, l.event.dir, l.event.routeKey], [15, 0, -1, '15>0']);
  send(a, { type: 'options', eventId: 'cab' });
  assert.match(errOf(a), /Mode unavailable/);
  assert.equal(core.lobbies.get(l.code).eventId, 'quick');
});

test('guests change cars while the host edits; readiness invalidates only when needed', (t) => {
  const { core, socket, lobbyOf, errOf } = harness(t);
  const a = socket(), b = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const inbox = (ws) => ({ send: (v) => core.message(ws, JSON.stringify(v)), lobby: () => lobbyOf(ws), err: () => errOf(ws) });
  const A = inbox(a), B = inbox(b);
  A.send({ type: 'create', mapId: 'riviera' }); B.send({ type: 'join', code: A.lobby().code, car: 'z4' });
  A.send({ type: 'ready', ready: true, version: 'coast' }); B.send({ type: 'ready', ready: true, version: 'coast' });
  assert.ok(A.lobby().players.every((p) => p.ready));
  A.send({ type: 'options', config: { time: 'night', weather: 'rain', rivals: 0 } });
  assert.ok(A.lobby().players.every((p) => p.ready), 'cosmetic/grid-only edits preserve ready');
  // Guest swaps car mid-edit without a track version: allowed while waiting.
  B.send({ type: 'ready', ready: false, car: 'mini', version: 'stale' });
  assert.equal(B.lobby().players.find((p) => p.id !== A.lobby().host).car, 'mini');
  assert.equal(A.lobby().players.find((p) => p.id === A.lobby().host).ready, true, 'guest car swap keeps host ready');
  B.send({ type: 'ready', ready: true, version: 'stale' });
  assert.match(B.err(), /track changed/, 'readying still needs the current track');
  A.send({ type: 'options', config: { traffic: 0 } });
  assert.ok(A.lobby().players.every((p) => !p.ready), 'traffic change clears ready');
  B.send({ type: 'options', config: { time: 'day' } });
  assert.match(B.err(), /host/);
});

test('allow-list shrinks unready only affected drivers; start stays authoritative', (t) => {
  const { core, socket, lobbyOf, errOf } = harness(t);
  const a = socket(), b = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  send(a, { type: 'create', mapId: 'riviera', allowedCars: ['mini', 'z4'] });
  const code = lobbyOf(a).code;
  send(b, { type: 'join', code, car: 'z4' });
  send(a, { type: 'ready', ready: true, version: 'coast' }); send(b, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'options', allowedCars: ['mini'] });
  const l = lobbyOf(a);
  assert.equal(l.players.find((p) => p.id !== l.host).ready, false, 'disallowed driver unreadied');
  assert.equal(l.players.find((p) => p.id === l.host).ready, true, 'unaffected host stays ready');
  assert.equal(l.players.find((p) => p.id !== l.host).car, 'mini', 'disallowed car falls back to the first allowed car');
  send(a, { type: 'start' });
  assert.match(errOf(a), /ready/, 'start requires a new ready vote after the fallback');
});

test('host restart/to-lobby/transfer keep the room code and bump generations', (t) => {
  const { core, socket, lobbyOf, errOf } = harness(t);
  const a = socket(), b = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  send(a, { type: 'create', mapId: 'riviera' }); const code = lobbyOf(a).code;
  send(b, { type: 'join', code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' });
  const r1 = lobbyOf(a);
  assert.equal(r1.status, 'countdown'); assert.equal(r1.generation, 1);
  send(b, { type: 'restart' });
  assert.match(errOf(b), /host/);
  send(a, { type: 'restart' });
  const r2 = lobbyOf(a);
  assert.equal(r2.code, code); assert.equal(r2.generation, 2);
  assert.notEqual(r2.raceId, r1.raceId);
  assert.ok(r2.players.every((p) => p.ready), 'restart preserves ready for the same setup');
  // Stale race packets belong to the older generation and cannot finish.
  send(a, { type: 'state', raceId: r1.raceId, state: stateAt(15) });
  assert.equal(lobbyOf(a).status, 'countdown');
  send(a, { type: 'to-lobby' });
  const w = lobbyOf(a);
  assert.equal(w.code, code); assert.equal(w.status, 'waiting'); assert.equal(w.generation, 3);
  assert.ok(w.players.every((p) => !p.ready));
  send(a, { type: 'transfer', to: 'nobody' });
  assert.match(errOf(a), /connected driver/);
  const guestId = w.players.find((p) => p.id !== w.host).id;
  send(a, { type: 'transfer', to: guestId });
  assert.equal(lobbyOf(b).host, guestId);
  send(a, { type: 'options', config: { time: 'day' } });
  assert.match(errOf(a), /host/, 'former host cannot mutate config');
  send(b, { type: 'options', config: { time: 'day' } });
  assert.equal(lobbyOf(a).config.time, 'day', 'transferred host controls setup');
  send(b, { type: 'rematch' });
  assert.equal(lobbyOf(a).status, 'waiting', 'host rematch while waiting is a no-op, not an error');
});

test('results/rematch stay responsive to stale-client retries', (t) => {
  const { core, socket, lobbyOf, advance } = harness(t);
  const a = socket(), b = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  send(a, { type: 'create', mapId: 'riviera' }); const code = lobbyOf(a).code;
  send(b, { type: 'join', code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' }); const raceId = lobbyOf(a).raceId;
  advance(50); core.tick();
  assert.equal(lobbyOf(a).status, 'countdown');
  advance(100); core.tick();
  assert.equal(lobbyOf(a).status, 'race');
  for (const ws of [a, b]) send(ws, { type: 'state', raceId, state: stateAt(15) });
  const done = lobbyOf(a);
  assert.equal(done.status, 'results');
  assert.ok(done.players.every((p) => p.finish !== null));
  send(a, { type: 'start' });
  assert.equal(lobbyOf(a).status, 'waiting', 'stale start in results converges to waiting');
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' });
  assert.equal(lobbyOf(a).status, 'countdown');
});

test('reversed runs finish at the mirrored line and skip the leaderboard', (t) => {
  submissions.length = 0;
  const { core, socket, lobbyOf, advance } = harness(t);
  const a = socket(), b = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  send(a, { type: 'create', mapId: 'riviera', config: { reverse: true } });
  const code = lobbyOf(a).code;
  send(b, { type: 'join', code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' }); const raceId = lobbyOf(a).raceId;
  advance(150); core.tick();
  assert.equal(lobbyOf(a).status, 'race');
  for (const ws of [a, b]) send(ws, { type: 'state', raceId, state: stateAt(0) });
  assert.equal(lobbyOf(a).status, 'results');
  assert.ok(lobbyOf(a).players.every((p) => p.finish !== null), 's<=0 crosses the mirrored finish');
  assert.equal(submissions.length, 0, 'reversed runs never touch the leaderboard');
});

test('telemetry extras relay validated; violations without sites stay silent', (t) => {
  const { core, socket, lobbyOf, advance } = harness(t);
  const a = socket(), b = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  send(a, { type: 'create', mapId: 'riviera' }); const code = lobbyOf(a).code;
  send(b, { type: 'join', code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' }); const raceId = lobbyOf(a).raceId;
  advance(150); core.tick();
  send(a, { type: 'state', raceId, state: { ...stateAt(5), engHealth: 0.8, coolantTemp: 200, engineFailureReason: 'bogus', tyreTelemetry: { front: { utilization: 0.5, slipDemand: 0.4, saturated: false, sliding: false, contact: true }, rear: { utilization: 0.6, slipDemand: 0.5, saturated: false, sliding: false, contact: true }, understeer: false } } });
  core.tick();
  const echoed = b.messages.filter((m) => m.type === 'snapshot').at(-1);
  const st = echoed.players.find((p) => p.state?.s === 5)?.state;
  assert.equal(st.engHealth, 0.8);
  assert.equal(st.coolantTemp, undefined, 'out-of-range coolant is stripped, position survives');
  assert.equal(st.engineFailureReason, undefined);
  assert.equal(st.tyreTelemetry.understeer, false);
  send(a, { type: 'violation', id: 'v1', kind: 'camera', s: 5, kmh: 200, raceId });
  assert.ok(!a.messages.some((m) => m.type === 'violation-ack'), 'empty site lists reject claims');
  send(a, { type: 'violation', id: 'v1', kind: 'camera', s: 5, kmh: 200, raceId });
  assert.ok(!a.messages.some((m) => m.type === 'violation-ack'), 'duplicate rejected claims stay silent');
});

test('hibernation preserves Quick Race code, config and generation', (t) => {
  const { core, socket, lobbyOf } = harness(t);
  const a = socket();
  core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, v) => core.message(ws, JSON.stringify(v));
  send(a, { type: 'create', mapId: 'riviera', eventId: 'quick', config: { rivals: 2 } });
  for (const ws of [a]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  const before = lobbyOf(a);
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  const next = createGameCore({ maps: fixtureMaps(), cars: carSet, leaderboard: { submit: async () => ({}) } });
  const byToken = new Map([...core.clients].map((c) => [c.token, c.ws]));
  next.restore(saved, byToken);
  const l = next.lobbies.get(before.code);
  assert.ok(l, 'room code survives');
  assert.equal(l.generation, 0);
  assert.equal(l.config.rivals, 2);
  assert.equal(l.eventId, 'quick');
});

// ---------- real WebSocket: three-client create/edit race ----------

async function wsSetup(t, opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paraliaki-mp-'));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/map.json'), JSON.stringify({ route: { start: 0, finish: 15, x: [0, 15] }, marks: ['astir', 'lake', 'limanakia', 'varkiza', 'coast', 'lomvarda'].map((id, i) => ({ id, name: id, s: i * 2 + 1 })) }));
  await writeFile(join(root, 'index.html'), '<h1>Racing</h1>');
  const app = await createGameServer({ root, countdownMs: 100, raceLimitMs: 8000, reconnectGraceMs: 0, ...opts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  async function client(name) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws?protocol='+MULTIPLAYER_PROTOCOL);
    const inbox = [], waiting = [];
    ws.on('message', (data) => { const m = JSON.parse(data); const i = waiting.findIndex((w) => w.pred(m)); if (i >= 0) waiting.splice(i, 1)[0].resolve(m); else inbox.push(m); });
    const next = (pred) => new Promise((resolve, reject) => { const i = inbox.findIndex(pred); if (i >= 0) return resolve(inbox.splice(i, 1)[0]); const timer = setTimeout(() => reject(new Error('Message timeout')), 3000); waiting.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } }); });
    const hello = await next((m) => m.type === 'hello');
    return { ws, id: hello.id, token: hello.token, version: hello.track.version, next, send: (m) => ws.send(JSON.stringify({ name, car: 'mini', ...m })) };
  }
  return { app, client };
}
const wroom = (c) => c.next((m) => m.type === 'lobby');

test('three real clients converge on one room through concurrent create/edit/join', async (t) => {
  const env = await wsSetup(t);
  const host = await env.client('Host'), g1 = await env.client('Gus'), g2 = await env.client('Zed');
  // Host creates and immediately edits (the playtest create/edit race); guests join mid-edit.
  host.send({ type: 'create', lobbyName: 'Converge', mapId: 'riviera', allowedCars: ['mini', 'z4'] });
  const created = (await wroom(host)).lobby;
  host.send({ type: 'options', config: { rivals: 5, time: 'sunset', traffic: 1 } });
  g1.send({ type: 'join', code: created.code, car: 'z4' });
  g2.send({ type: 'join', code: created.code, car: 'mini' });
  await wroom(g1); await wroom(g2); await wroom(host);
  // Guests pick cars while the host edits again.
  g1.send({ type: 'ready', ready: true, car: 'z4', version: g1.version });
  await host.next((m) => m.type === 'lobby' && m.lobby.players.some((p) => p.id === g1.id && p.ready));
  host.send({ type: 'options', allowedCars: ['mini'] });
  const hg = await host.next((m) => m.type === 'lobby' && m.lobby.allowedCars.length === 1);
  await g1.next((m) => m.type === 'lobby' && m.lobby.allowedCars.length === 1);
  await g2.next((m) => m.type === 'lobby' && m.lobby.allowedCars.length === 1);
  assert.equal(hg.lobby.code, created.code, 'room code is stable');
  assert.equal(hg.lobby.config.rivals, 5);
  assert.deepEqual(hg.lobby.allowedCars, ['mini']);
  const gus = hg.lobby.players.find((p) => p.id === g1.id);
  assert.equal(gus.car, 'mini', 'guest gets an allowed car after host filter edits');
  assert.equal(gus.ready, false, 'disallowed guest deterministically unreadied');
  assert.equal(hg.lobby.players.find((p) => p.id === host.id).ready, false);
  assert.equal(hg.lobby.generation, 0, 'waiting-room edits do not burn generations');
  // Converge: guest on mini readies, everyone readies, host starts, restarts, returns.
  g1.send({ type: 'ready', ready: false, car: 'mini', version: g1.version }); await wroom(host);
  host.send({ type: 'ready', ready: true, version: host.version });
  g1.send({ type: 'ready', ready: true, version: g1.version });
  g2.send({ type: 'ready', ready: true, version: g2.version });
  await host.next((m) => m.type === 'lobby' && m.lobby.players.every((p) => p.ready));
  host.send({ type: 'start' });
  const racing = (await host.next((m) => m.type === 'lobby' && m.lobby.status === 'countdown')).lobby;
  await g1.next((m) => m.type === 'lobby' && m.lobby.status === 'countdown');
  await g2.next((m) => m.type === 'lobby' && m.lobby.status === 'countdown');
  assert.equal(racing.status, 'countdown');
  const seen = new Set([racing.raceId, racing.generation]);
  host.send({ type: 'restart' });
  const re = (await host.next((m) => m.type === 'lobby' && m.lobby.raceId !== racing.raceId)).lobby;
  await g1.next((m) => m.type === 'lobby' && m.lobby.raceId === re.raceId);
  assert.equal(re.code, created.code);
  assert.ok(!seen.has(re.raceId) && !seen.has(re.generation), 'restart mints a new generation');
  host.send({ type: 'to-lobby' });
  const back = (await host.next((m) => m.type === 'lobby' && m.lobby.status === 'waiting')).lobby;
  assert.equal(back.status, 'waiting'); assert.equal(back.code, created.code);
  host.ws.close(); g1.ws.close(); g2.ws.close();
});

