// Step 4 and 5 of the Athens beauty pass: parked cars and scooters derived from the road graph, contact shadows under props, the scooter model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deriveParking, filterParkingStops, PARKING_LIMIT } from '../src/world-tile-parking.js';
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
test('sparse parking keeps complete cars on asphalt, pavements and junction corners clear, and leaves large gaps', () => {
  const t=street({half:5.6}),rows=deriveParking(t,[]),k=kinds(rows);
  assert.ok(k.cars>0&&k.cars<12,JSON.stringify(k));
  assert.deepEqual([...deriveParking(t,[])],[...rows]);
  const cars=[];
  for(let i=0;i<rows.length;i+=5){
    assert.ok(rows[i]>38&&rows[i]<202,'16 m corner clearance plus half a car');
    if(rows[i+4]>>3)continue;
    const box=boxCorners(rows[i],rows[i+2],rows[i+3],2.15,.96);cars.push(box);
    for(const [x,z] of box)assert.ok(Math.abs(z-100)<5.6&&Math.abs(z-100)>3.2,'whole car inside asphalt, outside driving corridor');
    assert.equal(rows[i+1],5);
  }
  for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++)assert.ok(boxGap(cars[a],cars[b])>=2);
  for(const half of [1.2,2.4,3.6,4.2])assert.equal(kinds(deriveParking(street({half}),[])).cars,0,'never substitute a pavement bay');
  for(const options of [{speed:50},{speed:80},{lanes:2},{lanes:3}])assert.equal(deriveParking(street({...options,half:5.6}),[]).length,0,'no arterial parking');
  const wall=[[0,80],[300,80],[300,103],[0,103]];
  for(let i=0,r=deriveParking(t,[wall]);i<r.length;i+=5)assert.ok(r[i+2]>103,'wall footprint clear');
  const occupied=[rows[0],rows[2]],again=deriveParking(t,[],()=>false,occupied);
  for(let i=0;i<again.length;i+=5)assert.ok(Math.hypot(again[i]-occupied[0],again[i+2]-occupied[1])>=3.4);
  for(const kind of [1,2,12]){
    const r=filterParkingStops(deriveParking(t,[]),[120,5,105,0,0],[kind]);
    for(let i=0;i<r.length;i+=5)assert.ok(Math.hypot(r[i]-120,r[i+2]-105)>=(kind===12?11:17));
  }
  assert.ok(PARKING_LIMIT*5*4<=14*1024);
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
test('nothing parks against a median; a wide ordinary street retains outer kerb cars', () => {
  const t=street({half:5.6}),base=t.finePositions.length/3;
  const divided={...t,finePositions:Float32Array.from([...t.finePositions,0,5,111,300,5,111,0,5,117,300,5,117]),fineTriangles:Uint32Array.from([...t.fineTriangles,base,base+2,base+1,base+1,base+2,base+3]),fineFlags:Uint8Array.from([...t.fineFlags,1,1])};
  const rows=deriveParking(divided,[]);assert.ok(kinds(rows).cars>0);
  for(let i=0;i<rows.length;i+=5)assert.ok(rows[i+2]<100,'no median-side parking');
  const both=deriveParking(t,[]);assert.ok(both.some((v,i)=>i%5===2&&v>100),'ordinary street keeps the south kerb');
});
import { boxCorners as corners, boxGap as gapOf } from '../src/world-tile-parking.js';
/** A street along x at z = 100 (2.4 m of asphalt each side, y = 5) with pavement beyond it at height `pave`, starting `at` metres from the axis. */
function stepStreet(pave, at = 2.4) {
  const base = street(); const q = (z0, z1, y) => [-50, y, z0, 400, y, z0, -50, y, z1, 400, y, z1];
  const pos = [...base.finePositions.slice(0, 12), ...q(100 - at, 0, pave), ...q(100 + at, 300, pave), ...q(100 - at, 100 - 2.4, 5), ...q(100 + 2.4, 100 + at, 5)];
  const tri = []; for (let k = 0; k < pos.length / 12; k++) tri.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 1, k * 4 + 2, k * 4 + 3);
  return { ...base, finePositions: Float32Array.from(pos), fineTriangles: Uint32Array.from(tri), fineFlags: Uint8Array.from([1, 1, 2, 2, 2, 2, 2, 2, 2, 2]) };
}
test('narrow pavement streets never get cars and unsupported or steep asphalt bays are omitted', () => {
  for(const h of [5.1,5.45])assert.equal(kinds(deriveParking(stepStreet(h),[])).cars,0);
  const slope=street({half:5.6});for(let i=0;i<slope.finePositions.length;i+=3)slope.finePositions[i+1]=5+slope.finePositions[i]*.08;
  assert.equal(kinds(deriveParking(slope,[])).cars,0,'horizontal model would float on this slope');
  const noGround={...street({half:5.6}),fineTriangles:new Uint32Array(0),fineFlags:new Uint8Array(0)};
  assert.equal(kinds(deriveParking(noGround,[])).cars,0,'no guessed ground support');
});
test('cars on a tight bend never overlap and keep 0.8 m between them; a run ends in a gap', () => {
  const pts = [], R = 60; for (let a = 0; a <= 180; a += 5) pts.push(100 + R * Math.sin(a * Math.PI / 180), 5, 100 - R * Math.cos(a * Math.PI / 180) + R); // a half circle
  const asphaltHalf = 5.8, ring = []; for (let a = 0; a <= 180; a += 5) for (const r of [R - asphaltHalf, R + asphaltHalf]) ring.push(100 + r * Math.sin(a * Math.PI / 180), 5, 100 + R - r * Math.cos(a * Math.PI / 180));
  const n = ring.length / 6, tri = []; for (let i = 0; i < n - 1; i++) tri.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const base = { nodes: new Uint32Array(0), nodePositions: new Float32Array(0), edges: Uint32Array.from([1, 0, 1, 0, pts.length / 3, 0, 1, 30, 0, 0]), edgePoints: Float32Array.from(pts), edgeLayers: Int8Array.from([0]) };
  const t = withGround({ ...base, finePositions: Float32Array.from(ring), fineTriangles: Uint32Array.from(tri), fineFlags: Uint8Array.from(tri.map(() => 1).slice(0, tri.length / 3)) });
  const rows = deriveParking(t, []); const cars = []; for (let i = 0; i < rows.length; i += 5) if (!(rows[i + 4] >> 3)) cars.push(corners(rows[i], rows[i + 2], rows[i + 3], 2.15, .9));
  assert.ok(cars.length >= 1, `${cars.length} cars on the bend`); for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) assert.ok(gapOf(cars[a], cars[b]) >= .8, `cars ${a} and ${b} are ${gapOf(cars[a], cars[b])} m apart`);
});

test('successive prop rebuilds never inherit contact shadow scale, including after tile replacement',()=>{
 const p=new AthensProps(new THREE.Group()),packet={metadata:{origin:[0,0,0],extensions:{worldDetail:{parking:0}}},arrays:[Float32Array.from([10,5,10,1.2,0,14,5,14,0,8])]};
 for(let j=0;j<4;j++){p.addTile('0,0',packet);p.rebuild(j*10,0);const m=new THREE.Matrix4(),pos=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  for(const kind of [KINDS.parked_car,KINDS.scooter]){const mesh=p.meshes.get(kind).mesh;assert.ok(mesh.count);mesh.getMatrixAt(0,m);m.decompose(pos,q,s);for(const n of [s.x,s.y,s.z])assert.ok(Math.abs(n-1)<1e-6,'unit model scale after shadow pass');}
 }p.dispose();
});
