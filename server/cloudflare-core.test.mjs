import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGameCore } from './core.mjs';
import { createSqlLeaderboard } from '../worker/leaderboard.mjs';

const map = (id, len, version, closed = false) => ({ id, name: id, track: { start: 0, finish: len, version }, definitions: new Map([[id === 'riviera' ? 'quick' : id + '-race', { id: id === 'riviera' ? 'quick' : id + '-race', name: id, type: 'sprint', s0: 0, s1: len, dir: 1, len, routeKey: `0>${len}`, traffic: false, closed }]]) });
const maps = new Map([['riviera', map('riviera', 15, 'coast')], ['megara', map('megara', 40, 'circuit', true)]]), cars = new Set(['mini']);
const socket = () => ({ readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close() { this.readyState = 3; } });
const state = s => ({ x: s, y: 0, z: 0, yaw: 0, s, u: 0, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2 });

test('shared core restores lobby, socket identity, race clock and state after hibernation; coalesces relays', t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const opts = { maps, cars, leaderboard: { submit: async () => ({ saved: true }) }, countdownMs: 100, raceLimitMs: 5000, reconnectGraceMs: 500 };
  let core = createGameCore(opts); const a = socket(), b = socket(); core.connect(a, 'one'); core.connect(b, 'two');
  const hello = a.messages.find(m => m.type === 'hello'); assert.equal(hello.maps.length, 2);
  const send = (ws, value) => core.message(ws, JSON.stringify(value));
  send(a, { type: 'create', mapId: 'megara', eventId: 'quick' }); assert.match(a.messages.at(-1).message, /route/);
  send(a, { type: 'create', mapId: 'megara' }); const lobby = a.messages.at(-1).lobby; assert.equal(lobby.track.version, 'circuit');
  send(b, { type: 'join', code: lobby.code });
  send(a, { type: 'ready', ready: true, version: 'coast' }); assert.match(a.messages.at(-1).message, /track changed/);
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'circuit' });
  send(a, { type: 'start' }); now += 101; core.tick();
  const race = a.messages.at(-1).lobby; send(a, { type: 'states', raceId: race.raceId, states: [state(5), state(6)] });
  core.tick(); assert.equal(b.messages.at(-1).type, 'snapshot'); assert.equal(b.messages.at(-1).players.find(p => p.id === hello.id).state.s, 6);
  const count = b.messages.length; core.tick(); assert.equal(b.messages.length, count, 'unchanged state must not relay');
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  const connections = new Map([...core.clients].map(c => [c.token, c.ws]));
  core = createGameCore(opts); core.restore(saved, connections);
  send(a, { type: 'ping', sent: 42 }); assert.equal(a.messages.at(-1).sent, 42);
  assert.equal(core.lobbies.get(lobby.code).raceId, race.raceId);
  assert.equal(core.lobbies.get(lobby.code).startAt, race.startAt);
  assert.equal(core.sessions.get(hello.token).state.s, 6);
  now += 1000; for (const ws of [a, b]) send(ws, { type: 'state', raceId: race.raceId, state: state(40) });
  assert.equal(a.messages.at(-1).lobby.status, 'results'); assert.ok(a.messages.at(-1).lobby.results.every(p => p.finish !== null));
});

test('idle lobbies expire without a repeating timer and map changes invalidate ready votes', t => {
  let now = 10000; t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps, cars, leaderboard: { submit: async () => ({}) }, idleLobbyMs: 1000 });
  const a = socket(); core.connect(a, 'one'); const send = value => core.message(a, JSON.stringify(value));
  send({ type: 'create' }); send({ type: 'ready', ready: true, version: 'coast' });
  send({ type: 'options', mapId: 'megara' }); const lobby = a.messages.at(-1).lobby;
  assert.equal(lobby.eventId, 'megara-race'); assert.equal(lobby.players[0].ready, false);
  assert.equal(core.nextWake(), now + 1001); now += 1002; core.tick(); assert.equal(core.lobbies.size, 0);
  assert.ok(a.messages.some(m => m.type === 'left'));
});

test('SQLite leaderboard persists best records, separates map versions and shares Node validation', () => {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query, ...args) { if (query.includes(';')) { db.exec(query); return []; } const q = db.prepare(query); return q.columns().length ? q.all(...args) : (q.run(...args), []); } };
  const board = createSqlLeaderboard(sql, maps, cars), base = { driverId: 'test-driver-1', name: '<Driver>', car: 'mini', eventId: 'megara-race', mapId: 'megara', time: 2 };
  return (async () => {
    assert.equal((await board.submit(base)).saved, true); assert.equal((await board.submit({ ...base, time: 3 })).saved, false);
    assert.equal((await board.submit({ ...base, time: 1 })).saved, true);
    const reopened = createSqlLeaderboard(sql, maps, cars); assert.equal(reopened.list({ mapId: 'megara' })[0].time, 1); assert.equal(reopened.list({ mapId: 'megara' })[0].driverId, undefined);
    assert.equal(reopened.list({ mapId: 'riviera' }).length, 0);
    await assert.rejects(board.submit({ ...base, mapId: 'riviera' }), /Unknown event/); await assert.rejects(board.submit({ ...base, time: 0.001 }), /implausible/);
    db.close();
  })();
});

test('wreck DNF is authoritative, never records a time, ignores fake finish and completes with the other finisher', t => {
  let now = 200000; t.mock.method(Date, 'now', () => now);
  const submissions = [], opts = { maps, cars, leaderboard: { submit: async r => submissions.push(r) }, countdownMs: 100 };
  let core = createGameCore(opts);
  const a = socket(), b = socket(); core.connect(a, 'one'); core.connect(b, 'two');
  const helloA = a.messages.find(m => m.type === 'hello'), helloB = b.messages.find(m => m.type === 'hello');
  assert.equal(helloA.features.wreckDnf, true);
  const send = (ws, m) => core.message(ws, JSON.stringify(m));
  send(a, { type: 'create' }); const code = a.messages.at(-1).lobby.code;
  send(b, { type: 'join', code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' }); const raceId = a.messages.at(-1).lobby.raceId;
  // A pre-GO or stale packet cannot declare a wreck for a different race.
  send(a, { type: 'dnf', raceId, reason: 'wrecked' }); assert.equal(core.lobbies.get(code).players.get(helloA.id).dnf, false);
  now += 2100; core.tick();
  send(a, { type: 'dnf', raceId: 'stale-race', reason: 'wrecked' }); assert.equal(core.lobbies.get(code).players.get(helloA.id).dnf, false);
  send(a, { type: 'dnf', raceId, reason: 'busted' }); assert.match(a.messages.at(-1).message, /Unknown DNF/);
  send(a, { type: 'dnf', raceId, reason: 'wrecked' });
  const wreck = a.messages.at(-1).lobby.players.find(p => p.id === helloA.id);
  assert.equal(wreck.dnf, 'wrecked'); assert.equal(wreck.finish, null); assert.equal(submissions.length, 0);
  const saved = JSON.parse(JSON.stringify(core.exportState())), sockets = new Map([...core.clients].map(c => [c.token, c.ws]));
  core = createGameCore(opts); core.restore(saved, sockets);
  send(a, { type: 'states', raceId, states: [state(14), state(15)] });
  const wrecked = core.lobbies.get(code).players.get(helloA.id);
  assert.equal(wrecked.finish, null); assert.equal(wrecked.state, null); assert.equal(submissions.length, 0);
  send(b, { type: 'state', raceId, state: state(15) });
  const lobby = b.messages.at(-1).lobby; assert.equal(lobby.status, 'results');
  const lost = lobby.results.find(p => p.id === helloA.id), won = lobby.results.find(p => p.id === helloB.id);
  assert.equal(lost.dnf, 'wrecked'); assert.equal(lost.finish, null);
  assert.equal(won.dnf, false); assert.ok(Number.isFinite(won.finish));
  assert.equal(submissions.length, 1); assert.equal(submissions[0].driverId, helloB.id);
  // Later duplicate declarations or fake progress cannot mutate either result.
  send(a, { type: 'state', raceId, state: state(15) }); assert.equal(submissions.length, 1);
  send(a, { type: 'rematch' }); assert.ok(a.messages.at(-1).lobby.players.every(p => p.dnf === false && p.finish === null));
});
