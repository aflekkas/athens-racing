import test from 'node:test';import assert from 'node:assert/strict';
import {coastalRows,appendCoastalSurfaces,COAST_LIMITS}from'../src/world-tile-coast.js';
import {COASTAL_DRESSING}from'../src/coastal-dressing-data.js';
import {withTileSurfaceIndexes}from'../src/world-tile-surface-cache.js';
import {groundIndex}from'../src/world-tile-ground.js';
import {asphaltIndex}from'../src/world-tile-asphalt.js';
const terrain=(height=5)=>({finePositions:Float32Array.of(0,height,0,512,height,0,512,height,512,0,height,512),fineTriangles:Uint32Array.of(0,2,1,0,3,2),fineFlags:Uint8Array.of(2,2),contactTriangles:new Uint32Array()});
const recipe=(trees=[],boats=[],surfaces=[])=>({trees,boats,surfaces});
test('immutable terrain query indexes are shared across wrappers only within one packet build',()=>{
 const t=terrain();let ground,asphalt;
 withTileSurfaceIndexes(()=>{
  ground=groundIndex(t);asphalt=asphaltIndex(t);
  assert.equal(groundIndex({...t}),ground);assert.equal(asphaltIndex({...t}),asphalt);
  const road={...t,fineFlags:Uint8Array.of(1,1)};assert.notEqual(asphaltIndex(road),asphalt);assert.equal(asphaltIndex(road).inside(50,50),true);assert.equal(asphalt.inside(50,50),false);
  withTileSurfaceIndexes(()=>assert.notEqual(groundIndex(t),ground));assert.equal(groundIndex(t),ground);
 });
 for(let i=1;i<t.finePositions.length;i+=3)t.finePositions[i]=8;
 assert.equal(groundIndex(t).heightAt(50,50),8);assert.equal(ground.heightAt(50,50),5);
 assert.notEqual(asphaltIndex(t),asphalt);
});
test('coastal spacing matches a full ordered distance scan at bucket and radius boundaries',()=>{
 const candidates=[[14,14,1,0],[13.999999,14,1,1],[15,14,4,2],[70,70,4,3]];
 for(let i=0;i<1500;i++)candidates.push([4+(i*31.73)%500,4+(i*97.11)%500,i%3?4:1,i*997]);
 const existing=Float32Array.of(7,5,14,0,8,504,5,504,0,8),baked=Float32Array.of(70,5,66,6),occupied=[[7,14],[504,504],[70,66]],expected=[];
 for(const [x,z,species,seed]of candidates){
  if(occupied.some(([a,b])=>Math.hypot(x-a,z-b)<(species===1?7:4)))continue;
  occupied.push([x,z]);expected.push(x,5,z,(seed%628)/100,species*8+((seed>>>16)%8));
 }
 assert.deepEqual(coastalRows(terrain(),[],recipe(candidates),existing,baked).trees,Float32Array.from(expected));
});
test('coastal vegetation is deterministic, grounded, cell-owned and excludes buildings, road, sea and existing trees',()=>{
 const t=terrain(),r=recipe([[80,80,1,19],[100,100,4,26],[140,140,1,29],[2,40,1,33]]),ring=[[70,70],[90,70],[90,90],[70,90]];
 const result=coastalRows(t,[ring],r,Float32Array.of(140,5,140,0,8));assert.deepEqual([...result.trees],[100,5,100,.25999999046325684,32]);
 assert.deepEqual(coastalRows(t,[ring],r,Float32Array.of(140,5,140,0,8)).trees,result.trees);
 assert.equal(coastalRows(terrain(-2),[],r).trees.length,0);
 const road=terrain();road.fineFlags.fill(1);assert.equal(coastalRows(road,[],r).trees.length,0);
});
test('marina hulls fit entirely over water and fail closed at tile edges or on land',()=>{
 const r=recipe([],[[100,100,0,0],[1,1,0,1]]);assert.equal(coastalRows(terrain(-5),[],r).boats.length,5);assert.equal(coastalRows(terrain(),[],r).boats.length,0);
});
test('coastal rows and surfaces never mutate physical tables and optional geometry is accounted',()=>{
 const t=terrain(),before=structuredClone(t),r=coastalRows(t,[],recipe([[100,100,1,1]],[],[['lake','w1',[10,10,10,30,30,10]]]));assert.deepEqual(t,before);
 const p={arrays:[],metadata:{meshes:[]}};const bytes=appendCoastalSurfaces(p,r.surfaces);assert.ok(bytes>=p.arrays.reduce((n,a)=>n+2*a.byteLength,0));assert.equal(p.metadata.meshes[0].userData.tileSurface,'coastalDetail');assert.equal(p.arrays[0][1],Math.fround(5.06));
});
test('source recipes have bounded rows, unique cell ownership, OSM provenance and no southern extent expansion',()=>{
 assert.match(COASTAL_DRESSING.osmSha256,/^[a-f0-9]{64}$/);assert.equal(COASTAL_DRESSING.sources.w50825797.name,'Λίμνη Βουλιαγμένης');
 const seen=new Set();for(const [key,r]of Object.entries(COASTAL_DRESSING.cells)){assert.ok(r.trees.length<=512&&r.boats.length<=64);const [cx,cz]=key.split(',').map(Number);assert.ok(cz<=40);
 for(const [x,z,s,seed,id]of r.trees){assert.ok(x>=0&&x<512&&z>=0&&z<512);assert.ok(s===1||s===4);assert.ok(COASTAL_DRESSING.sources[id]);const k=`${cx*512+x},${cz*512+z},${s}`;assert.ok(!seen.has(k));seen.add(k);}}
 assert.equal(COAST_LIMITS.trees,2048);
});

test('unmapped inland ground defaults to Mediterranean cover; beaches, roads and mapped woods are not house lots',async()=>{
 const {coverAt,coastalInfillTables}=await import('../src/world-tile-coast.js');
 const ring=[[80,80],[100,80],[100,92],[80,92]],res=[[60,60],[120,60],[120,120],[60,120]],r={cover:[['residential','w1',[res]]],infill:[['gen:house',3,ring]]};
 assert.equal(coverAt({cover:[]},80,80),'scrub');
 const t=terrain();assert.equal(coastalInfillTables(t,r).buildings.length,4);
 for(const kind of ['sand','wood','rock','water','park','developed'])assert.equal(coastalInfillTables(t,{...r,cover:[...r.cover,[kind,'w2',[res]]]}).buildings.length,0,kind);
 assert.equal(coastalInfillTables(t,{...r,cover:[]}).buildings.length,0);
 const road=terrain();road.fineFlags.fill(1);assert.equal(coastalInfillTables(road,r).buildings.length,0);
 const cliff=terrain();cliff.finePositions[4]=cliff.finePositions[7]=300;assert.equal(coastalInfillTables(cliff,r).buildings.length,0);
});
test('inferred house collisions disappear with World detail Off, preserving surveyed walls',async()=>{
 const {coastalInfillTables}=await import('../src/world-tile-coast.js'),{buildTileObstacleIndex,WorldTileObstacles}=await import('../src/world-tile-obstacles.js');
 const ring=[[80,80],[100,80],[100,92],[80,92]],r={cover:[['residential','w1',[[[60,60],[120,60],[120,120],[60,120]]]]],infill:[['gen:house',2,ring]]},houses=coastalInfillTables(terrain(),r);
 const o=new WorldTileObstacles();o.install('0,0',{metadata:{origin:[0,0,0]},detailObstacleIndex:buildTileObstacleIndex(houses)});
 assert.ok(o.contact(80,5,86,1));o.setDetailEnabled(false);assert.equal(o.contact(80,5,86,1),null);o.setDetailEnabled(true);assert.ok(o.contact(80,5,86,1));o.remove('0,0');assert.equal(o.contact(80,5,86,1),null);
});
test('exported infill keeps basin provenance and the owner-approved coastal storey range',()=>{
 assert.equal(COASTAL_DRESSING.infill.inferred,true);assert.deepEqual(COASTAL_DRESSING.infill.params.storeys,[1,3]);
 let count=0;for(const r of Object.values(COASTAL_DRESSING.cells))for(const [id,storeys,ring]of r.infill||[]){assert.match(id,/^gen:/);assert.ok(storeys>=1&&storeys<=3);assert.ok(ring.every(([x,z])=>x>2&&z>2&&x<510&&z<510));count++;}
 assert.equal(count,COASTAL_DRESSING.infill.cellOwnedLots);
});

test('coastal silhouettes use two capped batches and unload with their cells',async()=>{
 const THREE=await import('three'),{AthensTrees,COAST_FAR_LIMITS}=await import('../src/athens-trees.js'),trees=new AthensTrees(new THREE.Group()),rows=[];
 for(let i=0;i<3000;i++)rows.push(200+i%300,5,200+Math.floor(i/300),0,(i%2?1:4)*8);
 trees.addTile('0,0',{metadata:{origin:[0,0,0],extensions:{worldDetail:{streetTrees:0,coastalTreeCount:3000}}},arrays:[new Float32Array(rows)]});trees.update({x:0,z:0});
 assert.equal(trees.stats.drawCalls,2);assert.equal(trees.stats.distant,COAST_FAR_LIMITS.pine+COAST_FAR_LIMITS.scrub);assert.equal(trees.stats.triangles,COAST_FAR_LIMITS.pine*2+COAST_FAR_LIMITS.scrub*2);
 trees.setEnabled(false);assert.equal(trees.group.visible,false);trees.removeTile('0,0');trees.setEnabled(true);trees.update({x:0,z:0});assert.equal(trees.stats.distant,0);trees.dispose();
});

test('coastal houses replace legacy basin infill instead of overlapping it; surveyed buildings retain their rows',async()=>{
 const {coastalMappedBuildings}=await import('../src/world-tile-coast.js');
 const t={buildings:Uint32Array.of(0,0,4,2,1,4,4,2),buildingCorners:new Float32Array(16),buildingHeights:Float32Array.of(10,19.2,20,6.4)},before=structuredClone(t),metadata={ids:['building:gen:lot:0/9:37','building:w123:0/9:37']};
 const mapped=coastalMappedBuildings(t,metadata,{});assert.equal(mapped.removed,1);assert.deepEqual(mapped.rows,[1]);assert.deepEqual([...mapped.tables.buildingHeights],[20,Math.fround(6.4)]);assert.deepEqual(t,before);
 assert.equal(coastalMappedBuildings(t,metadata,undefined).tables,t,'outside the coast the basin remains untouched');
});

test('lake water respects the mapped outline, dry banks and emitted access roads',()=>{
 const ring=[[60,60],[120,60],[120,120],[60,120]],r={trees:[],boats:[],cover:[['lake','w1',[ring]]],surfaces:[['lake','w1',[60,60,60,120,120,60,120,60,60,120,120,120]]]};
 const wet=coastalRows(terrain(),[],r);assert.ok(wet.surfaces[0].positions.length>0);assert.ok(wet.surfaces[0].positions.length/9<=COAST_LIMITS.surfaceTriangles);
 const road=terrain();road.fineFlags.fill(1);assert.equal(coastalRows(road,[],r).surfaces.length,0);
});

test('joined bore hill is clipped to unique cells, with matching border vertices and solid optional wing walls',async()=>{
 const {coastalBoreSurfaces}=await import('../src/world-tile-coast-bores.js');
 const a=coastalBoreSurfaces({},[17,35]),b=coastalBoreSurfaces({},[17,36]);
 for(const surfaces of [a,b])for(const s of surfaces){assert.ok(s.positions.length/9<5000);for(let i=0;i<s.positions.length;i+=3){assert.ok(s.positions[i]>=-.0001&&s.positions[i]<=512.0001);assert.ok(s.positions[i+2]>=-.0001&&s.positions[i+2]<=512.0001);}}
 const border=(ss,z)=>new Set(ss.flatMap(s=>{const out=[];for(let i=0;i<s.positions.length;i+=9){const on=[0,3,6].filter(j=>Math.abs(s.positions[i+j+2]-z)<1e-6);if(on.length>=2)for(const j of on)out.push(s.positions[i+j].toFixed(4)+','+s.positions[i+j+1].toFixed(4));}return out;}));
 assert.deepEqual(border(a,512),border(b,0));assert.ok(a[1].boxes.length+b[1].boxes.length>=7*8);
 const {buildTileObstacleIndex,WorldTileObstacles}=await import('../src/world-tile-obstacles.js'),empty={buildings:new Uint32Array(),buildingCorners:new Float32Array(),buildingHeights:new Float32Array()},walls=a[1].boxes,index=buildTileObstacleIndex(empty,walls),o=new WorldTileObstacles();
 o.install('17,35',{metadata:{origin:[0,0,0]},detailObstacleIndex:index});assert.ok(o.contact(walls[0]+.2*Math.cos(walls[3]),walls[1]+.5,walls[2]-.2*Math.sin(walls[3]),.5));o.setDetailEnabled(false);assert.equal(o.contact(walls[0],walls[1]+.5,walls[2],1),null);
});

test('offline lake refinement lowers the mapped pool without changing roads or either seam representation',async()=>{
 const {refineCoastalLakes}=await import('./world-gen/coastal-relief.mjs');
 const p=[],ix=[],flags=[];for(let z=0;z<=512;z+=16)for(let x=0;x<=512;x+=16)p.push(x,8+18*Math.exp(-((x-250)**2+(z-250)**2)/8000),z);
 for(let z=0;z<32;z++)for(let x=0;x<32;x++){const a=z*33+x;ix.push(a,a+33,a+1,a+1,a+33,a+34);flags.push(x<10?1:2,x<10?1:2);}
 const fine=Float32Array.from(p),arrays=[fine,Uint32Array.from(ix),Uint8Array.from(flags),Float32Array.from(p.filter((v,i)=>i%3===1)),new Uint32Array()],pack={arrays,metadata:{cell:[0,0],meshes:[{material:0,attributes:{position:{array:0}},userData:{worldSurface:true}}],tables:{finePositions:0,contactPositions:0,fineTriangles:1,fineFlags:2,coarseHeights:3,contactTriangles:4}}},before=Float32Array.from(fine),coarse=Float32Array.from(arrays[3]);
 const r={cover:[['lake','w-test',[[[128,128],[352,128],[352,352],[128,352]]]]]};const result=refineCoastalLakes(pack,r);assert.equal(result.lakes,1);assert.ok(result.vertices>20);assert.ok(result.waterArea>10000,'a pool, not a narrow strip');
 const refined=pack.arrays[0];assert.ok(refined.length>fine.length);for(let i=0;i<fine.length;i+=3)if(fine[i]<=160||fine[i]===512||fine[i+2]===0||fine[i+2]===512)assert.equal(refined[i+1],before[i+1],'road and border vertices unchanged');
 for(let i=0;i<33;i++)for(const j of [i,i*33,i*33+32,1056+i])assert.equal(arrays[3][j],coarse[j],'coarse seam unchanged');
});


test('lake render coalescing preserves contact arrays and keeps creased subdivisions',async()=>{
 const {coalesceLakeGround}=await import('../src/world-tile-coast.js');
 const make=()=>({metadata:{coastalLakes:[{}],meshes:[{material:0,userData:{worldSurface:true},attributes:{position:{array:0,itemSize:3}},index:1,drawRange:{start:0,count:12}}]},arrays:[Float32Array.of(0,0,0,4,0,0,0,0,4,2,0,0,2,0,2,0,0,2),Uint32Array.of(0,3,5,3,1,4,5,4,2,3,4,5)]});
 const flat=make(),contact=flat.arrays[1].slice();coalesceLakeGround(flat);assert.equal(flat.metadata.meshes[0].drawRange.count,3);assert.deepEqual(flat.arrays[1],contact);
 const crease=make();crease.arrays[0][3*3+1]=1;coalesceLakeGround(crease);assert.equal(crease.metadata.meshes[0].drawRange.count,12);
});
