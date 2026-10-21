import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRockBores} from './world-bore-audit.mjs';
import {projectRoute,coverage} from './riviera-world-coverage.mjs';
test('cell-owned safety collision requires finite bounded walls and visible geometry',()=>{
 const pack={metadata:{safetyRails:[[1,10,2,1,10,200,.86]],meshes:[{userData:{coastGuard:true}}]},arrays:[]};
 assert.equal(auditRockBores(pack).passed,true);
 pack.metadata.meshes=[];assert.equal(auditRockBores(pack).passed,false);
 pack.metadata.meshes=[{userData:{coastGuard:true}}];pack.metadata.safetyRails[0][3]=513;assert.equal(auditRockBores(pack).passed,false);
 pack.metadata.safetyRails[0][3]=NaN;assert.equal(auditRockBores(pack).passed,false);
});
test('coverage reports per-kilometre cell gaps separately from asphalt gaps',()=>{
 const points=[{s:0,x:10,z:10},{s:1000,x:600,z:10},{s:2000,x:1100,z:10}];
 const c=coverage(points,new Set(['0,0','1,0']));assert.deepEqual(c.missingCells,['2,0']);assert.equal(c.perKm[1].cellPercent,100);assert.deepEqual(c.gaps,[{fromMetres:2000,toMetres:2000,cells:['2,0']}]);
 const asphalt=coverage(points,new Set(['0,0','1,0','2,0']),new Map([['0,0',()=>({y:1})]]));assert.equal(asphalt.cellPercent,100);assert.equal(asphalt.asphaltSamples,1);assert.equal(asphalt.gaps[0].fromMetres,1000);
 const projected=projectRoute({proj:{lat0:37.98,lon0:23.73,mlon:87745.27512677578,mlat:111320},route:{step:2,x:[512],z:[1024]}});assert.ok(Math.abs(projected[0].x-512)<1e-8);assert.ok(Math.abs(projected[0].z-1024)<1e-8);
});

function boreFixture(){
 const arrays=[],tables={},put=(name,array)=>{tables[name]=arrays.push(array)-1;};
 put('contactPositions',new Float32Array([250,0,99,250,0,201,262,0,99,262,0,201]));
 put('contactTriangles',new Uint32Array([0,1,2,1,1,1,3,2,1,1]));put('contactLayers',new Int8Array([-1,-1]));
 put('finePositions',new Float32Array());put('fineTriangles',new Uint32Array());put('coarseHeights',new Float32Array(1089).fill(NaN));
 put('edges',new Uint32Array([1,0,0,0,2,0,2,50,4,1]));put('edgeLayers',new Int8Array([-1]));
 const roof=arrays.push(new Float32Array([250,5,99,250,5,201,262,5,99,262,5,201]))-1,index=arrays.push(new Uint16Array([0,1,2,1,3,2]))-1;
 return {arrays,metadata:{tables,ids:['','surface:w25371523:0'],tunnelBores:[{id:'w25371523:0',sourceWay:'w25371523',layer:-1,width:7,minimumClearance:5,axis:[[256,0,100],[256,0,200]]}],safetyRails:[[251.7,0,99,251.7,0,201,3.6],[260.3,0,99,260.3,0,201,3.6]],meshes:[{userData:{rockBore:true},attributes:{position:{array:roof}},index}]}};
}
test('bore gate measures full-carriageway emitted roof and rejects low or absent roofs',()=>{
 const p=boreFixture(),good=auditRockBores(p);assert.equal(good.passed,true);assert.ok(good.samples>300);assert.ok(Math.abs(good.minimumClearance-5)<1e-9);
 const roof=p.arrays[p.metadata.meshes[0].attributes.position.array];for(let i=1;i<roof.length;i+=3)roof[i]=4.4;
 assert.equal(auditRockBores(p).passed,false);p.metadata.meshes=[];assert.equal(auditRockBores(p).passed,false);
});
test('bore gate rejects missing side walls and a lost source layer in the graph',()=>{
 const p=boreFixture();p.metadata.safetyRails.pop();assert.equal(auditRockBores(p).passed,false);
 const q=boreFixture();q.arrays[q.metadata.tables.edgeLayers][0]=0;assert.equal(auditRockBores(q).passed,false);
});

test('natural coastal cliffs retain protection after the emitted shoulder is conformed flat',async t=>{
 const {spawnSync}=await import('node:child_process'),python=process.env.WORLD_GEN_PYTHON||'python3';
 if(spawnSync(python,['-c','import shapely']).status!==0){t.skip('shapely is not installed');return;}
 const script=String.raw`
import sys
from types import SimpleNamespace
sys.path.insert(0,'tools/world-gen')
from shapely.geometry import LineString,box
import riviera_safety as safety
line=LineString([(4500,18000),(4500,18200)])
safety._DATA=({'marks':[],'zones':[{'s':0,'urban':0}],'barriers':[]},line,[])
road=dict(id='w1:0',highway='primary',tunnel=False,line=line,polygon=line.buffer(3.5),width=7,section={'sidewalk':{'left':2.5,'right':2.5}},fromNode='a',toNode='b',points=list(line.coords))
field=SimpleNamespace(roads=[road],ground_roads=[road],dem=SimpleNamespace(height=lambda x,z:0),coast=SimpleNamespace(land=box(4400,17000,4600,19000),baseline=lambda x,z,y:y))
steel,indices,concrete,ci,rails=safety.build(field,(8,35),lambda x,z:20)
assert indices and len(rails)>100, 'the shoulder solve must not erase protection from a natural cliff'
assert all(r[1]==20 and r[4]==20 for r in rails), 'visible and collision rails stay on the emitted surface'
`;
 const result=spawnSync(python,['-c',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);
});
