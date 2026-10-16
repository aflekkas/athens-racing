import {readFileSync,writeFileSync} from 'node:fs';
import {writeHeapSnapshot} from 'node:v8';
import {gzipSync,gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {loadMap} from '../../../src/map.js';
import {RoadNetwork} from '../../../src/road-network-surface.js';
import {buildTerrain} from '../../../src/terrain.js';
import {packGroup} from '../../../src/baked-world-pack.js';
import {decodeGeometryPack} from '../../../src/baked-geometry.js';
import {restoreBakedTerrain} from '../../../src/baked-world.js';
import {measure,poses} from './measure.mjs';
globalThis.fetch=async u=>new Response(readFileSync(String(u)));
globalThis.location={search:''};
const id=process.argv[2],output=process.argv[3],stages=[];
function heap(stage){gc();gc();stages.push({stage,...process.memoryUsage()});}
const cpuMs=start=>{const t=process.cpuUsage(start);return (t.user+t.system)/1000;};
heap('modules');let cpu=process.cpuUsage();const map=await loadMap(undefined,'./',id,{preload:false});const mapDecodeCpuMs=cpuMs(cpu);heap('map');
cpu=process.cpuUsage();const network=new RoadNetwork(map);const networkCpuMs=cpuMs(cpu);heap('network');
cpu=process.cpuUsage();const ter=buildTerrain(map.terrain,map.route,[],new THREE.Group(),{coastal:id==='riviera',farmland:id==='megara',network,beachAreas:map.data.areas?.beach||[]});const buildCpuMs=cpuMs(cpu);heap('terrain');
if(process.env.TERRAIN_HEAP_SNAPSHOT)writeHeapSnapshot(process.env.TERRAIN_HEAP_SNAPSHOT);
const row={id,mapDecodeCpuMs,networkCpuMs,buildCpuMs,stages,contactMemory:map.terrain.contactMemory,...measure(ter.group,map)};
row.cpuLodIndexBytes=0;row.patchCount=0;
ter.group.traverse(m=>{row.cpuLodIndexBytes+=m.geometry?.userData.terrainLodSource?.byteLength||0;row.patchCount+=m.terrainLodState?.patches.length||0;});
const camera=new THREE.PerspectiveCamera(60,1.6,.2,16000),renderer={info:{render:{frame:0}},getDrawingBufferSize:v=>v.set(960,600)};
function select(){renderer.info.render.frame++;ter.group.traverse(m=>{if(m.isMesh)m.onBeforeRender(renderer,null,camera);});}
row.lodHistogram=[];
for(const pose of poses(map)){camera.position.fromArray(pose.eye);camera.lookAt(...pose.target);camera.updateMatrixWorld();select();const counts=[0,0,0,0];ter.group.traverse(m=>{for(const p of m.terrainLodState?.patches||[])counts[p.current]++;});row.lodHistogram.push({pose:pose.name,counts});}
for(let i=0;i<1000;i++)select();cpu=process.cpuUsage();for(let i=0;i<10000;i++)select();row.stationarySelectionCpuUs=cpuMs(cpu)*1000/10000;
const source=packGroup(ter.group,{height:0,source:1},[map.terrain.Hc,network.source]);if(process.env.TERRAIN_PACK_DIR)writeFileSync(process.env.TERRAIN_PACK_DIR+'/'+id+'.pack',new Uint8Array(source));const zipped=gzipSync(new Uint8Array(source));
cpu=process.cpuUsage();const bytes=gunzipSync(zipped),pack=decodeGeometryPack(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const restored=restoreBakedTerrain(pack,map.terrain,network,new THREE.Group(),{farmland:id==='megara'});row.cachedDecodeBuildCpuMs=cpuMs(cpu);row.rawPackBytes=source.byteLength;row.gzipPackBytes=zipped.byteLength;row.restored=measure(restored.group,map);
writeFileSync(output,JSON.stringify(row,null,2));console.log(row);
