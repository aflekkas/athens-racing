import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {regionTransform,splitSegment,addAuthoredMeshes,addRails,addBarrierObstacles,addRoadGraph,bindRoadGraphSurfaces,addBuildingColliders} from './world-gen/track-region-geometry.mjs';
import {checkSourceHashes,rejectDuplicateCells,regionBudgets} from './import-track-region.mjs';
import {TILE_TABLES} from '../src/world-tile-format.js';
const source={lat0:38.08,lon0:23.9,mlat:110997.96415769357,mlon:87737.04446643248};
test('raw vertices, inverse-transpose normals, tangents and vehicle yaw reproject before clipping',()=>{
 const t=regionTransform(source),p=[10,500,-20],q=t.position(p),back=t.inverse(q);for(let i=0;i<3;i++)assert.ok(Math.abs(p[i]-back[i])<1e-9);
 const n=t.normal([1,1,0]),v=t.tangent([1,-1,0,1]);assert.ok(Math.abs(n[0]*v[0]+n[1]*v[1])<1e-12);assert.equal(v[3],1);
 const yaw=.7,d=t.tangent([-Math.sin(yaw),0,-Math.cos(yaw)]);assert.ok(Math.abs(Math.atan2(-d[0],-d[2])-t.yaw(yaw))<1e-12);
 const segments=splitSegment([510,5,20],[516,8,20]);assert.equal(segments.length,2);assert.deepEqual(segments[0].b,segments[1].a);assert.deepEqual(segments.map(s=>s.cell),[[0,0],[1,0]]);
});
const fixture=()=>{const tiles=new Map();return {tiles,get:(x,z)=>{const key=`${x},${z}`;if(!tiles.has(key))tiles.set(key,{cell:[x,z],t:Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]])),ids:['','surface:terrain','surface:roads'],strings:['']});return tiles.get(key);}};};
test('authored meshes retain custom attributes and matching physical rail ownership at a seam',()=>{
 const {get,tiles}=fixture(),transform=regionTransform(source,source),group=new THREE.Group(),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([510,1,20,516,1,20,510,2,20],3));g.setAttribute('tangent',new THREE.Float32BufferAttribute([1,0,0,1,1,0,0,1,1,0,0,1],4));group.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));
 addAuthoredMeshes(group,get,transform);assert.equal(tiles.size,2);for(const tile of tiles.values())assert.ok([...tile.authored.values()][0][0].fields.some(([name])=>name==='tangent'));
 const rails=addRails([{pts:[{p:new THREE.Vector3(510,0,20),terminal:1},{p:new THREE.Vector3(516,0,20),terminal:1}]}],get,transform);assert.equal(rails.segments,2);assert.equal(rails.metres,6);assert.equal(get(0,0).safetyRails[0][3],512);assert.equal(get(1,0).safetyRails[0][0],0);
});
test('graph reconstructs both directions with canonical portals, turns and safe anchor candidates',()=>{
 const {get,tiles}=fixture(),t=regionTransform(source,source),points=Array.from({length:22},(_,i)=>[500+i*2,10+i*.1,40]);const stats=addRoadGraph([{id:'main',points}],get,t);assert.ok(stats.directedEdges<12);assert.equal(tiles.size,2);assert.ok(get(1,0).t.anchors.length);assert.ok([...tiles.values()].some(t=>t.t.turns.length));assert.throws(()=>addRoadGraph([{id:'steep',points:[[0,0,0],[1,1,0]]}],get,t),/45%/);
});
test('source locks fail on stale inputs and duplicate cells fail regardless of matching hashes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'athens-region-lock-'));try{
  const body='original';await writeFile(join(dir,'input'),body);const config={schemaVersion:1,id:'penteli',tileMetres:512,access:'public',elevation:{datum:'EVRS2000',source:'EU-DEM v1.1',verticalOffset:0},sourceHashes:{input:createHash('sha256').update(body).digest('hex')}};
  await writeFile(join(dir,'input'),'changed');await assert.rejects(checkSourceHashes(dir,config),/Stale region source hash/);
 }finally{await rm(dir,{recursive:true,force:true});}
 assert.throws(()=>rejectDuplicateCells({tiles:{'0,0':{}}},{tiles:{'0,0':{}}}),/Duplicate region cell/);
 assert.equal(regionBudgets({tiles:{'0,0':{bytes:1,decodedBytes:65*1024**2}}}).passed,false);
});
test('Megara access inclusion stays on the source-backed motor raceway',async()=>{
 const config={schemaVersion:1,id:'megara',tileMetres:512,access:'circuit',elevation:{source:'EU-DEM v1.1',datum:'EVRS2000',verticalOffset:0},inclusion:{racewayWays:[70043225],evidence:'tools/maps/megara/SOURCES.md'},sourceHashes:{}};
 await assert.rejects(checkSourceHashes(new URL('..',import.meta.url).pathname,config),/raceway inclusion/);
});

import {composeWorldManifest,loadWorldDefinition,canonicalWorldJSON} from '../src/world-manifest.js';
test('world set accepts isolated mixed datums and rejects stale packet identities, connected regions, overlapping cells and changed manifests',async()=>{
 const projection={lat0:37.98,lon0:23.73,mlat:111320,mlon:111320*Math.cos(37.98*Math.PI/180)},sha='a'.repeat(64),entry={url:'./cell.gz',bytes:1,decodedBytes:100,triangles:0,dependencies:[],sha256:sha};
 const source=(world,cell)=>({tileVersion:1,tileMetres:512,world,revision:'source-v1',projection,elevation:{datum:'EVRS2000'},externalPortals:[],tiles:{[cell]:entry},spawn:{cell:cell.split(',').map(Number),anchor:'test'}});
 const sources={basin:{manifest:source('basin','0,0'),url:'https://local/basin/world.json'},penteli:{manifest:source('penteli','30,-20'),url:'https://local/penteli/world.json'}};
 const content={schemaVersion:1,id:'athens',tileMetres:512,projection,regions:Object.entries(sources).map(([id,s])=>({id,manifestUrl:s.url,manifestSha256:createHash('sha256').update(JSON.stringify(s.manifest)).digest('hex'),sourceWorld:id,sourceRevision:'source-v1',access:'public',externalPortals:[]}))},def={...content,revision:createHash('sha256').update(canonicalWorldJSON(content)).digest('hex')};
 const combined=composeWorldManifest(def,sources);assert.equal(combined.tiles['30,-20'].source.world,'penteli');assert.equal(combined.tiles['30,-20'].url,'https://local/penteli/cell.gz');
 const rejected=structuredClone(sources);rejected.penteli.manifest.acceptance={passed:false};assert.throws(()=>composeWorldManifest(def,rejected),/acceptance gates/);
 const nested=structuredClone(sources);nested.basin.manifest.tiles['0,0'].source={regionId:'basin',world:'basin-old-packets',revision:'original-revision'};const preserved=composeWorldManifest(def,nested);assert.equal(preserved.tiles['0,0'].source.revision,'original-revision');assert.equal(preserved.tiles['0,0'].source.world,'basin-old-packets');
 const stale=structuredClone(sources);stale.penteli.manifest.revision='stale';assert.throws(()=>composeWorldManifest(def,stale),/Stale region/);
 const mixed=structuredClone(sources);mixed.penteli.manifest.elevation.datum='EGM2008';assert.equal(composeWorldManifest(def,mixed).elevation.perRegion.penteli.datum,'EGM2008');
 const connected=structuredClone(mixed);connected.penteli.manifest.externalPortals=[{to:'basin',node:'remote'}];assert.throws(()=>composeWorldManifest(def,connected),/without portals/);
 const unknown=structuredClone(mixed);delete unknown.basin.manifest.externalPortals;assert.throws(()=>composeWorldManifest(def,unknown),/without portals/);
 const adjacent=structuredClone(mixed);adjacent.penteli.manifest.tiles={'1,0':entry};adjacent.penteli.manifest.spawn.cell=[1,0];assert.throws(()=>composeWorldManifest(def,adjacent),/boundary/);
 const overlap=structuredClone(sources);overlap.penteli.manifest=source('penteli','0,0');assert.throws(()=>composeWorldManifest(def,overlap),/Duplicate region cell/);
 const fetcher=async url=>Response.json(String(url).endsWith('set.json')?def:{...sources.basin.manifest,revision:'tampered'});await assert.rejects(loadWorldDefinition('https://local/set.json',{fetcher}),/manifest hash mismatch/);
});

import {WorldTileBarriers} from '../src/world-tile-barriers.js';
test('imported Penteli rail segments retain the 150 km/h swept collision across a cell seam',()=>{
 const {get,tiles}=fixture(),t=regionTransform(source,source);addRails([{pts:[{p:new THREE.Vector3(512,10,500),terminal:1},{p:new THREE.Vector3(512,10,530),terminal:1}]}],get,t);
 const barriers=new WorldTileBarriers();for(const[key,tile]of tiles)barriers.install(key,{metadata:{origin:[tile.cell[0]*512,0,tile.cell[1]*512],safetyRails:tile.safetyRails}});
 const v={x:520,y:10,z:512,yaw:-Math.PI/2,halfL:2.5,halfW:1,vLong:150/3.6,vLat:0,w:0};assert.ok(barriers.resolve(v,{x:503,y:10,z:512,yaw:v.yaw}));assert.ok(v.x+v.halfL<=512-.15);assert.equal(v.y,10);
});

import {WorldRegionalScenery,WorldRegionalScenerySet} from '../src/world-regional-scenery.js';
import {setSetting} from '../src/settings.js';
test('regional silhouettes share resident ownership, rebase and obey World detail Off',()=>{
 const parent=new THREE.Group(),layer=new WorldRegionalScenery(parent),spec={kind:'penteli',projection:source};layer.add('30,-23',spec);const root=layer.root;assert.equal(root.children.length,11);layer.add('31,-23',spec);assert.equal(layer.root,root);assert.equal(parent.children.length,1);layer.rebase({x:15360,z:-11776});assert.equal(root.position.x,-15360);assert.equal(root.position.z,11776);setSetting('worldDetail',false);assert.equal(root.visible,false);setSetting('worldDetail',true);layer.remove('30,-23');assert.equal(parent.children.length,1);layer.remove('31,-23');assert.equal(parent.children.length,0);layer.dispose();
});

test('degree-two graph compression preserves sampled bends, grades, junctions and direction',()=>{
 const {get,tiles}=fixture(),t=regionTransform(source,source),points=Array.from({length:51},(_,i)=>[50+i,10+Math.sin(i/10),40+Math.cos(i/8)]),side=[points[23],[73,points[23][1],60]];const stats=addRoadGraph([{id:'main',points},{id:'side',points:side}],get,t);assert.ok(stats.directedEdges<16);const tile=[...tiles.values()][0];for(const p of points){assert.ok(tile.t.edgePoints.some((_,i)=>i%3===0&&Math.abs(tile.t.edgePoints[i]-p[0])<.001&&Math.abs(tile.t.edgePoints[i+1]-p[1])<.001&&Math.abs(tile.t.edgePoints[i+2]-p[2])<.001));}const junction='penteli:n:'+points[23].map((v,i)=>(i===1?Math.fround(v):Math.round(v*10000)/10000).toFixed(4).replace('-','m')).join(':');assert.ok(tile.ids.includes(junction));assert.ok(tile.t.turns.some((n,i)=>i%4===1&&tile.ids[n]===junction));
});
test('regional background masks resident fine cells and releases its last GPU owner',()=>{
 const parent=new THREE.Group(),layer=new WorldRegionalScenery(parent),spec={kind:'penteli',projection:source};layer.asset={bytes:123,metadata:{bounds:[15360,-11776,16384,-11264],meshes:[{surface:'penteliBuilding',attributes:{position:{array:0,size:3}},index:1}]},arrays:[new Float32Array([15360,0,-11776,15872,0,-11776,15360,0,-11264]),new Uint16Array([0,1,2])]};
 layer.add('30,-23',spec);assert.deepEqual([...layer.mask.data],[255,0]);layer.add('31,-23',spec);assert.deepEqual([...layer.mask.data],[255,255]);const camera=new THREE.PerspectiveCamera(60,1,.1,850);camera.position.set(15400,20,-11700);layer.view(camera);assert.equal(camera.far,90000);let disposed=0;layer.mask.texture.addEventListener('dispose',()=>disposed++);layer.remove('30,-23');assert.deepEqual([...layer.mask.data],[0,255]);layer.remove('31,-23');assert.equal(disposed,1);assert.equal(parent.children.length,0);assert.equal(layer.cachedBytes,123);layer.dispose();assert.equal(layer.cachedBytes,0);assert.equal(camera.far,850);
});
test('Penteli and Megara can own separate regional backgrounds in one scene',()=>{
 const parent=new THREE.Group(),set=new WorldRegionalScenerySet(parent),p={kind:'penteli',projection:source},m={kind:'megara',projection:source};set.add('30,-23',p);set.add('-64,-2',m);assert.equal(parent.children.length,2);assert.equal(set.layers.size,2);set.remove('30,-23');assert.equal(parent.children.length,1);assert.equal(set.layers.get('megara').cells.size,1);set.dispose();assert.equal(parent.children.length,0);
});
test('Megara tyre and wall boxes emit raised swept barriers',()=>{
 const {get,tiles}=fixture(),t=regionTransform(source,source),stats=addBarrierObstacles([{x:511,z:20,yaw:Math.PI/2,hl:2,hw:.5,kind:'tyre'}],get,t,()=>9);assert.equal(stats.segments,2);for(const tile of tiles.values())for(const rail of tile.safetyRails)assert.equal(rail[1],9);
});

test('regional warmup builds a detached background; activation only attaches the prepared identity',async()=>{
 const parent=new THREE.Group(),forest=[],layer=new WorldRegionalScenery(parent,'penteli',{trees:{setMountainForest:asset=>forest.push(asset)}}),spec={kind:'penteli',projection:source,terrain:{sha256:'fixture'}};
 layer.assetPromise=Promise.resolve();layer.terrainHash='fixture';layer.asset={bytes:123,metadata:{bounds:[15360,-11776,16384,-11264],meshes:[{surface:'penteliBuilding',attributes:{position:{array:0,size:3}},index:1}]},arrays:[new Float32Array([15360,0,-11776,15872,0,-11776,15360,0,-11264]),new Uint16Array([0,1,2])]};
 try{await layer.prepare(spec);const root=layer.preparedRoot;assert.ok(root);assert.equal(layer.root,null);assert.equal(layer.cells.size,0);assert.equal(parent.children.length,0);assert.equal(forest.length,0);const original=layer.buildRoot;layer.buildRoot=()=>{throw Error('Activation rebuilt scenery');};layer.add('30,-23',spec);assert.equal(layer.root,root);setSetting('worldDetail',false);assert.equal(layer.preparedRoot,null);assert.equal(root.visible,false);assert.equal(parent.children.length,1);assert.deepEqual([...layer.mask.data],[255,0]);assert.equal(forest[0],layer.asset);layer.buildRoot=original;layer.remove('30,-23');setSetting('worldDetail',true);await layer.prepare(spec);assert.ok(layer.preparedRoot);assert.notEqual(layer.preparedRoot,root);assert.equal(parent.children.length,0);
 }finally{setSetting('worldDetail',true);layer.dispose();}
});

test('cancelled regional preparation disposes its detached geometries, materials and mask without activating',async()=>{
 const parent=new THREE.Group(),layer=new WorldRegionalScenery(parent),spec={kind:'penteli',projection:source};layer.prepareRoot(spec);const root=layer.preparedRoot;let geometry=0,material=0;root.traverse(o=>o.geometry?.addEventListener('dispose',()=>geometry++));for(const m of root.userData.ownedMaterials)m.addEventListener('dispose',()=>material++);const meshes=root.children.length,materials=root.userData.ownedMaterials.length;layer.dispose();assert.equal(geometry,meshes);assert.equal(material,materials);assert.equal(parent.children.length,0);assert.equal(layer.preparedRoot,null);layer.prepareRoot(spec);assert.equal(layer.preparedRoot,null);
});


test('World detail Off defers regional downloads and root construction until enabled, retaining active cell masks',async()=>{
 const parent=new THREE.Group(),layer=new WorldRegionalScenery(parent),spec={kind:'penteli',projection:source};let builds=0;const build=layer.buildRoot;layer.buildRoot=function(...args){builds++;return build.apply(this,args);};
 try{setSetting('worldDetail',false);await layer.prepare(spec);layer.add('30,-23',spec);assert.equal(layer.root,null);assert.equal(layer.preparedRoot,null);assert.equal(builds,0);assert.equal(layer.cells.size,1);setSetting('worldDetail',true);await new Promise(r=>setImmediate(r));assert.equal(builds,1);assert.ok(layer.root);assert.equal(parent.children.length,1);}finally{layer.dispose();setSetting('worldDetail',true);}
});


function megaraSurfaceFixture({bind=false,restricted=false}={}){
 const f=fixture(),transform=regionTransform(source,source),network={id:'way-70043222-0',name:'Source-backed approach',points:[[20,10,30],[40,10,30]],width:5,oneway:true,restricted,...(bind?{surface:'surface:megaraNetwork'}:{})};
 addRoadGraph([network,{id:'raceway-70043234',points:[[20,10,90],[40,10,90]],width:11.5}],f.get,transform,'megara');
 const group=new THREE.Group(),geometry=new THREE.PlaneGeometry(30,10);geometry.rotateX(-Math.PI/2);geometry.translate(30,10,30);group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
 addAuthoredMeshes(group,f.get,transform,{surface:'megaraNetwork',contacts:true,contactSurface:true});
 addBarrierObstacles([{x:300,z:300,y:10,yaw:0,hl:2,hw:.5,kind:'tyre'}],f.get,transform);
 addBuildingColliders([{id:7,p:[90,90,100,90,100,100,90,100],h:4}],f.get,transform,()=>10);
 return {...f,tile:f.tiles.get('0,0')};
}
const tableBytes=(tile,name)=>Buffer.from(new globalThis[TILE_TABLES[name][0]](tile.t[name]).buffer);

test('Megara access graph binds its emitted physical surface without changing geometry or physical table bytes',async()=>{
 const {buildTileContactIndex,sampleTileContact}=await import('../src/world-tile-contact.js'),{routeSurfaceAllowed}=await import('../src/route-surface.js');
 const old=megaraSurfaceFixture(),fixed=megaraSurfaceFixture({bind:true}),before=structuredClone(fixed.tile.t.edges),result=bindRoadGraphSurfaces(fixed.tiles);assert.deepEqual(result,{edges:1,cells:1});
 assert.deepEqual(fixed.tile.ids,old.tile.ids,'deferred binding preserves all existing ID positions');assert.deepEqual(fixed.tile.strings,old.tile.strings);
 for(const name of Object.keys(TILE_TABLES))if(name!=='edges')assert.deepEqual(tableBytes(fixed.tile,name),tableBytes(old.tile,name),name+' bytes unchanged');
 assert.ok(fixed.tile.t.contactPositions.length&&fixed.tile.t.buildings.length&&fixed.tile.safetyRails.length);
 assert.deepEqual(fixed.tile.safetyRails,old.tile.safetyRails);assert.deepEqual(fixed.tile.authored,old.tile.authored,'all authored vertices and attributes unchanged');
 for(let i=0;i<before.length;i++)if(i!==9)assert.equal(fixed.tile.t.edges[i],before[i],'only the explicitly bound network surface word changes');
 assert.equal(old.tile.ids[old.tile.t.edges[9]],'surface:roads');assert.equal(fixed.tile.ids[fixed.tile.t.edges[9]],'surface:megaraNetwork');
 for(let i=10;i<fixed.tile.t.edges.length;i+=10)assert.equal(fixed.tile.ids[fixed.tile.t.edges[i+9]],'surface:roads','raceway defaults stay unchanged');
 const contact=sampleTileContact(fixed.tile.t,buildTileContactIndex(fixed.tile.t),30,30,{requiredFlags:1,referenceY:10});assert.ok(contact);contact.surfaceId=fixed.tile.ids[contact.surface];
 const edge=tile=>({id:tile.ids[tile.t.edges[0]],surface:tile.ids[tile.t.edges[9]],layer:tile.t.edgeLayers[0]}),allowed=tile=>{const e=edge(tile);return routeSurfaceAllowed(e,contact,{edges:new Map([[e.id,{value:e}]])});};
 assert.equal(contact.surfaceId,'surface:megaraNetwork');assert.equal(allowed(old.tile),false,'negative control reproduces the actual source-label rejection');assert.equal(allowed(fixed.tile),true);
 assert.deepEqual(bindRoadGraphSurfaces(fixed.tiles),{edges:0,cells:0});assert.deepEqual(bindRoadGraphSurfaces(old.tiles),{edges:0,cells:0},'untyped tracks retain their default behavior');geometryCleanup(old);geometryCleanup(fixed);
});
function geometryCleanup(f){for(const tile of f.tiles.values())tile.authored?.clear();}

test('graph surface binding preserves one-way permissions and rejects absent, wrong-layer or non-road contacts atomically',()=>{
 const f=megaraSurfaceFixture({bind:true,restricted:true}),before=f.tile.t.edges.slice();bindRoadGraphSurfaces(f.tiles);assert.equal(f.tile.t.edges[8],8,'asphalt contact flags never replace graph access restrictions');assert.equal(f.tile.t.edges.filter((_,i)=>i%10===0&&f.tile.ids[f.tile.t.edges[i]].startsWith('megara:e:way-')).length,1,'one-way direction remains a single source edge');
 for(const corrupt of [f=>f.tile.graphSurfaceBindings[0].surface='surface:missing',f=>f.tile.t.edgeLayers[0]=1,f=>{for(let i=4;i<f.tile.t.contactTriangles.length;i+=5)f.tile.t.contactTriangles[i]=4;}]){
  const bad=megaraSurfaceFixture({bind:true});corrupt(bad);const original=bad.tile.t.edges.slice();assert.throws(()=>bindRoadGraphSurfaces(bad.tiles),/no emitted physical contact/);assert.deepEqual(bad.tile.t.edges,original);
 }
 assert.equal(before[8],f.tile.t.edges[8]);
});

import {encodeGeometryPack,decodeGeometryPack} from '../src/baked-geometry.js';
import {gzipSync,gunzipSync} from 'node:zlib';
import {patchEncodedGraphSurfaceWords,megaraSurfaceRepairContract,repairMegaraGraphCell,ORIGINAL_MEGARA_IMPORTER_SHA256} from './world-gen/repair-megara-graph-surfaces.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function repairFixture({shuffled=false,oneway=false,flags=0,surface='surface:roads',layer=0,contactLayer=0,contactFlags=1,id='megara:e:way-123-0:1:f'}={}){
 const ids=['','surface:roads','surface:megaraNetwork',id,'megara:e:raceway-70043234:1:f'],tables=Object.fromEntries(Object.keys(TILE_TABLES).map((k,i)=>[k,i])),arrays=Object.values(TILE_TABLES).map(([type])=>new globalThis[type]());
 arrays[tables.edges]=new Uint32Array([3,0,0,0,2,0,1,50,flags,ids.indexOf(surface),4,0,0,0,2,0,1,80,0,1]);arrays[tables.edgeLayers]=new Int8Array([layer,0]);arrays[tables.edgePoints]=new Float32Array([1,9,2,4,9,6]);arrays[tables.contactPositions]=new Float32Array([1,9,2,4,9,6,8,9,10]);arrays[tables.contactTriangles]=new Uint32Array([0,1,2,2,contactFlags]);arrays[tables.contactLayers]=new Int8Array([contactLayer]);arrays.push(new Float32Array([Math.fround(1/3),-0,123.456]));
 const revision='a'.repeat(64),raw=Buffer.from(encodeGeometryPack({tileVersion:1,world:'megara',revision,cell:[-64,-1],origin:[-32768,0,-512],ids,strings:[''],tables,meshes:[{attributes:{position:{array:arrays.length-1,size:3}}}],provenance:{region:'megara',revision}},arrays,arrays.map(()=>shuffled))),body=gzipSync(raw),mapBytes=Buffer.from(JSON.stringify({id:'megara',roadNetwork:{roads:[{id:123,part:0,oneway,p:[1,2,4,6]}]}})),contextBytes=Buffer.from(JSON.stringify([{id:123,tags:flags===8?{access:'private'}:{}}]));
 const manifestBytes=Buffer.from(JSON.stringify({world:'megara',revision,sourceHashes:{'data/maps/megara/map.json':sha(mapBytes),'tools/maps/megara/raw/context.json':sha(contextBytes),'tools/import-track-region.mjs':ORIGINAL_MEGARA_IMPORTER_SHA256},tiles:{'-64,-1':{sha256:sha(body),bytes:body.length,decodedBytes:raw.length+65536}}})),args={manifestBytes,expectedManifestHash:sha(manifestBytes),mapBytes,contextBytes};
 return {raw,body,args,contract:megaraSurfaceRepairContract(args),arrays,tables,revision};
}

test('source-bound Megara repair preserves raw and shuffled payload bytes outside exact graph surface words',()=>{
 for(const shuffled of [false,true])for(const flags of [0,8]){
  const f=repairFixture({shuffled,flags}),r=repairMegaraGraphCell(f.body,f.contract,{cell:'-64,-1',newRevision:'b'.repeat(64)}),raw=gunzipSync(r.body),ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),next=decodeGeometryPack(ab),before=decodeGeometryPack(f.raw.buffer.slice(f.raw.byteOffset,f.raw.byteOffset+f.raw.length));
  assert.equal(r.edges,1);assert.equal(next.metadata.revision,'b'.repeat(64));assert.equal(next.metadata.provenance.revision,'b'.repeat(64));assert.deepEqual(next.metadata.ids,before.metadata.ids);assert.deepEqual(next.metadata.meshes,before.metadata.meshes);assert.equal(next.arrays[f.tables.edges][9],2);assert.equal(before.arrays[f.tables.edges][9],1,'old graph fails real Network surface binding');assert.equal(next.arrays[f.tables.edges][19],1,'raceway untouched');assert.equal(next.arrays[f.tables.edges][8],flags);
  for(let i=0;i<f.arrays.length;i++)if(i!==f.tables.edges)assert.deepEqual(Buffer.from(next.arrays[i].buffer,next.arrays[i].byteOffset,next.arrays[i].byteLength),Buffer.from(before.arrays[i].buffer,before.arrays[i].byteOffset,before.arrays[i].byteLength));
  const start=f.raw.readUInt32LE(8),newStart=raw.readUInt32LE(8),v=before.metadata.views[f.tables.edges],allowed=new Set(Array.from({length:4},(_,b)=>v.offset+(shuffled?b*v.length+9:9*4+b)));
  const a=f.raw.subarray(start),b=raw.subarray(newStart);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)if(!allowed.has(i))assert.equal(b[i],a[i],`encoded payload byte ${i}`);
  assert.equal(sha(f.body),f.contract.manifest.tiles['-64,-1'].sha256,'immutable original retained');
 }
});

test('Megara metadata repair rejects stale roots, unsupported importer/codec and unknown or physically unbound source roles',()=>{
 const f=repairFixture(),opts={cell:'-64,-1',newRevision:'b'.repeat(64)};
 assert.throws(()=>megaraSurfaceRepairContract({...f.args,expectedManifestHash:'c'.repeat(64)}),/manifest hash/);assert.throws(()=>megaraSurfaceRepairContract({...f.args,mapBytes:Buffer.from('{}')}),/source hash/);assert.throws(()=>megaraSurfaceRepairContract({...f.args,importerBytes:Buffer.from('different importer')}),/unsupported original importer/);
 assert.throws(()=>repairMegaraGraphCell(Buffer.from('different'),f.contract,opts),/cell hash/);assert.throws(()=>repairMegaraGraphCell(f.body,{},opts),/unverified/);assert.throws(()=>repairMegaraGraphCell(f.body,f.contract,{...opts,newRevision:f.revision}),/derived revision/);
 for(const config of [{id:'megara:e:way-999-0:1:f'},{surface:'surface:megaraNetwork'},{layer:1},{contactLayer:1},{contactFlags:0},{flags:1}]){const v=repairFixture(config);assert.throws(()=>repairMegaraGraphCell(v.body,v.contract,opts),/source edge|original graph surface|same-layer/);}
 const unsupported=Buffer.from(f.raw);unsupported.writeUInt32LE(0x32525341,0);assert.throws(()=>patchEncodedGraphSurfaceWords(unsupported,[{word:9,from:1,to:2}],'b'.repeat(64),{}),/unsupported codec/);assert.throws(()=>patchEncodedGraphSurfaceWords(f.raw,[{word:8,from:0,to:2}],'b'.repeat(64),{}),/surface edit/);assert.throws(()=>patchEncodedGraphSurfaceWords(f.raw,[{word:9,from:2,to:1}],'b'.repeat(64),{}),/stale edge/);
 const one=repairFixture({oneway:true});assert.equal(repairMegaraGraphCell(one.body,one.contract,opts).edges,1);const reverse=repairFixture({oneway:true,id:'megara:e:way-123-0:1:r'});assert.throws(()=>repairMegaraGraphCell(reverse.body,reverse.contract,opts),/source edge/);
 assert.throws(()=>{f.contract.manifest.tiles['-64,-1'].sha256='c'.repeat(64);},TypeError);
});
