import {readFileSync,readdirSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '/home/dev/data/athens-world-cache/w4/app/src/baked-geometry.js';
import {tileTables,legacyTables} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-contact.js';
const dir=process.argv[2];let n=0,bad=0,refsC=0,refsL=0;
for(const f of readdirSync(dir).filter(n=>n.endsWith('.gz'))){
 const raw=gunzipSync(readFileSync(dir+'/'+f));const pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
 const t=tileTables(pack),l=legacyTables(t);const ic=buildTileContactIndex(t),il=buildTileContactIndex(l);refsC+=ic.refs.length;refsL+=il.refs.length;
 let seed=12345;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
 const optsList=[{},{requiredFlags:1},{requiredFlags:2},{layer:0},{layer:1},{layer:0,requiredFlags:1},{referenceY:20},{referenceY:30,layer:null,requiredFlags:1}];
 for(let i=0;i<4000;i++){const x=rnd()*512,z=rnd()*512,o=optsList[i%optsList.length];
  const a=sampleTileContact(t,ic,x,z,o),b=sampleTileContact(l,il,x,z,o);n++;
  if(JSON.stringify(a)!==JSON.stringify(b)){bad++;if(bad<5)console.log('DIFF',f,x,z,o,a,b);}}
}
console.log('samples',n,'differences',bad,'refs compact',refsC,'legacy',refsL);
