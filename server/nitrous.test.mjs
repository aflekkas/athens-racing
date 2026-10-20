import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameCore } from './core.mjs';
import { readCarCapabilities } from './car-capabilities.mjs';

const capabilities = readCarCapabilities(readFileSync(new URL('../src/cars.js', import.meta.url), 'utf8'));
test('both server catalogue consumers identify only the equipped SEAT', () => {
  assert.deepEqual(capabilities.nitrousCars, ['ibiza_cupra']);
  for (const car of ['mini_jcw', 'golf_r', 'corolla', 'ibiza_cupra']) assert.ok(capabilities.cars.includes(car));
});

for (const car of ['mini_jcw', 'golf_r', 'corolla', 'ibiza_cupra']) test(`${car}: validated snapshots and restored sessions enforce nitrous capability`, () => {
  const map = { id: 'riviera', name: 'proof', track: { start: 0, finish: 1000, version: 'v1' }, definitions: new Map([['quick', { id: 'quick', type: 'sprint', s0: 0, s1: 1000, dir: 1, len: 1000 }]]) };
  const opts = { maps: new Map([['riviera', map]]), cars: new Set(capabilities.cars), nitrousCars: new Set(capabilities.nitrousCars), countdownMs: 0 };
  const core = createGameCore(opts);
  const socket = () => ({ readyState: 1, messages: [], send(bytes) { this.messages.push(JSON.parse(bytes)); }, close() {} });
  const a = socket(), b = socket(); core.connect(a, 'a', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'b', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, message) => core.message(ws, JSON.stringify(message));
  send(a, { type: 'create' }); send(b, { type: 'join', code: a.messages.at(-1).lobby.code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'v1', car });
  send(a, { type: 'start' }); core.tick();
  const raceId = a.messages.findLast(m => m.type === 'lobby').lobby.raceId;
  send(a, { type: 'state', raceId, state: { x: 0, y: 0, z: 0, yaw: 0, s: 0, u: 0, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2, nitro: .7, nitroOn: true } });
  const expected = car === 'ibiza_cupra' ? .7 : 0;
  const client = [...core.clients].find(c => c.ws === a);
  assert.equal(client.state.nitro, expected);
  assert.equal(client.state.nitroOn, undefined, 'unvalidated boost flags are never relayed');
  core.tick(Date.now() + 100);
  assert.equal(b.messages.findLast(m => m.type === 'snapshot').players.find(p => p.id === client.id).state.nitro, expected);
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  saved.sessions.find(c => c.id === client.id).state.nitro = .7;
  const restored = createGameCore(opts); restored.restore(saved);
  assert.equal(restored.sessions.get(client.token).state.nitro, expected);
});
