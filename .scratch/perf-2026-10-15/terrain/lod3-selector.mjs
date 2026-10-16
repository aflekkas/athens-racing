import {createRequire} from 'node:module';const cpuClock=createRequire(import.meta.url)('/tmp/terrain-thread-clock.node').now;
import {readFileSync,writeFileSync} from 'node:fs';
import * as T from 'three';
import {loadMap} from '../../../src/map.js';
import {RoadNetwork} from '../../../src/road-network-surface.js';
import {decodeGeometryPack} from '../../../src/baked-geometry.js';
import {restoreBakedTerrain} from '../../../src/baked-world.js';
globalThis.fetch=async u=>new Response(readFileSync(String(u)));globalThis.location={search:''};
const id=process.argv[2]||'penteli',map=await loadMap(undefined,'./',id,{preload:false}),network=new RoadNetwork(map);
const bytes=readFileSync(process.argv[4]||'/tmp/terrain-lod3-'+id+'.pack'),pack=decodeGeometryPack(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const ter=restoreBakedTerrain(pack,map.terrain,network,new T.Group(),{}),meshes=[];ter.group.traverse(m=>{if(m.isMesh)meshes.push(m);});
const camera=new T.PerspectiveCamera(60,1.6,.2,16000),renderer={info:{render:{frame:0}},getDrawingBufferSize:v=>v.set(960,600)};
function select(){renderer.info.render.frame++;for(const m of meshes)m.onBeforeRender(renderer,null,camera);}
const path=[];for(let i=0;i<1500;i++){const s=map.route.length*.45+i*250/3.6/60,q=map.route.point(s%map.route.length,0),a=map.route.point((s+30)%map.route.length,0);path.push([q.x,q.y+4,q.z,a.x,a.y+2,a.z]);}
function pose(p){camera.position.set(p[0],p[1],p[2]);camera.lookAt(p[3],p[4],p[5]);camera.updateMatrixWorld();}
for(let pass=0;pass<4;pass++)for(const p of path){pose(p);select();}
const cpuSamples=new Float64Array(path.length),wallSamples=new Float64Array(path.length);
function timedPass(){for(let i=0;i<path.length;i++){pose(path[i]);const t=performance.now(),c=cpuClock();select();const cpu=cpuClock()-c,wall=(performance.now()-t)*1000;cpuSamples[i]=cpu;wallSamples[i]=wall;}}
for(let i=0;i<4;i++)timedPass();gc();timedPass();
const samples=Array.from(cpuSamples.subarray(101),(cpuUs,i)=>({cpuUs,wallUs:wallSamples[i+101]}));
function stats(values){const a=values.sort((a,b)=>a-b);return {mean:a.reduce((a,b)=>a+b,0)/a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};}
const c=process.threadCpuUsage();for(let i=0;i<10000;i++)select();const used=process.threadCpuUsage(c);
const row={id,stationaryCpuUs:(used.user+used.system)/10000,drivingCpuUs:stats(samples.map(s=>s.cpuUs)),drivingWallUs:stats(samples.map(s=>s.wallUs)),samples};console.log({...row,samples:undefined});writeFileSync(process.argv[3]||'/tmp/terrain-lod3-selector.json',JSON.stringify(row));
