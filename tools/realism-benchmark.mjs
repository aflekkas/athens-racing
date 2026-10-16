import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {bakeBlockShade} from '../src/baked-realism.js';
import {buildBuildings as after} from '../src/buildings.js';
const source=await fs.readFile(new URL('../.scratch/realism/before-buildings.js',import.meta.url),'utf8');
const temp=new URL('../src/.realism-before.js',import.meta.url);await fs.writeFile(temp,source);
try{
 const {buildBuildings:before}=await import(temp.href),results=[];
 for(const [map,path] of [['riviera','data/map.json'],['penteli','data/maps/penteli/map.json'],['megara','data/maps/megara/map.json']]){
 const data=JSON.parse(await fs.readFile(new URL('../'+path,import.meta.url)));
 const samples={before:[],after:[]},stats={};
 for(let round=0;round<12;round++)for(const phase of round%2?['after','before']:['before','after']){
 const scene=new THREE.Group(),t=performance.now();const built=({before,after})[phase]({data},scene,()=>10);
 const ms=performance.now()-t;if(round>1)samples[phase].push(ms);
 let triangles=0,bytes=0,calls=0;built.group.traverse(o=>{if(!o.geometry)return;calls++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;for(const a of Object.values(o.geometry.attributes))bytes+=a.array.byteLength;o.geometry.dispose();});built.group.children[0]?.material.dispose();
 stats[phase]={triangles,geometryBytes:bytes,drawCalls:calls,textureBytes:0};
 }
 for(const phase of ['before','after']){samples[phase].sort((a,b)=>a-b);stats[phase].buildMedianMs=samples[phase][5];}
 const probe=before({data},new THREE.Group(),()=>10),bakes=[];
 const batches=probe.group.children.map(o=>({pos:o.geometry.attributes.position.array,nor:o.geometry.attributes.normal.array,col:o.geometry.attributes.color.array}));
 for(let i=0;i<120;i++){for(const b of batches)b.col.fill(1);const t=performance.now();for(const b of batches)bakeBlockShade(b,0,0,20);if(i>=20)bakes.push(performance.now()-t);}
 bakes.sort((a,b)=>a-b);for(const o of probe.group.children)o.geometry.dispose();probe.group.children[0]?.material.dispose();
 stats.after.bakeOnlyMedianMs=bakes[50];stats.after.bakeOnlyP95Ms=bakes[95];
 results.push({map,buildings:data.buildings.length,...stats,samples});console.log(map,JSON.stringify(stats));
 }
 await fs.writeFile(new URL('../.scratch/realism/costs.json',import.meta.url),JSON.stringify(results,null,2));
}finally{await fs.unlink(temp);}
