import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// Protocol proof over real road manifests. Poses/receipt time are synthetic:
// these tests validate coordinator rules, not vehicle physics or route driving.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { MAPS } from '../src/map-catalog.js';
import { buildDrivingRoutes } from '../src/driving-objectives.js';
import { resolveMap } from './map-definitions.mjs';
import { createGameCore } from './core.mjs';
import { createGameServer } from './index.mjs';

const rawMaps = new Map(await Promise.all(MAPS.map(async meta =>
  [meta.id, JSON.parse(await readFile(new URL('../' + meta.dataUrl, import.meta.url), 'utf8'))])));
const maps = new Map(MAPS.map(meta => [meta.id, resolveMap(meta, rawMaps.get(meta.id))]));
const latest = (ws, type) => ws.messages.filter(m => m.type === type).at(-1);
const pose = (point, extra = {}) => ({ x: point.x, y: point.y, z: point.z, s: point.s,
  u: point.u || 0, yaw: 0, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1, ...extra });

function harness(t, mode, { camera = false } = {}) {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const submissions = [], recorded = [];
  const map = maps.get('riviera'), pickup = map.trips[mode][0].pickup;
  // An explicit test site exercises fine handling without claiming that this
  // fictional camera exists on the actual Riviera map.
  const activeMaps = camera ? new Map([...maps, ['riviera', { ...map, enforcement: {
    cameras: [{ id: 'test-camera', s: pickup.s, mapId: 'riviera', dir: 1, limitKmh: 30, verified: true, active: true }], redSites: [],
  } }]]) : maps;
  const core = createGameCore({ maps: activeMaps, cars: new Set(['mini', 'taxi']),
    leaderboard: { submit: async r => submissions.push(r) },
    accounts: { recordMpResults: (...args) => recorded.push(args) }, countdownMs: 100, reconnectGraceMs: 0 });
  function socket(name) {
    const ws = { readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close() { this.readyState = 3; } };
    core.connect(ws, name, { protocol: MULTIPLAYER_PROTOCOL });
    return ws;
  }
  const a = socket('host'), b = socket('guest');
  const send = (ws, m) => core.message(ws, JSON.stringify(m));
  send(a, { type: 'create', eventId: `${mode}:riviera`, config: { sessionDuration: 300, police: camera } });
  const code = latest(a, 'lobby').lobby.code;
  send(b, { type: 'join', code });
  const lobby = core.lobbies.get(code), id = ws => latest(ws, 'hello').id;
  const advance = ms => { now += ms; core.tick(); };
  const state = (ws, point, extra = {}) => send(ws, { type: 'state', raceId: lobby.raceId, state: pose(point, extra) });
  const objective = ws => lobby.objectives.get(id(ws));
  const start = () => {
    for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: map.track.version, car: ws === a ? 'taxi' : 'mini' });
    send(a, { type: 'start' }); advance(100);
    assert.equal(lobby.status, 'race');
  };
  const travel = (ws, point) => {
    const previous = lobby.players.get(id(ws)).state?.s ?? map.track.start;
    advance(Math.ceil(Math.abs(point.s - previous) / 100 * 1000) + 1000);
    state(ws, point);
    assert.equal(lobby.players.get(id(ws)).state.s, point.s, 'pose passes bounded progress validation');
  };
  const dwell = (ws, point, frames = 16, extra = {}) => {
    state(ws, point, extra);
    for (let i = 0; i < frames; i++) { advance(100); state(ws, point, extra); }
  };
  return { core, a, b, send, id, lobby, objective, advance, state, start, travel, dwell,
    submissions, recorded, now: () => now, trips: map.trips[mode] };
}

test('real public roads register matching SP/MP manifests; closed and short roads do not offer missions', () => {
  for (const mapId of ['riviera', 'penteli']) for (const mode of ['taxi', 'getaway']) {
    const map = maps.get(mapId), def = map.definitions.get(`${mode}:${mapId}`);
    assert.equal(def?.type, mode);
    assert.deepEqual(map.trips[mode], buildDrivingRoutes(rawMaps.get(mapId), mode, { seed: 1 }));
    assert.equal(map.trips[mode].length, 32);
    assert.equal(def.objectiveMode, true);
  }
  const megara = maps.get('megara');
  assert.deepEqual(megara.trips, { taxi: null, getaway: null });
  assert.ok(![...megara.definitions.values()].some(d => ['taxi', 'getaway'].includes(d.type)));
  const short = resolveMap(MAPS[0], { route: { start: 0, finish: 15, x: [0, 15] }, marks: [] });
  assert.deepEqual(short.trips, { taxi: null, getaway: null });
  assert.ok(!short.definitions.has('taxi:riviera') && !short.definitions.has('getaway:riviera'));
});

for (const mode of ['taxi', 'getaway']) {
  test(`${mode}: ordered server counts, live replication, expiry, plain results and replay`, t => {
    const h = harness(t, mode), { a, b, lobby, trips, core } = h;
    assert.equal(latest(a, 'lobby').lobby.mode, mode);
    assert.deepEqual(latest(b, 'lobby').lobby.event.objectiveRoutes, trips);
    assert.equal(core.discover().lobbies[0].event.objectiveRoutes, undefined);
    h.start();
    const firstRace = lobby.raceId;
    // Finish crossing plus forged client counts cannot finish or score a round.
    const route = rawMaps.get('riviera').route, i = Math.round(route.finish / route.step);
    const finish = { s: route.finish, x: route.x[i], y: route.y[i], z: route.z[i] };
    h.travel(b, finish); h.state(b, finish, { completed: 999, objective: { completed: 999 } });
    assert.equal(lobby.players.get(h.id(b)).finish, null);
    assert.equal(h.objective(b).completed, 0);
    assert.equal(lobby.status, 'race');
    h.travel(a, trips[0].dropoff); h.dwell(a, trips[0].dropoff);
    assert.equal(h.objective(a).phase, 'pickup', 'dropoff cannot precede pickup');
    h.travel(a, trips[0].pickup); h.dwell(a, trips[0].pickup, 16, { vLong: 3 });
    assert.equal(h.objective(a).phase, 'pickup', 'moving above stop speed cannot pick up');
    h.dwell(a, trips[0].pickup);
    assert.equal(h.objective(a).phase, 'dropoff');
    h.travel(a, trips[0].dropoff); h.dwell(a, trips[0].dropoff);
    assert.equal(h.objective(a).completed, 1);
    h.dwell(a, trips[0].dropoff, 10);
    assert.equal(h.objective(a).completed, 1, 'duplicate delivery samples cannot score twice');
    const remote = latest(b, 'lobby').lobby.players.find(p => p.id === h.id(a));
    assert.equal(remote.objective.completed, 1); assert.equal(remote.objective.roundId, firstRace);
    h.advance(100); assert.equal(latest(b, 'snapshot').players.find(p => p.id === h.id(a)).objective.completed, 1);
    h.advance(300000);
    const result = latest(a, 'lobby').lobby;
    assert.equal(result.status, 'results');
    assert.deepEqual(result.results.map(p => p.id), [h.id(a), h.id(b)], 'completed count orders results');
    assert.deepEqual(result.results.map(p => p.objective.completed), [1, 0]);
    for (const p of result.results) {
      assert.equal(p.dnf, false); assert.equal(p.finish, null); assert.equal(p.objective.done, true);
      assert.equal(p.objective.elapsed, 300); assert.equal(p.objective.remaining, 0);
      assert.equal(p.objective.valid, false); assert.equal(p.objective.medal, null);
    }
    assert.equal(h.submissions.length, 0);
    assert.equal(h.recorded.length, 1);
    h.advance(1000); assert.equal(h.recorded.length, 1, 'results recorded once');
    h.send(a, { type: 'rematch' });
    assert.equal(lobby.code, result.code); assert.equal(lobby.status, 'waiting');
    h.start();
    assert.notEqual(lobby.raceId, firstRace);
    assert.equal(h.objective(a).completed, 0); assert.equal(h.objective(a).phase, 'pickup');
    h.send(a, { type: 'state', raceId: firstRace, state: pose(trips[0].dropoff) });
    assert.equal(lobby.players.get(h.id(a)).state, null, 'stale race samples cannot affect replay');
    assert.ok(!a.messages.some(m => m.type === 'error'));
  });

  test(`${mode}: accepted recovery clears accumulated stop hold; rejected recovery preserves it`, t => {
    const h = harness(t, mode), point = h.trips[0].pickup;
    h.start(); h.travel(h.a, point); h.dwell(h.a, point, 10);
    assert.ok(h.objective(h.a).holdSeconds > .9);
    h.send(h.a, { type: 'recover', raceId: h.lobby.raceId, motionEpoch: -1 });
    assert.ok(h.objective(h.a).holdSeconds > .9, 'rejected recovery has no side effect');
    h.send(h.a, { type: 'recover', raceId: h.lobby.raceId, generation: h.lobby.generation, motionEpoch: 1 });
    assert.ok(latest(h.a, 'recovered'));
    assert.equal(h.objective(h.a).holdSeconds, 0); assert.equal(h.objective(h.a).wasStopped, false);
    h.dwell(h.a, point, 10, { motionEpoch: 1 });
    assert.equal(h.objective(h.a).phase, 'pickup', 'pre-recovery dwell cannot carry over');
    h.dwell(h.a, point, 6, { motionEpoch: 1 });
    assert.equal(h.objective(h.a).phase, 'dropoff');
    const held = h.objective(h.a);
    h.send(h.a, { type: 'leave' });
    assert.equal(held.holdSeconds, 0); assert.equal(held.wasStopped, false);
    assert.equal(h.lobby.objectives.has(h.id(h.a)), false);
  });

  test(`${mode}: equal completion counts sort by fastest trip before elapsed time`, t => {
    const h = harness(t, mode), trip = h.trips[0];
    h.start();
    for (const ws of [h.a, h.b]) {
      h.travel(ws, trip.pickup); h.dwell(ws, trip.pickup);
      if (ws === h.a) h.advance(5000);
      h.travel(ws, trip.dropoff); h.dwell(ws, trip.dropoff);
      assert.equal(h.objective(ws).completed, 1);
    }
    h.advance(300000);
    const results = latest(h.a, 'lobby').lobby.results;
    assert.deepEqual(results.map(p => p.id), [h.id(h.b), h.id(h.a)]);
    assert.ok(results[0].objective.bestTrip < results[1].objective.bestTrip);
  });

  test(`${mode}: validated fine cuts the deadline once and never pads a race finish`, t => {
    const h = harness(t, mode, { camera: true }), point = h.trips[0].pickup;
    h.start(); h.travel(h.a, point); h.state(h.a, point, { vLong: 20 });
    const before = h.objective(h.a).deadline;
    const claim = { type: 'violation', id: 'test-claim', kind: 'camera', siteId: 'test-camera',
      s: point.s, dir: 1, kmh: 72, raceId: h.lobby.raceId, generation: h.lobby.generation, at: h.now() };
    h.send(h.a, claim); h.send(h.a, claim);
    assert.equal(h.a.messages.filter(m => m.type === 'violation-ack').length, 1);
    assert.equal(h.objective(h.a).deadline, before - 3);
    h.advance((before - 3) * 1000 - h.now());
    assert.equal(h.objective(h.a).done, true); assert.equal(h.objective(h.b).done, false);
    h.advance(3000);
    const results = latest(h.a, 'lobby').lobby.results;
    assert.deepEqual(results.map(p => p.id), [h.id(h.a), h.id(h.b)], 'equal counts and no trips sort by elapsed');
    const result = results[0];
    assert.equal(result.objective.penaltySec, 3); assert.equal(result.objective.elapsed, 297);
    assert.equal(result.finish, null); assert.equal(result.dnf, false); assert.equal(h.submissions.length, 0);
  });
}

test('two real WebSocket clients complete both real-manifest modes and receive authoritative results', async t => {
  // Controlled receiver clock keeps the 5-minute round lightweight. Socket
  // messages, transport, manifests, validation, replication and results are real.
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const dataDir = await mkdtemp(join(tmpdir(), 'paraliaki-objective-proof-'));
  let app;
  const clients = [];
  t.after(async () => { for (const c of clients) c.ws.terminate(); if (app) await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  app = await createGameServer({ dataDir, countdownMs: 100, reconnectGraceMs: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function client() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws?protocol='+MULTIPLAYER_PROTOCOL), inbox = [], waiting = [];
    const c = { ws, send: m => ws.send(JSON.stringify(m)) }; clients.push(c);
    ws.on('message', bytes => {
      const m = JSON.parse(bytes), i = waiting.findIndex(w => w.pred(m));
      if (i < 0) inbox.push(m); else waiting.splice(i, 1)[0].resolve(m);
    });
    c.next = pred => new Promise((resolve, reject) => {
      const i = inbox.findIndex(pred); if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
      const item = { pred, resolve: m => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => { waiting.splice(waiting.indexOf(item), 1); reject(new Error('Objective protocol message timeout')); }, 5000);
      waiting.push(item);
    });
    c.hello = await c.next(m => m.type === 'hello');
    return c;
  }
  const a = await client(), b = await client();
  assert.ok(!a.hello.maps.some(m => m.id === 'megara'));
  for (const mode of ['taxi', 'getaway']) {
    a.send({ type: 'create', name: 'Taxi driver', car: 'taxi', mapId: 'riviera', eventId: `${mode}:riviera`, config: { sessionDuration: 30 } });
    const created = (await a.next(m => m.type === 'lobby' && m.lobby.mode === mode && m.lobby.status === 'waiting')).lobby;
    assert.deepEqual(created.event.objectiveRoutes, maps.get('riviera').trips[mode]);
    assert.equal((await (await fetch(base + '/api/lobbies')).json())[0].event.objectiveRoutes, undefined);
    b.send({ type: 'join', code: created.code, car: 'mini' });
    await a.next(m => m.type === 'lobby' && m.lobby.code === created.code && m.lobby.players.length === 2);
    for (const c of [a, b]) c.send({ type: 'ready', ready: true, version: created.track.version });
    await a.next(m => m.type === 'lobby' && m.lobby.code === created.code && m.lobby.players.every(p => p.ready));
    a.send({ type: 'start' });
    const round = (await a.next(m => m.type === 'lobby' && m.lobby.code === created.code && m.lobby.status === 'countdown')).lobby;
    now += 100;
    await a.next(m => m.type === 'lobby' && m.lobby.raceId === round.raceId && m.lobby.status === 'race');
    let previous = maps.get('riviera').track.start;
    for (const target of [created.event.objectiveRoutes[0].pickup, created.event.objectiveRoutes[0].dropoff]) {
      now += Math.ceil(Math.abs(target.s - previous) / 100 * 1000) + 1000;
      for (let frame = 0; frame <= 16; frame++) {
        now += 100;
        a.send({ type: 'state', raceId: round.raceId, state: pose(target, { completed: 999 }) });
        const snap = await b.next(m => m.type === 'snapshot' && m.raceId === round.raceId && m.now === now && m.players.some(p => p.id === a.hello.id && p.state?.s === target.s));
        assert.equal(snap.players.find(p => p.id === a.hello.id).finish, null);
      }
      previous = target.s;
    }
    const live = (await b.next(m => m.type === 'lobby' && m.lobby.raceId === round.raceId && m.lobby.status === 'race' && m.lobby.players.some(p => p.objective?.completed === 1))).lobby;
    assert.equal(live.players.find(p => p.id === a.hello.id).objective.phase, 'cooldown');
    now = round.startAt + 30000;
    const result = (await b.next(m => m.type === 'lobby' && m.lobby.raceId === round.raceId && m.lobby.status === 'results')).lobby;
    assert.deepEqual(result.results.map(p => p.objective.completed), [1, 0]);
    assert.ok(result.results.every(p => p.finish === null && !p.dnf && p.objective.done));
    assert.deepEqual(app.leaderboard.list({}), []);
    for (const c of [a, b]) { c.send({ type: 'leave' }); await c.next(m => m.type === 'left'); }
  }
});
