import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildingGraffiti, townBinStations, paintProgress, selectGraffitiBuildings } from '../src/street-life-data.js';
import { TOE_STYLES, TOE_COLORS, drawTOE } from '../src/graffiti-art.js';

test('28% building selection is deterministic and bounded at one to three styles', () => {
  const selected = Array.from({ length: 10000 }, (_, id) => buildingGraffiti(id)).filter(p => p.selected);
  assert.ok(selected.length >= 2700 && selected.length <= 2900);
  for (const p of selected) { assert.ok(p.count >= 1 && p.count <= 3); assert.ok(p.style < TOE_STYLES.length); assert.ok(p.color < TOE_COLORS.length); }
  assert.deepEqual(buildingGraffiti(9215), buildingGraffiti(9215));
  const village = Array.from({ length: 6 }, (_, id) => ({ id }));
  assert.equal(selectGraffitiBuildings(village).length, 2);
  assert.deepEqual(selectGraffitiBuildings(village), selectGraffitiBuildings(village.reverse()), 'independent of footprint iteration order');
});
test('mapped Riviera and Penteli settlements get bins; closed-circuit Megara gets none', () => {
  for (const [id, path] of [['riviera', '../data/map.json'], ['penteli', '../data/maps/penteli/map.json']]) {
    const data = JSON.parse(fs.readFileSync(new URL(path, import.meta.url))), zones = data.zones;
    const urban = s => { const zone = zones.findLast(z => z.s <= s); return zone?.urban ?? 0; };
    const stations = townBinStations({ id, data, route: { length: data.route.x.length * data.route.step, urban } });
    assert.ok(stations.length > 3, id); assert.ok(stations.every(s => Number.isFinite(s) && s > 0));
    assert.deepEqual(stations, [...stations].sort((a, b) => a - b));
  }
  assert.deepEqual(townBinStations({ id: 'megara' }), []);
});
test('sprayed paint grows monotonically, clamps at completion, and pauses by elapsed time', () => {
  assert.equal(paintProgress(-1), 0); assert.equal(paintProgress(4.5), .5); assert.equal(paintProgress(9), 1); assert.equal(paintProgress(90), 1);
});
test('all original TOE styles draw deterministically without fonts or images', () => {
  const recording = () => { const calls = []; const ctx = new Proxy({}, { get: (o, name) => (...args) => calls.push([name, ...args]), set: (o, name, value) => { calls.push([name, value]); return true; } }); return { ctx, calls }; };
  for (const style of TOE_STYLES) {
    const a = recording(), b = recording(); drawTOE(a.ctx, { style, seed: 123 }); drawTOE(b.ctx, { style, seed: 123 });
    assert.deepEqual(a.calls, b.calls); assert.ok(a.calls.some(([name]) => name === 'stroke'));
    assert.ok(!a.calls.some(([name]) => name === 'drawImage' || name === 'fillText'));
  }
});
