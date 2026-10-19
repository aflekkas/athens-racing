import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// Owner playtest 2026-10-18: "Where... oh, I'm back at the start. Am I?", "I thought it teleported you to Varkiza",
// "why am I all the way back here?". After a host restart, a reset/tow or a server restart a car must be where it was
// (tow, resume) or on its own grid slot (restart), on the server and so on every screen.
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() { this.readyState = 3; } });
const last = (ws, type) => ws.messages.findLast(m => m.type === type);
const event = { id: 'quick', name: 'Route', type: 'sprint', s0: 0, s1: 3000, len: 3000, dir: 1 };
const opts = () => ({ maps: new Map([['riviera', { track: { version: 'v' }, definitions: new Map([['quick', event]]) }]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 100, reconnectGraceMs: 60000 });
const pose = (s, v = 25, epoch = 1) => ({ x: s, y: 0, z: 0, yaw: 0, s, u: 0, vLong: v, vLat: 0, steer: 0, rpm: 3000, gear: 3, motionEpoch: epoch });
function race(t, core = createGameCore(opts())) {
  let now = 1e6; t.mock.method(Date, 'now', () => now);
  const a = socket(), b = socket();
  for (const ws of [a, b]) core.connect(ws, 'x', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, m) => core.message(ws, JSON.stringify(m)), advance = ms => { now += ms; core.tick(); };
  send(a, { type: 'create', name: 'ALPHA' }); const l = [...core.lobbies.values()][0];
  send(b, { type: 'join', code: l.code, name: 'BRAVO' });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'v' });
  send(a, { type: 'start' }); advance(150);
  const ids = { a: a.messages[0].id, b: b.messages[0].id };
  /** A driver at 15 fps (66 ms) with +-30 ms of jitter, 25 m/s, from s0 for `seconds`; returns the last s sent. */
  const drive = (ws, s0, seconds, { fps = 15, epoch = 1, v = 25 } = {}) => { let s = s0; for (let i = 0; i < seconds * fps; i++) { advance(1000 / fps + (i % 3 - 1) * 30); s += v / fps; send(ws, { type: 'state', raceId: l.raceId, generation: l.generation, state: pose(s, v, epoch) }); } return s; };
  return { core, a, b, send, advance, l, ids, drive, now: () => now };
}
const seat = (r, ws) => r.core.clientData(ws);

test('after the host restarts, every car is on its own grid slot for everyone, with no progress carried over from the old run', t => {
  const r = race(t); r.advance(100);
  const sA = r.drive(r.a, 100, 6), sB = r.drive(r.b, 60, 6);
  assert.ok(seat(r, r.a).state.s > 200);
  const old = r.l.raceId; r.send(r.a, { type: 'restart' });
  assert.notEqual(r.l.raceId, old); assert.equal(r.l.status, 'countdown');
  assert.equal(seat(r, r.a).state, null, 'the old pose is gone: nothing can read it back as "where you are"'); assert.equal(seat(r, r.b).state, null); assert.equal(seat(r, r.a).course, null);
  const lobby = last(r.b, 'lobby').lobby; assert.deepEqual(lobby.players.map(p => p.gridSlot).sort(), [0, 1], 'slots are stable across the restart');
  // a state of the old run still in flight is dropped, the new run's first state from the grid is accepted (not read as a jump from the old s)
  r.advance(30); r.send(r.a, { type: 'state', raceId: old, generation: r.l.generation - 1, state: pose(sA + 5) }); assert.equal(seat(r, r.a).state, null);
  r.advance(200); assert.equal(r.l.status, 'race');
  r.send(r.a, { type: 'state', raceId: r.l.raceId, generation: r.l.generation, state: pose(2, 0) }); assert.equal(seat(r, r.a).state.s, 2, 'the grid pose is accepted');
  r.send(r.b, { type: 'state', raceId: r.l.raceId, generation: r.l.generation, state: pose(0, 0) }); assert.equal(seat(r, r.b).state.s, 0);
  void sB;
});

test('a reset or tow lands where the car is, from a 15 fps sender with jitter, moving or parked', t => {
  for (const v of [25, 0]) {
    const r = race(t); r.advance(100);
    const s = r.drive(r.a, 500, 5, { v });
    r.send(r.a, { type: 'recover', raceId: r.l.raceId, generation: r.l.generation, motionEpoch: 2 });
    const rec = last(r.a, 'recovered'); assert.ok(rec, 'answered, never dropped');
    assert.ok(Math.abs(rec.s - s) < 3 + v / 15, `the tow is at the car's last position (${rec.s} vs ${s}), not at the start`);
    assert.ok(rec.s > 480);
    // what the other driver is shown right after is the same place
    r.advance(120); const snap = r.b.messages.findLast(m => m.type === 'snapshot'); const mine = snap?.players.find(p => p.id === r.ids.a);
    if (mine?.state) assert.ok(Math.abs(mine.state.s - rec.s) < 1, 'the other screen is told the tow pose');
  }
});

test('a server restart mid-race: the persisted pose is at most one checkpoint old, a returning driver keeps driving from where they are and a tow right after is nearby', t => {
  const r = race(t); r.advance(100);
  let s = r.drive(r.a, 100, 4); r.drive(r.b, 80, 4);
  const saved = JSON.parse(JSON.stringify(r.core.exportState())); // what the Worker stores: checkpointed at most every 2 s
  // the car carries on for 1.5 s while the arena restarts
  s = r.drive(r.a, s, 1.5);
  const core2 = createGameCore(opts()); const sockets = new Map();
  const a2 = socket(), b2 = socket(); sockets.set(seat(r, r.a).token, a2); sockets.set(seat(r, r.b).token, b2);
  core2.restore(saved, sockets);
  const l2 = [...core2.lobbies.values()][0]; assert.ok(l2, 'the lobby survives'); assert.equal(l2.status, 'race');
  const c2 = [...core2.clients].find(c => c.id === r.ids.a);
  const stale = c2.state.s; assert.ok(s - stale < 25 * 2.2, `the stored pose is at most ~2 s behind (${(s - stale).toFixed(1)} m)`);
  // the driver keeps sending from their real position: it is accepted, the store catches up
  const send2 = (ws, m) => core2.message(ws, JSON.stringify(m));
  r.advance(100); send2(a2, { type: 'state', raceId: l2.raceId, generation: l2.generation, state: pose(s + 4) });
  assert.ok(Math.abs(c2.state.s - (s + 4)) < .01, 'the real pose replaces the checkpoint instead of being rejected as a jump');
  send2(a2, { type: 'recover', raceId: l2.raceId, generation: l2.generation, motionEpoch: 2 });
  const rec = a2.messages.findLast(m => m.type === 'recovered'); assert.ok(rec); assert.ok(Math.abs(rec.s - (s + 4)) < 3, 'a tow after the restart is where the car is, not at the start');
});

test('a driver whose tab was throttled for several seconds is not frozen: their next states are accepted at the real position', t => {
  const r = race(t); r.advance(100);
  let s = r.drive(r.a, 300, 3);
  r.advance(6000); s += 25 * 6; // nothing sent for six seconds
  r.send(r.a, { type: 'state', raceId: r.l.raceId, generation: r.l.generation, state: pose(s) });
  assert.ok(Math.abs(seat(r, r.a).state.s - s) < .01, 'a long silence does not lock the seat to its old pose');
});
