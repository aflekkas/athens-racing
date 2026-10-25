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

// Frozen legacy narrow phase: deliberately independent of the production broad phase.
function legacyOverlap(a,b,clearance){
  const inside=(p,q)=>{let result=false;for(let i=0,j=q.length-1;i<q.length;j=i++){const u=q[i],v=q[j];if((u[1]>p[1])!==(v[1]>p[1])&&p[0]<(v[0]-u[0])*(p[1]-u[1])/(v[1]-u[1])+u[0])result=!result;}return result;};
  if(a.some(p=>inside(p,b))||b.some(p=>inside(p,a)))return true;
  const distance=(p,u,v)=>{const dx=v[0]-u[0],dz=v[1]-u[1],f=Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-u[0]-dx*f,p[1]-u[1]-dz*f);};
  const cross=(u,v,p)=>(v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]);
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const u=a[i],v=a[(i+1)%a.length],p=b[j],q=b[(j+1)%b.length];if(cross(u,v,p)*cross(u,v,q)<0&&cross(p,q,u)*cross(p,q,v)<0)return true;if(Math.min(distance(p,u,v),distance(q,u,v),distance(u,p,q),distance(v,p,q))<=clearance)return true;}
  return false;
}


function legacySafe({stream},p,{halfWidth=1,halfLength=2.5,clearance=.15}={}){
 const sin=Math.sin(p.yaw),cos=Math.cos(p.yaw),corners=[];
 for(const along of [-halfLength,0,halfLength])for(const across of [-halfWidth,0,halfWidth])corners.push([p.x-sin*along+cos*across,p.z-cos*along-sin*across]);
 const rectangle=[corners[0],corners[2],corners[8],corners[6]];
 for(const tile of stream.tiles.values())if(tile.state==='active'){
  const {metadata:m,tables:t}=tile.packet;
  for(let i=0;i<t.buildings.length;i+=4){const h=i/2;if(p.y+2<t.buildingHeights[h]||p.y>t.buildingHeights[h]+t.buildingHeights[h+1])continue;
   const polygon=[];for(let j=t.buildings[i+1];j<t.buildings[i+1]+t.buildings[i+2];j++)polygon.push([t.buildingCorners[j*2]+m.origin[0],t.buildingCorners[j*2+1]+m.origin[2]]);
   if(legacyOverlap(rectangle,polygon,clearance))return false;
  }
 }
 return true;
}
test('cache-denied broad phase matches frozen legacy oracle including nonfinite and degenerate geometry',()=>{
 let seed=1637;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(const mode of [{cache:false},{capBytes:1000},{}]){
  const f=fixture(mode);
  for(const origin of [-512,-1e12,1e12]){
   f.tile.packet.metadata.origin=[origin,0,origin];
   for(let i=0;i<1200;i++){
    const p={edge:'edge',x:origin-5+random()*480,z:origin-5+random()*480,y:[-2,0,8,10,11][i%5],yaw:random()*Math.PI*2};
    const options={halfWidth:[0,.8,1.6][i%3],halfLength:[0,2,6][i%3],clearance:[-.2,0,.15,.4][i%4]};
    assert.equal(f.roads.safe(p,options),legacySafe(f,p,options),JSON.stringify({mode,p,options}));
   }
  }
  f.tile.packet.metadata.origin=[-512,0,-512];
  for(const clearance of [NaN,Infinity,-Infinity,-.15,0,.15])for(const x of [-501.15,-500,-494,-492.85])for(const y of [-2,0,8,10,11]){
   const p={edge:'edge',x,z:-496,y,yaw:0};assert.equal(f.roads.safe(p,{clearance}),legacySafe(f,p,{clearance}));
  }
  for(const value of [NaN,Infinity,-Infinity])for(const key of ['x','z','yaw']){
   const p={edge:'edge',x:-490,z:-490,y:0,yaw:0,[key]:value};assert.equal(f.roads.safe(p),legacySafe(f,p));
  }
  for(const corners of [[],[NaN,0,1,0,1,1],[Infinity,0,1,0,1,1],[0,0],[0,0,1,0]]){
   f.tile.packet={metadata:{origin:[0,0,0]},tables:{buildings:Uint32Array.from([0,0,corners.length/2,0]),buildingCorners:Float64Array.from(corners),buildingHeights:Float32Array.from([0,8])}};
   for(const x of [0,100]){const p={edge:'edge',x,z:0,y:0,yaw:0};assert.equal(f.roads.safe(p),legacySafe(f,p));}
  }
  f.roads.dispose();assert.equal(f.stream.queryBytes,0);
 }
});
test('denied cache rejects distant polygons before the exact narrow phase without reservations',()=>{
 const f=fixture({cache:false}),p={edge:'edge',x:5000,z:5000,y:0,yaw:.4},hypot=Math.hypot;let calls=0;
 try{Math.hypot=(...args)=>{calls++;return hypot(...args)};assert.equal(legacySafe(f,p),true);assert.ok(calls>1000);calls=0;assert.equal(f.roads.safe(p),true);assert.equal(calls,0);
  const nearby={...p,x:-500-1.15,z:-496,yaw:0};calls=0;const actual=f.roads.safe(nearby);assert.ok(calls>0);assert.equal(actual,legacySafe(f,nearby));
 }finally{Math.hypot=hypot;f.roads.dispose()}
 assert.equal(f.stream.queryBytes,0);
});

test('full bounds cache admits a repeated connectivity query without rescanning graph or expanding its cap',()=>{
 const f=fixture();f.roads.queryCache.maxBytes=6000;
 assert.equal(f.roads.safe({edge:'edge',x:5000,z:5000,y:0,yaw:0}),true);
 assert.equal(f.roads.queryCache.buildings.size,1);
 const values=f.roads.graph.edges.values;let scans=0;f.roads.graph.edges.values=function(){scans++;return values.call(this)};
 const expected=[['road',0]];assert.deepEqual([...f.roads.connected(f.edge)],expected);
 assert.equal(f.roads.queryCache.buildings.size,0);assert.equal(f.roads.queryCache.connections.size,1);
 for(let i=0;i<1000;i++)assert.deepEqual([...f.roads.connected(f.edge)],expected);
 assert.equal(scans,1);assert.equal(f.roads.queryBytes,f.stream.queryBytes);assert.ok(f.roads.queryBytes<=6000);
 f.roads.graph.revision++;f.roads.connected(f.edge);assert.equal(scans,2);
 f.roads.dispose();assert.equal(f.stream.queryBytes,0);
});
test('connectivity pressure evicts old memos first, rejects oversized results without flushing, and terminates when stream denies admission',()=>{
 const f=fixture(),cache=f.roads.queryCache;cache.maxBytes=6000;
 assert.equal(f.roads.safe({edge:'edge',x:5000,z:5000,y:0,yaw:0}),true);
 // Leave a smaller bounds record alongside a connectivity record to verify priority.
 cache.clear();cache.maxBytes=2000;cache.bounds('empty-small',{packet:{metadata:{origin:[0,0,0]},tables:{buildings:Uint32Array.from([0,0,1,0]),buildingCorners:Float64Array.from([100,100])}}});
 const smallBounds=cache.buildings.get('empty-small');cache.rememberConnected(f.edge,new Map([['road',0]]));
 const old=cache.connections.get('edge');assert.ok(old);const other={...f.edge,id:'next'};cache.rememberConnected(other,new Map([['next-road',0]]));
 assert.equal(cache.connections.has('edge'),false);assert.ok(cache.connections.has('next'));assert.equal(cache.buildings.get('empty-small'),smallBounds);
 const before=cache.bytes,entries=cache.connections.size;cache.rememberConnected({...f.edge,id:'giant'},new Map([['x'.repeat(2000),0]]));assert.equal(cache.bytes,before);assert.equal(cache.connections.size,entries);cache.rememberConnected({...f.edge,id:'fits-alone'},new Map([['x'.repeat(450),0]]));assert.equal(cache.bytes,before);assert.equal(cache.connections.size,entries);
 // Mandatory residency leaves no room even after all optional entries go.
 f.stream.residentBytes=f.stream.capBytes-cache.baseBytes;cache.rememberConnected({...f.edge,id:'denied'},new Map([['denied',0]]));
 assert.equal(cache.connections.size,0);assert.equal(cache.buildings.size,0);assert.equal(cache.bytes,cache.baseBytes);assert.equal(cache.bytes,f.stream.queryBytes);
 cache.clear();assert.equal(f.stream.queryBytes,0);f.roads.dispose();
});
