import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeaderboard } from './leaderboard.mjs';

test('concurrent records persist atomically, retain each best car/event/traffic time and survive reopening', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leaderboard-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'private', 'leaderboard.json');
  const defs = new Map([['full', { len: 10000, routeKey: '0>10000', traffic: false }], ['reverse', { len: 10000, routeKey: '10000>0', traffic: true }]]);
  const cars = new Set(['mini', 'z4']); const board = await createLeaderboard(file, defs, cars, 'track1');
  const base = { driverId: 'persistent-driver', name: '<Driver>', car: 'mini', eventId: 'full', time: 300 };
  await Promise.all([board.submit(base), board.submit({ ...base, time: 280 }), board.submit({ ...base, time: 310 }), board.submit({ ...base, car: 'z4', time: 260 }), board.submit({ ...base, eventId: 'reverse', time: 340 }), board.submit({ ...base, traffic: true, time: 290 })]);
  const fresh = await createLeaderboard(file, defs, cars, 'track1');
  assert.equal(fresh.list().length, 4); assert.equal(fresh.list({ eventId: 'full', car: 'mini', traffic: false })[0].time, 280);
  assert.equal(fresh.list({ eventId: 'reverse' })[0].routeKey, '10000>0'); assert.equal(fresh.list()[0].name, 'Driver');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).entries.length, 4); assert.deepEqual(await readdir(join(dir, 'private')), ['leaderboard.json']);
  assert.deepEqual((await createLeaderboard(file, defs, cars, 'track2')).list(), []);
  await assert.rejects(board.submit({ ...base, time: 2 }), /implausible/);
});

test('a full short-route board reports unretained records honestly and leaves long-route boards available', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leaderboard-limit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { writeFile } = await import('node:fs/promises'); const file = join(dir, 'leaderboard.json');
  await writeFile(file, JSON.stringify({ entries: Array.from({ length: 200 }, (_, i) => ({ driverId: 'driver-' + String(i).padStart(4, '0'), eventId: 'short', car: 'mini', traffic: false, version: 'v1', time: 10 + i / 10, at: i })) }));
  const defs = new Map([['short', { len: 100, routeKey: '0>100', traffic: false }], ['long', { len: 10000, routeKey: '0>10000', traffic: false }]]);
  const board = await createLeaderboard(file, defs, new Set(['mini']), 'v1');
  assert.equal((await board.submit({ driverId: 'new-driver', eventId: 'short', car: 'mini', time: 50 })).saved, false);
  assert.equal((await board.submit({ driverId: 'new-driver', eventId: 'long', car: 'mini', time: 500 })).saved, true);
  assert.equal(board.list({ eventId: 'long' }).length, 1);
});
