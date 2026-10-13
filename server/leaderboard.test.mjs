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
