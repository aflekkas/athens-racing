import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldTileRoads} from '../../src/world-tile-roads.js';
import {WorldTileStream} from '../../src/world-tile-stream.js';
function fixture({cache=true,capBytes=1024*1024}={}){
 const rows=[],corners=[],heights=[];
 for(let z=0;z<12;z++)for(let x=0;x<12;x++){const first=corners.length/2,px=12+x*38,pz=12+z*38;rows.push(0,first,4,0);corners.push(px,pz,px+6,pz,px+6,pz+8,px,pz+8);heights.push((x+z)%3,8);}
 const tile={state:'active',packet:{metadata:{origin:[-512,0,-512]},tables:{buildings:new Uint32Array(rows),buildingCorners:new Float64Array(corners),buildingHeights:new Float32Array(heights)}}};
 const stream={tiles:new Map([['-1,-1',tile]]),capBytes,residentBytes:0,reservedBytes:0,queryBytes:0,metrics:{},disposed:false,contact:(x,z,{referenceY=0}={})=>({surfaceId:'road',layer:0,y:referenceY}),reserveQueryBytes:cache?WorldTileStream.prototype.reserveQueryBytes:()=>false,releaseQueryBytes:WorldTileStream.prototype.releaseQueryBytes};
 const roads=new WorldTileRoads(stream),edge={id:'edge',surface:'road',layer:0,from:'a',to:'b',flags:0,points:[[0,0,0],[0,0,100]]};roads.graph.edges.set(edge.id,{value:edge,refs:1});roads.graph.revision++;
 return{roads,stream,tile,edge};
}
test('cached footprint checks exactly match uncached predicates across negative cells, boundaries, heights and rotations',()=>{
 const a=fixture(),b=fixture({cache:false});let checks=0;
 for(let i=0;i<2500;i++){const p={edge:'edge',x:-520+(i*37%550),z:-520+(i*71%550),y:i%7===0?11:0,yaw:i*.719};const options={halfWidth:[.8,1.1,1.6][i%3],halfLength:[2,3,6][i%3],clearance:[0,.15,.4][i%3],connected:!!(i%2)};assert.equal(a.roads.safe(p,options),b.roads.safe(p,options),JSON.stringify({p,options}));checks++;}
 for(const x of [-500.15,-500,-494,-493.85,-.15,0,.15])for(const z of [-500.15,-500,-492,-491.85]){const p={edge:'edge',x,z,y:0,yaw:0};assert.equal(a.roads.safe(p),b.roads.safe(p));checks++;}
 assert.ok(a.roads.queryBytes>0);assert.equal(a.roads.queryBytes,a.stream.queryBytes);assert.ok(a.roads.queryBytes<=256*1024);assert.equal(b.stream.queryBytes,0);a.roads.dispose();assert.equal(a.stream.queryBytes,0);assert.ok(checks>2500);
});
test('packet/table replacement and eviction invalidate building bounds; connected results cannot poison revision-bound memo',()=>{
 const {roads,stream,tile,edge}=fixture(),p={edge:'edge',x:-497,y:0,z:-497,yaw:0};assert.equal(roads.safe(p),false);const before=roads.queryBytes;
 tile.packet={...tile.packet,tables:{...tile.packet.tables,buildingCorners:Float64Array.from(tile.packet.tables.buildingCorners,n=>n+1000)}};
 assert.equal(roads.safe(p),true);assert.equal(roads.queryBytes,before);
 const connected=roads.connected(edge);connected.set('spoof',9);assert.equal(roads.connected(edge).has('spoof'),false);
 const next={...edge,id:'next',from:'b',to:'c',surface:'junction',points:[[0,0,100],[0,0,200]]};roads.graph.edges.set(next.id,{value:next,refs:1});roads.graph.revision++;assert.equal(roads.connected(edge).get('junction'),0);
 roads.graph.edges.delete(next.id);roads.graph.revision++;assert.equal(roads.connected(edge).has('junction'),false);
 stream.tiles.delete('-1,-1');roads.queryCache.sync(roads.graph);assert.equal(roads.queryCache.buildings.size,0);roads.dispose();assert.equal(stream.queryBytes,0);
});
test('cache pressure falls back to all buildings without exceeding the existing stream cap or allocating bounds',()=>{
 const a=fixture({capBytes:1000}),b=fixture({cache:false});for(let i=0;i<80;i++){const p={edge:'edge',x:-500+i*3,z:-500,y:0,yaw:.4};assert.equal(a.roads.safe(p,{connected:true}),b.roads.safe(p,{connected:true}));}assert.equal(a.roads.queryBytes,0);assert.equal(a.roads.queryCache.buildings,null);
 const c=fixture();for(let i=0;i<2000;i++){const e={...c.edge,id:'long-edge-'+i};c.roads.connected(e);}assert.ok(c.roads.queryBytes<=256*1024);assert.ok(c.stream.queryBytes+c.stream.residentBytes+c.stream.reservedBytes<=c.stream.capBytes);c.roads.clearQueryCache();assert.equal(c.stream.queryBytes,0);
});
test('stream admission frees optional query reservations before mandatory tiles and clears cache on disposal',()=>{
 const manifest={tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn'},tiles:{'0,0':{url:'x',sha256:'0'.repeat(64),bytes:1,decodedBytes:100,triangles:0,dependencies:[]}}};
 const stream=new WorldTileStream(manifest,{capBytes:100,nearRing:0,safetyRing:0,load:()=>new Promise(()=>{})});assert.equal(stream.reserveQueryBytes(20),true);assert.equal(stream.reserveQueryBytes(81),false);let clears=0;stream.roads={clearQueryCache(){clears++;stream.releaseQueryBytes(stream.queryBytes);}};stream.update({x:1,z:1});assert.equal(clears,1);assert.equal(stream.queryBytes,0);assert.equal(stream.reservedBytes,100);stream.dispose();assert.equal(stream.queryBytes,0);assert.equal(stream.reservedBytes,0);
});

test('public anchor iteration remains independent of footprint-query local variables',()=>{const {roads,stream,tile}=fixture();tile.packet.metadata.ids=['anchor'];tile.packet.tables.anchors=new Uint32Array([0,0,0,2,0]);stream.anchor=id=>({x:-450,y:0,z:-450,edge:'edge',yaw:0});assert.deepEqual([...roads.anchors({kind:2,validate:false})],[{x:-450,y:0,z:-450,edge:'edge',yaw:0,id:'anchor'}]);roads.dispose();});
