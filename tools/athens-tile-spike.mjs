// Offline research only. Partition existing road triangles by 512 m centroid cell.
// No clipping, terrain, buildings or runtime integration; reports byte cost, not a shippable tile format.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { loadMap } from '../src/map.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { buildRoadNetwork } from '../src/road-network.js';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]||'.scratch/athens-open-world');
mkdirSync(out,{recursive:true});
const oldFetch=globalThis.fetch,oldLocation=globalThis.location;
globalThis.fetch=async url=>new Response(readFileSync(resolve(root,String(url))));
globalThis.location={search:''};
const report={tileMetres:512,method:'whole triangles assigned by centroid; interleaved float32 position/normal/uv/color; gzip level 9',maps:[]};
try {
 for(const id of ['riviera','megara','penteli']) {
  const begin=performance.now(),map=await loadMap(undefined,'./',id,{preload:false}),network=new RoadNetwork(map),scene=new THREE.Group();
  // Raw source grid only: full terrain conformance deliberately outside this inexpensive spike.
  network.source=map.terrain.H; map.roadNetwork=network;
  const group=buildRoadNetwork(network,scene),bins=new Map();let triangles=0;
  group.traverse(m=>{
   if(!m.geometry)return;
   const g=m.geometry,p=g.attributes.position,index=g.index,attrs=Object.entries(g.attributes),n=index?.count??p.count;
   for(let k=0;k<n;k+=3){
    const ids=[0,1,2].map(j=>index?index.getX(k+j):k+j);
    const x=ids.reduce((s,i)=>s+p.getX(i),0)/3,z=ids.reduce((s,i)=>s+p.getZ(i),0)/3;
    const key=`${Math.floor(x/512)},${Math.floor(z/512)}`;
    if(!bins.has(key))bins.set(key,[]);const arr=bins.get(key);
    for(const i of ids)for(const [,a] of attrs)for(let j=0;j<a.itemSize;j++)arr.push(a.array[i*a.itemSize+j]);
    triangles++;
   }
  });
  let rawBytes=0,gzipBytes=0,maxGzipBytes=0;const sizes=[];
  for(const [cell,a] of bins){const bytes=Buffer.from(new Float32Array(a).buffer),zip=gzipSync(bytes,{level:9});rawBytes+=bytes.length;gzipBytes+=zip.length;maxGzipBytes=Math.max(maxGzipBytes,zip.length);sizes.push({cell,rawBytes:bytes.length,gzipBytes:zip.length});}
  const data=readFileSync(resolve(root,map.definition.dataUrl)),terrain=readFileSync(resolve(root,map.definition.terrainUrl));
  report.maps.push({id,roadKm:map.data.roadNetwork.length/1000,buildings:map.data.buildings?.length??0,mapJsonBytes:data.length,mapJsonGzipBytes:gzipSync(data).length,terrainBytes:terrain.length,terrainGzipBytes:gzipSync(terrain).length,terrainGrid:[map.terrain.GX,map.terrain.GZ],tiles:bins.size,triangles,rawBytes,gzipBytes,maxGzipBytes,elapsedMs:Math.round(performance.now()-begin),sizes});
  group.traverse(m=>m.geometry?.dispose());map.dispose();
 }
}finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}
writeFileSync(resolve(out,'tile-spike.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.maps.map(({sizes,...m})=>m),null,2));
