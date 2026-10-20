// The 2026-10-20 owner decision "the open world must feel like Athens": landmarks, the far mountain ring, and the budgets they keep.
// Locked look: unlit colour only; World detail Off removes every addition. See docs/world-beauty.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { LANDMARKS, ModelBuilder } from '../src/athens-landmark-models.js';
import { LANDMARK_SITES } from '../src/athens-landmark-data.js';
import { LANDMARK_HIDDEN, osmBuildingId } from '../src/athens-landmark-hide.js';
import { landmarkHaze, landmarkPlacement, FAR_FRACTION, HAZE, forecourtPlazas } from '../src/athens-landmarks.js';
import { parseHorizon, horizonHeight, bandSlopes, HORIZON_BANDS, HORIZON_AZIMUTHS, AthensHorizon } from '../src/athens-horizon.js';
import { deriveBuildingMeshes } from '../src/world-tile-buildings.js';
import { fixture } from './world-tile-format.test.mjs';
import { tileTables } from '../src/world-tile-format.js';
import { parsePlazas, pointInPlaza, AthensPlazas, PLAZA_MAX_TRIANGLES } from '../src/athens-plazas.js';
import * as THREE from 'three';

const bin = readFileSync(new URL('../assets/athens/horizon.bin', import.meta.url));
const grid = parseHorizon(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const LAT0 = 37.98, LON0 = 23.73, MLAT = 111320, MLON = 87745.27512677578;
const world = (lat, lon) => [(lon - LON0) * MLON, -(lat - LAT0) * MLAT];

test('every landmark is a small low-poly model: bounded triangles, finite, standing on its site, one draw call each', () => {
  assert.equal(LANDMARKS.length, 7);
  let total = 0;
  for (const spec of LANDMARKS) {
    const b = spec.build(), g = b.geometry(), p = g.attributes.position.array, c = g.attributes.color.array;
    assert.ok(b.triangles > 20 && b.triangles <= 2000, `${spec.id}: ${b.triangles} triangles`);
    assert.ok(p.every(Number.isFinite) && c.every(v => Number.isFinite(v) && v >= 0), `${spec.id} has finite positions and colours`);
    assert.equal(p.length, c.length); assert.ok(!g.index, 'flat shaded and non-indexed');
    assert.ok(g.boundingBox.min.y < 2 && g.boundingBox.max.y < 60, `${spec.id} spans ${g.boundingBox.min.y}..${g.boundingBox.max.y}`);
    total += b.triangles;
  }
  assert.ok(total <= 4800, `${total} triangles for all seven landmarks`);
});

test('the landmark sites are the OSM footprints: Parthenon on the Acropolis, Olympieion, Lycabettus summit', () => {
  const near = (site, lat, lon, m) => { const [x, z] = world(lat, lon); assert.ok(Math.hypot(site.x - x, site.z - z) < m, `${Math.round(site.x)},${Math.round(site.z)} vs ${Math.round(x)},${Math.round(z)}`); };
  near(LANDMARK_SITES.parthenon, 37.97155, 23.72669, 60); near(LANDMARK_SITES.olympieion, 37.96935, 23.73319, 60); near(LANDMARK_SITES.lycabettus, 37.98187, 23.74324, 20);
  assert.ok(LANDMARK_SITES.parthenon.y > 140 && LANDMARK_SITES.parthenon.y < 170, 'the Acropolis rock');
  assert.ok(LANDMARK_SITES.lycabettus.y > 240 && LANDMARK_SITES.lycabettus.y < 290, 'Lycabettus');
  assert.ok(LANDMARK_SITES.parthenon.length > 60 && LANDMARK_SITES.parthenon.length < 80, 'the Parthenon is about 70 m long');
});

test('a distant landmark keeps its direction and its apparent size, and is never farther than the far plane', () => {
  const far = 850;
  for (const [dx, dy, dz] of [[2000, 40, 100], [-3000, 90, -500], [820, 0, 0], [100, 5, 5]]) {
    const p = landmarkPlacement(dx, dy, dz, far), d = Math.hypot(dx, dy, dz);
    assert.ok(Math.hypot(p.dx, p.dy, p.dz) <= far * FAR_FRACTION + 1e-9);
    // same direction
    assert.ok(Math.abs(p.dx / Math.hypot(p.dx, p.dy, p.dz) - dx / d) < 1e-9 && Math.abs(p.dy / Math.hypot(p.dx, p.dy, p.dz) - dy / d) < 1e-9);
    // same angular size: size * scale / distance-after == size / distance-before
    assert.ok(Math.abs(p.scale / Math.hypot(p.dx, p.dy, p.dz) - 1 / d) < 1e-12);
    assert.equal(p.far, d > far * FAR_FRACTION);
  }
  assert.equal(landmarkPlacement(100, 0, 0, far).scale, 1, 'a near landmark is at its true place and size');
});

test('landmark haze grows with distance, is continuous where a landmark leaves the far plane, and stays clearer than the world fog', () => {
  const far = 850, edge = far * FAR_FRACTION; let last = -1;
  for (let d = 0; d <= 12000; d += 150) { const h = landmarkHaze(d, far); assert.ok(h >= last - 1e-12 && h >= 0 && h <= HAZE.farAmount + 1e-9); last = h; }
  assert.ok(Math.abs(landmarkHaze(edge - 1e-6, far) - landmarkHaze(edge + 1e-6, far)) < 1e-4);
  assert.ok(landmarkHaze(edge, far) < 1, 'the world fog is complete at the far plane; a landmark is still visible there');
});

test('the mountain ring reads real terrain: Hymettus east, Parnitha north, Penteli north-east, Aigaleo west, open sea south', () => {
  assert.equal(grid.step, 250); assert.ok(bin.length < 100 * 1024 && gzipSync(bin).length < 45 * 1024, `${bin.length} B`);
  const peak = (lat0, lat1, lon0, lon1) => { let best = 0; for (let la = lat0; la <= lat1; la += .005) for (let lo = lon0; lo <= lon1; lo += .005) { const [x, z] = world(la, lo); best = Math.max(best, horizonHeight(grid, x, z)); } return best; };
  assert.ok(peak(37.93, 37.99, 23.79, 23.84) > 800, 'Hymettus (1,026 m)'); assert.ok(peak(38.12, 38.19, 23.70, 23.78) > 1100, 'Parnitha (1,413 m)'); assert.ok(peak(38.05, 38.12, 23.84, 23.90) > 800, 'Penteli (1,109 m)');
  assert.ok(peak(37.95, 38.05, 23.58, 23.72) > 400, 'Aigaleo (468 m)');
  assert.equal(horizonHeight(grid, 0, 30000), 0, 'the Saronic gulf');
  assert.equal(horizonHeight(grid, 1e6, 1e6), 0, 'off the grid is sea level');
  const y = 100, east = bandSlopes(grid, 421, y, 501, Math.PI / 2), north = Array.from({ length: 24 }, (_, i) => bandSlopes(grid, 421, y, 501, -.3 + i * .05)).flat(), south = bandSlopes(grid, 421, y, 501, Math.PI);
  assert.ok(Math.max(...east) > .04, 'Hymettus rises above the camera in the east: ' + east.map(v => v.toFixed(3)));
  assert.ok(Math.max(...north) > .05, 'Parnitha and Penteli in the north'); assert.ok(Math.max(...south) < .02, 'the open gulf to the south');
});

test('the ring rebuilds into finite strips that fade to the fog colour at the foot and never leave the cylinder', () => {
  const fog = new THREE.Fog('#9caeae', 500, 800), ring = new AthensHorizon(new THREE.Group(), fog); ring.setGrid(grid);
  const camera = new THREE.PerspectiveCamera(); ring.update(camera, 421, 100, 501); ring.rebuild(430, 100, 501); // the first call is JIT warm-up
  assert.equal(ring.stats.rebuilds, 2); assert.ok(ring.stats.ms < 120, `${ring.stats.ms} ms to rebuild`);
  const P = ring.position.array, C = ring.colour.array, A = HORIZON_AZIMUTHS, per = (A + 1) * 4;
  assert.equal(P.length, HORIZON_BANDS.length * per * 3); assert.ok(P.every(Number.isFinite) && C.every(Number.isFinite));
  for (let b = 0; b < HORIZON_BANDS.length; b++) for (let i = 0; i <= A; i += 40) {
    const foot = (b * per + i * 4) * 3, crest = foot + 9;
    assert.ok(P[crest + 1] >= P[foot + 1] - 1e-6, 'the crest is above the foot'); assert.ok(P[foot + 4] <= 0 && P[foot + 1] < -300, 'the strip stands on the horizon and goes deep below it, so no edge shows'); assert.deepEqual([C[foot], C[foot + 1], C[foot + 2]].map(v => +v.toFixed(4)), [fog.color.r, fog.color.g, fog.color.b].map(v => +v.toFixed(4)));
  }
  ring.update(camera, 430, 100, 510); assert.equal(ring.stats.rebuilds, 2, 'a few metres do not rebuild'); ring.update(camera, 1000, 100, 510); assert.equal(ring.stats.rebuilds, 3);
  ring.setEnabled(false); assert.equal(ring.mesh.visible, false, 'World detail Off hides the ring'); assert.equal(ring.mesh.material.depthWrite, false);
  assert.match(ring.mesh.material.vertexShader, /\.xyww/, 'drawn at the far plane like the sky: the world always covers it');
});

test('a building a landmark replaces is kept as a separate hidden-while-detail-is-on mesh; other rows are untouched', () => {
  assert.ok(LANDMARK_HIDDEN.has('w910010406') && LANDMARK_HIDDEN.has('r19023846'), 'the Parthenon block and the stadium block');
  assert.equal(osmBuildingId('building:w910010406:0/-1:1'), 'w910010406');
  const p = fixture(); p.metadata.extensions = { derivedBuildings: { version: 1 } };
  const set = (k, a) => { p.arrays[p.metadata.tables[k]] = a; };
  const ids = ['building:w1:0/0:0', 'building:w910010406:0/0:0'].map(id => p.metadata.ids.push(id) - 1);
  set('buildings', Uint32Array.of(ids[0], 0, 4, 0, ids[1], 4, 4, 0));
  set('buildingCorners', Float32Array.of(10, 10, 10, 30, 40, 30, 40, 10, 100, 100, 100, 140, 160, 140, 160, 100));
  set('buildingHeights', Float32Array.of(3, 9, 3, 9.6));
  const { meshes } = deriveBuildingMeshes(tileTables(p), p.metadata);
  assert.deepEqual(meshes.map(m => !!m.userData.landmarkBox), [false, true]);
  assert.ok(meshes.every(m => m.userData.tileSurface === 'building'), 'the same render variant, so no new shader program');
});

test('World detail gates every addition and the layer is wired once in the Athens entry', () => {
  const world = src('src/athens-world.js');
  assert.match(world, /new AthensHorizon\(scene,scene\.fog,\{enabled:settings\.worldDetail!==false\}\)/);
  assert.match(world, /new AthensLandmarks\(detailRoot,scene\.fog,\{enabled:settings\.worldDetail!==false,groundAt:/);
  assert.match(world, /horizon\.setEnabled\(s\.worldDetail!==false\);landmarks\.setEnabled\(s\.worldDetail!==false\);plazas\.setEnabled\(s\.worldDetail!==false\);syncBoxes\(\)/);
  assert.match(world, /new AthensPlazas\(detailRoot,\{enabled:settings\.worldDetail!==false,/);
  assert.match(world, /c\.userData\.landmarkBox\)c\.visible=!hidden/);
  for (const f of ['src/athens-horizon.js', 'src/athens-landmarks.js', 'src/athens-landmark-models.js', 'src/athens-plazas.js']) assert.doesNotMatch(src(f), /castShadow|DirectionalLight|PointLight|SpotLight|MeshStandardMaterial|MeshPhysicalMaterial|MeshLambertMaterial/, 'unlit colour only');
  assert.ok(statSync(new URL('../assets/athens/horizon.bin', import.meta.url)).size < 100 * 1024);
});

test('the plaza outlines cover Syntagma Square and are small', () => {
  const file = new URL('../assets/athens/plazas.json', import.meta.url), json = JSON.parse(readFileSync(file, 'utf8')), plazas = parsePlazas(json);
  assert.ok(plazas.length > 400 && statSync(file).size < 100 * 1024 && gzipSync(readFileSync(file)).length < 50 * 1024);
  assert.ok(plazas.some(p => pointInPlaza(p.p, 470, 520)), 'the square in front of the Parliament is a plaza');
  assert.ok(!plazas.some(p => pointInPlaza(p.p, 613, 527)), 'the Parliament itself is not');
});
test('plaza paving follows the streamed ground, only where a cell is loaded, and is gone with World detail Off', () => {
  const square = { p: new Float32Array([0, 0, 40, 0, 40, 40, 0, 40]), x0: 0, z0: 0, x1: 40, z1: 40, area: 1600 };
  const group = new THREE.Group(), plazas = new AthensPlazas(group, { groundAt: (x, z) => 10 + x * .1, material: new THREE.MeshBasicMaterial() });
  plazas.setPlazas([square]); plazas.update(20, 12, 20); assert.equal(plazas.stats.triangles, 0, 'no cell is streamed in yet');
  plazas.addTile('0,0'); plazas.update(20, 12, 20); assert.equal(plazas.stats.triangles, 20 * 20 * 2, "2 m cells within 130 m");
  const P = plazas.position.array; for (let i = 0; i < 60; i++) assert.ok(Math.abs(P[i * 3 + 1] - (10 + P[i * 3] * .1) - .05) < 1e-4, 'a vertex lies 5 cm over the ground');
  assert.equal(plazas.mesh.visible, true); plazas.setEnabled(false); assert.equal(plazas.mesh.visible, false);
  plazas.update(20, 12, 20); plazas.setEnabled(true); plazas.update(20, 12, 20); assert.equal(plazas.mesh.visible, true);
  assert.ok(PLAZA_MAX_TRIANGLES <= 30000);
});
test('houses with pitched roofs derive without overflowing their index, and the extra bytes and rooftop rows are counted', () => {
  const N = 300, corners = [], buildings = [], heights = [], ids = [];
  for (let i = 0; i < N; i++) {
    const x = (i % 20) * 20, z = Math.floor(i / 20) * 20, h = i % 3 === 0 ? 6 : 9 + (i % 4) * 3;
    buildings.push(i, i * 4, 4, i % 2); heights.push(10, h); ids.push(`w${900000 + i}`);
    corners.push(x, z, x + 12, z, x + 12, z + 9, x, z + 9);
  }
  const t = { buildings: Uint32Array.from(buildings), buildingCorners: Float32Array.from(corners), buildingHeights: Float32Array.from(heights) };
  const out = deriveBuildingMeshes(t, { origin: [-300, 0, 950], ids }, null, null);   // inside Plaka: old houses with hipped roofs
  const vertices = out.meshes.reduce((n, m) => n + out.arrays[m.attributes.position.array].length / 3, 0);
  assert.ok(out.extra.vertices > 0, 'some houses got a pitched roof');
  assert.equal(vertices, N * 20 + out.extra.vertices, 'the counted extra vertices are the ones added');
  const indices = out.meshes.reduce((n, m) => n + out.arrays[m.index].length, 0);
  assert.equal(indices, N * 30 + out.extra.indices, 'the counted extra indices are the ones added');
  const flat = deriveBuildingMeshes(t, { origin: [30000, 0, 30000], ids }, null, null);  // far outside any old quarter: mostly flat roofs, rooftop kits
  assert.ok(flat.extra.rooftops.length > 0 && flat.extra.rooftops.length % 5 === 0 && flat.extra.rooftops.length <= 600 * 5);
});
test('the Parliament and the Zappeion get a paved forecourt in front of their entrance, as a plaza outline', () => {
  const f = forecourtPlazas(); assert.equal(f.length, 2);
  const par = LANDMARK_SITES.parliament, inFront = f.find(p => pointInPlaza(p.p, par.x + (421 - par.x) * .25, par.z + (501 - par.z) * .25 + 0));
  const toward = [421 - par.x, 501 - par.z], c = [(f[0].x0 + f[0].x1) / 2 - par.x, (f[0].z0 + f[0].z1) / 2 - par.z];
  assert.ok(toward[0] * c[0] + toward[1] * c[1] > 0, 'the forecourt lies on the Syntagma side of the Parliament');
  for (const p of f) assert.ok(p.area > 1000 && !pointInPlaza(p.p, par.x, par.z), 'it does not cover the building');
  void inFront;
});
