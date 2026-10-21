// Step 6a of the Athens beauty pass: Greek street-name plates and shop signs (docs/world-beauty.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { deriveStreetArt, ART_LIMITS } from '../src/world-tile-street-art.js';
import { signText, GENERIC, fitText, SlotAtlas, SLOT, SIGN_LIMITS } from '../src/athens-signs.js';

const square = (x, z, s = 12, base = 5, top = 20, style = 4) => ({ ring: [[x, z], [x + s, z], [x + s, z + s], [x, z + s]], base, top, style, hash: 123456 + x * 7 + z, quarter: false });
/** Two streets crossing at (100, 100) with one building on each of two corners. */
function crossing() {
  const E = [], P = [], node = [], pos = [];
  const addEdge = (id, a, b, name, pts) => { E.push(id, a, b, P.length / 3, pts.length, name, 1, 30, 0, 0); for (const p of pts) P.push(p[0], 5, p[1]); };
  node.push(1, 0, 2, 1, 3, 2, 4, 3, 5, 4); pos.push(100, 5, 100, 20, 5, 100, 180, 5, 100, 100, 5, 20, 100, 5, 180);
  addEdge(1, 1, 2, 1, [[100, 100], [20, 100]]); addEdge(2, 1, 3, 1, [[100, 100], [180, 100]]); addEdge(3, 1, 4, 2, [[100, 100], [100, 20]]); addEdge(4, 1, 5, 2, [[100, 100], [100, 180]]);
  return { edges: Uint32Array.from(E), edgePoints: Float32Array.from(P), edgeLayers: Int8Array.from([0, 0, 0, 0]), nodes: Uint32Array.from(node), nodePositions: Float32Array.from(pos) };
}
test('a junction gets a blue plate on its corner buildings, named after the street the wall runs along, and nothing at a bend', () => {
  const t = crossing(), art = deriveStreetArt(t, { strings: ['', 'Ερμού', 'Αθηνάς'] }, [square(106, 106), square(76, 106), square(106, 76)]);
  assert.ok(art.plates.length / 7 >= 2 && art.plates.length / 7 <= 4, `${art.plates.length / 7} plates`); assert.ok(art.plateNames.includes('Ερμού') || art.plateNames.includes('Αθηνάς'));
  for (let i = 0; i < art.plates.length; i += 7) { const x = art.plates[i], y = art.plates[i + 1], z = art.plates[i + 2], yaw = art.plates[i + 3];
    assert.ok(y > 7 && y < 9, 'about 3 m up the wall'); assert.ok(Math.hypot(x - 100, z - 100) < 30, 'at the junction'); assert.ok(Math.hypot(Math.sin(yaw), Math.cos(yaw)) > .99);
    const nx = Math.sin(yaw), nz = Math.cos(yaw); assert.ok((100 - x) * nx + (100 - z) * nz > 0, 'the plate faces the junction'); }
  const bend = { ...t, edges: Uint32Array.from([...t.edges.slice(0, 20)]), edgeLayers: Int8Array.from([0, 0]) };
  assert.equal(deriveStreetArt(bend, { strings: ['', 'Ερμού', 'Αθηνάς'] }, [square(106, 106)]).plates.length, 0, 'two streets meeting is a bend, not a junction');
  assert.ok(ART_LIMITS.plates <= 400);
});
test('the walls that face a road become shop sites, one per building, only on ground-floor styles of buildings over 6.5 m', () => {
  const t = crossing(), infos = [square(106, 104, 14, 5, 20, 4), square(60, 104, 14, 5, 9, 8), square(106, 60, 14, 5, 7, 4), square(110, 300, 14, 5, 20, 4)];
  const art = deriveStreetArt(t, { strings: ['', 'Ερμού', 'Αθηνάς'] }, infos), n = art.shops.length / 7;
  assert.ok(n >= 1 && n <= 3, `${n} sites`); for (let i = 0; i < art.shops.length; i += 7) { assert.ok(art.shops[i + 3] >= 4, 'a wall of 4 m or more'); assert.ok(((art.shops[i + 5] | 0) & 15) !== 8, 'not a pilotis ground floor'); assert.ok(art.shops[i + 6] >= 0 && art.shops[i + 6] < 2 ** 24); }
  assert.equal(art.marks.length, 0, 'no marks without asphalt');
});
test('sign text is capitals without accents, the generic shop fronts are the Greek ones the owner asked for, and long names shrink or break to fit', () => {
  assert.equal(signText('Βασιλέως Γεωργίου Α΄'), 'ΒΑΣΙΛΕΩΣ ΓΕΩΡΓΙΟΥ Α΄'); assert.equal(signText('  Πλατεία   Αγίων Ασωμάτων'), 'ΠΛΑΤΕΙΑ ΑΓΙΩΝ ΑΣΩΜΑΤΩΝ'); assert.equal(signText('Σκλαβενίτης'), 'ΣΚΛΑΒΕΝΙΤΗΣ'); assert.equal(signText('ό,τι'), 'Ο,ΤΙ');
  const words = GENERIC.map(g => g[0]); for (const w of ['ΦΑΡΜΑΚΕΙΟ', 'ΠΕΡΙΠΤΕΡΟ', 'ΚΑΦΕ', 'ΦΟΥΡΝΟΣ']) assert.ok(words.includes(w), w);
  assert.ok(GENERIC.every(([w, k]) => /^[Α-Ω ]+$/.test(w) && k >= 0 && k <= 9), 'capitals, a shop kind each');
  const ctx = { font: '', measureText(t) { return { width: t.length * (parseInt(this.font.match(/(\d+)px/)[1]) * .6) }; } };
  const [one, lines1] = fitText(ctx, 'ΚΑΦΕ', 220, 38); assert.equal(lines1.length, 1); assert.equal(one, 38);
  const [small, lines2] = fitText(ctx, 'ΒΑΣΙΛΕΩΣ ΓΕΩΡΓΙΟΥ ΤΡΙΤΟΥ ΚΑΙ ΒΑΣΙΛΕΙΑΣ ΣΟΦΙΑΣ', 220, 34, 17); assert.ok(lines2.length === 2 && small >= 12, `${lines2.join('|')} ${small}`);
});
test('the text atlas hands out 128 slots of 256 x 64 px, paints each once, and recycles slots by pruning', () => {
  const calls = []; globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  const atlas = new SlotAtlas(SLOT.atlasW, SLOT.atlasH, SLOT.w, SLOT.h); assert.equal(atlas.capacity, 128);
  const a = atlas.slot('x', () => calls.push('x')), b = atlas.slot('x', () => calls.push('again')); assert.equal(a, b); assert.deepEqual(calls, ['x']);
  assert.ok(a.rect[2] > .1 && a.rect[3] > .05 && a.rect.every(v => v > 0 && v < 1), 'a uv rectangle inside the atlas');
  for (let i = 0; i < 127; i++) assert.ok(atlas.slot('k' + i, () => {})); assert.equal(atlas.slot('overflow', () => {}), null, 'full: the sign is skipped this round'); atlas.prune(new Set(['x'])); assert.ok(atlas.slot('overflow', () => {}), 'after pruning there is room');
  assert.ok(SIGN_LIMITS.near <= 80 && SIGN_LIMITS.signs <= 500);
});
test('the named shops file is small and Greek, and the signs layer is wired once into the Athens entry and hidden with World detail Off', () => {
  const file = new URL('../assets/athens/pois.json', import.meta.url), j = JSON.parse(readFileSync(file, 'utf8')); assert.ok(statSync(file).size < 1536 * 1024 && j.names.length > 100 && j.rows.length % 4 === 0);
  assert.ok(j.names.some(n => /[Α-ω]/.test(n)), 'Greek names'); for (let i = 3; i < j.rows.length; i += 4) assert.ok(j.rows[i] < j.names.length);
  const world = readFileSync(new URL('../src/world-session.js', import.meta.url), 'utf8');
  assert.match(world, /signs=new AthensSigns\(detailRoot,\{enabled:settings\.worldDetail!==false\}\)/); assert.match(world, /signs\.setEnabled\(s\.worldDetail!==false\)/); assert.match(world, /signs\.load\(new URL\('\.\/assets\/athens\/pois\.json'/);
  const code = readFileSync(new URL('../src/athens-signs.js', import.meta.url), 'utf8'); assert.doesNotMatch(code, /castShadow|DirectionalLight|PointLight|MeshStandardMaterial/);
});

import * as THREE from 'three';
import { AthensSigns } from '../src/athens-signs.js';
test('the signs layer draws plates and shop signs near the camera, in one draw call, nothing far away, and nothing with World detail Off', () => {
  const ctx = new Proxy({ measureText: t => ({ width: t.length * 9 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const group = new THREE.Group(), signs = new AthensSigns(group), plates = [], shops = [];
  for (let i = 0; i < 6; i++) plates.push(20 + i * 8, 8, 100, 0.5, 1.2, i % 2, 7 + i); // [x, y, z, yaw, width, nameIndex, hash]
  for (let i = 0; i < 12; i++) shops.push(10 + i * 7, 100, Math.PI, 8, 5, 4, i * 997); // [x, z, yaw, length, baseY, flags(style 4), hash]
  shops.push(2000, 100, 0, 8, 5, 4, 5); // far away
  signs.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { streetPlates: 0, shopSites: 1, plateNames: ['Ερμού', 'Αθηνάς'] } } }, arrays: [Float32Array.from(plates), Float32Array.from(shops)] });
  signs.update({ position: { x: 50, z: 100 } }); assert.ok(signs.stats.signs >= 6 && signs.stats.signs <= 18, `${signs.stats.signs} signs`); assert.equal(signs.signMesh.mesh.visible, true); assert.ok(signs.stats.drawCalls >= 1 && signs.stats.drawCalls <= 2);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(); for (let i = 0; i < signs.signMesh.mesh.count; i++) { signs.signMesh.mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); assert.ok(Math.hypot(p.x - 50, p.z - 100) < SIGN_LIMITS.near); }
  signs.setEnabled(false); assert.equal(signs.group.visible, false); signs.dispose();
});
