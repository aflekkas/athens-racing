import {readFileSync,readdirSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '/home/dev/data/athens-world-cache/w4/app/src/baked-geometry.js';
import {tileTables,validateWorldTile} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-format.js';
import {addDerivedBuildings} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-buildings.js';
const load=(dir,cell)=>{const f=readdirSync(dir).find(n=>n.startsWith(cell+'-')&&n.endsWith('.gz'));const raw=gunzipSync(readFileSync(dir+'/'+f));return decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));};
const tris=(pack,pick)=>{const out=[];for(const m of pack.metadata.meshes){if(!pick(m))continue;const P=pack.arrays[m.attributes.position.array],C=pack.arrays[m.attributes.color.array],I=pack.arrays[m.index];
 const s=m.drawRange?.start??0,n=m.drawRange?.count??I.length;for(let k=s;k<s+n;k+=3){const pts=[0,1,2].map(j=>{const v=I[k+j];return [P[v*3],P[v*3+1],P[v*3+2]].map(x=>Math.round(x*100)/100).join(',')+'|'+C[v*3];});
 // canonical rotation
 let best=null;for(let r=0;r<3;r++){const s2=[pts[r],pts[(r+1)%3],pts[(r+2)%3]].join(';');if(best===null||s2<best)best=s2;}out.push(m.material+'#'+best);}}return out;};
for(const cell of process.argv.slice(4)){
 const old=load(process.argv[2],cell),neu=load(process.argv[3],cell);
 const isB=m=>m.material>=2&&m.material<2+9&&m.attributes.color; // building palette entries
 const ob=tris(old,m=>m.attributes.color&&m.material>=2&&m.material<=10&&m.userData?.tileSurface==null&&m.name!=='ground');
 addDerivedBuildings(neu,tileTables(neu));
 const nb=tris(neu,m=>m.attributes.color&&m.material>=2&&m.material<=10&&m.userData?.tileSurface==null&&m.name!=='ground');
 // restrict to building meshes: derived ones are last
 console.log(cell,'old building-ish tris',ob.length,'derived',nb.length);
 const count=new Map();for(const x of ob)count.set(x,(count.get(x)||0)+1);let missing=0,roofDiff=0;
 let wallMiss=0;for(const x of nb){if(count.get(x))count.set(x,count.get(x)-1);else{missing++;if(!x.split('|')[1].startsWith('255')&&!/\|255;/.test(x)||!x.endsWith('|255'))wallMiss++;}}
 console.log('  non-roof mismatches',wallMiss);
 const left=[...count.values()].reduce((a,b)=>a+Math.max(b,0),0);
 console.log('  derived tris not found in old:',missing,' old tris not matched:',left);
}
