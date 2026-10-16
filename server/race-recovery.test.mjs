import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';

const socket = () => ({ readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close() { this.readyState = 3; } });
const state = (s, epoch = 1, u = 2) => ({ x: s, y: 0, z: 0, yaw: 0, s, u, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2, sampleTime: 500, motionEpoch: epoch });
function race(t, dir = 1) {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const event = { id: 'quick', name: 'Recovery route', type: 'sprint', s0: dir > 0 ? 0 : 200, s1: dir > 0 ? 200 : 0, dir, len: 200, checkpoints: [{ s: 100, d: 100 }, { s: dir > 0 ? 200 : 0, d: 200 }] };
  const maps = new Map([['riviera', { track: { start: 0, finish: 200, version: 'test' }, definitions: new Map([['quick', event]]) }]]);
  const opts = { maps, cars: new Set(['mini']), leaderboard: { submit: async () => ({}) }, countdownMs: 10, raceLimitMs: 600000, reconnectGraceMs: 100 };
  const core = createGameCore(opts), a = socket(), b = socket(), c = socket();
  for (const ws of [a, b, c]) core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, data) => core.message(ws, JSON.stringify(data));
  send(a, { type: 'create', name: 'Alice' }); const code = a.messages.at(-1).lobby.code;
  for (const [ws, name] of [[b, 'Bob'], [c, 'Charlie']]) send(ws, { type: 'join', code, name });
  for (const ws of [a, b, c]) send(ws, { type: 'ready', ready: true, version: 'test' });
  send(a, { type: 'start' }); now += 11; core.tick();
  const lobby = a.messages.at(-1).lobby, id = a.messages[0].id;
  return { core, opts, a, b, c, lobby, id, event, send, advance(ms) { now += ms; }, get now() { return now; } };
}

for (const dir of [1, -1]) test(`three clients recover without checkpoint/finish shortcut (${dir > 0 ? 'forward' : 'reverse'})`, t => {
  const r = race(t, dir), s = distance => r.event.s0 + dir * distance;
  r.advance(500); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(70)) });
  r.advance(100); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(90), 1, 40) });
  // A claimed client recovery position is ignored; the last valid server road position wins.
  r.send(r.a, { type: 'recover', raceId: 'old', motionEpoch: 2 }); assert.notEqual(r.a.messages.at(-1).type, 'recovered');
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 2, s: s(200) });
  const ack = r.a.messages.at(-1); assert.equal(ack.type, 'recovered'); assert.equal(ack.s, s(70)); assert.equal(ack.until - r.now, 250);
  r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(200), 2) });
  r.core.tick(); let view = r.b.messages.at(-1); assert.equal(view.type, 'snapshot'); assert.equal(view.players.find(p => p.id === r.id).state.s, s(70)); assert.equal(view.players.find(p => p.id === r.id).finish, null);
  const stopped = { ...state(s(70), 2), vLong: 0 }; r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: stopped });
  r.advance(240); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(120), 2) });
  assert.equal(r.core.exportState().sessions.find(p => p.id === r.id).state.s, s(70));
  // Hold/epoch survives persistence and a transport restore.
  const saved = JSON.parse(JSON.stringify(r.core.exportState())); assert.equal(saved.sessions.find(p => p.id === r.id).recovery.until, ack.until);
  r.advance(10); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(200), 1) });
  assert.equal(r.core.exportState().sessions.find(p => p.id === r.id).finish, null, 'old pre-tow epoch cannot finish after hold');
  r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(200), 2) });
  assert.equal(r.core.exportState().sessions.find(p => p.id === r.id).finish, null, 'the placement transition cannot buy a finish teleport');
  r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(80), 2) });
  r.advance(1000); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(s(200), 2) });
  const finisher = r.core.exportState().sessions.find(p => p.id === r.id); assert.ok(finisher.finish >= 1.5); assert.equal(finisher.dnf, false);
  r.send(r.b, { type: 'dnf', raceId: r.lobby.raceId, reason: 'retired' }); assert.equal(r.core.exportState().sessions.find(p => p.id === r.b.messages[0].id).dnf, 'retired');
  r.send(r.c, { type: 'leave' }); assert.equal(r.a.messages.at(-1).lobby.status, 'results'); assert.equal(r.a.messages.at(-1).lobby.results.find(p => p.id === r.id).finish, finisher.finish);
});

test('recovery cannot advance a car that reversed behind its safe position', t => {
  const r = race(t); r.advance(500); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(70) });
  r.advance(200); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(60, 1, 40) });
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 2 }); assert.equal(r.a.messages.at(-1).s, 60);
});

test('police capture retains five seconds through persisted resume; receipt time and epoch cannot buy forward progress', t => {
  const r = race(t); r.advance(500);
  r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: { ...state(70), bodyDynamic: true, bodyQ: [1,0,0,0], air: true, vy: 5, engineStalled: true, engineDamage: 1, engHealth: 0, coolantTemp: 140, bodyRoll: 3 } });
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 2, capture: true });
  const ack = r.a.messages.at(-1); assert.equal(ack.until - r.now, 5000);
  const repaired = r.core.clientData(r.a).state;
  assert.equal(repaired.bodyDynamic,false);assert.equal(repaired.bodyQ,null);assert.equal(repaired.engineStalled,false);assert.equal(repaired.engHealth,1);assert.equal(repaired.bodyRoll,0);assert.equal(repaired.vy,0);
  // An ordinary request during capture cannot replace its hold with a cheap tow.
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 3 });
  assert.equal(r.a.messages.at(-1).until, ack.until);
  const saved = JSON.parse(JSON.stringify(r.core.exportState()));
  const sockets = new Map(r.core.exportState().sessions.map(p => [p.token, p.id === r.id ? r.a : p.id === r.b.messages[0].id ? r.b : r.c]));
  const restored = createGameCore(r.opts); restored.restore(saved, sockets);
  const send = data => restored.message(r.a, JSON.stringify({ raceId: r.lobby.raceId, ...data }));
  r.advance(4990);
  send({ type: 'state', state: state(120, 3) }); assert.equal(restored.clientData(r.a).state.s, 70, 'capture still held after resume');
  send({ type: 'state', state: { ...state(70, 3), vLong: 0 } });
  r.advance(10);
  send({ type: 'state', state: state(200, 2) }); assert.equal(restored.clientData(r.a).finish, null, 'pre-resume epoch rejected after expiry');
  send({ type: 'state', state: state(200, 3) }); assert.equal(restored.clientData(r.a).state.s, 70, 'five seconds waiting did not accumulate a travel budget');
  send({ type: 'state', state: state(80, 3) });
  r.advance(1000); send({ type: 'state', state: state(200, 3) });
  assert.ok(restored.clientData(r.a).finish >= 6.5);
});

test('omitting an optional render clock cannot erase the recovery epoch or replay an old request', t => {
  const r = race(t); r.advance(500);
  r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(70) });
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 2 });
  r.advance(250);
  const stopped = { ...state(70, 2), vLong: 0 }; delete stopped.sampleTime;
  r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: stopped });
  assert.equal(r.core.clientData(r.a).state.motionEpoch, 2);
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 1 });
  assert.equal(r.a.messages.at(-1).type, 'error'); assert.equal(r.core.clientData(r.a).recovery.motionEpoch, 2);
});
