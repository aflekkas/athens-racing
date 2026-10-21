// Step 4 and 5 of the Athens beauty pass: parked cars and scooters derived from the road graph, contact shadows under props, the scooter model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deriveParking, PARKING_LIMIT } from '../src/world-tile-parking.js';
import { AthensProps, KINDS, propGeometry, kindGeometry, carMaterial } from '../src/athens-props.js';

/** Ground under the whole test area: a flat quad at y = 5 (flag 2: terrain), listed after the asphalt triangles. */
const ground = (positions, triangles, flags, y = 5) => { const base = positions.length / 3; return { finePositions: Float32Array.from([...positions, -50, y, -50, 400, y, -50, -50, y, 300, 400, y, 300]), fineTriangles: Uint32Array.from([...triangles, base, base + 2, base + 1, base + 1, base + 2, base + 3]), fineFlags: Uint8Array.from([...flags, 2, 2]) }; };
const withGround = t => ({ ...t, ...ground(Array.from(t.finePositions), Array.from(t.fineTriangles), Array.from(t.fineFlags)) });
function street({ lanes = 1, speed = 30, half = 2.4 } = {}) {
  const pts = [], rev = []; for (let x = 20; x <= 220; x += 20) pts.push(x, 5, 100); for (let x = 220; x >= 20; x -= 20) rev.push(x, 5, 100);
  // the carriageway: two asphalt triangles (flag bit 0) `half` metres either side of the axis
  const finePositions = Float32Array.from([0, 5, 100 - half, 300, 5, 100 - half, 0, 5, 100 + half, 300, 5, 100 + half]);
  return withGround({ edges: Uint32Array.from([1, 0, 1, 0, 11, 0, lanes, speed, 0, 0, 2, 1, 0, 11, 11, 0, lanes, speed, 0, 0]), edgePoints: Float32Array.from([...pts, ...rev]), edgeLayers: Int8Array.from([0, 0]), finePositions, fineTriangles: Uint32Array.from([0, 2, 1, 1, 2, 3]), fineFlags: Uint8Array.from([1, 1]) });
}
const kinds = rows => { const c = { cars: 0, scooters: 0 }; for (let i = 0; i < rows.length; i += 5) (rows[i + 4] >> 3 ? c.scooters++ : c.cars++); return c; };
test('cars park on both kerbs of a quiet street, half on the pavement, leaving the lane clear, none near the junctions, in buildings or on props', () => {
  const t = street(), rows = deriveParking(t, []), k = kinds(rows);
  assert.ok(k.cars >= 20 && k.scooters >= 2, JSON.stringify(k));
  const sides = { n: 0, s: 0 };
  for (let i = 0; i < rows.length; i += 5) {
    const x = rows[i], z = rows[i + 2], off = Math.abs(z - 100), scooter = rows[i + 4] >> 3;
    assert.ok(x >= 32 && x <= 208, 'twelve metres from the ends'); (z < 100 ? sides.n++ : sides.s++);
    if (!scooter) assert.ok(Math.abs(off - 3.45) < .12, `a car on a narrow street (carriageway half width 2.4) stands wholly on the pavement beyond the kerb, ${off}`); else assert.ok(Math.abs(off - 3.5) < .1, 'scooters stand on the pavement');
    assert.ok(Math.abs(Math.cos(rows[i + 3])) < .2 || scooter, 'a car lies along the street');
  }
  assert.ok(sides.n > 5 && sides.s > 5);
  for (const north of [true, false]) { const cars = []; for (let i = 0; i < rows.length; i += 5) if (!(rows[i + 4] >> 3) && (rows[i + 2] < 100) === north) cars.push([rows[i], rows[i + 4]]); cars.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < cars.length; i++) { assert.notEqual(cars[i][1], cars[i - 1][1], 'neighbouring cars never share a paint'); assert.ok(cars[i][0] - cars[i - 1][0] >= 5.4, `a car length and a gap of 1.2 m or more between neighbours, ${cars[i][0] - cars[i - 1][0]}`); } }
  assert.ok(new Set(Array.from({ length: rows.length / 5 }, (_, i) => rows[i * 5 + 4]).filter(v => v < 8)).size >= 6, 'a street shows at least six paints');
  assert.deepEqual([...deriveParking(t, [])], [...rows], 'always the same cars');
  const wall = [[0, 80], [300, 80], [300, 103], [0, 103]];
  for (const r of [...deriveParking(t, [wall])].filter((_, i) => i % 5 === 2)) assert.ok(r > 103, 'nothing parks inside a building');
  const taken = [], keep = []; for (let i = 0; i < rows.length; i += 5) if (i % 10 === 0) taken.push(rows[i], rows[i + 2]);
  const again = deriveParking(t, [], () => false, taken); for (let i = 0; i < again.length; i += 5) for (let j = 0; j < taken.length; j += 2) assert.ok(Math.hypot(again[i] - taken[j], again[i + 2] - taken[j + 1]) >= 3.4, 'clear of a bake prop'); void keep;
  assert.equal(deriveParking(street({ speed: 80 }), []).length, 0, 'no parking on an avenue'); assert.equal(deriveParking(street({ lanes: 3 }), []).length, 0);
  const wide = deriveParking(street({ half: 5.6 }), []); assert.ok(wide.length > 0);
  for (let i = 0; i < wide.length; i += 5) if (!(wide[i + 4] >> 3)) assert.ok(Math.abs(Math.abs(wide[i + 2] - 100) - 4.8) < .15, 'on a street with a 11 m carriageway the car stands against the kerb: its inner flank is 3.9 m from the axis');
  const mid = deriveParking(street({ half: 3.6 }), []); for (let i = 0; i < mid.length; i += 5) if (!(mid[i + 4] >> 3)) assert.ok(Math.abs(Math.abs(mid[i + 2] - 100) - 4.65) < .15, 'on a 7 m street the car is wholly on the pavement: inner flank 3.7 m from the axis');
  assert.equal(deriveParking(street({ half: 1.2 }), []).length, 0, 'a lane too narrow for a car on its side is left alone'); assert.equal(deriveParking(street({ half: 9.5 }), []).length, 0, 'not on a boulevard or a junction mouth');
  assert.ok(PARKING_LIMIT * 5 * 4 <= 14 * 1024);
});
test('props draw parked cars and scooters with a paint each, and a contact shadow batch in one more call', () => {
  const group = new THREE.Group(), props = new AthensProps(group), rows = [];
  for (let i = 0; i < 30; i++) rows.push(10 + i * 5, 5, 20, 0, i % 3 === 0 ? 8 + i % 6 : i % 6);
  props.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { parking: 0 } } }, arrays: [Float32Array.from(rows)] });
  props.update({ position: { x: 80, z: 20 } }, 0);
  const calls = props.stats.drawCalls, cars = props.near.filter(r => r.kind === KINDS.parked_car).length, sc = props.near.filter(r => r.kind === KINDS.scooter).length;
  assert.equal(cars + sc, 30); assert.ok(cars > 15 && sc >= 8); assert.equal(calls, 3, 'cars, scooters and the shadows');
  assert.equal(props.shadow.count, 30); assert.equal(props.shadow.visible, true);
  props.setEnabled(false); assert.equal(props.group.visible, false);
  assert.ok(kindGeometry(KINDS.scooter).attributes.position.count / 3 < 120, 'a scooter is under 120 triangles'); assert.ok(propGeometry().attributes.position.count > 0);
});
test('a parked car is a proper low-poly car: 4.3 x 1.8 x 1.43 m, wheels 62 cm tall under a sill 17 cm off the ground, a glass band, four wheels and lights, under 150 triangles, glass and wheels that keep their colour under any paint', () => {
  const g = kindGeometry(KINDS.parked_car); g.computeBoundingBox(); const b = g.boundingBox, size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  assert.ok(Math.abs(size[2] - 4.3) < .05 && size[0] > 1.75 && size[0] < 2.1 && size[1] > 1.4 && size[1] < 1.48, size.join(' ')); assert.ok(Math.abs(b.min.y) < 1e-6, 'the wheels stand at y = 0'); assert.ok(b.min.y >= -1e-6 && g.index.count / 3 <= 150, `${g.index.count / 3} triangles`);
  const paint = g.attributes.aPaint; let painted = 0; for (let i = 0; i < paint.count; i++) painted += paint.getX(i); assert.ok(painted > paint.count * .3 && painted < paint.count * .7, 'body, roof and pillar are paint, glass, wheels, sill and lights are not');
  const sh = { vertexShader: '#include <common>\n#include <color_vertex>', fragmentShader: '' }; carMaterial().onBeforeCompile(sh); assert.match(sh.vertexShader, /mix\(vec3\(1\.0\),instanceColor\.xyz,aPaint\)/);
  const colours = g.attributes.color, dark = []; for (let i = 0; i < colours.count; i++) if (colours.getX(i) < .1 && colours.getY(i) < .1) dark.push(i); assert.ok(dark.length >= 16, 'wheels and glass are dark in the vertex colours, the paint white');
});
import { boxCorners, boxGap, parkedBoxes } from '../src/world-tile-parking.js';
import { buildTileObstacleIndex, WorldTileObstacles } from '../src/world-tile-obstacles.js';
test('boxGap measures the clearance between two oriented boxes', () => {
  assert.equal(boxGap(boxCorners(0, 0, 0, 2, 1), boxCorners(0, 1.5, 0, 2, 1)), 0, 'overlapping boxes');
  assert.ok(Math.abs(boxGap(boxCorners(0, 0, 0, 2, 1), boxCorners(3, 0, 0, 2, 1)) - 1) < 1e-9, 'side by side, 3 m between centres, 2 m wide each: a 1 m gap');
  assert.ok(Math.abs(boxGap(boxCorners(0, 0, 0, 1, 1), boxCorners(4, 0, 0, 1, 1)) - 2) < 1e-9, 'two 2 m boxes whose centres are 4 m apart along the long axis');
});
test('a parked car stays clear of a player car standing on any tow anchor of the tile', () => {
  const t = street({ half: 4.2 }); t.anchorTransforms = Float32Array.from([40, 5, 100 + 1.7, Math.PI / 2, 120, 5, 100 - 1.4, -Math.PI / 2, 200, 5, 100 + 3.3, Math.PI / 2]);
  const rows = deriveParking(t, []); assert.ok(rows.length > 0);
  for (let a = 0; a < t.anchorTransforms.length; a += 4) { const player = boxCorners(t.anchorTransforms[a], t.anchorTransforms[a + 2], t.anchorTransforms[a + 3], 2.25, .95);
    for (let i = 0; i < rows.length; i += 5) { const sc = rows[i + 4] >> 3; assert.ok(boxGap(player, boxCorners(rows[i], rows[i + 2], rows[i + 3], sc ? .55 : 2.15, sc ? .3 : .9)) >= .6, 'at least 0.6 m'); } }
});
test('parked cars and scooters are in the obstacle index as walls the player hits, up to their height', () => {
  const t = { buildingCorners: new Float32Array(0), buildings: new Uint32Array(0), buildingHeights: new Float32Array(0) };
  const rows = Float32Array.from([100, 5, 100, 0, 0, 120, 5, 100, 0, 8]), boxes = parkedBoxes(rows); assert.equal(boxes.length, 14);
  const index = buildTileObstacleIndex(t, boxes); assert.equal(index.segments.length / 6, 8, 'four walls each');
  const obstacles = new WorldTileObstacles(); obstacles.install('0,0', { obstacleIndex: index, metadata: { origin: [0, 0, 0] } });
  const hit = obstacles.contact(100, 5, 100 + 2.1, 1); assert.ok(hit && hit.pen > .5 && hit.height > 1.3, 'the car blocks the player 2.1 m ahead of its centre (nose at 2.15)');
  assert.equal(obstacles.contact(100, 5, 100 + 4.5, 1), null, 'nothing 4.5 m beyond the nose'); assert.equal(obstacles.contact(100, 8.6, 100, 1), null, 'a car does not block a deck above it');
  assert.ok(obstacles.contact(120, 5, 100, .4), 'and the scooter');
  const none = buildTileObstacleIndex(t); assert.equal(none.segments.length, 0, 'tiles without parking build the same index as before');
});
test('nothing parks against a median or the inner kerb of a divided road, only on the outer kerb', () => {
  // a two-way street at z = 100 (3 m of asphalt each side) and a second carriageway 9 to 15 m south of it (a median between): the south kerb of the street borders the median
  const fwd = [], rev = []; for (let x = 20; x <= 220; x += 20) fwd.push(x, 5, 100); for (let x = 220; x >= 20; x -= 20) rev.push(x, 5, 100);
  const strip = (z0, z1, base) => [0, 5, z0, 300, 5, z0, 0, 5, z1, 300, 5, z1].map((v, i) => v), tri = (o) => [o, o + 2, o + 1, o + 1, o + 2, o + 3];
  const divided = withGround({ nodes: new Uint32Array(0), nodePositions: new Float32Array(0), edges: Uint32Array.from([1, 0, 1, 0, 11, 0, 1, 30, 0, 0, 2, 1, 0, 11, 11, 0, 1, 30, 0, 0]), edgePoints: Float32Array.from([...fwd, ...rev]), edgeLayers: Int8Array.from([0, 0]),
    finePositions: Float32Array.from([...strip(97, 103), ...strip(109, 115)]), fineTriangles: Uint32Array.from([...tri(0), ...tri(4)]), fineFlags: Uint8Array.from([1, 1, 1, 1]) });
  const rows = deriveParking(divided, []); assert.ok(rows.length > 0, 'the outer kerb still gets cars');
  for (let i = 0; i < rows.length; i += 5) assert.ok(rows[i + 2] < 100, `a car at z = ${rows[i + 2]} stands on the median side`);
  const wall = [[0, 104], [300, 104], [300, 108], [0, 108]]; // a building in the gap: not a median, a street front
  assert.ok(deriveParking(divided, [wall]).some(r => r > 100), 'with buildings between the two roads the south kerb parks again') ; void rows;
  const single = withGround({ ...divided, finePositions: Float32Array.from(strip(97, 103)), fineTriangles: Uint32Array.from(tri(0)), fineFlags: Uint8Array.from([1, 1]) });
  const both = deriveParking(single, []), south = both.filter((_, i) => i % 5 === 2 && both[i] > 100).length; assert.ok(south > 5, 'an ordinary two-way street keeps both kerbs');
  // two one-way carriageways side by side, east at z = 100 and west at z = 112 (asphalt 97..103 and 109..115, gap 6): the right kerb of the eastbound one is the south one, facing the westbound twin
  const east = [], west = []; for (let x = 20; x <= 220; x += 20) east.push(x, 5, 100); for (let x = 220; x >= 20; x -= 20) west.push(x, 5, 112);
  const pair = { ...divided, edges: Uint32Array.from([1, 0, 1, 0, 11, 0, 1, 30, 1, 0, 2, 2, 3, 11, 11, 0, 1, 30, 1, 0]), edgePoints: Float32Array.from([...east, ...west]) };
  const pairRows = deriveParking(pair, []); for (let i = 0; i < pairRows.length; i += 5) assert.ok(pairRows[i + 2] < 100 || pairRows[i + 2] > 112, `a car at z = ${pairRows[i + 2]} stands between the two carriageways`);
});
import { boxCorners as corners, boxGap as gapOf } from '../src/world-tile-parking.js';
/** A street along x at z = 100 (2.4 m of asphalt each side, y = 5) with pavement beyond it at height `pave`, starting `at` metres from the axis. */
function stepStreet(pave, at = 2.4) {
  const base = street(); const q = (z0, z1, y) => [-50, y, z0, 400, y, z0, -50, y, z1, 400, y, z1];
  const pos = [...base.finePositions.slice(0, 12), ...q(100 - at, 0, pave), ...q(100 + at, 300, pave), ...q(100 - at, 100 - 2.4, 5), ...q(100 + 2.4, 100 + at, 5)];
  const tri = []; for (let k = 0; k < pos.length / 12; k++) tri.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 1, k * 4 + 2, k * 4 + 3);
  return { ...base, finePositions: Float32Array.from(pos), fineTriangles: Uint32Array.from(tri), fineFlags: Uint8Array.from([1, 1, 2, 2, 2, 2, 2, 2, 2, 2]) };
}
test('a car sits on top of the highest ground under its four wheels (never sunk into the pavement), and is not parked where the ground under it steps by more than 15 cm', () => {
  const low = deriveParking(stepStreet(5.1), []); assert.ok(low.length > 20);
  for (let i = 0; i < low.length; i += 5) assert.ok(Math.abs(low[i + 1] - 5.1) < .011, `y = ${low[i + 1]}: on the 5.1 m pavement, not the 5.0 m road axis`);
  const high = deriveParking(stepStreet(5.45), []); assert.ok(high.length > 0 && high.every((_, i) => i % 5 !== 1 || Math.abs(high[i] - 5.45) < .011), 'a 45 cm kerb and pavement: the car stands on the pavement');
  // pavement beginning 3.3 m from the axis: the car's inner wheels (at 3.45 - 0.82 = 2.63 m) are over the 5.0 asphalt-level strip, the outer wheels over the 5.3 pavement: a step of 30 cm under the car
  const splitRows = deriveParking(stepStreet(5.3, 3.3), []); for (let i = 0; i < splitRows.length; i += 5) if (!(splitRows[i + 4] >> 3)) assert.fail(`a car at z = ${splitRows[i + 2]} straddles the 30 cm step`);
});
test('cars on a tight bend never overlap and keep 0.8 m between them; a run ends in a gap', () => {
  const pts = [], R = 30; for (let a = 0; a <= 180; a += 5) pts.push(100 + R * Math.sin(a * Math.PI / 180), 5, 100 - R * Math.cos(a * Math.PI / 180) + R); // a half circle
  const asphaltHalf = 2.4, ring = []; for (let a = 0; a <= 180; a += 5) for (const r of [R - asphaltHalf, R + asphaltHalf]) ring.push(100 + r * Math.sin(a * Math.PI / 180), 5, 100 + R - r * Math.cos(a * Math.PI / 180));
  const n = ring.length / 6, tri = []; for (let i = 0; i < n - 1; i++) tri.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const base = { nodes: new Uint32Array(0), nodePositions: new Float32Array(0), edges: Uint32Array.from([1, 0, 1, 0, pts.length / 3, 0, 1, 30, 0, 0]), edgePoints: Float32Array.from(pts), edgeLayers: Int8Array.from([0]) };
  const t = withGround({ ...base, finePositions: Float32Array.from(ring), fineTriangles: Uint32Array.from(tri), fineFlags: Uint8Array.from(tri.map(() => 1).slice(0, tri.length / 3)) });
  const rows = deriveParking(t, []); const cars = []; for (let i = 0; i < rows.length; i += 5) if (!(rows[i + 4] >> 3)) cars.push(corners(rows[i], rows[i + 2], rows[i + 3], 2.15, .9));
  assert.ok(cars.length >= 4, `${cars.length} cars on the bend`); for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) assert.ok(gapOf(cars[a], cars[b]) >= .8, `cars ${a} and ${b} are ${gapOf(cars[a], cars[b])} m apart`);
});
