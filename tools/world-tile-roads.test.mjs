import{test}from'node:test';import assert from'node:assert/strict';
import{WorldTileRoads}from'../src/world-tile-roads.js';import{WorldTileStream}from'../src/world-tile-stream.js';import{buildTileContactIndex}from'../src/world-tile-contact.js';import{tileTables}from'../src/world-tile-format.js';import{fixture}from'./world-tile-format.test.mjs';
function setup(){
 const p=fixture(),set=(k,a)=>p.arrays[p.metadata.tables[k]]=a;p.metadata.ids=['','a','b','f','r','road'];
 set('nodePositions',new Float32Array([0,0,10,100,0,10]));set('nodes',new Uint32Array([1,0,2,1]));
 set('edges',new Uint32Array([3,1,2,0,2,0,1,30,0,5,4,2,1,2,2,0,1,30,0,5]));set('edgePoints',new Float32Array([0,0,10,100,0,10,100,0,10,0,0,10]));set('edgeLayers',new Int8Array(2));
 // Narrows from 10 m to 4 m over 100 m: width must be station-local.
 set('contactPositions',new Float32Array([0,0,5,0,0,15,100,0,8,100,0,12]));set('contactTriangles',new Uint32Array([0,1,2,5,1,1,3,2,5,1]));set('contactLayers',new Int8Array(2));
 const m={tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn'},tiles:{'0,0':{url:'x',sha256:'0'.repeat(64),bytes:1,decodedBytes:100000,triangles:0,dependencies:[]}}};
 const stream=new WorldTileStream(m,{load:async()=>null});const packet={...p,tables:tileTables(p),contactIndex:buildTileContactIndex(tileTables(p)),bytes:100};stream.tiles.set('0,0',{state:'active',packet,bytes:100,controller:new AbortController()});stream.residentBytes=100;const roads=new WorldTileRoads(stream);roads.graph.install('0,0',packet);return{p,set,stream,roads};
}
test('traffic width follows local canonical contact boundaries, independent of directional lane count',()=>{
 const {roads}=setup(),point={edge:'f',x:10,y:0,z:10,yaw:-Math.PI/2};assert.ok(Math.abs(roads.width(point).width-9.4)<1e-6);assert.ok(Math.abs(roads.width({...point,x:90}).width-4.6)<1e-6);
 const shifted={...point,z:11};const a=roads.width(shifted),b=roads.width({...shifted,edge:'r',yaw:Math.PI/2});assert.ok(Math.abs(a.left-b.right)<1e-6);assert.ok(Math.abs(a.right-b.left)<1e-6);assert.ok(roads.safe(point));assert.equal(roads.safe({...point,z:14.8}),false);assert.equal(roads.width({...point,x:200}),null);
});
test('traffic holds before finite fixture boundaries and rejects a building crossing its footprint',()=>{
 const {roads,set}=setup(),p={edge:'f',x:20,y:0,z:10,yaw:-Math.PI/2};assert.ok(roads.advance(p,1));assert.equal(roads.advance({...p,x:99},2),null);
 set('buildings',new Uint32Array([1,0,4,0]));set('buildingCorners',new Float32Array([19,9,19,11,21,11,21,9]));set('buildingHeights',new Float32Array([0,10]));roads.stream.tiles.get('0,0').packet.tables=tileTables(roads.stream.tiles.get('0,0').packet);assert.equal(roads.safe(p),false);
});
test('graph activation is transactional and eviction removes routing ownership exactly once',()=>{
 const {roads,p}=setup();roads.graph.dispose();let disposed=0,committed=0;const adapter=roads.adapter({prepare(){return{steps:[][Symbol.iterator](),commit(){committed++;},dispose(){disposed++;}};}}),b=adapter.prepare('0,0',p,{});b.commit();assert.equal(roads.graph.edges.size,2);b.dispose();b.dispose();assert.equal(roads.graph.edges.size,0);assert.equal(disposed,1);assert.equal(committed,1);
 const fail=roads.adapter({prepare(){return{steps:[][Symbol.iterator](),commit(){throw new Error('scene failed');},dispose(){}};}}).prepare('0,0',p,{});assert.throws(()=>fail.commit(),/scene failed/);assert.equal(roads.graph.edges.size,0);
});
test('GPS includes restrictions on the first and final partial directed edges',()=>{
 const {roads,set,p,stream}=setup();roads.graph.dispose();p.metadata.ids.push('c','next');set('nodes',new Uint32Array([1,0,2,1,6,2]));set('nodePositions',new Float32Array([0,0,10,100,0,10,100,0,100]));set('edges',new Uint32Array([3,1,2,0,2,0,1,30,0,5,7,2,6,2,2,0,1,30,0,5]));set('edgePoints',new Float32Array([0,0,10,100,0,10,100,0,10,100,0,100]));set('turns',new Uint32Array([3,2,7,1]));const pack={...p,tables:tileTables(p)};roads.graph.install('0,0',pack);assert.equal(roads.gps({x:10,y:0,z:10},{x:100,y:0,z:80}),null);roads.graph.dispose();set('turns',new Uint32Array());roads.graph.install('0,0',{...p,tables:tileTables(p)});assert.deepEqual(roads.gps({x:10,y:0,z:10},{x:100,y:0,z:80}).edges,['f','next']);stream.dispose();
});
