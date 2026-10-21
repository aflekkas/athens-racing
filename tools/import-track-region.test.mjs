import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {regionTransform,splitSegment,addAuthoredMeshes,addRails,addRoadGraph} from './world-gen/track-region-geometry.mjs';
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
 const {get,tiles}=fixture(),t=regionTransform(source,source),points=Array.from({length:22},(_,i)=>[500+i*2,10+i*.1,40]);const stats=addRoadGraph([{id:'main',points}],get,t);assert.ok(stats.directedEdges>=42);assert.equal(tiles.size,2);assert.ok(get(1,0).t.anchors.length);assert.ok(get(0,0).t.turns.length);assert.throws(()=>addRoadGraph([{id:'steep',points:[[0,0,0],[1,1,0]]}],get,t),/45%/);
});
test('source locks fail on stale inputs and duplicate cells fail regardless of matching hashes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'athens-region-lock-'));try{
  const body='original';await writeFile(join(dir,'input'),body);const config={schemaVersion:1,id:'penteli',tileMetres:512,access:'public',elevation:{datum:'EVRS2000',source:'EU-DEM v1.1',verticalOffset:0},sourceHashes:{input:createHash('sha256').update(body).digest('hex')}};
  await writeFile(join(dir,'input'),'changed');await assert.rejects(checkSourceHashes(dir,config),/Stale region source hash/);
 }finally{await rm(dir,{recursive:true,force:true});}
 assert.throws(()=>rejectDuplicateCells({tiles:{'0,0':{}}},{tiles:{'0,0':{}}}),/Duplicate region cell/);
 assert.equal(regionBudgets({tiles:{'0,0':{bytes:1,decodedBytes:65*1024**2}}}).passed,false);
});

import {composeWorldManifest,loadWorldDefinition,canonicalWorldJSON} from '../src/world-manifest.js';
test('world set rejects stale packet identities, mixed datums, overlapping cells and changed manifests',async()=>{
 const projection={lat0:37.98,lon0:23.73,mlat:111320,mlon:111320*Math.cos(37.98*Math.PI/180)},sha='a'.repeat(64),entry={url:'./cell.gz',bytes:1,decodedBytes:100,triangles:0,dependencies:[],sha256:sha};
 const source=(world,cell)=>({tileVersion:1,tileMetres:512,world,revision:'source-v1',projection,elevation:{datum:'EVRS2000'},tiles:{[cell]:entry},spawn:{cell:cell.split(',').map(Number),anchor:'test'}});
 const sources={basin:{manifest:source('basin','0,0'),url:'https://local/basin/world.json'},penteli:{manifest:source('penteli','30,-20'),url:'https://local/penteli/world.json'}};
 const content={schemaVersion:1,id:'athens',tileMetres:512,projection,regions:Object.entries(sources).map(([id,s])=>({id,manifestUrl:s.url,manifestSha256:createHash('sha256').update(JSON.stringify(s.manifest)).digest('hex'),sourceWorld:id,sourceRevision:'source-v1',access:'public'}))},def={...content,revision:createHash('sha256').update(canonicalWorldJSON(content)).digest('hex')};
 const combined=composeWorldManifest(def,sources);assert.equal(combined.tiles['30,-20'].source.world,'penteli');assert.equal(combined.tiles['30,-20'].url,'https://local/penteli/cell.gz');
 const rejected=structuredClone(sources);rejected.penteli.manifest.acceptance={passed:false};assert.throws(()=>composeWorldManifest(def,rejected),/acceptance gates/);
 const nested=structuredClone(sources);nested.basin.manifest.tiles['0,0'].source={regionId:'basin',world:'basin-old-packets',revision:'original-revision'};const preserved=composeWorldManifest(def,nested);assert.equal(preserved.tiles['0,0'].source.revision,'original-revision');assert.equal(preserved.tiles['0,0'].source.world,'basin-old-packets');
 const stale=structuredClone(sources);stale.penteli.manifest.revision='stale';assert.throws(()=>composeWorldManifest(def,stale),/Stale region/);
 const mixed=structuredClone(sources);mixed.penteli.manifest.elevation.datum='EGM2008';assert.throws(()=>composeWorldManifest(def,mixed),/datum mismatch/);
 const overlap=structuredClone(sources);overlap.penteli.manifest=source('penteli','0,0');assert.throws(()=>composeWorldManifest(def,overlap),/Duplicate region cell/);
 const fetcher=async url=>Response.json(String(url).endsWith('set.json')?def:{...sources.basin.manifest,revision:'tampered'});await assert.rejects(loadWorldDefinition('https://local/set.json',{fetcher}),/manifest hash mismatch/);
});

import {WorldTileBarriers} from '../src/world-tile-barriers.js';
test('imported Penteli rail segments retain the 150 km/h swept collision across a cell seam',()=>{
 const {get,tiles}=fixture(),t=regionTransform(source,source);addRails([{pts:[{p:new THREE.Vector3(512,10,500),terminal:1},{p:new THREE.Vector3(512,10,530),terminal:1}]}],get,t);
 const barriers=new WorldTileBarriers();for(const[key,tile]of tiles)barriers.install(key,{metadata:{origin:[tile.cell[0]*512,0,tile.cell[1]*512],safetyRails:tile.safetyRails}});
 const v={x:520,y:10,z:512,yaw:-Math.PI/2,halfL:2.5,halfW:1,vLong:150/3.6,vLat:0,w:0};assert.ok(barriers.resolve(v,{x:503,y:10,z:512,yaw:v.yaw}));assert.ok(v.x+v.halfL<=512-.15);assert.equal(v.y,10);
});
