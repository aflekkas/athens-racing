// Step 6b of the Athens beauty pass: kerb paint, bus-stop paint, manholes and asphalt patches (docs/world-beauty.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deriveStreetArt, ART_LIMITS, STREET_ART } from '../src/world-tile-street-art.js';
import { AthensMarks, MARK_LIMITS, KERB_WIDTH } from '../src/athens-marks.js';

/** A 200 m street along x at z = 100 with 3 m of asphalt each side of the axis, two edges (one per direction). */
function street(half = 3) {
  const fwd = [], rev = []; for (let x = 20; x <= 220; x += 20) fwd.push(x, 5, 100); for (let x = 220; x >= 20; x -= 20) rev.push(x, 5, 100);
  return { nodes: new Uint32Array(0), nodePositions: new Float32Array(0), edges: Uint32Array.from([1, 0, 1, 0, 11, 0, 1, 30, 0, 0, 2, 1, 0, 11, 11, 0, 1, 30, 0, 0]), edgePoints: Float32Array.from([...fwd, ...rev]), edgeLayers: Int8Array.from([0, 0]),
    finePositions: Float32Array.from([0, 5, 100 - half, 300, 5, 100 - half, 0, 5, 100 + half, 300, 5, 100 + half]), fineTriangles: Uint32Array.from([0, 2, 1, 1, 2, 3]), fineFlags: Uint8Array.from([1, 1]) };
}
const rowsOf = marks => { const r = []; for (let i = 0; i < marks.length; i += 7) r.push({ type: marks[i], x: marks[i + 1], y: marks[i + 2], z: marks[i + 3], a: marks[i + 4], b: marks[i + 5], c: marks[i + 6] }); return r; };
test('marks switch is on and kerb paint hugs the kerb: yellow on the junction approaches of a street, strips inside the asphalt edge', () => {
  assert.equal(STREET_ART.marks, true);
  const art = deriveStreetArt(street(), { strings: [] }, []), rows = rowsOf(art.marks), strips = rows.filter(r => r.type === 0); assert.ok(strips.length >= 12, `${strips.length} strips`);
  for (const s of strips) { assert.ok(Math.abs(Math.abs(s.z - 100) - (3 - KERB_WIDTH / 2 - .02)) < .3, `a strip ${s.z} lies at the kerb (2.8 m from the axis)`); assert.ok(Math.abs(s.b - s.z) < .5 && Math.hypot(s.a - s.x, s.b - s.z) < 4.6); assert.ok(s.y > 5.0 && s.y < 5.1, 'just over the road'); assert.ok([0, 1, 2].includes(s.c)); }
  const ends = strips.filter(s => s.x < 34 || s.x > 206), yellow = strips.filter(s => s.c === 0); assert.ok(ends.length > 0 && ends.every(s => s.c === 0), 'the 14 m next to a junction is yellow (no parking)');
  assert.equal(deriveStreetArt({ ...street(), fineTriangles: new Uint32Array(0), fineFlags: new Uint8Array(0) }, { strings: [] }, []).marks.length, 0, 'no asphalt, no marks');
});
test('bus stops get alternating red and white paint on the kerb beside them', () => {
  const rows = new Float32Array([120, 5, 96.5, 0, 0]), kinds = new Uint8Array([1]), art = deriveStreetArt(street(), { strings: [] }, [], { propsRows: rows, propsKinds: kinds }), strips = rowsOf(art.marks).filter(r => r.type === 0);
  const painted = strips.filter(s => s.c === 1 || s.c === 2 && Math.abs(s.x - 120) < 9); assert.ok(painted.length >= 3, `${painted.length} red or white strips`);
  assert.ok(strips.some(s => s.c === 2 && Math.abs(s.x - 120) < 9) && strips.some(s => s.c === 1 && Math.abs(s.x - 120) < 9), 'both red and white');
  assert.ok(strips.filter(s => Math.abs(s.x - 120) < 7 && s.c !== 0).every(s => s.z < 100), 'only on the stop\'s side of the street (z < 100 for a stop at z = 96.5)') ;
});
test('manholes and patches lie in the lane, inside the carriageway, and are capped per cell', () => {
  const art = deriveStreetArt(street(), { strings: [] }, []), rows = rowsOf(art.marks), holes = rows.filter(r => r.type === 1), patches = rows.filter(r => r.type === 2);
  assert.ok(holes.length >= 2 && patches.length >= 1, `${holes.length} manholes, ${patches.length} patches`);
  for (const h of holes) { assert.ok(Math.abs(h.z - 100) < 2.4 && h.a > .25 && h.a < .45); } for (const p of patches) { const w = (p.c % 10), len = p.b; assert.ok(Math.abs(p.z - 100) < 2.4 && len >= 1.4 && len <= 3.5 && w >= .6 && w <= 1.4, `${len} x ${w}`); }
  assert.ok(ART_LIMITS.marks <= 2000);
});
test('the marks layer drapes rows near the camera as one mesh of vertex-coloured triangles, drops the far ones, and hides with World detail Off', () => {
  const group = new THREE.Group(), marks = new AthensMarks(group), art = deriveStreetArt(street(), { strings: [] }, []);
  marks.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { roadMarks: 0 } } }, arrays: [art.marks] });
  marks.update({ position: { x: 100, z: 100 } }); assert.ok(marks.stats.triangles > 40 && marks.mesh.visible, `${marks.stats.triangles} triangles`);
  const near = marks.stats.triangles; marks.update({ position: { x: 100, z: 110 } }); assert.equal(marks.stats.triangles, near); assert.equal(marks.stats.rebuilds, 1, 'not rebuilt after a 10 m move (30 m is the step)'); marks.rebuild(100, 800); assert.equal(marks.stats.triangles, 0); assert.equal(marks.mesh.visible, false);
  marks.rebuild(100, 100); assert.equal(marks.mesh.visible, true); marks.setEnabled(false); assert.equal(marks.mesh.visible, false); marks.setEnabled(true); marks.update({ position: { x: 0, z: 100 } });
  assert.ok(marks.mesh.material.polygonOffset && marks.mesh.material.vertexColors && !marks.mesh.material.transparent); assert.ok(MARK_LIMITS.triangles <= 20000 && MARK_LIMITS.near <= 150);
  const c = marks.colour.array; let yellow = false; for (let i = 0; i < marks.stats.triangles * 9; i += 3) if (c[i] > c[i + 2] * 3 && c[i + 1] > c[i + 2] * 2) yellow = true; assert.ok(yellow, 'some yellow kerb paint');
});
import { readFileSync } from 'node:fs';
test('the marks layer is wired once into the Athens entry', () => {
  const world = readFileSync(new URL('../src/athens-world.js', import.meta.url), 'utf8');
  assert.match(world, /marks=new AthensMarks\(detailRoot,\{enabled:settings\.worldDetail!==false\}\)/); assert.match(world, /marks\.setEnabled\(s\.worldDetail!==false\)/); assert.match(world, /marks\.addTile\(key,packet\)/);
});
