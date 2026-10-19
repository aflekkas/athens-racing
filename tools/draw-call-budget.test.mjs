// Riviera draw calls (playtest 2026-10-18: 400-600 per frame on every tier, the friend's Intel Arc laptop lagged on the CPU side).
// What this guards: the coarser static chunks the weaker classes draw (batch.js), the merge of instanced chunks, and the empty
// instanced meshes that used to cost a draw call each for nothing. The look never changes: same meshes, same materials.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStatic, CHUNK_SCALE, mergeInstancedCells } from '../src/batch.js';
import { CellInstances } from '../src/util.js';
import { PERFORMANCE, PERF_CLASSES, resolveGraphics } from '../src/graphics.js';
import { Crowd } from '../src/human.js';

const mat = new THREE.MeshStandardMaterial({ color: '#888' });
const calls = (root) => { let n = 0; root.traverse(o => { if (o.isMesh && o.visible && !(o.isInstancedMesh && o.count === 0)) n++; }); return n; };
const box = (x, z, m = mat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); o.position.set(x, 0, z); return o; };

test('classes: weaker classes draw coarser static chunks, high keeps a modest merge, and every class resolves the one look', () => {
  assert.deepEqual(PERF_CLASSES.map(c => PERFORMANCE[c].chunk), [3, 3, 2, 1.5]);
  for (const c of PERF_CLASSES) assert.equal(resolveGraphics({ perfClass: c }, { deviceRatio: 1 }).chunkScale, PERFORMANCE[c].chunk);
  for (let i = 1; i < PERF_CLASSES.length; i++) assert.ok(PERFORMANCE[PERF_CLASSES[i]].chunk <= PERFORMANCE[PERF_CLASSES[i - 1]].chunk, 'cheaper classes never get finer chunks');
});

test('mergeInstancedCells: neighbouring chunks of one kind become one chunk; other kinds, dynamic chunks and far cells stay apart', () => {
  const geoA = new THREE.BoxGeometry(1, 1, 1), geoB = new THREE.BoxGeometry(2, 1, 1), root = new THREE.Group();
  const kinds = [{ g: geoA, far: 600 }, { g: geoB, far: 600 }, { g: geoA, far: 900 }];
  const parts = kinds.map(k => new CellInstances(k.g, mat, { cell: 100, far: k.far, colors: true }));
  const dynamic = new CellInstances(geoA, mat, { cell: 100, far: 600, dynamic: true });
  for (let i = 0; i < 12; i++) for (const p of [...parts, dynamic]) p.addTRS(i * 90 + 5, 0, 3, 0, 1, 1, 1, new THREE.Color().setHSL(i / 12, 1, .5));
  for (const p of [...parts, dynamic]) p.build(root);
  const meshesBefore = root.children.length, instancesBefore = root.children.reduce((n, m) => n + m.count, 0);
  const lod = root.children.filter(m => m.userData.staticCell), inLod = new Set(lod);
  const { before, after } = mergeInstancedCells(root, 400, { lod });
  assert.ok(lod.length < inLod.size && lod.every(m => m.parent === root), 'the scenery LOD list follows the merge: only live chunks, no removed ones');
  assert.ok(after < before, `${after} < ${before}`);
  assert.equal(root.children.reduce((n, m) => n + m.count, 0), instancesBefore, 'every instance is kept');
  const kinds2 = new Set(root.children.filter(m => !m.userData.staticCell).map(m => m.geometry.uuid));
  assert.equal(root.children.filter(m => !m.userData.staticCell).length, dynamic.meshes.length, 'dynamic chunks are never merged');
  assert.ok(kinds2.size >= 1);
  const key = m => `${m.geometry.uuid}|${m.userData.far}`;
  assert.equal(new Set(root.children.filter(m => m.userData.staticCell).map(key)).size, 3, 'geometry and fade range still tell the kinds apart');
  for (const m of root.children) {
    assert.ok(m.boundingSphere.radius > 0);
    if (m.userData.staticCell) assert.ok(m.instanceColor && m.instanceColor.array.length >= m.count * 3, 'per-instance colours survive');
    // every instance still lies inside its chunk's bounding sphere
    const p = new THREE.Vector3(), mt = new THREE.Matrix4();
    for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mt); p.setFromMatrixPosition(mt); assert.ok(p.distanceTo(m.boundingSphere.center) <= m.boundingSphere.radius + 1e-6); }
  }
  assert.ok(meshesBefore > root.children.length);
});

test('an empty instanced mesh is not drawn: the crowd hides parts with no walkers', () => {
  const scene = new THREE.Scene(), crowd = new Crowd(scene, 4);
  assert.ok(Object.values(crowd.parts).every(p => p.im.visible === false), 'a crowd nobody ever updates (the ragdoll pool) draws nothing from the start');
  crowd.end();
  const parts = Object.values(crowd.parts);
  assert.ok(parts.length >= 20);
  assert.ok(parts.every(p => p.im.visible === false), 'no pedestrian, no draw calls');
  const first = parts[0]; first.n = 1; crowd.end();
  assert.equal(first.im.visible, true); assert.ok(parts.filter(p => p.im.visible).length === 1);
});

test('other drivers\' cars drop to the road-distance model sooner on weak classes; the local player\'s car never does', async () => {
  const { CARS, CarModel } = await import('./vehicle-budget-support.mjs');
  const { scaleVehicleLod } = await import('../src/vehicle-lod.js');
  assert.deepEqual(PERF_CLASSES.map(c => PERFORMANCE[c].lod), [.45, .6, .85, 1]);
  for (const c of PERF_CLASSES) assert.equal(resolveGraphics({ perfClass: c }, { deviceRatio: 1 }).vehicleLod, PERFORMANCE[c].lod);
  const car = new CarModel(CARS.find(c => c.id === 'golf')), body = car.visualLOD, wheel = car.wheels[0].spin.children.find(o => o.isLOD);
  assert.ok(body && wheel);
  const authored = [body.levels.map(l => l.distance), wheel.levels.map(l => l.distance)];
  scaleVehicleLod(car, PERFORMANCE.potato.lod);
  for (const [lod, base] of [[body, authored[0]], [wheel, authored[1]]]) {
    const now = lod.levels.map(l => l.distance);
    assert.equal(now[0], 0); assert.ok(now[1] < base[1] && now[1] >= 5, `first step ${base[1]} -> ${now[1]}`);
    for (let i = 1; i < now.length; i++) assert.ok(now[i] > now[i - 1], 'levels stay ascending');
  }
  scaleVehicleLod(car, PERFORMANCE.low.lod); const low = body.levels[1].distance;
  scaleVehicleLod(car, 1);
  assert.deepEqual(body.levels.map(l => l.distance), authored[0], 'a class change back to high restores the authored distances');
  assert.ok(low > PERFORMANCE.potato.lod * authored[0][1] - 1e-9 && low < authored[0][1]);
  const main = (await import('node:fs')).readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(!isPlayer\) scaleVehicleLod\(model, GFX\.vehicleLod\)/, 'only rivals and online players');
  assert.match(main, /scaleVehicleLod\(c\.model, GFX\.vehicleLod\)/, 'a live class change re-applies it');
});

test('Riviera road: one mesh per material and chunk (median and skirt share the verge), and weaker classes draw coarser guardrail chunks with the same rails', async () => {
  const { worldFixture } = await import('./world-test-fixture.mjs');
  const { ROAD, buildRoad } = await import('../src/road.js');
  const { buildRivieraRails } = await import('../src/riviera-guardrail-mesh.js');
  const { map, network, terrain } = await worldFixture('riviera');
  const group = buildRoad(map, new THREE.Group(), terrain.heightC, { network, furniture: false }).group;
  const chunks = Math.ceil((map.route.length + 120) / 1000), meshes = group.children.filter(o => o.isMesh);
  assert.ok(meshes.length <= 4 * chunks, `${meshes.length} road meshes for ${chunks} chunks: road, verge, kerb, paving at most`);
  const rails = (scale) => { CHUNK_SCALE.value = scale; try { const g = new THREE.Group(); buildRivieraRails(map, g, terrain.heightC, { network }, ROAD); return g.userData.guardrails; } finally { CHUNK_SCALE.value = 1; } };
  const fine = rails(1), coarse = rails(3);
  assert.equal(coarse.triangles, fine.triangles, 'the same rail triangles');
  assert.equal(coarse.posts, fine.posts, 'the same posts');
  assert.ok(coarse.chunks < fine.chunks * .6, `${coarse.chunks} coarse guardrail chunks vs ${fine.chunks}`);
});
