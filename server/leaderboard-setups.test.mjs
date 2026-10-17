import { MAX_RIVALS } from '../src/events.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeaderboard } from './leaderboard.mjs';
import { createSqlLeaderboard } from '../worker/leaderboard.mjs';
import { leaderboardFilters, validResult } from './leaderboard-policy.mjs';
import { createGameServer } from './index.mjs';
const event = { id: 'quick', type: 'sprint', s0: 10, s1: 4010, dir: 1, len: 4000, laps: 1, traffic: true, routeKey: '10>4010' };
const maps = new Map(['riviera', 'penteli'].map(id => [id, { track: { version: 'v1' }, definitions: new Map([['quick', event]]) }]));
const cars = new Set(['mini', 'z4']);
const setup = { map: 'riviera', event: 'quick', type: 'sprint', from: 10, to: 4010, direction: 1, laps: 1, car: 'mini', time: 'night', weather: 'rain', traffic: 1.5, rivals: 2, police: true, tc: false, abs: true, steering: 'light', gearbox: 'manual' };
const base = { driverId: 'test-driver-123', name: 'LOCAL-NAME', mapId: 'riviera', eventId: 'quick', car: 'mini', carName: 'MINI Cooper S', carGeneration: 'F57', carTrim: 'Cooper S', time: 120, setup };
const sqlAdapter = db => ({ exec(query, ...args) { if (query.trim().startsWith('CREATE')) { db.exec(query); return []; } const stmt = db.prepare(query); return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []); } });
for (const transport of ['Node', 'Worker SQLite']) test(`${transport}: keeps setup boards, validates metadata, filters before limiting, and reads legacy records`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leaderboard-setup-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let board;
  if (transport === 'Node') board = await createLeaderboard(join(dir, 'times.json'), null, cars, null, maps);
  else { const db = new DatabaseSync(':memory:'); t.after(() => db.close()); board = createSqlLeaderboard(sqlAdapter(db), maps, cars); }
  await board.submit(base);
  await board.submit({ ...base, time: 140, setup: { ...setup, weather: 'clear' } });
  await board.submit({ ...base, time: 110, carTrim: 'JCW' });
  await board.submit({ ...base, mapId: 'penteli', setup: { ...setup, map: 'penteli' }, time: 105 });
  await board.submit({ ...base, car: 'z4', carName: 'BMW Z4', setup: { ...setup, car: 'z4' }, time: 100 });
  await board.submit({ ...base, driverId: 'legacy-driver-123', setup: undefined, carName: undefined, carGeneration: undefined, carTrim: undefined, time: 90 });
  assert.equal(board.list({ mapId: 'riviera' }).length, 5);
  const filtered = board.list({ mapId: 'riviera', car: 'mini', weather: 'clear', tc: 'false', abs: 'true', steering: 'light', gearbox: 'manual', limit: 1 });
  assert.equal(filtered.length, 1); assert.equal(filtered[0].time, 140); assert.equal(filtered[0].setup.traffic, 1.5); assert.equal(filtered[0].carTrim, 'Cooper S'); assert.equal(filtered[0].carGeneration, 'F57'); assert.equal(filtered[0].driverId, undefined); assert.equal(filtered[0].name, 'LOCAL-NAME');
  assert.equal(board.list({ mapId: 'penteli' }).length, 1);
  assert.equal(board.list({ mapId: 'riviera', weather: 'rain' }).length, 3);
  assert.equal(board.list({ mapId: 'riviera' })[0].setup, undefined);
  assert.equal((await board.submit({ ...base, time: 130 })).saved, false);
  for (const patch of [{ traffic: 3 }, { rivals: MAX_RIVALS + 1 }, { police: 'yes' }, { tc: 1 }, { abs: null }, { steering: 'magic' }, { gearbox: 'cvt' }, { time: 'fake' }, { weather: 'snow' }, { from: 100 }, { laps: 0 }, { map: 'penteli' }, { car: 'z4' }, { direction: 0 }, { type: {} }, { carTrim: '<script>' }]) {
    await assert.rejects(board.submit({ ...base, setup: { ...setup, ...patch } }), { status: 400 }, JSON.stringify(patch));
  }
  await assert.rejects(board.submit({ ...base, carName: '<img>' }), { status: 400 });
  await assert.rejects(board.submit({ ...base, carTrim: 'x'.repeat(81) }), { status: 400 });
});
test('route validation supports reverse and bounded circuit laps, scales plausibility with distance', () => {
  assert(validResult({ ...base, setup: { ...setup, from: 4010, to: 10, direction: -1 } }, event, cars));
  const circuit = { ...event, closed: true, s0: 0, s1: 2000, len: 2000, lapLength: 2000 };
  assert(validResult({ ...base, setup: { ...setup, from: 0, to: -6000, direction: -1, laps: 3 } }, circuit, cars));
  assert(!validResult({ ...base, time: 30, setup: { ...setup, from: 0, to: 6000, laps: 3 } }, circuit, cars));
});
test('old persisted JSON records stay readable without fabricated setup or assists', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leaderboard-old-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'old.json'); await writeFile(file, JSON.stringify({ entries: [{ version: 'v1', eventId: 'quick', car: 'mini', traffic: true, time: 120, at: 1, name: 'OLD', driverId: 'old-driver-1' }] }));
  const board = await createLeaderboard(file, new Map([['quick', event]]), cars, 'v1');
  assert.equal(board.list()[0].setup, undefined); assert.deepEqual(board.list({ tc: 'true' }), []);
});
test('HTTP endpoint passes setup/assist filters and preserves submitted metadata', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leaderboard-http-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await createGameServer({ dataDir: dir }); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(url + '/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, valid: true, time: 180, setup: undefined }) });
  assert.equal(response.status, 200);
  assert.equal((await (await fetch(url + '/api/leaderboard?mapId=riviera&car=mini')).json())[0].carTrim, 'Cooper S');
  assert.deepEqual(await (await fetch(url + '/api/leaderboard?mapId=riviera&weather=rain')).json(), []);
  assert.deepEqual(leaderboardFilters(new URLSearchParams('mapId=penteli&weather=rain&tc=false&abs=true&steering=off&gearbox=manual')), { mapId: 'penteli', weather: 'rain', tc: 'false', abs: 'true', steering: 'off', gearbox: 'manual' });
});

test('online runs use authoritative route/conditions with bounded client car/assist metadata', async () => {
 const {captureRecordMeta,onlineLeaderboardResult}=await import('./leaderboard-online.mjs');
 const raw={tc:false,abs:true,steering:'off',gearbox:'manual',carName:'BMW Z4',carGeneration:'G29',carTrim:'M40i'};
 const meta=captureRecordMeta(raw,null,'race-1');assert.equal(meta.changed,false);
 const changed=captureRecordMeta({...raw,tc:true},meta,'race-1');assert.equal(changed.changed,true);
 assert.equal(captureRecordMeta(raw,changed,'race-2').changed,false);
 assert.equal(captureRecordMeta({...raw,carName:'<img>'},null,'race-1'),null);
 const result=onlineLeaderboardResult({id:'online-driver-123',car:'z4',name:'LOCAL-DRIVER',finish:120,state:{recordMeta:meta}},{eventId:'quick',mapId:'riviera',traffic:false,config:{weather:'rain',time:'night',police:true}},event);
 assert.equal(result.setup.traffic,0);assert.equal(result.setup.rivals,0);assert.equal(result.setup.from,event.s0);assert.equal(result.carTrim,'M40i');assert(validResult(result,event,cars));
 assert.equal(onlineLeaderboardResult({state:{recordMeta:changed}},{},event).setup,undefined,'mixed assists are disclosed as unknown');
});
