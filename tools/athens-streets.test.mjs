// The free roam picker's Athens streets (assets/athens/streets.json, tools/build-athens-streets.mjs). Lead 2026-10-20, owner
// on the Athens world: "I can't click on the map anywhere": the picker must know every drivable street of the world that
// staging serves, so the file has to come from that exact manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeSpawnRoads, snapToRoad, athensDistricts, atticaFromLonLat, athensCell, nearestDistrict, atticaFromAthens, athensFromAttica } from '../src/spawn-spots.js';
import { stagingManifestKey, packStreets, chainStreets, UNIT } from './build-athens-streets.mjs';

const json = JSON.parse(readFileSync(new URL('../assets/athens/streets.json', import.meta.url), 'utf8'));
const roads = decodeSpawnRoads(json), cells = new Set(json.cells), METRES = 87.65875176038091;

test('the street file is built from the manifest staging serves', () => {
  const key = stagingManifestKey();
  assert.ok(key, 'wrangler.jsonc names a staging world manifest');
  assert.equal(json.manifest, key, 'wrangler.jsonc env.staging ATHENS_WORLD_MANIFEST moved on: run node tools/build-athens-streets.mjs so the free roam picker knows the new streets');
  assert.equal(json.unit, UNIT);
  assert.ok(json.cells.length > 1000 && roads.athens.roads.length > 20000, 'the whole published world, not a sample');
});

test('every district the arrows offer has a street the picker can start on, and the centre snaps to named streets', () => {
  const districts = athensDistricts(cells);
  assert.ok(districts.length >= 15, `hosted districts: ${districts.map(d => d.name)}`);
  for (const d of districts) {
    const snap = snapToRoad(roads, ...d.at, 2);
    assert.ok(snap, `${d.name} has a street within 175 m`);
    assert.ok(cells.has(athensCell(...snap.local)), `${d.name}: its street is in a hosted cell`);
  }
  for (const [lat, lon, street] of [[37.9755, 23.7348, null], [37.9800, 23.7330, 'Πανεπιστημίου'], [38.0000, 23.7389, null], [37.9421, 23.6465, null]]) {
    const snap = snapToRoad(roads, ...atticaFromLonLat(lon, lat), 1);
    assert.ok(snap && snap.street, `a named street near ${lat},${lon}`);
    assert.ok(snap.distance * METRES < 60, `within 60 m (${(snap.distance * METRES).toFixed(0)} m)`);
    if (street) assert.equal(snap.street, street);
    assert.equal(nearestDistrict(districts, snap.at).mapId, 'athens');
  }
  // Open sea off Piraeus is genuinely far from any street.
  assert.equal(snapToRoad(roads, ...atticaFromLonLat(23.60, 37.90), 3), null);
});

test('one line per street: reverse twins of two-way roads go, edges of one street that meet are chained', () => {
  const edge = (id, name, pts, major = false) => ({ id, name, major, pts });
  const cells = new Map([['0,0', [
    edge('osm:way:1:0-0:f:0:0', 'Α', [0, 0, 10, 0]), edge('osm:way:1:0-0:r:0:0', 'Α', [10, 0, 0, 0]),
    edge('osm:way:2:0-0:f:0:0', 'Α', [10, 0, 20, 10]), edge('osm:way:3:0-0:f:0:0', 'Β', [20, 10, 20, 30]),
  ]]]);
  const out = packStreets(cells, { manifest: 'manifests/x.json', revision: 'r', world: 'w' }), d = decodeSpawnRoads(out).athens;
  assert.equal(d.roads.length, 2, 'Α (two edges, one twin dropped) is one line; Β is another');
  const a = d.roads.find(r => r.name === 'Α'); assert.equal(a.pts.length, 6, 'three points (the bend kept), end to end');
  const [x0, y0] = atticaFromAthens(0, 0), [x1, y1] = atticaFromAthens(20, 10);
  assert.ok(Math.abs(a.pts[0] - x0) < 1 / UNIT && Math.abs(a.pts[4] - x1) < 1 / UNIT && Math.abs(a.pts[5] - y1) < 1 / UNIT);
  assert.equal(chainStreets([edge('a', 'Γ', [0, 0, 5, 0]), edge('b', 'Γ', [5, 0, 9, 0], true)]).length, 2, 'a change of class starts a new line');
  const [bx, bz] = athensFromAttica(...atticaFromAthens(1234, -567)); assert.ok(Math.abs(bx - 1234) < 1e-6 && Math.abs(bz + 567) < 1e-6, 'the projections round-trip');
});
