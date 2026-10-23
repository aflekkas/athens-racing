// PREPARED ONLY. Launch exclusively inside the granted <=300s CPU slot.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const task='/tmp/athens-loaders.OfMh',ready=JSON.parse(await readFile(task+'/megara72-v2-ready.json','utf8')),repo=ready.sourceDirectory,out=task+'/megara72-v2-proof';
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const [path,pin]of Object.entries(ready.modules))assert.equal(hash(await readFile(repo+'/'+path)),pin.sha256,'Pinned module changed: '+path);
for(const [path,expected]of [[task+'/megara-repaired/manifest.json',ready.regionManifestSHA256],[task+'/megara-fixture/world.json',ready.worldJSONSHA256],[task+'/megara-fixture/failed-admission--64,-2.json',ready.savedV1SHA256]])assert.equal(hash(await readFile(path)),expected,'Source metadata mismatch: '+path);
const {canonicalJSON,sha256}=await import(repo+'/src/route-definition.js'),{encodeRecoverySidecar,decodeRecoverySidecar}=await import(repo+'/server/route-road-wire.mjs'),{admitRecoverySidecar,validateRecoveryManifest}=await import(repo+'/server/route-road-stream.mjs');
const original=JSON.parse(await readFile(task+'/megara-fixture/failed-admission--64,-2.json','utf8')),packed=encodeRecoverySidecar(original),text=canonicalJSON(packed),packedHash=await sha256(packed),decoded=decodeRecoverySidecar(packed).body;
assert.equal(canonicalJSON(decoded),canonicalJSON(original),'Lossless saved dense-cell roundtrip');
const saved=await admitRecoverySidecar(text,{expectedHash:packedHash,worldSetRevision:ready.worldSetRevision});
const savedCounts={anchors:original.anchors.length,edges:original.edges.length,points:original.edges.reduce((n,e)=>n+(e.points?.length||0),0),certificates:original.anchors.reduce((n,a)=>n+a.footprints.length,0)};
assert.deepEqual(savedCounts,{anchors:2834,edges:100,points:1926,certificates:4570});
console.log(JSON.stringify({phase:'saved-dense-packed-admission',hash:packedHash,...savedCounts,metrics:saved.metrics}));
await mkdir(out,{recursive:false});await writeFile(out+'/saved-dense-admission.json',JSON.stringify({sourcePin:ready.sourcePin,hash:packedHash,...savedCounts,metrics:saved.metrics},null,2));
const {readEmittedRouteWorld}=await import(repo+'/tools/emitted-route-world.mjs'),{compileRoute}=await import(repo+'/src/route-compile.js'),{writeOnlineGrid}=await import(repo+'/tools/build-online-grids.mjs'),{buildWorldRecovery,recoveryNeighborhood}=await import(repo+'/tools/build-world-recovery.mjs');
const worldPath=task+'/megara-fixture/world.json',world=JSON.parse(await readFile(worldPath,'utf8')),oldCompiled=JSON.parse(await readFile(task+'/megara-fixture/compiled.json','utf8')),cells=[task+'/megara-repaired/cells',task+'/cells'];
assert.equal(Object.keys(world.tiles).length,72);assert.equal(world.revision,ready.worldSetRevision);
const sampled=await readEmittedRouteWorld({world:worldPath,cells,keys:new Set(Object.keys(world.tiles))});let compiled;
try{compiled=await compileRoute(oldCompiled.definition,sampled.roads.graph,sampled.contacts);}finally{sampled.roads.graph.dispose();sampled.tiles.clear();}
assert.equal(compiled.geometryHash,oldCompiled.geometryHash,'Actual compile geometry/proof changed');assert.equal(compiled.routeHash,oldCompiled.routeHash,'Actual compile tuple changed');
await writeFile(out+'/compiled.json',canonicalJSON(compiled));console.log(JSON.stringify({phase:'actual-recompile',routeHash:compiled.routeHash,geometryHash:compiled.geometryHash}));
const grid=await writeOnlineGrid(compiled,{world:worldPath,cells,out:out+'/grids'});assert.equal(grid.body.poses.length,8);console.log(JSON.stringify({phase:'actual-grid',hash:grid.hash,footprint:grid.body.footprint,poses:grid.body.poses}));
const recovery=await buildWorldRecovery({world:worldPath,cells,out:out+'/recovery',onCell:p=>console.log(JSON.stringify({phase:'recovery',...p}))});
assert.equal(Object.keys(recovery.body.cells).length,72);await validateRecoveryManifest(recovery.body,{expectedHash:recovery.hash,worldSetRevision:world.revision,sourceHashes:recovery.recoveryWorld.sourceHashes});
const artifacts=new Map();for(const [key,entry]of Object.entries(recovery.body.cells)){if(entry.empty)continue;const raw=await readFile(out+entry.url.replace('/world','')),admitted=await admitRecoverySidecar(raw,{expectedHash:entry.hash,worldSetRevision:world.revision});artifacts.set(key,{wireBytes:raw.length,anchors:admitted.body.anchors.length,metrics:admitted.metrics,pose:admitted.body.anchors[0]});}
const neighborhoods=[];for(const key of Object.keys(world.tiles)){const members=[...recoveryNeighborhood(key,world)].sort(),nonempty=members.filter(k=>artifacts.has(k));neighborhoods.push({key,members,nonempty,bytes:nonempty.reduce((n,k)=>n+artifacts.get(k).wireBytes,0),anchors:nonempty.reduce((n,k)=>n+artifacts.get(k).anchors,0),pose:artifacts.get(key)?.pose||null});}
neighborhoods.sort((a,b)=>b.bytes-a.bytes||b.anchors-a.anchors||a.key.localeCompare(b.key));
await writeFile(out+'/admission.json',JSON.stringify(Object.fromEntries(artifacts),null,2));await writeFile(out+'/neighborhoods.json',JSON.stringify(neighborhoods,null,2));
const receipt={sourcePin:ready.sourcePin,status:'local complete Megara-domain proof only; no catalogue activation',acceptance:false,online:false,worldSetRevision:world.revision,regionManifestSHA256:ready.regionManifestSHA256,routeHash:compiled.routeHash,geometryHash:compiled.geometryHash,gridHash:grid.hash,recoveryHash:recovery.hash,cells:72,emptyCells:72-artifacts.size,admittedCells:artifacts.size,totalBytes:recovery.totalBytes,anchors:recovery.anchorCount,admission:recovery.admission,neighborhoods:neighborhoods.length,neighborMemberships:neighborhoods.reduce((n,e)=>n+e.members.length,0),worstNeighborhood:neighborhoods[0],modules:ready.modules};
assert.equal(receipt.neighborMemberships,550);await writeFile(out+'/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify({phase:'COMPLETE',...receipt}));
