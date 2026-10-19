import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
// Lobby setup that depends on the track follows the track. 2026-10-18 playtest: "why is there traffic on Megara".
const def = (id, mapId, extra = {}) => ({ id, mapId, type: 'sprint', s0: 0, s1: 240, len: 240, dir: 1, traffic: false, trafficLevel: 0, conditions: null, ...extra });
const maps = new Map([
  ['riviera', { track: { version: 'v' }, definitions: new Map([['quick', def('quick', 'riviera', { traffic: true, trafficLevel: 1, conditions: { time: 'sunset', weather: 'clear' } })]]) }],
  ['megara', { track: { version: 'v' }, closed: true, definitions: new Map([['megara-race', def('megara-race', 'megara', { conditions: { time: 'afternoon', weather: 'clear' } })]]) }],
]);
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() {} });
function lobby() {
  const core = createGameCore({ maps, cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 100 }), host = socket();
  core.connect(host, '1', { protocol: MULTIPLAYER_PROTOCOL });
  const send = m => core.message(host, JSON.stringify(m)); let t = 0; const realNow = Date.now; Date.now = () => realNow() + (t += 1500); // host actions are rate limited per second
  send({ type: 'create', name: 'HOST' });
  const l = [...core.lobbies.values()][0], config = () => core.publicLobby(l).config;
  return { core, send, l, config, done: () => { Date.now = realNow; } };
}
test('a lobby created on Riviera has traffic; moving it to Megara drops to Megara\'s own traffic, time and weather, and back again', () => {
  const { send, l, config, done } = lobby();
  try {
    assert.equal(config().traffic, 1); assert.equal(config().time, 'sunset');
    send({ type: 'options', mapId: 'megara', eventId: 'megara-race' });
    assert.equal(l.mapId, 'megara'); assert.equal(config().traffic, 0, 'no traffic on the circuit unless the host asks for it'); assert.equal(config().time, 'afternoon'); assert.equal(l.traffic, false);
    send({ type: 'options', mapId: 'riviera', eventId: 'quick' });
    assert.equal(config().traffic, 1); assert.equal(config().time, 'sunset');
  } finally { done(); }
});
test('what the host sets in the same message as the track change wins, and edits on the same track keep the host\'s choices', () => {
  const { send, l, config, done } = lobby();
  try {
    send({ type: 'options', mapId: 'megara', eventId: 'megara-race', config: { traffic: 2, weather: 'rain' } });
    assert.equal(config().traffic, 2); assert.equal(config().weather, 'rain'); assert.equal(config().time, 'afternoon');
    send({ type: 'options', config: { time: 'night' } });
    assert.equal(config().traffic, 2, 'an edit on the same track keeps the rest'); assert.equal(config().time, 'night'); assert.equal(l.mapId, 'megara');
  } finally { done(); }
});
