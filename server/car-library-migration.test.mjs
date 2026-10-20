// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md, "One car per model (top trim only)"): trims are gone. Everything that pointed at a
// removed trim (leaderboard rows on the Node server and in the Worker's SQLite, multiplayer car ids, saved garage choices) moves to
// the kept top trim of its model, once, without losing the fastest time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeaderboard } from './leaderboard.mjs';
import { createSqlLeaderboard } from '../worker/leaderboard.mjs';
import { canonicalResult, canonicalEntries, boardKey } from './leaderboard-policy.mjs';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { migrateStoredCarSelection } from '../src/car-catalog.js';
import { LEGACY_CAR_IDS } from '../src/car-ids.js';

const event = { id: 'quick', type: 'sprint', s0: 10, s1: 4010, dir: 1, len: 4000, laps: 1, traffic: true, routeKey: '10>4010' };
const maps = new Map([['riviera', { track: { version: 'v1' }, definitions: new Map([['quick', event]]) }]]);
const kept = new Set(['golf_r', 'mini_jcw', 'z4']); // what the server serves: the kept cars only
const row = (driverId, car, time, extra = {}) => ({ driverId, name: driverId.toUpperCase(), eventId: 'quick', mapId: 'riviera', car, traffic: true, time, at: time, version: 'v1', routeKey: '10>4010', distance: 4000, source: 'solo', ...extra });
const legacyRows = () => [
  row('driver-one-1', 'golf', 100, { carName: 'VOLKSWAGEN GOLF', carGeneration: 'VII', carTrim: '1.0 TSI' }),
  row('driver-one-1', 'golf_r', 110),
  row('driver-two-2', 'golf_gti', 95, { carTrim: 'GTI' }),
  row('driver-two-2', 'mini_cabrio_cooper', 130, { carTrim: 'Cooper' }),
  row('driver-three', 'mini_jcw', 120),
  row('driver-four-4', 'z4', 90),
];
const sorted = list => list.map(e => [e.name, e.car, e.time]);

test('canonicalResult and canonicalEntries move removed trims to the top trim, drop trim fields and are idempotent', () => {
  for (const [old, top] of Object.entries(LEGACY_CAR_IDS)) assert.equal(canonicalResult({ car: old, carTrim: 'x', carGeneration: 'y' }).car, top, old);
  const r = canonicalResult({ car: 'golf', carName: 'GOLF 1.0', carTrim: 'T', carGeneration: 'G', setup: { car: 'golf', carName: 'GOLF 1.0', carTrim: 'T', carGeneration: 'G', tc: true } });
  assert.deepEqual(r, { car: 'golf_r', setup: { car: 'golf_r', tc: true } }, 'the old trim display name goes with the trim');
  const same = { car: 'golf_r', carName: 'GOLF R' }; assert.equal(canonicalResult(same), same, 'a kept car comes back as the same object');
  assert.equal(canonicalResult({ car: 'golf' }, new Set(['golf'])).car, 'golf', 'a car the server serves is never rewritten');
  const once = canonicalEntries(legacyRows(), kept);
  assert.equal(once.changed, true);
  assert.deepEqual(sorted(once.entries), [['DRIVER-FOUR-4', 'z4', 90], ['DRIVER-TWO-2', 'golf_r', 95], ['DRIVER-ONE-1', 'golf_r', 100], ['DRIVER-THREE', 'mini_jcw', 120], ['DRIVER-TWO-2', 'mini_jcw', 130]].sort((a, b) => a[2] - b[2]));
  const twice = canonicalEntries(once.entries, kept); assert.equal(twice.changed, false);
  assert(!JSON.stringify(once.entries).includes('carTrim') && !JSON.stringify(once.entries).includes('carGeneration'));
  assert.equal(boardKey(once.entries[0]), boardKey({ ...once.entries[0], carTrim: 'x', carGeneration: 'y' }), 'trims are no part of a board');
});

test('Node leaderboard file: stored rows of removed trims migrate on load, keep the fastest time per driver and are rewritten once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'car-library-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'times.json'); await writeFile(file, JSON.stringify({ schema: 1, entries: legacyRows() }));
  const defs = new Map([['quick', event]]);
  const board = await createLeaderboard(file, defs, kept, 'v1');
  assert.deepEqual(sorted(board.list({ car: 'golf_r' })), [['DRIVER-TWO-2', 'golf_r', 95], ['DRIVER-ONE-1', 'golf_r', 100]]);
  assert.deepEqual(sorted(board.list({ car: 'golf' })), sorted(board.list({ car: 'golf_r' }))); // ?car=<removed trim> lists the kept car (HTTP filters resolve the same way)
  assert.equal(board.list({}).length, 5);
  const stored = JSON.parse(await readFile(file, 'utf8')).entries; assert.equal(stored.length, 5);
  assert(stored.every(e => kept.has(e.car) && !('carTrim' in e) && !('carGeneration' in e)));
  const rewritten = await readFile(file, 'utf8');
  await createLeaderboard(file, defs, kept, 'v1'); assert.equal(await readFile(file, 'utf8'), rewritten, 'a second start changes nothing');
  assert.equal((await board.submit({ driverId: 'driver-three', eventId: 'quick', car: 'mini_cabrio_jcw', name: 'DRIVER-THREE', time: 115 })).saved, true, 'a submit naming a removed trim lands on the kept car board');
  assert.equal(board.list({ car: 'mini_jcw' }).find(e => e.name === 'DRIVER-THREE').time, 115);
});

test('Worker SQLite leaderboard: rows of removed trims migrate once at start', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const sql = { exec(query, ...args) { if (query.trim().startsWith('CREATE')) { db.exec(query); return []; } const stmt = db.prepare(query); return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []); } };
  createSqlLeaderboard(sql, maps, kept); // creates the table
  for (const e of legacyRows()) { const board = boardKey(e); sql.exec('INSERT OR REPLACE INTO times VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', JSON.stringify([board, e.driverId]), board, e.mapId, e.version, e.eventId, e.car, +e.traffic, e.time, e.at, JSON.stringify(e)); }
  const board = createSqlLeaderboard(sql, maps, kept);
  assert.deepEqual(sorted(board.list({ mapId: 'riviera', car: 'golf_r' })), [['DRIVER-TWO-2', 'golf_r', 95], ['DRIVER-ONE-1', 'golf_r', 100]]);
  assert.equal(board.list({ mapId: 'riviera' }).length, 5);
  const cars = [...sql.exec('SELECT DISTINCT car FROM times ORDER BY car')].map(r => r.car); assert.deepEqual(cars, ['golf_r', 'mini_jcw', 'z4']);
  assert([...sql.exec('SELECT entry FROM times')].every(r => !r.entry.includes('carTrim') && !r.entry.includes('carGeneration')));
  const before = JSON.stringify([...sql.exec('SELECT key, time FROM times ORDER BY key')]);
  createSqlLeaderboard(sql, maps, kept); assert.equal(JSON.stringify([...sql.exec('SELECT key, time FROM times ORDER BY key')]), before, 'a second start changes nothing');
  assert.equal((await board.submit({ driverId: 'driver-four-4', eventId: 'quick', car: 'z4_20i', time: 85 })).saved, true);
  assert.equal(board.list({ mapId: 'riviera', car: 'z4' })[0].time, 85);
});

test('multiplayer core: removed trims in car picks, allow-lists, spec rules and restored sessions become the kept car', () => {
  const socket = () => ({ readyState: 1, messages: [], send(b) { this.messages.push(JSON.parse(b)); }, close() {} });
  const core = createGameCore({ maps, cars: kept, countdownMs: 0 });
  const a = socket(); core.connect(a, 'a', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, m) => core.message(ws, JSON.stringify(m)), last = ws => ws.messages.findLast(m => m.type === 'lobby')?.lobby;
  send(a, { type: 'create', car: 'golf_gtd', allowedCars: ['golf', 'mini_cabrio_cooper', 'z4_30i'] });
  const lobby = last(a);
  assert.deepEqual([...lobby.allowedCars].sort(), ['golf_r', 'mini_jcw', 'z4']);
  assert.equal(lobby.players[0].car, 'golf_r');
  send(a, { type: 'ready', ready: false, version: 'v1', car: 'mini_s' }); assert.equal(last(a).players[0].car, 'mini_jcw');
  send(a, { type: 'car', car: 'jazz_drift' }); assert.match(a.messages.at(-1).message ?? '', /Unknown car/, 'the Jazz is not in this test catalogue, so the canonical id is unknown');
  send(a, { type: 'options', carRules: { preset: 'spec', spec: 'golf_gti' } }); assert.equal(last(a).carRules.spec, 'golf_r');
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  for (const s of saved.sessions) { s.car = 'z4_20i'; s.ready = true; }
  saved.lobbies[0].carRules = { preset: 'open' }; saved.lobbies[0].advancedCars = ['golf', 'mini', 'z4_20i'];
  const restored = createGameCore({ maps, cars: kept, countdownMs: 0 }); restored.restore(saved);
  const l = [...restored.lobbies.values()][0], c = [...l.players.values()][0];
  assert.equal(c.car, 'z4'); assert.equal(c.ready, true, 'a removed trim does not unready the driver');
  assert.deepEqual([...l.advancedCars].sort(), ['golf_r', 'mini_jcw', 'z4']);
});

test('saved garage choice, paint and best time of a removed trim carry over to the kept car, once', () => {
  const data = new Map([['paraliaki.car', 'golf_gti'], ['paraliaki.car.selection', JSON.stringify({ entry: 'golf', trim: 'golf_gti' })], ['paraliaki.paint.golf_gti', '#ff0000'], ['paraliaki.paint.golf', '#00ff00'], ['paraliaki.best.golf', '95.000'], ['paraliaki.best.golf_gti', '91.500'], ['paraliaki.best.golf_r', '99.000']]);
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
  assert.equal(migrateStoredCarSelection(storage), 'golf_r');
  assert.equal(data.get('paraliaki.car'), 'golf_r'); assert.equal(data.has('paraliaki.car.selection'), false);
  assert.equal(data.get('paraliaki.paint.golf_r'), '#ff0000', 'the paint of the trim you had selected wins');
  assert.equal(data.get('paraliaki.best.golf_r'), '91.5', 'the fastest of the removed trims and the kept car');
  const after = JSON.stringify([...data]); assert.equal(migrateStoredCarSelection(storage), 'golf_r'); assert.equal(JSON.stringify([...data]), after, 'idempotent');
  const fresh = new Map(); assert.equal(migrateStoredCarSelection({ getItem: k => fresh.get(k) ?? null, setItem: (k, v) => fresh.set(k, v) }), null, 'no saved choice: nothing is created');
});
