// The Athens tree layer, the street trees derived from a tile's roads, and the denser rooftop kit (docs/world-beauty.md, step 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deriveStreetTrees, deriveLegacyStreetTreeSeeds, TREE, STREET_TREE_LIMIT } from '../src/world-tile-trees.js';
import { AthensTrees, treeTriangles, speciesOfBakeRow, TREE_LIMITS } from '../src/athens-trees.js';
import { rooftopKit } from '../src/world-tile-buildings.js';
import {vegetationContactIndex,vegetationRadius,streetTreeHeight} from '../src/vegetation-clearance.js';
import { KINDS } from '../src/athens-props.js';

// one two-way street along x at z = 100, 160 m long: two directed edges, geometry shared
function street({ lanes = 1, speed = 30, flags = 0 } = {}) {
  const pts = []; for (let x = 20; x <= 180; x += 20) pts.push(x, 5, 100);
  const rev = []; for (let x = 180; x >= 20; x -= 20) rev.push(x, 5, 100);
  return { edges: Uint32Array.from([1, 0, 1, 0, 9, 0, lanes, speed, flags, 0, 2, 1, 0, 9, 9, 0, lanes, speed, flags, 0]), edgePoints: Float32Array.from([...pts, ...rev]), edgeLayers: Int8Array.from([0, 0]) };
}
test('quiet streets get a tree every 11 to 17 m on both kerbs, none inside buildings, near crossings or on fast roads', () => {
  const t = street(), rows = deriveStreetTrees(t, []);
  assert.ok(rows.length % 5 === 0 && rows.length / 5 >= 8, `${rows.length / 5} trees`);
  const north = [], south = [];
  for (let i = 0; i < rows.length; i += 5) { const z = rows[i + 2]; (z < 100 ? north : south).push(rows[i]); assert.ok(Math.abs(Math.abs(z - 100) - 4.6) < .6, 'a tree stands just beyond the carriageway, on a kerb'); assert.ok(rows[i] >= 20 && rows[i] <= 180); assert.ok(rows[i + 4] >> 3 <= TREE.oleander); }
  assert.ok(north.length > 2 && south.length > 2, 'both kerbs');
  for (const side of [north, south]) { side.sort((a, b) => a - b); for (let i = 1; i < side.length; i++) assert.ok(side[i] - side[i - 1] >= 5, 'trees stand apart'); }
  assert.deepEqual([...deriveStreetTrees(t, [])], [...rows], 'the same tile always gets the same trees');
  const wall = [[0, 80], [200, 80], [200, 103], [0, 103]], blocked = deriveStreetTrees(t, [wall]);
  for (let i = 0; i < blocked.length; i += 5) assert.ok(blocked[i + 2] > 103, 'no tree in a building: only the south kerb is left');
  assert.equal(deriveStreetTrees(street({ speed: 60 }), []).length, 0, 'an avenue is not planted');
  assert.equal(deriveStreetTrees(street({ lanes: 3 }), []).length, 0);
  assert.equal(deriveStreetTrees(street({ flags: 2 }), []).length, 0, 'not on a bridge');
  const cross = street(); cross.edges = Uint32Array.from([...cross.edges, 3, 4, 5, 18, 2, 0, 1, 30, 0, 0]); cross.edgePoints = Float32Array.from([...cross.edgePoints, 100, 5, 60, 100, 5, 140]); cross.edgeLayers = Int8Array.from([0, 0, 0]);
  for (let i = 0, r = deriveStreetTrees(cross, []); i < r.length; i += 5) assert.ok(Math.abs(r[i] - 100) > 4.2 || Math.abs(r[i + 2] - 100) > 4.2, 'clear of the crossing street');
  const big = { edges: new Uint32Array(0), edgePoints: new Float32Array(0) }; assert.equal(deriveStreetTrees(big, []).length, 0);
  assert.ok(STREET_TREE_LIMIT * 5 * 4 <= 16 * 1024, 'the rows of a cell stay under 16 KB');
});
test('the tree layer draws one call per species in range plus the shadows, near the camera only, and nothing with World detail Off', () => {
  const group = new THREE.Group(), trees = new AthensTrees(group), rows = [];
  for (let i = 0; i < 40; i++) rows.push(10 + i * 4, 5, 20, i * .3, (i % 3 === 0 ? TREE.cypress : TREE.orange) * 8 + (i % 8));
  rows.push(300, 5, 20, 0, TREE.palm * 8);
  trees.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { streetTrees: 0 } } }, arrays: [Float32Array.from(rows)] });
  trees.update({ position: { x: 60, z: 20 } });
  assert.equal(trees.stats.instances, 40, 'the far palm is out of range'); assert.equal(trees.stats.drawCalls, 3, 'oranges, cypresses, shadows');
  assert.ok(trees.group.visible); trees.setEnabled(false); assert.equal(trees.group.visible, false); trees.update({ position: { x: 600, z: 20 } }); assert.equal(trees.stats.instances, 40, 'nothing is rebuilt while Off');
  trees.setEnabled(true); trees.update({ position: { x: 600, z: 20 } }); assert.equal(trees.stats.instances, 0); assert.equal(trees.stats.drawCalls, 0);
  assert.ok(Object.values(TREE).every(s => treeTriangles(s) > 20 && treeTriangles(s) < 100), 'a tree is under 100 triangles');
  assert.ok(TREE_LIMITS.capacity <= 420);
  trees.dispose();
});
test('bake park candidates become pines, cypresses and oleanders, bake trees mostly oranges', () => {
  const count = (kind) => { const c = {}; for (let s = 0; s < 1000; s++) { const k = speciesOfBakeRow(kind, s); c[k] = (c[k] || 0) + 1; } return c; };
  const park = count(2), row = count(0);
  assert.ok(park[TREE.pine] > 300 && park[TREE.cypress] > 100 && park[TREE.oleander] > 100); assert.ok(row[TREE.orange] >= 500);
});
test('a flat roof gets about one solar heater per 80 m2, antennas, a stair head and sometimes a pergola, all inside the roof and always the same', () => {
  const roof = (w, d, x = 0, z = 0) => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
  let heaters = 0, roofs = 0, pergolas = 0, antennas = 0, stairs = 0;
  for (let h = 1; h < 400; h++) { const hash = Math.imul(h, 2654435761) >>> 0, kit = rooftopKit(roof(20, 20), 15, hash, 400); if (!kit.length) continue; roofs++;
    for (const k of kit) { assert.ok(k.x > 1 && k.x < 19 && k.z > 1 && k.z < 19, 'inside the roof'); const kind = k.code >> 2; if (kind === 1) heaters++; if (kind === 2) antennas++; if (kind === 3) pergolas++; if (kind === 0) stairs++; }
    assert.deepEqual(kit, rooftopKit(roof(20, 20), 15, hash, 400)); }
  assert.ok(roofs > 300, 'most roofs of five floors get a kit'); assert.ok(heaters / roofs > 3 && heaters / roofs <= 5, `${heaters / roofs} heaters on a 400 m2 roof`);
  assert.ok(antennas / roofs >= 1.5 && stairs / roofs > .9 && pergolas / roofs > .08 && pergolas / roofs < .25);
  assert.equal(rooftopKit(roof(5, 5), 15, 123456, 25).length, 0, 'a tiny roof gets nothing'); assert.equal(rooftopKit(roof(20, 20), 3, 123456, 400).length, 0, 'not on a one-floor house');
  assert.deepEqual([KINDS.rooftop, KINDS.solar, KINDS.antenna, KINDS.pergola], [14, 15, 16, 17]);
});

// Real cells reserve an eight-metre carriageway+shoulder strip. The old
// 4.6 m seeds were all discarded by prepareTilePacket's crown audit.
test('setback planting survives full shoulders, follows ground, and respects buildings, ownership and bridges',()=>{
 const t=street();t.finePositions=new Float32Array([0,7,0,512,7,0,512,7,512,0,7,512]);t.fineTriangles=new Uint32Array([0,1,2,0,2,3]);t.fineFlags=new Uint8Array([0,0]);
 t.contactPositions=new Float32Array([0,5,92,512,5,92,512,5,108,0,5,108]);t.contactTriangles=new Uint32Array([0,1,2,1,1,0,2,3,1,1]);
 const q=vegetationContactIndex(t),r=deriveStreetTrees(t,[]),legacy=deriveLegacyStreetTreeSeeds(t,[]);assert.ok(legacy.length>0);for(let i=0;i<legacy.length;i+=5)assert.ok(Math.abs(legacy[i+2]-100)<6,'legacy parking seeds stay at their original kerb positions');assert.equal(deriveLegacyStreetTreeSeeds(street({speed:50}),[]).length,0,'legacy speed eligibility is unchanged');assert.ok(r.length/5>=8);
 for(let i=0;i<r.length;i+=5){const code=r[i+4]|0,radius=vegetationRadius(code>>3,streetTreeHeight(code>>3,code&7));assert.ok(q.clear(r[i],r[i+2],radius));assert.equal(r[i+1],7);assert.ok(Math.abs(r[i+2]-100)>12);}
 assert.deepEqual(r,deriveStreetTrees(t,[]));assert.ok(r.byteLength<=STREET_TREE_LIMIT*20);
 assert.equal(deriveStreetTrees(t,[],()=>false,{blocked:()=>true}).length,0,'authored ownership can exclude the whole planting envelope');
 const walls=[[[0,70],[200,70],[200,91],[0,91]],[[0,109],[200,109],[200,130],[0,130]]];assert.equal(deriveStreetTrees(t,walls).length,0,'no space for a full crown between road and building');
 t.fineSurface=new Uint32Array([1,1]);assert.equal(deriveStreetTrees(t,[],()=>false,{landSurfaceIds:new Set([2])}).length,0,'mapped paving is not planting land');
 assert.equal(deriveStreetTrees(t,[],()=>false,{landSurfaceIds:new Set([1]),pavedGroundTriangles:new Uint8Array([1,1])}).length,0,'urban paving remains excluded even when the source surface ID is terrain');
 t.finePositions.fill(-1);assert.equal(deriveStreetTrees(t,[]).length,0,'missing ground does not fall back to road height');
 t.edgeLayers.fill(1);assert.equal(deriveStreetTrees(t,[]).length,0);
});
