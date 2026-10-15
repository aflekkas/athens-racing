import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { townBinStations } from '../src/street-life-data.js';
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
