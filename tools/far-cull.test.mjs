// Potato's far cull (src/far-cull.js, owner 2026-10-19 "stop drawing distant road"): the static world beyond a distance is not drawn, the fog ends it,
// and nothing else changes: every other class keeps its draw distance, the look is the one look, physics never reads `visible`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PERFORMANCE, PERF_CLASSES, RENDER, resolveGraphics } from '../src/graphics.js';
import { SCENERY_TIERS, setDrawDistance, drawDistance, horizonDistance } from '../src/scenery.js';
import { AP_UNIFORMS, AERIAL_GLSL } from '../src/env.js';
import { FarCull, setFarFog, FOG_MARGIN, HYSTERESIS } from '../src/far-cull.js';
import { freezeStatic } from '../src/batch.js';

const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const mat = new THREE.MeshBasicMaterial();
const box = (x, z, size = 10) => { const o = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat); o.position.set(x, 0, z); return o; };
const cameraAt = (x = 0, z = 0) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, 1.5, z); return c; };
const staticGroup = (...meshes) => { const g = new THREE.Group(); for (const m of meshes) g.add(m); freezeStatic([g]); return g; };

test('only Potato has a far cull, in the 250-350 m the owner asked for; every other class keeps its draw distance and the look', () => {
  const D = PERFORMANCE.potato.farCull;
  assert.ok(D >= 250 && D <= 350, `potato far cull ${D} m`);
  for (const c of PERF_CLASSES.filter(c => c !== 'potato')) assert.equal(PERFORMANCE[c].farCull, 0, `${c} never culls the far world`);
  for (const c of PERF_CLASSES) assert.equal(resolveGraphics({ perfClass: c }, { deviceRatio: 1 }).farCull, PERFORMANCE[c].farCull);
  assert.deepEqual(PERF_CLASSES.map(c => PERFORMANCE[c].drawDistance), [500, 1000, 1000, 2000], 'the draw distances per class are unchanged');
  assert.deepEqual(Object.values(SCENERY_TIERS).map(t => t.drawDistance), [500, 1000, 1000, 2000, 4000], 'potato, low, med, high, ultra scenery draw distances are unchanged');
  assert.deepEqual(Object.values(SCENERY_TIERS).map(t => t.horizon), [2600, 5200, 7200, 9000, 12000], 'and so are the horizons');
  for (const [tier, metres, horizon] of [['high', 2000, 9000], ['ultra', 4000, 12000]]) {
    setDrawDistance(SCENERY_TIERS[tier].drawDistance, tier);
    assert.equal(drawDistance(), metres, `${tier} draw distance`); assert.equal(horizonDistance(), horizon, `${tier} horizon`);
  }
  for (const s of [{ perfClass: 'high' }, { perfClass: 'high', drawDistance: 4000 }]) assert.equal(resolveGraphics(s, { deviceRatio: 2 }).farCull, 0, 'a player-chosen 2 / 4 km draw distance never switches the cull on');
  assert.equal(resolveGraphics({ perfClass: 'potato' }, { deviceRatio: 1 }).R, RENDER, 'the look is the one look');
  const main = src('src/main.js');
  assert.match(main, /farCull\.update\(camera, farCullDistance\(\)\)/, 'main.js runs the cull from the scenery LOD pass');
  assert.match(main, /GFX\.farCull/, 'and takes the distance from the performance class');
});

test('the fog is fully opaque before the cut edge and off for every other class; unsupplied uniforms stay off', () => {
  const D = PERFORMANCE.potato.farCull;
  assert.deepEqual([...AP_UNIFORMS.apFar.value], [0, 0], 'default: no far fog');
  assert.match(AERIAL_GLSL, /uniform vec2 apFar;/); assert.match(AERIAL_GLSL, /if \(apFar\.y > 0\.5\)/, 'a zero uniform (materials that never get it) is off');
  setFarFog(D);
  const [start, end] = AP_UNIFORMS.apFar.value;
  assert.equal(end, D - FOG_MARGIN); assert.ok(start > 0 && start < end / 2, 'a ramp, not a wall');
  assert.ok(end + FOG_MARGIN <= D, 'opaque before the cut');
  assert.ok(FOG_MARGIN >= 6 * 83 * (1 / 60) + 10, 'the margin covers the 6-frame update cadence at 300 km/h plus slack');
  setFarFog(0); assert.deepEqual([...AP_UNIFORMS.apFar.value], [0, 0], 'class change away from potato turns it off');
});

test('FarCull: hides what is beyond the distance, with hysteresis, only static meshes, and gives everything back', () => {
  const near = box(100, 0), edge = box(340 + 10 + 5, 0), far = box(700, 0), behind = box(-900, 0), moving = box(2000, 0), hiddenByOthers = box(2500, 0);
  const g = staticGroup(near, edge, far, behind, hiddenByOthers); g.add(moving); // never frozen: it moves
  hiddenByOthers.visible = false;
  const cull = new FarCull(), cam = cameraAt();
  assert.equal(cull.bind(g), 5, 'the five static meshes are managed (the moving one is not)');
  cull.update(cam, 340);
  assert.deepEqual([near, edge, far, behind, moving, hiddenByOthers].map(o => o.visible), [true, true, false, false, true, false]);
  // hysteresis: `edge`'s nearest point is 350 m from x = 0, between the distance (340) and distance + hysteresis (370)
  cam.position.x = -15; cull.update(cam, 340); assert.equal(edge.visible, true, 'a shown chunk stays shown inside the hysteresis band');
  cam.position.x = -40; cull.update(cam, 340); assert.equal(edge.visible, false, 'hidden beyond distance + hysteresis');
  cam.position.x = -5; cull.update(cam, 340); assert.equal(edge.visible, false, 'and stays hidden inside the band (no flicker)');
  cam.position.x = 20; cull.update(cam, 340); assert.equal(edge.visible, true, 'back inside the distance: shown');
  cam.position.x = 380; cull.update(cam, 340); assert.equal(far.visible, true, 'driving towards it brings it back'); assert.equal(near.visible, true);
  assert.ok(HYSTERESIS >= 20);
  for (const [start, name] of [[20, 'shown'], [-40, 'hidden']]) {
    cam.position.x = start; cull.update(cam, 340); const state = edge.visible;
    for (let i = 0; i < 200; i++) { cam.position.x = -Math.sin(i) * 8; cull.update(cam, 340); assert.equal(edge.visible, state, `a chunk that was ${name} never flickers when the camera jitters +-8 m around the edge`); }
  }
  cull.update(cam, 0); assert.ok([near, edge, far, behind].every(o => o.visible), 'distance 0 (every other class) shows everything again');
  assert.equal(hiddenByOthers.visible, false, 'a mesh something else hid is never switched on');
  cam.position.set(0, 1.5, 0); cull.update(cam, 340); assert.equal(far.visible, false);
  cull.release(); assert.ok(far.visible && behind.visible, 'release gives back everything the cull hid');
});

test('FarCull: a part flagged userData.farCull (signal lamps, halos) is managed although its parent is not frozen; unflagged moving parts never are', () => {
  const lamps = new THREE.Group(), lamp = box(900, 0), halo = new THREE.Sprite(new THREE.SpriteMaterial()), car = box(950, 0);
  halo.position.set(900, 5, 0); lamp.userData.farCull = true; halo.userData.farCull = true; lamps.add(lamp, halo, car);
  const g = new THREE.Group(); g.add(lamps); // nothing frozen
  const cull = new FarCull(), cam = cameraAt(); assert.equal(cull.bind(g), 2, 'the flagged lamp and halo only, not the unflagged mover');
  cull.update(cam, 340); assert.deepEqual([lamp.visible, halo.visible, car.visible], [false, false, true]);
  cam.position.x = 800; cull.update(cam, 340); assert.deepEqual([lamp.visible, halo.visible], [true, true]);
});

test('FarCull never touches the scenery LOD list\'s own visibility rule: a chunk that list hid stays hidden', () => {
  const chunk = box(5000, 0), g = staticGroup(chunk), cull = new FarCull();
  cull.bind(g, [chunk]); const cam = cameraAt();
  cull.update(cam, 340); assert.equal(chunk.visible, false);
  chunk.visible = true; /* the LOD pass re-evaluates every chunk and sets it itself */ cam.position.x = 4900; cull.update(cam, 340); assert.equal(chunk.visible, true);
  chunk.visible = false; /* LOD says: out of its own range */ cam.position.x = 0; cull.update(cam, 340); cam.position.x = 4900; cull.update(cam, 340);
  assert.equal(chunk.visible, false, 'a chunk its own LOD range hid is not forced back on');
});

test('Riviera at a fixed pose: the near road and terrain are all drawn, everything the cull hides is beyond it, and the draws roughly halve', async () => {
  const { worldFixture } = await import('./world-test-fixture.mjs');
  const { buildRoad } = await import('../src/road.js');
  const { map, network, terrain } = await worldFixture('riviera');
  const D = PERFORMANCE.potato.farCull, scene = new THREE.Group();
  const road = buildRoad(map, scene, terrain.heightC, { network, furniture: false }).group;
  scene.add(terrain.group); scene.updateMatrixWorld(true);
  freezeStatic([scene]); scene.matrixAutoUpdate = false;
  const meshes = []; scene.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
  const worldVerts = new Map(); // every mesh's vertices in world space, once
  for (const m of meshes) { const a = m.geometry.attributes.position, v = new THREE.Vector3(), w = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); w.set([v.x, v.y, v.z], i * 3); } worldVerts.set(m, w); }
  const vertexDistances = (m, p) => { const w = worldVerts.get(m); let min = Infinity; for (let i = 0; i < w.length; i += 3) { const dx = w[i] - p.x, dy = w[i + 1] - p.y, dz = w[i + 2] - p.z, d = dx * dx + dy * dy + dz * dz; if (d < min) min = d; } return Math.sqrt(min); };
  const cull = new FarCull(); assert.ok(cull.bind(scene) >= meshes.length * 0.9, 'the road and terrain chunks are all managed');
  let pose = 0;
  for (const s of [3000, 5712, 9394]) { // a long straight and a corner from the capture tool, and the middle of the route
    const p = map.route.point(s, map.route.laneU(s, 0)); p.y += 1.4; const cam = cameraAt(p.x, p.z); cam.position.y = p.y;
    cull.release(); cull.update(cam, D);
    const shown = meshes.filter(m => m.visible), hidden = meshes.filter(m => !m.visible);
    assert.ok(hidden.length > 0 && shown.length < meshes.length * 0.75, `pose ${s}: ${shown.length} of ${meshes.length} road / terrain chunks drawn`);
    for (const m of hidden) assert.ok(vertexDistances(m, cam.position) > D, `pose ${s}: a hidden chunk (${m.parent?.name || m.type}) has a vertex inside the draw distance`);
    for (const m of shown.filter(o => o.parent === road)) assert.ok(m.visible);
    const nearRoad = meshes.filter(m => vertexDistances(m, cam.position) < D); assert.ok(nearRoad.length > 0 && nearRoad.every(m => m.visible), `pose ${s}: everything within ${D} m is drawn`);
    // the road ahead along the route, out to the fog's end, is never culled
    const ahead = new THREE.Vector3();
    for (let d = 0; d <= D - FOG_MARGIN; d += 25) { map.route.point(s + d, map.route.laneU(s + d, 0), ahead); const owner = meshes.filter(m => m.parent === road).filter(m => vertexDistances(m, ahead) < 6); assert.ok(owner.every(m => m.visible), `pose ${s}: route ${d} m ahead is drawn`); }
    pose++;
  }
  assert.equal(pose, 3);
  cull.release(); assert.ok(meshes.every(m => m.visible), 'the cull gives every chunk back');
});

test('render only: no gameplay file reads the far cull, and physics / collision / the route never see `visible` of a world mesh', () => {
  const cull = src('src/far-cull.js');
  assert.doesNotMatch(cull, /\b(route|ground|veh|physics|traffic|police)\b\./, 'the module touches meshes only');
  for (const file of ['src/ground.js', 'src/traffic.js', 'src/police.js', 'src/drivable-corridor.js', 'src/road-network-surface.js', 'src/hud.js']) assert.doesNotMatch(src(file), /far-cull|farCull/, `${file} does not know about the far cull`);
});
