import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// The arena relays two things for smooth, fair online driving: every car sample since the last snapshot (`trail`), and a driver's
// report of a car-to-car contact, which only the driver it names receives. Neither may leak across races or from nowhere.
const pose = (s, u = 0, extra = {}) => ({ x: s, y: 0, z: u, s, u, yaw: -Math.PI / 2, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2, ...extra });
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() {} });
function race(t, drivers = 3) {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const event = { id: 'quick', type: 'sprint', s0: 0, s1: 2400, len: 2400, dir: 1 };
  const core = createGameCore({ maps: new Map([['riviera', { track: { version: 'v' }, definitions: new Map([['quick', event]]) }]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 100 });
  const sockets = Array.from({ length: drivers }, socket); sockets.forEach((ws, i) => core.connect(ws, String(i), { protocol: MULTIPLAYER_PROTOCOL }));
  const send = (ws, m) => core.message(ws, JSON.stringify(m)), id = ws => core.clientData(ws).id;
  send(sockets[0], { type: 'create' }); const lobby = [...core.lobbies.values()][0];
  for (const ws of sockets.slice(1)) send(ws, { type: 'join', code: lobby.code });
  for (const ws of sockets) send(ws, { type: 'ready', ready: true, version: 'v' });
  send(sockets[0], { type: 'start' }); now += 1000; core.tick();
  const advance = (ms = 50) => { now += ms; core.tick(); };
  const state = (ws, p) => send(ws, { type: 'state', raceId: lobby.raceId, generation: lobby.generation, state: p });
  return { core, lobby, sockets, send, id, advance, state, at: () => now, raceId: () => lobby.raceId, generation: () => lobby.generation };
}
const report = (r, to, extra = {}) => ({ type: 'contact', raceId: r.raceId(), generation: r.generation(), to: r.id(to), nonce: 0, x: 30, z: 0, vx: 0, vz: -30, m: 1500, nx: 0, nz: 1, closing: 10, ...extra });
const received = (ws, from) => ws.messages.filter(m => m.type === 'contact' && (!from || m.from === from));

test('every accepted sample since the last snapshot is relayed oldest first, with the newest as state', t => {
  const r = race(t), [a, b] = r.sockets;
  for (const ws of r.sockets) ws.messages.length = 0;
  r.send(a, { type: 'states', raceId: r.raceId(), generation: r.generation(), states: [pose(30, 0, { sampleTime: 1000 }), pose(31, 0, { sampleTime: 1050 })] });
  r.advance(100);
  const snapshot = b.messages.findLast(m => m.type === 'snapshot'), mine = snapshot.players.find(p => p.id === r.id(a));
  assert.equal(mine.state.s, 31); assert.equal(mine.trail.length, 1); assert.equal(mine.trail[0].s, 30); assert.equal(mine.trail[0].sampleTime, 1000);
  assert.ok(Number.isFinite(mine.trail[0].stateAt));
  assert.ok(!('damage' in mine.trail[0]) && !('driver' in mine.trail[0]), 'a trail sample carries motion only');
  // Taken once: the next snapshot with a single new sample has no trail.
  r.send(a, { type: 'state', raceId: r.raceId(), generation: r.generation(), state: pose(32, 0, { sampleTime: 1100 }) }); r.advance(100);
  assert.equal(b.messages.findLast(m => m.type === 'snapshot').players.find(p => p.id === r.id(a)).trail, undefined);
  // One encoding for everyone: identical bytes for both drivers.
  assert.deepEqual(a.messages.findLast(m => m.type === 'snapshot'), b.messages.findLast(m => m.type === 'snapshot'));
});

test('a restart or a tow never relays samples from before it', t => {
  const r = race(t), [a, b] = r.sockets;
  r.send(a, { type: 'states', raceId: r.raceId(), generation: r.generation(), states: [pose(30, 0, { sampleTime: 1000, motionEpoch: 1 }), pose(31, 0, { sampleTime: 1050, motionEpoch: 1 })] });
  r.send(a, { type: 'restart' }); r.advance(100);
  r.send(a, { type: 'state', raceId: r.raceId(), generation: r.generation(), state: pose(2, 0, { sampleTime: 3000 }) }); r.advance(100);
  const fresh = b.messages.findLast(m => m.type === 'snapshot').players.find(p => p.id === r.id(a));
  assert.equal(fresh.state.s, 2); assert.equal(fresh.trail, undefined, 'the old race\'s samples are gone');
});

test('a contact report reaches only the driver it names, stamped by the arena, once', t => {
  const r = race(t), [a, b, c] = r.sockets; r.advance(50);
  r.state(a, pose(30)); r.state(b, pose(33)); r.state(c, pose(34)); r.advance(50);
  for (const ws of r.sockets) ws.messages.length = 0;
  r.send(b, report(r, a, { nonce: 0 }));
  const got = received(a); assert.equal(got.length, 1); assert.equal(received(b).length + received(c).length, 0, 'nobody else hears it');
  assert.equal(got[0].from, r.id(b)); assert.equal(got[0].at, r.at()); assert.equal(got[0].raceId, r.raceId()); assert.equal(Math.hypot(got[0].nx, got[0].nz), 1);
  r.send(b, report(r, a, { nonce: 0 })); r.send(b, report(r, a, { nonce: -1 }));
  assert.equal(received(a).length, 1, 'a replayed or older nonce is dropped');
  r.send(b, report(r, a, { nonce: 1 })); assert.equal(received(a).length, 2);
});

test('impossible contact reports are not relayed', t => {
  const r = race(t), [a, b, c] = r.sockets; r.advance(50);
  r.state(a, pose(30)); r.state(b, pose(33)); r.state(c, pose(300)); r.advance(50);
  for (const ws of r.sockets) ws.messages.length = 0;
  const bad = { 'a driver 270 m away': [c, a, {}], 'an unknown target': [b, null, { to: 'nobody' }], 'yourself': [b, b, {}], 'NaN velocity': [b, a, { vx: NaN }], 'an absurd velocity': [b, a, { vz: -900 }], 'a 1 g car': [b, a, { m: 1 }], 'a string': [b, a, { x: '30' }],
    'the wrong race': [b, a, { raceId: 'old' }], 'the wrong generation': [b, a, { generation: 99 }], 'a negative closing speed': [b, a, { closing: -5 }] };
  let nonce = 0;
  for (const [what, [from, to, extra]] of Object.entries(bad)) { r.send(from, report(r, to || a, { nonce: nonce++, ...extra })); assert.equal(received(a).length + received(b).length + received(c).length, 0, what); }
  // Rate: ten a second (rejected reports count), then quiet until the window rolls.
  r.advance(1100);
  for (let i = 0; i < 14; i++) r.send(b, report(r, a, { nonce: 100 + i })); assert.equal(received(a).length, 10);
});

test('contacts need a live race and two drivers who are still racing', t => {
  const r = race(t), [a, b] = r.sockets; r.advance(50);
  r.state(a, pose(30)); r.state(b, pose(33)); r.advance(50);
  r.send(b, { type: 'dnf', raceId: r.raceId(), generation: r.generation(), reason: 'retired' });
  for (const ws of r.sockets) ws.messages.length = 0;
  r.send(a, report(r, b, { nonce: 0 })); assert.equal(received(b).length, 0, 'a retired driver is not hit');
  r.send(b, report(r, a, { nonce: 0 })); assert.equal(received(a).length, 0, 'and does not hit');
});
