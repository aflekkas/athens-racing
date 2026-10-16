// Sample actual contact lookup on both sides of every shared edge; two packs resident.
import{readFile}from'node:fs/promises';import{resolve}from'node:path';import{gunzipSync}from'node:zlib';
import{readTileBytes}from'./pack-world-tiles.mjs';import{decodeTilePack}from'../src/world-tile-codec.js';
import{validateWorldManifest,validateTileSeam,tileTables}from'../src/world-tile-format.js';import{buildTileContactIndex,sampleTileContact}from'../src/world-tile-contact.js';
export function sampleContactSeam(a,b,{tolerance=.02,spacing=1,epsilon=.00001}={}){
 if(!(tolerance>=0&&spacing>0&&epsilon>0&&epsilon<.01))throw new Error('Invalid seam sampling limits');
 validateTileSeam(a,b);
 const dx=b.metadata.cell[0]-a.metadata.cell[0],dz=b.metadata.cell[1]-a.metadata.cell[1];if(Math.abs(dx)+Math.abs(dz)!==1)throw new Error('Contact seam neighbours required');
 const axis=dx?0:2,other=dx?2:0,aside=dx+dz>0?512:0,bside=512-aside;
 const packs=[a,b].map(p=>({t:tileTables(p),index:null}));for(const p of packs)p.index=buildTileContactIndex(p.t);
 const stations=new Map(),add=(station,y)=>{if(station<0||station>512)return;let refs=stations.get(station);if(!refs)stations.set(station,refs=[]);if(Number.isFinite(y)&&!refs.some(v=>Math.abs(v-y)<.001))refs.push(y);};
 for(let station=0;station<=512;station+=spacing)add(Math.min(station,512));add(512);
 for(let k=0;k<2;k++)for(const name of['finePositions','contactPositions']){const p=packs[k].t[name],side=k?bside:aside;for(let i=0;i<p.length;i+=3)if(p[i+axis]===side)add(p[i+other],p[i+1]);}
 const sorted=[...stations.keys()].sort((a,b)=>a-b);for(let i=1;i<sorted.length;i++)add((sorted[i-1]+sorted[i])/2);
 let samples=0,maxDelta=0,missing=0,worst=null,transitionSamples=0,maxTransitionDelta=0;const failures=[];
 for(const[station,heights]of stations){const at=Math.max(epsilon,Math.min(512-epsilon,station));
  if(!heights.length){const i=Math.min(31,Math.floor(station/16)),coarse=packs[0].t.coarseHeights;heights.push(coarse[axis===0?i*33+(aside?32:0):(aside?32*33:0)+i]);}
  for(const referenceY of heights){const contacts=packs.map((p,k)=>{const side=k?bside:aside,v=side?512-epsilon:epsilon;return sampleTileContact(p.t,p.index,axis===0?v:at,axis===2?v:at,{referenceY});});samples++;
   if(contacts.some(c=>!c||!Number.isFinite(c.y))){missing++;if(failures.length<20)failures.push({station,referenceY,missing:true});continue;}
   const delta=Math.abs(contacts[0].y-contacts[1].y),transition=contacts[0].flags!==contacts[1].flags;
   // At a real road/shoulder boundary, epsilon samples can lie on different
   // physical surfaces. Check each like surface at the shared edge as well;
   // strict boundary-segment validation above prevents missing road topology.
   if(transition){transitionSamples++;maxTransitionDelta=Math.max(maxTransitionDelta,delta);if(delta>.15&&failures.length<20)failures.push({station,referenceY,delta,transition:true});}
   else if(delta>maxDelta){maxDelta=delta;worst={station,referenceY,heights:contacts.map(c=>c.y),flags:contacts.map(c=>c.flags)};}
   if(!transition&&delta>tolerance&&failures.length<20)failures.push({station,referenceY,delta,heights:contacts.map(c=>c.y)});
   for(const requiredFlags of [1,2]){
    const same=packs.map((p,k)=>{const side=k?bside:aside;return sampleTileContact(p.t,p.index,axis===0?side:at,axis===2?side:at,{referenceY,requiredFlags,includeBoundary:true});});
    if(same.some(c=>!c))continue;const difference=Math.abs(same[0].y-same[1].y);samples++;
    if(difference>maxDelta){maxDelta=difference;worst={station,referenceY,requiredFlags,heights:same.map(c=>c.y)};}if(difference>tolerance&&failures.length<20)failures.push({station,referenceY,requiredFlags,delta:difference});
   }
  }
 }
 return {samples,maxDelta,missing,worst,transitionSamples,maxTransitionDelta,failures};
}
export async function validateDirectoryContacts(path,options={}){
 const manifest=validateWorldManifest(JSON.parse(await readFile(path,'utf8')));let edges=0,samples=0,maxDelta=0,missing=0,worst=null,transitionSamples=0,maxTransitionDelta=0;const failures=[];
 const load=async key=>{const raw=gunzipSync(await readTileBytes(path,manifest.tiles[key]),{maxOutputLength:manifest.tiles[key].decodedBytes});return decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),manifest.tiles[key].decodedBytes);};
 for(const key of Object.keys(manifest.tiles)){const[x,z]=key.split(',').map(Number);let a;
  for(const next of[`${x+1},${z}`,`${x},${z+1}`]){if(!manifest.tiles[next])continue;a??=await load(key);const b=await load(next),result=sampleContactSeam(a,b,options);edges++;transitionSamples+=result.transitionSamples;maxTransitionDelta=Math.max(maxTransitionDelta,result.maxTransitionDelta);samples+=result.samples;missing+=result.missing;if(result.maxDelta>maxDelta){maxDelta=result.maxDelta;worst={tiles:[key,next],...result.worst};}if(result.failures.length)failures.push({tiles:[key,next],...result});}
 }
 return {world:manifest.world,edges,samples,maxDelta,missing,worst,transitionSamples,maxTransitionDelta,failures};
}
if(process.argv[1]===import.meta.filename){const result=await validateDirectoryContacts(resolve(process.argv[2]));console.log(JSON.stringify(result,null,2));if(result.missing||result.failures.length)process.exitCode=1;}
