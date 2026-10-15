// Multiplayer police: the host's lobby config is the only switch; every client runs the same seeded
// map patrols and pursues its own driver. Also: no per-browser police preference survives.
//   node --test tools/police-online.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { world, step } from './police-fixture.mjs';
import { events } from '../src/events.js';

const lobby = (police, over = {}) => ({ raceId: 'race-7', generation: 3, eventId: 'quick', config: { police, time: 'afternoon', weather: 'clear' }, event: { police }, ...over });
// a client with Riviera-style landmarks, so the map patrol plan applies
function client(t, at = 2000) {
  const W = world(); W.traffic.data = { marks: [{ id: 'astir', s: 545 }, { id: 'lake', s: 864 }, { id: 'varkiza', s: 4622 }] };
  t.after(() => { W.police.reset(false); W.police.offs.forEach(off => off()); });
  W.player(at, 1.9, 13); return W;
}
const units = W => W.traffic.cars.filter(c => c.active && c.cop).map(c => ({ s: Math.round(c.s), station: c.cop.station, mode: c.mode })).sort((a, b) => a.s - b.s);

test('an MP race with police=true spawns police on every client, identically', t => {
  const A = client(t), B = client(t);
  for (const W of [A, B]) { assert.equal(W.police.configureOnline(lobby(true)), true); step(W, 1); }
  assert.ok(units(A).length >= 1, 'patrol units spawned on the client');
  assert.deepEqual(units(A), units(B), 'both clients spawn the same units');
  assert.deepEqual([0, 1, 2].map(() => A.police.rng.next()), [0, 1, 2].map(() => B.police.rng.next()), 'same race seed');
  // approaching Varkiza streams its junction unit in on each client, well before it is in view
  for (const W of [A, B]) { W.player(3900, 1.9, 13); step(W, .5); } // 720 m out: out of view
  assert.ok(units(A).some(u => u.station === 'varkiza-junction')); assert.deepEqual(units(A), units(B));
});

test('an MP race with police=false (or no config) has no police at all', t => {
  for (const l of [lobby(false), { raceId: 'r', generation: 1, config: {} }, null]) {
    const W = client(t); assert.equal(W.police.configureOnline(l), false);
    step(W, 2); assert.equal(units(W).length, 0); assert.equal(W.police.hm.state, 'idle');
  }
});

test('each client pursues its own driver: witnessed speeding warns, then stars, on that client only', t => {
  const A = client(t, 1000), B = client(t, 1000);
  for (const W of [A, B]) W.police.configureOnline(lobby(true));
  A.police.spawnCop(1060, 1); B.police.spawnCop(1060, 1);
  A.player(1000, 1.9, 110 / 3.6); // driver A floors it past the unit, driver B is legal
  step(A, 6); step(B, 6);
  assert.equal(A.police.hm.state, 'pursuit'); assert.ok(A.police.hm.level >= 1);
  assert.equal(B.police.hm.state, 'idle'); assert.equal(B.police.hm.heat, 0);
  assert.ok(A.traffic.cars.some(c => c.active && c.cop?.chase));
});

test('police come only from the race / lobby setup: no settings key, URL or saved override', async () => {
  const src = readFileSync(new URL('../src/police.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /settings|location|localStorage/, 'police.js reads no preference');
  const storage = { values: new Map([['paraliaki.settings', JSON.stringify({ police: true })]]), getItem(k) { return this.values.get(k) ?? null; }, setItem(k, v) { this.values.set(k, v); } };
  globalThis.localStorage = storage;
  const { settings, DEFAULTS } = await import('../src/settings.js?police-online');
  assert.equal('police' in DEFAULTS, false); assert.equal(settings.police, undefined, 'a stale saved toggle is dropped');
  // solo: a quick race / free roam without police in its setup has none, whatever was saved
  const W = world(); W.player(1000, 1.9, 30);
  events.emit('start', { eventId: 'quick', type: 'sprint', def: { type: 'sprint', quick: true, rules: {} } });
  assert.equal(W.police.enabled, false);
  events.emit('start', { eventId: 'quick', type: 'sprint', def: { type: 'sprint', quick: true, rules: { police: true } } });
  assert.equal(W.police.enabled, true);
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('universal-world policy keeps the host config but hides per-driver police online', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.slice(main.indexOf('  start(lobby, id, resumeState = null) {'), main.indexOf('  remote(peers, dt) {'));
  assert.ok(start.indexOf('startOnlinePolice(lobby)') > start.indexOf('onlineWait()'), 'configured after onlineWait (which resets police)');
  assert.match(main, /function startOnlinePolice\(lobby\) \{ police\?\.configureOnline\(lobby\); police\?\.reset\(false\); \}/);
  assert.match(main, /if \(police && !multiplayer\.active\) for \(const e of police\.update\(/, 'private police AI never runs online');
  assert.match(main, /multiplayer\.lobby\.traffic \|\| police\?\.enabled\)/, 'police contacts collide online');
});
