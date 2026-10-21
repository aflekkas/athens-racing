import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldTileStream, TileResources } from '../src/world-tile-stream.js';
import { buildTileContactIndex, sampleTileContact } from '../src/world-tile-contact.js';
import { fixture } from './world-tile-format.test.mjs';
import { tileTables } from '../src/world-tile-format.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function manifest(n=8){
  const tiles={};for(let x=0;x<n;x++)tiles[`${x},0`]={url:`${x}.bin.gz`,sha256:'0'.repeat(64),bytes:10,decodedBytes:100,dependencies:[],triangles:0};
  return {tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn:0'},tiles};
}
function packet(cell){const p=fixture(cell);const t=tileTables(p);return {...p,bytes:80,contactIndex:buildTileContactIndex(t)};}
function adapter(){let disposed=0,committed=0;return {prepare(){return {steps:(function*(){yield;yield;})(),commit(){committed++;},dispose(){disposed++;}};},get disposed(){return disposed;},get committed(){return committed;}};}
async function settle(s,n=5){for(let i=0;i<n;i++){await tick();s.activateFrame();}}
test('menu construction is caller-owned; worker pool is lazy, rings and velocity prefetch respect byte caps',async()=>{
  const jobs=[],a=adapter(),s=new WorldTileStream(manifest(),{load:async job=>{jobs.push(job.cell[0]);return packet(job.cell);},adapter:a,capBytes:330,transientBytes:500,nearRing:0});
  assert.equal(s.tiles.size,0);assert.equal(s.pool,null);
  s.update({x:10,z:10,vx:70});await settle(s,10);
  assert.deepEqual(jobs.slice(0,2),[0,1]);assert.ok(jobs.includes(2));assert.ok(!jobs.includes(5));
  assert.ok(s.residentBytes+s.reservedBytes<=330);assert.ok(s.readyAt(10,10));assert.equal(s.contact(10,10).y,0);
  s.dispose();assert.equal(s.residentBytes,0);assert.equal(a.disposed,a.committed);
});
test('stale transferred results cannot activate after movement or disposal',async()=>{
  const pending=[],s=new WorldTileStream(manifest(),{nearRing:0,load:(job,signal)=>new Promise(resolve=>pending.push({job,signal,resolve})),adapter:adapter(),capBytes:500});
  s.spawnRelease();s.update({x:10,z:10});await tick();s.update({x:3000,z:10});
  assert.equal(pending[0].signal.aborted,true);pending[0].resolve(packet([0,0]));await settle(s,1);
  assert.equal(s.readyAt(10,10),false);s.dispose();for(const p of pending)p.resolve(packet(p.job.cell));await tick();assert.equal(s.residentBytes,0);assert.equal(s.reservedBytes,0);
});
test('spawn and ref-counted tow pins survive eviction; unpinned distant cells release resources',async()=>{
  const a=adapter(),s=new WorldTileStream(manifest(),{load:async j=>packet(j.cell),adapter:a,capBytes:260,nearRing:0});
  const p=s.pin('tow','1,0'),q=s.pin('tow','1,0');s.update({x:520,z:10});await settle(s);
  p();assert.ok(s.pins.has('1,0'));q();assert.ok(!s.pins.has('1,0'));
  s.update({x:1550,z:10});await settle(s);assert.equal(s.readyAt(10,10),true);assert.equal(s.readyAt(520,10),true);
  s.update({x:2070,z:10});await settle(s);assert.ok(s.metrics.evictions>0);assert.equal(s.readyAt(10,10),true);
  s.dispose();assert.equal(s.residentBytes,0);
});
test('activation is incremental and target is moved only after complete activation',async()=>{
  let time=0,moved=false,steps=0;
  const a={prepare(){return {steps:(function*(){for(let i=0;i<6;i++){steps++;time++;yield;}})(),commit(){},dispose(){}};}};
  const s=new WorldTileStream(manifest(),{load:async j=>packet(j.cell),adapter:a,now:()=>time,activationMs:2,nearRing:0});
  s.update({x:1,z:1});await tick();s.activateFrame();assert.equal(steps,2);assert.equal(s.readyAt(1,1),false);
  await s.teleport({x:1025,z:1},()=>{assert.ok(s.readyAt(1025,1));moved=true;},{nextFrame:tick});assert.equal(moved,true);assert.ok(!s.pins.has('2,0'));s.dispose();
});
test('failed loads retry twice; reservations are released and explicit retry recovers',async()=>{
  let time=0,fail=true,loads=0;const s=new WorldTileStream(manifest(1),{now:()=>time,nearRing:0,load:async j=>{loads++;if(fail)throw new Error('corrupt');return packet(j.cell);}});
  for(let i=0;i<5;i++){s.update({x:1,z:1});await tick();time+=2000;}
  assert.equal(loads,3);assert.equal(s.reservedBytes,0);assert.equal(s.contact(1,1),null);
  fail=false;s.retry('0,0');await settle(s);assert.ok(s.readyAt(1,1));s.dispose();
});
test('floating origin stays on the grid over 30 km without changing logical cell IDs',async()=>{
  const changes=[],s=new WorldTileStream(manifest(),{nearRing:0,load:async j=>packet(j.cell),adapter:{rebase:o=>changes.push(o)}});
  s.update({x:35000,z:-35000});assert.ok(Math.abs(35000-s.origin.x)<512);assert.ok(Math.abs(-35000-s.origin.z)<512);assert.equal(s.origin.x%512,0);assert.equal(changes.length,1);s.dispose();await tick();
});
test('shared resources dispose once after the last owner releases',()=>{
  let disposed=0;const r=new TileResources(),create=()=>({dispose(){disposed++;}});const a=r.acquire('road',create,100),b=r.acquire('road',create,100);assert.equal(a,b);assert.equal(r.bytes,100);r.release('road');assert.equal(disposed,0);r.release('road');assert.equal(disposed,1);assert.equal(r.bytes,0);
});
test('layered contacts choose bridge, tunnel or ground by height and explicit layer',()=>{
  const p=fixture(),t=tileTables(p);t.contactPositions=new Float32Array([0,10,0,512,10,0,0,10,512,0,-10,0,512,-10,0,0,-10,512]);t.contactTriangles=new Uint32Array([0,1,2,1,1,3,4,5,2,1]);t.contactLayers=new Int8Array([1,-1]);const index=buildTileContactIndex(t);
  assert.equal(sampleTileContact(t,index,10,10,{referenceY:9}).y,10);assert.equal(sampleTileContact(t,index,10,10,{referenceY:-9}).y,-10);
  assert.equal(sampleTileContact(t,index,10,10,{layer:1}).y,10);assert.equal(sampleTileContact(t,index,10,10,{layer:-1}).y,-10);assert.equal(sampleTileContact(t,index,512,10),null);
});

test('worker fetch validates compressed integrity and refuses unbounded/range-ignored downloads',async()=>{
  const {fetchTilePacket}=await import('../src/world-tile-worker.js');
  const {encodeGeometryPack}=await import('../src/baked-geometry.js');
  const {gzipSync}=await import('node:zlib');const {createHash}=await import('node:crypto');
  const p=fixture(),raw=encodeGeometryPack(p.metadata,p.arrays),body=gzipSync(new Uint8Array(raw)),original=globalThis.fetch;
  const entry={bytes:body.length,decodedBytes:1024*1024,triangles:0,sha256:createHash('sha256').update(body).digest('hex')};
  const job={url:'http://local/tile.bin.gz',entry,world:'athens',revision:'test',cell:[0,0]};
  try{
    globalThis.fetch=async()=>new Response(body);const packet=await fetchTilePacket(job);assert.ok(packet.contactIndex);assert.ok(packet.bytes<entry.decodedBytes);
    await assert.rejects(fetchTilePacket({...job,entry:{...entry,sha256:'0'.repeat(64)}}),/integrity/);
    await assert.rejects(fetchTilePacket({...job,entry:{...entry,bytes:1}}),/declared byte budget/);
    await assert.rejects(fetchTilePacket({...job,entry:{...entry,range:{offset:1,length:body.length}}}),/range response/);
    globalThis.fetch=async()=>new Response(body,{status:206,headers:{'Content-Range':`bytes 0-${body.length-1}/${body.length}`}});
    assert.ok(await fetchTilePacket({...job,entry:{...entry,range:{offset:0,length:body.length}}}));
  }finally{globalThis.fetch=original;}
});

test('twenty simulated minutes of high-speed travel and teleports plateau under hard residency cap',async()=>{
  const a=adapter(),s=new WorldTileStream(manifest(200),{load:async j=>packet(j.cell),adapter:a,capBytes:1000,transientBytes:500,nearRing:1});
  let missing=0,high=0,earlyPeak=0;
  // Deterministic stress of scheduler/accounting. This does not replace the real-time browser/physics gate.
  for(let seconds=0;seconds<1200;seconds+=2){
    const x=seconds%120===0?((seconds/120*197)%199)*512+8:((seconds*70)%100000)+8;
    s.update({x,z:8,vx:70});await settle(s,5);
    if(!s.readyAt(x,8))missing++;
    if(seconds>120&&seconds<=600)earlyPeak=Math.max(earlyPeak,s.residentBytes);
    if(seconds>600)high=Math.max(high,s.residentBytes);
    assert.ok(s.residentBytes+s.reservedBytes<=1000);
  }
  assert.equal(missing,0);assert.ok(s.metrics.evictions>0);assert.ok(high<=1000);assert.ok(high<=earlyPeak+50);s.dispose();assert.equal(s.residentBytes,0);
});

test('tile graph preserves portal ownership, direction, restrictions, names and speed-weighted GPS routes',async()=>{
  const {WorldRoadGraph}=await import('../src/world-tile-graph.js'),g=new WorldRoadGraph(),p=fixture();
  p.metadata.ids=['','node:a','node:b','node:c','edge:ab','edge:bc','edge:ca','surface:road'];p.metadata.strings=['','Avenue'];
  const set=(name,a)=>p.arrays[p.metadata.tables[name]]=a;
  set('nodes',new Uint32Array([1,0,2,1,3,2]));set('nodePositions',new Float32Array([0,0,0,512,0,0,512,0,512]));
  set('edgePoints',new Float32Array([0,0,0,512,0,0,512,0,0,512,0,512,512,0,512,0,0,0]));
  set('edges',new Uint32Array([4,1,2,0,2,1,1,50,1,7,5,2,3,2,2,1,1,50,1,7,6,3,1,4,2,1,1,50,8,7]));set('edgeLayers',new Int8Array(3));
  set('turns',new Uint32Array([4,2,5,1]));g.install('0,0',p);assert.equal(g.route('node:a','node:c'),null);
  assert.equal(g.route('node:b','node:a'),null);assert.equal(g.nearest(20,5).name,'Avenue');assert.equal(g.nearest(20,5).edge,'edge:ab');
  const b=fixture([1,0]);b.metadata.ids=['','node:b'];b.arrays[b.metadata.tables.nodes]=new Uint32Array([1,0]);b.arrays[b.metadata.tables.nodePositions]=new Float32Array([0,0,0]);g.install('1,0',b);
  g.remove('0,0');assert.ok(g.nodes.has('node:b'));assert.equal(g.edges.size,0);g.remove('1,0');assert.equal(g.nodes.size,0);
  set('turns',new Uint32Array(0));g.install('0,0',p);assert.deepEqual(g.route('node:a','node:c').edges,['edge:ab','edge:bc']);g.dispose();assert.equal(g.edges.size,0);
});

test('crossing-feature owner dependencies gate contact readiness without deadlocking cyclic references',async()=>{
 const m=manifest(2);m.tiles['0,0'].dependencies=['1,0'];m.tiles['1,0'].dependencies=['0,0'];let resolveNeighbour;
 const s=new WorldTileStream(m,{nearRing:0,load:async job=>job.cell[0]===0?packet(job.cell):await new Promise(resolve=>{resolveNeighbour=()=>resolve(packet(job.cell));}),adapter:adapter()});
 s.update({x:1,z:1});await settle(s,2);assert.equal(s.tiles.get('0,0').state,'active');assert.equal(s.readyAt(1,1),false);assert.equal(s.contact(1,1),null);
 resolveNeighbour();await settle(s,2);assert.equal(s.readyAt(1,1),true);s.dispose();
});

test('an ahead contact tile can replace a less urgent neighbour when the safety ring fills the cap',async()=>{
 const s=new WorldTileStream(manifest(),{safetyRing:1,nearRing:1,capBytes:330,transientBytes:500,load:async job=>packet(job.cell),adapter:adapter()});
 s.update({x:600,z:1});await settle(s,5);assert.ok(s.readyAt(520,1));
 s.update({x:1200,z:1,vx:70,contacts:[{x:1200,z:1}]});await settle(s,8);
 assert.ok(s.readyAt(1537,1),'velocity lookahead must not deadlock behind equally wanted cosmetic neighbours');assert.ok(s.readyAt(1200,1));assert.ok(s.readyAt(1,1),'spawn remains pinned');assert.ok(s.residentBytes+s.reservedBytes<=330);s.dispose();
});


test('generated spawn requires an emitted public-road anchor and its complete contact footprint',async()=>{
 const m=manifest(1);
 function roadPacket(z=10,y=0){
  const p=fixture();p.metadata.ids=['','spawn:0','edge:road','node:a','node:b','surface:road'];
  const set=(name,a)=>p.arrays[p.metadata.tables[name]]=a;
  set('edges',new Uint32Array([2,3,4,0,2,0,1,50,1,5]));set('edgePoints',new Float32Array([0,0,10,512,0,10]));set('edgeLayers',new Int8Array([0]));
  set('contactPositions',new Float32Array([0,0,0,512,0,0,0,0,20,512,0,20]));set('contactTriangles',new Uint32Array([0,2,1,5,1,1,2,3,5,1]));set('contactLayers',new Int8Array(2));
  set('anchors',new Uint32Array([1,0,2,0,0]));set('anchorTransforms',new Float32Array([10,y,z,-Math.PI/2]));
  return{...p,bytes:80,contactIndex:buildTileContactIndex(tileTables(p))};
 }
 const s=new WorldTileStream(m,{nearRing:0,load:async()=>roadPacket()});let moved=null;
 await s.spawn(p=>{moved=p;},{nextFrame:tick});assert.equal(moved.x,10);assert.equal(moved.z,10);assert.equal(moved.layer,0);s.dispose();
 const tow=new WorldTileStream(m,{nearRing:0,load:async()=>{const p=roadPacket();p.arrays[p.metadata.tables.anchors][3]=1;return p;}});await tow.spawn(p=>assert.equal(p.kind,1),{nextFrame:tick});tow.dispose();
 for(const [z,y]of [[30,0],[10,2],[.25,0]]){
  const bad=new WorldTileStream(m,{nearRing:0,load:async()=>roadPacket(z,y)});
  await assert.rejects(bad.spawn(()=>assert.fail('unvalidated spawn moved the car'),{nextFrame:tick}),/spawn (contact|footprint)/);bad.dispose();
 }
 const reversed=new WorldTileStream(m,{nearRing:0,load:async()=>{const p=roadPacket();p.arrays[p.metadata.tables.anchorTransforms][3]=Math.PI/2;return p;}});
 await assert.rejects(reversed.spawn(()=>assert.fail('wrong-way spawn moved the car'),{nextFrame:tick}),/heading mismatch/);reversed.dispose();
 const absent=new WorldTileStream(m,{nearRing:0,load:async j=>packet(j.cell)});
 await assert.rejects(absent.spawn(()=>assert.fail('nominal point must not be used'),{nextFrame:tick}),/anchor missing/);absent.dispose();
});

test('shader preparation gates activation and cancelled warmups cannot revive discarded tiles',async()=>{
 const pending=[],a=adapter();a.warmup=()=>new Promise(resolve=>pending.push(resolve));
 const s=new WorldTileStream(manifest(1),{nearRing:0,adapter:a,load:async j=>packet(j.cell),capBytes:500});
 s.update({x:1,z:1});await tick();s.activateFrame();
 assert.equal(s.tiles.get('0,0').state,'preparing');assert.equal(s.readyAt(1,1),false);assert.equal(a.committed,0);assert.equal(s.residentBytes,80);
 s.dispose();assert.equal(s.residentBytes,0);assert.equal(s.reservedBytes,0);
 pending[0]();await tick();s.activateFrame();assert.equal(s.tiles.size,0);assert.equal(a.committed,0);assert.equal(s.transientBytes,0);assert.equal(s.inflight,0);
});

test('failed shader preparation releases residency and retry can complete activation',async()=>{
 let fail=true;const a=adapter();a.warmup=async()=>{if(fail)throw new Error('shader preparation failed');};
 const s=new WorldTileStream(manifest(1),{nearRing:0,adapter:a,load:async j=>packet(j.cell),capBytes:500});
 s.update({x:1,z:1});await tick();assert.equal(s.tiles.get('0,0').state,'failed');assert.equal(s.residentBytes,0);assert.equal(s.reservedBytes,0);assert.equal(s.transientBytes,0);assert.equal(a.committed,0);
 fail=false;s.retry('0,0');await settle(s);assert.equal(s.readyAt(1,1),true);s.dispose();assert.equal(s.residentBytes,0);assert.equal(a.disposed,a.committed);
});

test('one decoder admits the next cell while shaders warm, retaining byte admission and readiness gates',async()=>{
 const m=manifest(3),loaded=[],warm=[];let releaseLoad;
 const s=new WorldTileStream(m,{nearRing:0,concurrency:1,capBytes:200,transientBytes:210,
  load:async j=>{loaded.push(j.cell[0]);if(j.cell[0]===1)await new Promise(r=>releaseLoad=r);return packet(j.cell);},
  adapter:{...adapter(),warmup:()=>new Promise(r=>warm.push(r))}});
 const releases=[s.pin('start','1,0'),s.pin('start','2,0')];s.update({x:1,z:1});await tick();
 assert.deepEqual(loaded,[0,1],'GPU preparation must not monopolise the decoder');
 assert.equal(s.tiles.get('0,0').state,'preparing');assert.equal(s.readyAt(1,1),false);
 assert.equal(s.inflight,1);assert.equal(s.transientBytes,210);assert.ok(s.residentBytes+s.reservedBytes<=200);
 releaseLoad();await tick();assert.deepEqual(loaded,[0,1],'both resident packets still count against admission');
 assert.equal(s.inflight,0);assert.equal(s.transientBytes,0);warm.forEach(r=>r());await settle(s);
 assert.equal(s.readyAt(1,1),true);releases.forEach(r=>r());s.dispose();
 assert.equal(s.residentBytes,0);assert.equal(s.reservedBytes,0);
});


test('a city-scale owner chain stays one hop for loading, readiness, pins and teleport',async()=>{
 const m=manifest(218),jobs=[];
 for(let x=0;x<217;x++)m.tiles[`${x},0`].dependencies=[`${x+1},0`];
 const s=new WorldTileStream(m,{nearRing:0,load:async j=>{jobs.push(j.cell[0]);return packet(j.cell);},adapter:adapter(),capBytes:500,transientBytes:500});
 assert.deepEqual([...s.pins.keys()],['0,0','1,0']);
 s.update({x:10,z:10});await settle(s,8);
 assert.deepEqual(jobs,[0,1]);assert.equal(s.readyAt(10,10),true);
 assert.equal(s.readyAt(520,10),false,'an owner-only cell has not independently requested its owners');
 let moved=false;await s.teleport({x:10,z:10},()=>{moved=true;},{nextFrame:tick});
 assert.equal(moved,true);assert.deepEqual(jobs,[0,1]);
 const release=s.pin('tow','1,0');assert.deepEqual([...s.pins.keys()],['0,0','1,0','2,0']);
 s.spawnRelease();assert.deepEqual([...s.pins.keys()],['1,0','2,0']);
 s.update({x:520,z:10});await settle(s,8);
 assert.deepEqual(jobs,[0,1,2]);assert.equal(s.readyAt(520,10),true);
 assert.equal(s.tiles.has('3,0'),false);release();assert.equal(s.pins.size,0);
 s.dispose();assert.equal(s.residentBytes,0);
});

test('tile workers reuse the shared ASR2 decoder and reject allocation expansion before decoding',async()=>{
 const {fetchTilePacket}=await import('../src/world-tile-worker.js'),{encodeGeometryPack}=await import('../src/baked-geometry.js'),{encodeMeshoptPack}=await import('./meshopt-pack.mjs'),{decodeTilePack}=await import('../src/world-tile-codec.js');
 const {gzipSync}=await import('node:zlib'),{createHash}=await import('node:crypto');const p=fixture(),raw=encodeGeometryPack(p.metadata,p.arrays),compact=await encodeMeshoptPack(raw),body=gzipSync(compact),original=globalThis.fetch;
 const entry={bytes:body.length,decodedBytes:1024*1024,triangles:0,sha256:createHash('sha256').update(body).digest('hex')};
 try{globalThis.fetch=async()=>new Response(body);const decoded=await fetchTilePacket({url:'http://local/tile',entry,world:'athens',revision:'test',cell:[0,0]});assert.deepEqual([...decoded.arrays[p.metadata.tables.coarseHeights]],[...p.arrays[p.metadata.tables.coarseHeights]]);}finally{globalThis.fetch=original;}
 // A small valid container can name a huge output buffer; no WASM allocation
 // should occur before this declaration is checked against the tile reservation.
 const json=new TextEncoder().encode(JSON.stringify({version:2,views:[{type:'Uint8Array',length:1000000,codec:'ATTRIBUTES',count:250000,stride:4,offset:0,byteLength:0}]})),buffer=new ArrayBuffer(12+json.length),view=new DataView(buffer);view.setUint32(0,0x32525341,true);view.setUint32(4,json.length,true);view.setUint32(8,buffer.byteLength,true);new Uint8Array(buffer,12).set(json);
 await assert.rejects(decodeTilePack(buffer,16384),/decoded byte budget/);
});
test('nine measured packet reservations fit the unchanged 64 MiB phone stream cap with conservative decode overlap',async()=>{
 const m=manifest(0);m.spawn={cell:[1,1],anchor:'spawn:0'};
 for(let x=0;x<3;x++)for(let z=0;z<3;z++)m.tiles[`${x},${z}`]={url:'tile.bin.gz',sha256:'0'.repeat(64),bytes:1000000,decodedBytes:13313693,residentBytes:4536697,transientBytes:27627386,dependencies:[],triangles:0};
 const s=new WorldTileStream(m,{capBytes:64*1024*1024,transientBytes:64*1024*1024,concurrency:1,load:async job=>({...packet(job.cell),bytes:3629357,jsBytes:2856689,gpuBytes:772668}),adapter:adapter()});
 s.update({x:768,z:768});await settle(s,40);assert.equal([...s.tiles.values()].filter(t=>t.state==='active').length,9);
 assert.equal(s.residentBytes,9*4536697,'retain the metadata/object allowance after preparation');assert.ok(s.metrics.peakTransientBytes<=27627386);assert.equal(s.metrics.peakJSBytes,9*2856689);assert.equal(s.metrics.peakGPUBytes,9*772668);s.dispose();
});
test('spawn pins can be released and dependency-only scenery never supplies driving contact',async()=>{
 const m=manifest(3);m.tiles['2,0'].contactEligible=false;
 const s=new WorldTileStream(m,{load:async job=>packet(job.cell),adapter:adapter(),capBytes:300,nearRing:0});s.update({x:1,z:1});await settle(s);assert.ok(s.pins.has('0,0'));
 s.releaseSpawn();s.releaseSpawn();assert.equal(s.pins.size,0);s.update({x:1025,z:1});await settle(s);assert.equal(s.readyAt(1025,1),false);assert.equal(s.contact(1025,1),null);s.dispose();
});

test('route preparation admits only mandatory pins and their one-hop owners; countdown restores optional interest',async()=>{
 const m=manifest(5);m.tiles['1,0'].dependencies=['2,0'];const s=new WorldTileStream(m,{load:async job=>packet(job.cell),adapter:adapter(),nearRing:1,safetyRing:0,pinSpawn:false,capBytes:1000});
 try{const release=s.pin('route-start','1,0'),interest=[{key:'1,0',priority:-1},{key:'3,0',priority:.1}];s.update({x:520,z:10,routeInterest:interest,mandatoryOnly:true});assert.deepEqual([...s.wanted.keys()].sort(),['1,0','2,0']);await settle(s,10);assert.equal(s.readyAt(520,10),true);assert.equal(s.tiles.has('3,0'),false);s.update({x:520,z:10,routeInterest:interest});await settle(s,10);assert.equal(s.tiles.get('3,0').state,'active');release();}finally{s.dispose();}
});
