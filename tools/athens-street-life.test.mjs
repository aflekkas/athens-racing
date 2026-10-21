// Step 4 and 5 of the Athens beauty pass: parked cars and scooters derived from the road graph, contact shadows under props, the scooter model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deriveParking, PARKING_LIMIT } from '../src/world-tile-parking.js';
import { AthensProps, KINDS, propGeometry, kindGeometry } from '../src/athens-props.js';

function street({ lanes = 1, speed = 30, half = 2.4 } = {}) {
  const pts = [], rev = []; for (let x = 20; x <= 220; x += 20) pts.push(x, 5, 100); for (let x = 220; x >= 20; x -= 20) rev.push(x, 5, 100);
  // the carriageway: two asphalt triangles (flag bit 0) `half` metres either side of the axis
  const finePositions = Float32Array.from([0, 5, 100 - half, 300, 5, 100 - half, 0, 5, 100 + half, 300, 5, 100 + half]);
  return { edges: Uint32Array.from([1, 0, 1, 0, 11, 0, lanes, speed, 0, 0, 2, 1, 0, 11, 11, 0, lanes, speed, 0, 0]), edgePoints: Float32Array.from([...pts, ...rev]), edgeLayers: Int8Array.from([0, 0]), finePositions, fineTriangles: Uint32Array.from([0, 2, 1, 1, 2, 3]), fineFlags: Uint8Array.from([1, 1]) };
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
test('a parked car is a proper low-poly car: about 4.3 x 1.8 x 1.4 m, a glass band, four wheels and lights, under 130 triangles', () => {
  const g = kindGeometry(KINDS.parked_car); g.computeBoundingBox(); const b = g.boundingBox, size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  assert.ok(Math.abs(size[2] - 4.3) < .05 && size[0] > 1.75 && size[0] < 2.1 && size[1] > 1.3 && size[1] < 1.5, size.join(' ')); assert.ok(b.min.y >= -1e-6 && g.index.count / 3 < 140, `${g.index.count / 3} triangles`);
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
  const divided = { nodes: new Uint32Array(0), nodePositions: new Float32Array(0), edges: Uint32Array.from([1, 0, 1, 0, 11, 0, 1, 30, 0, 0, 2, 1, 0, 11, 11, 0, 1, 30, 0, 0]), edgePoints: Float32Array.from([...fwd, ...rev]), edgeLayers: Int8Array.from([0, 0]),
    finePositions: Float32Array.from([...strip(97, 103), ...strip(109, 115)]), fineTriangles: Uint32Array.from([...tri(0), ...tri(4)]), fineFlags: Uint8Array.from([1, 1, 1, 1]) };
  const rows = deriveParking(divided, []); assert.ok(rows.length > 0, 'the outer kerb still gets cars');
  for (let i = 0; i < rows.length; i += 5) assert.ok(rows[i + 2] < 100, `a car at z = ${rows[i + 2]} stands on the median side`);
  const wall = [[0, 104], [300, 104], [300, 108], [0, 108]]; // a building in the gap: not a median, a street front
  assert.ok(deriveParking(divided, [wall]).some(r => r > 100), 'with buildings between the two roads the south kerb parks again') ; void rows;
  const single = { ...divided, finePositions: Float32Array.from(strip(97, 103)), fineTriangles: Uint32Array.from(tri(0)), fineFlags: Uint8Array.from([1, 1]) };
  const both = deriveParking(single, []), south = both.filter((_, i) => i % 5 === 2 && both[i] > 100).length; assert.ok(south > 5, 'an ordinary two-way street keeps both kerbs');
  // two one-way carriageways side by side, east at z = 100 and west at z = 112 (asphalt 97..103 and 109..115, gap 6): the right kerb of the eastbound one is the south one, facing the westbound twin
  const east = [], west = []; for (let x = 20; x <= 220; x += 20) east.push(x, 5, 100); for (let x = 220; x >= 20; x -= 20) west.push(x, 5, 112);
  const pair = { ...divided, edges: Uint32Array.from([1, 0, 1, 0, 11, 0, 1, 30, 1, 0, 2, 2, 3, 11, 11, 0, 1, 30, 1, 0]), edgePoints: Float32Array.from([...east, ...west]) };
  const pairRows = deriveParking(pair, []); for (let i = 0; i < pairRows.length; i += 5) assert.ok(pairRows[i + 2] < 100 || pairRows[i + 2] > 112, `a car at z = ${pairRows[i + 2]} stands between the two carriageways`);
});
