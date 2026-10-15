// Run on the same map inputs before/after; counts allocated terrain buffers and chunks.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadMap } from '../src/map.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { buildTerrain } from '../src/terrain.js';
globalThis.location={search:''};
globalThis.fetch=async u=>new Response(readFileSync(new URL('../'+u,import.meta.url)));
const report=[];
for(const id of ['riviera','penteli']){
 const map=await loadMap(undefined,'./',id,{preload:false}),network=new RoadNetwork(map),scene=new THREE.Group();
 const start=performance.now();
 const {group}=buildTerrain(map.terrain,map.route,[],scene,{coastal:id==='riviera',network});
 let triangles=0,bytes=0,draws=0,contactTriangles=0;
 group.traverse(m=>{if(!m.geometry)return;draws++;const g=m.geometry;triangles+=g.index.count/3;if(m.userData.terrainRefinement)contactTriangles+=g.index.count/3;
 for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;bytes+=g.index.array.byteLength;});
 report.push({id,draws,triangles,bytes,contactTriangles,buildMs:Math.round(performance.now()-start)});
 group.traverse(m=>m.geometry?.dispose());
 console.log(JSON.stringify(report.at(-1)));
}
