import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_TABLES, validateWorldTile, validateTileSeam, residentArrayBytes } from '../src/world-tile-format.js';
export function fixture(cell = [0,0]) {
  const arrays = [], tables = {};
  for (const [k,[type]] of Object.entries(TILE_TABLES)) { tables[k] = arrays.length; arrays.push(new globalThis[type](k === 'coarseHeights' ? 1089 : 0)); }
  return { metadata:{tileVersion:1, world:'athens', revision:'test', cell, origin:[cell[0]*512,0,cell[1]*512], tables, ids:[''], strings:[''], meshes:[], palette:[[.5,.5,.5]], terrain:{coarseSize:33,spacing:16}, budgets:{triangles:0,buildingTriangles:36}}, arrays };
}
test('AWT/1 empty terrain tile is valid; unsupported revisions and malformed tables fail', () => {
  const p = fixture(); assert.equal(validateWorldTile(p).triangles,0);
  assert.throws(() => validateWorldTile(p,{revision:'old'}), /revision mismatch/);
  p.arrays[p.metadata.tables.coarseHeights][0] = NaN;
  assert.throws(() => validateWorldTile(p), /nonfinite/);
  p.arrays[p.metadata.tables.coarseHeights] = new Float32Array(1088);
  assert.throws(() => validateWorldTile(p), /coarse terrain/);
});
test('canonical terrain seams reject one bit changes and missing boundary contact vertices', () => {
  const a = fixture(), b = fixture([1,0]); assert.equal(validateTileSeam(a,b),true);
  b.arrays[b.metadata.tables.coarseHeights][0] = .00001; assert.throws(() => validateTileSeam(a,b), /cracked seam/);
  b.arrays[b.metadata.tables.coarseHeights][0] = 0;
  a.arrays[a.metadata.tables.contactPositions] = new Float32Array([512,1,2]);
  assert.throws(() => validateTileSeam(a,b), /cracked seam/);
  b.arrays[b.metadata.tables.contactPositions] = new Float32Array([0,1,2]); assert.equal(validateTileSeam(a,b),true);
});
test('retained bytes count shared backing allocations once', () => {
  const buffer = new ArrayBuffer(100); assert.equal(residentArrayBytes([new Float32Array(buffer,0,5),new Uint8Array(buffer,20,10)]),100);
});
test('contact indices, buildings and layer row alignment are checked before allocation', () => {
  const p = fixture(); p.metadata.ids.push('surface:1');
  p.arrays[p.metadata.tables.contactTriangles] = new Uint32Array([0,1,2,1,1]);
  assert.throws(() => validateWorldTile(p), /layer row/);
  p.arrays[p.metadata.tables.contactLayers] = new Int8Array(1);
  assert.throws(() => validateWorldTile(p), /vertex/);
});


test('manifest building-owner lists reject missing, duplicate and self references but permit cycles',async()=>{
 const {validateWorldManifest}=await import('../src/world-tile-format.js');
 const entry=()=>({url:'tile.gz',sha256:'0'.repeat(64),bytes:1,decodedBytes:1,triangles:0,dependencies:[]});
 const m={tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn:0'},tiles:{'0,0':entry(),'1,0':entry()}};
 for(const deps of [['1,0','1,0'],['0,0'],['2,0'],[null]]){m.tiles['0,0'].dependencies=deps;assert.throws(()=>validateWorldManifest(m),/dependencies/);}
 m.tiles['0,0'].dependencies=['1,0'];m.tiles['1,0'].dependencies=['0,0'];assert.equal(validateWorldManifest(m),m);
});
