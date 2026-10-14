// Supported-mode regression proof shared by the Node server and Worker core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAPS } from '../src/map-catalog.js';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { resolveMap } from './map-definitions.mjs';
import { createGameCore } from './core.mjs';
import { QUICK_RACE } from '../src/events.js';
import { setupFields, applySetup } from '../src/race-setup.js';
import { assertModeAllowed } from './mp-lifecycle.mjs';

const maps = new Map(await Promise.all(MAPS.map(async meta => {
  const data = JSON.parse(await readFile(new URL('../' + meta.dataUrl, import.meta.url), 'utf8'));
  return [meta.id, resolveMap(meta, data)];
})));
const last = (ws, type) => ws.messages.filter(m => m.type === type).at(-1);
function harness(t) {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const submissions = [];
  const core = createGameCore({ maps, cars: new Set(['mini', 'z4']), leaderboard: { submit: async r => submissions.push(r) }, countdownMs: 100, raceLimitMs: 1000 });
  const socket = () => {
    const ws = { readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close() { this.readyState = 3; } };
    core.connect(ws, 'fixture', { protocol: MULTIPLAYER_PROTOCOL }); return ws;
  };
  return { core, socket, submissions, send: (ws, msg) => core.message(ws, JSON.stringify(msg)), advance(ms) { now += ms; core.tick(); } };
}
test('every map registers exactly Quick Race and Free Roam; no objective manifests', () => {
  for (const map of maps.values()) {
    assert.deepEqual([...map.definitions.values()].map(d => d.type), ['sprint', 'free']);
    assert.deepEqual(map.trips, { taxi: null, getaway: null });
    assert.equal([...map.definitions.values()][0].name, 'QUICK RACE');
  }
});
test('shared whitelist rejects removed modes regardless of road type', () => {
  for (const closed of [false, true]) {
    for (const type of ['taxi', 'getaway', 'timetrial', 'pursuit', 'unknown']) assert.match(assertModeAllowed({ type }, closed), /Mode unavailable/);
    for (const type of ['sprint', 'free']) assert.equal(assertModeAllowed({ type }, closed), null);
  }
});
test('removed create/options requests leave lobby state intact; stale stored lobbies are discarded', t => {
  const { core, socket, send } = harness(t), host = socket();
  for (const mode of ['taxi', 'getaway', 'timetrial', 'pursuit']) {
    send(host, { type: 'create', mode });
    assert.match(last(host, 'error').message, /Mode unavailable/);
    send(host, { type: 'create', eventId: `${mode}:riviera` });
    assert.match(last(host, 'error').message, /Unknown race route/);
    assert.equal(core.lobbies.size, 0);
  }
  send(host, { type: 'create', eventId: 'quick' });
  const code = last(host, 'lobby').lobby.code;
  for (const mode of ['taxi', 'getaway', 'timetrial', 'pursuit']) {
    send(host, { type: 'options', mode });
    assert.match(last(host, 'error').message, /Mode unavailable/);
    assert.equal(core.lobbies.get(code).eventId, 'quick');
  }
  const saved = core.exportState(); saved.lobbies[0].eventId = 'taxi:riviera';
  const restored = createGameCore({ maps, cars: new Set(['mini']), leaderboard: { submit: async () => {} } });
  restored.restore(saved); assert.equal(restored.lobbies.size, 0);
});
test('two clients join Free Roam by code; it remains untimed without finish records', t => {
  const { core, socket, send, advance, submissions } = harness(t), host = socket(), guest = socket();
  send(host, { type: 'create', eventId: 'free:riviera' });
  const lobby = last(host, 'lobby').lobby;
  send(guest, { type: 'join', code: lobby.code.toLowerCase() });
  assert.equal(last(guest, 'lobby').lobby.players.length, 2);
  for (const ws of [host, guest]) send(ws, { type: 'ready', ready: true, version: maps.get('riviera').track.version });
  send(host, { type: 'start' }); advance(100);
  assert.equal(core.lobbies.get(lobby.code).status, 'race');
  advance(1000000);
  assert.equal(core.lobbies.get(lobby.code).status, 'race', 'Free Roam has no ten-minute race timeout');
  assert.equal(core.lobbies.get(lobby.code).players.values().next().value.finish, null);
  assert.equal(submissions.length, 0);
});

test('Quick Race keeps rivals 0–11, traffic, police, direction, time and weather on every road type', () => {
  for (const closed of [false, true]) {
    const fields = setupFields(QUICK_RACE, { closed });
    for (const key of ['rivals', 'traffic', 'police', 'reverse', 'time', 'weather']) assert.ok(fields.some(f => f.key === key), key);
    for (const rivals of [0, 11]) {
      const run = applySetup(QUICK_RACE, { rivals, traffic: 2, police: true, reverse: true, time: 'night', weather: 'rain' }, { closed });
      assert.equal(run.rivalCount, rivals); assert.equal(run.traffic, 2); assert.equal(run.rules.police, true);
      assert.deepEqual(run.conditions, { time: 'night', weather: 'rain' });
      assert.equal(run.setup.reverse, true);
    }
  }
});
