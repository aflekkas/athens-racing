// Audit actual rendered triangle planes (including the coarse underlay), not
// just the terrain contact function. Run from a clean archive, in Node/Three.
import fs from 'node:fs';
import * as THREE from 'three';
import {loadMap} from '../src/map.js';
import {buildTerrain} from '../src/terrain.js';
import {RoadNetwork} from '../src/road-network-surface.js';
import {buildRoadNetwork} from '../src/road-network.js';
import {buildPenteliSurface} from '../src/maps/penteli-surface.js';
const root=new URL('../',import.meta.url);
globalThis.location={search:''};globalThis.fetch=async u=>new Response(fs.readFileSync(new URL(u,root)));
const map=await loadMap(undefined,'./','penteli'),network=new RoadNetwork(map),scene=new THREE.Group();map.roadNetwork=network;
const terrain=buildTerrain(map.terrain,map.route,[],scene,{coastal:false,network});buildRoadNetwork(network,scene);
const road=buildPenteliSurface(scene,map,terrain.heightC),r=map.route,cell=32,bins=new Map(),samples=[];
const add=(kind,x,z,y,meta)=>{samples.push({kind,x,z,y,...meta});const key=Math.floor(x/cell)+','+Math.floor(z/cell);if(!bins.has(key))bins.set(key,[]);};
for(let s=0;s<=r.length;s+=2)for(let u=-r.edge(s)-3;u<=r.edge(s)+3+.001;u+=1){const p=r.point(s,u);add('route',p.x,p.z,p.y,{s,u});}
for(const seg of network.segments){const count=Math.ceil(seg.L/2);for(let k=0;k<=count;k++)for(let u=-seg.hw-seg.sw-2;u<=seg.hw+seg.sw+2+.001;u+=1){const x=seg.ax+seg.dx*k/count-seg.dz/seg.L*u,z=seg.az+seg.dz*k/count+seg.dx/seg.L*u;if(network.mainInside(x,z))continue;add('branches',x,z,network.height(x,z),{road:seg.road.id});}}
const meshes=[...terrain.group.children,...road.group.children.filter(o=>o.name==='Penteli cut and fill verge')];
for(const o of meshes){const p=o.geometry.attributes.position.array,ix=o.geometry.index.array;for(let k=0;k<ix.length;k+=3){const a=ix[k]*3,b=ix[k+1]*3,c=ix[k+2]*3;
 const x0=Math.floor(Math.min(p[a],p[b],p[c])/cell),x1=Math.floor(Math.max(p[a],p[b],p[c])/cell),z0=Math.floor(Math.min(p[a+2],p[b+2],p[c+2])/cell),z1=Math.floor(Math.max(p[a+2],p[b+2],p[c+2])/cell);
 for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)bins.get(x+','+z)?.push({p,a,b,c,name:o.name,coarse:!!o.userData.coarseTerrain});
}}
const empty=()=>({samples:0,above:0,missing:0,maxAbove:0,coarseAbove:0});const result={longitudinalSpacing:2,crossSpacing:1,route:empty(),branches:empty()};
for(const q of samples){let y=-Infinity,source=null;for(const t of bins.get(Math.floor(q.x/cell)+','+Math.floor(q.z/cell))){const {p,a,b,c}=t,det=(p[b+2]-p[c+2])*(p[a]-p[c])+(p[c]-p[b])*(p[a+2]-p[c+2]);if(!det)continue;
 const u=((p[b+2]-p[c+2])*(q.x-p[c])+(p[c]-p[b])*(q.z-p[c+2]))/det,v=((p[c+2]-p[a+2])*(q.x-p[c])+(p[a]-p[c])*(q.z-p[c+2]))/det;
 if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001){const h=u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1];if(h>y){y=h;source=t;}}
 }const stats=result[q.kind];stats.samples++;if(!Number.isFinite(y)){stats.missing++;continue;}const delta=y-q.y;if(delta>1e-4){stats.above++;if(source.coarse)stats.coarseAbove++;if(delta>stats.maxAbove){stats.maxAbove=delta;stats.worst={...q,terrain:y,name:source.name};}}}
const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(result.route.above||result.branches.above||result.route.missing||result.branches.missing)process.exitCode=1;
