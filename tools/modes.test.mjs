import test from 'node:test';
import assert from 'node:assert/strict';
import { freeRoam, EventRun, resolve, rivalCount, targetLabels } from '../src/events.js';
import { applySetup, loadSetup, saveSetup, setupFields } from '../src/race-setup.js';
const ctx = { route: { start: 10, finish: 990, length: 1000, from: 'A', to: 'B' }, marks: [] };
test('free roam is untimed and cannot finish at route/lap boundaries', () => {
  for (const closed of [false, true]) {
    const def = freeRoam('megara'), c = { ...ctx, route: { ...ctx.route, closed } }, r = resolve(def, c);
    assert.deepEqual(r.checkpoints, []); assert.equal(rivalCount(def), 0); assert.deepEqual(targetLabels(def, r, String), []);
    const run = new EventRun(def, c); run.start();
    for (const s of [-1000, 999, 3000]) assert.deepEqual(run.update(20, { s, t: 5000, kmh: 160 }), []);
    assert.equal(run.t, 0); assert.equal(run.done, false); run.abort();
    assert.equal(setupFields(def, { closed }).some(f => ['rivals', 'laps', 'reverse'].includes(f.key)), false);
    assert.ok(setupFields(def, { closed }).some(f => f.key === 'traffic'));
  }
});
test('police choice persists, overrides event defaults and isolates competitive records', () => {
  const st = { data: new Map(), getItem(k) { return this.data.get(k); }, setItem(k, v) { this.data.set(k, v); } };
  for (const type of ['sprint', 'timetrial', 'free']) {
    const def = { ...freeRoam(), id: type, type };
    saveSetup(def.id, { police: true, weather: 'rain' }, st);
    const on = applySetup(def, loadSetup(def.id, st)); assert.equal(on.rules.police, true); assert.equal(on.setup.police, true);
    assert.ok(on.custom); assert.match(on.id, /police1/);
    assert.equal(applySetup(def, { police: false }).rules.police, false);
  }
});
