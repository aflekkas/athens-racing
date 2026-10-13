import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateSender } from '../src/multiplayer-state.js';
import { Multiplayer } from '../src/multiplayer.js';
import { getLeaderboard, submitResult } from '../src/leaderboard.js';

const state = (extra = {}) => ({ x: 0, y: 0, z: 0, s: 0, u: 0, yaw: 0, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1, nitro: 1, reverse: false, damage: { front: 0, rear: 0, left: 0, right: 0 }, ...extra });
function sender() {
  let now = 0, sequence = 0; const timers = new Map(), packets = [];
  const sender = new StateSender(p => packets.push(p), { now: () => now,
    schedule: (fn, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, fn }); return id; },
    cancel: id => timers.delete(id) });
  const advance = value => { now = value; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
  return { sender, packets, advance, timers };
}

test('moving clients produce at most five immutable two-sample messages per second', () => {
  const q = sender();
  for (let t = 0; t < 1000; t += 10) { q.advance(t); const s = state({ s: t / 100, vLong: 10 }); q.sender.sample(s, 'race', { batching: true }); s.s = -999; s.damage.front = 1; }
  assert.equal(q.packets.length, 5);
  assert.ok(q.packets.every(p => p.type === 'states' && p.states.length === 2 && p.raceId === 'race'));
  assert.deepEqual(q.packets[0].states.map(s => s.s), [0, 1]);
  assert.equal(q.packets[0].states[0].damage.front, 0);
});

test('a single sample flushes at 200ms and unchanged stationary clients remain quiet', () => {
  const q = sender(); q.sender.sample(state(), 'race', { batching: true });
  q.advance(199); assert.equal(q.packets.length, 0);
  q.advance(200); assert.equal(q.packets.length, 1); assert.equal(q.packets[0].states.length, 1);
  for (let t = 300; t <= 10000; t += 100) { q.advance(t); q.sender.sample(state({ rpm: 950 }), 'race', { batching: true }); }
  assert.equal(q.packets.length, 1);
  q.advance(10100); q.sender.sample(state({ gear: 2 }), 'race', { batching: true }); q.advance(10300);
  assert.equal(q.packets.length, 2); assert.equal(q.packets[1].states[0].gear, 2);
});

test('finish forces a sub-100ms flush and reset cancels packets from an earlier race', () => {
  const q = sender(); q.sender.sample(state({ vLong: 10, s: 99 }), 'first', { batching: true });
  q.advance(20); q.sender.sample(state({ vLong: 10, s: 101 }), 'first', { batching: true, force: true });
  assert.equal(q.packets.length, 1); assert.equal(q.packets[0].states.at(-1).s, 101);
  q.advance(120); q.sender.sample(state({ vLong: 10 }), 'first', { batching: true }); q.sender.reset();
  q.advance(1000); assert.equal(q.packets.length, 1);
  q.sender.sample(state({ vLong: 10 }), 'second', { batching: true }); q.advance(1200);
  assert.equal(q.packets[1].raceId, 'second');
});

test('legacy servers receive single states at ten Hz', () => {
  const q = sender(); for (let t = 0; t < 1000; t += 10) { q.advance(t); q.sender.sample(state({ vLong: 10, s: t / 100 }), 'race'); }
  assert.equal(q.packets.length, 10); assert.ok(q.packets.every(p => p.type === 'state'));
});

test('default timers retain the browser global receiver when called through the sender', () => {
  const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout; let scheduled = 0, canceled = 0;
  globalThis.setTimeout = function() { assert.equal(this, globalThis); scheduled++; return 123; };
  globalThis.clearTimeout = function(id) { assert.equal(this, globalThis); assert.equal(id, 123); canceled++; };
  try { const sender = new StateSender(() => {}, { now: () => 0 }); sender.sample(state(), 'race', { batching: true }); sender.reset(); assert.equal(scheduled, 1); assert.equal(canceled, 1); }
  finally { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
});

function lobbyClient(mapId = 'megara') {
  const m = Object.create(Multiplayer.prototype), starts = [], maps = [], packets = [];
  Object.assign(m, { loaded: true, connected: true, mapId: 'riviera', preparing: null, failedMap: null, id: 'me', offset: 0,
    pendingResume: false, resumeState: null, startedRace: null, panel: { hidden: false }, peers: new Map(),
    lobby: { mapId, raceId: 'race', status: 'race', startAt: Date.now() - 1000, players: [{ id: 'me', finish: null }], event: { s1: 100, dir: 1 } },
    hooks: { clearInput() {}, members() {}, wait() {}, results() {}, remote() {}, clock() {}, wrecked() {}, start: (...args) => starts.push(args), mapChanged: async id => { maps.push(id); m.mapId = id; } },
    renderRoom() {}, status() {}, hidePanel() { this.panel.hidden = true; }, stateSender: new StateSender(p => packets.push(p)) });
  return { m, starts, maps, packets };
}

test('race start and state sending wait for async map preparation', async () => {
  const { m, starts, packets } = lobbyClient(); let release;
  m.hooks.mapChanged = async id => { await new Promise(resolve => { release = resolve; }); m.mapId = id; };
  const pending = m.syncLobby(); await Promise.resolve();
  m.peers.set('stationary', { state: state(), at: 0 });
  assert.equal(m.worldReady, false); m.update(1 / 60, state({ vLong: 10 })); assert.equal(packets.length, 0); assert.equal(starts.length, 0);
  release(); await pending; assert.equal(m.worldReady, true); assert.equal(starts.length, 1);
  assert.ok(m.peers.has('stationary'), 'snapshots arriving during loading must survive race hydration');
  await m.syncLobby(); assert.equal(starts.length, 1); m.stateSender.reset();
});

test('a stale route version cannot hydrate a race or send state', async () => {
  const { m, starts, packets } = lobbyClient('riviera');
  m.trackVersion = 'old'; m.lobby.track = { version: 'new' };
  await m.syncLobby(); m.update(1 / 60, state({ vLong: 10 }));
  assert.equal(m.versionMismatch, true); assert.equal(m.worldReady, false); assert.equal(starts.length, 0); assert.equal(packets.length, 0);
});

test('queued map and resume changes hydrate only the newest lobby and saved state', async () => {
  const { m, starts, maps } = lobbyClient(); let release;
  m.hooks.mapChanged = async id => { maps.push(id); if (id === 'megara') await new Promise(resolve => { release = resolve; }); m.mapId = id; };
  const pending = m.syncLobby(); await Promise.resolve();
  m.lobby = { ...m.lobby, mapId: 'penteli', raceId: 'new-race' }; m.pendingResume = true; m.resumeState = state({ s: 30 });
  release(); await pending;
  assert.deepEqual(maps, ['megara', 'penteli']); assert.equal(starts.length, 1); assert.equal(starts[0][0].raceId, 'new-race'); assert.equal(starts[0][2].s, 30);
  assert.equal(m.pendingResume, false); assert.equal(m.resumeState, null); m.stateSender.reset();
});

test('solo and online board requests include the selected map', async () => {
  const oldFetch = globalThis.fetch, oldStore = globalThis.localStorage, requests = [];
  globalThis.localStorage = { getItem: key => key === 'paraliaki.driverId' ? 'abc' : 'QA' };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ saved: true }) }; };
  try {
    await getLeaderboard({ mapId: 'megara', eventId: 'megara-tt' });
    await submitResult({ mapId: 'penteli', eventId: 'penteli-tt', car: 'mini', time: 120, valid: true });
    await submitResult({ mapId: 'penteli', time: 120, valid: false });
    assert.equal(new URL(requests[0].url, 'http://localhost').searchParams.get('mapId'), 'megara');
    assert.equal(JSON.parse(requests[1].options.body).mapId, 'penteli'); assert.equal(requests.length, 2);
  } finally { globalThis.fetch = oldFetch; if (oldStore === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStore; }
});


test('100 km/h impact retires once, cancels a queued finish and never sends another state', () => {
  const { m, packets } = lobbyClient('riviera'); let wrecks = 0;
  const q = sender(); m.stateSender = q.sender; m.send = p => packets.push(p); m.hooks.wrecked = () => wrecks++;
  m.boardAt = performance.now();
  q.sender.sample(state({ s: 101, vLong: 10 }), 'race', { batching: true });
  assert.equal(m.wreck(100 / 3.6 - 1e-6), false); assert.equal(q.timers.size, 1);
  assert.equal(m.wreck(100 / 3.6), true); assert.equal(m.wreck(110 / 3.6), false);
  assert.deepEqual(packets, [{ type: 'dnf', raceId: 'race', reason: 'wrecked' }]); assert.equal(wrecks, 1);
  q.advance(200); m.update(1 / 60, state({ s: 101, vLong: 10 }));
  assert.equal(q.packets.length, 0); assert.equal(packets.length, 1); assert.equal(m.me.finish, null);
  m.me.dnf = 'wrecked'; m.sendWreck(); assert.equal(packets.length, 1);
});

test('wreck is retained across a reconnect, re-reported once and cleared for a new race', async () => {
  const { m, packets } = lobbyClient('riviera'); m.startedRace = 'race'; m.send = p => packets.push(p); m.connected = false;
  assert.equal(m.wreck(100 / 3.6), true); assert.equal(packets.length, 0);
  m.connected = true; m.pendingResume = true; await m.syncLobby();
  assert.equal(m.wrecked, true); assert.deepEqual(packets, [{ type: 'dnf', raceId: 'race', reason: 'wrecked' }]);
  await m.syncLobby(); assert.equal(packets.length, 1);
  m.lobby.raceId = 'next'; await m.syncLobby(); assert.equal(m.wrecked, false); assert.equal(m.retired, false);
});

test('wrecked drivers rank behind active racers and spectate only remaining drivers', () => {
  const { m } = lobbyClient('riviera'); m.me.dnf = 'wrecked'; m.spectateIndex = 0; m.spectateAt = performance.now();
  m.lobby.players.push({ id: 'active', finish: null }, { id: 'retired', finish: null, dnf: 'wrecked' });
  m.peers.set('active', { state: state({ s: 10 }) }); m.peers.set('retired', { state: state({ s: 99 }) });
  assert.equal(m.ranking(100)[0].id, 'active'); assert.equal(m.spectating().id, 'active');
  m.me.finish = 1; assert.equal(m.wreck(120 / 3.6), false);
});
