import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// Owner playtest 2026-10-18: "I created the lobby. Can you go try to join the lobby? What happened? Why did it bug out?",
// "Are you in my lobby or no?", "Oh, I can't change car. Why am I in the game?". The lobby is a small state machine shared by
// two people who click at the same time; none of these races may end in an error toast, a half-joined driver or a live race.
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() { this.readyState = 3; } });
const last = (ws, type) => ws.messages.findLast(m => m.type === type);
function room(t) {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const event = { id: 'quick', name: 'Route', type: 'sprint', s0: 0, s1: 240, len: 240, dir: 1 };
  const maps = new Map([['riviera', { track: { version: 'v' }, definitions: new Map([['quick', event]]) }]]);
  const core = createGameCore({ maps, cars: new Set(['mini', 'a160']), leaderboard: { submit: async () => {} }, countdownMs: 100 });
  const a = socket(), b = socket();
  for (const ws of [a, b]) core.connect(ws, 'x', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, m) => core.message(ws, JSON.stringify(m)), advance = ms => { now += ms; core.tick(); };
  send(a, { type: 'create', name: 'ALPHA' });
  const l = [...core.lobbies.values()][0];
  return { core, a, b, send, advance, l, code: l.code, errors: ws => ws.messages.filter(m => m.type === 'error').map(m => m.message) };
}

test('a second click, or a retried message, for the lobby you are already in is answered with the lobby and no error', t => {
  const { send, b, l, code, errors, core } = room(t);
  send(b, { type: 'join', code, name: 'BRAVO' });
  const before = last(b, 'lobby').lobby.players.length;
  send(b, { type: 'join', code: code.toLowerCase(), name: 'BRAVO' }); send(b, { type: 'join', code: ` ${code} `, name: 'BRAVO' });
  assert.deepEqual(errors(b), [], 'no "Leave your current lobby first" toast for the lobby you are in');
  assert.equal(l.players.size, 2); assert.equal(last(b, 'lobby').lobby.players.length, before, 'one seat, not two');
  assert.equal(core.publicLobby(l).players.filter(p => p.name.startsWith('BRAVO')).length, 1);
});

test('joining a different lobby, or creating one, while you are in a lobby is still refused', t => {
  const { send, b, a, code, core, errors } = room(t);
  send(b, { type: 'create', name: 'BRAVO' }); const other = [...core.lobbies.keys()].find(k => k !== code);
  send(a, { type: 'join', code: other, name: 'ALPHA' }); send(a, { type: 'create', name: 'ALPHA' });
  assert.equal(errors(a).length, 2); assert.ok(errors(a).every(m => /Leave your current lobby/.test(m)));
});

test('leave then join again at once ends with the driver in exactly one lobby, in the order the server saw it', t => {
  const { send, b, l, code, core } = room(t);
  send(b, { type: 'join', code, name: 'BRAVO' }); send(b, { type: 'leave' }); send(b, { type: 'join', code, name: 'BRAVO' });
  assert.equal(l.players.size, 2); assert.equal(last(b, 'lobby').lobby.code, code);
  const types = b.messages.map(m => m.type).filter(x => ['lobby', 'left'].includes(x)); assert.equal(types.at(-1), 'lobby', 'the last thing the client hears is the lobby, so it cannot end up showing "left"');
  assert.equal(core.clientData(b).lobbyCode, code);
});

test('a driver who joins while the host is pressing start is never swept into a race they have not loaded', t => {
  const { send, a, b, l, code, advance, errors } = room(t);
  send(b, { type: 'join', code, name: 'BRAVO' });
  send(a, { type: 'ready', ready: true, version: 'v' });
  send(a, { type: 'start' });
  assert.equal(l.status, 'waiting', 'the guest has not loaded or readied: nothing starts'); assert.ok(errors(a).length === 1);
  send(b, { type: 'loaded', loaded: true, mapId: 'riviera', version: 'v' }); send(b, { type: 'ready', ready: true, version: 'v' });
  send(a, { type: 'start' }); assert.equal(l.status, 'countdown');
  advance(500); assert.equal(l.status, 'race');
});

test('a car pick in the waiting lobby reaches everyone; once the race is live the answer says why it is refused', t => {
  const { send, a, b, l, code, core, errors } = room(t);
  send(b, { type: 'join', code, name: 'BRAVO' });
  send(b, { type: 'car', car: 'a160' });
  assert.equal(core.publicLobby(l).players.find(p => p.id !== core.publicLobby(l).host).car, 'a160'); assert.equal(last(a, 'lobby').lobby.players.find(p => p.car === 'a160')?.car, 'a160', 'the host sees the pick');
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'v' });
  send(a, { type: 'start' }); assert.equal(l.status, 'countdown', 'ready votes after a car pick start the race');
  send(b, { type: 'car', car: 'mini' }); assert.ok(errors(b).some(m => /already started/.test(m)));
});
