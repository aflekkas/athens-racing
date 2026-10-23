import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TILE_TABLES,tileTables} from '../src/world-tile-format.js';
import {encodeTile} from './world-gen/pack.mjs';
import {buildTileObstacleIndex,WorldTileObstacles} from '../src/world-tile-obstacles.js';
import {COASTAL_DRESSING} from '../src/coastal-dressing-data.js';
import {deriveBuildingMeshes} from '../src/world-tile-buildings.js';
import {auditRepairedPacket,repairBuildingTables,repairPlanSha256,repairCodeProof,packFingerprint,buildingRowSha256,decodePinnedSourceCell,repairedSpool,makeInfillRepairPlan,applyReviewedInfillRepair} from './world-gen/repair-infill.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const code=await repairCodeProof();
function fixture(){
 const tables=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));
 tables.coarseHeights=Array(1089).fill(0);tables.finePositions=[0,0,0,512,0,0,0,0,512,512,0,512];tables.fineTriangles=[0,2,1,1,2,3];
 tables.nodes=[4,0,5,1];tables.nodePositions=[10,0,10,400,0,10];tables.edges=[6,4,5,0,2,0,1,30,0,7];tables.edgePoints=[10,0,10,400,0,10];tables.edgeLayers=[0];
 tables.anchors=[8,0,6,1,0];tables.anchorTransforms=[60,0,10,0];
 tables.buildings=[1,0,4,0,2,4,4,0,3,8,4,0];
 tables.buildingCorners=[100,100,100,110,110,110,110,100,300,300,300,310,310,310,310,300,200,200,200,210,210,210,210,200];
 tables.buildingHeights=[10,19.2,10,9.6,10,16];
 return encodeTile({metadata:{tileVersion:1,world:'fixture',revision:'test',cell:[0,0],origin:[0,0,0],ids:['','building:gen:1:2:3:4:5:0','building:w123:0','building:gen:2:3:4:5:6:0','node:1','node:2','road:1','surface:1','anchor:1'],strings:[''],palette:[[1,1,1]],meshes:[],terrain:{coarseSize:33,spacing:16},budgets:{triangles:30,buildingTriangles:10},extensions:{derivedBuildings:{version:1},worldDetail:{version:1,buildings:{facadeStyle:0,detailSeed:1,roofShape:2},vegetation:{positionHeight:3,kind:4,seed:5}}}},arrays:[{type:'Uint8Array',data:[1,2,3]},{type:'Uint32Array',data:[10,20,30]},{type:'Uint8Array',data:[1,2,3]},{type:'Float32Array',data:[]},{type:'Uint8Array',data:[]},{type:'Uint32Array',data:[]}],tables});
}
function planFor(pack){return {schema:1,operation:'remove-unsupported-generated-buildings',world:'fixture',revision:'test',cell:[0,0],packSha256:packFingerprint(pack),sourceCellSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),sourceRecordSha256:'c'.repeat(64),code,remove:[0,2].map(row=>({row,id:pack.metadata.ids[tileTables(pack).buildings[row*4]],rowSha256:buildingRowSha256(pack,row),decision:{eligible:false,reason:'source-sparse',inferred:true}}))};}
const expected=plan=>({planSha256:repairPlanSha256(plan),sourceCellSha256:plan.sourceCellSha256,sourceSha256:plan.sourceSha256,sourceRecordSha256:plan.sourceRecordSha256,code});
test('repair removes authoritative rows, remaps extensions and preserves every road/terrain/anchor byte',()=>{
 const pack=fixture().decoded,before=packFingerprint(pack),plan=planFor(pack),{pack:out,audit}=repairBuildingTables(pack,plan,expected(plan));
 assert.equal(packFingerprint(pack),before,'input immutable');
 const t=tileTables(out);assert.equal(t.buildings.length/4,1);assert.equal(out.metadata.ids[t.buildings[0]],'building:w123:0');
 assert.deepEqual([...t.buildingHeights],[10,Math.fround(9.6)]);assert.deepEqual(audit.rowMap,[-1,0,-1]);
 for(const key of Object.keys(TILE_TABLES).filter(k=>!k.startsWith('building')))assert.deepEqual(t[key],tileTables(pack)[key],key);
 for(const [key,want]of [['facadeStyle',2],['detailSeed',20],['roofShape',2]])assert.deepEqual([...out.arrays[out.metadata.extensions.worldDetail.buildings[key]]],[want]);
 assert.equal(out.metadata.budgets.triangles,10);assert.equal(audit.buildingWallSegments,4);
 assert.equal(audit.protectedTablesByteExact,true);assert.equal(audit.retainedWallsByteExact,true);
 const roundtrip=encodeTile(repairedSpool(out)).decoded;assert.deepEqual(tileTables(roundtrip).buildings,t.buildings);
});
test('rendered walls and collider CSR come from the same retained rows, without invisible old colliders',()=>{
 const pack=fixture().decoded,plan=planFor(pack),out=repairBuildingTables(pack,plan,expected(plan)).pack,t=tileTables(out);
 const index=buildTileObstacleIndex(t);assert.equal(index.segments.length/6,4);
 const obstacles=new WorldTileObstacles();obstacles.install('0,0',{metadata:out.metadata,obstacleIndex:index});
 assert.equal(obstacles.contact(100,10,105,.5),null);assert.equal(obstacles.contact(200,10,205,.5),null);
 assert.ok(obstacles.contact(300,10,305,.5));
 const derived=deriveBuildingMeshes(t,out.metadata);assert.equal(derived.extra.rings.length,1);assert.equal(Math.min(...derived.extra.rings[0].map(p=>p[0])),300);assert.equal(Math.max(...derived.extra.rings[0].map(p=>p[0])),310);
 assert.ok(index.refs.every(i=>i<4));assert.equal(index.offsets.at(-1),index.refs.length);obstacles.dispose();
});
test('compressed source cell hash, size, identity and full original table fingerprints fail closed',()=>{
 const encoded=fixture(),entry={bytes:encoded.bytes.length,sha256:digest(encoded.bytes)},identity={world:'fixture',revision:'test',cell:[0,0]};
 assert.equal(packFingerprint(decodePinnedSourceCell(encoded.bytes,entry,identity)),packFingerprint(encoded.decoded));
 assert.throws(()=>decodePinnedSourceCell(encoded.bytes,{...entry,sha256:'d'.repeat(64)},identity),/hash\/size/);
 assert.throws(()=>decodePinnedSourceCell(encoded.bytes,entry,{...identity,revision:'other'}),/revision mismatch/);
 const pack=fixture().decoded,plan=planFor(pack);tileTables(pack).coarseHeights[0]=1;
 assert.throws(()=>repairBuildingTables(pack,plan,expected(plan)),/full input cell identity/);
});
test('plan/source/code mismatch, mapped IDs, duplicates and source-supported infill are refused',()=>{
 for(const mutate of [p=>p.sourceSha256='d'.repeat(64),p=>p.code={...p.code,'model.py':'e'.repeat(64)},p=>p.remove[0].id='building:w123:0',p=>p.remove.push(p.remove[0]),p=>p.remove[0].decision.eligible=true,p=>p.remove[0].rowSha256='e'.repeat(64)]){
  const pack=fixture().decoded,p=planFor(pack),pin=expected(p);mutate(p);
  assert.throws(()=>repairBuildingTables(pack,p,pin),/plan digest/);
  const nextPin=expected(p);if(p.sourceSha256==='d'.repeat(64))nextPin.sourceSha256='b'.repeat(64);
  assert.throws(()=>repairBuildingTables(pack,p,nextPin),/mismatch|unsupported|duplicate/);
 }
});
test('prepared dressing, unsupported row extensions and authored/coastal cells cannot be repaired',()=>{
 for(const mutate of [p=>{p.metadata.extensions.derivedBuildings.derived=true;p.metadata.budgets.triangles=0;},p=>p.metadata.extensions.worldDetail.parking=3,p=>p.metadata.authoredObstacles=[],p=>p.metadata.extensions.worldDetail.buildings.unknown=0,p=>{p.metadata.cell=Object.keys(COASTAL_DRESSING.cells)[0].split(',').map(Number);p.metadata.origin=[p.metadata.cell[0]*512,0,p.metadata.cell[1]*512];}]){
  const pack=fixture().decoded;mutate(pack);const plan=planFor(pack);
  assert.throws(()=>repairBuildingTables(pack,plan,expected(plan)),/unsupported|requires|protected|unknown/);
 }
});
const python=process.env.WORLD_GEN_PYTHON||'python3';
const ready=spawnSync(python,['-c','import shapely,osmium; from shapely import constrained_delaunay_triangles']).status===0;
test('read-only source plan validates complete context and source/hash proof before pure repair',{skip:!ready&&'set WORLD_GEN_PYTHON to world-gen venv'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'infill-repair-'));
 try{
  const sourcePath=join(root,'source.osm'),source='<osm version="0.6" generator="infill-regression"></osm>',sourceSha=digest(source),sourceRecord={sha256:sourceSha,bounds:[23.72,37.97,23.74,37.99],missingWayNodes:[]};
  await writeFile(sourcePath,source);await writeFile(join(root,'source.source.json'),JSON.stringify(sourceRecord));
  const encoded=fixture(),pack=encoded.decoded,sourceCellSha256=digest(encoded.bytes),ids=[pack.metadata.ids[1],pack.metadata.ids[3]];
  const plan=await makeInfillRepairPlan(pack,{sourcePath,expectedSourceSha256:sourceSha,sourceCellSha256,ids,python});
  assert.equal(plan.remove.length,2);assert.ok(plan.remove.every(r=>r.decision.reason==='source-sparse'));
  assert.equal((await applyReviewedInfillRepair(pack,plan,{reviewedPlanSha256:repairPlanSha256(plan),sourcePath,sourceCellSha256})).audit.removed.length,2);
  await writeFile(sourcePath,source+' ');
  await assert.rejects(applyReviewedInfillRepair(pack,plan,{reviewedPlanSha256:repairPlanSha256(plan),sourcePath,sourceCellSha256}),/source identity mismatch/);
  await writeFile(sourcePath,source);sourceRecord.bounds=[23.73,37.979,23.731,37.98];await writeFile(join(root,'source.source.json'),JSON.stringify(sourceRecord));
  await assert.rejects(makeInfillRepairPlan(pack,{sourcePath,expectedSourceSha256:sourceSha,sourceCellSha256,ids,python}),/full candidate context/);
  for(const [bad,unresolved,error] of [
   ['<osm version="0.6"><node id="1" lat="37.98" lon="23.73"/><node id="2" lat="37.98" lon="23.731"/><way id="1"><nd ref="1"/><nd ref="2"/><tag k="building" v="yes"/></way></osm>',[],/Unclosed source area/],
   ['<osm version="0.6"><relation id="9"><member type="way" ref="999" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation></osm>',[{relation:'9'}],/Incomplete relevant source relation/],
  ]){
   const badSha=digest(bad);await writeFile(sourcePath,bad);await writeFile(join(root,'source.source.json'),JSON.stringify({sha256:badSha,bounds:[23.72,37.97,23.74,37.99],missingWayNodes:[],unresolvedRelationMembers:unresolved}));
   await assert.rejects(makeInfillRepairPlan(pack,{sourcePath,expectedSourceSha256:badSha,sourceCellSha256,ids,python}),error);
  }

 }finally{await rm(root,{recursive:true,force:true});}
});

test('post-packer audit rejects invisible colliders and generated body resurrection',()=>{
 const original=fixture().decoded,plan=planFor(original),out=repairBuildingTables(original,plan,expected(plan)).pack;
 const packet={...structuredClone(out),obstacleIndex:buildTileObstacleIndex(tileTables(out))};
 assert.equal(auditRepairedPacket(out,packet,plan.remove.map(r=>r.id)).colliderMatchesVisibleBuildingsAndParking,true);
 packet.obstacleIndex=buildTileObstacleIndex(tileTables(original));
 assert.throws(()=>auditRepairedPacket(out,packet,plan.remove.map(r=>r.id)),/collider\/visible parking/);
 assert.throws(()=>auditRepairedPacket(out,{...original,obstacleIndex:buildTileObstacleIndex(tileTables(original))},plan.remove.map(r=>r.id)),/authoritative table changed|reappeared/);
});

async function sourcePlanForXml(source){
 const root=await mkdtemp(join(tmpdir(),'infill-relation-'));
 try{
  const sourcePath=join(root,'source.osm'),sourceSha=digest(source),encoded=fixture();
  await writeFile(sourcePath,source);
  // Deliberately no unresolved-member hints: assembly must be checked independently.
  await writeFile(join(root,'source.source.json'),JSON.stringify({sha256:sourceSha,bounds:[23.72,37.97,23.74,37.99],missingWayNodes:[]}));
  return await makeInfillRepairPlan(encoded.decoded,{sourcePath,expectedSourceSha256:sourceSha,sourceCellSha256:digest(encoded.bytes),ids:[encoded.decoded.metadata.ids[1]],python});
 }finally{await rm(root,{recursive:true,force:true});}
}
for(const [name,body]of [
 ['empty relevant building multipolygon','<relation id="10"><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>'],
 ['relevant building relation with an empty child relation','<relation id="11"><tag k="type" v="multipolygon"/></relation><relation id="10"><member type="relation" ref="11" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>'],
])test('source assembly rejects '+name+' without provenance closure hints',{skip:!ready&&'set WORLD_GEN_PYTHON to world-gen venv'},async()=>{
 await assert.rejects(sourcePlanForXml('<osm version="0.6">'+body+'</osm>'),/Unassembled relevant source areas|Nested relevant source relations are unsupported/);
});
test('assembled relevant relation remains usable beside an unrelated empty relation',{skip:!ready&&'set WORLD_GEN_PYTHON to world-gen venv'},async()=>{
 const source='<osm version="0.6"><node id="1" lat="37.979" lon="23.731"/><node id="2" lat="37.979" lon="23.7311"/><node id="3" lat="37.9791" lon="23.7311"/><node id="4" lat="37.9791" lon="23.731"/><way id="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/></way><relation id="10"><member type="way" ref="1" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation><relation id="11"><tag k="type" v="multipolygon"/></relation></osm>';
 const plan=await sourcePlanForXml(source);assert.equal(plan.remove.length,1);assert.equal(plan.remove[0].decision.reason,'source-sparse');
});

const validOuterWay='<node id="1" lat="37.979" lon="23.731"/><node id="2" lat="37.979" lon="23.7311"/><node id="3" lat="37.9791" lon="23.7311"/><node id="4" lat="37.9791" lon="23.731"/><way id="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/></way>';
const relevantWithNested=(child,role)=>'<osm version="0.6">'+validOuterWay+child+'<relation id="10"><member type="way" ref="1" role="outer"/><member type="relation" ref="11" role="'+role+'"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation></osm>';
test('valid outer building way plus empty untagged inner relation fails closed',{skip:!ready&&'set WORLD_GEN_PYTHON to world-gen venv'},async()=>{
 const source=relevantWithNested('<relation id="11"><tag k="type" v="multipolygon"/></relation>','inner');
 await assert.rejects(sourcePlanForXml(source),/Nested relevant source relations are unsupported/);
});

test('nested source members are outside deletion scope for every role and child state',{skip:!ready&&'set WORLD_GEN_PYTHON to world-gen venv'},async()=>{
 const children={
  missing:'',
  empty:'<relation id="11"><tag k="type" v="multipolygon"/></relation>',
  invalid:'<way id="2"><nd ref="1"/><nd ref="2"/></way><relation id="11"><member type="way" ref="2" role="outer"/><tag k="type" v="multipolygon"/></relation>',
  valid:'<relation id="11"><member type="way" ref="1" role="outer"/><tag k="type" v="multipolygon"/></relation>',
 };
 for(const [state,child]of Object.entries(children))for(const role of ['inner','outer','','label','invalid']){
  await assert.rejects(sourcePlanForXml(relevantWithNested(child,role)),/Nested relevant source relations are unsupported/,state+' child with '+JSON.stringify(role)+' role');
 }
});
test('unrelated nested and missing-member relations do not block an assembled relevant area',{skip:!ready&&'set WORLD_GEN_PYTHON to world-gen venv'},async()=>{
 for(const child of ['', '<relation id="21"><tag k="type" v="multipolygon"/></relation>']){
  const source='<osm version="0.6">'+validOuterWay+'<relation id="10"><member type="way" ref="1" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>'+child+'<relation id="20"><member type="way" ref="1" role="outer"/><member type="relation" ref="21" role="inner"/><tag k="type" v="multipolygon"/></relation></osm>';
  const plan=await sourcePlanForXml(source);assert.equal(plan.remove.length,1);assert.equal(plan.remove[0].decision.reason,'source-sparse');
 }
});
