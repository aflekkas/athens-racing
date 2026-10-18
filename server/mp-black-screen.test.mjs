import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';

// Owner playtest 2026-10-18: "press T ... it just goes to black and comes back" and a "reconnecting" loop.
// A request the server drops silently leaves the client's screen black until its timeout; every one is answered now.
const socket = () => ({ readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close() { this.readyState = 3; } });
const state = (s, epoch = 1, u = 2) => ({ x: s, y: 0, z: 0, yaw: 0, s, u, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2, sampleTime: 500, motionEpoch: epoch });
function race(t) {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const event = { id: 'quick', name: 'Route', type: 'sprint', s0: 0, s1: 200, dir: 1, len: 200, sectors: [{ s: 100, d: 100 }, { s: 200, d: 200 }] };
  const maps = new Map([['riviera', { track: { start: 0, finish: 200, version: 'test' }, definitions: new Map([['quick', event]]) }]]);
  const core = createGameCore({ maps, cars: new Set(['mini']), leaderboard: { submit: async () => ({}) }, countdownMs: 10, raceLimitMs: 600000, reconnectGraceMs: 100 });
  const a = socket(), b = socket();
  for (const ws of [a, b]) core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, data) => core.message(ws, JSON.stringify(data));
  send(a, { type: 'create', name: 'Alice' }); const code = a.messages.at(-1).lobby.code; send(b, { type: 'join', code, name: 'Bob' });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'test' });
  send(a, { type: 'start' }); now += 11; core.tick();
  return { core, a, b, send, lobby: a.messages.at(-1).lobby, advance: ms => { now += ms; } };
}

test('a recovery request that cannot be served is denied at once, never dropped', t => {
  const r = race(t);
  // before the first position update
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 2 });
  let denial = r.a.messages.at(-1); assert.equal(denial.type, 'recover-denied'); assert.equal(denial.motionEpoch, 2); assert.equal(denial.raceId, r.lobby.raceId);
  assert.equal(denial.epoch, undefined, 'no epoch to catch up to before any position was accepted');
  // another race
  r.advance(500); r.send(r.a, { type: 'state', raceId: r.lobby.raceId, state: state(50, 5) });
  r.send(r.a, { type: 'recover', raceId: 'old-race', motionEpoch: 6 });
  assert.equal(r.a.messages.at(-1).type, 'recover-denied');
  // an epoch the server has already seen: it says which epoch to go beyond
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 3 });
  denial = r.a.messages.at(-1); assert.equal(denial.type, 'recover-denied'); assert.equal(denial.epoch, 5);
  r.send(r.a, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 6 }); assert.equal(r.a.messages.at(-1).type, 'recovered');
  // a retired driver
  r.send(r.b, { type: 'dnf', raceId: r.lobby.raceId, reason: 'retired' });
  r.send(r.b, { type: 'recover', raceId: r.lobby.raceId, motionEpoch: 2 }); assert.equal(r.b.messages.at(-1).type, 'recover-denied');
});

test('a resume token from another account or from before sign-in is answered as an expired session', t => {
  const core = createGameCore({ maps: new Map([['riviera', { track: { start: 0, finish: 200, version: 'v' }, definitions: new Map([['quick', { id: 'quick', type: 'sprint', s0: 0, s1: 200, dir: 1, len: 200 }]]) }]]), cars: new Set(['mini']), leaderboard: { submit: async () => ({}) }, reconnectGraceMs: 100 });
  const before = socket(); core.connect(before, 'test', { protocol: MULTIPLAYER_PROTOCOL });
  const token = before.messages.find(m => m.type === 'hello').token;
  const signedIn = socket(); core.connect(signedIn, 'test', { protocol: MULTIPLAYER_PROTOCOL, identity: { userId: 'u1', name: 'Alice' } });
  core.message(signedIn, JSON.stringify({ type: 'resume', token }));
  const answer = signedIn.messages.at(-1);
  assert.equal(answer.type, 'session'); assert.equal(answer.resumed, false); assert.ok(answer.token && answer.token !== token);
  assert.ok(!signedIn.messages.some(m => m.type === 'error'), 'no unanswered error: the client would wait forever');
});
