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
  a.arrays[a.metadata.tables.contactPositions] = new Float32Array([512,1,2,512,1,3,511,1,2]);
  a.arrays[a.metadata.tables.contactTriangles] = new Uint32Array([0,1,2,0,1]);
  assert.throws(() => validateTileSeam(a,b), /cracked seam/);
  b.arrays[b.metadata.tables.contactPositions] = new Float32Array([0,1,2,0,1,3,1,1,2]);
  b.arrays[b.metadata.tables.contactTriangles] = new Uint32Array([0,1,2,0,1]); assert.equal(validateTileSeam(a,b),true);
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


test('bounded activation draws can share a dense canonical Float32 terrain table using Uint32 indices',()=>{
  const p=fixture(),position=p.metadata.tables.finePositions;
  p.arrays[position]=new Float32Array(70000*3);
  const index=p.arrays.length;p.arrays.push(new Uint32Array([69997,69998,69999]));
  p.metadata.meshes=[{attributes:{position:{array:position,itemSize:3}},index,material:0}];p.metadata.budgets.triangles=1;
  assert.equal(validateWorldTile(p).triangles,1);
  const color=p.arrays.length;p.arrays.push(new Uint8Array(3));p.metadata.meshes[0].attributes.color={array:color,itemSize:3};
  assert.throws(()=>validateWorldTile(p),/attribute length/);
  delete p.metadata.meshes[0].attributes.color;p.arrays[position][0]=NaN;
  assert.throws(()=>validateWorldTile(p),/nonfinite/);
});

test('a triangle tangent at one boundary vertex owns no shared boundary segment',()=>{
 const a=fixture(),b=fixture([1,0]);b.arrays[b.metadata.tables.contactPositions]=new Float32Array([0,1,20,1,1,19,1,1,21]);b.arrays[b.metadata.tables.contactTriangles]=new Uint32Array([0,1,2,0,1]);assert.equal(validateTileSeam(a,b),true);
});

test('matching boundary vertices do not hide different boundary segment topology',()=>{
 const a=fixture(),b=fixture([1,0]);
 for(const[p,x]of[[a,512],[b,0]]){p.arrays[p.metadata.tables.finePositions]=new Float32Array([x,0,0,x,0,20,x,0,40,x===0?1:511,0,20]);}
 a.arrays[a.metadata.tables.fineTriangles]=new Uint32Array([0,1,3,1,2,3]);b.arrays[b.metadata.tables.fineTriangles]=new Uint32Array([0,2,3,1,2,3]);assert.throws(()=>validateTileSeam(a,b),/cracked seam/);
});


test('manifest building-owner lists reject missing, duplicate and self references but permit cycles',async()=>{
 const {validateWorldManifest}=await import('../src/world-tile-format.js');
 const entry=()=>({url:'tile.gz',sha256:'0'.repeat(64),bytes:1,decodedBytes:1,triangles:0,dependencies:[]});
 const m={tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn:0'},tiles:{'0,0':entry(),'1,0':entry()}};
 for(const deps of [['1,0','1,0'],['0,0'],['2,0'],[null]]){m.tiles['0,0'].dependencies=deps;assert.throws(()=>validateWorldManifest(m),/dependencies/);}
 m.tiles['0,0'].dependencies=['1,0'];m.tiles['1,0'].dependencies=['0,0'];assert.equal(validateWorldManifest(m),m);
});

test('optional World detail validates facade rows, stable seeds and half-open vegetation ownership',async()=>{
 const {worldDetailSeed}=await import('../src/world-tile-format.js');
 assert.equal(worldDetailSeed('way/123'),3327974463);assert.equal(worldDetailSeed('relation/123'),4265439598);assert.equal(worldDetailSeed('Ποσειδώνος'),3300873462);
 const p=fixture(),add=a=>{p.arrays.push(a);return p.arrays.length-1;};
 p.metadata.ids.push('osm:way:123');p.arrays[p.metadata.tables.buildings]=new Uint32Array([1,0,4,0]);p.arrays[p.metadata.tables.buildingCorners]=new Float32Array([0,0,0,2,2,2,2,0]);p.arrays[p.metadata.tables.buildingHeights]=new Float32Array([2,8]);
 const d=p.metadata.extensions={worldDetail:{version:1,buildings:{facadeStyle:add(new Uint8Array([7])),detailSeed:add(new Uint32Array([worldDetailSeed('way/123')]))},vegetation:{positionHeight:add(new Float32Array([10,2,20,0])),kind:add(new Uint8Array([2])),seed:add(new Uint32Array([0xffffffff]))}}};
 assert.equal(validateWorldTile(p).triangles,0);const ext=d.worldDetail;
 for(const [array,index,bad,pattern]of [[ext.buildings.facadeStyle,0,8,/facadeStyle/],[ext.vegetation.positionHeight,0,512,/position/],[ext.vegetation.positionHeight,1,NaN,/nonfinite/],[ext.vegetation.positionHeight,3,-1,/height/],[ext.vegetation.kind,0,3,/kind/]]){
  const a=p.arrays[array],saved=a[index];a[index]=bad;assert.throws(()=>validateWorldTile(p),pattern);a[index]=saved;
 }
 ext.buildings.roofPropSeed=ext.buildings.detailSeed;assert.throws(()=>validateWorldTile(p),/alias/);delete ext.buildings.roofPropSeed;
 ext.version=2;assert.throws(()=>validateWorldTile(p),/version/);ext.version=1;
 p.arrays[ext.buildings.detailSeed]=new Uint32Array(0);assert.throws(()=>validateWorldTile(p),/building row count/);
});
